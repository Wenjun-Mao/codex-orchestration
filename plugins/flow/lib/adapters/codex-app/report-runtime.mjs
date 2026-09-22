import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  ensureDirectory,
  PACKAGE_VERSION,
  readJson,
  requireExactFields,
  requireText,
  sha256,
  sha256File,
  stableStringify,
} from "../../core.mjs";

const REPORT_RUNTIME_KIND = "codex-flow-report-runtime-v1";
const REPORT_RUNTIME_MANIFEST = "runtime.json";
const DIGEST = /^[0-9a-f]{64}$/;

function requiredDigest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`, 73);
  return result;
}

function safeRelativePath(value, label) {
  const path = requireText(value, label, { max: 512 });
  if (
    path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new CliError(`${label} must be a normalized relative path`, 73);
  return path;
}

async function runtimeSourceFiles(packageRoot) {
  const root = resolve(packageRoot);
  await assertNoSymlinkComponents(root, root, "Reporter package root");
  const files = ["bin/codex-flow-report-hook.mjs", "package.json"];
  const visit = async (directory) => {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new CliError(`Reporter runtime source contains a symbolic link: ${relativePath}`, 73);
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new CliError(`Reporter runtime source contains an unsupported entry: ${relativePath}`, 73);
    }
  };
  await visit("lib");
  return [...new Set(files)].sort();
}

function runtimeSeed({ packageVersion, files }) {
  return {
    schema_version: 1,
    kind: REPORT_RUNTIME_KIND,
    package_version: packageVersion,
    files,
  };
}

export function validateReportRuntimeManifest(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "runtime_sha256", "package_version", "files"],
  }, "Report runtime manifest");
  if (value.schema_version !== 1 || value.kind !== REPORT_RUNTIME_KIND) {
    throw new CliError("Unsupported report runtime manifest", 73);
  }
  if (value.files === null || typeof value.files !== "object" || Array.isArray(value.files)) {
    throw new CliError("Report runtime manifest files must be an object", 73);
  }
  const files = {};
  for (const path of Object.keys(value.files).sort()) {
    files[safeRelativePath(path, `Report runtime file ${path}`)] = requiredDigest(
      value.files[path],
      `Report runtime digest ${path}`,
    );
  }
  if (!("bin/codex-flow-report-hook.mjs" in files) || !("package.json" in files)) {
    throw new CliError("Report runtime manifest is incomplete", 73);
  }
  const manifest = {
    ...runtimeSeed({
      packageVersion: requireText(value.package_version, "Report runtime package_version", { max: 128 }),
      files,
    }),
    runtime_sha256: requiredDigest(value.runtime_sha256, "Report runtime runtime_sha256"),
  };
  if (manifest.runtime_sha256 !== sha256(stableStringify(runtimeSeed({
    packageVersion: manifest.package_version,
    files: manifest.files,
  })))) throw new CliError("Report runtime manifest digest does not match its contents", 73);
  return manifest;
}

export async function reportRuntimeManifestFor({ packageRoot }) {
  const root = resolve(packageRoot);
  const files = {};
  for (const path of await runtimeSourceFiles(root)) files[path] = await sha256File(resolve(root, path));
  const seed = runtimeSeed({ packageVersion: PACKAGE_VERSION, files });
  return validateReportRuntimeManifest({ ...seed, runtime_sha256: sha256(stableStringify(seed)) });
}

function runtimeRootFor({ storageRoot, senderThreadId, runtimeSha256 }) {
  const senderDigest = sha256(requireText(senderThreadId, "report runtime sender_thread_id", { max: 256 }));
  const runtimeDigest = requiredDigest(runtimeSha256, "report runtime runtime_sha256");
  return resolve(storageRoot, senderDigest, runtimeDigest);
}

async function actualRuntimeFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Staged report runtime contains a symbolic link: ${path}`, 73);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else throw new CliError(`Staged report runtime contains an unsupported entry: ${path}`, 73);
    }
  };
  await visit(root);
  return files.sort();
}

export async function assertStagedReportRuntime({ runtimeRoot, expectedRuntimeSha256 }) {
  const root = resolve(runtimeRoot);
  const storageRoot = resolve(root, "..", "..");
  await assertNoSymlinkComponents(storageRoot, root, "Staged report runtime");
  const manifest = validateReportRuntimeManifest(await readJson(resolve(root, REPORT_RUNTIME_MANIFEST), {
    guardRoot: storageRoot,
  }));
  if (manifest.runtime_sha256 !== requiredDigest(expectedRuntimeSha256, "expected report runtime digest")) {
    throw new CliError("Staged report runtime has the wrong identity", 73);
  }
  const expectedFiles = [...Object.keys(manifest.files), REPORT_RUNTIME_MANIFEST].sort();
  const actualFiles = await actualRuntimeFiles(root);
  if (stableStringify(actualFiles) !== stableStringify(expectedFiles)) {
    throw new CliError("Staged report runtime file inventory does not match its manifest", 73);
  }
  for (const [path, digest] of Object.entries(manifest.files)) {
    if (await sha256File(resolve(root, path)) !== digest) {
      throw new CliError(`Staged report runtime file digest does not match: ${path}`, 73);
    }
  }
  return manifest;
}

export async function stageReportRuntime({ storageRoot, senderThreadId, packageRoot }) {
  const storage = resolve(storageRoot);
  await ensureDirectory(storage, { guardRoot: resolve(storage, "..", "..") });
  const manifest = await reportRuntimeManifestFor({ packageRoot });
  const target = runtimeRootFor({
    storageRoot: storage,
    senderThreadId,
    runtimeSha256: manifest.runtime_sha256,
  });
  try {
    const checked = await assertStagedReportRuntime({
      runtimeRoot: target,
      expectedRuntimeSha256: manifest.runtime_sha256,
    });
    if (stableStringify(checked) !== stableStringify(manifest)) {
      throw new CliError("Existing staged report runtime differs from package authority", 73);
    }
    return { runtime_root: target, manifest: checked, status: "existing" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const senderRoot = dirname(target);
  await ensureDirectory(senderRoot, { guardRoot: resolve(storage, "..", "..") });
  const temporary = resolve(senderRoot, `.${manifest.runtime_sha256}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const path of Object.keys(manifest.files)) {
      const destination = resolve(temporary, path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(resolve(packageRoot, path), destination);
    }
    await atomicWriteJson(
      resolve(temporary, REPORT_RUNTIME_MANIFEST),
      manifest,
      { guardRoot: temporary, mode: 0o600 },
    );
    await assertStagedReportRuntime({
      runtimeRoot: temporary,
      expectedRuntimeSha256: manifest.runtime_sha256,
    });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      const checked = await assertStagedReportRuntime({
        runtimeRoot: target,
        expectedRuntimeSha256: manifest.runtime_sha256,
      });
      if (stableStringify(checked) !== stableStringify(manifest)) throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
  return { runtime_root: target, manifest, status: "created" };
}

export async function removeStagedReportRuntime({ storageRoot, senderThreadId, runtimeSha256 }) {
  const storage = resolve(storageRoot);
  const target = runtimeRootFor({ storageRoot: storage, senderThreadId, runtimeSha256 });
  await assertNoSymlinkComponents(resolve(storage, "..", ".."), target, "Report runtime cleanup");
  await rm(target, { recursive: true, force: true });
  const senderRoot = dirname(target);
  const entries = await readdir(senderRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length === 0) await rmdir(senderRoot).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
  });
}

export async function installStableReportLauncher({ pluginData, packageRoot }) {
  const requestedDataRoot = requireText(pluginData, "plugin_data", { max: 2048 });
  if (!isAbsolute(requestedDataRoot)) throw new CliError("plugin_data must be an absolute path", 73);
  const dataRoot = resolve(requestedDataRoot);
  await ensureDirectory(dataRoot);
  await assertNoSymlinkComponents(dataRoot, dataRoot, "Plugin report data");
  const sourceRoot = resolve(packageRoot);
  await assertNoSymlinkComponents(sourceRoot, sourceRoot, "Reporter package root");
  const source = resolve(sourceRoot, "bin", "codex-flow-report-launcher.mjs");
  await assertNoSymlinkComponents(sourceRoot, source, "Stable report launcher source");
  const target = resolve(dataRoot, "report-hooks", "launchers", "report-hook-launcher-v1.mjs");
  await ensureDirectory(dirname(target), { guardRoot: dataRoot });
  const bytes = await readFile(source);
  try {
    const handle = await open(target, "wx", 0o700);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { status: "created", launcher_path: target, launcher_sha256: sha256(bytes) };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = await readFile(target);
  if (sha256(existing) !== sha256(bytes)) {
    throw new CliError("Existing stable report launcher v1 has different bytes", 73);
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new CliError("Stable report launcher is not a regular file", 73);
  return { status: "existing", launcher_path: target, launcher_sha256: sha256(bytes) };
}

export function repositoryReportRuntimeStorage(commonDir) {
  return resolve(commonDir, "codex-flow", "report-locators", "runtimes");
}

export function pluginDataReportRuntimeStorage(pluginData) {
  return resolve(pluginData, "report-hooks", "runtimes");
}
