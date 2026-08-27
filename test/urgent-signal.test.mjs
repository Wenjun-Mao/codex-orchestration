import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient, rebindRecipient } from "../lib/recipients.mjs";
import {
  consumeUrgentSignal,
  expireUrgentSignal,
  observeUrgentSignal,
  persistUrgentSignal,
  prepareUrgentAttempt,
  reconcileUrgentAttempt,
  urgentIdFor,
  urgentSignalPaths,
  urgentSignalStatus,
  validateUrgentSignal,
} from "../lib/urgent-signals.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function signal(overrides = {}) {
  const base = {
    schema_version: 1,
    recipient: {
      lineage_id: "fixture-lineage",
      thread_id: "fixture-coordinator",
      generation: 1,
    },
    executor_id: "fixture-executor",
    run_id: "run-urgent-01",
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2030-08-23T17:15:00-04:00",
    classification: "blocker",
    summary: "Source authority is unavailable.",
    requested_action: "Confirm the source authority before work resumes.",
  };
  return {
    ...base,
    ...overrides,
    recipient: { ...base.recipient, ...overrides.recipient },
  };
}

function stateRoot(root) {
  return resolve(root, ".git", "codex-flow", "v0.5");
}

async function bind(root, recipient = signal().recipient) {
  return bindRecipient({ stateRoot: stateRoot(root), recipient });
}

async function record(root, payload) {
  return JSON.parse(await readFile(urgentSignalPaths(stateRoot(root), payload).record, "utf8"));
}

test("one sender attempt replayed by the host is processed exactly once", async () => {
  const root = await createGitFixture("codex-flow-urgent-host-replay-");
  try {
    await bind(root);
    const payload = signal();
    const persisted = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: payload,
      now: Date.now() - (25 * 60 * 60 * 1000),
    });
    assert.equal(persisted.status, "persisted");

    const prepared = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      attemptSequence: 1,
    });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.dispatch_permitted, true);
    const hostPrompt = JSON.parse(prepared.host_prompt);
    assert.equal(hostPrompt.urgent_id, persisted.urgent_id);
    assert.equal(hostPrompt.delivery_attempt_id, prepared.delivery_attempt_id);
    assert.deepEqual(hostPrompt.recipient, payload.recipient);

    const duplicatePrepare = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      attemptSequence: 1,
    });
    assert.equal(duplicatePrepare.status, "already-prepared");
    assert.equal(duplicatePrepare.dispatch_permitted, false);
    assert.equal(duplicatePrepare.delivery_attempt_id, prepared.delivery_attempt_id);

    assert.equal((await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      hostCallResult: "sent",
    })).status, "sent");
    const alreadySent = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      attemptSequence: 1,
    });
    assert.equal(alreadySent.status, "already-sent");
    assert.equal(alreadySent.dispatch_permitted, false);
    assert.equal((await record(root, payload)).attempts[0].outcome, "accepted");
    const first = await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      recipient: payload.recipient,
    });
    assert.equal(first.status, "observed");
    assert.equal(first.disposition, "process");
    assert.deepEqual(first.signal, payload);
    assert.deepEqual(first.consume_arguments, {
      urgent_id: persisted.urgent_id,
      lineage_id: payload.recipient.lineage_id,
      thread_id: payload.recipient.thread_id,
      generation: payload.recipient.generation,
      sender_executor_id: payload.executor_id,
    });

    const replay = await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      recipient: payload.recipient,
    });
    assert.equal(replay.status, "duplicate-host-replay");
    assert.equal(replay.disposition, "suppress");
    assert.equal("signal" in replay, false);

    const pendingStatus = await urgentSignalStatus(stateRoot(root));
    assert.equal(pendingStatus.pending.length, 1);
    assert.ok(pendingStatus.pending[0].age_seconds >= 25 * 60 * 60);

    assert.equal((await consumeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      recipient: payload.recipient,
      senderExecutorId: payload.executor_id,
    })).status, "consumed");
    assert.equal((await consumeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      recipient: payload.recipient,
      senderExecutorId: payload.executor_id,
    })).status, "already-consumed");

    const status = await urgentSignalStatus(stateRoot(root));
    assert.deepEqual(status, {
      pending: [],
      consumed_count: 1,
      superseded_count: 0,
      expired_count: 0,
      host_replay_count: 1,
      sender_attempt_duplicate_count: 0,
    });
  } finally {
    await removeFixture(root);
  }
});

test("different delivery attempts remain one logical urgent signal", async () => {
  const root = await createGitFixture("codex-flow-urgent-sender-retry-");
  try {
    await bind(root);
    const payload = signal({ run_id: "run-urgent-retry-01" });
    const { urgent_id: urgentId } = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: payload,
    });
    const first = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 1,
    });
    await assert.rejects(prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 2,
      retryReason: "host-ambiguous",
    }), /must be reconciled/);
    await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: first.delivery_attempt_id,
      hostCallResult: "ambiguous",
    });
    const second = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 2,
      retryReason: "host-ambiguous",
    });
    assert.notEqual(second.delivery_attempt_id, first.delivery_attempt_id);
    await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: second.delivery_attempt_id,
      hostCallResult: "sent",
    });

    assert.equal((await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: second.delivery_attempt_id,
      recipient: payload.recipient,
    })).disposition, "process");
    const lateFirstAttempt = await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: first.delivery_attempt_id,
      recipient: payload.recipient,
    });
    assert.equal(lateFirstAttempt.status, "duplicate-sender-attempt");
    assert.equal(lateFirstAttempt.disposition, "suppress");
    const replayOfFirstAttempt = await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: first.delivery_attempt_id,
      recipient: payload.recipient,
    });
    assert.equal(replayOfFirstAttempt.status, "duplicate-host-replay");

    await consumeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      recipient: payload.recipient,
      senderExecutorId: payload.executor_id,
    });
    const status = await urgentSignalStatus(stateRoot(root));
    assert.equal(status.host_replay_count, 1);
    assert.equal(status.sender_attempt_duplicate_count, 1);
  } finally {
    await removeFixture(root);
  }
});

test("an observed host attempt cannot later be reconciled as rejected-before-send", async () => {
  const root = await createGitFixture("codex-flow-urgent-observed-reconcile-");
  try {
    await bind(root);
    const payload = signal({ run_id: "run-urgent-observed-reconcile-01" });
    const { urgent_id: urgentId } = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: payload,
    });
    const attempt = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 1,
    });
    assert.equal((await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: attempt.delivery_attempt_id,
      recipient: payload.recipient,
    })).disposition, "process");
    await assert.rejects(reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: attempt.delivery_attempt_id,
      hostCallResult: "rejected-before-send",
    }), /cannot be reconciled as rejected-before-send/);
    assert.equal((await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: attempt.delivery_attempt_id,
      hostCallResult: "ambiguous",
    })).status, "ambiguous");
  } finally {
    await removeFixture(root);
  }
});

test("corrected urgent signals advance sequence and suppress an unobserved predecessor", async () => {
  const root = await createGitFixture("codex-flow-urgent-correction-");
  try {
    await bind(root);
    const first = signal({ run_id: "run-urgent-correction-01" });
    const firstPersisted = await persistUrgentSignal({ stateRoot: stateRoot(root), signal: first });
    const firstAttempt = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: firstPersisted.urgent_id,
      attemptSequence: 1,
    });
    await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: firstPersisted.urgent_id,
      deliveryAttemptId: firstAttempt.delivery_attempt_id,
      hostCallResult: "sent",
    });

    await assert.rejects(persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: signal({ run_id: first.run_id, summary: "Changed under the same sequence." }),
    }), /immutable urgent identity/);

    const corrected = signal({
      run_id: first.run_id,
      sequence: 2,
      supersedes_urgent_ids: [firstPersisted.urgent_id],
      summary: "The source authority was found but conflicts with the target.",
      requested_action: "Choose the source-backed resolution before work resumes.",
    });
    const correctedPersisted = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: corrected,
    });
    assert.equal((await record(root, first)).state, "superseded");
    const stale = await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: firstPersisted.urgent_id,
      deliveryAttemptId: firstAttempt.delivery_attempt_id,
      recipient: first.recipient,
    });
    assert.equal(stale.status, "already-superseded");
    assert.equal(stale.disposition, "suppress");

    const correctedAttempt = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: correctedPersisted.urgent_id,
      attemptSequence: 1,
    });
    assert.equal((await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: correctedPersisted.urgent_id,
      deliveryAttemptId: correctedAttempt.delivery_attempt_id,
      recipient: corrected.recipient,
    })).disposition, "process");
    await consumeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: correctedPersisted.urgent_id,
      recipient: corrected.recipient,
      senderExecutorId: corrected.executor_id,
    });

    const third = signal({
      run_id: first.run_id,
      sequence: 3,
      supersedes_urgent_ids: [correctedPersisted.urgent_id],
      summary: "The coordinator decision introduced a new blocker.",
      requested_action: "Review the newly discovered source constraint.",
    });
    assert.equal((await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: third,
    })).status, "persisted");
    assert.equal((await record(root, corrected)).state, "consumed");
  } finally {
    await removeFixture(root);
  }
});

test("delivery attempts freeze the current recipient generation", async () => {
  const root = await createGitFixture("codex-flow-urgent-rebind-");
  try {
    const initial = await bind(root);
    const payload = signal({ run_id: "run-urgent-rebind-01" });
    const { urgent_id: urgentId } = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: payload,
    });
    const first = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 1,
    });
    await reconcileUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: first.delivery_attempt_id,
      hostCallResult: "ambiguous",
    });
    const rebound = await rebindRecipient({
      stateRoot: stateRoot(root),
      recipient: {
        lineage_id: payload.recipient.lineage_id,
        thread_id: "fixture-coordinator-next",
        generation: 2,
      },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "fixture-next-fence",
    });
    const current = {
      lineage_id: rebound.recipient.lineage_id,
      thread_id: rebound.recipient.thread_id,
      generation: rebound.recipient.generation,
    };
    await assert.rejects(prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 1,
    }), /prior coordinator generation/);
    const second = await prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 2,
      retryReason: "recipient-rebound",
    });
    assert.deepEqual(JSON.parse(second.host_prompt).recipient, current);
    assert.notEqual(second.delivery_attempt_id, first.delivery_attempt_id);
    await assert.rejects(observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: first.delivery_attempt_id,
      recipient: payload.recipient,
    }), /binding is stale/);
    assert.equal((await observeUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId,
      deliveryAttemptId: second.delivery_attempt_id,
      recipient: current,
    })).disposition, "process");
  } finally {
    await removeFixture(root);
  }
});

test("urgent signals expire fail closed and reject unsafe content", async () => {
  const root = await createGitFixture("codex-flow-urgent-safety-");
  try {
    await bind(root);
    assert.throws(() => validateUrgentSignal(signal({ summary: "stdout: raw device output" })), /raw log/);
    assert.throws(() => validateUrgentSignal(signal({ requested_action: "Contact jane@example.com" })), /identity-like/);
    assert.throws(() => validateUrgentSignal(signal({ summary: "Client key: not-for-signals" })), /application or account identifier/);
    assert.throws(() => validateUrgentSignal(signal({ sequence: 2 })), /exactly one predecessor/);
    const expiring = signal({
      run_id: "run-urgent-expiry-01",
      expires_at: "2029-01-01T00:00:00Z",
    });
    const persisted = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: expiring,
      now: Date.parse("2028-01-01T00:00:00Z"),
    });
    assert.equal((await expireUrgentSignal({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      now: Date.parse("2030-01-01T00:00:00Z"),
    })).status, "expired");
    await assert.rejects(prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId: persisted.urgent_id,
      attemptSequence: 1,
    }), /expired urgent signal/);
  } finally {
    await removeFixture(root);
  }
});

test("oversized host prompts fail before an attempt is journaled", async () => {
  const root = await createGitFixture("codex-flow-urgent-envelope-bound-");
  try {
    await bind(root);
    const payload = signal({
      run_id: "run-urgent-envelope-bound-01",
      recipient: {
        lineage_id: "l".repeat(128),
        thread_id: "t".repeat(128),
      },
      summary: "界".repeat(512),
    });
    await bind(root, payload.recipient);
    const { urgent_id: urgentId } = await persistUrgentSignal({
      stateRoot: stateRoot(root),
      signal: payload,
    });
    await assert.rejects(prepareUrgentAttempt({
      stateRoot: stateRoot(root),
      urgentId,
      attemptSequence: 1,
    }), /2 KiB delivery limit/);
    assert.deepEqual((await record(root, payload)).attempts, []);
  } finally {
    await removeFixture(root);
  }
});
