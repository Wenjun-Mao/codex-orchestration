import { isAbsolute, join, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  ensureDirectory,
  ensureExactJson,
  readJson,
  requireExactFields,
  requireInteger,
  requireObject,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";

export const V06_RUNTIME_SCHEMA_VERSION = 1;
export const V06_RUNTIME_KIND = "codex-flow-v06-runtime-context";
export const V06_RUNTIME_DIRECTORY = "v0.6";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const REVISION = /^[0-9a-f]{40,64}$/;

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

function validateConfig(value) {
  requireExactFields(value, {
    required: ["config_id", "snapshot"],
  }, "runtime.config");
  return {
    config_id: requireText(value.config_id, "runtime.config.config_id", { max: 128, safeId: true }),
    snapshot: cloneJsonObject(value.snapshot, "runtime.config.snapshot"),
  };
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
      "schema_version", "kind", "runtime_id", "created_at", "config",
      "repository", "host", "lineage",
    ],
  }, "runtime context");
  if (value.schema_version !== V06_RUNTIME_SCHEMA_VERSION) {
    throw new CliError(`runtime context.schema_version must be ${V06_RUNTIME_SCHEMA_VERSION}`);
  }
  if (value.kind !== V06_RUNTIME_KIND) {
    throw new CliError(`runtime context.kind must be ${V06_RUNTIME_KIND}`);
  }
  return {
    schema_version: V06_RUNTIME_SCHEMA_VERSION,
    kind: V06_RUNTIME_KIND,
    runtime_id: requireText(value.runtime_id, "runtime context.runtime_id", {
      max: 128,
      safeId: true,
    }),
    created_at: validateTimestamp(value.created_at, "runtime context.created_at"),
    config: validateConfig(value.config),
    repository: validateRepository(value.repository),
    host: validateRuntimeHost(value.host),
    lineage: validateRuntimeLineage(value.lineage),
  };
}

export function buildRuntimeContext({
  runtimeId,
  createdAt,
  config,
  repository,
  host,
  lineage,
}) {
  return validateRuntimeContext({
    schema_version: V06_RUNTIME_SCHEMA_VERSION,
    kind: V06_RUNTIME_KIND,
    runtime_id: runtimeId,
    created_at: createdAt,
    config,
    repository,
    host,
    lineage,
  });
}

export function v06RuntimeRoot(gitCommonDirectory) {
  return join(validateAbsolutePath(gitCommonDirectory, "gitCommonDirectory"), "codex-flow", V06_RUNTIME_DIRECTORY);
}

export function runtimeContextPath(gitCommonDirectory, runtimeId) {
  const safeRuntimeId = requireText(runtimeId, "runtimeId", { max: 128, safeId: true });
  return join(v06RuntimeRoot(gitCommonDirectory), "runtimes", safeRuntimeId, "runtime.json");
}

function runtimeLockPath(gitCommonDirectory) {
  return join(v06RuntimeRoot(gitCommonDirectory), "locks", "runtime-context.lock");
}

function clone(value) {
  return JSON.parse(stableStringify(value));
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
  const root = v06RuntimeRoot(commonDir);
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
    config_hash: sha256(stableStringify(context.config)),
    repository_hash: sha256(stableStringify(context.repository)),
    host: clone(context.host),
    lineage: clone(context.lineage),
  };
}

export async function acquireRuntimeContext({ gitCommonDirectory, context }) {
  const runtime = validateRuntimeContext(context);
  const { commonDir } = await prepareRuntimeRoot(gitCommonDirectory);
  assertRuntimeCommonDirectory(runtime, commonDir);
  const path = runtimeContextPath(commonDir, runtime.runtime_id);
  const result = await withProcessLock({
    path: runtimeLockPath(commonDir),
    guardRoot: commonDir,
    label: "v0.6 runtime context acquisition",
  }, async () => ensureExactJson(path, runtime, {
    guardRoot: commonDir,
    mode: 0o600,
  }));
  return {
    context: clone(runtime),
    path,
    status: result,
  };
}

export async function readRuntimeContext({ gitCommonDirectory, runtimeId }) {
  const { commonDir } = await prepareRuntimeRoot(gitCommonDirectory);
  const path = runtimeContextPath(commonDir, runtimeId);
  const context = validateRuntimeContext(await readJson(path, { guardRoot: commonDir }));
  assertRuntimeCommonDirectory(context, commonDir);
  return {
    context: clone(context),
    path,
  };
}
