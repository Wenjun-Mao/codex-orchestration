import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  atomicWriteJson,
  assertNoSymlinkComponents,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import {
  gitBranchAvailability,
  gitCommonDirectoryForState,
  gitSnapshot,
} from "./git.mjs";
import { REASONING_EFFORTS, validateSelectorRationale } from "./model-routing-v07.mjs";
import { readRun } from "./run-lifecycle.mjs";
import {
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
} from "./runtime-context.mjs";
import {
  assertWorkflowPreDispatchOrphanRecoverable,
  assertWorkflowTaskContractCurrent,
  workflowTaskContractStartability,
} from "./workflow-journal-v07.mjs";
import { validateGeneratedTaskContract } from "./workflow-plan.mjs";
import {
  PRIVATE_DELEGATION_SOURCE,
  PRIVATE_TASK_RESOLUTION_KIND,
  PRIVATE_TASK_RESOLUTION_SOURCE,
  privateAcceptedSelectorDigest,
  privateTaskResolutionBindingDigest,
  resolveCodexAppPrivateTask,
} from "./codex-app-private-resolution-v07.mjs";

export const VISIBLE_TASK_CREATION_SCHEMA_VERSION = 1;
export const VISIBLE_TASK_CREATION_KIND = "codex-flow-v07-visible-task-creation";

const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const STATUSES = [
  "prepared",
  "attempting",
  "provisional",
  "ready-unreleased",
  "ambiguous",
  "not-created",
  "session-blocked",
];
const AMBIGUOUS_REASONS = [
  "host-result-ambiguous",
  "identity-evidence-missing",
  "selector-mismatch",
  "reconciliation-window-expired",
];
const NOT_CREATED_REASONS = [
  "selector-rejected-before-task-identity",
  "create-returned-not-created",
];
const SESSION_BLOCKED_REASONS = [
  "argument-serialization",
  "adapter-unavailable",
  "backend-unavailable",
  "schema-runtime-drift",
  "host-control-failure",
];
const WORKTREE_BINDING_KIND = "codex-flow-v07-worktree-binding";
const LATE_PRIVATE_RECOVERY_KIND = "codex-flow-v07-late-private-visible-task-recovery";

function clone(value) {
  return JSON.parse(stableStringify(value));
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

function nowIso(now = Date.now()) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Task-creation clock must be a finite timestamp");
  return new Date(milliseconds).toISOString();
}

function requireAbsolutePath(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function requireNullableSafeId(value, label, { max = 256 } = {}) {
  return value === null ? null : requireText(value, label, { max, safeId: true });
}

function requireBranch(value, label) {
  const result = requireText(value, label, { max: 256 });
  if (
    result.includes("\\")
    || /\s/.test(result)
    || result.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new CliError(`${label} must be a normalized Git branch name`);
  return result;
}

function validateCoordinatorBinding(value, label = "coordinator_binding") {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const binding = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, {
      min: 1,
      max: 2147483647,
    }),
  };
  const expected = sha256(stableStringify(binding));
  if (value.binding_digest !== expected) {
    throw new CliError(`${label}.binding_digest does not match the coordinator identity`);
  }
  return { ...binding, binding_digest: expected };
}

function validateWorktree(value, label, phase) {
  requireExactFields(value, {
    required: ["mode", "starting_revision", "starting_branch", "executor_branch", "path"],
  }, label);
  const mode = requireEnum(value.mode, ["host-worktree", "local"], `${label}.mode`);
  const worktree = {
    mode,
    starting_revision: requireRevision(value.starting_revision, `${label}.starting_revision`),
    starting_branch: value.starting_branch === null
      ? null
      : requireBranch(value.starting_branch, `${label}.starting_branch`),
    executor_branch: value.executor_branch === null
      ? null
      : requireBranch(value.executor_branch, `${label}.executor_branch`),
    path: value.path === null ? null : requireAbsolutePath(value.path, `${label}.path`),
  };
  if (mode === "host-worktree") {
    if (worktree.starting_branch === null || worktree.executor_branch === null) {
      throw new CliError(`${label} host-worktree mode requires starting and executor branches`);
    }
    if (worktree.starting_branch === worktree.executor_branch) {
      throw new CliError(`${label}.executor_branch must differ from starting_branch`);
    }
    if (["requested", "accepted"].includes(phase) && worktree.path !== null) {
      throw new CliError(`${label}.path must be null before host worktree observation`);
    }
    if (phase === "observed" && worktree.path === null) {
      throw new CliError(`${label}.path is required for observed host worktree evidence`);
    }
  } else {
    if (worktree.starting_branch !== null || worktree.executor_branch !== null) {
      throw new CliError(`${label} local mode does not accept host-provisioned branch selectors`);
    }
    if (worktree.path === null) throw new CliError(`${label}.path is required for local mode`);
  }
  return worktree;
}

function validateRequestedSelectors(value, baselineRevision, label = "requested selectors") {
  requireExactFields(value, {
    required: ["project_id", "model", "reasoning_effort", "worktree"],
  }, label);
  const requested = {
    project_id: requireText(value.project_id, `${label}.project_id`, { max: 128, safeId: true }),
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: requireEnum(
      value.reasoning_effort,
      REASONING_EFFORTS.filter((item) => item !== null),
      `${label}.reasoning_effort`,
    ),
    worktree: validateWorktree(value.worktree, `${label}.worktree`, "requested"),
  };
  if (requested.worktree.starting_revision !== baselineRevision) {
    throw new CliError(`${label}.worktree.starting_revision must match the generated task baseline`);
  }
  return requested;
}

function validateAcceptedSelectors(value, requested, label = "accepted selectors") {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["project_id", "model", "reasoning_effort", "worktree", "accepted_at"],
  }, label);
  const accepted = {
    project_id: requireText(value.project_id, `${label}.project_id`, { max: 128, safeId: true }),
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: requireEnum(
      value.reasoning_effort,
      REASONING_EFFORTS.filter((item) => item !== null),
      `${label}.reasoning_effort`,
    ),
    worktree: validateWorktree(value.worktree, `${label}.worktree`, "accepted"),
    accepted_at: requireTimestamp(value.accepted_at, `${label}.accepted_at`),
  };
  for (const field of ["project_id", "model", "reasoning_effort"]) {
    if (accepted[field] !== requested[field]) {
      throw new CliError(`${label}.${field} does not match the requested selector`);
    }
  }
  if (stableStringify(accepted.worktree) !== stableStringify(requested.worktree)) {
    throw new CliError(`${label}.worktree does not match the requested selector`);
  }
  return accepted;
}

function validateObservedSelectors(value, label = "observed selectors") {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["project_id", "model", "reasoning_effort", "worktree", "observed_at"],
  }, label);
  return {
    project_id: requireNullableSafeId(value.project_id, `${label}.project_id`, { max: 128 }),
    model: value.model === null ? null : requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: value.reasoning_effort === null
      ? null
      : requireEnum(
        value.reasoning_effort,
        REASONING_EFFORTS.filter((item) => item !== null),
        `${label}.reasoning_effort`,
      ),
    worktree: value.worktree === null
      ? null
      : validateWorktree(value.worktree, `${label}.worktree`, "observed"),
    observed_at: requireTimestamp(value.observed_at, `${label}.observed_at`),
  };
}

function validateSelectorEvidence(value, baselineRevision, label = "selector_evidence") {
  requireExactFields(value, { required: ["requested", "accepted", "observed"] }, label);
  const requested = validateRequestedSelectors(value.requested, baselineRevision, `${label}.requested`);
  return {
    requested,
    accepted: validateAcceptedSelectors(value.accepted, requested, `${label}.accepted`),
    observed: validateObservedSelectors(value.observed, `${label}.observed`),
  };
}

function worktreeMatchesRequested(requested, observed) {
  if (requested.mode !== observed.mode || requested.starting_revision !== observed.starting_revision) return false;
  if (requested.starting_branch !== observed.starting_branch) return false;
  if (requested.executor_branch !== observed.executor_branch) return false;
  if (requested.mode === "local") return requested.path === observed.path;
  return observed.path !== null;
}

function selectorMismatches(evidence) {
  const mismatches = [];
  const { requested, observed } = evidence;
  if (observed === null) return mismatches;
  for (const field of ["project_id", "model", "reasoning_effort"]) {
    if (observed[field] !== null && observed[field] !== requested[field]) mismatches.push(field);
  }
  if (observed.worktree !== null && !worktreeMatchesRequested(requested.worktree, observed.worktree)) {
    mismatches.push("worktree");
  }
  return mismatches;
}

function validateAttempt(value, operationId) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["attempt_id", "host_session_id", "started_at", "reconcile_by"],
  }, "task creation attempt");
  const expected = `visible-task-attempt-v1-${sha256(`${operationId}:1`)}`;
  const attempt = {
    attempt_id: requireText(value.attempt_id, "attempt_id", { max: 128, safeId: true }),
    host_session_id: requireText(value.host_session_id, "host_session_id", { max: 128, safeId: true }),
    started_at: requireTimestamp(value.started_at, "attempt.started_at"),
    reconcile_by: requireTimestamp(value.reconcile_by, "attempt.reconcile_by"),
  };
  if (attempt.attempt_id !== expected) throw new CliError("Task creation attempt_id is invalid");
  if (Date.parse(attempt.reconcile_by) <= Date.parse(attempt.started_at)) {
    throw new CliError("Task creation reconcile_by must follow started_at");
  }
  return attempt;
}

function requireProvisionalClientThreadId(value, label = "provisional_client_thread_id") {
  return requireText(value, label, { max: 256 });
}

function validateProvisional(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["client_thread_id", "observed_at", "recorded_at"] }, "provisional identity");
  return {
    client_thread_id: requireProvisionalClientThreadId(value.client_thread_id, "client_thread_id"),
    observed_at: requireTimestamp(value.observed_at, "provisional.observed_at"),
    recorded_at: requireTimestamp(value.recorded_at, "provisional.recorded_at"),
  };
}

function validateInitialTurn(value, readyThreadId, launchNonce) {
  requireExactFields(value, {
    required: [
      "source", "thread_id", "turn_id", "turn_index", "role",
      "launch_nonce", "content_digest", "observed_at",
    ],
  }, "initial turn evidence");
  const source = requireEnum(
    value.source,
    ["host-observed", PRIVATE_DELEGATION_SOURCE],
    "initial_turn.source",
  );
  const expectedRole = source === PRIVATE_DELEGATION_SOURCE ? "delegation" : "user";
  const evidence = {
    source,
    thread_id: requireText(value.thread_id, "initial_turn.thread_id", { max: 256, safeId: true }),
    turn_id: requireText(value.turn_id, "initial_turn.turn_id", { max: 256, safeId: true }),
    turn_index: requireInteger(value.turn_index, "initial_turn.turn_index", { min: 1, max: 1 }),
    role: requireEnum(value.role, [expectedRole], "initial_turn.role"),
    launch_nonce: requireDigest(value.launch_nonce, "initial_turn.launch_nonce"),
    content_digest: requireDigest(value.content_digest, "initial_turn.content_digest"),
    observed_at: requireTimestamp(value.observed_at, "initial_turn.observed_at"),
  };
  if (evidence.thread_id !== readyThreadId) {
    throw new CliError("Initial turn evidence does not belong to the ready task ID");
  }
  if (evidence.launch_nonce !== launchNonce) {
    throw new CliError("Initial turn evidence does not contain the exact launch nonce");
  }
  return evidence;
}

function validatePrivateResolution(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "source", "provisional_client_thread_id",
      "provisional_observed_at", "host_id", "ready_thread_id", "binding_digest", "state_digest",
      "source_session_digest", "accepted_selector_digest", "session_digest",
      "app_version", "app_release_family", "host_cli_version", "resolved_at",
    ],
  }, "private task resolution");
  if (
    value.schema_version !== 1
    || value.kind !== PRIVATE_TASK_RESOLUTION_KIND
    || value.source !== PRIVATE_TASK_RESOLUTION_SOURCE
  ) throw new CliError("Private task resolution has unsupported authority");
  const resolution = {
    schema_version: 1,
    kind: PRIVATE_TASK_RESOLUTION_KIND,
    source: PRIVATE_TASK_RESOLUTION_SOURCE,
    provisional_client_thread_id: requireProvisionalClientThreadId(
      value.provisional_client_thread_id,
      "private_resolution.provisional_client_thread_id",
    ),
    provisional_observed_at: requireTimestamp(
      value.provisional_observed_at,
      "private_resolution.provisional_observed_at",
    ),
    host_id: requireText(value.host_id, "private_resolution.host_id", { max: 256, safeId: true }),
    ready_thread_id: requireText(
      value.ready_thread_id,
      "private_resolution.ready_thread_id",
      { max: 256, safeId: true },
    ),
    binding_digest: requireDigest(value.binding_digest, "private_resolution.binding_digest"),
    state_digest: requireDigest(value.state_digest, "private_resolution.state_digest"),
    source_session_digest: requireDigest(
      value.source_session_digest,
      "private_resolution.source_session_digest",
    ),
    accepted_selector_digest: requireDigest(
      value.accepted_selector_digest,
      "private_resolution.accepted_selector_digest",
    ),
    session_digest: requireDigest(value.session_digest, "private_resolution.session_digest"),
    app_version: value.app_version,
    app_release_family: value.app_release_family === null
      ? null
      : requireText(value.app_release_family, "private_resolution.app_release_family", { max: 64 }),
    host_cli_version: value.host_cli_version === null
      ? null
      : requireText(value.host_cli_version, "private_resolution.host_cli_version", { max: 64 }),
    resolved_at: requireTimestamp(value.resolved_at, "private_resolution.resolved_at"),
  };
  if (resolution.app_version !== null) {
    throw new CliError("Private task resolution cannot claim an unavailable exact App version");
  }
  if (resolution.host_id !== "local") {
    throw new CliError("Private task resolution has an unsupported host identity");
  }
  if (resolution.binding_digest !== privateTaskResolutionBindingDigest(resolution)) {
    throw new CliError("Private task resolution binding_digest is invalid");
  }
  if (resolution.ready_thread_id === resolution.provisional_client_thread_id) {
    throw new CliError("Private task resolution must separate provisional and ready identities");
  }
  return resolution;
}

function validateReady(value, launchNonce) {
  if (value === null) return null;
  requireExactFields(value, { required: ["thread_id", "initial_turn", "recorded_at"] }, "ready identity");
  const threadId = requireText(value.thread_id, "ready.thread_id", { max: 256, safeId: true });
  return {
    thread_id: threadId,
    initial_turn: validateInitialTurn(value.initial_turn, threadId, launchNonce),
    recorded_at: requireTimestamp(value.recorded_at, "ready.recorded_at"),
  };
}

function validateResolution(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["outcome", "reason_code", "recorded_at"] }, "task creation resolution");
  const outcome = requireEnum(value.outcome, ["ambiguous", "not-created", "session-blocked"], "resolution.outcome");
  const allowed = outcome === "ambiguous"
    ? AMBIGUOUS_REASONS
    : outcome === "not-created"
      ? NOT_CREATED_REASONS
      : SESSION_BLOCKED_REASONS;
  return {
    outcome,
    reason_code: requireEnum(value.reason_code, allowed, "resolution.reason_code"),
    recorded_at: requireTimestamp(value.recorded_at, "resolution.recorded_at"),
  };
}

function validateLatePrivateRecovery(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "source", "expired_resolution_digest", "recovered_at",
    ],
  }, "late private recovery");
  if (
    value.schema_version !== 1
    || value.kind !== LATE_PRIVATE_RECOVERY_KIND
    || value.source !== PRIVATE_TASK_RESOLUTION_SOURCE
  ) throw new CliError("Late private recovery has unsupported authority");
  return {
    schema_version: 1,
    kind: LATE_PRIVATE_RECOVERY_KIND,
    source: PRIVATE_TASK_RESOLUTION_SOURCE,
    expired_resolution_digest: requireDigest(
      value.expired_resolution_digest,
      "late_private_recovery.expired_resolution_digest",
    ),
    recovered_at: requireTimestamp(value.recovered_at, "late_private_recovery.recovered_at"),
  };
}

function worktreeBindingSeed(value) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    operation_id: value.operation_id,
    worktree_path: value.worktree_path,
    common_dir: value.common_dir,
    executor_branch: value.executor_branch,
    baseline_revision: value.baseline_revision,
  };
}

function worktreeBindingId(seed) {
  return `worktree-binding-v1-${sha256(stableStringify(seed))}`;
}

function validateWorktreeBinding(value, label = "worktree_binding") {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "binding_id", "operation_id", "worktree_path",
      "common_dir", "executor_branch", "baseline_revision", "state",
      "prepared_at", "bound_at",
    ],
  }, label);
  if (value.schema_version !== 1 || value.kind !== WORKTREE_BINDING_KIND) {
    throw new CliError(`${label} has unsupported authority`);
  }
  const binding = {
    schema_version: 1,
    kind: WORKTREE_BINDING_KIND,
    binding_id: requireText(value.binding_id, `${label}.binding_id`, { max: 128, safeId: true }),
    operation_id: requireText(value.operation_id, `${label}.operation_id`, { max: 128, safeId: true }),
    worktree_path: requireAbsolutePath(value.worktree_path, `${label}.worktree_path`),
    common_dir: requireAbsolutePath(value.common_dir, `${label}.common_dir`),
    executor_branch: requireBranch(value.executor_branch, `${label}.executor_branch`),
    baseline_revision: requireRevision(value.baseline_revision, `${label}.baseline_revision`),
    state: requireEnum(value.state, ["prepared", "completed"], `${label}.state`),
    prepared_at: requireTimestamp(value.prepared_at, `${label}.prepared_at`),
    bound_at: value.bound_at === null
      ? null
      : requireTimestamp(value.bound_at, `${label}.bound_at`),
  };
  if (binding.binding_id !== worktreeBindingId(worktreeBindingSeed(binding))) {
    throw new CliError(`${label}.binding_id does not match its immutable Git intent`);
  }
  if ((binding.state === "completed") !== (binding.bound_at !== null)) {
    throw new CliError(`${label}.state and bound_at are inconsistent`);
  }
  if (binding.bound_at !== null && Date.parse(binding.bound_at) < Date.parse(binding.prepared_at)) {
    throw new CliError(`${label}.bound_at predates prepared_at`);
  }
  return binding;
}

function operationSeed(value) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    run_id: value.run_id,
    runtime_context_digest: value.runtime_context_digest,
    configuration_digest: value.configuration_digest,
    repository_id: value.repository_id,
    common_dir: value.common_dir,
    coordinator_binding: value.coordinator_binding,
    plan_id: value.plan_id,
    revision_digest: value.revision_digest,
    task_id: value.task_id,
    task_digest: value.task_digest,
    contract_id: value.contract_id,
    task_title: value.task_title,
    selector_rationale: value.selector_rationale,
    requested_selectors: value.selector_evidence.requested,
  };
}

function operationIdForSeed(seed) {
  return `visible-task-operation-v1-${sha256(stableStringify(seed))}`;
}

function renderBootstrap(value) {
  const marker = visibleTaskLaunchMarker(value.launch_nonce);
  return [
    "# Codex Flow v0.7 visible-task bootstrap",
    "",
    `Task operation: ${value.operation_id}`,
    `Task contract: ${value.contract_id}`,
    marker,
    "",
    "This is a bootstrap-only turn. Do not inspect repository files, run repository commands, modify files, or begin the task.",
    "Keep the launch-nonce marker visible in this task's initial user turn, then wait for the coordinator to authenticate the ready task identity and send the accepted release.",
    "",
  ].join("\n");
}

export function visibleTaskLaunchMarker(launchNonce) {
  return `CODEX_FLOW_LAUNCH_NONCE=${requireDigest(launchNonce, "launch_nonce")}`;
}

export function validateVisibleTaskCreationRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id",
      "common_dir", "coordinator_binding", "plan_id", "revision_digest",
      "task_id", "task_digest", "contract_id", "task_title", "selector_rationale",
      "launch_nonce", "bootstrap_digest", "selector_evidence", "status",
      "attempt", "provisional", "ready", "private_resolution", "late_private_recovery",
      "resolution", "worktree_binding",
      "prepared_at", "updated_at",
    ],
  }, "Visible task creation record");
  if (value.schema_version !== VISIBLE_TASK_CREATION_SCHEMA_VERSION || value.kind !== VISIBLE_TASK_CREATION_KIND) {
    throw new CliError("Unsupported v0.7 visible task creation record");
  }
  const record = {
    schema_version: VISIBLE_TASK_CREATION_SCHEMA_VERSION,
    kind: VISIBLE_TASK_CREATION_KIND,
    operation_id: requireText(value.operation_id, "operation_id", { max: 128, safeId: true }),
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
    selector_rationale: validateSelectorRationale(value.selector_rationale),
    launch_nonce: requireDigest(value.launch_nonce, "launch_nonce"),
    bootstrap_digest: requireDigest(value.bootstrap_digest, "bootstrap_digest"),
    selector_evidence: validateSelectorEvidence(
      value.selector_evidence,
      value.selector_evidence?.requested?.worktree?.starting_revision,
    ),
    status: requireEnum(value.status, STATUSES, "status"),
    attempt: null,
    provisional: validateProvisional(value.provisional),
    ready: null,
    private_resolution: validatePrivateResolution(value.private_resolution),
    late_private_recovery: validateLatePrivateRecovery(value.late_private_recovery),
    resolution: validateResolution(value.resolution),
    worktree_binding: validateWorktreeBinding(value.worktree_binding),
    prepared_at: requireTimestamp(value.prepared_at, "prepared_at"),
    updated_at: requireTimestamp(value.updated_at, "updated_at"),
  };
  record.attempt = validateAttempt(value.attempt, record.operation_id);
  record.ready = validateReady(value.ready, record.launch_nonce);
  const expectedOperationId = operationIdForSeed(operationSeed(record));
  if (record.operation_id !== expectedOperationId) {
    throw new CliError("operation_id does not match the authenticated visible-task contract and selectors");
  }
  if (record.bootstrap_digest !== sha256(renderBootstrap(record))) {
    throw new CliError("bootstrap_digest does not match the task-creation identity and launch nonce");
  }
  if (Date.parse(record.updated_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Task creation updated_at predates prepared_at");
  }
  if (record.attempt && Date.parse(record.attempt.started_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Task creation attempt predates preparation");
  }
  if (record.attempt && Date.parse(record.attempt.started_at) > Date.parse(record.updated_at)) {
    throw new CliError("Task creation update predates its native attempt");
  }
  if (record.provisional && record.attempt && (
    Date.parse(record.provisional.observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.provisional.observed_at) >= Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Provisional identity was not observed within the bounded reconciliation window");
  if (record.provisional && Date.parse(record.provisional.recorded_at) < Date.parse(record.provisional.observed_at)) {
    throw new CliError("Provisional identity record predates its host observation");
  }
  if (
    record.provisional
    && record.attempt
    && Date.parse(record.provisional.recorded_at) >= Date.parse(record.attempt.reconcile_by)
    && record.late_private_recovery === null
  ) throw new CliError("Only late private recovery may record a provisional identity after the bounded deadline");
  if (record.selector_evidence.accepted && record.attempt && (
    Date.parse(record.selector_evidence.accepted.accepted_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.selector_evidence.accepted.accepted_at) >= Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Host-accepted selector evidence falls outside the bounded reconciliation window");
  if (
    record.selector_evidence.accepted
    && Date.parse(record.selector_evidence.accepted.accepted_at) > Date.parse(record.updated_at)
  ) throw new CliError("Task creation update predates its host-accepted selector evidence");
  if (record.selector_evidence.observed && record.attempt && (
    Date.parse(record.selector_evidence.observed.observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.selector_evidence.observed.observed_at) >= Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Host-observed selector evidence falls outside the bounded reconciliation window");
  if (
    record.selector_evidence.observed
    && Date.parse(record.selector_evidence.observed.observed_at) > Date.parse(record.updated_at)
  ) throw new CliError("Task creation update predates its host-observed selector evidence");
  if (record.ready && record.attempt && (
    Date.parse(record.ready.initial_turn.observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.ready.initial_turn.observed_at) >= Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Ready identity was not observed within the bounded reconciliation window");
  if (record.ready && Date.parse(record.ready.recorded_at) < Date.parse(record.ready.initial_turn.observed_at)) {
    throw new CliError("Ready identity record predates its initial-turn observation");
  }
  if (record.provisional && Date.parse(record.provisional.recorded_at) > Date.parse(record.updated_at)) {
    throw new CliError("Task creation update predates its provisional identity");
  }
  if (record.ready && Date.parse(record.ready.recorded_at) > Date.parse(record.updated_at)) {
    throw new CliError("Task creation update predates its ready identity");
  }
  if (record.private_resolution && record.attempt && (
    Date.parse(record.private_resolution.provisional_observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.private_resolution.provisional_observed_at) >= Date.parse(record.attempt.reconcile_by)
    || Date.parse(record.private_resolution.resolved_at) < Date.parse(record.attempt.started_at)
    || (
      record.late_private_recovery === null
      && Date.parse(record.private_resolution.resolved_at) >= Date.parse(record.attempt.reconcile_by)
    )
  )) throw new CliError("Private task resolution falls outside its permitted reconciliation window");
  if (
    record.private_resolution
    && Date.parse(record.private_resolution.resolved_at) > Date.parse(record.updated_at)
  ) throw new CliError("Task creation update predates its private resolution");
  if (record.resolution && record.attempt && (
    Date.parse(record.resolution.recorded_at) < Date.parse(record.attempt.started_at)
  )) throw new CliError("Task creation resolution predates its native attempt");
  if (record.resolution && Date.parse(record.resolution.recorded_at) > Date.parse(record.updated_at)) {
    throw new CliError("Task creation update predates its terminal resolution");
  }
  if (
    record.resolution?.reason_code === "reconciliation-window-expired"
    && (
      record.attempt === null
      || Date.parse(record.resolution.recorded_at) < Date.parse(record.attempt.reconcile_by)
    )
  ) throw new CliError("Reconciliation-window expiry cannot predate the bounded deadline");
  if (record.late_private_recovery !== null) {
    if (
      record.resolution === null
      || record.resolution.outcome !== "ambiguous"
      || record.resolution.reason_code !== "reconciliation-window-expired"
      || record.late_private_recovery.expired_resolution_digest
        !== sha256(stableStringify(record.resolution))
      || Date.parse(record.late_private_recovery.recovered_at)
        < Date.parse(record.resolution.recorded_at)
      || Date.parse(record.late_private_recovery.recovered_at) > Date.parse(record.updated_at)
    ) throw new CliError("Late private recovery does not bind the exact expired reconciliation evidence");
  }
  if (record.provisional && record.ready && record.provisional.client_thread_id === record.ready.thread_id) {
    throw new CliError("Provisional clientThreadId must remain distinct from the ready task ID");
  }
  if (record.private_resolution !== null) {
    if (
      record.status !== "ready-unreleased"
      || record.provisional === null
      || record.ready === null
      || record.ready.initial_turn.source !== PRIVATE_DELEGATION_SOURCE
      || record.private_resolution.provisional_client_thread_id !== record.provisional.client_thread_id
      || Date.parse(record.private_resolution.provisional_observed_at) < Date.parse(record.attempt.started_at)
      || Date.parse(record.private_resolution.provisional_observed_at) >= Date.parse(record.attempt.reconcile_by)
      || record.private_resolution.ready_thread_id !== record.ready.thread_id
      || record.private_resolution.provisional_observed_at !== record.provisional.observed_at
      || record.private_resolution.accepted_selector_digest
        !== privateAcceptedSelectorDigest(record.selector_evidence.accepted)
      || (
        record.late_private_recovery !== null
        && Date.parse(record.provisional.recorded_at) >= Date.parse(record.attempt.reconcile_by)
        && record.selector_evidence.accepted.accepted_at
          !== record.private_resolution.provisional_observed_at
      )
      || Date.parse(record.private_resolution.resolved_at) < Date.parse(record.provisional.recorded_at)
      || Date.parse(record.ready.recorded_at) < Date.parse(record.private_resolution.resolved_at)
    ) throw new CliError("Private task resolution does not bind the recorded provisional and ready identities");
  } else if (record.ready?.initial_turn.source === PRIVATE_DELEGATION_SOURCE) {
    throw new CliError("Private delegation evidence requires private task resolution provenance");
  }

  if (record.worktree_binding !== null) {
    const requestedWorktree = record.selector_evidence.requested.worktree;
    const observedWorktree = record.selector_evidence.observed?.worktree ?? null;
    if (
      record.status !== "ready-unreleased"
      || requestedWorktree.mode !== "host-worktree"
      || observedWorktree?.mode !== "host-worktree"
      || observedWorktree.path === null
      || record.worktree_binding.operation_id !== record.operation_id
      || record.worktree_binding.common_dir !== record.common_dir
      || record.worktree_binding.executor_branch !== requestedWorktree.executor_branch
      || record.worktree_binding.baseline_revision !== requestedWorktree.starting_revision
    ) throw new CliError("worktree_binding does not match the ready host-worktree authority");
    if (Date.parse(record.worktree_binding.prepared_at) < Date.parse(record.ready.recorded_at)) {
      throw new CliError("worktree_binding preparation predates ready task identity");
    }
    if (Date.parse(record.worktree_binding.prepared_at) > Date.parse(record.updated_at)) {
      throw new CliError("Task creation update predates worktree_binding preparation");
    }
    if (
      record.worktree_binding.bound_at !== null
      && Date.parse(record.worktree_binding.bound_at) > Date.parse(record.updated_at)
    ) throw new CliError("Task creation update predates completed worktree binding");
  }

  const hasAttempt = record.attempt !== null;
  const hasAccepted = record.selector_evidence.accepted !== null;
  const mismatches = selectorMismatches(record.selector_evidence);
  if (record.status === "prepared") {
    if (
      hasAttempt || record.provisional || record.ready || record.resolution
      || record.late_private_recovery || hasAccepted || record.selector_evidence.observed
    ) {
      throw new CliError("Prepared task creation cannot contain host-attempt evidence");
    }
  } else if (!hasAttempt) {
    throw new CliError(`Task creation status ${record.status} requires its single recorded attempt`);
  }
  if (record.status === "attempting") {
    if (
      record.provisional || record.ready || record.resolution
      || record.late_private_recovery || hasAccepted || record.selector_evidence.observed
    ) {
      throw new CliError("Attempting task creation cannot contain reconciliation evidence");
    }
  }
  if (record.status === "provisional") {
    if (
      !record.provisional || record.ready || record.resolution
      || record.late_private_recovery || !hasAccepted || record.selector_evidence.observed
      || mismatches.length > 0
    ) {
      throw new CliError("Provisional task creation requires compatible accepted selectors and only a clientThreadId");
    }
  }
  if (record.status !== "ready-unreleased" && record.selector_evidence.observed !== null) {
    throw new CliError("Only ready task creation may record observed selectors");
  }
  if (record.status === "ready-unreleased") {
    const latePrivateRecovery = record.late_private_recovery !== null;
    if (
      !record.ready
      || !hasAccepted
      || mismatches.length > 0
      || (latePrivateRecovery && (record.private_resolution === null || record.resolution === null))
      || (!latePrivateRecovery && record.resolution !== null)
    ) {
      throw new CliError("Ready task creation requires exact nonce identity and compatible selector evidence");
    }
  }
  if (["ambiguous", "not-created", "session-blocked"].includes(record.status)) {
    if (
      !record.resolution || record.resolution.outcome !== record.status
      || record.ready || record.late_private_recovery
    ) {
      throw new CliError(`Task creation status ${record.status} requires its matching terminal resolution`);
    }
  }
  if (["not-created", "session-blocked"].includes(record.status) && (
    record.provisional || hasAccepted || record.selector_evidence.observed
  )) throw new CliError(`${record.status} task creation cannot claim accepted or observed host identity`);
  if (record.status !== "ready-unreleased" && record.worktree_binding !== null) {
    throw new CliError(`Task creation status ${record.status} cannot contain worktree_binding authority`);
  }
  return record;
}

function recordView(record, extras = {}) {
  const value = validateVisibleTaskCreationRecord(record);
  const hostWorktree = value.selector_evidence.requested.worktree.mode === "host-worktree";
  const observedHostPath = value.selector_evidence.observed?.worktree?.path ?? null;
  const bindingCompleted = value.worktree_binding?.state === "completed";
  return {
    ...clone(value),
    attempt_permitted: value.status === "prepared",
    binding_permitted: value.status === "ready-unreleased"
      && hostWorktree
      && observedHostPath !== null
      && !bindingCompleted,
    release_permitted: value.status === "ready-unreleased" && (!hostWorktree || bindingCompleted),
    reconciliation_open: ["attempting", "provisional"].includes(value.status),
    ...extras,
  };
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe visible-task creation state path");
  }
  return path;
}

function paths(stateRoot, operationId, contractId = null) {
  const root = resolve(stateRoot, "visible-task-creations");
  const result = {};
  if (operationId !== null) {
    requireText(operationId, "operation_id", { max: 128, safeId: true });
    result.record = safeChild(resolve(root, "records"), `${operationId}.json`);
    result.operation_lock = safeChild(resolve(root, "locks"), `${operationId}.lock.json`);
  }
  if (contractId !== null) {
    requireDigest(contractId, "contract_id");
    result.claim = safeChild(resolve(root, "claims"), `${contractId}.json`);
    result.contract_lock = safeChild(resolve(root, "locks"), `${contractId}.lock.json`);
  }
  return result;
}

function branchClaimPaths(stateRoot, executorBranch) {
  const root = resolve(stateRoot, "visible-task-creations");
  const branch = requireBranch(executorBranch, "executor_branch");
  const key = sha256(branch);
  return {
    claims: resolve(root, "claims"),
    lock: safeChild(resolve(root, "branch-locks"), `${key}.lock.json`),
  };
}

function validateClaim(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "contract_id", "operation_id",
      "request_digest", "executor_branch", "launch_nonce", "prepared_at",
    ],
  }, "visible task creation claim");
  if (value.schema_version !== 1 || value.kind !== "codex-flow-v07-visible-task-creation-claim") {
    throw new CliError("Unsupported visible task creation claim");
  }
  return {
    schema_version: 1,
    kind: "codex-flow-v07-visible-task-creation-claim",
    contract_id: requireDigest(value.contract_id, "claim.contract_id"),
    operation_id: requireText(value.operation_id, "claim.operation_id", { max: 128, safeId: true }),
    request_digest: requireDigest(value.request_digest, "claim.request_digest"),
    executor_branch: value.executor_branch === null
      ? null
      : requireBranch(value.executor_branch, "claim.executor_branch"),
    launch_nonce: requireDigest(value.launch_nonce, "claim.launch_nonce"),
    prepared_at: requireTimestamp(value.prepared_at, "claim.prepared_at"),
  };
}

async function visibleTaskClaims(stateRoot) {
  const directory = resolve(stateRoot, "visible-task-creations", "claims");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const claims = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".json")) {
      throw new CliError(`Visible-task claim journal contains an unsupported entry: ${entry.name}`);
    }
    const claim = validateClaim(await readJson(resolve(directory, entry.name), {
      guardRoot: guardRoot(stateRoot),
    }));
    if (entry.name !== `${claim.contract_id}.json`) {
      throw new CliError(`Visible-task claim filename does not match contract_id: ${entry.name}`);
    }
    claims.push(claim);
  }
  return claims;
}

function assertClaimMatchesRecord(claim, record) {
  const requested = record.selector_evidence.requested;
  if (
    claim.operation_id !== record.operation_id
    || claim.contract_id !== record.contract_id
    || claim.request_digest !== sha256(stableStringify(requested))
    || claim.executor_branch !== requested.worktree.executor_branch
    || claim.launch_nonce !== record.launch_nonce
    || claim.prepared_at !== record.prepared_at
  ) {
    throw new CliError(
      `Retained visible-task branch claim does not match its creation record: ${claim.executor_branch}`,
      73,
    );
  }
}

async function readClaimRecord(stateRoot, claim) {
  const raw = await readJson(paths(stateRoot, claim.operation_id).record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (raw === null) {
    throw new CliError(
      `Retained visible-task branch claim is orphaned without its creation record: ${claim.executor_branch}`,
      73,
    );
  }
  const record = validateVisibleTaskCreationRecord(raw);
  assertClaimMatchesRecord(claim, record);
  return record;
}

function runGitReadOnly(commonDir, args, label, { allowStatuses = [0] } = {}) {
  const result = spawnSync("git", ["--git-dir", commonDir, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (!allowStatuses.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return result;
}

function assertBranchAndWorktreeAbsent(commonDir, executorBranch) {
  const ref = `refs/heads/${executorBranch}`;
  const branch = runGitReadOnly(
    commonDir,
    ["show-ref", "--verify", "--quiet", ref],
    "Executor branch inspection",
    { allowStatuses: [0, 1] },
  );
  if (branch.status === 0) {
    throw new CliError(`Selector-replan branch reuse requires the local branch to be absent: ${executorBranch}`, 73);
  }
  const worktrees = runGitReadOnly(
    commonDir,
    ["worktree", "list", "--porcelain", "-z"],
    "Executor worktree inspection",
  ).stdout.split("\0");
  if (worktrees.some((line) => line === `branch ${ref}`)) {
    throw new CliError(`Selector-replan branch reuse requires its worktree to be absent: ${executorBranch}`, 73);
  }
}

async function assertSelectorRejectedBranchReuse(stateRoot, predecessor, contract, executorBranch) {
  if (
    predecessor.run_id !== contract.run_id
    || predecessor.plan_id !== contract.plan_id
    || predecessor.task_id !== contract.task_id
    || predecessor.status !== "not-created"
    || predecessor.resolution.reason_code !== "selector-rejected-before-task-identity"
    || predecessor.provisional !== null
    || predecessor.ready !== null
    || predecessor.selector_evidence.accepted !== null
    || predecessor.selector_evidence.observed !== null
  ) {
    throw new CliError(
      `Host-worktree executor branch is retained by a non-reusable task contract: ${executorBranch}`,
      73,
    );
  }
  const { workflowJournalStatus } = await import("./workflow-journal-v07.mjs");
  const workflow = await workflowJournalStatus({
    stateRoot,
    runId: contract.run_id,
    planId: contract.plan_id,
  });
  const predecessorClaim = workflow.contracts.find(
    (entry) => entry.claim.contract_id === predecessor.contract_id,
  )?.claim;
  if (
    predecessorClaim?.state !== "terminal-no-object"
    || predecessorClaim.superseded_by_revision_digest !== contract.revision_digest
  ) {
    throw new CliError(
      `Host-worktree executor branch lacks an exact selector-rejection predecessor: ${executorBranch}`,
      73,
    );
  }
  assertBranchAndWorktreeAbsent(guardRoot(stateRoot), executorBranch);
}

export async function preflightVisibleTaskBranchReservations({
  stateRoot,
  runId,
  branchFences,
}) {
  const candidateRunId = requireText(runId, "run_id", { max: 128, safeId: true });
  const branches = requireStringArray(branchFences, "branch_fences", {
    maxItems: 128,
    maxText: 256,
  }).map((branch, index) => requireBranch(branch, `branch_fences[${index}]`));
  const requested = new Set(branches);
  const relevantClaims = (await visibleTaskClaims(stateRoot)).filter((claim) => (
    claim.executor_branch !== null && requested.has(claim.executor_branch)
  ));
  for (const claim of relevantClaims) {
    const record = await readClaimRecord(stateRoot, claim);
    if (record.run_id !== candidateRunId) {
      throw new CliError(
        `Host-worktree executor branch is retained by another run (${record.run_id}): ${claim.executor_branch}`,
        73,
      );
    }
  }
}

async function assertExecutorBranchAuthority(stateRoot, contract, requested) {
  if (requested.worktree.mode !== "host-worktree") return null;
  const branch = requested.worktree.executor_branch;
  const { run } = await readRun({
    gitCommonDirectory: guardRoot(stateRoot),
    runId: contract.run_id,
  });
  if (run.status !== "active") {
    throw new CliError("Visible task creation requires its exact active run", 73);
  }
  if (!run.plan.branch_fences.includes(branch)) {
    throw new CliError(
      `Host-worktree executor branch is not an exact admitted run branch fence: ${branch}`,
      73,
    );
  }
  return branch;
}

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

async function assertCommonDirectory(stateRoot, commonDir) {
  const journalCommon = await realpath(guardRoot(stateRoot)).catch(() => null);
  if (journalCommon === null) throw new CliError("Task-creation Git common directory does not exist");
  const contractCommon = await realpath(commonDir).catch(() => null);
  if (contractCommon === null) throw new CliError("Generated task contract common_dir does not exist");
  if (journalCommon !== contractCommon || commonDir !== contractCommon) {
    throw new CliError("Generated task contract common_dir does not match the task-creation journal");
  }
  return journalCommon;
}

function identityFromContract(contract, requested) {
  return {
    schema_version: VISIBLE_TASK_CREATION_SCHEMA_VERSION,
    kind: VISIBLE_TASK_CREATION_KIND,
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
    selector_evidence: {
      requested,
      accepted: null,
      observed: null,
    },
  };
}

function buildRecord(identity, operationId, claim) {
  const base = {
    ...identity,
    operation_id: operationId,
    launch_nonce: claim.launch_nonce,
    bootstrap_digest: "0".repeat(64),
    status: "prepared",
    attempt: null,
    provisional: null,
    ready: null,
    private_resolution: null,
    late_private_recovery: null,
    resolution: null,
    worktree_binding: null,
    prepared_at: claim.prepared_at,
    updated_at: claim.prepared_at,
  };
  base.bootstrap_digest = sha256(renderBootstrap(base));
  return validateVisibleTaskCreationRecord(base);
}

async function readRecord(stateRoot, operationId) {
  const location = paths(stateRoot, operationId);
  const raw = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (!raw) throw new CliError("Visible task creation operation does not exist");
  return { location, record: validateVisibleTaskCreationRecord(raw) };
}

async function writeRecord(stateRoot, operationId, record) {
  const validated = validateVisibleTaskCreationRecord(record);
  await atomicWriteJson(paths(stateRoot, operationId).record, validated, { guardRoot: guardRoot(stateRoot) });
  return validated;
}

function isPreDispatchRecord(record) {
  return record.status === "prepared"
    && record.attempt === null
    && record.provisional === null
    && record.ready === null
    && record.private_resolution === null
    && record.late_private_recovery === null
    && record.resolution === null
    && record.worktree_binding === null
    && record.selector_evidence.accepted === null
    && record.selector_evidence.observed === null;
}

async function removeExactPreDispatchState(
  stateRoot,
  location,
  { record = undefined, claim = undefined } = {},
  { allowMissingOwned = false } = {},
) {
  const root = guardRoot(stateRoot);
  const files = [
    { path: location.record, expected: record, label: "record" },
    { path: location.claim, expected: claim, label: "claim" },
  ];
  const owned = [];
  for (const file of files) {
    const raw = await readJson(file.path, { allowMissing: true, guardRoot: root });
    if (file.expected === undefined) {
      if (raw !== null) {
        throw new CliError(`Visible-task pre-dispatch ${file.label} is not owned by this recovery`);
      }
      continue;
    }
    if (raw === null) {
      if (!allowMissingOwned) {
        throw new CliError(`Visible-task pre-dispatch ${file.label} disappeared before recovery`);
      }
      continue;
    }
    if (stableStringify(raw) !== stableStringify(file.expected)) {
      throw new CliError(`Visible-task pre-dispatch ${file.label} does not match the exact owned state`);
    }
    owned.push(file.path);
  }
  for (const path of owned) {
    await assertNoSymlinkComponents(root, path, "Visible-task pre-dispatch state");
    await unlink(path).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function closeExpired(record, now) {
  if (!["attempting", "provisional"].includes(record.status)) return record;
  if (Date.parse(record.attempt.reconcile_by) > now) return record;
  const timestamp = nowIso(now);
  return validateVisibleTaskCreationRecord({
    ...record,
    status: "ambiguous",
    resolution: {
      outcome: "ambiguous",
      reason_code: "reconciliation-window-expired",
      recorded_at: timestamp,
    },
    updated_at: timestamp,
  });
}

export async function prepareVisibleTaskCreation({ stateRoot, taskContract, requestedSelectors, now = Date.now() }) {
  const contract = validateGeneratedTaskContract(taskContract);
  if (contract.task.execution_kind !== "task-thread") {
    throw new CliError("Visible task creation requires a generated task-thread contract");
  }
  await assertCommonDirectory(stateRoot, contract.common_dir);
  const requested = validateRequestedSelectors(
    requestedSelectors,
    contract.current_baseline.revision,
  );
  if (requested.model !== contract.task.model || requested.reasoning_effort !== contract.task.reasoning_effort) {
    throw new CliError("Requested model and reasoning effort must exactly match the generated task contract");
  }
  const identity = identityFromContract(contract, requested);
  const operationId = operationIdForSeed(operationSeed({
    ...identity,
    operation_id: "unused",
  }));
  const requestDigest = sha256(stableStringify(requested));
  const location = paths(stateRoot, operationId, contract.contract_id);
  const executorBranch = await assertExecutorBranchAuthority(stateRoot, contract, requested);
  const prepare = () => withProcessLock({
    path: location.contract_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task contract ${contract.contract_id}`,
  }, async () => {
    let rawClaim = await readJson(location.claim, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    let rawRecord = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    if (rawRecord) {
      const existing = validateVisibleTaskCreationRecord(rawRecord);
      const immutable = [
        "operation_id", "run_id", "runtime_context_digest", "configuration_digest",
        "repository_id", "common_dir", "coordinator_binding", "plan_id",
        "revision_digest", "task_id", "task_digest", "contract_id", "task_title",
        "selector_rationale",
      ];
      const existingIdentity = Object.fromEntries(immutable.map((field) => [field, existing[field]]));
      const expectedIdentity = Object.fromEntries(immutable.map((field) => [
        field,
        field === "operation_id" ? operationId : identity[field],
      ]));
      if (
        stableStringify(existingIdentity) !== stableStringify(expectedIdentity)
        || stableStringify(existing.selector_evidence.requested) !== stableStringify(requested)
      ) throw new CliError("Existing task-creation record does not match the authenticated contract", 73);
      if (rawClaim !== null) assertClaimMatchesRecord(validateClaim(rawClaim), existing);
      const startability = await workflowTaskContractStartability({
        stateRoot,
        runId: contract.run_id,
        planId: contract.plan_id,
        taskContract: contract,
      });
      if (startability.startability === "exact-replay") {
        return recordView(existing);
      }
      if (
        startability.startability === "native-operation-without-durable-claim-transition"
        && isPreDispatchRecord(existing)
      ) {
        await assertWorkflowPreDispatchOrphanRecoverable({
          stateRoot,
          taskContract: contract,
          operationId,
          operationKind: "visible-task-creation",
        });
        await removeExactPreDispatchState(stateRoot, location, {
          record: existing,
          claim: rawClaim === null ? undefined : validateClaim(rawClaim),
        });
        rawClaim = null;
        rawRecord = null;
      } else {
        await assertWorkflowTaskContractCurrent({
          stateRoot,
          runId: contract.run_id,
          planId: contract.plan_id,
          taskContract: contract,
        });
        throw new CliError("Visible-task creation record is not replayable");
      }
    }
    if (rawRecord !== null) throw new CliError("Visible-task creation recovery did not clear its exact record", 73);
    if (rawClaim !== null) {
      const claim = validateClaim(rawClaim);
      if (
        claim.contract_id !== contract.contract_id
        || claim.operation_id !== operationId
        || claim.request_digest !== requestDigest
        || claim.executor_branch !== executorBranch
      ) throw new CliError("Generated task contract is already claimed by a different creation request", 73);
      await assertWorkflowPreDispatchOrphanRecoverable({
        stateRoot,
        taskContract: contract,
        operationId,
        operationKind: "visible-task-creation",
        nativeRecordPresent: false,
      });
      await removeExactPreDispatchState(stateRoot, location, {
        record: undefined,
        claim,
      });
      rawClaim = null;
    }
    await assertWorkflowTaskContractCurrent({
      stateRoot,
      runId: contract.run_id,
      planId: contract.plan_id,
      taskContract: contract,
    });
    const claim = validateClaim({
      schema_version: 1,
      kind: "codex-flow-v07-visible-task-creation-claim",
      contract_id: contract.contract_id,
      operation_id: operationId,
      request_digest: requestDigest,
      executor_branch: executorBranch,
      launch_nonce: randomBytes(32).toString("hex"),
      prepared_at: nowIso(now),
    });
    const expected = buildRecord(identity, operationId, claim);
    const { commitWorkflowOperationPreparation } = await import("./workflow-journal-v07.mjs");
    await commitWorkflowOperationPreparation({
      stateRoot,
      visibleTaskRecord: expected,
      persistNative: async () => {
        await ensureExactJson(location.record, expected, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
        await ensureExactJson(location.claim, claim, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
      },
      compensateNative: () => removeExactPreDispatchState(
        stateRoot,
        location,
        { record: expected, claim },
        { allowMissingOwned: true },
      ),
    });
    return recordView(expected);
  });
  const prepared = executorBranch === null
    ? await prepare()
    : await withProcessLock({
      path: branchClaimPaths(stateRoot, executorBranch).lock,
      guardRoot: guardRoot(stateRoot),
      label: `visible task executor branch ${executorBranch}`,
    }, async () => {
      const conflicts = (await visibleTaskClaims(stateRoot)).filter((claim) => (
        claim.executor_branch === executorBranch
        && claim.contract_id !== contract.contract_id
      ));
      if (conflicts.length > 1) {
        throw new CliError(`Host-worktree executor branch has multiple retained claims: ${executorBranch}`, 73);
      }
      if (conflicts.length === 1) {
        await assertSelectorRejectedBranchReuse(
          stateRoot,
          await readClaimRecord(stateRoot, conflicts[0]),
          contract,
          executorBranch,
        );
      }
      return prepare();
    });
  return prepared;
}

export async function recordVisibleTaskCreationAttempt({
  stateRoot,
  operationId,
  hostSessionId,
  timeoutSeconds = 300,
  now = Date.now(),
}) {
  const timeout = requireInteger(timeoutSeconds, "timeout_seconds", { min: 5, max: 1800 });
  const session = requireText(hostSessionId, "host_session_id", { max: 128, safeId: true });
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task operation ${operationId}`,
  }, async () => {
    let record = (await readRecord(stateRoot, operationId)).record;
    const expired = closeExpired(record, now instanceof Date ? now.getTime() : now);
    if (stableStringify(expired) !== stableStringify(record)) {
      record = await writeRecord(stateRoot, operationId, expired);
    }
    if (record.attempt !== null) {
      const elapsed = (Date.parse(record.attempt.reconcile_by) - Date.parse(record.attempt.started_at)) / 1000;
      if (record.attempt.host_session_id !== session || elapsed !== timeout) {
        throw new CliError("Visible task creation already has a different one-shot attempt", 73);
      }
      return recordView(record, { dispatch_permitted: false });
    }
    if (record.status !== "prepared") throw new CliError(`Visible task creation is not dispatchable: ${record.status}`);
    const startedAt = nowIso(now);
    const attempt = {
      attempt_id: `visible-task-attempt-v1-${sha256(`${record.operation_id}:1`)}`,
      host_session_id: session,
      started_at: startedAt,
      reconcile_by: nowIso((now instanceof Date ? now.getTime() : now) + timeout * 1000),
    };
    record = await writeRecord(stateRoot, operationId, {
      ...record,
      status: "attempting",
      attempt,
      updated_at: startedAt,
    });
    const bootstrap = renderBootstrap(record);
    return recordView(record, {
      dispatch_permitted: true,
      bootstrap,
      host_request: {
        title: record.task_title,
        project_id: record.selector_evidence.requested.project_id,
        model: record.selector_evidence.requested.model,
        reasoning_effort: record.selector_evidence.requested.reasoning_effort,
        selector_rationale: record.selector_rationale,
        worktree: clone(record.selector_evidence.requested.worktree),
        prompt: bootstrap,
      },
    });
  });
}

function normalizeSelectorUpdate(value, record, { required }) {
  if (value === null) {
    if (required) throw new CliError("This reconciliation requires host-accepted selector evidence");
    return record.selector_evidence;
  }
  requireExactFields(value, { required: ["accepted", "observed"] }, "selector evidence update");
  const accepted = validateAcceptedSelectors(
    value.accepted,
    record.selector_evidence.requested,
    "selector evidence update.accepted",
  );
  if (required && accepted === null) throw new CliError("This reconciliation requires host-accepted selectors");
  const observed = validateObservedSelectors(value.observed, "selector evidence update.observed");
  if (
    record.selector_evidence.accepted !== null
    && stableStringify(record.selector_evidence.accepted) !== stableStringify(accepted)
  ) throw new CliError("Selector acceptance evidence conflicts with the provisional record");
  if (
    record.selector_evidence.observed !== null
    && stableStringify(record.selector_evidence.observed) !== stableStringify(observed)
  ) throw new CliError("Selector observation evidence conflicts with the provisional record");
  return {
    requested: clone(record.selector_evidence.requested),
    accepted: accepted ?? record.selector_evidence.accepted,
    observed: observed ?? record.selector_evidence.observed,
  };
}

function initialTurnFromHost(value, readyThreadId, launchNonce, bootstrapDigest) {
  requireExactFields(value, {
    required: ["source", "thread_id", "turn_id", "turn_index", "role", "content", "observed_at"],
  }, "initial host-visible turn");
  const source = requireEnum(
    value.source,
    ["host-observed", PRIVATE_DELEGATION_SOURCE],
    "initial_turn.source",
  );
  const expectedRole = source === PRIVATE_DELEGATION_SOURCE ? "delegation" : "user";
  const threadId = requireText(value.thread_id, "initial_turn.thread_id", { max: 256, safeId: true });
  if (threadId !== readyThreadId) throw new CliError("Initial task turn does not belong to the ready task ID");
  requireInteger(value.turn_index, "initial_turn.turn_index", { min: 1, max: 1 });
  requireEnum(value.role, [expectedRole], "initial_turn.role");
  const content = requireText(value.content, "initial_turn.content", { max: 64 * 1024 });
  const expectedMarker = visibleTaskLaunchMarker(launchNonce);
  const markers = [...content.matchAll(/CODEX_FLOW_LAUNCH_NONCE=([0-9a-f]{64})/g)];
  if (markers.length !== 1 || markers[0][0] !== expectedMarker) {
    throw new CliError("Ready identity requires the exact launch nonce in the initial host-visible turn");
  }
  if (sha256(content) !== bootstrapDigest) {
    throw new CliError("Ready identity requires the exact canonical bootstrap-only initial turn");
  }
  return validateInitialTurn({
    source,
    thread_id: threadId,
    turn_id: requireText(value.turn_id, "initial_turn.turn_id", { max: 256, safeId: true }),
    turn_index: 1,
    role: expectedRole,
    launch_nonce: launchNonce,
    content_digest: sha256(content),
    observed_at: requireTimestamp(value.observed_at, "initial_turn.observed_at"),
  }, readyThreadId, launchNonce);
}

function resolutionFor(outcome, reasonCode, timestamp) {
  const allowed = outcome === "ambiguous"
    ? AMBIGUOUS_REASONS
    : outcome === "not-created"
      ? NOT_CREATED_REASONS
      : SESSION_BLOCKED_REASONS;
  return {
    outcome,
    reason_code: requireEnum(reasonCode, allowed, "reason_code"),
    recorded_at: timestamp,
  };
}

async function transitionTerminalNoObjectClaim(stateRoot, record) {
  if (
    record.status !== "not-created"
    || record.resolution.reason_code !== "selector-rejected-before-task-identity"
  ) return;
  const { transitionWorkflowOperationClaim } = await import("./workflow-journal-v07.mjs");
  await transitionWorkflowOperationClaim({
    stateRoot,
    visibleTaskRecord: record,
  });
}

function worktreeInventory(commonDir) {
  const output = runGitReadOnly(
    commonDir,
    ["worktree", "list", "--porcelain", "-z"],
    "Visible-task worktree inventory",
  ).stdout;
  return output.split("\0\0").filter(Boolean).map((block) => {
    const fields = block.split("\0").filter(Boolean);
    const pathField = fields.find((field) => field.startsWith("worktree "));
    const headField = fields.find((field) => field.startsWith("HEAD "));
    if (!pathField || !headField) throw new CliError("Visible-task worktree inventory is incomplete");
    const branchField = fields.find((field) => field.startsWith("branch "));
    return {
      path: resolve(pathField.slice("worktree ".length)),
      head: requireRevision(headField.slice("HEAD ".length), "worktree inventory HEAD"),
      branch_ref: branchField === undefined
        ? null
        : requireText(branchField.slice("branch ".length), "worktree inventory branch", { max: 512 }),
      detached: fields.includes("detached"),
      bare: fields.includes("bare"),
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      prunable: fields.some((field) => field === "prunable" || field.startsWith("prunable ")),
    };
  });
}

function localBranchTip(commonDir, branch) {
  const result = runGitReadOnly(
    commonDir,
    ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
    "Visible-task executor branch tip",
    { allowStatuses: [0, 128] },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function runGitMutation(cwd, args, label) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
}

async function assertExclusiveWorktreeBindingReservation(stateRoot, record) {
  const requested = record.selector_evidence.requested.worktree;
  const commonDir = guardRoot(stateRoot);
  const { run } = await readRun({
    gitCommonDirectory: commonDir,
    runId: record.run_id,
  });
  if (run.status !== "active" || !run.plan.branch_fences.includes(requested.executor_branch)) {
    throw new CliError("Worktree binding requires its exact active run branch reservation", 73);
  }
  const conflicts = (await visibleTaskClaims(stateRoot)).filter((claim) => (
    claim.executor_branch === requested.executor_branch
    && claim.operation_id !== record.operation_id
  ));
  if (conflicts.length > 1) {
    throw new CliError(`Worktree binding branch has multiple retained claims: ${requested.executor_branch}`, 73);
  }
  if (conflicts.length === 1) {
    await assertSelectorRejectedBranchReuse(
      stateRoot,
      await readClaimRecord(stateRoot, conflicts[0]),
      record,
      requested.executor_branch,
    );
  }
  const { context: runtime } = await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: run.runtime_id,
  });
  const runtimeBinding = runtimeBindingFromContext(runtime);
  if (
    runtimeContextHash(runtime) !== run.runtime_context_hash
    || runtimeBinding.runtime_context_hash !== run.binding.runtime_context_hash
    || runtimeBinding.bundle_hash !== run.binding.bundle_hash
    || runtimeBinding.config_hash !== run.binding.config_hash
    || runtimeBinding.policy_hash !== run.binding.policy_hash
    || runtimeBinding.repository_hash !== run.binding.repository_hash
    || runtimeBinding.runtime_context_hash !== record.runtime_context_digest
    || runtimeBinding.config_hash !== record.configuration_digest
    || runtimeBinding.repository_hash !== record.repository_id
    || runtime.repository.common_dir !== record.common_dir
  ) throw new CliError("Worktree binding active run/runtime repository authority is inconsistent", 73);
  const coordinatorRoot = await realpath(runtime.repository.root).catch(() => null);
  if (coordinatorRoot === null) {
    throw new CliError("Worktree binding active coordinator repository root does not exist", 73);
  }
  const coordinatorSnapshot = gitSnapshot(coordinatorRoot);
  if (
    coordinatorSnapshot.root !== coordinatorRoot
    || coordinatorSnapshot.commonDir !== record.common_dir
  ) throw new CliError("Worktree binding active coordinator repository root drifted", 73);
  return { coordinatorRoot };
}

async function liveWorktreeBindingFacts(record, { phase, coordinatorRoot }) {
  const requested = record.selector_evidence.requested.worktree;
  const observed = record.selector_evidence.observed?.worktree ?? null;
  if (
    record.status !== "ready-unreleased"
    || !record.ready
    || requested.mode !== "host-worktree"
    || observed?.mode !== "host-worktree"
    || observed.path === null
  ) throw new CliError("Worktree binding requires a ready-unreleased host-worktree with an observed path", 73);

  const canonicalPath = await realpath(observed.path).catch(() => null);
  if (canonicalPath === null) throw new CliError("Observed host worktree path does not exist", 73);
  if (canonicalPath === coordinatorRoot) {
    throw new CliError("Observed host worktree must be distinct from the active coordinator repository root", 73);
  }
  const snapshot = gitSnapshot(canonicalPath);
  const canonicalRoot = await realpath(snapshot.root).catch(() => null);
  const canonicalCommonDir = await realpath(snapshot.commonDir).catch(() => null);
  const expectedCommonDir = await realpath(record.common_dir).catch(() => null);
  if (
    canonicalRoot !== canonicalPath
    || canonicalCommonDir === null
    || expectedCommonDir === null
    || canonicalCommonDir !== expectedCommonDir
    || record.common_dir !== expectedCommonDir
  ) throw new CliError("Observed host worktree path/common-dir authority drifted", 73);
  if (snapshot.revision !== requested.starting_revision) {
    throw new CliError("Observed host worktree is not at the exact task baseline", 73);
  }
  if (snapshot.cleanliness !== "clean") {
    throw new CliError("Observed host worktree must be pristine before objective release", 73);
  }

  const inventory = worktreeInventory(expectedCommonDir);
  const item = inventory.find((entry) => entry.path === canonicalPath);
  if (
    !item
    || item.head !== requested.starting_revision
    || item.bare
    || item.locked
    || item.prunable
  ) throw new CliError("Observed host worktree does not match canonical Git inventory", 73);
  if (inventory[0]?.path === canonicalPath) {
    throw new CliError("Host-created executor worktree must be distinct from the source checkout", 73);
  }
  const startingTip = localBranchTip(expectedCommonDir, requested.starting_branch);
  if (phase !== "completed" && startingTip !== requested.starting_revision) {
    throw new CliError("Host-worktree starting branch drifted from the authenticated baseline", 73);
  }

  const availability = gitBranchAvailability(canonicalPath, requested.executor_branch);
  if (availability.tracked_remote_exists) {
    throw new CliError("Reserved executor branch collides with fetched remote-tracking state", 73);
  }
  const expectedRef = `refs/heads/${requested.executor_branch}`;
  const otherAttachment = inventory.find((entry) => (
    entry.path !== canonicalPath && entry.branch_ref === expectedRef
  ));
  if (otherAttachment) throw new CliError("Reserved executor branch is attached to another worktree", 73);

  if (phase === "unprepared") {
    if (snapshot.branch !== "detached" || !item.detached || item.branch_ref !== null) {
      throw new CliError("Host worktree is already attached without an exact prepared binding intent", 73);
    }
    if (availability.local_exists) {
      throw new CliError("Reserved executor branch collides with an existing local branch", 73);
    }
  } else if (snapshot.branch === "detached") {
    if (phase === "completed") {
      throw new CliError("Completed worktree binding is on the wrong branch or detached", 73);
    }
    if (!item.detached || item.branch_ref !== null || availability.local_exists) {
      throw new CliError("Prepared worktree binding has ambiguous detached branch state", 73);
    }
  } else {
    if (
      snapshot.branch !== requested.executor_branch
      || item.detached
      || item.branch_ref !== expectedRef
      || !availability.local_exists
      || localBranchTip(expectedCommonDir, requested.executor_branch) !== requested.starting_revision
    ) throw new CliError("Prepared worktree binding is on the wrong or drifted branch", 73);
  }
  return {
    canonical_path: canonicalPath,
    common_dir: expectedCommonDir,
    executor_branch: requested.executor_branch,
    baseline_revision: requested.starting_revision,
    attached: snapshot.branch === requested.executor_branch,
  };
}

function bindingIntent(record, facts, preparedAt) {
  const seed = {
    schema_version: 1,
    kind: WORKTREE_BINDING_KIND,
    operation_id: record.operation_id,
    worktree_path: facts.canonical_path,
    common_dir: facts.common_dir,
    executor_branch: facts.executor_branch,
    baseline_revision: facts.baseline_revision,
  };
  return validateWorktreeBinding({
    ...seed,
    binding_id: worktreeBindingId(seed),
    state: "prepared",
    prepared_at: preparedAt,
    bound_at: null,
  });
}

function assertBindingIntentMatches(record, binding, facts) {
  const expected = bindingIntent(record, facts, binding.prepared_at);
  if (stableStringify({ ...binding, state: "prepared", bound_at: null }) !== stableStringify(expected)) {
    throw new CliError("Persisted worktree binding intent does not match live host-worktree authority", 73);
  }
}

export async function bindVisibleTaskWorktree({
  stateRoot,
  operationId,
  now = Date.now(),
  hooks = {},
}) {
  const location = paths(stateRoot, operationId);
  const initial = (await readRecord(stateRoot, operationId)).record;
  const branch = initial.selector_evidence.requested.worktree.executor_branch;
  if (branch === null) throw new CliError("Worktree binding is reserved for host-worktree creation", 73);
  return withProcessLock({
    path: branchClaimPaths(stateRoot, branch).lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task worktree binding branch ${branch}`,
  }, () => withProcessLock({
    path: location.operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task operation ${operationId}`,
  }, async () => {
    let record = (await readRecord(stateRoot, operationId)).record;
    const { coordinatorRoot } = await assertExclusiveWorktreeBindingReservation(stateRoot, record);
    if (record.worktree_binding?.state === "completed") {
      const facts = await liveWorktreeBindingFacts(record, { phase: "completed", coordinatorRoot });
      assertBindingIntentMatches(record, record.worktree_binding, facts);
      return recordView(record, { binding_performed: false });
    }

    const completionAt = nowIso(now);
    if (record.worktree_binding === null) {
      const facts = await liveWorktreeBindingFacts(record, { phase: "unprepared", coordinatorRoot });
      const preparedAt = completionAt;
      const intent = bindingIntent(record, facts, preparedAt);
      record = await writeRecord(stateRoot, operationId, {
        ...record,
        worktree_binding: intent,
        updated_at: preparedAt,
      });
      await hooks.afterPreparedIntent?.({ record: clone(record), binding: clone(intent) });
    }
    if (Date.parse(completionAt) < Date.parse(record.worktree_binding.prepared_at)) {
      throw new CliError("Worktree binding completion time predates prepared intent", 73);
    }

    let facts = await liveWorktreeBindingFacts(record, { phase: "prepared", coordinatorRoot });
    assertBindingIntentMatches(record, record.worktree_binding, facts);
    if (!facts.attached) {
      runGitMutation(facts.canonical_path, [
        "switch", "--no-track", "-c", facts.executor_branch, facts.baseline_revision,
      ], "Detached host-worktree branch binding");
    }
    await hooks.afterBranchSwitch?.({ binding: clone(record.worktree_binding) });
    facts = await liveWorktreeBindingFacts(record, { phase: "completed", coordinatorRoot });
    assertBindingIntentMatches(record, record.worktree_binding, facts);
    const completed = validateWorktreeBinding({
      ...record.worktree_binding,
      state: "completed",
      bound_at: completionAt,
    });
    record = await writeRecord(stateRoot, operationId, {
      ...record,
      worktree_binding: completed,
      updated_at: completed.bound_at,
    });
    return recordView(record, { binding_performed: true });
  }));
}

export async function authenticateVisibleTaskWorktreeBinding({ stateRoot, operationId }) {
  const record = (await readRecord(stateRoot, operationId)).record;
  if (record.worktree_binding?.state !== "completed") {
    throw new CliError("Task release requires completed worktree binding", 73);
  }
  const { coordinatorRoot } = await assertExclusiveWorktreeBindingReservation(stateRoot, record);
  const facts = await liveWorktreeBindingFacts(record, { phase: "completed", coordinatorRoot });
  assertBindingIntentMatches(record, record.worktree_binding, facts);
  return {
    creation: recordView(record),
    binding: clone(record.worktree_binding),
    repository: {
      root: facts.canonical_path,
      common_dir: facts.common_dir,
      branch: facts.executor_branch,
      revision: facts.baseline_revision,
      cleanliness: "clean",
    },
  };
}

export async function reconcileVisibleTaskCreation({
  stateRoot,
  operationId,
  outcome,
  provisionalClientThreadId = null,
  readyThreadId = null,
  initialTurn = null,
  privateResolution = null,
  selectorEvidence = null,
  reasonCode = null,
  now = Date.now(),
}) {
  const result = requireEnum(
    outcome,
    ["provisional", "ready", "ambiguous", "not-created", "session-blocked"],
    "task creation outcome",
  );
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task operation ${operationId}`,
  }, async () => {
    let record = (await readRecord(stateRoot, operationId)).record;
    if (record.attempt === null) throw new CliError("Visible task creation must record its one-shot attempt before reconciliation");
    const timestamp = nowIso(now);
    const expired = closeExpired(record, Date.parse(timestamp));
    if (stableStringify(expired) !== stableStringify(record)) {
      record = await writeRecord(stateRoot, operationId, expired);
    }

    if (result === "provisional") {
      if (
        reasonCode !== null
        || readyThreadId !== null
        || initialTurn !== null
        || privateResolution !== null
      ) {
        throw new CliError("Provisional reconciliation accepts only clientThreadId and selector evidence");
      }
      const clientThreadId = requireProvisionalClientThreadId(
        provisionalClientThreadId,
        "provisional_client_thread_id",
      );
      const evidence = normalizeSelectorUpdate(selectorEvidence, record, { required: true });
      if (evidence.observed !== null) {
        throw new CliError("Provisional reconciliation cannot record observed selectors before ready task identity");
      }
      if (selectorMismatches(evidence).length > 0) {
        throw new CliError("Selector mismatch cannot be reconciled as a provisional ready identity");
      }
      const provisional = {
        client_thread_id: clientThreadId,
        observed_at: timestamp,
        recorded_at: timestamp,
      };
      if (record.status === "provisional") {
        if (
          record.provisional.client_thread_id !== provisional.client_thread_id
          || stableStringify(record.selector_evidence) !== stableStringify(evidence)
        ) throw new CliError("Provisional reconciliation replay conflicts with recorded identity", 73);
        return recordView(record);
      }
      if (record.status !== "attempting") {
        throw new CliError(`Visible task creation is already reconciled as ${record.status}`);
      }
      return recordView(await writeRecord(stateRoot, operationId, {
        ...record,
        status: "provisional",
        provisional,
        selector_evidence: evidence,
        updated_at: timestamp,
      }));
    }

    if (result === "ready") {
      if (reasonCode !== null) throw new CliError("Ready reconciliation does not accept a terminal reason");
      const threadId = requireText(readyThreadId, "ready_thread_id", { max: 256, safeId: true });
      const clientThreadId = provisionalClientThreadId === null
        ? record.provisional?.client_thread_id ?? null
        : requireProvisionalClientThreadId(provisionalClientThreadId);
      if (record.provisional && clientThreadId !== record.provisional.client_thread_id) {
        throw new CliError("Ready reconciliation does not match the recorded provisional clientThreadId");
      }
      if (clientThreadId === threadId) {
        throw new CliError("Provisional clientThreadId must remain distinct from the ready task ID");
      }
      const evidence = normalizeSelectorUpdate(selectorEvidence, record, { required: true });
      const mismatches = selectorMismatches(evidence);
      if (mismatches.length > 0) {
        throw new CliError(`Ready task selector evidence conflicts with the request: ${mismatches.join(", ")}`);
      }
      if (initialTurn === null) {
        throw new CliError("Ready task identity requires the exact initial host-visible turn evidence");
      }
      const privateAuthority = validatePrivateResolution(privateResolution);
      const privateSource = initialTurn.source === PRIVATE_DELEGATION_SOURCE;
      if (privateSource !== (privateAuthority !== null)) {
        throw new CliError("Private delegation and private resolution evidence must be supplied together");
      }
      const latePrivateRecovery = record.status === "ambiguous"
        && record.resolution?.outcome === "ambiguous"
        && record.resolution.reason_code === "reconciliation-window-expired";
      if (privateAuthority !== null) {
        if (
          !["provisional", "ready-unreleased"].includes(record.status)
          && !latePrivateRecovery
        ) {
          throw new CliError(
            "Private task resolution requires an open provisional identity or its exact expired ambiguity",
          );
        }
        if (
          clientThreadId === null
          || privateAuthority.provisional_client_thread_id !== clientThreadId
          || privateAuthority.ready_thread_id !== threadId
        ) throw new CliError("Private task resolution does not match the recorded host identities");
        if (
          privateAuthority.accepted_selector_digest
          !== privateAcceptedSelectorDigest(evidence.accepted)
        ) throw new CliError("Private task resolution does not match the accepted selector evidence");
        if (
          latePrivateRecovery
          && record.selector_evidence.accepted === null
          && evidence.accepted.accepted_at !== privateAuthority.provisional_observed_at
        ) throw new CliError("Late private recovery accepted_at does not match the source creation event");
      }
      if (
        record.provisional === null
        && clientThreadId !== null
        && !(latePrivateRecovery && privateAuthority !== null)
      ) {
        throw new CliError("Ready reconciliation cannot introduce an unrecorded provisional clientThreadId");
      }
      const provisional = privateAuthority !== null
        ? {
          client_thread_id: privateAuthority.provisional_client_thread_id,
          // Private source evidence refines an earlier coordinator observation
          // without backdating when that identity was durably recorded.
          observed_at: privateAuthority.provisional_observed_at,
          recorded_at: record.provisional?.recorded_at ?? timestamp,
        }
        : record.provisional;
      const ready = {
        thread_id: threadId,
        initial_turn: initialTurnFromHost(
          initialTurn,
          threadId,
          record.launch_nonce,
          record.bootstrap_digest,
        ),
        recorded_at: timestamp,
      };
      if (Date.parse(ready.initial_turn.observed_at) >= Date.parse(record.attempt.reconcile_by)) {
        throw new CliError("Ready identity was not observed within the bounded reconciliation window");
      }
      if (record.status === "ready-unreleased") {
        if (
          record.ready.thread_id !== ready.thread_id
          || stableStringify(record.ready.initial_turn) !== stableStringify(ready.initial_turn)
          || stableStringify(record.private_resolution) !== stableStringify(privateAuthority)
          || stableStringify(record.selector_evidence) !== stableStringify(evidence)
        ) throw new CliError("Ready reconciliation replay conflicts with recorded identity", 73);
        return recordView(record);
      }
      if (latePrivateRecovery && privateAuthority === null) {
        throw new CliError(
          "Expired task creation can recover only from authenticated private task evidence",
          73,
        );
      }
      if (!["attempting", "provisional"].includes(record.status) && !latePrivateRecovery) {
        throw new CliError(`Visible task creation is already reconciled as ${record.status}`);
      }
      const recovery = latePrivateRecovery
        ? {
          schema_version: 1,
          kind: LATE_PRIVATE_RECOVERY_KIND,
          source: PRIVATE_TASK_RESOLUTION_SOURCE,
          expired_resolution_digest: sha256(stableStringify(record.resolution)),
          recovered_at: timestamp,
        }
        : null;
      return recordView(await writeRecord(stateRoot, operationId, {
        ...record,
        status: "ready-unreleased",
        provisional,
        ready,
        private_resolution: privateAuthority,
        late_private_recovery: recovery,
        resolution: latePrivateRecovery ? record.resolution : null,
        selector_evidence: evidence,
        updated_at: timestamp,
      }));
    }

    if (readyThreadId !== null || initialTurn !== null || privateResolution !== null) {
      throw new CliError("Terminal task-creation reconciliation cannot claim a ready task identity");
    }
    if (["not-created", "session-blocked"].includes(result) && record.status !== "attempting") {
      throw new CliError(`${result} is valid only before a provisional identity exists`);
    }
    if (provisionalClientThreadId !== null && record.provisional === null) {
      throw new CliError("Terminal reconciliation cannot introduce an unrecorded provisional clientThreadId");
    }
    const clientThreadId = provisionalClientThreadId === null
      ? record.provisional?.client_thread_id ?? null
      : requireProvisionalClientThreadId(provisionalClientThreadId);
    if (record.provisional && clientThreadId !== record.provisional.client_thread_id) {
      throw new CliError("Terminal reconciliation conflicts with the recorded provisional clientThreadId");
    }
    const evidence = normalizeSelectorUpdate(selectorEvidence, record, { required: false });
    if (evidence.observed !== null) {
      throw new CliError("Terminal reconciliation cannot record observed selectors before ready task identity");
    }
    const resolution = resolutionFor(result, reasonCode, timestamp);
    if (["ambiguous", "not-created", "session-blocked"].includes(record.status)) {
      if (
        record.status !== result
        || record.resolution.reason_code !== resolution.reason_code
        || stableStringify(record.selector_evidence) !== stableStringify(evidence)
      ) throw new CliError("Terminal reconciliation replay conflicts with recorded outcome", 73);
      await transitionTerminalNoObjectClaim(stateRoot, record);
      return recordView(record);
    }
    if (!["attempting", "provisional"].includes(record.status)) {
      throw new CliError(`Visible task creation is already reconciled as ${record.status}`);
    }
    const terminal = await writeRecord(stateRoot, operationId, {
      ...record,
      status: result,
      provisional: record.provisional,
      selector_evidence: evidence,
      resolution,
      updated_at: timestamp,
    });
    await transitionTerminalNoObjectClaim(stateRoot, terminal);
    return recordView(terminal);
  });
}

export async function resolvePrivateVisibleTaskCreationRecord({
  record: sourceRecord,
  codexHome,
  now = Date.now(),
}) {
  const record = validateVisibleTaskCreationRecord(sourceRecord);
  const exactExpiredAmbiguity = record.status === "ambiguous"
    && record.resolution?.outcome === "ambiguous"
    && record.resolution.reason_code === "reconciliation-window-expired";
  if (
    (record.provisional === null && !exactExpiredAmbiguity)
    || (record.status !== "provisional" && !exactExpiredAmbiguity)
  ) {
    throw new CliError(
      "Private task resolution requires an open provisional creation or its exact expired ambiguity",
    );
  }
  const recovered = await resolveCodexAppPrivateTask({
    provisionalClientThreadId: record.provisional?.client_thread_id ?? null,
    sourceThreadId: record.coordinator_binding.thread_id,
    bootstrap: renderBootstrap(record),
    taskTitle: record.task_title,
    requestedSelectors: record.selector_evidence.requested,
    attemptStartedAt: record.attempt.started_at,
    reconcileBy: record.attempt.reconcile_by,
    codexHome,
    now,
  });
  return {
    schema_version: 1,
    kind: "codex-flow-v07-private-task-resolution-result",
    run_id: record.run_id,
    operation_id: record.operation_id,
    private_host_surface: true,
    reconcile_request: {
      run_id: record.run_id,
      operation_id: record.operation_id,
      outcome: "ready",
      provisional_client_thread_id: recovered.resolution.provisional_client_thread_id,
      ready_thread_id: recovered.resolution.ready_thread_id,
      initial_turn: recovered.initial_turn,
      private_resolution: recovered.resolution,
      selector_evidence: {
        accepted: clone(record.selector_evidence.accepted ?? recovered.accepted_selectors),
        observed: recovered.observed_selectors,
      },
    },
  };
}

export async function resolvePrivateVisibleTaskCreation({
  stateRoot,
  operationId,
  codexHome,
  now = Date.now(),
}) {
  const record = await visibleTaskCreationRecordStatus({ stateRoot, operationId, now });
  return resolvePrivateVisibleTaskCreationRecord({ record, codexHome, now });
}

async function visibleTaskCreationRecordStatus({ stateRoot, operationId, now = Date.now() }) {
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.operation_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task operation ${operationId}`,
  }, async () => {
    let record = (await readRecord(stateRoot, operationId)).record;
    const closed = closeExpired(record, now instanceof Date ? now.getTime() : now);
    if (stableStringify(closed) !== stableStringify(record)) {
      record = await writeRecord(stateRoot, operationId, closed);
    }
    return record;
  });
}

export async function visibleTaskCreationStatus({ stateRoot, operationId, now = Date.now() }) {
  return recordView(await visibleTaskCreationRecordStatus({ stateRoot, operationId, now }));
}
