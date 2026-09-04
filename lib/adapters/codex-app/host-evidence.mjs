import {
  CliError,
  isPlainObject,
  requireEnum,
  requireText,
  sha256,
  stableStringify,
} from "../../core.mjs";

export const CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION = 1;
export const CODEX_APP_HOST_EVIDENCE_KIND = "codex-flow-v09-codex-app-host-evidence";
export const CODEX_APP_HOST_EVIDENCE_TYPES = Object.freeze([
  "creation",
  "executor-start",
  "provisional-mapping",
  "archive",
]);
export const CODEX_APP_HOST_EVIDENCE_CLASSIFICATIONS = Object.freeze([
  "current",
  "provisional",
  "opaque",
  "contradictory",
]);
export const CODEX_APP_HOST_EVIDENCE_SOURCES = Object.freeze([
  "codex-app-private",
  "codex-app-host",
  "codex-app-future",
]);

const DIGEST = /^[0-9a-f]{64}$/;

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) throw new CliError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (stableStringify(actual) !== stableStringify([...expected].sort())) {
    throw new CliError(`${label} has unexpected or missing fields`);
  }
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (Number.isNaN(Date.parse(result))) throw new CliError(`${label} must be an ISO-8601 timestamp`);
  return result;
}

function threadId(value, label) {
  return requireText(value, label, { max: 256, safeId: true });
}

function provisionalClientThreadId(value, label) {
  return requireText(value, label, { max: 256 });
}

function reasonCode(value, label) {
  return requireText(value, label, { max: 128, safeId: true });
}

function positiveCount(value, label) {
  if (!Number.isInteger(value) || value < 2 || value > 50_000) {
    throw new CliError(`${label} must be an integer from 2 to 50000`);
  }
  return value;
}

function validateCreationClaims(classification, value, label) {
  if (classification === "current") {
    exactKeys(value, ["host_id", "reported_thread_digest", "request_digest"], label);
    return {
      host_id: threadId(value.host_id, `${label}.host_id`),
      request_digest: digest(value.request_digest, `${label}.request_digest`),
      // Creation can report an ID, but it is deliberately retained only as a
      // digest. An executor start claim is the sole adapter output that can
      // independently expose an executor identity.
      reported_thread_digest: digest(value.reported_thread_digest, `${label}.reported_thread_digest`),
    };
  }
  if (classification === "provisional") {
    exactKeys(value, ["host_id", "provisional_client_thread_id", "request_digest"], label);
    return {
      host_id: threadId(value.host_id, `${label}.host_id`),
      request_digest: digest(value.request_digest, `${label}.request_digest`),
      provisional_client_thread_id: provisionalClientThreadId(
        value.provisional_client_thread_id,
        `${label}.provisional_client_thread_id`,
      ),
    };
  }
  if (classification === "opaque") {
    exactKeys(value, ["reason_code", "request_digest"], label);
    return {
      request_digest: digest(value.request_digest, `${label}.request_digest`),
      reason_code: reasonCode(value.reason_code, `${label}.reason_code`),
    };
  }
  exactKeys(value, ["conflict_digest", "provisional_client_thread_id", "request_digest"], label);
  return {
    request_digest: digest(value.request_digest, `${label}.request_digest`),
    provisional_client_thread_id: provisionalClientThreadId(
      value.provisional_client_thread_id,
      `${label}.provisional_client_thread_id`,
    ),
    conflict_digest: digest(value.conflict_digest, `${label}.conflict_digest`),
  };
}

function validateExecutorStartClaims(classification, value, label) {
  if (classification === "current") {
    exactKeys(value, ["executor_thread_id", "launch_nonce_digest", "operation_id", "turn_id"], label);
    return {
      operation_id: threadId(value.operation_id, `${label}.operation_id`),
      executor_thread_id: threadId(value.executor_thread_id, `${label}.executor_thread_id`),
      turn_id: threadId(value.turn_id, `${label}.turn_id`),
      launch_nonce_digest: digest(value.launch_nonce_digest, `${label}.launch_nonce_digest`),
    };
  }
  if (classification === "provisional") {
    exactKeys(value, ["operation_id", "provisional_client_thread_id"], label);
    return {
      operation_id: threadId(value.operation_id, `${label}.operation_id`),
      provisional_client_thread_id: provisionalClientThreadId(
        value.provisional_client_thread_id,
        `${label}.provisional_client_thread_id`,
      ),
    };
  }
  if (classification === "opaque") {
    exactKeys(value, ["operation_id", "reason_code"], label);
    return {
      operation_id: threadId(value.operation_id, `${label}.operation_id`),
      reason_code: reasonCode(value.reason_code, `${label}.reason_code`),
    };
  }
  exactKeys(value, ["conflict_digest", "operation_id"], label);
  return {
    operation_id: threadId(value.operation_id, `${label}.operation_id`),
    conflict_digest: digest(value.conflict_digest, `${label}.conflict_digest`),
  };
}

function validateProvisionalMappingClaims(classification, value, label) {
  if (classification === "current") {
    exactKeys(value, ["candidate_executor_thread_id", "mapping_digest", "provisional_client_thread_id"], label);
    return {
      provisional_client_thread_id: provisionalClientThreadId(
        value.provisional_client_thread_id,
        `${label}.provisional_client_thread_id`,
      ),
      // This is intentionally a candidate rather than a ready identity. Core
      // code must pair it with an exact executor-start claim before promotion.
      candidate_executor_thread_id: threadId(
        value.candidate_executor_thread_id,
        `${label}.candidate_executor_thread_id`,
      ),
      mapping_digest: digest(value.mapping_digest, `${label}.mapping_digest`),
    };
  }
  if (classification === "provisional") {
    exactKeys(value, ["mapping_digest", "provisional_client_thread_id"], label);
    return {
      provisional_client_thread_id: provisionalClientThreadId(
        value.provisional_client_thread_id,
        `${label}.provisional_client_thread_id`,
      ),
      mapping_digest: digest(value.mapping_digest, `${label}.mapping_digest`),
    };
  }
  if (classification === "opaque") {
    exactKeys(value, ["mapping_digest", "reason_code"], label);
    return {
      mapping_digest: digest(value.mapping_digest, `${label}.mapping_digest`),
      reason_code: reasonCode(value.reason_code, `${label}.reason_code`),
    };
  }
  exactKeys(value, ["candidate_count", "candidate_set_digest", "mapping_digest", "provisional_client_thread_id"], label);
  return {
    provisional_client_thread_id: provisionalClientThreadId(
      value.provisional_client_thread_id,
      `${label}.provisional_client_thread_id`,
    ),
    mapping_digest: digest(value.mapping_digest, `${label}.mapping_digest`),
    candidate_count: positiveCount(value.candidate_count, `${label}.candidate_count`),
    candidate_set_digest: digest(value.candidate_set_digest, `${label}.candidate_set_digest`),
  };
}

function validateArchiveClaims(classification, value, label) {
  if (classification === "current") {
    exactKeys(value, ["active_session_absent", "archived_session_digest", "thread_id"], label);
    if (value.active_session_absent !== true) {
      throw new CliError(`${label}.active_session_absent must be true for current archive evidence`);
    }
    return {
      thread_id: threadId(value.thread_id, `${label}.thread_id`),
      active_session_absent: true,
      archived_session_digest: digest(value.archived_session_digest, `${label}.archived_session_digest`),
    };
  }
  if (classification === "provisional") {
    exactKeys(value, ["active_session_absent", "thread_id"], label);
    if (value.active_session_absent !== false) {
      throw new CliError(`${label}.active_session_absent must be false for provisional archive evidence`);
    }
    return {
      thread_id: threadId(value.thread_id, `${label}.thread_id`),
      active_session_absent: false,
    };
  }
  if (classification === "opaque") {
    exactKeys(value, ["archive_digest", "reason_code", "thread_id"], label);
    return {
      thread_id: threadId(value.thread_id, `${label}.thread_id`),
      archive_digest: digest(value.archive_digest, `${label}.archive_digest`),
      reason_code: reasonCode(value.reason_code, `${label}.reason_code`),
    };
  }
  exactKeys(value, ["archive_digest", "archived_session_count", "thread_id"], label);
  return {
    thread_id: threadId(value.thread_id, `${label}.thread_id`),
    archive_digest: digest(value.archive_digest, `${label}.archive_digest`),
    archived_session_count: positiveCount(value.archived_session_count, `${label}.archived_session_count`),
  };
}

function validateClaims(evidenceType, classification, value, label) {
  if (evidenceType === "creation") return validateCreationClaims(classification, value, label);
  if (evidenceType === "executor-start") {
    return validateExecutorStartClaims(classification, value, label);
  }
  if (evidenceType === "provisional-mapping") {
    return validateProvisionalMappingClaims(classification, value, label);
  }
  return validateArchiveClaims(classification, value, label);
}

export function codexAppHostEvidenceDigest(value) {
  return sha256(stableStringify({
    schema_version: CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION,
    kind: CODEX_APP_HOST_EVIDENCE_KIND,
    evidence_type: value.evidence_type,
    classification: value.classification,
    source: value.source,
    source_version: value.source_version,
    observed_at: value.observed_at,
    claims: value.claims,
  }));
}

export function validateCodexAppHostEvidence(value, label = "Codex App host evidence") {
  exactKeys(value, [
    "binding_digest", "claims", "classification", "evidence_type", "kind",
    "observed_at", "schema_version", "source", "source_version",
  ], label);
  if (
    value.schema_version !== CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION
    || value.kind !== CODEX_APP_HOST_EVIDENCE_KIND
  ) throw new CliError(`${label} has unsupported authority`);
  const evidenceType = requireEnum(value.evidence_type, CODEX_APP_HOST_EVIDENCE_TYPES, `${label}.evidence_type`);
  const classification = requireEnum(
    value.classification,
    CODEX_APP_HOST_EVIDENCE_CLASSIFICATIONS,
    `${label}.classification`,
  );
  const evidence = {
    schema_version: CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION,
    kind: CODEX_APP_HOST_EVIDENCE_KIND,
    evidence_type: evidenceType,
    classification,
    source: requireEnum(value.source, CODEX_APP_HOST_EVIDENCE_SOURCES, `${label}.source`),
    source_version: value.source_version === null
      ? null
      : requireText(value.source_version, `${label}.source_version`, { max: 128 }),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
    claims: validateClaims(evidenceType, classification, value.claims, `${label}.claims`),
    binding_digest: digest(value.binding_digest, `${label}.binding_digest`),
  };
  if (evidence.binding_digest !== codexAppHostEvidenceDigest(evidence)) {
    throw new CliError(`${label}.binding_digest is invalid`);
  }
  return evidence;
}

export function createCodexAppHostEvidence({
  evidenceType,
  classification,
  source,
  sourceVersion = null,
  observedAt,
  claims,
}) {
  const evidence = {
    schema_version: CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION,
    kind: CODEX_APP_HOST_EVIDENCE_KIND,
    evidence_type: evidenceType,
    classification,
    source,
    source_version: sourceVersion,
    observed_at: observedAt,
    claims,
    binding_digest: "",
  };
  // Validate before binding so callers cannot hash an unrecognized future
  // shape and accidentally turn it into accepted core evidence.
  const validated = validateWithoutDigest(evidence);
  validated.binding_digest = codexAppHostEvidenceDigest(validated);
  return validateCodexAppHostEvidence(validated);
}

function validateWithoutDigest(value) {
  exactKeys(value, [
    "binding_digest", "claims", "classification", "evidence_type", "kind",
    "observed_at", "schema_version", "source", "source_version",
  ], "Codex App host evidence");
  if (
    value.schema_version !== CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION
    || value.kind !== CODEX_APP_HOST_EVIDENCE_KIND
  ) throw new CliError("Codex App host evidence has unsupported authority");
  const evidenceType = requireEnum(value.evidence_type, CODEX_APP_HOST_EVIDENCE_TYPES, "evidence_type");
  const classification = requireEnum(value.classification, CODEX_APP_HOST_EVIDENCE_CLASSIFICATIONS, "classification");
  return {
    schema_version: CODEX_APP_HOST_EVIDENCE_SCHEMA_VERSION,
    kind: CODEX_APP_HOST_EVIDENCE_KIND,
    evidence_type: evidenceType,
    classification,
    source: requireEnum(value.source, CODEX_APP_HOST_EVIDENCE_SOURCES, "source"),
    source_version: value.source_version === null
      ? null
      : requireText(value.source_version, "source_version", { max: 128 }),
    observed_at: timestamp(value.observed_at, "observed_at"),
    claims: validateClaims(evidenceType, classification, value.claims, "claims"),
    binding_digest: "",
  };
}

/**
 * Classifies a create-task response without exposing a reported ready-task
 * identifier. Direct creation output is useful correlation evidence, but it
 * is not a substitute for the executor's exact nonce-bearing start claim.
 */
export function classifyCodexAppCreation({
  requestDigest,
  hostId = "unknown",
  provisionalClientThreadId: rawProvisionalClientThreadId = null,
  reportedThreadId = null,
  observedAt,
  source = "codex-app-host",
  sourceVersion = null,
}) {
  const request = digest(requestDigest, "request_digest");
  const observed = timestamp(observedAt, "observed_at");
  const provisional = rawProvisionalClientThreadId === null || rawProvisionalClientThreadId === undefined
    ? null
    : provisionalClientThreadId(rawProvisionalClientThreadId, "provisional_client_thread_id");
  const reported = reportedThreadId === null || reportedThreadId === undefined
    ? null
    : threadId(reportedThreadId, "reported_thread_id");
  if (provisional !== null && reported !== null) {
    return createCodexAppHostEvidence({
      evidenceType: "creation",
      classification: "contradictory",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        request_digest: request,
        provisional_client_thread_id: provisional,
        conflict_digest: sha256(stableStringify({ provisional, reported })),
      },
    });
  }
  if (provisional !== null) {
    return createCodexAppHostEvidence({
      evidenceType: "creation",
      classification: "provisional",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        request_digest: request,
        host_id: threadId(hostId, "host_id"),
        provisional_client_thread_id: provisional,
      },
    });
  }
  if (reported !== null) {
    return createCodexAppHostEvidence({
      evidenceType: "creation",
      classification: "current",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        request_digest: request,
        host_id: threadId(hostId, "host_id"),
        reported_thread_digest: sha256(reported),
      },
    });
  }
  return createCodexAppHostEvidence({
    evidenceType: "creation",
    classification: "opaque",
    source,
    sourceVersion,
    observedAt: observed,
    claims: { request_digest: request, reason_code: "creation_result_unrecognized" },
  });
}

/**
 * The sole adapter route that can expose an executor identity. `current`
 * requires an exact start record, its first-turn ID, and the launch nonce
 * digest. Every incomplete or disagreeing shape is non-promotable evidence.
 */
export function classifyCodexAppExecutorStart({
  operationId,
  executorThreadId = null,
  turnId = null,
  launchNonceDigest = null,
  provisionalClientThreadId: rawProvisionalClientThreadId = null,
  exactLaunchNonceMatch = false,
  observedAt,
  source = "codex-app-host",
  sourceVersion = null,
}) {
  const operation = threadId(operationId, "operation_id");
  const observed = timestamp(observedAt, "observed_at");
  const executor = executorThreadId === null || executorThreadId === undefined
    ? null
    : threadId(executorThreadId, "executor_thread_id");
  const turn = turnId === null || turnId === undefined ? null : threadId(turnId, "turn_id");
  const nonce = launchNonceDigest === null || launchNonceDigest === undefined
    ? null
    : digest(launchNonceDigest, "launch_nonce_digest");
  const provisional = rawProvisionalClientThreadId === null || rawProvisionalClientThreadId === undefined
    ? null
    : provisionalClientThreadId(rawProvisionalClientThreadId, "provisional_client_thread_id");
  if (exactLaunchNonceMatch === true && executor !== null && turn !== null && nonce !== null) {
    return createCodexAppHostEvidence({
      evidenceType: "executor-start",
      classification: "current",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        operation_id: operation,
        executor_thread_id: executor,
        turn_id: turn,
        launch_nonce_digest: nonce,
      },
    });
  }
  if (executor !== null || turn !== null || nonce !== null || exactLaunchNonceMatch !== false) {
    return createCodexAppHostEvidence({
      evidenceType: "executor-start",
      classification: "contradictory",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        operation_id: operation,
        conflict_digest: sha256(stableStringify({
          executor_thread_id: executor,
          turn_id: turn,
          launch_nonce_digest: nonce,
          exact_launch_nonce_match: exactLaunchNonceMatch,
        })),
      },
    });
  }
  if (provisional !== null) {
    return createCodexAppHostEvidence({
      evidenceType: "executor-start",
      classification: "provisional",
      source,
      sourceVersion,
      observedAt: observed,
      claims: { operation_id: operation, provisional_client_thread_id: provisional },
    });
  }
  return createCodexAppHostEvidence({
    evidenceType: "executor-start",
    classification: "opaque",
    source,
    sourceVersion,
    observedAt: observed,
    claims: { operation_id: operation, reason_code: "executor_start_unavailable" },
  });
}

export function assertExactExecutorStartClaim(evidence, {
  operationId,
  launchNonceDigest,
} = {}) {
  const validated = validateCodexAppHostEvidence(evidence);
  if (
    validated.evidence_type !== "executor-start"
    || validated.classification !== "current"
  ) throw new CliError("Ready identity requires current exact executor-start evidence");
  if (
    operationId !== undefined
    && validated.claims.operation_id !== threadId(operationId, "operation_id")
  ) throw new CliError("Executor-start evidence does not match the exact operation");
  if (
    launchNonceDigest !== undefined
    && validated.claims.launch_nonce_digest !== digest(launchNonceDigest, "launch_nonce_digest")
  ) throw new CliError("Executor-start evidence does not match the exact launch nonce");
  return validated.claims.executor_thread_id;
}
