import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readdir, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "../core.mjs";
import {
  gitBranchAvailability,
  gitCommonDirectoryForState,
  gitSnapshot,
} from "../git.mjs";
import { readRun } from "../run-lifecycle.mjs";
import {
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
} from "../runtime-context.mjs";
import {
  assertWorkflowTaskContractCurrent,
  workflowTaskContractStartability,
} from "../workflow-journal.mjs";
import { validateGeneratedTaskContract } from "../workflow-plan.mjs";

export const TASK_LAUNCH_SCHEMA_VERSION = 1;
export const TASK_LAUNCH_KIND = "codex-flow-v09-task-launch";
export const TASK_LAUNCH_OPERATION_KIND = "task-launch";

const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const STATUSES = [
  "prepared",
  "attempting",
  "awaiting-start",
  "active",
  "terminal-no-object",
  "ambiguous",
  "session-blocked",
];
const CREATION_CLASSIFICATIONS = ["ready", "provisional", "opaque"];
const TERMINAL_REASONS = {
  "terminal-no-object": ["selector-rejected-before-task-identity"],
  ambiguous: [
    "host-result-ambiguous",
    "transport-failure",
    "start-claim-missing-after-deadline",
    "identity-evidence-missing",
  ],
  "session-blocked": [
    "argument-serialization",
    "adapter-unavailable",
    "backend-unavailable",
    "schema-runtime-drift",
    "host-control-failure",
  ],
};

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function nowIso(now = Date.now()) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Task-launch clock must be finite");
  return new Date(milliseconds).toISOString();
}

function requireDigest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function requireRevision(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!REVISION.test(result)) throw new CliError(`${label} must be a concrete lowercase Git revision`);
  return result;
}

function requireTimestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
}

function requireAbsolutePath(value, label) {
  const result = requireText(value, label, { max: 4096 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function requireBranch(value, label) {
  const result = requireText(value, label, { max: 256 });
  if (
    result.includes("\\")
    || /\s/.test(result)
    || result.startsWith("-")
    || result.endsWith(".")
    || result.includes("..")
    || result.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new CliError(`${label} must be a normalized Git branch name`);
  return result;
}

function nullableText(value, label, options = {}) {
  return value === null ? null : requireText(value, label, options);
}

function validateCoordinatorBinding(value, label = "coordinator_binding") {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const identity = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1, max: 2147483647 }),
  };
  const bindingDigest = sha256(stableStringify(identity));
  if (value.binding_digest !== bindingDigest) {
    throw new CliError(`${label}.binding_digest does not match its identity`);
  }
  return { ...identity, binding_digest: bindingDigest };
}

function validateRequestedWorktree(value, baselineRevision, label = "requested_selectors.worktree") {
  requireExactFields(value, {
    required: ["mode", "starting_revision", "starting_branch", "executor_branch", "path"],
  }, label);
  const worktree = {
    mode: requireEnum(value.mode, ["host-worktree"], `${label}.mode`),
    starting_revision: requireRevision(value.starting_revision, `${label}.starting_revision`),
    starting_branch: requireBranch(value.starting_branch, `${label}.starting_branch`),
    executor_branch: requireBranch(value.executor_branch, `${label}.executor_branch`),
    path: value.path === null ? null : requireAbsolutePath(value.path, `${label}.path`),
  };
  if (worktree.path !== null) throw new CliError(`${label}.path must be null before executor start`);
  if (worktree.starting_revision !== baselineRevision) {
    throw new CliError(`${label}.starting_revision must match the task contract baseline`);
  }
  if (worktree.starting_branch === worktree.executor_branch) {
    throw new CliError(`${label}.executor_branch must differ from starting_branch`);
  }
  return worktree;
}

function validateRequestedSelectors(value, baselineRevision, label = "requested_selectors") {
  requireExactFields(value, {
    required: ["project_id", "model", "reasoning_effort", "worktree"],
  }, label);
  return {
    project_id: requireText(value.project_id, `${label}.project_id`, { max: 128, safeId: true }),
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: requireEnum(value.reasoning_effort, REASONING_EFFORTS, `${label}.reasoning_effort`),
    worktree: validateRequestedWorktree(value.worktree, baselineRevision, `${label}.worktree`),
  };
}

function validateSelector(value, label, { nullableFields = false } = {}) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["project_id", "model", "reasoning_effort", "observed_at"],
  }, label);
  return {
    project_id: nullableFields
      ? nullableText(value.project_id, `${label}.project_id`, { max: 128, safeId: true })
      : requireText(value.project_id, `${label}.project_id`, { max: 128, safeId: true }),
    model: nullableFields
      ? nullableText(value.model, `${label}.model`, { max: 128 })
      : requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: value.reasoning_effort === null && nullableFields
      ? null
      : requireEnum(value.reasoning_effort, REASONING_EFFORTS, `${label}.reasoning_effort`),
    observed_at: requireTimestamp(value.observed_at, `${label}.observed_at`),
  };
}

function validateSelectorEvidence(value, requested, label = "selector_evidence") {
  requireExactFields(value, { required: ["requested", "accepted", "observed"] }, label);
  if (stableStringify(value.requested) !== stableStringify(requested)) {
    throw new CliError(`${label}.requested does not match launch authority`);
  }
  const accepted = validateSelector(value.accepted, `${label}.accepted`);
  const observed = validateSelector(value.observed, `${label}.observed`, { nullableFields: true });
  for (const evidence of [accepted, observed]) {
    if (evidence === null) continue;
    for (const field of ["project_id", "model", "reasoning_effort"]) {
      if (evidence[field] !== null && evidence[field] !== requested[field]) {
        throw new CliError(`${label}.${field} conflicts with the requested selector`);
      }
    }
  }
  return { requested: clone(requested), accepted, observed };
}

function validateAttempt(value, launchId) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["attempt_id", "host_session_id", "started_at", "reconcile_by"],
  }, "task launch attempt");
  const attempt = {
    attempt_id: requireText(value.attempt_id, "attempt_id", { max: 128, safeId: true }),
    host_session_id: requireText(value.host_session_id, "host_session_id", { max: 128, safeId: true }),
    started_at: requireTimestamp(value.started_at, "attempt.started_at"),
    reconcile_by: requireTimestamp(value.reconcile_by, "attempt.reconcile_by"),
  };
  if (attempt.attempt_id !== `task-launch-attempt-v1-${sha256(`${launchId}:1`)}`) {
    throw new CliError("Task launch attempt_id is invalid");
  }
  if (Date.parse(attempt.reconcile_by) <= Date.parse(attempt.started_at)) {
    throw new CliError("Task launch reconcile_by must follow started_at");
  }
  return attempt;
}

function validateCreationEvidence(value, label = "creation_evidence") {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "classification", "host_id", "ready_thread_id",
      "provisional_id", "opaque_digest", "opaque_length", "observed_at",
    ],
  }, label);
  if (value.schema_version !== 1 || value.kind !== "codex-flow-native-creation-evidence-v1") {
    throw new CliError(`${label} has unsupported authority`);
  }
  const evidence = {
    schema_version: 1,
    kind: "codex-flow-native-creation-evidence-v1",
    classification: requireEnum(value.classification, CREATION_CLASSIFICATIONS, `${label}.classification`),
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    ready_thread_id: nullableText(value.ready_thread_id, `${label}.ready_thread_id`, {
      max: 256,
      safeId: true,
    }),
    provisional_id: nullableText(
      value.provisional_id,
      `${label}.provisional_id`,
      { max: 256 },
    ),
    opaque_digest: value.opaque_digest === null
      ? null
      : requireDigest(value.opaque_digest, `${label}.opaque_digest`),
    opaque_length: value.opaque_length === null
      ? null
      : requireInteger(value.opaque_length, `${label}.opaque_length`, { min: 0, max: 16_384 }),
    observed_at: requireTimestamp(value.observed_at, `${label}.observed_at`),
  };
  const shape = evidence.classification;
  if (shape === "ready" && (
    evidence.ready_thread_id === null
    || evidence.provisional_id !== null
    || evidence.opaque_digest !== null
    || evidence.opaque_length !== null
  )) throw new CliError(`${label} ready classification has inconsistent fields`);
  if (shape === "provisional" && (
    evidence.ready_thread_id !== null
    || evidence.provisional_id === null
    || evidence.opaque_digest !== null
    || evidence.opaque_length !== null
  )) throw new CliError(`${label} provisional classification has inconsistent fields`);
  if (shape === "opaque" && (
    evidence.ready_thread_id !== null
    || evidence.provisional_id !== null
    || evidence.opaque_digest === null
    || evidence.opaque_length === null
  )) throw new CliError(`${label} opaque classification has inconsistent fields`);
  return evidence;
}

function validateStartClaim(value, label = "start_claim") {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["executor_thread_id", "identity_source", "launch_nonce_digest", "claimed_at"],
  }, label);
  return {
    executor_thread_id: requireText(value.executor_thread_id, `${label}.executor_thread_id`, {
      max: 256,
      safeId: true,
    }),
    identity_source: requireEnum(value.identity_source, ["host-environment"], `${label}.identity_source`),
    launch_nonce_digest: requireDigest(value.launch_nonce_digest, `${label}.launch_nonce_digest`),
    claimed_at: requireTimestamp(value.claimed_at, `${label}.claimed_at`),
  };
}

function activationSeed(value) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    launch_id: value.launch_id,
    worktree_path: value.worktree_path,
    common_dir: value.common_dir,
    executor_branch: value.executor_branch,
    baseline_revision: value.baseline_revision,
  };
}

function validateActivation(value, label = "git_activation") {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "activation_id", "launch_id", "worktree_path",
      "common_dir", "executor_branch", "baseline_revision", "state", "prepared_at",
      "completed_at",
    ],
  }, label);
  if (value.schema_version !== 1 || value.kind !== "codex-flow-task-launch-git-activation-v1") {
    throw new CliError(`${label} has unsupported authority`);
  }
  const activation = {
    schema_version: 1,
    kind: "codex-flow-task-launch-git-activation-v1",
    activation_id: requireText(value.activation_id, `${label}.activation_id`, { max: 128, safeId: true }),
    launch_id: requireText(value.launch_id, `${label}.launch_id`, { max: 128, safeId: true }),
    worktree_path: requireAbsolutePath(value.worktree_path, `${label}.worktree_path`),
    common_dir: requireAbsolutePath(value.common_dir, `${label}.common_dir`),
    executor_branch: requireBranch(value.executor_branch, `${label}.executor_branch`),
    baseline_revision: requireRevision(value.baseline_revision, `${label}.baseline_revision`),
    state: requireEnum(value.state, ["prepared", "completed"], `${label}.state`),
    prepared_at: requireTimestamp(value.prepared_at, `${label}.prepared_at`),
    completed_at: value.completed_at === null
      ? null
      : requireTimestamp(value.completed_at, `${label}.completed_at`),
  };
  if (activation.activation_id !== `task-launch-activation-v1-${sha256(stableStringify(activationSeed(activation)))}`) {
    throw new CliError(`${label}.activation_id does not match its immutable Git intent`);
  }
  if ((activation.state === "completed") !== (activation.completed_at !== null)) {
    throw new CliError(`${label}.state and completed_at are inconsistent`);
  }
  if (activation.completed_at !== null && Date.parse(activation.completed_at) < Date.parse(activation.prepared_at)) {
    throw new CliError(`${label}.completed_at predates prepared_at`);
  }
  return activation;
}

function validateResolution(value, label = "resolution") {
  if (value === null) return null;
  requireExactFields(value, { required: ["outcome", "reason_code", "recorded_at"] }, label);
  const outcome = requireEnum(value.outcome, Object.keys(TERMINAL_REASONS), `${label}.outcome`);
  return {
    outcome,
    reason_code: requireEnum(value.reason_code, TERMINAL_REASONS[outcome], `${label}.reason_code`),
    recorded_at: requireTimestamp(value.recorded_at, `${label}.recorded_at`),
  };
}

function launchSeed(record) {
  return {
    schema_version: record.schema_version,
    kind: record.kind,
    run_id: record.run_id,
    runtime_context_digest: record.runtime_context_digest,
    configuration_digest: record.configuration_digest,
    repository_id: record.repository_id,
    common_dir: record.common_dir,
    coordinator_binding: record.coordinator_binding,
    plan_id: record.plan_id,
    revision_digest: record.revision_digest,
    task_id: record.task_id,
    task_digest: record.task_digest,
    contract_id: record.contract_id,
    task_title: record.task_title,
    selector_rationale: record.selector_rationale,
    requested_selectors: record.selector_evidence.requested,
  };
}

function launchIdFor(record) {
  return `task-launch-v1-${sha256(stableStringify(launchSeed(record)))}`;
}

function expectedStatus(record) {
  if (record.resolution !== null) return record.resolution.outcome;
  if (record.start_claim !== null && record.git_activation?.state === "completed") return "active";
  if (record.creation_evidence !== null) return "awaiting-start";
  if (record.attempt !== null) return "attempting";
  return "prepared";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function renderInitialPrompt(record) {
  const contract = stableStringify(record.task_contract, 2);
  return [
    "# Codex Flow v0.9 executor assignment",
    "",
    `Launch: ${record.launch_id}`,
    `Contract: ${record.contract_id}`,
    `CODEX_FLOW_LAUNCH_NONCE=${record.launch_nonce}`,
    "",
    "Before inspecting or modifying repository files, run this exact activation command:",
    "",
    "```sh",
    record.task_start_command,
    "```",
    "",
    "When activation succeeds, invoke `codex-orchestration:execute` and begin the assignment below in this same turn.",
    "Do not wait for a second coordinator message. Stay within this exact contract and use its run-bound runtime for lifecycle commands.",
    "",
    "## Generated task contract",
    "",
    "```json",
    contract,
    "```",
    "",
  ].join("\n");
}

export function validateTaskLaunchRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "launch_id", "run_id", "runtime_context_digest",
      "configuration_digest", "repository_id", "common_dir", "coordinator_binding",
      "plan_id", "revision_digest", "task_id", "task_digest", "contract_id",
      "task_title", "selector_rationale", "task_contract", "launch_nonce",
      "task_start_command", "initial_prompt_digest", "selector_evidence", "status",
      "attempt", "creation_evidence", "start_claim", "git_activation", "resolution",
      "prepared_at", "updated_at",
    ],
  }, "task launch record");
  if (value.schema_version !== TASK_LAUNCH_SCHEMA_VERSION || value.kind !== TASK_LAUNCH_KIND) {
    throw new CliError("Unsupported v0.9 task launch record");
  }
  const contract = validateGeneratedTaskContract(value.task_contract);
  const requested = validateRequestedSelectors(value.selector_evidence?.requested, contract.current_baseline.revision);
  const record = {
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    launch_id: requireText(value.launch_id, "launch_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_context_digest: requireDigest(value.runtime_context_digest, "runtime_context_digest"),
    configuration_digest: requireDigest(value.configuration_digest, "configuration_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: requireAbsolutePath(value.common_dir, "common_dir"),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task_digest"),
    contract_id: requireDigest(value.contract_id, "contract_id"),
    task_title: requireText(value.task_title, "task_title", { max: 160 }),
    selector_rationale: requireText(value.selector_rationale, "selector_rationale", { max: 512 }),
    task_contract: contract,
    launch_nonce: requireDigest(value.launch_nonce, "launch_nonce"),
    task_start_command: requireText(value.task_start_command, "task_start_command", { max: 8192 }),
    initial_prompt_digest: requireDigest(value.initial_prompt_digest, "initial_prompt_digest"),
    selector_evidence: validateSelectorEvidence(value.selector_evidence, requested),
    status: requireEnum(value.status, STATUSES, "status"),
    attempt: null,
    creation_evidence: validateCreationEvidence(value.creation_evidence),
    start_claim: validateStartClaim(value.start_claim),
    git_activation: validateActivation(value.git_activation),
    resolution: validateResolution(value.resolution),
    prepared_at: requireTimestamp(value.prepared_at, "prepared_at"),
    updated_at: requireTimestamp(value.updated_at, "updated_at"),
  };
  record.attempt = validateAttempt(value.attempt, record.launch_id);
  const contractIdentity = {
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: contract.coordinator_binding,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
  };
  for (const [field, expected] of Object.entries(contractIdentity)) {
    if (stableStringify(record[field]) !== stableStringify(expected)) {
      throw new CliError(`Task launch ${field} does not match its generated contract`);
    }
  }
  if (contract.task.execution_kind !== "task-thread") {
    throw new CliError("Task launch requires a task-thread generated contract");
  }
  if (
    requested.model !== contract.task.model
    || requested.reasoning_effort !== contract.task.reasoning_effort
    || record.task_title !== contract.task.title
    || record.selector_rationale !== contract.task.selector_rationale
  ) throw new CliError("Task launch selector or title authority does not match its generated contract");
  if (record.launch_id !== launchIdFor(record)) {
    throw new CliError("launch_id does not match the task contract and requested selectors");
  }
  if (!record.task_start_command.includes(`--launch-id ${shellQuote(record.launch_id)}`)) {
    throw new CliError("task_start_command does not bind the exact launch_id");
  }
  if (!record.task_start_command.includes(`--nonce ${shellQuote(record.launch_nonce)}`)) {
    throw new CliError("task_start_command does not bind the exact launch nonce");
  }
  if (record.initial_prompt_digest !== sha256(renderInitialPrompt(record))) {
    throw new CliError("initial_prompt_digest does not match the canonical first assignment prompt");
  }
  if (record.status !== expectedStatus(record)) {
    throw new CliError("Task launch status does not match its lifecycle evidence");
  }
  if (Date.parse(record.updated_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Task launch updated_at predates prepared_at");
  }
  if (record.attempt === null && (
    record.creation_evidence !== null
    || record.start_claim !== null
    || record.git_activation !== null
    || record.resolution !== null
  )) throw new CliError("Task launch host evidence requires the one-shot attempt");
  if (record.attempt !== null && Date.parse(record.attempt.started_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Task launch attempt predates preparation");
  }
  for (const evidence of [record.creation_evidence, record.selector_evidence.accepted, record.selector_evidence.observed]) {
    if (evidence === null || record.attempt === null) continue;
    const observedAt = evidence.observed_at;
    if (
      Date.parse(observedAt) < Date.parse(record.attempt.started_at)
      || Date.parse(observedAt) >= Date.parse(record.attempt.reconcile_by)
    ) throw new CliError("Task launch host evidence falls outside the one-shot window");
  }
  if (record.start_claim !== null) {
    if (record.attempt === null) throw new CliError("Task launch start claim requires the one-shot attempt");
    if (record.start_claim.launch_nonce_digest !== sha256(record.launch_nonce)) {
      throw new CliError("Task launch start claim does not match the launch nonce");
    }
    if (
      Date.parse(record.start_claim.claimed_at) < Date.parse(record.attempt.started_at)
      || Date.parse(record.start_claim.claimed_at) >= Date.parse(record.attempt.reconcile_by)
    ) throw new CliError("Task launch start claim falls outside the one-shot window");
  }
  if ((record.start_claim === null) !== (record.git_activation === null)) {
    throw new CliError("Task launch identity and Git activation intent must be persisted together");
  }
  if (record.git_activation !== null) {
    const requestedWorktree = record.selector_evidence.requested.worktree;
    if (
      record.git_activation.launch_id !== record.launch_id
      || record.git_activation.common_dir !== record.common_dir
      || record.git_activation.executor_branch !== requestedWorktree.executor_branch
      || record.git_activation.baseline_revision !== requestedWorktree.starting_revision
    ) throw new CliError("Task launch Git activation does not match launch authority");
  }
  if (
    record.creation_evidence?.classification === "ready"
    && record.start_claim !== null
    && record.creation_evidence.ready_thread_id !== record.start_claim.executor_thread_id
  ) throw new CliError("Host-returned task ID contradicts the executor start claim");
  if (record.resolution !== null && (
    record.creation_evidence !== null || record.start_claim !== null || record.git_activation !== null
  )) throw new CliError("Terminal task launch resolution cannot coexist with created-object evidence");
  if (record.resolution?.outcome === "terminal-no-object" && (
    record.selector_evidence.accepted !== null || record.selector_evidence.observed !== null
  )) throw new CliError("Selector rejection cannot claim accepted or observed selectors");
  return record;
}

function paths(stateRoot, launchId, contractId = null) {
  const records = resolve(stateRoot, "task-launches", "records");
  const claims = resolve(stateRoot, "task-launches", "claims");
  return {
    records,
    claims,
    record: resolve(records, `${launchId}.json`),
    claim: contractId === null ? null : resolve(claims, `${contractId}.json`),
    operation_lock: resolve(stateRoot, "locks", `task-launch-${launchId}.lock`),
  };
}

function branchLock(stateRoot, branch) {
  return resolve(stateRoot, "locks", `task-launch-branch-${sha256(branch)}.lock`);
}

async function readRecord(stateRoot, launchId) {
  const raw = await readJson(paths(stateRoot, launchId).record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (raw === null) throw new CliError("Task launch does not exist");
  return validateTaskLaunchRecord(raw);
}

async function writeRecord(stateRoot, record) {
  const validated = validateTaskLaunchRecord(record);
  await atomicWriteJson(paths(stateRoot, validated.launch_id).record, validated, {
    guardRoot: guardRoot(stateRoot),
  });
  return validated;
}

async function listLaunchRecords(stateRoot) {
  const directory = paths(stateRoot, "unused").records;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readJson(resolve(directory, entry.name), { guardRoot: guardRoot(stateRoot) });
    const record = validateTaskLaunchRecord(raw);
    if (entry.name !== `${record.launch_id}.json`) {
      throw new CliError("Task-launch record filename does not match launch_id");
    }
    records.push(record);
  }
  return records;
}

function taskStartCommand({ runtimeCliPath, runId, launchId, launchNonce }) {
  return [
    "node",
    shellQuote(runtimeCliPath),
    "task launch start",
    `--run-id ${shellQuote(runId)}`,
    `--launch-id ${shellQuote(launchId)}`,
    `--nonce ${shellQuote(launchNonce)}`,
    "--json",
  ].join(" ");
}

async function activeRuntimeAuthority(stateRoot, contract) {
  const commonDir = guardRoot(stateRoot);
  const { run } = await readRun({ gitCommonDirectory: commonDir, runId: contract.run_id });
  if (run.status !== "active") throw new CliError("Task launch requires its exact active run", 73);
  const { context } = await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: run.runtime_id,
  });
  const binding = runtimeBindingFromContext(context);
  if (
    runtimeContextHash(context) !== run.runtime_context_hash
    || binding.runtime_context_hash !== contract.runtime_context_digest
    || binding.config_hash !== contract.configuration_digest
    || binding.repository_hash !== contract.repository_id
    || context.repository.common_dir !== contract.common_dir
  ) throw new CliError("Task launch run/runtime/repository authority is inconsistent", 73);
  const runtimeCliPath = resolve(
    stateRoot,
    "runtimes",
    run.binding.bundle_hash,
    "files",
    "bin",
    "codex-flow.mjs",
  );
  await access(runtimeCliPath).catch(() => {
    throw new CliError("Task launch run-bound CLI snapshot is missing", 73);
  });
  return { run, context, runtimeCliPath };
}

function worktreeInventory(commonDir) {
  const result = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: commonDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new CliError(String(result.stderr || result.stdout).trim() || "Unable to inspect Git worktrees");
  }
  return result.stdout.split("\0\0").filter(Boolean).map((block) => {
    const fields = block.split("\0").filter(Boolean);
    const pathField = fields.find((field) => field.startsWith("worktree "));
    const headField = fields.find((field) => field.startsWith("HEAD "));
    if (!pathField || !headField) throw new CliError("Git worktree inventory is incomplete");
    const branchField = fields.find((field) => field.startsWith("branch "));
    return {
      path: resolve(pathField.slice("worktree ".length)),
      head: requireRevision(headField.slice("HEAD ".length), "worktree HEAD"),
      branch_ref: branchField ? branchField.slice("branch ".length) : null,
      detached: fields.includes("detached"),
      bare: fields.includes("bare"),
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      prunable: fields.some((field) => field === "prunable" || field.startsWith("prunable ")),
    };
  });
}

function localBranchTip(commonDir, branch) {
  const result = spawnSync("git", ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], {
    cwd: commonDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status === 128) return null;
  if (result.status !== 0) throw new CliError("Unable to authenticate executor branch tip");
  return result.stdout.trim();
}

async function assertBranchReservation(stateRoot, contract, requested, { currentLaunchId = null } = {}) {
  const branch = requested.worktree.executor_branch;
  const authority = await activeRuntimeAuthority(stateRoot, contract);
  if (!authority.run.plan.branch_fences.includes(branch)) {
    throw new CliError(`Executor branch is not an admitted run fence: ${branch}`, 73);
  }
  const retained = (await listLaunchRecords(stateRoot)).filter((record) => (
    record.selector_evidence.requested.worktree.executor_branch === branch
    && record.launch_id !== currentLaunchId
  ));
  if (retained.length > 1) throw new CliError(`Executor branch has multiple task-launch claims: ${branch}`, 73);
  if (retained.length === 1) {
    const predecessor = retained[0];
    if (
      predecessor.run_id !== contract.run_id
      || predecessor.task_id !== contract.task_id
      || predecessor.status !== "terminal-no-object"
      || predecessor.resolution?.reason_code !== "selector-rejected-before-task-identity"
      || predecessor.start_claim !== null
      || predecessor.creation_evidence !== null
      || predecessor.contract_id === contract.contract_id
    ) throw new CliError("Executor branch is retained by a non-reusable task launch", 73);
  }
  const availability = gitBranchAvailability(contract.common_dir, branch);
  if (availability.local_exists || availability.tracked_remote_exists) {
    throw new CliError(`Executor branch collides with live Git state: ${branch}`, 73);
  }
  const branchRef = `refs/heads/${branch}`;
  if (worktreeInventory(contract.common_dir).some((item) => item.branch_ref === branchRef)) {
    throw new CliError(`Executor branch is attached to a live worktree: ${branch}`, 73);
  }
  return authority;
}

export async function preflightTaskLaunchBranchReservations({ stateRoot, tasks }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new CliError("Task-launch preflight requires at least one task");
  }
  const seen = new Set();
  const results = [];
  for (const item of tasks) {
    requireExactFields(item, { required: ["task_contract", "requested_selectors"] }, "task-launch preflight item");
    const contract = validateGeneratedTaskContract(item.task_contract);
    const requested = validateRequestedSelectors(item.requested_selectors, contract.current_baseline.revision);
    const branch = requested.worktree.executor_branch;
    if (seen.has(branch)) throw new CliError(`Task-launch plan repeats executor branch: ${branch}`, 73);
    seen.add(branch);
    await assertBranchReservation(stateRoot, contract, requested);
    results.push({ task_id: contract.task_id, executor_branch: branch, available: true });
  }
  return { classification: "PASS", tasks: results };
}

function initialRecord(contract, requested, launchId, launchNonce, runtimeCliPath, preparedAt) {
  const record = {
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    launch_id: launchId,
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: clone(contract.coordinator_binding),
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
    task_title: contract.task.title,
    selector_rationale: contract.task.selector_rationale,
    task_contract: clone(contract),
    launch_nonce: launchNonce,
    task_start_command: "pending",
    initial_prompt_digest: "0".repeat(64),
    selector_evidence: { requested: clone(requested), accepted: null, observed: null },
    status: "prepared",
    attempt: null,
    creation_evidence: null,
    start_claim: null,
    git_activation: null,
    resolution: null,
    prepared_at: preparedAt,
    updated_at: preparedAt,
  };
  record.task_start_command = taskStartCommand({
    runtimeCliPath,
    runId: contract.run_id,
    launchId,
    launchNonce,
  });
  record.initial_prompt_digest = sha256(renderInitialPrompt(record));
  return validateTaskLaunchRecord(record);
}

function removeExactLaunchState(stateRoot, record, claim) {
  return Promise.all([
    [paths(stateRoot, record.launch_id).record, record],
    [paths(stateRoot, record.launch_id, record.contract_id).claim, claim],
  ].map(async ([path, expected]) => {
    const current = await readJson(path, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    if (current !== null && stableStringify(current) !== stableStringify(expected)) {
      throw new CliError("Task-launch compensation found changed state");
    }
    if (current !== null) await unlink(path);
  }));
}

export async function prepareTaskLaunch({ stateRoot, taskContract, requestedSelectors, now = Date.now() }) {
  const contract = validateGeneratedTaskContract(taskContract);
  if (contract.task.execution_kind !== "task-thread") {
    throw new CliError("Task launch requires a task-thread contract");
  }
  const requested = validateRequestedSelectors(requestedSelectors, contract.current_baseline.revision);
  if (requested.model !== contract.task.model || requested.reasoning_effort !== contract.task.reasoning_effort) {
    throw new CliError("Task launch selectors must match the generated contract");
  }
  const seedRecord = {
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: contract.coordinator_binding,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
    task_title: contract.task.title,
    selector_rationale: contract.task.selector_rationale,
    selector_evidence: { requested },
  };
  const launchId = launchIdFor(seedRecord);
  return withProcessLock({
    path: branchLock(stateRoot, requested.worktree.executor_branch),
    guardRoot: guardRoot(stateRoot),
    label: `task-launch branch ${requested.worktree.executor_branch}`,
  }, async () => withProcessLock({
    path: paths(stateRoot, launchId).operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `task launch ${launchId}`,
  }, async () => {
    const existing = await readJson(paths(stateRoot, launchId).record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing !== null) {
      const record = validateTaskLaunchRecord(existing);
      if (stableStringify(launchSeed(record)) !== stableStringify(launchSeed(seedRecord))) {
        throw new CliError("Existing task launch conflicts with the generated contract", 73);
      }
      const startability = await workflowTaskContractStartability({
        stateRoot,
        runId: contract.run_id,
        planId: contract.plan_id,
        taskContract: contract,
      });
      if (startability.startability !== "exact-replay") {
        throw new CliError("Existing task launch is not an exact workflow replay", 73);
      }
      return taskLaunchView(record);
    }
    await assertWorkflowTaskContractCurrent({
      stateRoot,
      runId: contract.run_id,
      planId: contract.plan_id,
      taskContract: contract,
    });
    const { runtimeCliPath } = await assertBranchReservation(stateRoot, contract, requested);
    const preparedAt = nowIso(now);
    const record = initialRecord(
      contract,
      requested,
      launchId,
      randomBytes(32).toString("hex"),
      runtimeCliPath,
      preparedAt,
    );
    const claim = {
      schema_version: 1,
      kind: "codex-flow-v09-task-launch-claim",
      contract_id: contract.contract_id,
      launch_id: launchId,
      executor_branch: requested.worktree.executor_branch,
      prepared_at: preparedAt,
    };
    const { commitWorkflowOperationPreparation } = await import("../workflow-journal.mjs");
    await commitWorkflowOperationPreparation({
      stateRoot,
      taskLaunchRecord: record,
      persistNative: async () => {
        await ensureExactJson(paths(stateRoot, launchId).record, record, {
          guardRoot: guardRoot(stateRoot),
          mode: 0o600,
        });
        await ensureExactJson(paths(stateRoot, launchId, contract.contract_id).claim, claim, {
          guardRoot: guardRoot(stateRoot),
          mode: 0o600,
        });
      },
      compensateNative: () => removeExactLaunchState(stateRoot, record, claim),
    });
    return taskLaunchView(record);
  }));
}

export async function recordTaskLaunchAttempt({
  stateRoot,
  launchId,
  hostSessionId,
  timeoutSeconds = 1800,
  now = Date.now(),
}) {
  const timeout = requireInteger(timeoutSeconds, "timeout_seconds", { min: 5, max: 1800 });
  const session = requireText(hostSessionId, "host_session_id", { max: 128, safeId: true });
  return withProcessLock({
    path: paths(stateRoot, launchId).operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `task launch ${launchId}`,
  }, async () => {
    let record = await readRecord(stateRoot, launchId);
    if (record.attempt !== null) {
      const elapsed = (Date.parse(record.attempt.reconcile_by) - Date.parse(record.attempt.started_at)) / 1000;
      if (record.attempt.host_session_id !== session || elapsed !== timeout) {
        throw new CliError("Task launch already has a different one-shot attempt", 73);
      }
      return taskLaunchView(record, { dispatchPermitted: false });
    }
    if (record.status !== "prepared") throw new CliError(`Task launch is not dispatchable: ${record.status}`);
    const startedAt = nowIso(now);
    record = await writeRecord(stateRoot, {
      ...record,
      attempt: {
        attempt_id: `task-launch-attempt-v1-${sha256(`${record.launch_id}:1`)}`,
        host_session_id: session,
        started_at: startedAt,
        reconcile_by: nowIso((now instanceof Date ? now.getTime() : now) + timeout * 1000),
      },
      status: "attempting",
      updated_at: startedAt,
    });
    return taskLaunchView(record, { dispatchPermitted: true, includePrompt: true });
  });
}

function normalizeSelectorUpdate(record, value, { requireAccepted }) {
  if (value === null) {
    if (requireAccepted) throw new CliError("Created task evidence requires accepted selectors");
    return record.selector_evidence;
  }
  requireExactFields(value, { required: ["accepted", "observed"] }, "selector evidence update");
  const accepted = validateSelector(value.accepted, "selector evidence update.accepted");
  const observed = validateSelector(value.observed, "selector evidence update.observed", { nullableFields: true });
  if (requireAccepted && accepted === null) throw new CliError("Created task evidence requires accepted selectors");
  const next = validateSelectorEvidence({
    requested: record.selector_evidence.requested,
    accepted,
    observed,
  }, record.selector_evidence.requested);
  for (const field of ["accepted", "observed"]) {
    if (
      record.selector_evidence[field] !== null
      && stableStringify(record.selector_evidence[field]) !== stableStringify(next[field])
    ) throw new CliError(`Task launch ${field} selector evidence conflicts with its recorded value`, 73);
  }
  return {
    requested: clone(record.selector_evidence.requested),
    accepted: next.accepted ?? record.selector_evidence.accepted,
    observed: next.observed ?? record.selector_evidence.observed,
  };
}

function creationEvidenceFor({ outcome, hostId, readyThreadId, provisionalId, opaqueEvidence, observedAt }) {
  const base = {
    schema_version: 1,
    kind: "codex-flow-native-creation-evidence-v1",
    classification: outcome,
    host_id: requireText(hostId, "host_id", { max: 128, safeId: true }),
    ready_thread_id: null,
    provisional_id: null,
    opaque_digest: null,
    opaque_length: null,
    observed_at: requireTimestamp(observedAt, "observed_at"),
  };
  if (outcome === "ready") {
    base.ready_thread_id = requireText(readyThreadId, "ready_thread_id", { max: 256, safeId: true });
  } else if (outcome === "provisional") {
    base.provisional_id = requireText(
      provisionalId,
      "provisional_id",
      { max: 256 },
    );
  } else {
    requireExactFields(opaqueEvidence, { required: ["digest", "length"] }, "opaque_evidence");
    base.opaque_digest = requireDigest(opaqueEvidence.digest, "opaque_evidence.digest");
    base.opaque_length = requireInteger(opaqueEvidence.length, "opaque_evidence.length", {
      min: 0,
      max: 16_384,
    });
  }
  return validateCreationEvidence(base);
}

export async function reconcileTaskLaunch({
  stateRoot,
  launchId,
  outcome,
  hostId = "local",
  readyThreadId = null,
  provisionalId = null,
  opaqueEvidence = null,
  selectorEvidence = null,
  reasonCode = null,
  observedAt = null,
  now = Date.now(),
}) {
  const result = requireEnum(
    outcome,
    [...CREATION_CLASSIFICATIONS, "terminal-no-object", "ambiguous", "session-blocked"],
    "task launch outcome",
  );
  return withProcessLock({
    path: paths(stateRoot, launchId).operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `task launch ${launchId}`,
  }, async () => {
    let record = await readRecord(stateRoot, launchId);
    if (record.attempt === null) throw new CliError("Task launch must record its one-shot attempt first");
    const recordedAt = nowIso(now);
    if (CREATION_CLASSIFICATIONS.includes(result)) {
      if (reasonCode !== null) throw new CliError("Created task evidence does not accept a terminal reason");
      const evidence = creationEvidenceFor({
        outcome: result,
        hostId,
        readyThreadId,
        provisionalId,
        opaqueEvidence,
        observedAt: observedAt ?? recordedAt,
      });
      const selectors = normalizeSelectorUpdate(record, selectorEvidence, { requireAccepted: true });
      if (record.creation_evidence !== null) {
        if (
          stableStringify(record.creation_evidence) !== stableStringify(evidence)
          || stableStringify(record.selector_evidence) !== stableStringify(selectors)
        ) throw new CliError("Task launch creation reconciliation conflicts with recorded evidence", 73);
        return taskLaunchView(record);
      }
      if (record.resolution !== null) throw new CliError("Terminal task launch cannot admit created-object evidence", 73);
      if (
        evidence.classification === "ready"
        && record.start_claim !== null
        && evidence.ready_thread_id !== record.start_claim.executor_thread_id
      ) throw new CliError("Host-returned task ID contradicts the executor start claim", 73);
      record = await writeRecord(stateRoot, {
        ...record,
        creation_evidence: evidence,
        selector_evidence: selectors,
        status: record.start_claim !== null && record.git_activation?.state === "completed"
          ? "active"
          : "awaiting-start",
        updated_at: recordedAt,
      });
      return taskLaunchView(record);
    }
    if (
      readyThreadId !== null
      || provisionalId !== null
      || opaqueEvidence !== null
      || observedAt !== null
    ) throw new CliError("Terminal task-launch reconciliation cannot claim created-object evidence");
    if (record.creation_evidence !== null || record.start_claim !== null || record.git_activation !== null) {
      throw new CliError("Terminal task-launch reconciliation requires exact no-object evidence", 73);
    }
    const selectors = normalizeSelectorUpdate(record, selectorEvidence, { requireAccepted: false });
    if (selectors.accepted !== null || selectors.observed !== null) {
      throw new CliError("Terminal no-object evidence cannot claim accepted or observed selectors");
    }
    if (record.resolution !== null) {
      if (record.resolution.outcome !== result || record.resolution.reason_code !== reasonCode) {
        throw new CliError("Task launch terminal reconciliation conflicts with its recorded outcome", 73);
      }
      return taskLaunchView(record);
    }
    const resolution = validateResolution({
      outcome: result,
      reason_code: requireEnum(reasonCode, TERMINAL_REASONS[result], "reason_code"),
      recorded_at: recordedAt,
    });
    if (
      result === "ambiguous"
      && resolution.reason_code === "start-claim-missing-after-deadline"
      && Date.parse(record.attempt.reconcile_by) > Date.parse(recordedAt)
    ) throw new CliError("Start-claim deadline has not expired");
    record = await writeRecord(stateRoot, {
      ...record,
      resolution,
      status: result,
      updated_at: recordedAt,
    });
    if (result === "terminal-no-object") {
      const { transitionWorkflowOperationClaim } = await import("../workflow-journal.mjs");
      await transitionWorkflowOperationClaim({ stateRoot, taskLaunchRecord: record });
    }
    return taskLaunchView(record);
  });
}

function runGitSwitch(worktreePath, branch, baseline) {
  const result = spawnSync("git", ["switch", "--no-track", "-c", branch, baseline], {
    cwd: worktreePath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new CliError(String(result.stderr || result.stdout).trim() || "Executor branch activation failed");
  }
}

async function liveActivationFacts(stateRoot, record, repositoryPath, phase) {
  const authority = await activeRuntimeAuthority(stateRoot, record.task_contract);
  const coordinatorRoot = await realpath(authority.context.repository.root).catch(() => null);
  const worktreePath = await realpath(repositoryPath).catch(() => null);
  if (coordinatorRoot === null || worktreePath === null) {
    throw new CliError("Task launch repository path does not exist", 73);
  }
  if (worktreePath === coordinatorRoot) throw new CliError("Executor task cannot activate the coordinator checkout", 73);
  const snapshot = gitSnapshot(worktreePath);
  const canonicalCommon = await realpath(snapshot.commonDir).catch(() => null);
  const expectedCommon = await realpath(record.common_dir).catch(() => null);
  if (
    snapshot.root !== worktreePath
    || canonicalCommon === null
    || expectedCommon === null
    || canonicalCommon !== expectedCommon
    || record.common_dir !== expectedCommon
  ) throw new CliError("Executor worktree belongs to the wrong repository", 73);
  if (snapshot.revision !== record.task_contract.current_baseline.revision) {
    throw new CliError("Executor worktree is not at the exact task baseline", 73);
  }
  if (snapshot.cleanliness !== "clean") throw new CliError("Executor worktree must be pristine at task start", 73);
  const inventory = worktreeInventory(expectedCommon);
  const item = inventory.find((entry) => entry.path === worktreePath);
  if (!item || item.bare || item.locked || item.prunable) {
    throw new CliError("Executor worktree is not a pristine linked Git worktree", 73);
  }
  if (inventory[0]?.path === worktreePath) {
    throw new CliError("Executor task cannot activate the source checkout", 73);
  }
  const branch = record.selector_evidence.requested.worktree.executor_branch;
  const ref = `refs/heads/${branch}`;
  const otherAttachment = inventory.find((entry) => entry.path !== worktreePath && entry.branch_ref === ref);
  if (otherAttachment) throw new CliError("Executor branch is attached to another worktree", 73);
  const availability = gitBranchAvailability(worktreePath, branch);
  if (availability.tracked_remote_exists) {
    throw new CliError("Executor branch collides with remote-tracking state", 73);
  }
  if (phase === "unprepared") {
    if (!item.detached || snapshot.branch !== "detached" || availability.local_exists) {
      throw new CliError("Executor worktree is not a pristine detached launch worktree", 73);
    }
  } else if (snapshot.branch === "detached") {
    if (phase === "completed" || !item.detached || availability.local_exists) {
      throw new CliError("Prepared executor activation has drifted", 73);
    }
  } else if (
    snapshot.branch !== branch
    || item.detached
    || item.branch_ref !== ref
    || !availability.local_exists
    || localBranchTip(expectedCommon, branch) !== record.task_contract.current_baseline.revision
  ) throw new CliError("Executor worktree is on a wrong or drifted branch", 73);
  return {
    worktree_path: worktreePath,
    common_dir: expectedCommon,
    executor_branch: branch,
    baseline_revision: record.task_contract.current_baseline.revision,
    attached: snapshot.branch === branch,
  };
}

function activationIntent(record, facts, preparedAt) {
  const base = {
    schema_version: 1,
    kind: "codex-flow-task-launch-git-activation-v1",
    activation_id: "pending",
    launch_id: record.launch_id,
    worktree_path: facts.worktree_path,
    common_dir: facts.common_dir,
    executor_branch: facts.executor_branch,
    baseline_revision: facts.baseline_revision,
    state: "prepared",
    prepared_at: preparedAt,
    completed_at: null,
  };
  base.activation_id = `task-launch-activation-v1-${sha256(stableStringify(activationSeed(base)))}`;
  return validateActivation(base);
}

function assertActivationIntent(record, facts) {
  const expected = activationIntent(record, facts, record.git_activation.prepared_at);
  if (stableStringify({ ...record.git_activation, state: "prepared", completed_at: null }) !== stableStringify(expected)) {
    throw new CliError("Task launch Git intent does not match live worktree authority", 73);
  }
}

export async function startTaskLaunch({
  stateRoot,
  launchId,
  launchNonce,
  executorThreadId,
  repositoryPath,
  now = Date.now(),
  hooks = {},
}) {
  const threadId = requireText(executorThreadId, "executor_thread_id", { max: 256, safeId: true });
  const nonce = requireDigest(launchNonce, "launch_nonce");
  const initial = await readRecord(stateRoot, launchId);
  const branch = initial.selector_evidence.requested.worktree.executor_branch;
  return withProcessLock({
    path: branchLock(stateRoot, branch),
    guardRoot: guardRoot(stateRoot),
    label: `task-launch branch ${branch}`,
  }, () => withProcessLock({
    path: paths(stateRoot, launchId).operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `task launch ${launchId}`,
  }, async () => {
    let record = await readRecord(stateRoot, launchId);
    if (record.attempt === null) throw new CliError("Task launch start requires a recorded one-shot attempt", 73);
    if (record.resolution !== null) throw new CliError("Terminal task launch cannot be started", 73);
    if (nonce !== record.launch_nonce) throw new CliError("Task launch nonce does not match", 73);
    const claimedAt = nowIso(now);
    if (Date.parse(claimedAt) >= Date.parse(record.attempt.reconcile_by)) {
      throw new CliError("Task launch start claim missed the bounded launch window", 73);
    }
    if (
      record.creation_evidence?.classification === "ready"
      && record.creation_evidence.ready_thread_id !== threadId
    ) throw new CliError("Executor identity contradicts the host-returned task ID", 73);
    if (record.start_claim !== null && record.start_claim.executor_thread_id !== threadId) {
      throw new CliError("Task launch is already claimed by a different executor", 73);
    }
    const phase = record.git_activation === null
      ? "unprepared"
      : record.git_activation.state === "completed"
        ? "completed"
        : "prepared";
    let facts = await liveActivationFacts(stateRoot, record, repositoryPath, phase);
    if (record.git_activation?.state === "completed") {
      assertActivationIntent(record, facts);
      return taskLaunchView(record, { activationPerformed: false });
    }
    if (record.git_activation === null) {
      const startClaim = validateStartClaim({
        executor_thread_id: threadId,
        identity_source: "host-environment",
        launch_nonce_digest: sha256(nonce),
        claimed_at: claimedAt,
      });
      const activation = activationIntent(record, facts, claimedAt);
      record = await writeRecord(stateRoot, {
        ...record,
        start_claim: startClaim,
        git_activation: activation,
        status: record.creation_evidence === null ? "attempting" : "awaiting-start",
        updated_at: claimedAt,
      });
      await hooks.afterPreparedIntent?.({ record: clone(record) });
    } else {
      assertActivationIntent(record, facts);
    }
    facts = await liveActivationFacts(stateRoot, record, repositoryPath, "prepared");
    assertActivationIntent(record, facts);
    if (!facts.attached) runGitSwitch(facts.worktree_path, facts.executor_branch, facts.baseline_revision);
    await hooks.afterBranchSwitch?.({ record: clone(record) });
    facts = await liveActivationFacts(stateRoot, record, repositoryPath, "completed");
    assertActivationIntent(record, facts);
    const completedAt = nowIso(now);
    record = await writeRecord(stateRoot, {
      ...record,
      git_activation: validateActivation({
        ...record.git_activation,
        state: "completed",
        completed_at: completedAt,
      }),
      status: "active",
      updated_at: completedAt,
    });
    return taskLaunchView(record, { activationPerformed: true });
  }));
}

export function taskLaunchView(record, {
  dispatchPermitted = false,
  includePrompt = false,
  activationPerformed = false,
} = {}) {
  const validated = validateTaskLaunchRecord(record);
  const view = {
    ...clone(validated),
    dispatch_permitted: dispatchPermitted,
    activation_performed: activationPerformed,
    execution_permitted: validated.status === "active",
    host_request: null,
  };
  if (includePrompt) {
    const prompt = renderInitialPrompt(validated);
    view.host_request = {
      title: validated.task_title,
      target: {
        type: "project",
        projectId: validated.selector_evidence.requested.project_id,
        environment: {
          type: "worktree",
          startingState: {
            type: "branch",
            branchName: validated.selector_evidence.requested.worktree.starting_branch,
          },
        },
      },
      model: validated.selector_evidence.requested.model,
      thinking: validated.selector_evidence.requested.reasoning_effort,
      prompt,
      selector_rationale: validated.selector_rationale,
    };
  }
  return view;
}

export async function taskLaunchStatus({ stateRoot, launchId }) {
  return taskLaunchView(await readRecord(stateRoot, launchId));
}

export async function resolveTaskLaunchExecutorWorktree({ stateRoot, launchId }) {
  const record = await readRecord(stateRoot, launchId);
  if (record.status !== "active" || record.git_activation?.state !== "completed") {
    throw new CliError("Task launch does not have an active executor worktree", 73);
  }
  const facts = await liveActivationFacts(
    stateRoot,
    record,
    record.git_activation.worktree_path,
    "completed",
  );
  assertActivationIntent(record, facts);
  return {
    launch: taskLaunchView(record),
    repository: {
      root: facts.worktree_path,
      common_dir: facts.common_dir,
      branch: facts.executor_branch,
      revision: gitSnapshot(facts.worktree_path).revision,
      cleanliness: gitSnapshot(facts.worktree_path).cleanliness,
    },
  };
}

export async function taskLaunchRecords({ stateRoot }) {
  return Promise.all((await listLaunchRecords(stateRoot)).map(async (record) => taskLaunchView(record)));
}

export function taskLaunchIdForContract({ taskContract, requestedSelectors }) {
  const contract = validateGeneratedTaskContract(taskContract);
  const requested = validateRequestedSelectors(requestedSelectors, contract.current_baseline.revision);
  return launchIdFor({
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: contract.coordinator_binding,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
    task_title: contract.task.title,
    selector_rationale: contract.task.selector_rationale,
    selector_evidence: { requested },
  });
}

export function taskLaunchRecordPath(stateRoot, launchId) {
  return paths(stateRoot, launchId).record;
}

export async function assertTaskLaunchRuntimeAuthority({ stateRoot, launchId }) {
  const record = await readRecord(stateRoot, launchId);
  await activeRuntimeAuthority(stateRoot, record.task_contract);
  return taskLaunchView(record);
}
