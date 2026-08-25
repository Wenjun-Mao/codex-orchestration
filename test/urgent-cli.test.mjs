import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  initializeFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function signal() {
  return {
    schema_version: 1,
    recipient: {
      lineage_id: "cli-urgent-lineage",
      thread_id: "cli-urgent-coordinator",
      generation: 1,
    },
    executor_id: "cli-urgent-executor",
    run_id: "cli-urgent-run-01",
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2030-08-23T17:15:00-04:00",
    classification: "high-risk-drift",
    summary: "The approved scope has materially expanded.",
    requested_action: "Confirm the revised ownership boundary before continuing.",
  };
}

test("CLI persists, identifies, suppresses, and reports urgent direct delivery", async () => {
  const root = await createGitFixture("codex-flow-urgent-cli-");
  try {
    initializeFixture([], { cwd: root });
    const bound = runCli([
      "recipient", "bind",
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--json",
    ], { cwd: root });
    assertSuccess(bound, "recipient bind");

    const persistedResult = runCli(["urgent", "persist", "--json"], {
      cwd: root,
      input: signal(),
    });
    assertSuccess(persistedResult, "urgent persist");
    const persisted = JSON.parse(persistedResult.stdout);
    assert.equal(persisted.status, "persisted");

    const pendingDoctorResult = runCli(["doctor", "--json"], { cwd: root });
    assert.equal(pendingDoctorResult.status, 1);
    const pendingDoctor = JSON.parse(pendingDoctorResult.stdout);
    assert.equal(pendingDoctor.ok, false);
    assert.equal(pendingDoctor.urgent_signals.pending_count, 1);
    assert.match(pendingDoctor.errors.join("\n"), /require coordinator disposition/);

    const prepareResult = runCli([
      "urgent", "attempt", "prepare",
      "--urgent-id", persisted.urgent_id,
      "--attempt-sequence", "1",
      "--json",
    ], { cwd: root });
    assertSuccess(prepareResult, "urgent attempt prepare");
    const prepared = JSON.parse(prepareResult.stdout);
    assert.equal(prepared.dispatch_permitted, true);
    assert.equal("direct_envelope" in prepared, false);
    assert.ok(Buffer.byteLength(prepared.host_prompt) <= 512);
    const hostPrompt = JSON.parse(prepared.host_prompt);
    assert.equal(hostPrompt.delivery_attempt_id, prepared.delivery_attempt_id);
    assert.equal("requested_action" in hostPrompt, false);

    const legacyReconcile = runCli([
      "urgent", "attempt", "reconcile",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--outcome", "accepted",
      "--json",
    ], { cwd: root });
    assert.notEqual(legacyReconcile.status, 0);
    assert.match(legacyReconcile.stderr, /Unknown option '--outcome'/);
    const stillPrepared = runCli([
      "urgent", "attempt", "prepare",
      "--urgent-id", persisted.urgent_id,
      "--attempt-sequence", "1",
      "--json",
    ], { cwd: root });
    assertSuccess(stillPrepared, "urgent duplicate prepare after rejected legacy flag");
    assert.equal(JSON.parse(stillPrepared.stdout).status, "already-prepared");

    const reconcileResult = runCli([
      "urgent", "attempt", "reconcile",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--host-call-result", "sent",
      "--json",
    ], { cwd: root });
    assertSuccess(reconcileResult, "urgent attempt reconcile");
    assert.equal(JSON.parse(reconcileResult.stdout).status, "sent");

    const observeArgs = [
      "urgent", "observe",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--generation", "1",
      "--json",
    ];
    const observedResult = runCli(observeArgs, { cwd: root });
    assertSuccess(observedResult, "urgent observe");
    const observed = JSON.parse(observedResult.stdout);
    assert.equal(observed.disposition, "process");
    assert.equal(observed.signal.requested_action, signal().requested_action);
    assert.deepEqual(observed.consume_arguments, {
      urgent_id: persisted.urgent_id,
      lineage_id: "cli-urgent-lineage",
      thread_id: "cli-urgent-coordinator",
      generation: 1,
      sender_executor_id: "cli-urgent-executor",
    });

    const replayResult = runCli(observeArgs, { cwd: root });
    assertSuccess(replayResult, "urgent replay observe");
    assert.deepEqual(JSON.parse(replayResult.stdout), {
      status: "duplicate-host-replay",
      disposition: "suppress",
      urgent_id: persisted.urgent_id,
      delivery_attempt_id: prepared.delivery_attempt_id,
    });

    const legacyConsumeResult = runCli([
      "urgent", "consume",
      "--urgent-id", persisted.urgent_id,
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--generation", "1",
      "--executor-id", "cli-urgent-executor",
      "--json",
    ], { cwd: root });
    assert.notEqual(legacyConsumeResult.status, 0);
    assert.match(legacyConsumeResult.stderr, /Unknown option '--executor-id'/);
    const pendingAfterLegacyConsume = runCli(["urgent", "status", "--json"], { cwd: root });
    assertSuccess(pendingAfterLegacyConsume, "urgent status after rejected legacy consume flag");
    assert.equal(JSON.parse(pendingAfterLegacyConsume.stdout).pending.length, 1);

    const consumedResult = runCli([
      "urgent", "consume",
      "--urgent-id", persisted.urgent_id,
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--generation", "1",
      "--sender-executor-id", "cli-urgent-executor",
      "--json",
    ], { cwd: root });
    assertSuccess(consumedResult, "urgent consume");
    assert.equal(JSON.parse(consumedResult.stdout).status, "consumed");

    const statusResult = runCli(["urgent", "status", "--json"], { cwd: root });
    assertSuccess(statusResult, "urgent status");
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.consumed_count, 1);
    assert.equal(status.host_replay_count, 1);
    assert.equal(status.sender_attempt_duplicate_count, 0);

    const doctorResult = runCli(["doctor", "--json"], { cwd: root });
    assertSuccess(doctorResult, "doctor");
    const doctor = JSON.parse(doctorResult.stdout);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.urgent_signals.host_replay_count, 1);
    assert.match(doctor.warnings.join("\n"), /host replay/);

    const cleanupResult = runCli(["cleanup", "audit", "--json"], { cwd: root });
    assertSuccess(cleanupResult, "cleanup audit");
    const cleanup = JSON.parse(cleanupResult.stdout);
    assert.equal(cleanup.mutation_performed, false);
    assert.equal(cleanup.urgent_signals.host_replay_count, 1);
  } finally {
    await removeFixture(root);
  }
});

test("CLI human observe output prints the sender-explicit consume command", async () => {
  const root = await createGitFixture("codex-flow-urgent-human-cli-");
  try {
    initializeFixture([], { cwd: root });
    assertSuccess(runCli([
      "recipient", "bind",
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--json",
    ], { cwd: root }), "recipient bind");
    const persistedResult = runCli(["urgent", "persist", "--json"], {
      cwd: root,
      input: signal(),
    });
    assertSuccess(persistedResult, "urgent persist");
    const persisted = JSON.parse(persistedResult.stdout);
    const prepareResult = runCli([
      "urgent", "attempt", "prepare",
      "--urgent-id", persisted.urgent_id,
      "--attempt-sequence", "1",
      "--json",
    ], { cwd: root });
    assertSuccess(prepareResult, "urgent attempt prepare");
    const prepared = JSON.parse(prepareResult.stdout);
    assertSuccess(runCli([
      "urgent", "attempt", "reconcile",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--host-call-result", "sent",
      "--json",
    ], { cwd: root }), "urgent attempt reconcile");

    const observedResult = runCli([
      "urgent", "observe",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--generation", "1",
    ], { cwd: root });
    assertSuccess(observedResult, "urgent human observe");
    assert.match(observedResult.stdout, new RegExp(
      `Next: codex-flow urgent consume --urgent-id ${persisted.urgent_id} .* --sender-executor-id cli-urgent-executor`,
    ));
  } finally {
    await removeFixture(root);
  }
});
