import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient, rebindRecipient } from "../lib/recipients.mjs";
import {
  consumeUrgentSignalV06,
  expireUrgentSignalV06,
  observeUrgentSignalV06,
  persistUrgentSignalV06,
  prepareUrgentAttemptV06,
  reconcileUrgentAttemptV06,
  urgentAttemptIdForV06,
  urgentIdForV06,
  urgentSignalPathsV06,
  urgentSignalRecordV06,
  urgentSignalStatusV06,
  validateUrgentSignalV06,
  validateUrgentSignalRecordV06,
} from "../lib/urgent-signals-v06.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T20:00:00.000Z");

function recipient() {
  return {
    lineage_id: "urgent-v06-lineage",
    thread_id: "urgent-v06-coordinator",
    generation: 1,
  };
}

function signal(overrides = {}) {
  return {
    schema_version: 1,
    recipient: recipient(),
    executor_id: "urgent-v06-executor",
    run_id: "urgent-v06-run",
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2026-08-30T20:00:00.000Z",
    classification: "high-risk-drift",
    summary: "A bounded ownership conflict requires coordinator attention.",
    requested_action: "Reconcile the ownership conflict before execution resumes.",
    ...overrides,
  };
}

function stateRoot(root) {
  return resolve(root, ".git", "codex-flow", "v0.6.5");
}

async function fixture(prefix) {
  const root = await createGitFixture(prefix);
  await bindRecipient({ stateRoot: stateRoot(root), recipient: recipient() });
  return root;
}

test("v0.6 urgent delivery persists once and never authorizes a second direct attempt", async () => {
  const root = await fixture("codex-flow-urgent-v06-one-shot-");
  try {
    const stored = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: signal(),
      now: START,
    });
    const prepared = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      now: START + 1_000,
    });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.dispatch_permitted, true);

    const duplicate = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      attemptSequence: 1,
      now: START + 2_000,
    });
    assert.equal(duplicate.status, "already-prepared");
    assert.equal(duplicate.dispatch_permitted, false);
    await assert.rejects(
      prepareUrgentAttemptV06({
        stateRoot: stateRoot(root),
        urgentId: stored.urgent_id,
        attemptSequence: 2,
        retryReason: "host-ambiguous",
      }),
      /exactly one direct attempt/,
    );
    await assert.rejects(
      prepareUrgentAttemptV06({
        stateRoot: stateRoot(root),
        urgentId: stored.urgent_id,
        retryReason: "host-ambiguous",
      }),
      /does not accept retry_reason/,
    );

    assert.equal((await reconcileUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      hostCallResult: "ambiguous",
      now: START + 3_000,
    })).status, "ambiguous");
    const afterAmbiguity = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      now: START + 4_000,
    });
    assert.equal(afterAmbiguity.status, "already-ambiguous");
    assert.equal(afterAmbiguity.dispatch_permitted, false);

    const observed = await observeUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      recipient: recipient(),
      now: START + 5_000,
    });
    assert.equal(observed.disposition, "process");
    assert.equal((await observeUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      deliveryAttemptId: prepared.delivery_attempt_id,
      recipient: recipient(),
      now: START + 6_000,
    })).disposition, "suppress");
    assert.equal((await consumeUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      recipient: recipient(),
      senderExecutorId: signal().executor_id,
      now: START + 7_000,
    })).status, "consumed");

    const record = await urgentSignalRecordV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
    });
    assert.equal(record.attempts.length, 1);
    assert.equal(record.attempts[0].attempt_sequence, 1);
    assert.equal(record.attempts[0].retry_reason, null);
    assert.deepEqual(await urgentSignalStatusV06(stateRoot(root), { runId: signal().run_id }), {
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

test("v0.6 rejects a retry-capable raw record before it can become journal authority", async () => {
  const root = await fixture("codex-flow-urgent-v06-retry-boundary-");
  try {
    const payload = signal({ run_id: "urgent-v06-retry-boundary-run" });
    const stored = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: payload,
      now: START,
    });
    const first = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      now: START + 1_000,
    });
    const paths = urgentSignalPathsV06(stateRoot(root), payload);
    const raw = JSON.parse(await readFile(paths.record, "utf8"));
    raw.attempts.push({ ...raw.attempts[0], attempt_sequence: 2 });
    await mkdir(resolve(paths.record, ".."), { recursive: true });
    await writeFile(paths.record, `${JSON.stringify(raw)}\n`, "utf8");

    await assert.rejects(
      urgentSignalRecordV06({ stateRoot: stateRoot(root), urgentId: stored.urgent_id }),
      /exactly one direct attempt/,
    );
    await assert.rejects(
      urgentSignalStatusV06(stateRoot(root)),
      /exactly one direct attempt/,
    );
    await assert.rejects(
      prepareUrgentAttemptV06({ stateRoot: stateRoot(root), urgentId: stored.urgent_id }),
      /exactly one direct attempt/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 preserves corrected-signal, recipient-fence, expiry, and content-safety contracts", async () => {
  const root = await fixture("codex-flow-urgent-v06-fencing-");
  try {
    const first = signal({ run_id: "urgent-v06-correction-run" });
    const firstStored = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: first,
      now: START,
    });
    const firstAttempt = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: firstStored.urgent_id,
      now: START + 1_000,
    });
    const corrected = signal({
      run_id: first.run_id,
      sequence: 2,
      supersedes_urgent_ids: [firstStored.urgent_id],
      summary: "A clarified ownership conflict requires coordinator attention.",
      requested_action: "Resolve the clarified ownership conflict before execution resumes.",
    });
    const correctedStored = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: corrected,
      now: START + 2_000,
    });
    assert.equal((await urgentSignalRecordV06({
      stateRoot: stateRoot(root),
      urgentId: firstStored.urgent_id,
    })).state, "superseded");
    assert.equal((await observeUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: firstStored.urgent_id,
      deliveryAttemptId: firstAttempt.delivery_attempt_id,
      recipient: recipient(),
      now: START + 3_000,
    })).disposition, "suppress");

    const correctedAttempt = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: correctedStored.urgent_id,
      now: START + 4_000,
    });
    assert.equal((await observeUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: correctedStored.urgent_id,
      deliveryAttemptId: correctedAttempt.delivery_attempt_id,
      recipient: recipient(),
      now: START + 5_000,
    })).disposition, "process");

    assert.throws(
      () => validateUrgentSignalV06(signal({ summary: "stdout: raw device output" })),
      /raw log/,
    );
    assert.throws(
      () => validateUrgentSignalV06(signal({ requested_action: "Contact jane@example.com" })),
      /identity-like/,
    );
    const expiring = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: signal({
        run_id: "urgent-v06-expiry-run",
        expires_at: "2026-08-29T20:00:00.000Z",
      }),
      now: START - 1_000,
    });
    assert.equal((await expireUrgentSignalV06({
      stateRoot: stateRoot(root),
      urgentId: expiring.urgent_id,
      now: START,
    })).status, "expired");
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 fences a rebound recipient and rejects symlinked urgent state", async () => {
  const root = await fixture("codex-flow-urgent-v06-fence-lock-");
  try {
    const stored = await persistUrgentSignalV06({
      stateRoot: stateRoot(root),
      signal: signal({ run_id: "urgent-v06-fence-lock-run" }),
      now: START,
    });
    const attempt = await prepareUrgentAttemptV06({
      stateRoot: stateRoot(root),
      urgentId: stored.urgent_id,
      now: START + 1_000,
    });
    const registryPath = resolve(
      stateRoot(root),
      "recipients",
      "bindings",
      `${recipient().lineage_id}.json`,
    );
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    const rebound = {
      lineage_id: recipient().lineage_id,
      thread_id: "urgent-v06-coordinator-next",
      generation: 2,
    };
    await rebindRecipient({
      stateRoot: stateRoot(root),
      recipient: rebound,
      fenceToken: registry.current.fence_token,
      nextFenceToken: "urgent-v06-next-fence",
    });
    await assert.rejects(
      prepareUrgentAttemptV06({ stateRoot: stateRoot(root), urgentId: stored.urgent_id }),
      /prior coordinator generation/,
    );
    await assert.rejects(
      observeUrgentSignalV06({
        stateRoot: stateRoot(root),
        urgentId: stored.urgent_id,
        deliveryAttemptId: attempt.delivery_attempt_id,
        recipient: recipient(),
      }),
      /binding is stale/,
    );
    const paths = urgentSignalPathsV06(stateRoot(root), signal({ run_id: "urgent-v06-fence-lock-run" }));
    const linked = resolve(paths.urgentRoot, "journal", "linked.json");
    await symlink(paths.record, linked);
    await assert.rejects(
      urgentSignalStatusV06(stateRoot(root)),
      /symbolic link/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 urgent record schema and runtime expose the same one-shot boundary", async () => {
  const schemaDocument = JSON.parse(await readFile(
    resolve(packageRoot, "schemas", "urgent-record-v06.schema.json"),
    "utf8",
  ));
  assert.equal(schemaDocument.$id, "https://private.local/codex-flow/urgent-record-v06.schema.json");
  assert.equal(schemaDocument.additionalProperties, false);
  assert.equal(schemaDocument.properties.attempts.maxItems, 1);
  assert.equal(schemaDocument.$defs.attempt.properties.attempt_sequence.const, 1);
  assert.equal(schemaDocument.$defs.attempt.properties.retry_reason.type, "null");

  const payload = signal({ run_id: "urgent-v06-schema-run" });
  const urgentId = urgentIdForV06(payload);
  const firstAttempt = {
    attempt_sequence: 1,
    delivery_attempt_id: urgentAttemptIdForV06(urgentId, payload.recipient),
    recipient: payload.recipient,
    retry_reason: null,
    prepared_at: "2026-08-29T20:00:01.000Z",
    outcome: "ambiguous",
    reconciled_at: "2026-08-29T20:00:02.000Z",
    first_observed_at: null,
    observation_count: 0,
  };
  const record = {
    schema_version: 1,
    kind: "urgent-signal-record",
    urgent_id: urgentId,
    signal: payload,
    recipient: payload.recipient,
    state: "persisted",
    observed_by_recipient: null,
    consumed_by_recipient: null,
    first_observed_attempt_id: null,
    superseded_by_urgent_id: null,
    attempts: [firstAttempt],
    lifecycle: {
      persisted_at: "2026-08-29T20:00:00.000Z",
      observed_at: null,
      consumed_at: null,
      superseded_at: null,
      expired_at: null,
    },
  };
  assert.deepEqual(validateUrgentSignalRecordV06(record), record);

  const retryAttempt = { ...firstAttempt, attempt_sequence: 2 };
  assert.throws(
    () => validateUrgentSignalRecordV06({ ...record, attempts: [firstAttempt, retryAttempt] }),
    /exactly one direct attempt/,
  );
});
