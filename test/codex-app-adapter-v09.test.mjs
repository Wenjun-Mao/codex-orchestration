import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertExactExecutorStartClaim,
  classifyCodexAppCreation,
  classifyCodexAppExecutorStart,
  validateCodexAppHostEvidence,
} from "../lib/adapters/codex-app/host-evidence.mjs";
import { classifyCodexAppProvisionalMapping, provisionalMappingCandidate } from "../lib/adapters/codex-app/provisional-mapping.mjs";
import { classifyCodexAppArchiveObservation } from "../lib/adapters/codex-app/archive-observation.mjs";

const OBSERVED_AT = "2026-09-04T02:30:00.000Z";
const REQUEST_DIGEST = "a".repeat(64);
const NONCE_DIGEST = "b".repeat(64);
const SESSION_DIGEST = "c".repeat(64);

test("creation evidence classifies settled, provisional, opaque, and contradictory host shapes", () => {
  const current = classifyCodexAppCreation({
    requestDigest: REQUEST_DIGEST,
    hostId: "local",
    reportedThreadId: "executor-current",
    observedAt: OBSERVED_AT,
  });
  assert.equal(current.classification, "current");
  assert.equal(current.claims.reported_thread_digest.length, 64);
  assert.equal(JSON.stringify(current).includes("executor-current"), false);

  const provisional = classifyCodexAppCreation({
    requestDigest: REQUEST_DIGEST,
    hostId: "local",
    provisionalClientThreadId: "client-new-thread:one",
    observedAt: OBSERVED_AT,
  });
  assert.equal(provisional.classification, "provisional");
  assert.equal(provisional.claims.provisional_client_thread_id, "client-new-thread:one");

  const opaque = classifyCodexAppCreation({ requestDigest: REQUEST_DIGEST, observedAt: OBSERVED_AT });
  assert.equal(opaque.classification, "opaque");

  const contradictory = classifyCodexAppCreation({
    requestDigest: REQUEST_DIGEST,
    provisionalClientThreadId: "client-new-thread:one",
    reportedThreadId: "executor-current",
    observedAt: OBSERVED_AT,
  });
  assert.equal(contradictory.classification, "contradictory");
  assert.deepEqual(validateCodexAppHostEvidence(contradictory), contradictory);
});

test("only an exact executor start claim can yield an executor identity", () => {
  const exact = classifyCodexAppExecutorStart({
    operationId: "operation-1",
    executorThreadId: "executor-current",
    turnId: "turn-1",
    launchNonceDigest: NONCE_DIGEST,
    exactLaunchNonceMatch: true,
    observedAt: OBSERVED_AT,
  });
  assert.equal(exact.classification, "current");
  assert.equal(assertExactExecutorStartClaim(exact, {
    operationId: "operation-1",
    launchNonceDigest: NONCE_DIGEST,
  }), "executor-current");

  const incomplete = classifyCodexAppExecutorStart({
    operationId: "operation-1",
    executorThreadId: "executor-unverified",
    observedAt: OBSERVED_AT,
  });
  assert.equal(incomplete.classification, "contradictory");
  assert.equal(JSON.stringify(incomplete).includes("executor-unverified"), false);
  assert.throws(() => assertExactExecutorStartClaim(incomplete), /exact executor-start evidence/);

  const provisional = classifyCodexAppExecutorStart({
    operationId: "operation-1",
    provisionalClientThreadId: "client-new-thread:one",
    observedAt: OBSERVED_AT,
  });
  assert.equal(provisional.classification, "provisional");
  assert.throws(() => assertExactExecutorStartClaim(provisional), /exact executor-start evidence/);
});

test("provisional mapping keeps candidates non-authoritative and fails closed on conflict", () => {
  const current = classifyCodexAppProvisionalMapping({
    provisionalClientThreadId: "client-new-thread:one",
    candidateExecutorThreadIds: ["executor-current"],
    observedAt: OBSERVED_AT,
  });
  assert.equal(current.classification, "current");
  assert.equal(provisionalMappingCandidate(current), "executor-current");
  assert.equal(Object.hasOwn(current.claims, "ready_thread_id"), false);

  const waiting = classifyCodexAppProvisionalMapping({
    provisionalClientThreadId: "client-new-thread:one",
    observedAt: OBSERVED_AT,
  });
  assert.equal(waiting.classification, "provisional");
  assert.equal(provisionalMappingCandidate(waiting), null);

  const opaque = classifyCodexAppProvisionalMapping({
    provisionalClientThreadId: "client-new-thread:one",
    readable: false,
    observedAt: OBSERVED_AT,
  });
  assert.equal(opaque.classification, "opaque");

  const contradictory = classifyCodexAppProvisionalMapping({
    provisionalClientThreadId: "client-new-thread:one",
    candidateExecutorThreadIds: ["executor-a", "executor-b"],
    observedAt: OBSERVED_AT,
  });
  assert.equal(contradictory.classification, "contradictory");
  assert.equal(contradictory.claims.candidate_count, 2);
  assert.equal(JSON.stringify(contradictory).includes("executor-a"), false);
});

test("archive evidence distinguishes active, absent, opaque, and ambiguous inventories", () => {
  const archived = classifyCodexAppArchiveObservation({
    threadId: "executor-current",
    activeSessionCount: 0,
    archivedSessionDigests: [SESSION_DIGEST],
    observedAt: OBSERVED_AT,
  });
  assert.equal(archived.classification, "current");
  assert.equal(archived.claims.active_session_absent, true);

  const active = classifyCodexAppArchiveObservation({
    threadId: "executor-current",
    activeSessionCount: 1,
    observedAt: OBSERVED_AT,
  });
  assert.equal(active.classification, "provisional");
  assert.equal(active.claims.active_session_absent, false);

  const missing = classifyCodexAppArchiveObservation({
    threadId: "executor-current",
    readable: false,
    observedAt: OBSERVED_AT,
  });
  assert.equal(missing.classification, "opaque");

  const ambiguous = classifyCodexAppArchiveObservation({
    threadId: "executor-current",
    activeSessionCount: 0,
    archivedSessionDigests: [SESSION_DIGEST, SESSION_DIGEST],
    observedAt: OBSERVED_AT,
  });
  assert.equal(ambiguous.classification, "contradictory");
  assert.equal(ambiguous.claims.archived_session_count, 2);
});

test("host-evidence schema is valid JSON and declares the constrained evidence vocabulary", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../schemas/codex-app-host-evidence.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.evidence_type.enum, [
    "creation", "executor-start", "provisional-mapping", "archive",
  ]);
  assert.equal(schema.$defs.mappingCurrent.properties.candidate_executor_thread_id !== undefined, true);
  assert.equal(schema.$defs.mappingCurrent.properties.ready_thread_id, undefined);
});
