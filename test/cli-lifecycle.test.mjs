import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assertSuccess, createGitFixture, initializeFixture, removeFixture, runCli } from "./helpers.mjs";

function receipt() {
  return {
    schema_version: 2,
    recipient: {
      lineage_id: "cli-lineage",
      thread_id: "cli-coordinator",
      generation: 1,
    },
    executor_id: "cli-executor",
    run_id: "cli-run-01",
    source_revision: "0123456789abcdef",
    sequence: 1,
    supersedes_callback_ids: [],
    expires_at: "2030-08-23T17:15:00-04:00",
    classification: "PASS",
    branch: "codex/cli-executor",
    commit: "0123456789abcdef",
    upstream: "origin/codex/cli-executor",
    cleanliness: "clean",
    result_or_blocker: "Bounded CLI result complete.",
    next_decision: "Integrate once.",
    accounting: {
      PRODUCT: 0,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 1,
    },
  };
}

function operationPacket(root) {
  return {
    schema_version: 3,
    task_id: "cli-task-operation",
    run_id: "cli-task-operation-run-01",
    role: "executor",
    execution_kind: "task-thread",
    title: "CLI task operation probe",
    objective: "Exercise host preflight and evidence reconciliation through the CLI.",
    baseline: {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      cleanliness: "dirty-authorized",
    },
    environment: { type: "local", project_path: root },
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    launch_deadline: { at: "2030-08-23T17:15:00-04:00", timezone: "America/Toronto" },
    ownership: { write_paths: ["src/probe"], read_paths: ["src"], exclusions: [] },
    dependencies: [],
    shared_resources: [],
    verification: ["Observe the exact host object."],
    callback: {
      recipient: { lineage_id: "cli-lineage", thread_id: "cli-coordinator", generation: 1 },
      executor_id: "cli-task-operation",
      receipt_schema_version: 2,
    },
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "journal-monitor",
    },
    integration_gate: { gate_id: "cli-operation-gate", reproof: ["Run CLI tests."] },
    cleanup_owner: "cli-lineage",
  };
}

function hostWorktreeOperationPacket(root) {
  return {
    ...operationPacket(root),
    task_id: "cli-host-worktree",
    run_id: "cli-host-worktree-run-01",
    title: "CLI host worktree probe",
    baseline: {
      revision: execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: root, encoding: "utf8" }).trim(),
      cleanliness: "clean",
    },
    environment: {
      type: "host-worktree",
      repository_path: root,
      starting_branch: "main",
    },
    callback: {
      ...operationPacket(root).callback,
      executor_id: "cli-host-worktree",
    },
  };
}

function hostCapability(environmentType = "local") {
  return {
    schema_version: 2,
    adapter_id: "cli-test-host",
    host_session_id: "cli-test-session",
    checked_at: "2026-08-23T12:00:00Z",
    execution_kind: "task-thread",
    environment_type: environmentType,
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      environment: { state: "supported", basis: "tool-schema" },
      execution_path: environmentType === "host-worktree"
        ? { state: "supported", basis: "host-contract" }
        : { state: "not-required", basis: "not-required" },
      model: { state: "supported", basis: "open-selector" },
      reasoning_effort: { state: "supported", basis: "open-selector" },
    },
    thread_discovery: { query: "rejected", fallback: "bounded-unfiltered" },
  };
}

function hostObservation(executionPath = null, title = "CLI task operation probe") {
  return {
    schema_version: 2,
    title: {
      source: "host-observed",
      value: title,
      normalization: "bounded-host-write",
    },
    visibility: { source: "host-observed", value: true },
    model: { source: "host-accepted", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "host-accepted", value: "xhigh" },
    host_label: { source: "unavailable", value: null },
    execution_path: executionPath === null
      ? { source: "not-required", value: null }
      : { source: "host-observed", value: executionPath },
  };
}

test("CLI binds a redacted recipient and enforces observe before consume", async () => {
  const root = await createGitFixture("codex-flow-cli-lifecycle-");
  try {
    initializeFixture([], { cwd: root });

    const binding = runCli([
      "recipient", "bind", "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--json",
    ], { cwd: root });
    assertSuccess(binding, "recipient bind");
    assert.ok(JSON.parse(binding.stdout).recipient.fence_token);
    const repeatedBinding = runCli([
      "recipient", "bind", "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--json",
    ], { cwd: root });
    assertSuccess(repeatedBinding, "recipient bind replay");
    assert.equal(JSON.parse(repeatedBinding.stdout).recipient.fence_token, undefined);
    const status = runCli(["recipient", "status", "--lineage-id", "cli-lineage", "--json"], { cwd: root });
    assertSuccess(status, "recipient status");
    assert.equal(JSON.parse(status.stdout).current.fence_token, undefined);

    const delivered = runCli(["callback", "deliver", "--json"], {
      cwd: root,
      input: receipt(),
    });
    assertSuccess(delivered, "callback deliver");
    const callbackId = JSON.parse(delivered.stdout).callback_id;

    const premature = runCli([
      "callback", "consume", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
      "--executor-id", "cli-executor",
    ], { cwd: root });
    assert.equal(premature.status, 73);
    assert.match(premature.stderr, /observed before it can be consumed/);

    assertSuccess(runCli([
      "callback", "observe", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
    ], { cwd: root }), "callback observe");
    assertSuccess(runCli([
      "callback", "consume", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
      "--executor-id", "cli-executor",
    ], { cwd: root }), "callback consume");

    const callbacks = runCli(["callback", "status", "--json"], { cwd: root });
    assertSuccess(callbacks, "callback status");
    assert.equal(JSON.parse(callbacks.stdout).consumed_count, 1);
  } finally {
    await removeFixture(root);
  }
});

test("CLI requires preflight and records provenance-rich host reconciliation", async () => {
  const root = await createGitFixture("codex-flow-cli-task-operation-");
  try {
    initializeFixture([], { cwd: root });
    const preparedResult = runCli(["task", "operation", "prepare", "--json"], {
      cwd: root,
      input: operationPacket(root),
    });
    assertSuccess(preparedResult, "task operation prepare");
    const prepared = JSON.parse(preparedResult.stdout);

    const premature = runCli([
      "task", "operation", "attempt", "--operation-id", prepared.operation_id,
    ], { cwd: root });
    assert.equal(premature.status, 75);
    assert.match(premature.stderr, /requires host capability preflight/);

    const preflightResult = runCli([
      "task", "operation", "preflight", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root, input: hostCapability() });
    assertSuccess(preflightResult, "task operation preflight");
    const preflight = JSON.parse(preflightResult.stdout);
    assert.equal(preflight.host_preflights.length, 1);

    const attemptResult = runCli([
      "task", "operation", "attempt", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root });
    assertSuccess(attemptResult, "task operation attempt");
    const attempt = JSON.parse(attemptResult.stdout);

    const evidencePath = resolve(root, "host-observation.json");
    await writeFile(evidencePath, `${JSON.stringify(hostObservation(), null, 2)}\n`, "utf8");
    const observedResult = runCli([
      "task", "operation", "reconcile",
      "--operation-id", prepared.operation_id,
      "--attempt-id", attempt.attempt.attempt_id,
      "--outcome", "observed",
      "--object-id", "thread-cli-01",
      "--actual-kind", "task-thread",
      "--evidence", evidencePath,
      "--json",
    ], { cwd: root });
    assertSuccess(observedResult, "task operation reconcile");
    const observed = JSON.parse(observedResult.stdout);
    assert.equal(observed.observed.evidence.title.normalization, "bounded-host-write");
    assert.equal(observed.observation_evidence.quality, "partial");

    const boundResult = runCli([
      "git", "bind", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root });
    assertSuccess(boundResult, "git ownership bind");
    assert.equal(JSON.parse(boundResult.stdout).executor_id, "cli-task-operation");

    const gitStatus = runCli(["git", "status", "--json"], { cwd: root });
    assertSuccess(gitStatus, "git lifecycle status");
    assert.equal(JSON.parse(gitStatus.stdout).items.length, 1);
  } finally {
    await removeFixture(root);
  }
});

test("CLI gates a host-created worktree between bootstrap and Git-bound release", async () => {
  const root = await createGitFixture("codex-flow-cli-host-worktree-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-host-parent-"));
  const worktree = resolve(worktreeParent, "executor");
  try {
    initializeFixture([], { cwd: root });
    const request = hostWorktreeOperationPacket(root);
    const preparedResult = runCli(["task", "operation", "prepare", "--json"], {
      cwd: root,
      input: request,
    });
    assertSuccess(preparedResult, "host-worktree prepare");
    const prepared = JSON.parse(preparedResult.stdout);
    assertSuccess(runCli([
      "task", "operation", "preflight", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root, input: hostCapability("host-worktree") }), "host-worktree preflight");
    const attemptResult = runCli([
      "task", "operation", "attempt", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root });
    assertSuccess(attemptResult, "host-worktree attempt");
    const attempt = JSON.parse(attemptResult.stdout);
    const bootstrap = runCli([
      "task", "operation", "bootstrap", "--operation-id", prepared.operation_id,
    ], { cwd: root, input: request });
    assertSuccess(bootstrap, "host-worktree bootstrap");
    assert.match(bootstrap.stdout, /bootstrap turn only/);
    assert.doesNotMatch(bootstrap.stdout, /Exercise host preflight/);

    execFileSync("git", ["worktree", "add", "--quiet", "-b", "codex/cli-host-worktree", worktree, "main"], {
      cwd: root,
    });
    const evidencePath = resolve(root, "host-worktree-observation.json");
    await writeFile(evidencePath, `${JSON.stringify(
      hostObservation(worktree, request.title),
      null,
      2,
    )}\n`, "utf8");
    assertSuccess(runCli([
      "task", "operation", "reconcile",
      "--operation-id", prepared.operation_id,
      "--attempt-id", attempt.attempt.attempt_id,
      "--outcome", "observed",
      "--object-id", "thread-cli-host-worktree",
      "--actual-kind", "task-thread",
      "--evidence", evidencePath,
    ], { cwd: root }), "host-worktree reconcile");

    const premature = runCli([
      "task", "operation", "release", "--operation-id", prepared.operation_id,
    ], { cwd: root, input: request });
    assert.notEqual(premature.status, 0);
    assert.match(premature.stderr, /requires bound Git ownership/);
    assertSuccess(runCli([
      "git", "bind", "--operation-id", prepared.operation_id,
    ], { cwd: root }), "host-worktree Git bind");
    const released = runCli([
      "task", "operation", "release", "--operation-id", prepared.operation_id,
    ], { cwd: root, input: request });
    assertSuccess(released, "host-worktree release");
    assert.match(released.stdout, /Exercise host preflight and evidence reconciliation/);
    assert.match(released.stdout, /host-worktree.*codex\/pilot|host-worktree.*main/);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });
    } catch {}
    await removeFixture(root);
    await rm(worktreeParent, { recursive: true, force: true });
  }
});
