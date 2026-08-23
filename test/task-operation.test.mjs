import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

function gitRevision(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function repositoryPacket(root, overrides = {}) {
  return packet({
    run_id: "run-local-baseline-01",
    baseline: { revision: gitRevision(root), cleanliness: "clean" },
    environment: { type: "local", project_path: root },
    ...overrides,
  });
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

test("local task operation authenticates its exact full Git baseline", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const current = repositoryPacket(root);
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: current,
      now: Date.parse("2026-08-23T12:00:00Z"),
    });
    assert.deepEqual(prepared.request.baseline, current.baseline);
    assert.deepEqual(prepared.request.environment, current.environment);

    const dispatch = await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
      now: Date.parse("2026-08-23T12:00:01Z"),
    });
    assert.deepEqual(dispatch.request.baseline, current.baseline);
  } finally {
    await removeFixture(root);
  }
});

test("prepare rejects an abbreviated or incorrect local baseline before journaling", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const revision = gitRevision(root);
    await assert.rejects(
      prepareTaskOperation({
        stateRoot,
        projectId: "fixture-project",
        packet: repositoryPacket(root, {
          run_id: "run-wrong-baseline-01",
          baseline: { revision: revision.slice(0, 7), cleanliness: "clean" },
        }),
      }),
      /baseline revision does not match/,
    );
    assert.deepEqual(await taskOperationStatus({ stateRoot }), []);
  } finally {
    await removeFixture(root);
  }
});

test("prepare rejects a packet from an unrelated Git common directory", async () => {
  const journalRoot = await createGitFixture("codex-flow-journal-repository-");
  const packetRoot = await createGitFixture("codex-flow-packet-repository-");
  const stateRoot = resolve(journalRoot, ".git", "codex-flow");
  try {
    await assert.rejects(
      prepareTaskOperation({
        stateRoot,
        projectId: "journal-project",
        packet: repositoryPacket(packetRoot, { run_id: "run-unrelated-repository-01" }),
      }),
      /does not share this operation journal's Git common directory/,
    );
    assert.deepEqual(await taskOperationStatus({ stateRoot }), []);
  } finally {
    await removeFixture(journalRoot);
    await removeFixture(packetRoot);
  }
});

test("prepare accepts a linked worktree sharing the operation journal", async () => {
  const root = await createGitFixture("codex-flow-linked-repository-");
  const linkedParent = await mkdtemp(resolve(tmpdir(), "codex-flow-linked-parent-"));
  const linkedRoot = resolve(linkedParent, "worktree");
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "fixture-linked", linkedRoot], { cwd: root });
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "linked-project",
      packet: repositoryPacket(linkedRoot, {
        run_id: "run-linked-worktree-01",
        environment: { type: "worktree", project_path: linkedRoot },
      }),
    });
    assert.equal(prepared.request.environment.project_path, linkedRoot);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", linkedRoot], { cwd: root });
    } catch {
      await rm(linkedRoot, { recursive: true, force: true });
    }
    await removeFixture(root);
    await rm(linkedParent, { recursive: true, force: true });
  }
});

test("pre-dispatch authentication rejects revision and cleanliness drift", async () => {
  const revisionRoot = await createGitFixture("codex-flow-revision-drift-");
  const cleanlinessRoot = await createGitFixture("codex-flow-cleanliness-drift-");
  try {
    const revisionState = resolve(revisionRoot, ".git", "codex-flow");
    const revisionOperation = await prepareTaskOperation({
      stateRoot: revisionState,
      projectId: "revision-project",
      packet: repositoryPacket(revisionRoot, { run_id: "run-revision-drift-01" }),
    });
    await writeFile(resolve(revisionRoot, ".gitkeep"), "next revision\n", "utf8");
    execFileSync("git", ["add", ".gitkeep"], { cwd: revisionRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "next"], { cwd: revisionRoot });
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot: revisionState, operationId: revisionOperation.operation_id }),
      /baseline revision does not match/,
    );
    assert.equal((await taskOperationStatus({
      stateRoot: revisionState,
      operationId: revisionOperation.operation_id,
    }))[0].attempts.length, 0);

    const cleanlinessState = resolve(cleanlinessRoot, ".git", "codex-flow");
    const cleanlinessOperation = await prepareTaskOperation({
      stateRoot: cleanlinessState,
      projectId: "cleanliness-project",
      packet: repositoryPacket(cleanlinessRoot, { run_id: "run-cleanliness-drift-01" }),
    });
    await writeFile(resolve(cleanlinessRoot, ".gitkeep"), "dirty\n", "utf8");
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot: cleanlinessState, operationId: cleanlinessOperation.operation_id }),
      /baseline cleanliness does not match/,
    );
  } finally {
    await removeFixture(revisionRoot);
    await removeFixture(cleanlinessRoot);
  }
});

test("legacy operation records remain readable but require authenticated re-prepare", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow");
  try {
    const current = packet({ run_id: "run-legacy-operation-01" });
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: current,
    });
    const recordPath = resolve(stateRoot, "task-operations", "records", `${prepared.operation_id}.json`);
    const legacy = JSON.parse(await readFile(recordPath, "utf8"));
    delete legacy.request.baseline;
    delete legacy.request.environment;
    await writeFile(recordPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    assert.equal((await taskOperationStatus({ stateRoot, operationId: prepared.operation_id }))[0].status, "prepared");
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id }),
      /predates baseline authentication/,
    );

    const upgraded = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: current,
    });
    assert.deepEqual(upgraded.request.environment, current.environment);
    assert.equal((await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
    })).status, "dispatching");
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
