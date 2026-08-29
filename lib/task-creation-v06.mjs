import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
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
} from "./core.mjs";
import { REASONING_EFFORTS } from "./config.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { assertWorkflowTaskContractCurrent } from "./workflow-journal-v06.mjs";
import { validateGeneratedTaskContract } from "./workflow-plan.mjs";

export const VISIBLE_TASK_CREATION_SCHEMA_VERSION = 1;
export const VISIBLE_TASK_CREATION_KIND = "codex-flow-v06-visible-task-creation";

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
  "host-rejected-before-create",
  "create-returned-not-created",
];
const SESSION_BLOCKED_REASONS = [
  "argument-serialization",
  "adapter-unavailable",
  "backend-unavailable",
  "schema-runtime-drift",
  "host-control-failure",
];

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

function validateProvisional(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["client_thread_id", "recorded_at"] }, "provisional identity");
  return {
    client_thread_id: requireText(value.client_thread_id, "client_thread_id", { max: 256, safeId: true }),
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
  if (value.source !== "host-observed") throw new CliError("Initial turn evidence must be host-observed");
  const evidence = {
    source: "host-observed",
    thread_id: requireText(value.thread_id, "initial_turn.thread_id", { max: 256, safeId: true }),
    turn_id: requireText(value.turn_id, "initial_turn.turn_id", { max: 256, safeId: true }),
    turn_index: requireInteger(value.turn_index, "initial_turn.turn_index", { min: 1, max: 1 }),
    role: requireEnum(value.role, ["user"], "initial_turn.role"),
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
    requested_selectors: value.selector_evidence.requested,
  };
}

function operationIdForSeed(seed) {
  return `visible-task-operation-v1-${sha256(stableStringify(seed))}`;
}

function renderBootstrap(value) {
  const marker = visibleTaskLaunchMarker(value.launch_nonce);
  return [
    "# Codex Flow v0.6 visible-task bootstrap",
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
      "task_id", "task_digest", "contract_id", "task_title",
      "launch_nonce", "bootstrap_digest", "selector_evidence", "status",
      "attempt", "provisional", "ready", "resolution", "prepared_at", "updated_at",
    ],
  }, "Visible task creation record");
  if (value.schema_version !== VISIBLE_TASK_CREATION_SCHEMA_VERSION || value.kind !== VISIBLE_TASK_CREATION_KIND) {
    throw new CliError("Unsupported v0.6 visible task creation record");
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
    resolution: validateResolution(value.resolution),
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
    Date.parse(record.provisional.recorded_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.provisional.recorded_at) > Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Provisional identity was not recorded within the bounded reconciliation window");
  if (record.selector_evidence.accepted && record.attempt && (
    Date.parse(record.selector_evidence.accepted.accepted_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.selector_evidence.accepted.accepted_at) > Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Host-accepted selector evidence falls outside the bounded reconciliation window");
  if (
    record.selector_evidence.accepted
    && Date.parse(record.selector_evidence.accepted.accepted_at) > Date.parse(record.updated_at)
  ) throw new CliError("Task creation update predates its host-accepted selector evidence");
  if (record.selector_evidence.observed && record.attempt && (
    Date.parse(record.selector_evidence.observed.observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.selector_evidence.observed.observed_at) > Date.parse(record.attempt.reconcile_by)
  )) throw new CliError("Host-observed selector evidence falls outside the bounded reconciliation window");
  if (
    record.selector_evidence.observed
    && Date.parse(record.selector_evidence.observed.observed_at) > Date.parse(record.updated_at)
  ) throw new CliError("Task creation update predates its host-observed selector evidence");
  if (record.ready && record.attempt && (
    Date.parse(record.ready.initial_turn.observed_at) < Date.parse(record.attempt.started_at)
    || Date.parse(record.ready.initial_turn.observed_at) > Date.parse(record.attempt.reconcile_by)
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
  if (record.resolution && record.attempt && (
    Date.parse(record.resolution.recorded_at) < Date.parse(record.attempt.started_at)
  )) throw new CliError("Task creation resolution predates its native attempt");
  if (record.resolution && Date.parse(record.resolution.recorded_at) > Date.parse(record.updated_at)) {
    throw new CliError("Task creation update predates its terminal resolution");
  }
  if (record.provisional && record.ready && record.provisional.client_thread_id === record.ready.thread_id) {
    throw new CliError("Provisional clientThreadId must remain distinct from the ready task ID");
  }

  const hasAttempt = record.attempt !== null;
  const hasAccepted = record.selector_evidence.accepted !== null;
  const mismatches = selectorMismatches(record.selector_evidence);
  if (record.status === "prepared") {
    if (hasAttempt || record.provisional || record.ready || record.resolution || hasAccepted || record.selector_evidence.observed) {
      throw new CliError("Prepared task creation cannot contain host-attempt evidence");
    }
  } else if (!hasAttempt) {
    throw new CliError(`Task creation status ${record.status} requires its single recorded attempt`);
  }
  if (record.status === "attempting") {
    if (record.provisional || record.ready || record.resolution || hasAccepted || record.selector_evidence.observed) {
      throw new CliError("Attempting task creation cannot contain reconciliation evidence");
    }
  }
  if (record.status === "provisional") {
    if (!record.provisional || record.ready || record.resolution || !hasAccepted || mismatches.length > 0) {
      throw new CliError("Provisional task creation requires compatible accepted selectors and only a clientThreadId");
    }
  }
  if (record.status === "ready-unreleased") {
    if (!record.ready || record.resolution || !hasAccepted || mismatches.length > 0) {
      throw new CliError("Ready task creation requires exact nonce identity and compatible selector evidence");
    }
  }
  if (["ambiguous", "not-created", "session-blocked"].includes(record.status)) {
    if (!record.resolution || record.resolution.outcome !== record.status || record.ready) {
      throw new CliError(`Task creation status ${record.status} requires its matching terminal resolution`);
    }
  }
  if (["not-created", "session-blocked"].includes(record.status) && (
    record.provisional || hasAccepted || record.selector_evidence.observed
  )) throw new CliError(`${record.status} task creation cannot claim accepted or observed host identity`);
  return record;
}

function recordView(record, extras = {}) {
  const value = validateVisibleTaskCreationRecord(record);
  return {
    ...clone(value),
    attempt_permitted: value.status === "prepared",
    release_permitted: value.status === "ready-unreleased",
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

function validateClaim(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "contract_id", "operation_id",
      "request_digest", "launch_nonce", "prepared_at",
    ],
  }, "visible task creation claim");
  if (value.schema_version !== 1 || value.kind !== "codex-flow-v06-visible-task-creation-claim") {
    throw new CliError("Unsupported visible task creation claim");
  }
  return {
    schema_version: 1,
    kind: "codex-flow-v06-visible-task-creation-claim",
    contract_id: requireDigest(value.contract_id, "claim.contract_id"),
    operation_id: requireText(value.operation_id, "claim.operation_id", { max: 128, safeId: true }),
    request_digest: requireDigest(value.request_digest, "claim.request_digest"),
    launch_nonce: requireDigest(value.launch_nonce, "claim.launch_nonce"),
    prepared_at: requireTimestamp(value.prepared_at, "claim.prepared_at"),
  };
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
    resolution: null,
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
  await assertWorkflowTaskContractCurrent({
    stateRoot,
    runId: contract.run_id,
    planId: contract.plan_id,
    taskContract: contract,
  });
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
  return withProcessLock({
    path: location.contract_lock,
    guardRoot: guardRoot(stateRoot),
    label: `visible task contract ${contract.contract_id}`,
  }, async () => {
    const rawClaim = await readJson(location.claim, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    let claim;
    if (rawClaim) {
      claim = validateClaim(rawClaim);
      if (
        claim.contract_id !== contract.contract_id
        || claim.operation_id !== operationId
        || claim.request_digest !== requestDigest
      ) throw new CliError("Generated task contract is already claimed by a different creation request", 73);
    } else {
      claim = validateClaim({
        schema_version: 1,
        kind: "codex-flow-v06-visible-task-creation-claim",
        contract_id: contract.contract_id,
        operation_id: operationId,
        request_digest: requestDigest,
        launch_nonce: randomBytes(32).toString("hex"),
        prepared_at: nowIso(now),
      });
      await ensureExactJson(location.claim, claim, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    }
    const expected = buildRecord(identity, operationId, claim);
    const rawRecord = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    if (rawRecord) {
      const existing = validateVisibleTaskCreationRecord(rawRecord);
      const immutable = [
        "operation_id", "run_id", "runtime_context_digest", "configuration_digest",
        "repository_id", "common_dir", "coordinator_binding", "plan_id",
        "revision_digest", "task_id", "task_digest", "contract_id", "task_title",
        "launch_nonce", "bootstrap_digest",
      ];
      const existingIdentity = Object.fromEntries(immutable.map((field) => [field, existing[field]]));
      const expectedIdentity = Object.fromEntries(immutable.map((field) => [field, expected[field]]));
      if (
        stableStringify(existingIdentity) !== stableStringify(expectedIdentity)
        || stableStringify(existing.selector_evidence.requested) !== stableStringify(requested)
      ) throw new CliError("Existing task-creation record does not match the authenticated contract", 73);
      return recordView(existing);
    }
    await ensureExactJson(location.record, expected, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    return recordView(expected);
  });
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
  if (value.source !== "host-observed") throw new CliError("Initial task turn must be host-observed");
  const threadId = requireText(value.thread_id, "initial_turn.thread_id", { max: 256, safeId: true });
  if (threadId !== readyThreadId) throw new CliError("Initial task turn does not belong to the ready task ID");
  requireInteger(value.turn_index, "initial_turn.turn_index", { min: 1, max: 1 });
  requireEnum(value.role, ["user"], "initial_turn.role");
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
    source: "host-observed",
    thread_id: threadId,
    turn_id: requireText(value.turn_id, "initial_turn.turn_id", { max: 256, safeId: true }),
    turn_index: 1,
    role: "user",
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

export async function reconcileVisibleTaskCreation({
  stateRoot,
  operationId,
  outcome,
  provisionalClientThreadId = null,
  readyThreadId = null,
  initialTurn = null,
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
    const record = (await readRecord(stateRoot, operationId)).record;
    if (record.attempt === null) throw new CliError("Visible task creation must record its one-shot attempt before reconciliation");
    const timestamp = nowIso(now);

    if (result === "provisional") {
      if (reasonCode !== null || readyThreadId !== null || initialTurn !== null) {
        throw new CliError("Provisional reconciliation accepts only clientThreadId and selector evidence");
      }
      const clientThreadId = requireText(
        provisionalClientThreadId,
        "provisional_client_thread_id",
        { max: 256, safeId: true },
      );
      const evidence = normalizeSelectorUpdate(selectorEvidence, record, { required: true });
      if (selectorMismatches(evidence).length > 0) {
        throw new CliError("Selector mismatch cannot be reconciled as a provisional ready identity");
      }
      const provisional = { client_thread_id: clientThreadId, recorded_at: timestamp };
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
      if (Date.parse(timestamp) > Date.parse(record.attempt.reconcile_by)) {
        throw new CliError("Provisional identity was not recovered within the bounded reconciliation window");
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
      if (provisionalClientThreadId !== null && record.provisional === null) {
        throw new CliError("Ready reconciliation cannot introduce an unrecorded provisional clientThreadId");
      }
      const clientThreadId = provisionalClientThreadId === null
        ? record.provisional?.client_thread_id ?? null
        : requireText(provisionalClientThreadId, "provisional_client_thread_id", { max: 256, safeId: true });
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
      if (Date.parse(ready.initial_turn.observed_at) > Date.parse(record.attempt.reconcile_by)) {
        throw new CliError("Ready identity was not observed within the bounded reconciliation window");
      }
      if (record.status === "ready-unreleased") {
        if (
          record.ready.thread_id !== ready.thread_id
          || stableStringify(record.ready.initial_turn) !== stableStringify(ready.initial_turn)
          || stableStringify(record.selector_evidence) !== stableStringify(evidence)
        ) throw new CliError("Ready reconciliation replay conflicts with recorded identity", 73);
        return recordView(record);
      }
      if (!["attempting", "provisional"].includes(record.status)) {
        throw new CliError(`Visible task creation is already reconciled as ${record.status}`);
      }
      return recordView(await writeRecord(stateRoot, operationId, {
        ...record,
        status: "ready-unreleased",
        provisional: record.provisional,
        ready,
        selector_evidence: evidence,
        updated_at: timestamp,
      }));
    }

    if (readyThreadId !== null || initialTurn !== null) {
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
      : requireText(provisionalClientThreadId, "provisional_client_thread_id", { max: 256, safeId: true });
    if (record.provisional && clientThreadId !== record.provisional.client_thread_id) {
      throw new CliError("Terminal reconciliation conflicts with the recorded provisional clientThreadId");
    }
    const evidence = normalizeSelectorUpdate(selectorEvidence, record, { required: false });
    const resolution = resolutionFor(result, reasonCode, timestamp);
    if (["ambiguous", "not-created", "session-blocked"].includes(record.status)) {
      if (
        record.status !== result
        || record.resolution.reason_code !== resolution.reason_code
        || stableStringify(record.selector_evidence) !== stableStringify(evidence)
      ) throw new CliError("Terminal reconciliation replay conflicts with recorded outcome", 73);
      return recordView(record);
    }
    if (!["attempting", "provisional"].includes(record.status)) {
      throw new CliError(`Visible task creation is already reconciled as ${record.status}`);
    }
    return recordView(await writeRecord(stateRoot, operationId, {
      ...record,
      status: result,
      provisional: record.provisional,
      selector_evidence: evidence,
      resolution,
      updated_at: timestamp,
    }));
  });
}

export async function visibleTaskCreationStatus({ stateRoot, operationId, now = Date.now() }) {
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
    return recordView(record);
  });
}
