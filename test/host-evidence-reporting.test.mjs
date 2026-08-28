import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { cleanupAudit } from "../lib/cleanup.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  beginTaskOperationAttempt,
  prepareTaskOperation,
  recordTaskOperationHostPreflight,
  rejectTaskOperationBeforeRelease,
  reconcileTaskOperation,
} from "../lib/task-operations.mjs";
import { createGitFixture, initializeFixture, removeFixture } from "./helpers.mjs";

function packet(revision, runId) {
  return {
    schema_version: 5,
    task_id: `executor-${runId}`,
    run_id: runId,
    role: "executor",
    execution_kind: "task-thread",
    title: `Executor ${runId}`,
    objective: "Exercise host evidence reporting.",
    baseline: { revision, cleanliness: "clean" },
    environment: { type: "projectless" },
    host_placement: {
      mode: "projectless",
      target_project_id: null,
      reason: "This reporting fixture does not use a saved project.",
    },
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

function capability(
  hostSessionId,
  modelState = "supported",
  environmentType = "projectless",
  placementMode = "projectless",
) {
  return {
    schema_version: 3,
    adapter_id: "codex-desktop-host",
    host_session_id: hostSessionId,
    checked_at: "2026-08-24T12:00:00Z",
    execution_kind: "task-thread",
    environment_type: environmentType,
    placement_mode: placementMode,
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      environment: { state: "supported", basis: "tool-schema" },
      execution_path: environmentType === "host-worktree"
        ? { state: "supported", basis: "host-contract" }
        : { state: "not-required", basis: "not-required" },
      project_placement: ["same-project", "cross-project"].includes(placementMode)
        ? { state: "supported", basis: "tool-schema" }
        : { state: "not-required", basis: "not-required" },
      model: {
        state: modelState,
        basis: modelState === "supported" ? "open-selector" : "closed-selector",
      },
      reasoning_effort: { state: "supported", basis: "open-selector" },
    },
    thread_discovery: { query: "rejected", fallback: "bounded-unfiltered" },
  };
}

function partialEvidence(title, executionPath = null, projectPlacement = { source: "not-applicable", value: null }) {
  return {
    schema_version: 3,
    title: { source: "host-observed", value: title, normalization: "none" },
    visibility: { source: "host-observed", value: true },
    model: { source: "host-accepted", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "host-accepted", value: "xhigh" },
    host_label: { source: "unavailable", value: null },
    execution_path: executionPath === null
      ? { source: "not-required", value: null }
      : { source: "host-observed", value: executionPath },
    project_placement: projectPlacement,
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

    const policyRejected = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: packet(git.revision, "policy-rejected"),
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: policyRejected.operation_id,
      evidence: capability("session-policy-rejected"),
    });
    const policyRejectedAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: policyRejected.operation_id,
    });
    const policyRejectedObserved = await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: policyRejected.operation_id,
      attemptId: policyRejectedAttempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-policy-rejected",
      actualKind: "task-thread",
      evidence: partialEvidence(
        policyRejected.request.title,
        null,
        { source: "host-observed", value: "unexpected-saved-project" },
      ),
    });
    assert.deepEqual(policyRejectedObserved.observation_policy, {
      state: "rejected",
      reason_code: "project-placement-unexpected",
    });

    const unbound = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: {
        ...packet(git.revision, "unbound"),
        environment: {
          type: "host-worktree",
          repository_path: root,
          starting_branch: "main",
          executor_branch: "codex/host-evidence",
        },
        host_placement: {
          mode: "same-project",
          target_project_id: "saved-project-reporting",
          reason: null,
        },
      },
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: unbound.operation_id,
      evidence: capability("session-unbound", "supported", "host-worktree", "same-project"),
    });
    const unboundAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: unbound.operation_id,
    });
    await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: unbound.operation_id,
      attemptId: unboundAttempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-unbound",
      actualKind: "task-thread",
      evidence: partialEvidence(
        unbound.request.title,
        "/tmp/unbound-host-worktree",
        { source: "host-accepted", value: "saved-project-reporting" },
      ),
    });

    const settled = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: {
        ...packet(git.revision, "settled"),
        environment: {
          type: "host-worktree",
          repository_path: root,
          starting_branch: "main",
          executor_branch: "codex/host-evidence-settled",
        },
        host_placement: {
          mode: "same-project",
          target_project_id: "saved-project-reporting",
          reason: null,
        },
      },
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: settled.operation_id,
      evidence: capability("session-settled", "supported", "host-worktree", "same-project"),
    });
    const settledAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: settled.operation_id,
    });
    await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: settled.operation_id,
      attemptId: settledAttempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-settled",
      actualKind: "task-thread",
      evidence: partialEvidence(
        settled.request.title,
        resolve(root, "archived-host-worktree"),
        { source: "host-accepted", value: "saved-project-reporting" },
      ),
    });
    const rejected = await rejectTaskOperationBeforeRelease({
      stateRoot: git.stateRoot,
      operationId: settled.operation_id,
      reasonCode: "operator-cancelled",
      hostObjectState: "archived",
    });
    assert.equal(rejected.status, "rejected-before-release");

    const settledComplete = await prepareTaskOperation({
      stateRoot: git.stateRoot,
      projectId: "fixture",
      packet: packet(git.revision, "settled-complete"),
    });
    await recordTaskOperationHostPreflight({
      stateRoot: git.stateRoot,
      operationId: settledComplete.operation_id,
      evidence: capability("session-settled-complete"),
    });
    const settledCompleteAttempt = await beginTaskOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: settledComplete.operation_id,
    });
    await reconcileTaskOperation({
      stateRoot: git.stateRoot,
      operationId: settledComplete.operation_id,
      attemptId: settledCompleteAttempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-settled-complete",
      actualKind: "task-thread",
      evidence: {
        ...partialEvidence(settledComplete.request.title),
        model: { source: "host-observed", value: "gpt-5.6-terra" },
        reasoning_effort: { source: "host-observed", value: "xhigh" },
      },
    });
    await rejectTaskOperationBeforeRelease({
      stateRoot: git.stateRoot,
      operationId: settledComplete.operation_id,
      reasonCode: "operator-cancelled",
      hostObjectState: "archived",
    });

    const doctor = await runDoctor(gitSnapshot(root));
    assert.equal(doctor.ok, true);
    assert.equal(doctor.task_operations.host_incompatible_count, 1);
    assert.equal(doctor.task_operations.host_session_blocked_count, 1);
    assert.equal(doctor.task_operations.partial_evidence_count, 3);
    assert.equal(doctor.task_operations.complete_evidence_count, 0);
    assert.equal(doctor.task_operations.observation_policy_rejected_count, 1);
    assert.equal(doctor.task_operations.rejected_before_release_count, 2);
    assert.match(doctor.warnings.join("\n"), /incompatible with their recorded host selector/);
    assert.match(doctor.warnings.join("\n"), /blocked for their recorded host session/);
    assert.match(doctor.warnings.join("\n"), /partial host evidence/);
    assert.match(doctor.warnings.join("\n"), /violate requested host observation policy/);
    assert.match(doctor.warnings.join("\n"), /host worktree.*lack Git ownership binding/);

    const cleanup = await cleanupAudit(gitSnapshot(root));
    assert.equal(cleanup.mutation_performed, false);
    assert.match(cleanup.recommendations.join("\n"), /compatible selector evidence/);
    assert.match(cleanup.recommendations.join("\n"), /new host-session preflight/);
    assert.match(cleanup.recommendations.join("\n"), /partial host evidence/);
    assert.equal(cleanup.observation_policy_rejected_count, 1);
    assert.match(cleanup.recommendations.join("\n"), /require archive or policy reconciliation before release/);
    assert.equal(cleanup.unbound_host_worktrees.length, 1);
    assert.equal(cleanup.rejected_before_release_count, 2);
    assert.equal(cleanup.unbound_host_worktrees[0].object_id, "thread-unbound");
    assert.match(cleanup.recommendations.join("\n"), /require Git ownership binding/);
    assert.doesNotMatch(cleanup.recommendations.join("\n"), /thread-settled/);
    assert.equal(
      cleanup.task_operations.find((operation) => operation.operation_id === settled.operation_id).resolution.disposition,
      "rejected-before-release",
    );

    await rejectTaskOperationBeforeRelease({
      stateRoot: git.stateRoot,
      operationId: policyRejected.operation_id,
      reasonCode: "host-placement-rejected",
      hostObjectState: "archived",
    });
    const settledDoctor = await runDoctor(gitSnapshot(root));
    assert.equal(settledDoctor.task_operations.observation_policy_rejected_count, 0);
    assert.doesNotMatch(settledDoctor.warnings.join("\n"), /violate requested host observation policy/);
    const settledCleanup = await cleanupAudit(gitSnapshot(root));
    assert.equal(settledCleanup.observation_policy_rejected_count, 0);
    assert.doesNotMatch(settledCleanup.recommendations.join("\n"), /require archive or policy reconciliation before release/);
  } finally {
    await removeFixture(root);
  }
});
