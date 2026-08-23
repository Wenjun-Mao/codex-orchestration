import { basename, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireNullableText,
  requireText,
} from "./core.mjs";

export const REASONING_EFFORTS = [
  null, "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
];

export function orchestrationRoot(gitRoot) {
  return resolve(gitRoot, ".codex", "orchestration");
}

export function projectConfigPath(gitRoot) {
  return resolve(orchestrationRoot(gitRoot), "project.json");
}

export function inferProjectId(gitRoot) {
  const raw = basename(gitRoot).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (raw === "") throw new CliError("Could not infer a safe project id");
  return raw;
}

export function defaultProjectConfig(gitRoot, overrides = {}) {
  return {
    schema_version: 1,
    project_id: overrides.projectId ?? inferProjectId(gitRoot),
    max_parallel_executors: overrides.maxParallelExecutors ?? 2,
    callback_transport: "codex-queue",
    default_model: overrides.defaultModel === undefined ? "gpt-5.6-terra" : overrides.defaultModel,
    default_reasoning_effort: overrides.defaultReasoningEffort === undefined
      ? "xhigh"
      : overrides.defaultReasoningEffort,
  };
}

export function validateProjectConfig(value) {
  const fields = [
    "schema_version",
    "project_id",
    "max_parallel_executors",
    "callback_transport",
    "default_model",
    "default_reasoning_effort",
  ];
  requireExactFields(value, { required: fields }, "Project configuration");
  if (value.schema_version !== 1) throw new CliError("Unsupported project schema_version");
  requireText(value.project_id, "project_id", { max: 128, safeId: true });
  requireInteger(value.max_parallel_executors, "max_parallel_executors", { min: 1, max: 32 });
  requireEnum(value.callback_transport, ["codex-queue"], "callback_transport");
  requireNullableText(value.default_model, "default_model", { max: 128 });
  requireEnum(value.default_reasoning_effort, REASONING_EFFORTS, "default_reasoning_effort");
  return {
    schema_version: 1,
    project_id: value.project_id,
    max_parallel_executors: value.max_parallel_executors,
    callback_transport: value.callback_transport,
    default_model: value.default_model,
    default_reasoning_effort: value.default_reasoning_effort,
  };
}

export async function writeProjectConfig(gitRoot, value) {
  const config = validateProjectConfig(value);
  await atomicWriteJson(projectConfigPath(gitRoot), config, { guardRoot: gitRoot });
  return config;
}
