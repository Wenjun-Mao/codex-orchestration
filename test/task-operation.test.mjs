import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  beginTaskOperationAttempt,
  prepareTaskOperation,
  reconcileTaskOperation,
  taskOperationStatus,
} from "../lib/task-operations.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function packet(overrides = {}) {
  return {
    schema_version: 2,
    task_id: "bounded-executor-01",
    run_id: "run-20260823-01",
    role: "executor",
    execution_kind: "task-thread",
    title: "Bounded executor 01",
    objective: "Exercise one bounded task operation.",
    baseline: { revision: "0123456789abcdef", cleanliness: "clean" },
    environment: { type: "projectless", project_path: null },
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    launch_deadline: { at: "2030-08-23T17:15:00-04:00", timezone: "America/Toronto" },
    ownership: { write_paths: ["src/bounded"], read_paths: ["src"], exclusions: ["src/shared"] },
    dependencies: [],
    shared_resources: [],
    verification: ["Run focused tests."],
    callback: {
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread",
        generation: 1,
      },
      executor_id: "bounded-executor-01",
      receipt_schema_version: 2,
    },
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "queue",
    },
    integration_gate: { gate_id: "integration-r01", reproof: ["Run combined tests."] },
    cleanup_owner: "coordinator-lineage",
    ...overrides,
  };
}

test("task operation requires explicit kind and reconciles an observed task thread", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet(),
      now: Date.parse("2026-08-23T12:00:00Z"),
    });
    assert.equal(prepared.status, "prepared");
    const repeated = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet(),
      now: Date.parse("2026-08-23T12:00:01Z"),
    });
    assert.equal(repeated.operation_id, prepared.operation_id);

    const dispatch = await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
      timeoutSeconds: 60,
      now: Date.parse("2026-08-23T12:01:00Z"),
    });
    assert.equal(dispatch.request.execution_kind, "task-thread");
    await assert.rejects(
      beginTaskOperationAttempt({
        stateRoot,
        operationId: prepared.operation_id,
        now: Date.parse("2026-08-23T12:01:10Z"),
      }),
      /already in progress/,
    );
    await assert.rejects(
      reconcileTaskOperation({
        stateRoot,
        operationId: prepared.operation_id,
        attemptId: dispatch.attempt.attempt_id,
        outcome: "observed",
        objectId: "agent-01",
        actualKind: "subagent",
        title: "Bounded executor 01",
        visible: false,
      }),
      /Requested task-thread but observed subagent/,
    );
    const observed = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: dispatch.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-01",
      actualKind: "task-thread",
      title: "Bounded executor 01",
      visible: true,
      now: Date.parse("2026-08-23T12:01:20Z"),
    });
    assert.equal(observed.status, "observed");
    assert.equal(observed.observed.object_id, "thread-01");
  } finally {
    await removeFixture(root);
  }
});

test("ambiguous task creation blocks retry until inspect-before-retry reconciliation", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-ambiguous-01" }),
      now: Date.parse("2026-08-23T12:00:00Z"),
    });
    const first = await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
      timeoutSeconds: 5,
      now: Date.parse("2026-08-23T12:01:00Z"),
    });
    await assert.rejects(
      beginTaskOperationAttempt({
        stateRoot,
        operationId: prepared.operation_id,
        now: Date.parse("2026-08-23T12:01:06Z"),
      }),
      /inspect the host before retrying/,
    );
    await assert.rejects(
      beginTaskOperationAttempt({
        stateRoot,
        operationId: prepared.operation_id,
        now: Date.parse("2026-08-23T12:01:07Z"),
      }),
      /inspect the host and reconcile/,
    );
    const reconciled = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: first.attempt.attempt_id,
      outcome: "not-created",
      now: Date.parse("2026-08-23T12:01:08Z"),
    });
    assert.equal(reconciled.status, "prepared");
    const retry = await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
      now: Date.parse("2026-08-23T12:01:09Z"),
    });
    assert.equal(retry.attempt.sequence, 2);
  } finally {
    await removeFixture(root);
  }
});

test("task operation refuses expired launches and identity collisions", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const expired = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({
        run_id: "run-expired-01",
        launch_deadline: { at: "2026-08-23T08:00:00-04:00", timezone: "America/Toronto" },
      }),
      now: Date.parse("2026-08-23T12:00:01Z"),
    });
    assert.equal(expired.status, "expired");
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: expired.operation_id }),
      /deadline has expired|terminal: expired/,
    );

    const current = packet({ run_id: "run-collision-01" });
    await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: current,
      now: Date.parse("2026-08-23T12:00:00Z"),
    });
    await assert.rejects(
      prepareTaskOperation({
        stateRoot,
        projectId: "fixture-project",
        packet: { ...current, title: "Changed title with the same run identity" },
        now: Date.parse("2026-08-23T12:00:00Z"),
      }),
      /collides with a different packet/,
    );
    assert.equal((await taskOperationStatus({ stateRoot })).length, 2);
  } finally {
    await removeFixture(root);
  }
});

test("an in-flight host call remains reconcilable after the launch deadline", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({
        run_id: "run-cross-deadline-01",
        launch_deadline: { at: "2026-08-23T12:01:02Z", timezone: "America/Toronto" },
      }),
      now: Date.parse("2026-08-23T12:01:00Z"),
    });
    await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
      timeoutSeconds: 5,
      now: Date.parse("2026-08-23T12:01:01Z"),
    });
    await assert.rejects(
      beginTaskOperationAttempt({
        stateRoot,
        operationId: prepared.operation_id,
        now: Date.parse("2026-08-23T12:01:03Z"),
      }),
      /already in progress/,
    );
    await assert.rejects(
      beginTaskOperationAttempt({
        stateRoot,
        operationId: prepared.operation_id,
        now: Date.parse("2026-08-23T12:01:07Z"),
      }),
      /inspect the host before retrying/,
    );
    assert.equal((await taskOperationStatus({
      stateRoot,
      operationId: prepared.operation_id,
      now: Date.parse("2026-08-23T12:01:07Z"),
    }))[0].status, "ambiguous");
  } finally {
    await removeFixture(root);
  }
});
