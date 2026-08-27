import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  authorizeHostWorktreeBootstrap,
  beginTaskOperationAttempt,
  prepareTaskOperation,
  recordTaskOperationHostPreflight,
  reconcileTaskOperation,
  taskOperationStatus,
  validateHostCapabilityEvidence,
  validateHostObservationEvidence,
} from "../lib/task-operations.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function packet(overrides = {}) {
  return {
    schema_version: 4,
    task_id: "bounded-executor-01",
    run_id: "run-20260823-01",
    role: "executor",
    execution_kind: "task-thread",
    title: "Bounded executor 01",
    objective: "Exercise one bounded task operation.",
    baseline: { revision: "0123456789abcdef", cleanliness: "clean" },
    environment: { type: "projectless" },
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
      ordinary_completion: "journal-monitor",
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

function hostWorktreePacket(root, overrides = {}) {
  return packet({
    run_id: "run-host-worktree-01",
    baseline: { revision: gitRevision(root), cleanliness: "clean" },
    environment: {
      type: "host-worktree",
      repository_path: root,
      starting_branch: "main",
      executor_branch: "codex/host-worktree-executor",
    },
    ...overrides,
  });
}

function hostCapability({
  hostSessionId = "desktop-session-a",
  executionKind = "task-thread",
  model = { state: "supported", basis: "open-selector" },
  reasoningEffort = { state: "supported", basis: "open-selector" },
  query = "rejected",
  fallback = "bounded-unfiltered",
  checkedAt = "2026-08-23T12:00:00Z",
  environmentType = "projectless",
  environment = { state: "supported", basis: "tool-schema" },
  executionPath = { state: "not-required", basis: "not-required" },
} = {}) {
  return {
    schema_version: 2,
    adapter_id: "codex-desktop-host",
    host_session_id: hostSessionId,
    checked_at: checkedAt,
    execution_kind: executionKind,
    environment_type: environmentType,
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      environment,
      execution_path: executionPath,
      model,
      reasoning_effort: reasoningEffort,
    },
    thread_discovery: { query, fallback },
  };
}

function taskThreadEvidence({
  title = "Bounded executor 01",
  titleNormalization = "none",
  modelSource = "host-accepted",
  reasoningSource = "host-accepted",
  executionPath = null,
} = {}) {
  return {
    schema_version: 2,
    title: { source: "host-observed", value: title, normalization: titleNormalization },
    visibility: { source: "host-observed", value: true },
    model: { source: modelSource, value: "gpt-5.6-terra" },
    reasoning_effort: { source: reasoningSource, value: "xhigh" },
    host_label: { source: "unavailable", value: null },
    execution_path: executionPath === null
      ? { source: "not-required", value: null }
      : { source: "host-observed", value: executionPath },
  };
}

function subagentEvidence() {
  return {
    schema_version: 2,
    title: { source: "unavailable", value: null, normalization: "not-applicable" },
    visibility: { source: "host-contract", value: false },
    model: { source: "role-contract", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "role-contract", value: "xhigh" },
    host_label: { source: "host-observed", value: "focused-runner" },
    execution_path: { source: "not-required", value: null },
  };
}

test("host evidence validators reject contradictory provenance and values", () => {
  assert.throws(
    () => validateHostCapabilityEvidence(hostCapability({
      model: { state: "unsupported", basis: "open-selector" },
    })),
    /positive closed-contract evidence/,
  );
  assert.throws(
    () => validateHostCapabilityEvidence(hostCapability({
      executionKind: "subagent",
      query: "supported",
      fallback: "none",
    })),
    /must mark thread discovery not-applicable/,
  );
  assert.throws(
    () => validateHostObservationEvidence({
      ...taskThreadEvidence(),
      title: { source: "unavailable", value: "claimed title", normalization: "not-applicable" },
    }),
    /Unavailable title evidence/,
  );
  assert.throws(
    () => validateHostObservationEvidence({
      ...taskThreadEvidence(),
      model: { source: "unavailable", value: "gpt-5.6-terra" },
    }),
    /unavailable evidence must have a null value/,
  );
  assert.throws(
    () => validateHostObservationEvidence({
      ...taskThreadEvidence(),
      host_label: { source: "host-observed", value: null },
    }),
    /Host label source and value are inconsistent/,
  );
});

async function recordCompatiblePreflight(stateRoot, operationId, overrides = {}) {
  const operation = (await taskOperationStatus({ stateRoot, operationId }))[0];
  const environmentType = operation.request.environment.type;
  return recordTaskOperationHostPreflight({
    stateRoot,
    operationId,
    evidence: hostCapability({
      ...overrides,
      environmentType,
      executionPath: environmentType === "host-worktree"
        ? { state: "supported", basis: "host-contract" }
        : { state: "not-required", basis: "not-required" },
    }),
    now: Date.parse(overrides.checkedAt ?? "2026-08-23T12:00:00Z"),
  });
}

test("task operation requires explicit kind and reconciles an observed task thread", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
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

    await recordCompatiblePreflight(stateRoot, prepared.operation_id);

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
        evidence: subagentEvidence(),
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
      evidence: taskThreadEvidence(),
      now: Date.parse("2026-08-23T12:01:20Z"),
    });
    assert.equal(observed.status, "observed");
    assert.equal(observed.observed.object_id, "thread-01");
    assert.deepEqual(observed.observation_evidence, {
      quality: "partial",
      gaps: ["model-host-accepted", "reasoning-effort-host-accepted"],
    });
    assert.equal((await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: dispatch.attempt.attempt_id,
      outcome: "observed",
    })).status, "observed");
    await assert.rejects(
      reconcileTaskOperation({
        stateRoot,
        operationId: prepared.operation_id,
        attemptId: dispatch.attempt.attempt_id,
        outcome: "observed",
        objectId: "thread-conflict",
        actualKind: "task-thread",
        evidence: taskThreadEvidence(),
      }),
      /replay conflicts/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("local task operation authenticates its exact full Git baseline", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
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

    await recordCompatiblePreflight(stateRoot, prepared.operation_id);

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
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
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
  const stateRoot = resolve(journalRoot, ".git", "codex-flow", "v0.5");
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
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "fixture-linked", linkedRoot], { cwd: root });
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "linked-project",
      packet: repositoryPacket(linkedRoot, {
        run_id: "run-linked-worktree-01",
        environment: { type: "local", project_path: linkedRoot },
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

test("host-worktree authenticates a source branch before creation and requires an observed path", async () => {
  const root = await createGitFixture("codex-flow-host-worktree-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    await writeFile(resolve(root, "user-owned-untracked.txt"), "preserve\n", "utf8");
    const request = hostWorktreePacket(root);
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "host-worktree-project",
      packet: request,
    });
    await assert.rejects(
      authorizeHostWorktreeBootstrap({
        stateRoot,
        operationId: prepared.operation_id,
        packet: request,
      }),
      /requires an active dispatch attempt/,
    );
    await recordCompatiblePreflight(stateRoot, prepared.operation_id);
    const attempt = await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
    });
    await assert.rejects(
      authorizeHostWorktreeBootstrap({
        stateRoot,
        operationId: prepared.operation_id,
        packet: { ...request, objective: "A different objective must not reuse this dispatch." },
      }),
      /does not match the prepared operation/,
    );
    const bootstrap = await authorizeHostWorktreeBootstrap({
      stateRoot,
      operationId: prepared.operation_id,
      packet: request,
    });
    assert.equal(bootstrap.attempt_id, attempt.attempt.attempt_id);
    await assert.rejects(
      reconcileTaskOperation({
        stateRoot,
        operationId: prepared.operation_id,
        attemptId: attempt.attempt.attempt_id,
        outcome: "observed",
        objectId: "host-worktree-thread",
        actualKind: "task-thread",
        evidence: taskThreadEvidence(),
      }),
      /requires a host-observed execution path/,
    );
    const observed = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: attempt.attempt.attempt_id,
      outcome: "observed",
      objectId: "host-worktree-thread",
      actualKind: "task-thread",
      evidence: taskThreadEvidence({ executionPath: "/tmp/codex-host-worktree" }),
    });
    assert.equal(observed.observed.evidence.execution_path.value, "/tmp/codex-host-worktree");
  } finally {
    await removeFixture(root);
  }
});

test("host-worktree preflight and starting-ref drift fail before a host call", async () => {
  const root = await createGitFixture("codex-flow-host-worktree-drift-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const request = hostWorktreePacket(root, { run_id: "run-host-worktree-drift-01" });
    const unsupported = await prepareTaskOperation({
      stateRoot,
      projectId: "host-worktree-project",
      packet: request,
    });
    const blocked = await recordTaskOperationHostPreflight({
      stateRoot,
      operationId: unsupported.operation_id,
      evidence: hostCapability({
        environmentType: "host-worktree",
        executionPath: { state: "unknown", basis: "unavailable" },
      }),
    });
    assert.equal(blocked.status, "host-incompatible");
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: unsupported.operation_id }),
      /execution-path-unverified/,
    );
    assert.equal(blocked.attempts.length, 0);

    const drifting = await prepareTaskOperation({
      stateRoot,
      projectId: "host-worktree-project",
      packet: hostWorktreePacket(root, { run_id: "run-host-worktree-drift-02" }),
    });
    await recordCompatiblePreflight(stateRoot, drifting.operation_id);
    await writeFile(resolve(root, "advance.txt"), "advance\n", "utf8");
    execFileSync("git", ["add", "advance.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "advance source"], { cwd: root });
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: drifting.operation_id }),
      /starting branch/,
    );
    assert.equal((await taskOperationStatus({
      stateRoot,
      operationId: drifting.operation_id,
    }))[0].attempts.length, 0);
  } finally {
    await removeFixture(root);
  }
});

test("host-worktree executor branch collisions fail before operation creation", async () => {
  const root = await createGitFixture("codex-flow-host-branch-collision-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    execFileSync("git", ["branch", "codex/existing-local", "main"], { cwd: root });
    await assert.rejects(
      prepareTaskOperation({
        stateRoot,
        projectId: "host-branch-collision",
        packet: hostWorktreePacket(root, {
          run_id: "run-host-local-collision-01",
          environment: {
            type: "host-worktree",
            repository_path: root,
            starting_branch: "main",
            executor_branch: "codex/existing-local",
          },
        }),
      }),
      /already exists locally or in fetched remote-tracking state/,
    );
    execFileSync("git", [
      "update-ref", "refs/remotes/origin/codex/existing-tracked", "refs/heads/main",
    ], { cwd: root });
    await assert.rejects(
      prepareTaskOperation({
        stateRoot,
        projectId: "host-branch-collision",
        packet: hostWorktreePacket(root, {
          run_id: "run-host-tracked-collision-01",
          environment: {
            type: "host-worktree",
            repository_path: root,
            starting_branch: "main",
            executor_branch: "codex/existing-tracked",
          },
        }),
      }),
      /already exists locally or in fetched remote-tracking state/,
    );
    assert.deepEqual(await taskOperationStatus({ stateRoot }), []);
  } finally {
    await removeFixture(root);
  }
});

test("pre-dispatch authentication rejects revision and cleanliness drift", async () => {
  const revisionRoot = await createGitFixture("codex-flow-revision-drift-");
  const cleanlinessRoot = await createGitFixture("codex-flow-cleanliness-drift-");
  try {
    const revisionState = resolve(revisionRoot, ".git", "codex-flow", "v0.5");
    const revisionOperation = await prepareTaskOperation({
      stateRoot: revisionState,
      projectId: "revision-project",
      packet: repositoryPacket(revisionRoot, { run_id: "run-revision-drift-01" }),
    });
    await recordCompatiblePreflight(revisionState, revisionOperation.operation_id);
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

    const cleanlinessState = resolve(cleanlinessRoot, ".git", "codex-flow", "v0.5");
    const cleanlinessOperation = await prepareTaskOperation({
      stateRoot: cleanlinessState,
      projectId: "cleanliness-project",
      packet: repositoryPacket(cleanlinessRoot, { run_id: "run-cleanliness-drift-01" }),
    });
    await recordCompatiblePreflight(cleanlinessState, cleanlinessOperation.operation_id);
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

test("current task operations reject missing baseline authority", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const current = packet({ run_id: "run-missing-baseline-01" });
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: current,
    });
    const recordPath = resolve(stateRoot, "task-operations", "records", `${prepared.operation_id}.json`);
    const invalid = JSON.parse(await readFile(recordPath, "utf8"));
    delete invalid.request.baseline;
    delete invalid.request.environment;
    await writeFile(recordPath, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");
    await assert.rejects(
      taskOperationStatus({ stateRoot, operationId: prepared.operation_id }),
      /requires field: baseline/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("ambiguous task creation blocks retry until inspect-before-retry reconciliation", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-ambiguous-01" }),
      now: Date.parse("2026-08-23T12:00:00Z"),
    });
    await recordCompatiblePreflight(stateRoot, prepared.operation_id);
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

test("host capability preflight is mandatory and selector incompatibility creates zero attempts", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-host-preflight-01" }),
    });
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id }),
      /requires host capability preflight/,
    );
    await assert.rejects(
      recordTaskOperationHostPreflight({
        stateRoot,
        operationId: prepared.operation_id,
        evidence: hostCapability({ query: "unavailable", fallback: "none" }),
      }),
      /requires a bounded reread path/,
    );

    const incompatible = await recordTaskOperationHostPreflight({
      stateRoot,
      operationId: prepared.operation_id,
      evidence: hostCapability({
        model: { state: "unsupported", basis: "closed-selector" },
      }),
    });
    assert.equal(incompatible.status, "host-incompatible");
    assert.equal(incompatible.incompatibility.reason_code, "model-unsupported");
    assert.equal(incompatible.attempts.length, 0);
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id }),
      /Host selector is incompatible: model-unsupported/,
    );

    const compatible = await recordCompatiblePreflight(stateRoot, prepared.operation_id, {
      hostSessionId: "desktop-session-b",
      checkedAt: "2026-08-23T12:00:31Z",
    });
    assert.equal(compatible.status, "prepared");
    assert.equal(compatible.host_preflights.at(-1).support.model.basis, "open-selector");
    await assert.rejects(
      recordCompatiblePreflight(stateRoot, prepared.operation_id, {
        hostSessionId: "desktop-session-b",
        checkedAt: "2026-08-23T12:00:32Z",
      }),
      /already rejected in this host session/,
    );
    assert.equal((await beginTaskOperationAttempt({
      stateRoot,
      operationId: prepared.operation_id,
    })).status, "dispatching");
  } finally {
    await removeFixture(root);
  }
});

test("transient serializer failure blocks only its host session", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-host-session-recovery-01" }),
    });
    await recordCompatiblePreflight(stateRoot, prepared.operation_id);
    const first = await beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id });
    const blocked = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: first.attempt.attempt_id,
      outcome: "host-session-blocked",
      reasonCode: "argument-serialization",
    });
    assert.equal(blocked.status, "host-session-blocked");
    assert.equal(blocked.incompatibility.host_session_id, "desktop-session-a");
    const recordPath = resolve(stateRoot, "task-operations", "records", `${prepared.operation_id}.json`);
    const validBytes = await readFile(recordPath, "utf8");
    const malformed = JSON.parse(validBytes);
    malformed.incompatibility.attempt_id = "task-attempt-v1-mismatched";
    await writeFile(recordPath, `${JSON.stringify(malformed, null, 2)}\n`, "utf8");
    await assert.rejects(
      taskOperationStatus({ stateRoot, operationId: prepared.operation_id }),
      /does not match its blocked attempt/,
    );
    await writeFile(recordPath, validBytes, "utf8");
    await assert.rejects(
      beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id }),
      /new host session/,
    );
    await assert.rejects(
      recordCompatiblePreflight(stateRoot, prepared.operation_id, {
        checkedAt: "2026-08-23T12:00:31Z",
      }),
      /blocked host session cannot be retried/,
    );

    const reopened = await recordCompatiblePreflight(stateRoot, prepared.operation_id, {
      hostSessionId: "desktop-session-after-reboot",
      checkedAt: "2026-08-23T12:02:00Z",
    });
    assert.equal(reopened.status, "prepared");
    assert.equal(reopened.incompatibility, null);
    const retry = await beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id });
    assert.equal(retry.attempt.sequence, 2);
    assert.equal(retry.attempt.host_preflight_id, reopened.active_host_preflight_id);
    assert.equal(reopened.host_preflights.length, 2);
  } finally {
    await removeFixture(root);
  }
});

test("task-thread reconciliation requires exact reread title and records bounded normalization", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-title-normalization-01" }),
    });
    await recordCompatiblePreflight(stateRoot, prepared.operation_id);
    const dispatch = await beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id });
    await assert.rejects(
      reconcileTaskOperation({
        stateRoot,
        operationId: prepared.operation_id,
        attemptId: dispatch.attempt.attempt_id,
        outcome: "observed",
        objectId: "thread-title-01",
        actualKind: "task-thread",
        evidence: taskThreadEvidence({ title: "Delegation envelope" }),
      }),
      /title must be independently verified/,
    );
    const observed = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: dispatch.attempt.attempt_id,
      outcome: "observed",
      objectId: "thread-title-01",
      actualKind: "task-thread",
      evidence: taskThreadEvidence({ titleNormalization: "bounded-host-write" }),
    });
    assert.equal(observed.observed.evidence.title.normalization, "bounded-host-write");
  } finally {
    await removeFixture(root);
  }
});

test("subagent reconciliation keeps unavailable title distinct from its host nickname", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({
        run_id: "run-subagent-evidence-01",
        execution_kind: "subagent",
      }),
    });
    await recordCompatiblePreflight(stateRoot, prepared.operation_id, {
      executionKind: "subagent",
      model: { state: "supported", basis: "fixed-role" },
      reasoningEffort: { state: "supported", basis: "fixed-role" },
      query: "not-applicable",
      fallback: "none",
    });
    const dispatch = await beginTaskOperationAttempt({ stateRoot, operationId: prepared.operation_id });
    const observed = await reconcileTaskOperation({
      stateRoot,
      operationId: prepared.operation_id,
      attemptId: dispatch.attempt.attempt_id,
      outcome: "observed",
      objectId: "agent-sub-01",
      actualKind: "subagent",
      evidence: subagentEvidence(),
    });
    assert.equal(observed.observed.evidence.title.value, null);
    assert.equal(observed.observed.evidence.host_label.value, "focused-runner");
    assert.deepEqual(observed.observation_evidence, {
      quality: "partial",
      gaps: [
        "title-unavailable",
        "visibility-host-contract",
        "model-role-contract",
        "reasoning-effort-role-contract",
      ],
    });
  } finally {
    await removeFixture(root);
  }
});

test("v0.5 rejects older task-operation records instead of migrating them", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
  try {
    const prepared = await prepareTaskOperation({
      stateRoot,
      projectId: "fixture-project",
      packet: packet({ run_id: "run-breaking-record-01" }),
    });
    const recordPath = resolve(stateRoot, "task-operations", "records", `${prepared.operation_id}.json`);
    const old = JSON.parse(await readFile(recordPath, "utf8"));
    old.schema_version = 4;
    await writeFile(recordPath, `${JSON.stringify(old, null, 2)}\n`, "utf8");
    await assert.rejects(
      taskOperationStatus({ stateRoot, operationId: prepared.operation_id }),
      /Unsupported task-operation record/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("task operation refuses expired launches and identity collisions", async () => {
  const root = await createGitFixture();
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
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
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.5");
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
    await recordCompatiblePreflight(stateRoot, prepared.operation_id, {
      checkedAt: "2026-08-23T12:01:00Z",
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
