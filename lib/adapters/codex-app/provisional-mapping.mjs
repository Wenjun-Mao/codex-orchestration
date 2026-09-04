import {
  CliError,
  requireText,
  sha256,
  stableStringify,
} from "../../core.mjs";
import {
  createCodexAppHostEvidence,
  validateCodexAppHostEvidence,
} from "./host-evidence.mjs";

function requireProvisionalClientThreadId(value) {
  return requireText(value, "provisional_client_thread_id", { max: 256 });
}

function candidateThreadId(value) {
  return requireText(value, "candidate_executor_thread_id", { max: 256, safeId: true });
}

function timestamp(value) {
  const result = requireText(value, "observed_at", { max: 64 });
  if (Number.isNaN(Date.parse(result))) throw new CliError("observed_at must be an ISO-8601 timestamp");
  return result;
}

function mappingDigest(provisionalClientThreadIdValue, candidates) {
  return sha256(stableStringify({
    schema_version: 1,
    provisional_client_thread_id: provisionalClientThreadIdValue,
    candidate_executor_thread_ids: candidates,
  }));
}

/**
 * Classify a bounded host mapping without promoting its target to a ready
 * identity. A caller can compare a `candidate_executor_thread_id` only with
 * independently authenticated executor-start evidence.
 */
export function classifyCodexAppProvisionalMapping({
  provisionalClientThreadId,
  candidateExecutorThreadIds = [],
  observedAt,
  source = "codex-app-private",
  sourceVersion = null,
  readable = true,
}) {
  const provisional = requireProvisionalClientThreadId(provisionalClientThreadId);
  const observed = timestamp(observedAt);
  if (!Array.isArray(candidateExecutorThreadIds)) {
    throw new CliError("candidate_executor_thread_ids must be an array");
  }
  if (candidateExecutorThreadIds.length > 50_000) {
    throw new CliError("candidate_executor_thread_ids exceeds the bounded adapter limit");
  }
  const candidates = [...new Set(candidateExecutorThreadIds.map(candidateThreadId))].sort();
  const digest = mappingDigest(provisional, candidates);
  if (readable !== true) {
    return createCodexAppHostEvidence({
      evidenceType: "provisional-mapping",
      classification: "opaque",
      source,
      sourceVersion,
      observedAt: observed,
      claims: { mapping_digest: digest, reason_code: "mapping_surface_unreadable" },
    });
  }
  if (candidates.length === 0) {
    return createCodexAppHostEvidence({
      evidenceType: "provisional-mapping",
      classification: "provisional",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        provisional_client_thread_id: provisional,
        mapping_digest: digest,
      },
    });
  }
  if (candidates.length === 1) {
    return createCodexAppHostEvidence({
      evidenceType: "provisional-mapping",
      classification: "current",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        provisional_client_thread_id: provisional,
        candidate_executor_thread_id: candidates[0],
        mapping_digest: digest,
      },
    });
  }
  return createCodexAppHostEvidence({
    evidenceType: "provisional-mapping",
    classification: "contradictory",
    source,
    sourceVersion,
    observedAt: observed,
    claims: {
      provisional_client_thread_id: provisional,
      mapping_digest: digest,
      candidate_count: candidates.length,
      candidate_set_digest: sha256(stableStringify(candidates)),
    },
  });
}

/**
 * Returns a candidate only; this function intentionally cannot return a
 * ready-task ID. Use assertExactExecutorStartClaim before any promotion.
 */
export function provisionalMappingCandidate(evidence) {
  const validated = validateCodexAppHostEvidence(evidence, "provisional mapping evidence");
  if (
    validated.evidence_type !== "provisional-mapping"
    || validated.classification !== "current"
  ) {
    return null;
  }
  return validated.claims.candidate_executor_thread_id;
}
