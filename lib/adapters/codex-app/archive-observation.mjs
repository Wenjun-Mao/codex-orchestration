import {
  CliError,
  requireText,
  sha256,
  stableStringify,
} from "../../core.mjs";
import { createCodexAppHostEvidence } from "./host-evidence.mjs";

const DIGEST = /^[0-9a-f]{64}$/;

function threadId(value) {
  return requireText(value, "thread_id", { max: 256, safeId: true });
}

function timestamp(value) {
  const result = requireText(value, "observed_at", { max: 64 });
  if (Number.isNaN(Date.parse(result))) throw new CliError("observed_at must be an ISO-8601 timestamp");
  return result;
}

function nonNegativeCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 50_000) {
    throw new CliError(`${label} must be an integer from 0 to 50000`);
  }
  return value;
}

function sessionDigest(value) {
  const result = requireText(value, "archived_session_digest", { max: 64 });
  if (!DIGEST.test(result)) {
    throw new CliError("archived_session_digest must be a lowercase SHA-256 digest");
  }
  return result;
}

/**
 * Converts a deliberately small archive inventory into evidence. It records
 * counts and session digests, never private paths or session content.
 */
export function classifyCodexAppArchiveObservation({
  threadId: rawThreadId,
  activeSessionCount,
  archivedSessionDigests = [],
  observedAt,
  source = "codex-app-private",
  sourceVersion = null,
  readable = true,
}) {
  const task = threadId(rawThreadId);
  const observed = timestamp(observedAt);
  if (readable !== true && readable !== false) {
    throw new CliError("readable must be a boolean");
  }
  if (readable === false) {
    const archiveDigest = sha256(stableStringify({
      schema_version: 1,
      thread_id: task,
      archive_surface: "unreadable",
    }));
    return createCodexAppHostEvidence({
      evidenceType: "archive",
      classification: "opaque",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        thread_id: task,
        archive_digest: archiveDigest,
        reason_code: "archive_surface_unreadable",
      },
    });
  }
  const active = nonNegativeCount(activeSessionCount, "active_session_count");
  if (!Array.isArray(archivedSessionDigests) || archivedSessionDigests.length > 50_000) {
    throw new CliError("archived_session_digests must be a bounded array");
  }
  // Preserve multiplicity: two archive records with identical contents are
  // still an ambiguous inventory, not one canonical archived session.
  const archived = archivedSessionDigests.map(sessionDigest).sort();
  const archiveDigest = sha256(stableStringify({
    schema_version: 1,
    thread_id: task,
    active_session_count: active,
    archived_session_digests: archived,
  }));
  if (active > 0) {
    return createCodexAppHostEvidence({
      evidenceType: "archive",
      classification: "provisional",
      source,
      sourceVersion,
      observedAt: observed,
      claims: { thread_id: task, active_session_absent: false },
    });
  }
  if (archived.length === 1) {
    return createCodexAppHostEvidence({
      evidenceType: "archive",
      classification: "current",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        thread_id: task,
        active_session_absent: true,
        archived_session_digest: archived[0],
      },
    });
  }
  if (archived.length > 1) {
    return createCodexAppHostEvidence({
      evidenceType: "archive",
      classification: "contradictory",
      source,
      sourceVersion,
      observedAt: observed,
      claims: {
        thread_id: task,
        archive_digest: archiveDigest,
        archived_session_count: archived.length,
      },
    });
  }
  return createCodexAppHostEvidence({
    evidenceType: "archive",
    classification: "opaque",
    source,
    sourceVersion,
    observedAt: observed,
    claims: {
      thread_id: task,
      archive_digest: archiveDigest,
      reason_code: "archive_session_missing",
    },
  });
}
