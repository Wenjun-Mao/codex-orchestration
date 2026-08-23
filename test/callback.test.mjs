import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  callbackIdFor,
  callbackPaths,
  consumeCallback,
  deliverCallback,
  expireCallback,
  observeCallback,
  reconcileCallback,
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
  return bindRecipient({
    stateRoot: resolve(root, ".git", "codex-flow"),
    recipient,
  });
}

async function fakeCodex(root) {
  const capture = resolve(root, "queue.ndjson");
  const binary = resolve(root, "fake-codex.mjs");
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
if (process.argv[2] === "--version") process.exit(0);
appendFileSync(process.env.FAKE_CAPTURE, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(process.env.FAKE_MODE === "fail" ? 19 : 0);
`, "utf8");
  await chmod(binary, 0o700);
  return { binary, capture };
}

async function journal(root, payload) {
  return JSON.parse(await readFile(callbackPaths(resolve(root, ".git", "codex-flow"), payload).record, "utf8"));
}

test("callback retries retain immutable identity and journal lifecycle through exactly-once consumption", async () => {
  const root = await createGitFixture("codex-flow-callback-");
  const originalEnv = { ...process.env };
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const { binary, capture } = await fakeCodex(root);
    process.env.CODEX_FLOW_CODEX_BIN = binary;
    process.env.FAKE_CAPTURE = capture;
    delete process.env.FAKE_MODE;

    const payload = receipt();
    const callbackId = callbackIdFor(payload);
    assert.equal(
      callbackId,
      callbackIdFor(receipt({
        recipient: { thread_id: "rebased-thread", generation: 99 },
        source_revision: "fedcba9876543210",
      })),
    );
    const first = await deliverCallback({ stateRoot, receipt: payload });
    assert.equal(first.status, "enqueued");
    assert.equal(first.callback_id, callbackId);
    assert.equal((await readFile(capture, "utf8")).trim().split("\n").length, 1);
    assert.equal((await deliverCallback({ stateRoot, receipt: payload })).status, "already-enqueued");
    assert.equal((await readFile(capture, "utf8")).trim().split("\n").length, 1);
    await assert.rejects(
      deliverCallback({ stateRoot, receipt: receipt({ result_or_blocker: "Changed after persistence." }) }),
      /immutable callback identity/,
    );

    assert.equal((await observeCallback({ stateRoot, callbackId, recipient: payload.recipient })).status, "observed");
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
    assert.equal(record.delivery.state, "consumed");
    for (const field of ["persisted_at", "enqueue_attempted_at", "enqueued_at", "observed_at", "consumed_at"]) {
      assert.ok(record.lifecycle[field], `expected lifecycle timestamp ${field}`);
    }
    assert.equal(record.delivery.enqueue_attempts.length, 1);
    assert.equal(record.delivery.enqueue_attempts[0].outcome, "enqueued");
  } finally {
    process.env = originalEnv;
    await removeFixture(root);
  }
});

test("ambiguous queue attempts block retries until reconciliation while missing binaries remain safe", async () => {
  const root = await createGitFixture("codex-flow-callback-ambiguous-");
  const originalEnv = { ...process.env };
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const { binary } = await fakeCodex(root);
    const payload = receipt({ run_id: "run-ambiguous-01" });
    const callbackId = callbackIdFor(payload);
    process.env.CODEX_FLOW_CODEX_BIN = binary;
    process.env.FAKE_CAPTURE = resolve(root, "ambiguous.ndjson");
    process.env.FAKE_MODE = "fail";

    await assert.rejects(deliverCallback({ stateRoot, receipt: payload }), /outcome is ambiguous/);
    assert.equal((await journal(root, payload)).delivery.state, "enqueue-attempted");
    await assert.rejects(deliverCallback({ stateRoot, receipt: payload }), /reconcile before retrying/);
    assert.equal((await reconcileCallback({ stateRoot, callbackId, outcome: "not-enqueued" })).status, "persisted");

    delete process.env.FAKE_MODE;
    assert.equal((await deliverCallback({ stateRoot, receipt: payload })).status, "enqueued");

    const missing = receipt({ run_id: "run-missing-binary-01" });
    process.env.CODEX_FLOW_CODEX_BIN = resolve(root, "missing-codex");
    await assert.rejects(deliverCallback({ stateRoot, receipt: missing }), /queue unavailable/);
    assert.equal((await journal(root, missing)).delivery.state, "persisted");
  } finally {
    process.env = originalEnv;
    await removeFixture(root);
  }
});

test("stale packets route only through a newer lineage binding, and explicit supersession and expiry are terminal", async () => {
  const root = await createGitFixture("codex-flow-callback-routing-");
  const originalEnv = { ...process.env };
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    const initial = await bind(root);
    const rebound = await rebindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "fixture-lineage",
        thread_id: "new-coordinator-thread",
        generation: 2,
      },
      fenceToken: initial.recipient.fence_token,
    });
    assert.equal(rebound.status, "rebound");
    const current = deliveryRecipient(rebound.recipient);
    const { binary, capture } = await fakeCodex(root);
    process.env.CODEX_FLOW_CODEX_BIN = binary;
    process.env.FAKE_CAPTURE = capture;
    delete process.env.FAKE_MODE;

    const stale = receipt({ run_id: "run-rebound-01" });
    const delivered = await deliverCallback({ stateRoot, receipt: stale });
    assert.equal(delivered.recipient.thread_id, "new-coordinator-thread");
    const call = JSON.parse((await readFile(capture, "utf8")).trim());
    assert.deepEqual(call.slice(0, 3), ["queue", "--thread", "new-coordinator-thread"]);
    await assert.rejects(
      observeCallback({ stateRoot, callbackId: delivered.callback_id, recipient: stale.recipient }),
      /binding is stale/,
    );
    assert.equal((await observeCallback({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient: current,
    })).status, "observed");
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient: current,
      executorId: stale.executor_id,
    })).status, "consumed");
    await assert.rejects(
      deliverCallback({
        stateRoot,
        receipt: receipt({
          run_id: "run-invalid-old-binding-01",
          recipient: { thread_id: "unbound-thread", generation: 1 },
        }),
        noQueue: true,
      }),
      /does not match an authoritative lineage binding/,
    );

    const prior = receipt({ run_id: "run-supersession-01", sequence: 1 });
    const priorId = callbackIdFor(prior);
    assert.equal((await deliverCallback({ stateRoot, receipt: prior, noQueue: true })).status, "persisted");
    const successor = receipt({
      run_id: "run-supersession-01",
      sequence: 2,
      supersedes_callback_ids: [priorId],
    });
    assert.equal((await deliverCallback({ stateRoot, receipt: successor, noQueue: true })).status, "persisted");
    assert.equal((await journal(root, prior)).delivery.state, "superseded");
    await assert.rejects(observeCallback({ stateRoot, callbackId: priorId, recipient: current }), /superseded.*cannot be observed/);
    await assert.rejects(consumeCallback({
      stateRoot,
      callbackId: priorId,
      recipient: current,
      executorId: prior.executor_id,
    }), /superseded.*cannot be consumed/);

    const expiring = receipt({
      run_id: "run-expiring-01",
      expires_at: "2030-08-23T12:00:00.000Z",
    });
    const expiringId = callbackIdFor(expiring);
    assert.equal((await deliverCallback({ stateRoot, receipt: expiring, noQueue: true })).status, "persisted");
    assert.equal(
      (await expireCallback({ stateRoot, callbackId: expiringId, now: Date.parse("2030-08-23T12:00:01.000Z") })).status,
      "expired",
    );
    await assert.rejects(observeCallback({ stateRoot, callbackId: expiringId, recipient: current }), /expired.*cannot be observed/);
    await assert.rejects(consumeCallback({
      stateRoot,
      callbackId: expiringId,
      recipient: current,
      executorId: expiring.executor_id,
    }), /expired.*cannot be consumed/);
  } finally {
    process.env = originalEnv;
    await removeFixture(root);
  }
});

test("receipt validation rejects v1 input, raw transcripts, and user identity-like content", () => {
  assert.throws(() => validateTerminalReceipt(receipt({ schema_version: 1 })), /schema_version/);
  assert.throws(() => validateTerminalReceipt(receipt({ result_or_blocker: "stdout: a raw command log" })), /raw log/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Contact jane@example.com" })), /identity-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Call 416-555-1212" })), /identity-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ result_or_blocker: "token sk-abcdefghijklmnopqrstuv" })), /secret-like/);
  assert.throws(() => validateTerminalReceipt(receipt({ sequence: 2 })), /explicit supersession/);
  assert.throws(() => validateTerminalReceipt(receipt({ next_decision: "Client key: not-for-receipts" })), /application or account identifier/);
  assert.throws(() => validateTerminalReceipt(receipt({ expires_at: "2030-08-23T17:15:00" })), /explicit UTC offset/);
});
