import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  callbackIdFor,
  callbackPaths,
  callbackStatus,
  consumeCallback,
  deliverCallback,
  expireCallback,
  observeCallback,
  validateTerminalReceipt,
} from "../lib/callbacks.mjs";
import { bindRecipient, rebindRecipient } from "../lib/recipients.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function receipt(overrides = {}) {
  const base = {
    schema_version: 2,
    recipient: {
      lineage_id: "fixture-lineage",
      thread_id: "fixture-coordinator",
      generation: 1,
    },
    executor_id: "fixture-executor",
    run_id: "run-fixture-01",
    source_revision: "0123456789abcdef",
    sequence: 1,
    supersedes_callback_ids: [],
    expires_at: "2030-08-23T17:15:00-04:00",
    classification: "PASS",
    branch: "codex/fixture-executor",
    commit: "0123456789abcdef",
    upstream: "origin/codex/fixture-executor",
    cleanliness: "clean",
    result_or_blocker: "Bounded result complete.",
    next_decision: "Integrate once.",
    accounting: { PRODUCT: 1, CROSS_CUTTING_PRODUCT_FIX: 0, ENVIRONMENT: 0, PROOF_HARNESS: 1 },
  };
  return {
    ...base,
    ...overrides,
    recipient: { ...base.recipient, ...overrides.recipient },
    accounting: { ...base.accounting, ...overrides.accounting },
  };
}

function deliveryRecipient(value) {
  return {
    lineage_id: value.lineage_id,
    thread_id: value.thread_id,
    generation: value.generation,
  };
}

async function bind(root, recipient = receipt().recipient) {
  return bindRecipient({ stateRoot: resolve(root, ".git", "codex-flow", "v0.5.1"), recipient });
}

async function journal(root, payload) {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
  return JSON.parse(await readFile(callbackPaths(stateRoot, payload).record, "utf8"));
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

test("journal-monitor persists and integrates exactly once", async () => {
  const root = await createGitFixture("codex-flow-callback-monitor-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    await bind(root);
    const payload = receipt();
    const callbackId = callbackIdFor(payload);
    assert.equal(callbackId, callbackIdFor(receipt({
      recipient: { thread_id: "rebased-thread", generation: 99 },
      source_revision: "fedcba9876543210",
    })));

    assert.equal((await deliverCallback({ stateRoot, receipt: payload })).status, "persisted");
    assert.equal((await deliverCallback({ stateRoot, receipt: payload })).status, "already-persisted");
    await assert.rejects(
      deliverCallback({ stateRoot, receipt: receipt({ result_or_blocker: "Changed after persistence." }) }),
      /immutable callback identity/,
    );
    await assert.rejects(consumeCallback({
      stateRoot,
      callbackId,
      recipient: payload.recipient,
      executorId: payload.executor_id,
    }), /observed before/);
    assert.equal((await observeCallback({ stateRoot, callbackId, recipient: payload.recipient })).status, "observed");
    assert.equal((await observeCallback({ stateRoot, callbackId, recipient: payload.recipient })).status, "already-observed");
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId,
      recipient: payload.recipient,
      executorId: payload.executor_id,
    })).status, "consumed");
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId,
      recipient: payload.recipient,
      executorId: payload.executor_id,
    })).status, "already-consumed");
    const record = await journal(root, payload);
    assert.equal(record.schema_version, 4);
    assert.equal(record.state, "consumed");
    assert.equal("notification" in record, false);
    assert.deepEqual(await callbackStatus(stateRoot), {
      pending: [],
      consumed_count: 1,
      superseded_count: 0,
      expired_count: 0,
    });
  } finally {
    await removeFixture(root);
  }
});

test("higher sequence supersedes only the immediate unobserved callback", async () => {
  const root = await createGitFixture("codex-flow-callback-terminal-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    await bind(root);
    const first = receipt({ run_id: "run-terminal-01" });
    await deliverCallback({ stateRoot, receipt: first });
    const second = receipt({
      run_id: first.run_id,
      sequence: 2,
      supersedes_callback_ids: [callbackIdFor(first)],
      result_or_blocker: "Replacement result complete.",
    });
    await deliverCallback({ stateRoot, receipt: second });
    assert.equal((await journal(root, first)).state, "superseded");
    await assert.rejects(
      observeCallback({ stateRoot, callbackId: callbackIdFor(first), recipient: first.recipient }),
      /superseded/,
    );

    const third = receipt({
      run_id: first.run_id,
      sequence: 3,
      supersedes_callback_ids: [callbackIdFor(first)],
      result_or_blocker: "Invalid nonadjacent replacement.",
    });
    await assert.rejects(
      deliverCallback({ stateRoot, receipt: third }),
      /immediately preceding/,
    );
    await assert.rejects(readFile(callbackPaths(stateRoot, third).record, "utf8"), { code: "ENOENT" });

    const expiring = receipt({ run_id: "run-expiring-01", expires_at: "2029-01-01T00:00:00Z" });
    await deliverCallback({ stateRoot, receipt: expiring, now: Date.parse("2028-01-01T00:00:00Z") });
    assert.equal((await expireCallback({
      stateRoot,
      callbackId: callbackIdFor(expiring),
      now: Date.parse("2030-01-01T00:00:00Z"),
    })).status, "expired");
    assert.equal((await callbackStatus(stateRoot)).expired_count, 1);
  } finally {
    await removeFixture(root);
  }
});

test("observed callbacks remain the sole consumable result and cannot be replaced or expired", async () => {
  const root = await createGitFixture("codex-flow-callback-observed-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    await bind(root);
    const first = receipt({
      run_id: "run-observed-01",
      expires_at: "2029-01-01T00:00:00Z",
    });
    await deliverCallback({ stateRoot, receipt: first, now: Date.parse("2028-01-01T00:00:00Z") });
    await observeCallback({
      stateRoot,
      callbackId: callbackIdFor(first),
      recipient: first.recipient,
      now: Date.parse("2028-01-02T00:00:00Z"),
    });
    const second = receipt({
      run_id: first.run_id,
      sequence: 2,
      supersedes_callback_ids: [callbackIdFor(first)],
      result_or_blocker: "Late replacement must fail.",
    });
    await assert.rejects(
      deliverCallback({ stateRoot, receipt: second, now: Date.parse("2028-01-03T00:00:00Z") }),
      /observed or consumed/,
    );
    await assert.rejects(readFile(callbackPaths(stateRoot, second).record, "utf8"), { code: "ENOENT" });
    assert.equal((await expireCallback({
      stateRoot,
      callbackId: callbackIdFor(first),
      now: Date.parse("2030-01-01T00:00:00Z"),
    })).status, "already-observed");
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId: callbackIdFor(first),
      recipient: first.recipient,
      executorId: first.executor_id,
      now: Date.parse("2030-01-01T00:00:01Z"),
    })).status, "consumed");
  } finally {
    await removeFixture(root);
  }
});

test("supersession interruption cannot leave two consumable callbacks", async () => {
  const root = await createGitFixture("codex-flow-callback-supersession-crash-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    await bind(root);
    const first = receipt({ run_id: "run-crash-01" });
    await deliverCallback({ stateRoot, receipt: first });
    const second = receipt({
      run_id: first.run_id,
      sequence: 2,
      supersedes_callback_ids: [callbackIdFor(first)],
      result_or_blocker: "Crash-safe replacement.",
    });
    await assert.rejects(
      deliverCallback({
        stateRoot,
        receipt: second,
        hooks: { afterSupersede: () => { throw new Error("simulated interruption"); } },
      }),
      /simulated interruption/,
    );
    assert.equal((await journal(root, first)).state, "superseded");
    await assert.rejects(readFile(callbackPaths(stateRoot, second).record, "utf8"), { code: "ENOENT" });
    await assert.rejects(
      observeCallback({ stateRoot, callbackId: callbackIdFor(first), recipient: first.recipient }),
      /superseded/,
    );

    assert.equal((await deliverCallback({ stateRoot, receipt: second })).status, "persisted");
    assert.equal((await journal(root, second)).state, "persisted");
    const status = await callbackStatus(stateRoot);
    assert.deepEqual(status.pending.map((entry) => entry.callback_id), [callbackIdFor(second)]);
    assert.equal(status.superseded_count, 1);
  } finally {
    await removeFixture(root);
  }
});

test("stale packets resolve through the current recipient binding", async () => {
  const root = await createGitFixture("codex-flow-callback-routing-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    const initial = await bind(root);
    const rebound = await rebindRecipient({
      stateRoot,
      recipient: { lineage_id: "fixture-lineage", thread_id: "new-coordinator-thread", generation: 2 },
      fenceToken: initial.recipient.fence_token,
    });
    const current = deliveryRecipient(rebound.recipient);
    const stale = receipt({ run_id: "run-rebound-01" });
    const delivered = await deliverCallback({ stateRoot, receipt: stale });
    assert.equal(delivered.recipient.thread_id, "new-coordinator-thread");
    await assert.rejects(
      observeCallback({ stateRoot, callbackId: delivered.callback_id, recipient: stale.recipient }),
      /binding is stale/,
    );
    assert.equal((await observeCallback({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient: current,
    })).status, "observed");
  } finally {
    await removeFixture(root);
  }
});

test("observe holds the recipient generation stable against concurrent rebind", async () => {
  const root = await createGitFixture("codex-flow-callback-observe-rebind-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    const initial = await bind(root);
    const payload = receipt({ run_id: "run-observe-rebind-01" });
    await deliverCallback({ stateRoot, receipt: payload });
    const locked = deferred();
    const release = deferred();
    const observing = observeCallback({
      stateRoot,
      callbackId: callbackIdFor(payload),
      recipient: payload.recipient,
      hooks: {
        async afterRecipientLock() {
          locked.resolve();
          await release.promise;
        },
      },
    });
    await locked.promise;
    await assert.rejects(rebindRecipient({
      stateRoot,
      recipient: { lineage_id: "fixture-lineage", thread_id: "coordinator-next", generation: 2 },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "fixture-fence-next",
    }), /already in progress/);
    release.resolve();
    assert.equal((await observing).status, "observed");
    await rebindRecipient({
      stateRoot,
      recipient: { lineage_id: "fixture-lineage", thread_id: "coordinator-next", generation: 2 },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "fixture-fence-next",
    });
    assert.equal((await journal(root, payload)).observed_by_recipient.generation, 1);
    await assert.rejects(
      consumeCallback({
        stateRoot,
        callbackId: callbackIdFor(payload),
        recipient: payload.recipient,
        executorId: payload.executor_id,
      }),
      /binding is stale/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("consume holds the recipient generation stable against concurrent rebind", async () => {
  const root = await createGitFixture("codex-flow-callback-consume-rebind-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    const initial = await bind(root);
    const payload = receipt({ run_id: "run-consume-rebind-01" });
    await deliverCallback({ stateRoot, receipt: payload });
    await observeCallback({ stateRoot, callbackId: callbackIdFor(payload), recipient: payload.recipient });
    const locked = deferred();
    const release = deferred();
    const consuming = consumeCallback({
      stateRoot,
      callbackId: callbackIdFor(payload),
      recipient: payload.recipient,
      executorId: payload.executor_id,
      hooks: {
        async afterRecipientLock() {
          locked.resolve();
          await release.promise;
        },
      },
    });
    await locked.promise;
    await assert.rejects(rebindRecipient({
      stateRoot,
      recipient: { lineage_id: "fixture-lineage", thread_id: "coordinator-next", generation: 2 },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "fixture-fence-next",
    }), /already in progress/);
    release.resolve();
    assert.equal((await consuming).status, "consumed");
    await rebindRecipient({
      stateRoot,
      recipient: { lineage_id: "fixture-lineage", thread_id: "coordinator-next", generation: 2 },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "fixture-fence-next",
    });
    assert.equal((await journal(root, payload)).consumed_by_recipient.generation, 1);
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId: callbackIdFor(payload),
      recipient: { lineage_id: "fixture-lineage", thread_id: "coordinator-next", generation: 2 },
      executorId: payload.executor_id,
    })).status, "already-consumed");
  } finally {
    await removeFixture(root);
  }
});

test("v0.5 rejects older callback journal records instead of migrating them", async () => {
  const root = await createGitFixture("codex-flow-callback-breaking-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    await bind(root);
    const payload = receipt({ run_id: "run-old-record-01" });
    await deliverCallback({ stateRoot, receipt: payload });
    const path = callbackPaths(stateRoot, payload).record;
    const record = JSON.parse(await readFile(path, "utf8"));
    record.schema_version = 3;
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await assert.rejects(callbackStatus(stateRoot), /does not migrate older callback journals/);
  } finally {
    await removeFixture(root);
  }
});

test("receipt validation rejects unsafe or ambiguous input", () => {
  assert.throws(() => validateTerminalReceipt(receipt({ schema_version: 1 })), /schema_version/);
  assert.throws(() => validateTerminalReceipt(receipt({ result_or_blocker: "stdout: a raw command log" })), /raw log/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Contact jane@example.com" })), /identity-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Call 416-555-1212" })), /identity-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ result_or_blocker: "token sk-abcdefghijklmnopqrstuv" })), /secret-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ sequence: 2 })), /exactly one predecessor/);
  assert.throws(() => validateTerminalReceipt(receipt({
    sequence: 3,
    supersedes_callback_ids: [
      "terminal-v2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "terminal-v2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
  })), /at most 1/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Client key: not-for-receipts" })), /application or account identifier/);
  assert.throws(() => validateTerminalReceipt(receipt({ expires_at: "2030-08-23T17:15:00" })), /explicit UTC offset/);
});
