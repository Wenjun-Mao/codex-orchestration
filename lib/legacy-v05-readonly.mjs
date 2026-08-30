import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  CliError,
  readJson,
  requireObject,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";

export const LEGACY_V05_PACKAGE_VERSION = "0.5.1";
export const LEGACY_V05_STATE_NAMESPACE = "v0.5.1";

const CONTEXT_KIND = "codex-flow-legacy-v05-readonly-context";
const DIGEST = /^[0-9a-f]{64}$/;

function requirePath(value, label) {
  return resolve(requireText(value, label, { max: 4096 }));
}

function legacyStateRoot(commonDir) {
  return resolve(commonDir, "codex-flow", LEGACY_V05_STATE_NAMESPACE);
}

function contextFrom(input) {
  return input?.kind === CONTEXT_KIND ? input : createLegacyV05ReadonlyContext(input);
}

function contextInput(input) {
  return input && typeof input === "object" && "git" in input ? input : { git: input };
}

function safeManagedPath(value, label) {
  const path = requireText(value, label, { max: 1024 });
  if (
    path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new CliError(`${label} is not a safe legacy managed path`);
  return path;
}

async function optionalBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fileInventory(root) {
  const inventory = {};
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Legacy authority contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const key = relative(root, path).split(sep).join("/");
        inventory[key] = sha256(await readFile(path));
      } else throw new CliError(`Legacy authority contains an unsupported filesystem entry: ${path}`);
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(inventory).sort(([left], [right]) => left.localeCompare(right)));
}

function validateLegacyProject(value) {
  requireObject(value, "Legacy v0.5.1 project configuration");
  if (value.schema_version !== 4) {
    throw new CliError("Legacy v0.5.1 project configuration must use schema version 4");
  }
  requireText(value.project_id, "Legacy project_id", { max: 128, safeId: true });
  requireObject(value.agents_integration, "Legacy agents_integration");
  return JSON.parse(stableStringify(value));
}

function validateManifest(value) {
  requireObject(value, "Legacy v0.5.1 version manifest");
  if (value.schema_version !== 1 || value.package_version !== LEGACY_V05_PACKAGE_VERSION) {
    throw new CliError("Tracked predecessor manifest must identify exact Codex Flow v0.5.1");
  }
  requireObject(value.files, "Legacy version manifest files");
  const files = {};
  for (const [rawPath, rawHash] of Object.entries(value.files)) {
    const path = safeManagedPath(rawPath, "Legacy version manifest path");
    if (typeof rawHash !== "string" || !DIGEST.test(rawHash)) {
      throw new CliError(`Legacy version manifest hash is invalid: ${path}`);
    }
    files[path] = rawHash;
  }
  return {
    schema_version: 1,
    package_version: LEGACY_V05_PACKAGE_VERSION,
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function matchingManagedBlockVersion(contents) {
  const starts = [...contents.matchAll(/<!-- codex-flow:start v([^\s]+) -->/g)];
  const ends = [...contents.matchAll(/<!-- codex-flow:end -->/g)];
  if (starts.length === 1 && ends.length === 1 && starts[0].index < ends[0].index) return starts[0][1];
  return null;
}

export function createLegacyV05ReadonlyContext(input) {
  const options = contextInput(input);
  requireObject(options, "Legacy v0.5.1 context options");
  requireObject(options.git, "Legacy v0.5.1 context git");
  const packageVersion = options.packageVersion
    ?? options.package_version
    ?? LEGACY_V05_PACKAGE_VERSION;
  if (packageVersion !== LEGACY_V05_PACKAGE_VERSION) {
    throw new CliError(
      `Legacy historical verification only accepts package version ${LEGACY_V05_PACKAGE_VERSION}`,
    );
  }
  const root = requirePath(options.git.root, "Legacy v0.5.1 Git root");
  const commonDir = requirePath(options.git.commonDir, "Legacy v0.5.1 Git common directory");
  const expectedStateRoot = legacyStateRoot(commonDir);
  const requestedStateRoot = options.stateRoot === undefined && options.state_root === undefined
    ? expectedStateRoot
    : requirePath(options.stateRoot ?? options.state_root, "Legacy v0.5.1 state root");
  if (requestedStateRoot !== expectedStateRoot) {
    throw new CliError(`Legacy historical verification state root must be ${expectedStateRoot}`);
  }
  return Object.freeze({
    kind: CONTEXT_KIND,
    package_authority: Object.freeze({
      package: "@wjmao/codex-flow",
      package_version: LEGACY_V05_PACKAGE_VERSION,
    }),
    state_authority: Object.freeze({
      namespace: LEGACY_V05_STATE_NAMESPACE,
      state_root: expectedStateRoot,
    }),
    git: Object.freeze({ ...options.git, root, commonDir, stateRoot: expectedStateRoot }),
  });
}

async function readRuntimeAuthority(context, errors) {
  const managedRoot = resolve(context.git.root, ".codex", "orchestration");
  let manifest;
  try {
    manifest = validateManifest(await readJson(resolve(managedRoot, "version.json"), {
      guardRoot: context.git.root,
    }));
  } catch (error) {
    errors.push(error.message);
    return { installed: false, package_version: null, drift: [], unexpected: [] };
  }
  const inventory = await fileInventory(managedRoot);
  const expected = new Set(["project.json", "version.json", ...Object.keys(manifest.files)]);
  const drift = [];
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!Object.hasOwn(inventory, path)) drift.push({ path, state: "missing" });
    else if (inventory[path] !== hash) drift.push({ path, state: "modified" });
  }
  const unexpected = Object.keys(inventory).filter((path) => !expected.has(path)).sort();
  if (drift.length > 0) errors.push("Pinned codex-flow runtime has managed-file drift");
  if (unexpected.length > 0) errors.push("Pinned codex-flow runtime contains unowned files");
  return {
    installed: true,
    package_version: manifest.package_version,
    manifest_sha256: sha256(stableStringify(manifest)),
    drift,
    unexpected,
  };
}

async function readAgentsAuthority(context, project, errors, warnings) {
  if (!project) return { mode: "unconfigured", status: "unknown" };
  const integration = project.agents_integration;
  if (integration.mode === "external") {
    const path = safeManagedPath(integration.path, "Legacy external instruction path");
    const bytes = await optionalBytes(resolve(context.git.root, path));
    const verified = bytes !== null && sha256(bytes) === integration.sha256;
    if (!verified) errors.push("Legacy external instruction attestation has drifted");
    return {
      mode: "external",
      status: verified ? "verified" : "drifted",
      path,
      contract_version: integration.contract_version,
    };
  }
  const bytes = await optionalBytes(resolve(context.git.root, "AGENTS.md"));
  if (bytes === null) {
    warnings.push("Historical managed AGENTS.md is absent");
    return { mode: "managed", status: "missing", path: "AGENTS.md" };
  }
  const version = matchingManagedBlockVersion(bytes.toString("utf8"));
  if (version !== LEGACY_V05_PACKAGE_VERSION) {
    errors.push("Historical AGENTS.md does not contain the exact v0.5.1 managed block");
    return { mode: "managed", status: "drifted", path: "AGENTS.md" };
  }
  return { mode: "managed", status: "verified", path: "AGENTS.md" };
}

export async function readLegacyV05ReadonlySummary(input) {
  const context = contextFrom(input);
  const errors = [];
  const warnings = [];
  let project = null;
  try {
    project = validateLegacyProject(await readJson(
      resolve(context.git.root, ".codex", "orchestration", "project.json"),
      { guardRoot: context.git.root },
    ));
  } catch (error) {
    errors.push(error.message);
  }
  const runtime = await readRuntimeAuthority(context, errors);
  const agents = await readAgentsAuthority(context, project, errors, warnings);
  const stateFiles = await fileInventory(context.git.stateRoot);
  return {
    ok: errors.length === 0,
    mutation_performed: false,
    package_authority: context.package_authority,
    state_authority: context.state_authority,
    repository_authority: {
      root: context.git.root,
      common_dir: context.git.commonDir,
      branch: context.git.branch ?? null,
      revision: context.git.revision ?? null,
      cleanliness: context.git.cleanliness ?? null,
    },
    project,
    runtime,
    agents,
    state_inventory: {
      file_count: Object.keys(stateFiles).length,
      tree_sha256: sha256(stableStringify(stateFiles)),
      files: stateFiles,
    },
    errors,
    warnings,
  };
}

export const legacyV05ReadonlyContext = createLegacyV05ReadonlyContext;
export const legacyV05ReadonlySummary = readLegacyV05ReadonlySummary;
