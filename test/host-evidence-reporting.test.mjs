import assert from "node:assert/strict";
import test from "node:test";
import { cleanupAudit } from "../lib/cleanup.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  beginTaskOperationAttempt,
  prepareTaskOperation,
  recordTaskOperationHostPreflight,
  reconcileTaskOperation,
} from "../lib/task-operations.mjs";
import { createGitFixture, initializeFixture, removeFixture } from "./helpers.mjs";

function packet(revision, runId) {
  return {
    schema_version: 2,
    task_id: `executor-${runId}`,
    run_id: runId,
    role: "executor",
    execution_kind: "task-thread",
    title: `Executor ${runId}`,
    objective: "Exercise host evidence reporting.",
    baseline: { revision, cleanliness: "clean" },
    environment: { type: "projectless", project_path: null },
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    launch_deadline: { at: "2030-08-24T17:00:00-04:00", timezone: "America/Toronto" },
    ownership: { write_paths: ["src/fixture"], read_paths: ["src"], exclusions: [] },
    dependencies: [],
    shared_resources: [],
    verification: ["Inspect the resulting operation."],
    callback: {
      recipient: { lineage_id: "coordinator", thread_id: "coordinator-thread", generation: 1 },
      executor_id: `executor-${runId}`,
      receipt_schema_version: 2,
    },
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "journal-monitor",
    },
    integration_gate: { gate_id: `gate-${runId}`, reproof: ["Run focused tests."] },
    cleanup_owner: "coordinator",
  };
}

function capability(hostSessionId, modelState = "supported") {
  return {
    schema_version: 1,
    adapter_id: "codex-desktop-host",
    host_session_id: hostSessionId,
    checked_at: "2026-08-24T12:00:00Z",
    execution_kind: "task-thread",
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      model: {
        state: modelState,
        basis: modelState === "supported" ? "open-selector" : "closed-selector",
      },
      reasoning_effort: { state: "supported", basis: "open-selector" },
    },
    thread_discovery: { query: "rejected", fallback: "bounded-unfiltered" },
  };
}

function partialEvidence(title) {
  return {
    schema_version: 1,
    title: { source: "host-observed", value: title, normalization: "none" },
    visibility: { source: "host-observed", value: true },
    model: { source: "host-accepted", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "host-accepted", value: "xhigh" },
    host_label: { source: "unavailable", value: null },
  };
}

test("doctor and cleanup disclose incompatible, session-blocked, and partial operations", async () => {
  const root = await createGitFixture("codex-flow-host-reporting-");
  try {
    initializeFixture([], { cwd: root });
    const git = gitSnapshot(root);

    const incompatible = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: packet(git.revision, "incompatible"),
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: incompatible.operation_id,
      evidence: capability("session-incompatible", "unsupported"),
    });

    const blocked = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: packet(git.revision, "blocked"),
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: blocked.operation_id,
      evidence: capability("session-blocked"),
    });
    const blockedAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: blocked.operation_id,
    });
    await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: blocked.operation_id,
      attemptId: blockedAttempt.attempt.attempt_id,
      outcome: "host-session-blocked",
      reasonCode: "argument-serialization",
    });

    const partial = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: packet(git.revision, "partial"),
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: partial.operation_id,
      evidence: capability("session-partial"),
    });
    const partialAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: partial.operation_id,
    });
    await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: partial.operation_id,
      attemptId: partialAttempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-partial",
      actualKind: "task-thread",
      evidence: partialEvidence(partial.request.title),
    });

    const doctor = await runDoctor(gitSnapshot(root));
    assert.equal(doctor.ok, true);
    assert.equal(doctor.task_operations.host_incompatible_count, 1);
    assert.equal(doctor.task_operations.host_session_blocked_count, 1);
    assert.equal(doctor.task_operations.partial_evidence_count, 1);
    assert.match(doctor.warnings.join("\n"), /incompatible with their recorded host selector/);
    assert.match(doctor.warnings.join("\n"), /blocked for their recorded host session/);
    assert.match(doctor.warnings.join("\n"), /partial host evidence/);

    const cleanup = await cleanupAudit(gitSnapshot(root));
    assert.equal(cleanup.mutation_performed, false);
    assert.match(cleanup.recommendations.join("\n"), /compatible selector evidence/);
    assert.match(cleanup.recommendations.join("\n"), /new host-session preflight/);
    assert.match(cleanup.recommendations.join("\n"), /partial host evidence/);
  } finally {
    await removeFixture(root);
  }
});
