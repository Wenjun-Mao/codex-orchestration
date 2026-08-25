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
    assert.ok(Buffer.byteLength(JSON.stringify(prepared.direct_envelope)) <= 512);
    assert.equal("requested_action" in prepared.direct_envelope, false);

    const reconcileResult = runCli([
      "urgent", "attempt", "reconcile",
      "--urgent-id", persisted.urgent_id,
      "--delivery-attempt-id", prepared.delivery_attempt_id,
      "--outcome", "accepted",
      "--json",
    ], { cwd: root });
    assertSuccess(reconcileResult, "urgent attempt reconcile");

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

    const replayResult = runCli(observeArgs, { cwd: root });
    assertSuccess(replayResult, "urgent replay observe");
    assert.deepEqual(JSON.parse(replayResult.stdout), {
      status: "duplicate-host-replay",
      disposition: "suppress",
      urgent_id: persisted.urgent_id,
      delivery_attempt_id: prepared.delivery_attempt_id,
    });

    const consumedResult = runCli([
      "urgent", "consume",
      "--urgent-id", persisted.urgent_id,
      "--lineage-id", "cli-urgent-lineage",
      "--thread-id", "cli-urgent-coordinator",
      "--generation", "1",
      "--executor-id", "cli-urgent-executor",
      "--json",
    ], { cwd: root });
    assertSuccess(consumedResult, "urgent consume");

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
