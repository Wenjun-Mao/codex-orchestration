import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWrite,
  CliError,
  ensureDirectory,
  ensureExactJson,
  PACKAGE_VERSION,
  readJson,
  requireExactFields,
  requireInteger,
  requireObject,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { sourceRuntimeBundleFiles } from "./runtime-bundle-source-v07.mjs";

export const V07_RUNTIME_SCHEMA_VERSION = 1;
export const V07_RUNTIME_KIND = "codex-flow-v07-runtime-context";
export const V07_RUNTIME_BUNDLE_KIND = "codex-flow-v07-runtime-bundle";
export const V07_RUNTIME_DIRECTORY = "v0.7.5";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const BUNDLE_PATH_PREFIXES = ["bin/", "lib/", "schemas/", "roles/", "references/"];

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function validateTimestamp(value, label) {
  requireText(value, label, { max: 64 });
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return value;
}

function validateAbsolutePath(value, label) {
  requireText(value, label, { max: 2048 });
  if (!isAbsolute(value)) throw new CliError(`${label} must be an absolute path`);
  return resolve(value);
}

function validateDigest(value, label) {
  requireText(value, label, { max: 64 });
  if (!DIGEST.test(value)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function validateJsonValue(value, label, depth = 0) {
  if (depth > 8) throw new CliError(`${label} is nested too deeply`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return requireText(value, label, { max: 8192 });
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CliError(`${label} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new CliError(`${label} contains too many entries`);
    return value.map((entry, index) => validateJsonValue(entry, `${label}[${index}]`, depth + 1));
  }
  requireObject(value, label);
  const entries = Object.entries(value);
  if (entries.length > 256) throw new CliError(`${label} contains too many fields`);
  return Object.fromEntries(entries.map(([key, entry]) => [
    requireText(key, `${label} key`, { max: 256 }),
    validateJsonValue(entry, `${label}.${key}`, depth + 1),
  ]));
}

function cloneJsonObject(value, label) {
  const validated = validateJsonValue(value, label);
  if (typeof validated !== "object" || validated === null || Array.isArray(validated)) {
    throw new CliError(`${label} must be a JSON object`);
  }
  return JSON.parse(stableStringify(validated));
}

function validateSnapshot(value, label, idField) {
  requireExactFields(value, {
    required: [idField, "snapshot"],
  }, label);
  return {
    [idField]: requireText(value[idField], `${label}.${idField}`, { max: 128, safeId: true }),
    snapshot: cloneJsonObject(value.snapshot, `${label}.snapshot`),
  };
}

export function validateRuntimeConfig(value) {
  return validateSnapshot(value, "runtime.config", "config_id");
}

export function validateRuntimePolicy(value) {
  return validateSnapshot(value, "runtime.policy", "policy_id");
}

function validateRepository(value) {
  requireExactFields(value, {
    required: ["common_dir", "root", "branch", "revision"],
  }, "runtime.repository");
  const revision = requireText(value.revision, "runtime.repository.revision", { max: 64 });
  if (!REVISION.test(revision)) {
    throw new CliError("runtime.repository.revision must be a lowercase Git revision");
  }
  return {
    common_dir: validateAbsolutePath(value.common_dir, "runtime.repository.common_dir"),
    root: validateAbsolutePath(value.root, "runtime.repository.root"),
    branch: requireText(value.branch, "runtime.repository.branch", { max: 256 }),
    revision,
  };
}

function validateBundleRelativePath(value, label) {
  requireText(value, label, { max: 512 });
  if (
    value.startsWith("/")
    || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
    || !BUNDLE_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))
  ) {
    throw new CliError(`${label} must be a safe managed runtime path`);
  }
  return value;
}

function bundleDigestFor(value) {
  const { bundle_sha256: ignored, ...withoutDigest } = value;
  return sha256(stableStringify(withoutDigest));
}

export function validateRuntimeBundle(value, label = "runtime bundle") {
  requireExactFields(value, {
    required: ["schema_version", "kind", "package_version", "files", "bundle_sha256"],
  }, label);
  if (value.schema_version !== V07_RUNTIME_SCHEMA_VERSION) {
    throw new CliError(`${label}.schema_version must be ${V07_RUNTIME_SCHEMA_VERSION}`);
  }
  if (value.kind !== V07_RUNTIME_BUNDLE_KIND) {
    throw new CliError(`${label}.kind must be ${V07_RUNTIME_BUNDLE_KIND}`);
  }
  requireObject(value.files, `${label}.files`);
  const entries = Object.entries(value.files);
  if (entries.length === 0 || entries.length > 2048) {
    throw new CliError(`${label}.files must contain between 1 and 2048 files`);
  }
  const files = Object.fromEntries(entries.map(([path, digest]) => [
    validateBundleRelativePath(path, `${label}.files path`),
    validateDigest(digest, `${label}.files.${path}`),
  ]).sort(([left], [right]) => left.localeCompare(right)));
  const bundle = {
    schema_version: V07_RUNTIME_SCHEMA_VERSION,
    kind: V07_RUNTIME_BUNDLE_KIND,
    package_version: requireText(value.package_version, `${label}.package_version`, { max: 128 }),
    files,
    bundle_sha256: validateDigest(value.bundle_sha256, `${label}.bundle_sha256`),
  };
  if (bundleDigestFor(bundle) !== bundle.bundle_sha256) {
    throw new CliError(`${label}.bundle_sha256 does not match the bundle manifest`);
  }
  return bundle;
}

function buildRuntimeBundle({ packageVersion, files }) {
  const draft = {
    schema_version: V07_RUNTIME_SCHEMA_VERSION,
    kind: V07_RUNTIME_BUNDLE_KIND,
    package_version: requireText(packageVersion, "runtime bundle packageVersion", { max: 128 }),
    files: Object.fromEntries(files
      .map((file) => [
        validateBundleRelativePath(file.relativePath, "runtime bundle file path"),
        validateDigest(file.hash, `runtime bundle file ${file.relativePath}`),
      ])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
  return validateRuntimeBundle({
    ...draft,
    bundle_sha256: bundleDigestFor(draft),
  });
}

function validateBundleSource(value, label = "runtime bundle source") {
  requireExactFields(value, { required: ["bundle", "files"] }, label);
  const bundle = validateRuntimeBundle(value.bundle, `${label}.bundle`);
  if (!Array.isArray(value.files) || value.files.length !== Object.keys(bundle.files).length) {
    throw new CliError(`${label}.files must contain every manifest file exactly once`);
  }
  const seen = new Set();
  const files = value.files.map((file, index) => {
    requireExactFields(file, { required: ["relativePath", "contents"] }, `${label}.files[${index}]`);
    const relativePath = validateBundleRelativePath(
      file.relativePath,
      `${label}.files[${index}].relativePath`,
    );
    if (seen.has(relativePath)) throw new CliError(`${label}.files contains a duplicate path`);
    seen.add(relativePath);
    const contents = Buffer.isBuffer(file.contents)
      ? Buffer.from(file.contents)
      : Buffer.from(requireText(file.contents, `${label}.files[${index}].contents`, { max: 16 * 1024 * 1024 }));
    if (bundle.files[relativePath] !== sha256(contents)) {
      throw new CliError(`${label}.files[${index}] does not match the bundle manifest`);
    }
    return { relativePath, contents };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (Object.keys(bundle.files).some((path) => !seen.has(path))) {
    throw new CliError(`${label}.files is incomplete`);
  }
  return { bundle, files };
}

export async function loadRuntimeBundleSource({ packageRoot }) {
  const root = validateAbsolutePath(packageRoot, "packageRoot");
  await assertNoSymlinkComponents(root, root, "Runtime package root");
  const managed = await sourceRuntimeBundleFiles(root);
  const bundle = buildRuntimeBundle({ packageVersion: PACKAGE_VERSION, files: managed });
  return validateBundleSource({
    bundle,
    files: managed.map((file) => ({
      relativePath: file.relativePath,
      contents: file.contents,
    })),
  });
}

export function validateRuntimeHost(value, label = "runtime.host") {
  requireExactFields(value, {
    required: ["host_id", "session_id"],
  }, label);
  return {
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    session_id: requireText(value.session_id, `${label}.session_id`, { max: 128, safeId: true }),
  };
}

export function validateRuntimeLineage(value, label = "runtime.lineage") {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation"],
  }, label);
  return {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, {
      min: 1,
      max: 2147483647,
    }),
  };
}

export function validateRuntimeContext(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "runtime_id", "created_at", "bundle", "config",
      "policy", "repository", "host", "lineage",
    ],
  }, "runtime context");
  if (value.schema_version !== V07_RUNTIME_SCHEMA_VERSION) {
    throw new CliError(`runtime context.schema_version must be ${V07_RUNTIME_SCHEMA_VERSION}`);
  }
  if (value.kind !== V07_RUNTIME_KIND) {
    throw new CliError(`runtime context.kind must be ${V07_RUNTIME_KIND}`);
  }
  const bundle = validateRuntimeBundle(value.bundle, "runtime context.bundle");
  const context = {
    schema_version: V07_RUNTIME_SCHEMA_VERSION,
    kind: V07_RUNTIME_KIND,
    runtime_id: validateDigest(value.runtime_id, "runtime context.runtime_id"),
    created_at: validateTimestamp(value.created_at, "runtime context.created_at"),
    bundle,
    config: validateRuntimeConfig(value.config),
    policy: validateRuntimePolicy(value.policy),
    repository: validateRepository(value.repository),
    host: validateRuntimeHost(value.host),
    lineage: validateRuntimeLineage(value.lineage),
  };
  const { runtime_id: ignored, ...withoutId } = context;
  if (context.runtime_id !== sha256(stableStringify(withoutId))) {
    throw new CliError("runtime context.runtime_id does not match the content-addressed context");
  }
  return context;
}

export function buildRuntimeContext({
  bundle,
  createdAt,
  config,
  policy,
  repository,
  host,
  lineage,
}) {
  const normalizedBundle = validateRuntimeBundle(bundle);
  const draft = {
    schema_version: V07_RUNTIME_SCHEMA_VERSION,
    kind: V07_RUNTIME_KIND,
    created_at: createdAt,
    bundle: normalizedBundle,
    config,
    policy,
    repository,
    host,
    lineage,
  };
  return validateRuntimeContext({
    ...draft,
    runtime_id: sha256(stableStringify(draft)),
  });
}

export function v07RuntimeRoot(gitCommonDirectory) {
  return join(validateAbsolutePath(gitCommonDirectory, "gitCommonDirectory"), "codex-flow", V07_RUNTIME_DIRECTORY);
}

export function runtimeSnapshotRoot(gitCommonDirectory, bundleSha256) {
  const digest = validateDigest(bundleSha256, "bundleSha256");
  return join(v07RuntimeRoot(gitCommonDirectory), "runtimes", digest);
}

export function runtimeContextPath(gitCommonDirectory, runtimeId) {
  const digest = validateDigest(runtimeId, "runtimeId");
  return join(v07RuntimeRoot(gitCommonDirectory), "contexts", `${digest}.json`);
}

export function runtimeBundleManifestPath(gitCommonDirectory, bundleSha256) {
  return join(runtimeSnapshotRoot(gitCommonDirectory, bundleSha256), "bundle.json");
}

export function runtimeBundleFilesRoot(gitCommonDirectory, bundleSha256) {
  return join(runtimeSnapshotRoot(gitCommonDirectory, bundleSha256), "files");
}

function runtimeLockPath(gitCommonDirectory) {
  return join(v07RuntimeRoot(gitCommonDirectory), "locks", "runtime-context.lock");
}

function assertRuntimeCommonDirectory(context, gitCommonDirectory) {
  const expected = validateAbsolutePath(gitCommonDirectory, "gitCommonDirectory");
  if (context.repository.common_dir !== expected) {
    throw new CliError("runtime context.repository.common_dir does not match gitCommonDirectory");
  }
}

async function prepareRuntimeRoot(gitCommonDirectory) {
  const commonDir = validateAbsolutePath(gitCommonDirectory, "gitCommonDirectory");
  await assertNoSymlinkComponents(commonDir, commonDir, "Git common directory");
  const root = v07RuntimeRoot(commonDir);
  await ensureDirectory(root, { guardRoot: commonDir, mode: 0o700 });
  return { commonDir, root };
}

export function runtimeContextHash(value) {
  return sha256(stableStringify(validateRuntimeContext(value)));
}

export function runtimeBindingFromContext(value) {
  const context = validateRuntimeContext(value);
  return {
    runtime_context_hash: runtimeContextHash(context),
    bundle_hash: context.bundle.bundle_sha256,
    config_hash: sha256(stableStringify(context.config)),
    policy_hash: sha256(stableStringify(context.policy)),
    repository_hash: sha256(stableStringify(context.repository)),
    host: clone(context.host),
    lineage: clone(context.lineage),
  };
}

async function ensureExactBytes(path, contents, guardRoot) {
  try {
    await atomicWrite(path, contents, {
      exclusive: true,
      mode: 0o600,
      guardRoot,
    });
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertNoSymlinkComponents(guardRoot, path, "Runtime bundle path");
  const existing = await readFile(path);
  if (!existing.equals(contents)) throw new CliError(`Existing runtime bundle file does not match: ${path}`);
  return "existing";
}

async function inventoryFiles(root, guardRoot) {
  const inventory = [];
  async function visit(directory) {
    await assertNoSymlinkComponents(guardRoot, directory, "Runtime bundle directory");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Runtime bundle contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) inventory.push(relative(root, path).split(sep).join("/"));
      else throw new CliError(`Runtime bundle contains an unsupported entry: ${path}`);
    }
  }
  await visit(root);
  return inventory.sort((left, right) => left.localeCompare(right));
}

export async function loadRuntimeBundleDirectory({ bundleRoot, bundle }) {
  const root = validateAbsolutePath(bundleRoot, "bundleRoot");
  const expected = validateRuntimeBundle(bundle);
  await assertNoSymlinkComponents(root, root, "Runtime bundle root");
  const inventory = await inventoryFiles(root, root);
  const expectedPaths = Object.keys(expected.files).sort((left, right) => left.localeCompare(right));
  if (stableStringify(inventory) !== stableStringify(expectedPaths)) {
    throw new CliError("Runtime bundle file inventory does not match its manifest");
  }
  const files = [];
  for (const relativePath of expectedPaths) {
    const path = join(root, ...relativePath.split("/"));
    await assertNoSymlinkComponents(root, path, "Runtime bundle file");
    const contents = await readFile(path);
    if (sha256(contents) !== expected.files[relativePath]) {
      throw new CliError(`Runtime bundle file hash does not match: ${relativePath}`);
    }
    files.push({ relativePath, contents });
  }
  return validateBundleSource({ bundle: expected, files });
}

async function verifyRuntimeSnapshot(commonDir, context) {
  const bundleHash = context.bundle.bundle_sha256;
  const manifestPath = runtimeBundleManifestPath(commonDir, bundleHash);
  const manifest = validateRuntimeBundle(await readJson(manifestPath, { guardRoot: commonDir }));
  if (stableStringify(manifest) !== stableStringify(context.bundle)) {
    throw new CliError("Runtime bundle manifest does not match the runtime context");
  }
  return loadRuntimeBundleDirectory({
    bundleRoot: runtimeBundleFilesRoot(commonDir, bundleHash),
    bundle: manifest,
  });
}

export async function acquireRuntimeContext({ gitCommonDirectory, context, bundleSource }) {
  const runtime = validateRuntimeContext(context);
  const source = validateBundleSource(bundleSource);
  if (stableStringify(source.bundle) !== stableStringify(runtime.bundle)) {
    throw new CliError("Runtime bundle source does not match the runtime context");
  }
  const { commonDir } = await prepareRuntimeRoot(gitCommonDirectory);
  assertRuntimeCommonDirectory(runtime, commonDir);
  const path = runtimeContextPath(commonDir, runtime.runtime_id);
  const result = await withProcessLock({
    path: runtimeLockPath(commonDir),
    guardRoot: commonDir,
    label: "v0.7 runtime context acquisition",
  }, async () => {
    await ensureExactJson(
      runtimeBundleManifestPath(commonDir, runtime.bundle.bundle_sha256),
      runtime.bundle,
      { guardRoot: commonDir, mode: 0o600 },
    );
    for (const file of source.files) {
      await ensureExactBytes(
        join(
          runtimeBundleFilesRoot(commonDir, runtime.bundle.bundle_sha256),
          ...file.relativePath.split("/"),
        ),
        file.contents,
        commonDir,
      );
    }
    await verifyRuntimeSnapshot(commonDir, runtime);
    return ensureExactJson(path, runtime, {
      guardRoot: commonDir,
      mode: 0o600,
    });
  });
  return {
    context: clone(runtime),
    path,
    bundle_root: runtimeBundleFilesRoot(commonDir, runtime.bundle.bundle_sha256),
    status: result,
  };
}

export async function readRuntimeContext({ gitCommonDirectory, runtimeId }) {
  const { commonDir } = await prepareRuntimeRoot(gitCommonDirectory);
  const path = runtimeContextPath(commonDir, runtimeId);
  const context = validateRuntimeContext(await readJson(path, { guardRoot: commonDir }));
  assertRuntimeCommonDirectory(context, commonDir);
  if (context.runtime_id !== runtimeId) {
    throw new CliError("runtime context.runtime_id does not match the requested runtimeId");
  }
  await verifyRuntimeSnapshot(commonDir, context);
  return {
    context: clone(context),
    path,
    bundle_root: runtimeBundleFilesRoot(commonDir, context.bundle.bundle_sha256),
  };
}

export async function readRuntimeBundleSnapshot({ gitCommonDirectory, runtimeId }) {
  const { context } = await readRuntimeContext({ gitCommonDirectory, runtimeId });
  return verifyRuntimeSnapshot(validateAbsolutePath(gitCommonDirectory, "gitCommonDirectory"), context);
}
