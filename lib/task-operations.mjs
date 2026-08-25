import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
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
import {
  requireAvailableGitBranch,
  gitCommonDirectoryForState,
  gitLocalBranchRevision,
  gitSnapshot,
} from "./git.mjs";
import {
  isLaunchExpired,
  validateLaunchDeadline,
  validateTaskBaseline,
  validateTaskEnvironment,
  validateTaskPacket,
} from "./task-packet.mjs";

const OPERATION_KIND = "codex-flow-task-create-operation";
const MAX_ATTEMPTS = 32;
const MAX_HOST_PREFLIGHTS = 64;
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SUPPORT_STATES = ["supported", "unsupported", "unknown", "not-required"];
const SUPPORT_BASES = [
  "tool-schema",
  "open-selector",
  "closed-selector",
  "fixed-role",
  "host-contract",
  "not-required",
  "unavailable",
];
const DISCOVERY_QUERY_STATES = ["supported", "rejected", "unavailable", "not-applicable"];
const DISCOVERY_FALLBACKS = ["bounded-unfiltered", "exact-read", "none"];
const HOST_SESSION_FAILURE_CODES = [
  "argument-serialization",
  "adapter-unavailable",
  "backend-unavailable",
  "schema-runtime-drift",
  "host-control-failure",
];
const TITLE_SOURCES = ["host-observed", "unavailable"];
const TITLE_NORMALIZATIONS = ["none", "bounded-host-write", "not-applicable"];
const VISIBILITY_SOURCES = ["host-observed", "host-contract"];
const SELECTOR_EVIDENCE_SOURCES = [
  "host-observed",
  "host-accepted",
  "role-contract",
  "unavailable",
];
const HOST_LABEL_SOURCES = ["host-observed", "unavailable"];
const EXECUTION_PATH_SOURCES = ["host-observed", "not-required", "unavailable"];

function operationGuardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe task-operation state path");
  }
  return path;
}

function operationPaths(stateRoot, operationId) {
  requireText(operationId, "operation_id", { max: 96, safeId: true });
  const root = resolve(stateRoot, "task-operations");
  return {
    root,
    record: safeChild(resolve(root, "records"), `${operationId}.json`),
    lock: safeChild(resolve(root, "locks"), `${operationId}.lock.json`),
  };
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function launchExpired(deadline, now = Date.now()) {
  return isLaunchExpired(deadline, now);
}

function requireTimestamp(value, label) {
  const text = requireText(value, label, { max: 64 });
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new CliError(`${label} must be an ISO timestamp with an explicit UTC offset`);
  }
  return text;
}

function operationIdFromFields(projectId, taskId, runId, executionKind) {
  return `task-operation-v1-${sha256(stableStringify({
    schema_version: 1,
    project_id: projectId,
    task_id: taskId,
    run_id: runId,
    execution_kind: executionKind,
  }))}`;
}

async function canonicalExistingPath(path, label) {
  try {
    return await realpath(resolve(path));
  } catch (error) {
    if (error?.code === "ENOENT") throw new CliError(`${label} does not exist`);
    throw error;
  }
}

async function authenticateTaskBaseline({ stateRoot, baseline, environment }) {
  if (environment.type === "projectless") return;

  const sourcePath = environment.type === "host-worktree"
    ? environment.repository_path
    : environment.project_path;
  const projectRoot = await canonicalExistingPath(sourcePath, "Task packet repository path");
  const snapshot = gitSnapshot(projectRoot);
  const discoveredRoot = await canonicalExistingPath(snapshot.root, "Discovered Git worktree root");
  if (projectRoot !== discoveredRoot) {
    throw new CliError("Task packet repository path must identify an exact Git worktree root");
  }

  const operationCommon = await canonicalExistingPath(
    gitCommonDirectoryForState(stateRoot),
    "Task-operation Git common directory",
  );
  const projectCommon = await canonicalExistingPath(snapshot.commonDir, "Task packet Git common directory");
  if (operationCommon !== projectCommon) {
    throw new CliError("Task packet project does not share this operation journal's Git common directory");
  }
  if (environment.type === "host-worktree") {
    if (gitLocalBranchRevision(projectRoot, environment.starting_branch) !== baseline.revision) {
      throw new CliError("Task packet baseline revision does not match the host-worktree starting branch");
    }
    requireAvailableGitBranch(projectRoot, environment.executor_branch);
  } else {
    if (baseline.revision !== snapshot.revision) {
      throw new CliError("Task packet baseline revision does not match the project HEAD");
    }
    const cleanliness = snapshot.cleanliness === "clean" ? "clean" : "dirty-authorized";
    if (baseline.cleanliness !== cleanliness) {
      throw new CliError("Task packet baseline cleanliness does not match the project worktree");
    }
  }
}

export function taskOperationIdFor(projectId, packet) {
  return operationIdFromFields(projectId, packet.task_id, packet.run_id, packet.execution_kind);
}

function requireNullableText(value, label, options = {}) {
  return value === null ? null : requireText(value, label, options);
}

function validateSupportEvidence(value, label) {
  requireExactFields(value, { required: ["state", "basis"] }, label);
  const state = requireEnum(value.state, SUPPORT_STATES, `${label}.state`);
  const basis = requireEnum(value.basis, SUPPORT_BASES, `${label}.basis`);
  if ((state === "not-required") !== (basis === "not-required")) {
    throw new CliError(`${label} not-required state and basis must match`);
  }
  if (state === "unknown" && basis !== "unavailable") {
    throw new CliError(`${label} unknown support requires unavailable evidence`);
  }
  if (state === "unsupported" && ["not-required", "unavailable", "open-selector"].includes(basis)) {
    throw new CliError(`${label} unsupported state requires positive closed-contract evidence`);
  }
  if (state === "supported" && ["not-required", "unavailable"].includes(basis)) {
    throw new CliError(`${label} supported state requires positive evidence`);
  }
  return { state, basis };
}

export function validateHostCapabilityEvidence(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "adapter_id", "host_session_id", "checked_at",
      "execution_kind", "environment_type", "support", "thread_discovery",
    ],
  }, "Host capability evidence");
  if (value.schema_version !== 2) throw new CliError("Unsupported host capability evidence schema_version");
  requireExactFields(value.support, {
    required: ["execution_kind", "environment", "execution_path", "model", "reasoning_effort"],
  }, "Host capability support");
  requireExactFields(value.thread_discovery, {
    required: ["query", "fallback"],
  }, "Host thread-discovery evidence");
  const query = requireEnum(
    value.thread_discovery.query,
    DISCOVERY_QUERY_STATES,
    "thread_discovery.query",
  );
  const fallback = requireEnum(
    value.thread_discovery.fallback,
    DISCOVERY_FALLBACKS,
    "thread_discovery.fallback",
  );
  if (query === "supported" && fallback !== "none") {
    throw new CliError("Supported filtered discovery cannot declare a fallback");
  }
  if (query === "not-applicable" && fallback !== "none") {
    throw new CliError("Not-applicable thread discovery cannot declare a fallback");
  }
  const executionKind = requireEnum(value.execution_kind, ["task-thread", "subagent"], "execution_kind");
  const environmentType = requireEnum(
    value.environment_type,
    ["local", "host-worktree", "projectless"],
    "environment_type",
  );
  if (executionKind === "task-thread") {
    if (query === "not-applicable" || (query !== "supported" && fallback === "none")) {
      throw new CliError("Task-thread capability evidence requires a bounded reread path");
    }
  } else if (query !== "not-applicable" || fallback !== "none") {
    throw new CliError("Subagent capability evidence must mark thread discovery not-applicable");
  }
  return {
    schema_version: 2,
    adapter_id: requireText(value.adapter_id, "adapter_id", { max: 128, safeId: true }),
    host_session_id: requireText(value.host_session_id, "host_session_id", { max: 128, safeId: true }),
    checked_at: requireTimestamp(value.checked_at, "checked_at"),
    execution_kind: executionKind,
    environment_type: environmentType,
    support: {
      execution_kind: validateSupportEvidence(value.support.execution_kind, "support.execution_kind"),
      environment: validateSupportEvidence(value.support.environment, "support.environment"),
      execution_path: validateSupportEvidence(value.support.execution_path, "support.execution_path"),
      model: validateSupportEvidence(value.support.model, "support.model"),
      reasoning_effort: validateSupportEvidence(value.support.reasoning_effort, "support.reasoning_effort"),
    },
    thread_discovery: { query, fallback },
  };
}

function hostPreflightIdFor(evidence) {
  return `host-preflight-v2-${sha256(stableStringify(validateHostCapabilityEvidence(evidence)))}`;
}

function validateStoredHostPreflight(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "preflight_id", "schema_version", "adapter_id", "host_session_id", "checked_at",
      "execution_kind", "environment_type", "support", "thread_discovery",
    ],
  }, "Stored host preflight");
  const evidence = validateHostCapabilityEvidence({
    schema_version: value.schema_version,
    adapter_id: value.adapter_id,
    host_session_id: value.host_session_id,
    checked_at: value.checked_at,
    execution_kind: value.execution_kind,
    environment_type: value.environment_type,
    support: value.support,
    thread_discovery: value.thread_discovery,
  });
  const preflightId = requireText(value.preflight_id, "preflight_id", { max: 96, safeId: true });
  if (preflightId !== hostPreflightIdFor(evidence)) throw new CliError("Host preflight ID is invalid");
  return { preflight_id: preflightId, ...evidence };
}

function validateTaskRequest(value) {
  requireExactFields(value, {
    required: [
      "task_id", "run_id", "role", "execution_kind", "title", "launch_deadline",
      "model", "reasoning_effort", "baseline", "environment",
    ],
  }, "Task operation request");
  return {
    task_id: requireText(value.task_id, "request.task_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "request.run_id", { max: 128, safeId: true }),
    role: requireEnum(value.role, ["coordinator", "executor"], "request.role"),
    execution_kind: requireEnum(value.execution_kind, ["task-thread", "subagent"], "request.execution_kind"),
    title: requireText(value.title, "request.title", { max: 160 }),
    launch_deadline: validateLaunchDeadline(value.launch_deadline, "request.launch_deadline"),
    model: requireNullableText(value.model, "request.model", { max: 128 }),
    reasoning_effort: requireEnum(value.reasoning_effort, REASONING_EFFORTS, "request.reasoning_effort"),
    baseline: validateTaskBaseline(value.baseline, "request.baseline"),
    environment: validateTaskEnvironment(value.environment, "request.environment"),
  };
}

function preflightIncompatibility(request, preflight) {
  if (preflight.execution_kind !== request.execution_kind) {
    throw new CliError("Host preflight execution kind does not match the task request");
  }
  if (preflight.environment_type !== request.environment.type) {
    throw new CliError("Host preflight environment type does not match the task request");
  }
  const checks = [
    ["execution-kind", preflight.support.execution_kind.state, true],
    ["environment", preflight.support.environment.state, true],
    ["execution-path", preflight.support.execution_path.state, request.environment.type === "host-worktree"],
    ["model", preflight.support.model.state, request.model !== null],
    ["reasoning-effort", preflight.support.reasoning_effort.state, request.reasoning_effort !== null],
  ];
  for (const [field, state, required] of checks) {
    if (!required) {
      if (state !== "not-required") {
        throw new CliError(`Host preflight ${field} support must be not-required when the task does not request it`);
      }
      continue;
    }
    if (state === "supported") continue;
    return `${field}-${state === "unsupported" ? "unsupported" : "unverified"}`;
  }
  return null;
}

function validateAttempt(value, index) {
  const label = `Task operation attempts[${index}]`;
  requireExactFields(value, {
    required: [
      "attempt_id", "sequence", "status", "started_at", "ambiguous_after", "finished_at",
      "host_preflight_id", "failure_code",
    ],
  }, label);
  const status = requireEnum(value.status, [
    "dispatching", "ambiguous", "not-created", "observed", "failed", "host-session-blocked",
  ], `${label}.status`);
  const failureCode = value.failure_code === null
    ? null
    : requireEnum(value.failure_code, HOST_SESSION_FAILURE_CODES, `${label}.failure_code`);
  if ((status === "host-session-blocked") !== (failureCode !== null)) {
    throw new CliError(`${label} host-session status and failure code are inconsistent`);
  }
  return {
    attempt_id: requireText(value.attempt_id, `${label}.attempt_id`, { max: 96, safeId: true }),
    sequence: requireInteger(value.sequence, `${label}.sequence`, { min: 1, max: MAX_ATTEMPTS }),
    status,
    started_at: requireTimestamp(value.started_at, `${label}.started_at`),
    ambiguous_after: requireTimestamp(value.ambiguous_after, `${label}.ambiguous_after`),
    finished_at: value.finished_at === null
      ? null
      : requireTimestamp(value.finished_at, `${label}.finished_at`),
    host_preflight_id: requireText(value.host_preflight_id, `${label}.host_preflight_id`, {
      max: 96,
      safeId: true,
    }),
    failure_code: failureCode,
  };
}

function validateTitleEvidence(value) {
  requireExactFields(value, { required: ["source", "value", "normalization"] }, "title evidence");
  const source = requireEnum(value.source, TITLE_SOURCES, "title evidence.source");
  const normalization = requireEnum(value.normalization, TITLE_NORMALIZATIONS, "title evidence.normalization");
  const title = requireNullableText(value.value, "title evidence.value", { max: 160 });
  if (source === "unavailable" && (title !== null || normalization !== "not-applicable")) {
    throw new CliError("Unavailable title evidence must have a null value and not-applicable normalization");
  }
  if (source === "host-observed" && (title === null || !["none", "bounded-host-write"].includes(normalization))) {
    throw new CliError("Host-observed title evidence requires a value and bounded normalization state");
  }
  return { source, value: title, normalization };
}

function validateVisibilityEvidence(value) {
  requireExactFields(value, { required: ["source", "value"] }, "visibility evidence");
  const source = requireEnum(value.source, VISIBILITY_SOURCES, "visibility evidence.source");
  if (typeof value.value !== "boolean") throw new CliError("visibility evidence.value must be boolean");
  return { source, value: value.value };
}

function validateSelectorObservation(value, label, { reasoning = false } = {}) {
  requireExactFields(value, { required: ["source", "value"] }, label);
  const source = requireEnum(value.source, SELECTOR_EVIDENCE_SOURCES, `${label}.source`);
  const selected = value.value === null
    ? null
    : reasoning
      ? requireEnum(value.value, REASONING_EFFORTS, `${label}.value`)
      : requireText(value.value, `${label}.value`, { max: 128 });
  if (source === "unavailable" && selected !== null) {
    throw new CliError(`${label} unavailable evidence must have a null value`);
  }
  if (source !== "unavailable" && selected === null) {
    throw new CliError(`${label} ${source} evidence requires a value`);
  }
  return { source, value: selected };
}

function validateHostLabelEvidence(value) {
  requireExactFields(value, { required: ["source", "value"] }, "host label evidence");
  const source = requireEnum(value.source, HOST_LABEL_SOURCES, "host label evidence.source");
  const label = requireNullableText(value.value, "host label evidence.value", { max: 160 });
  if ((source === "unavailable") !== (label === null)) {
    throw new CliError("Host label source and value are inconsistent");
  }
  return { source, value: label };
}

function validateExecutionPathEvidence(value) {
  requireExactFields(value, { required: ["source", "value"] }, "execution path evidence");
  const source = requireEnum(value.source, EXECUTION_PATH_SOURCES, "execution path evidence.source");
  const path = requireNullableText(value.value, "execution path evidence.value", { max: 1024 });
  if (source === "host-observed") {
    if (path === null || !isAbsolute(path)) {
      throw new CliError("Host-observed execution path must be an absolute path");
    }
  } else if (path !== null) {
    throw new CliError(`${source} execution path evidence must have a null value`);
  }
  return { source, value: path };
}

function validateObservationEvidence(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "title", "visibility", "model", "reasoning_effort",
      "host_label", "execution_path",
    ],
  }, "Host observation evidence");
  if (value.schema_version !== 2) throw new CliError("Unsupported host observation evidence schema_version");
  return {
    schema_version: 2,
    title: validateTitleEvidence(value.title),
    visibility: validateVisibilityEvidence(value.visibility),
    model: validateSelectorObservation(value.model, "model evidence"),
    reasoning_effort: validateSelectorObservation(value.reasoning_effort, "reasoning evidence", { reasoning: true }),
    host_label: validateHostLabelEvidence(value.host_label),
    execution_path: validateExecutionPathEvidence(value.execution_path),
  };
}

export function validateHostObservationEvidence(value) {
  return validateObservationEvidence(value);
}

function qualifyObservationEvidence(evidence, request, actualKind) {
  const result = validateObservationEvidence(evidence);
  if (actualKind === "task-thread") {
    if (result.title.source === "unavailable" || result.title.value !== request.title) {
      throw new CliError("Task-thread title must be independently verified against the requested title");
    }
  } else if (result.title.source !== "unavailable" && result.title.value !== request.title) {
    throw new CliError("Observed subagent title does not match the requested coordinator label");
  }
  const expectedVisible = actualKind === "task-thread";
  if (result.visibility.value !== expectedVisible) {
    throw new CliError(`Observed visibility does not match requested ${actualKind}`);
  }
  for (const [field, requested] of [
    ["model", request.model],
    ["reasoning_effort", request.reasoning_effort],
  ]) {
    const item = result[field];
    if (requested !== null && item.source !== "unavailable" && item.value !== requested) {
      throw new CliError(`Observed ${field} does not match the requested value`);
    }
  }
  if (request.environment.type === "host-worktree") {
    if (result.execution_path.source !== "host-observed") {
      throw new CliError("host-worktree reconciliation requires a host-observed execution path");
    }
  } else if (result.execution_path.source !== "not-required") {
    throw new CliError("Non-host-worktree reconciliation must mark execution path not-required");
  }
  return result;
}

function observationEvidenceQuality(observed, request) {
  if (observed === null) return null;
  const gaps = [];
  if (observed.evidence.title.source === "unavailable") gaps.push("title-unavailable");
  if (observed.evidence.visibility.source !== "host-observed") {
    gaps.push(`visibility-${observed.evidence.visibility.source}`);
  }
  if (request.model !== null && observed.evidence.model.source !== "host-observed") {
    gaps.push(`model-${observed.evidence.model.source}`);
  }
  if (request.reasoning_effort !== null && observed.evidence.reasoning_effort.source !== "host-observed") {
    gaps.push(`reasoning-effort-${observed.evidence.reasoning_effort.source}`);
  }
  if (
    request.environment.type === "host-worktree"
    && observed.evidence.execution_path.source !== "host-observed"
  ) gaps.push(`execution-path-${observed.evidence.execution_path.source}`);
  return { quality: gaps.length === 0 ? "complete" : "partial", gaps };
}

function validateObserved(value, request) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["object_id", "actual_kind", "evidence", "observed_at"],
  }, "Task operation observed result");
  const actualKind = requireEnum(value.actual_kind, ["task-thread", "subagent"], "observed.actual_kind");
  if (actualKind !== request.execution_kind) {
    throw new CliError(`Requested ${request.execution_kind} but observed ${actualKind}`);
  }
  return {
    object_id: requireText(value.object_id, "observed.object_id", { max: 256, safeId: true }),
    actual_kind: actualKind,
    evidence: qualifyObservationEvidence(value.evidence, request, actualKind),
    observed_at: requireTimestamp(value.observed_at, "observed.observed_at"),
  };
}

function validateIncompatibility(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "type", "stage", "reason_code", "preflight_id", "host_session_id",
      "attempt_id", "recorded_at",
    ],
  }, "Task operation incompatibility");
  const type = requireEnum(value.type, ["selector-incompatible", "host-session-failure"], "incompatibility.type");
  const stage = requireEnum(value.stage, ["preflight", "dispatch"], "incompatibility.stage");
  const reasonCode = requireText(value.reason_code, "incompatibility.reason_code", { max: 64, safeId: true });
  if (type === "host-session-failure" && !HOST_SESSION_FAILURE_CODES.includes(reasonCode)) {
    throw new CliError("Host-session incompatibility reason is invalid");
  }
  if (type === "selector-incompatible" && !/^(?:execution-kind|environment|execution-path|model|reasoning-effort)-(?:unsupported|unverified)$/.test(reasonCode)) {
    throw new CliError("Selector incompatibility reason is invalid");
  }
  const attemptId = requireNullableText(value.attempt_id, "incompatibility.attempt_id", { max: 96, safeId: true });
  if ((stage === "dispatch") !== (attemptId !== null)) {
    throw new CliError("Task incompatibility stage and attempt identity are inconsistent");
  }
  if (type === "selector-incompatible" && stage !== "preflight") {
    throw new CliError("Selector incompatibility must be recorded at preflight");
  }
  if (type === "host-session-failure" && stage !== "dispatch") {
    throw new CliError("Host-session failure must be bound to a dispatch attempt");
  }
  return {
    type,
    stage,
    reason_code: reasonCode,
    preflight_id: requireText(value.preflight_id, "incompatibility.preflight_id", { max: 96, safeId: true }),
    host_session_id: requireText(value.host_session_id, "incompatibility.host_session_id", { max: 128, safeId: true }),
    attempt_id: attemptId,
    recorded_at: requireTimestamp(value.recorded_at, "incompatibility.recorded_at"),
  };
}

function validateOperationRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "project_id", "packet_hash", "request",
      "host_preflights", "active_host_preflight_id", "status", "attempts", "observed", "incompatibility",
      "created_at", "updated_at",
    ],
  }, "Task operation record");
  if (value.schema_version !== 5 || value.kind !== OPERATION_KIND) {
    throw new CliError("Unsupported task-operation record");
  }
  const request = validateTaskRequest(value.request);
  if (!Array.isArray(value.attempts) || value.attempts.length > MAX_ATTEMPTS) {
    throw new CliError(`Task operation attempts must contain at most ${MAX_ATTEMPTS} entries`);
  }
  const projectId = requireText(value.project_id, "project_id", { max: 128, safeId: true });
  const packetHash = requireText(value.packet_hash, "packet_hash", { max: 64, safeId: true });
  if (!/^[a-f0-9]{64}$/.test(packetHash)) throw new CliError("packet_hash must be a SHA-256 digest");
  const operationId = requireText(value.operation_id, "operation_id", { max: 96, safeId: true });
  if (operationId !== operationIdFromFields(projectId, request.task_id, request.run_id, request.execution_kind)) {
    throw new CliError("Task operation ID does not match its immutable request identity");
  }
  if (!Array.isArray(value.host_preflights) || value.host_preflights.length > MAX_HOST_PREFLIGHTS) {
    throw new CliError(`Task operation host preflights must contain at most ${MAX_HOST_PREFLIGHTS} entries`);
  }
  const hostPreflights = value.host_preflights.map(validateStoredHostPreflight);
  if (hostPreflights.some((item) => item === null)) {
    throw new CliError("Task operation host preflight history cannot contain null entries");
  }
  const hostPreflightIds = new Set(hostPreflights.map((item) => item.preflight_id));
  if (hostPreflightIds.size !== hostPreflights.length) {
    throw new CliError("Task operation host preflight IDs must be unique");
  }
  for (let index = 1; index < hostPreflights.length; index += 1) {
    if (Date.parse(hostPreflights[index].checked_at) < Date.parse(hostPreflights[index - 1].checked_at)) {
      throw new CliError("Task operation host preflight history must be chronological");
    }
  }
  const activeHostPreflightId = requireNullableText(
    value.active_host_preflight_id,
    "active_host_preflight_id",
    { max: 96, safeId: true },
  );
  if ((activeHostPreflightId === null) !== (hostPreflights.length === 0)) {
    throw new CliError("Task operation active host preflight and history are inconsistent");
  }
  const hostPreflight = activeHostPreflightId === null
    ? null
    : hostPreflights.find((item) => item.preflight_id === activeHostPreflightId) ?? null;
  if (activeHostPreflightId !== null && hostPreflight === null) {
    throw new CliError("Task operation active host preflight does not exist in its history");
  }
  if (activeHostPreflightId !== null && activeHostPreflightId !== hostPreflights.at(-1).preflight_id) {
    throw new CliError("Task operation active host preflight must be the newest history entry");
  }
  const attempts = value.attempts.map(validateAttempt);
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (attempt.sequence !== index + 1) throw new CliError("Task operation attempt sequence is not contiguous");
    const expected = `task-attempt-v1-${sha256(`${operationId}:${index + 1}`)}`;
    if (attempt.attempt_id !== expected) throw new CliError("Task operation attempt ID is invalid");
    if (attempt.status === "dispatching" && attempt.finished_at !== null) {
      throw new CliError("Dispatching task operation attempt cannot have finished_at");
    }
    if (attempt.status !== "dispatching" && attempt.finished_at === null) {
      throw new CliError(`Task operation attempt ${attempt.status} is missing finished_at`);
    }
    if (!hostPreflightIds.has(attempt.host_preflight_id)) {
      throw new CliError("Task operation attempt references unknown host-preflight evidence");
    }
    const attemptPreflight = hostPreflights.find((item) => item.preflight_id === attempt.host_preflight_id);
    if (Date.parse(attemptPreflight.checked_at) > Date.parse(attempt.started_at)) {
      throw new CliError("Task operation attempt predates its host-preflight evidence");
    }
  }
  const status = requireEnum(value.status, [
    "prepared", "dispatching", "ambiguous", "observed", "failed", "expired",
    "host-incompatible", "host-session-blocked",
  ], "status");
  const observed = validateObserved(value.observed, request);
  if ((status === "observed") !== (observed !== null)) {
    throw new CliError("Task operation status and host observation are inconsistent");
  }
  const incompatibility = validateIncompatibility(value.incompatibility);
  if ((status === "host-incompatible") !== (incompatibility?.type === "selector-incompatible")) {
    if (status === "host-incompatible" || incompatibility?.type === "selector-incompatible") {
      throw new CliError("Task operation selector-incompatibility state is inconsistent");
    }
  }
  if ((status === "host-session-blocked") !== (incompatibility?.type === "host-session-failure")) {
    if (status === "host-session-blocked" || incompatibility?.type === "host-session-failure") {
      throw new CliError("Task operation host-session state is inconsistent");
    }
  }
  const preflightReason = hostPreflight ? preflightIncompatibility(request, hostPreflight) : null;
  if (status === "host-incompatible") {
    if (hostPreflight === null || incompatibility.reason_code !== preflightReason) {
      throw new CliError("Task operation selector incompatibility does not match its host preflight");
    }
  } else if (preflightReason !== null) {
    throw new CliError("Compatible task-operation state contains an incompatible host preflight");
  }
  if (incompatibility !== null && (
    hostPreflight === null
    || incompatibility.preflight_id !== hostPreflight.preflight_id
    || incompatibility.host_session_id !== hostPreflight.host_session_id
  )) throw new CliError("Task incompatibility is not bound to its host preflight");
  const lastAttempt = attempts.at(-1);
  if (status === "dispatching" && lastAttempt?.status !== "dispatching") {
    throw new CliError("Dispatching task operation is missing its active attempt");
  }
  if (["ambiguous", "observed", "failed", "host-session-blocked"].includes(status) && lastAttempt?.status !== status) {
    throw new CliError(`Task operation ${status} state does not match its latest attempt`);
  }
  if (status === "host-session-blocked" && (
    incompatibility.attempt_id !== lastAttempt.attempt_id
    || incompatibility.reason_code !== lastAttempt.failure_code
    || incompatibility.preflight_id !== lastAttempt.host_preflight_id
  )) {
    throw new CliError("Task operation host-session failure does not match its blocked attempt");
  }
  if (status === "prepared" && lastAttempt && !["not-created", "host-session-blocked"].includes(lastAttempt.status)) {
    throw new CliError("Prepared retry state requires a safely closed latest attempt");
  }
  if (["dispatching", "ambiguous", "observed", "host-session-blocked"].includes(status) && hostPreflight === null) {
    throw new CliError(`Task operation ${status} is missing host preflight evidence`);
  }
  return {
    schema_version: 5,
    kind: OPERATION_KIND,
    operation_id: operationId,
    project_id: projectId,
    packet_hash: packetHash,
    request,
    host_preflights: hostPreflights,
    active_host_preflight_id: activeHostPreflightId,
    status,
    attempts,
    observed,
    incompatibility,
    created_at: requireTimestamp(value.created_at, "created_at"),
    updated_at: requireTimestamp(value.updated_at, "updated_at"),
  };
}

function activeHostPreflight(record) {
  if (record.active_host_preflight_id === null) return null;
  return record.host_preflights.find(
    (item) => item.preflight_id === record.active_host_preflight_id,
  ) ?? null;
}

async function readOperation(paths, guardRoot) {
  const raw = await readJson(paths.record, { allowMissing: true, guardRoot });
  return raw ? validateOperationRecord(raw) : null;
}

async function writeOperation(paths, guardRoot, record) {
  const validated = validateOperationRecord(record);
  await atomicWriteJson(paths.record, validated, { guardRoot });
  return validated;
}

function operationView(record, now = Date.now()) {
  let effectiveStatus = record.status;
  if (record.status === "dispatching") {
    const active = record.attempts.at(-1);
    if (active && Date.parse(active.ambiguous_after) <= now) effectiveStatus = "ambiguous-due";
  }
  const evidence = observationEvidenceQuality(record.observed, record.request);
  return {
    ...record,
    effective_status: effectiveStatus,
    observation_evidence: evidence,
  };
}

export async function prepareTaskOperation({ stateRoot, projectId, packet: input, now = Date.now() }) {
  requireText(projectId, "project_id", { max: 128, safeId: true });
  const packet = validateTaskPacket(input);
  await authenticateTaskBaseline({
    stateRoot,
    baseline: packet.baseline,
    environment: packet.environment,
  });
  const operationId = taskOperationIdFor(projectId, packet);
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const existing = await readOperation(paths, guardRoot);
    const packetHash = sha256(stableStringify(packet));
    if (existing) {
      if (existing.packet_hash !== packetHash) {
        throw new CliError("Task operation identity collides with a different packet");
      }
      return operationView(existing, now);
    }
    const timestamp = nowIso(now);
    const record = {
      schema_version: 5,
      kind: OPERATION_KIND,
      operation_id: operationId,
      project_id: projectId,
      packet_hash: packetHash,
      request: {
        task_id: packet.task_id,
        run_id: packet.run_id,
        role: packet.role,
        execution_kind: packet.execution_kind,
        title: packet.title,
        launch_deadline: packet.launch_deadline,
        model: packet.model,
        reasoning_effort: packet.reasoning_effort,
        baseline: packet.baseline,
        environment: packet.environment,
      },
      host_preflights: [],
      active_host_preflight_id: null,
      status: launchExpired(packet.launch_deadline, now) ? "expired" : "prepared",
      attempts: [],
      observed: null,
      incompatibility: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await ensureExactJson(paths.record, validateOperationRecord(record), { guardRoot });
    return operationView(record, now);
  });
}

export async function authorizeHostWorktreeBootstrap({ stateRoot, operationId, packet: input, now = Date.now() }) {
  const packet = validateTaskPacket(input);
  if (packet.environment.type !== "host-worktree") {
    throw new CliError("Bootstrap authorization is reserved for host-worktree packets");
  }
  const operation = (await taskOperationStatus({ stateRoot, operationId, now }))[0];
  if (!operation || operation.status !== "dispatching") {
    throw new CliError("Host-worktree bootstrap requires an active dispatch attempt");
  }
  if (operation.packet_hash !== sha256(stableStringify(packet))) {
    throw new CliError("Bootstrap packet does not match the prepared operation");
  }
  return {
    operation_id: operation.operation_id,
    attempt_id: operation.attempts.at(-1).attempt_id,
    packet,
  };
}

export async function recordTaskOperationHostPreflight({
  stateRoot,
  operationId,
  evidence: input,
  now = Date.now(),
}) {
  const evidence = validateHostCapabilityEvidence(input);
  const hostPreflight = {
    preflight_id: hostPreflightIdFor(evidence),
    ...evidence,
  };
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const record = await readOperation(paths, guardRoot);
    if (!record) throw new CliError("Task operation does not exist");
    const activePreflight = activeHostPreflight(record);
    if (["dispatching", "ambiguous", "observed", "failed", "expired"].includes(record.status)) {
      throw new CliError(`Task operation cannot accept host preflight evidence while ${record.status}`, 74);
    }
    if (
      record.status === "host-session-blocked"
      && activePreflight?.host_session_id === hostPreflight.host_session_id
    ) {
      throw new CliError("The blocked host session cannot be retried; record a preflight from a new host session", 75);
    }
    if (
      activePreflight !== null
      && Date.parse(hostPreflight.checked_at) < Date.parse(activePreflight.checked_at)
    ) {
      throw new CliError("Host preflight evidence cannot move backward in time");
    }
    if (Date.parse(hostPreflight.checked_at) > now + 5 * 60 * 1000) {
      throw new CliError("Host preflight evidence cannot be more than five minutes in the future");
    }
    const repeatedRejectedQuery = record.host_preflights.find((item) => (
      item.host_session_id === hostPreflight.host_session_id
      && item.thread_discovery.query === "rejected"
      && hostPreflight.thread_discovery.query === "rejected"
      && item.preflight_id !== hostPreflight.preflight_id
    ));
    if (repeatedRejectedQuery) {
      throw new CliError("Filtered thread discovery was already rejected in this host session");
    }
    const reason = preflightIncompatibility(record.request, hostPreflight);
    if (!record.host_preflights.some((item) => item.preflight_id === hostPreflight.preflight_id)) {
      if (record.host_preflights.length >= MAX_HOST_PREFLIGHTS) {
        throw new CliError("Task operation host-preflight limit reached", 74);
      }
      record.host_preflights.push(hostPreflight);
    }
    record.active_host_preflight_id = hostPreflight.preflight_id;
    record.incompatibility = reason === null ? null : {
      type: "selector-incompatible",
      stage: "preflight",
      reason_code: reason,
      preflight_id: hostPreflight.preflight_id,
      host_session_id: hostPreflight.host_session_id,
      attempt_id: null,
      recorded_at: nowIso(now),
    };
    record.status = reason === null ? "prepared" : "host-incompatible";
    record.updated_at = nowIso(now);
    return operationView(await writeOperation(paths, guardRoot, record), now);
  });
}

export async function beginTaskOperationAttempt({
  stateRoot,
  operationId,
  timeoutSeconds = 60,
  now = Date.now(),
}) {
  requireInteger(timeoutSeconds, "timeout_seconds", { min: 5, max: 600 });
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const record = await readOperation(paths, guardRoot);
    if (!record) throw new CliError("Task operation does not exist");
    if (record.status === "observed") return { status: "already-observed", operation: operationView(record, now) };
    if (["failed", "expired"].includes(record.status)) {
      throw new CliError(`Task operation is terminal: ${record.status}`, 74);
    }
    if (record.status === "host-incompatible") {
      throw new CliError(`Host selector is incompatible: ${record.incompatibility.reason_code}`, 74);
    }
    if (record.status === "host-session-blocked") {
      throw new CliError("Host session is blocked; record a compatible preflight from a new host session", 75);
    }
    if (record.status === "ambiguous") {
      throw new CliError("Task operation is ambiguous; inspect the host and reconcile before retrying", 75);
    }
    if (record.status === "dispatching") {
      const active = record.attempts.at(-1);
      if (active && Date.parse(active.ambiguous_after) <= now) {
        active.status = "ambiguous";
        active.finished_at = nowIso(now);
        record.status = "ambiguous";
        record.updated_at = nowIso(now);
        await writeOperation(paths, guardRoot, record);
        throw new CliError("Prior task operation exceeded its bounded wait; inspect the host before retrying", 75);
      }
      throw new CliError("Task operation dispatch is already in progress", 75);
    }
    if (launchExpired(record.request.launch_deadline, now)) {
      record.status = "expired";
      record.updated_at = nowIso(now);
      await writeOperation(paths, guardRoot, record);
      throw new CliError("Task launch deadline has expired; no new host operation may start", 74);
    }
    const hostPreflight = activeHostPreflight(record);
    if (hostPreflight === null) {
      throw new CliError("Task operation requires host capability preflight before dispatch", 75);
    }
    const preflightReason = preflightIncompatibility(record.request, hostPreflight);
    if (preflightReason !== null) {
      throw new CliError(`Host selector is incompatible: ${preflightReason}`, 74);
    }
    await authenticateTaskBaseline({
      stateRoot,
      baseline: record.request.baseline,
      environment: record.request.environment,
    });
    if (record.attempts.length >= MAX_ATTEMPTS) throw new CliError("Task operation attempt limit reached", 74);
    const sequence = record.attempts.length + 1;
    const attemptId = `task-attempt-v1-${sha256(`${operationId}:${sequence}`)}`;
    const attempt = {
      attempt_id: attemptId,
      sequence,
      status: "dispatching",
      started_at: nowIso(now),
      ambiguous_after: nowIso(now + timeoutSeconds * 1000),
      finished_at: null,
      host_preflight_id: hostPreflight.preflight_id,
      failure_code: null,
    };
    record.attempts.push(attempt);
    record.status = "dispatching";
    record.updated_at = nowIso(now);
    await writeOperation(paths, guardRoot, record);
    return {
      status: "dispatching",
      operation_id: operationId,
      attempt,
      request: record.request,
    };
  });
}

export async function reconcileTaskOperation({
  stateRoot,
  operationId,
  attemptId,
  outcome,
  objectId = null,
  actualKind = null,
  evidence = null,
  reasonCode = null,
  now = Date.now(),
}) {
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  requireText(attemptId, "attempt_id", { max: 96, safeId: true });
  requireEnum(outcome, [
    "observed", "not-created", "ambiguous", "failed", "host-session-blocked",
  ], "outcome");
  if (outcome !== "observed" && (objectId !== null || actualKind !== null || evidence !== null)) {
    throw new CliError("Only an observed reconciliation may contain host observation fields");
  }
  if (outcome !== "host-session-blocked" && reasonCode !== null) {
    throw new CliError("Only a host-session-blocked reconciliation may contain a reason code");
  }
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const record = await readOperation(paths, guardRoot);
    if (!record) throw new CliError("Task operation does not exist");
    const attempt = record.attempts.find((item) => item.attempt_id === attemptId);
    if (!attempt) throw new CliError("Task operation attempt does not exist");
    if (!["dispatching", "ambiguous"].includes(attempt.status)) {
      if (attempt.status === outcome) {
        if (outcome === "observed" && (objectId !== null || actualKind !== null || evidence !== null)) {
          requireText(objectId, "object_id", { max: 256, safeId: true });
          requireEnum(actualKind, ["task-thread", "subagent"], "actual_kind");
          const qualifiedEvidence = qualifyObservationEvidence(evidence, record.request, actualKind);
          if (
            record.observed?.object_id !== objectId
            || record.observed?.actual_kind !== actualKind
            || stableStringify(record.observed?.evidence) !== stableStringify(qualifiedEvidence)
          ) throw new CliError("Observed task operation replay conflicts with its recorded host evidence");
        }
        if (
          outcome === "host-session-blocked"
          && reasonCode !== null
          && attempt.failure_code !== reasonCode
        ) throw new CliError("Host-session reconciliation replay conflicts with its recorded reason code");
        return operationView(record, now);
      }
      throw new CliError(`Task operation attempt is already reconciled as ${attempt.status}`);
    }
    const timestamp = nowIso(now);
    if (outcome === "observed") {
      requireText(objectId, "object_id", { max: 256, safeId: true });
      requireEnum(actualKind, ["task-thread", "subagent"], "actual_kind");
      if (actualKind !== record.request.execution_kind) {
        throw new CliError(`Requested ${record.request.execution_kind} but observed ${actualKind}`);
      }
      const qualifiedEvidence = qualifyObservationEvidence(evidence, record.request, actualKind);
      record.observed = {
        object_id: objectId,
        actual_kind: actualKind,
        evidence: qualifiedEvidence,
        observed_at: timestamp,
      };
      record.status = "observed";
    } else if (outcome === "not-created") {
      record.status = launchExpired(record.request.launch_deadline, now) ? "expired" : "prepared";
    } else if (outcome === "host-session-blocked") {
      const failureCode = requireEnum(reasonCode, HOST_SESSION_FAILURE_CODES, "reason_code");
      const hostPreflight = activeHostPreflight(record);
      if (hostPreflight === null || attempt.host_preflight_id !== hostPreflight.preflight_id) {
        throw new CliError("Host-session failure is not bound to the current preflight");
      }
      attempt.failure_code = failureCode;
      record.status = "host-session-blocked";
      record.incompatibility = {
        type: "host-session-failure",
        stage: "dispatch",
        reason_code: failureCode,
        preflight_id: hostPreflight.preflight_id,
        host_session_id: hostPreflight.host_session_id,
        attempt_id: attempt.attempt_id,
        recorded_at: timestamp,
      };
    } else {
      record.status = outcome;
    }
    attempt.status = outcome;
    attempt.finished_at = timestamp;
    record.updated_at = timestamp;
    return operationView(await writeOperation(paths, guardRoot, record), now);
  });
}

async function listOperationRecords(root, guardRoot) {
  await assertNoSymlinkComponents(guardRoot, root, "Task-operation state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new CliError(`Task-operation state contains a symbolic link: ${path}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    records.push(validateOperationRecord(await readJson(path, { guardRoot })));
  }
  return records;
}

export async function taskOperationStatus({ stateRoot, operationId = null, now = Date.now() }) {
  const guardRoot = operationGuardRoot(stateRoot);
  if (operationId) {
    const paths = operationPaths(stateRoot, operationId);
    const record = await readOperation(paths, guardRoot);
    return record ? [operationView(record, now)] : [];
  }
  const records = await listOperationRecords(resolve(stateRoot, "task-operations", "records"), guardRoot);
  return records
    .map((record) => operationView(record, now))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
