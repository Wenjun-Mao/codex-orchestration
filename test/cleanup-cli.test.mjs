import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createGitFixture,
  initializeFixture,
  removeFixture,
  runLegacyCli,
} from "./helpers.mjs";

function operationPacket(root) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return {
    schema_version: 5,
    task_id: "cli-policy-rejected",
    run_id: "run-cli-policy-rejected-01",
    role: "executor",
    execution_kind: "task-thread",
    title: "CLI policy rejected operation",
    objective: "Exercise durable CLI observation policy rejection.",
    baseline: { revision, cleanliness: "dirty-authorized" },
    environment: { type: "local", project_path: root },
    host_placement: {
      mode: "same-project",
      target_project_id: "saved-project-cli-policy",
      reason: null,
    },
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    launch_deadline: { at: "2030-08-24T17:00:00-04:00", timezone: "America/Toronto" },
    ownership: { write_paths: ["src/fixture"], read_paths: ["src"], exclusions: [] },
    dependencies: [],
    shared_resources: [],
    verification: ["Inspect the retained observation."],
    callback: {
      recipient: { lineage_id: "coordinator", thread_id: "coordinator-thread", generation: 1 },
      executor_id: "cli-policy-rejected",
      receipt_schema_version: 2,
    },
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "journal-monitor",
    },
    integration_gate: { gate_id: "cli-policy-gate", reproof: ["Run focused tests."] },
    cleanup_owner: "coordinator",
  };
}

function capabilityEvidence() {
  return {
    schema_version: 3,
    adapter_id: "codex-desktop-host",
    host_session_id: "cli-policy-session",
    checked_at: "2026-08-24T12:00:00Z",
    execution_kind: "task-thread",
    environment_type: "local",
    placement_mode: "same-project",
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      environment: { state: "supported", basis: "tool-schema" },
      execution_path: { state: "not-required", basis: "not-required" },
      project_placement: { state: "supported", basis: "tool-schema" },
      model: { state: "supported", basis: "open-selector" },
      reasoning_effort: { state: "supported", basis: "open-selector" },
    },
    thread_discovery: { query: "rejected", fallback: "bounded-unfiltered" },
  };
}

function observationEvidence(title) {
  return {
    schema_version: 3,
    title: { source: "host-observed", value: title, normalization: "none" },
    visibility: { source: "host-observed", value: true },
    model: { source: "host-observed", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "host-observed", value: "xhigh" },
    host_label: { source: "unavailable", value: null },
    execution_path: { source: "not-required", value: null },
    project_placement: { source: "unavailable", value: null },
  };
}

test("cleanup CLI emits a structured nonempty failure result", async () => {
  const root = await createGitFixture("codex-flow-cleanup-cli-");
  try {
    initializeFixture([], { cwd: root });
    const result = runLegacyCli([
      "cleanup", "apply",
      "--plan-id", "0".repeat(64),
      "--main-branch", "main",
      "--json",
    ], { cwd: root });

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /undefined/);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.status, "failed");
    assert.equal(failure.plan_id, "0".repeat(64));
    assert.deepEqual(failure.completed_actions, []);
    assert.equal(failure.failed_action, "preflight");
    assert.match(failure.error, /between 1 and 64 explicit operation IDs/);
  } finally {
    await removeFixture(root);
  }
});

test("CLI reconcile preserves a policy-rejected observation and exits fail-closed", async () => {
  const root = await createGitFixture("codex-flow-cli-observation-policy-");
  try {
    initializeFixture([], { cwd: root });
    const packet = operationPacket(root);
    const preparedResult = runLegacyCli([
      "task", "operation", "prepare", "--json",
    ], { cwd: root, input: packet });
    assert.equal(preparedResult.status, 0, preparedResult.stderr);
    const prepared = JSON.parse(preparedResult.stdout);
    const preflight = runLegacyCli([
      "task", "operation", "preflight", "--operation-id", prepared.operation_id,
    ], { cwd: root, input: capabilityEvidence() });
    assert.equal(preflight.status, 0);
    const attemptResult = runLegacyCli([
      "task", "operation", "attempt", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root });
    assert.equal(attemptResult.status, 0, attemptResult.stderr);
    const attempt = JSON.parse(attemptResult.stdout);
    const evidencePath = resolve(root, "policy-rejected-observation.json");
    await writeFile(evidencePath, `${JSON.stringify(observationEvidence(packet.title), null, 2)}\n`, "utf8");
    const reconciled = runLegacyCli([
      "task", "operation", "reconcile",
      "--operation-id", prepared.operation_id,
      "--attempt-id", attempt.attempt.attempt_id,
      "--outcome", "observed",
      "--object-id", "thread-cli-policy-rejected",
      "--actual-kind", "task-thread",
      "--evidence", evidencePath,
      "--json",
    ], { cwd: root });
    assert.equal(reconciled.status, 74);
    const observation = JSON.parse(reconciled.stdout);
    assert.equal(observation.status, "observed");
    assert.equal(observation.observed.object_id, "thread-cli-policy-rejected");
    assert.equal(observation.attempts.at(-1).status, "observed");
    assert.deepEqual(observation.observation_policy, {
      state: "rejected",
      reason_code: "project-placement-unavailable",
    });
    const status = runLegacyCli([
      "task", "operation", "status", "--operation-id", prepared.operation_id, "--json",
    ], { cwd: root });
    assert.equal(status.status, 0);
    assert.deepEqual(JSON.parse(status.stdout)[0].observation_policy, observation.observation_policy);
  } finally {
    await removeFixture(root);
  }
});
