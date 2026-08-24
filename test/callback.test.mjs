import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  callbackIdFor,
  callbackPaths,
  callbackPointerMessage,
  callbackStatus,
  consumeCallback,
  deliverCallback,
  expireCallback,
  observeCallback,
  validateTerminalReceipt,
} from "../lib/callbacks.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { gitSnapshot } from "../lib/git.mjs";
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
  return bindRecipient({ stateRoot: resolve(root, ".git", "codex-flow"), recipient });
}

async function journal(root, payload) {
  return JSON.parse(await readFile(callbackPaths(resolve(root, ".git", "codex-flow"), payload).record, "utf8"));
}

function queueAdapter({ paths, add = [], list = [], delete: deletes = [] }) {
  const calls = [];
  const next = (values, fallback) => values.length > 0 ? values.shift() : fallback;
  const assertUnlocked = () => assert.equal(existsSync(paths.lock), false, "host adapter called while callback lock existed");
  return {
    calls,
    async probe() {
      assertUnlocked();
      calls.push({ action: "probe" });
      return { stable_identity: true, add: true, list: true, delete: true };
    },
    async add(request) {
      assertUnlocked();
      calls.push({ action: "add", request });
      return next(add, { outcome: "queued", submission_id: "submission-default", reason: null });
    },
    async list(request) {
      assertUnlocked();
      calls.push({ action: "list", request });
      return next(list, { outcome: "found", submission_id: "submission-default", reason: null });
    },
    async delete(request) {
      assertUnlocked();
      calls.push({ action: "delete", request });
      return next(deletes, { outcome: "deleted", reason: null });
    },
  };
}

test("journal-monitor persists without host notification and integrates exactly once", async () => {
  const root = await createGitFixture("codex-flow-callback-monitor-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
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
    await assert.rejects(
      observeCallback({ stateRoot, callbackId, recipient: payload.recipient, source: "queue-turn" }),
      /conflicts with journal-monitor/,
    );
    assert.equal((await observeCallback({
      stateRoot,
      callbackId,
      recipient: payload.recipient,
      source: "journal-monitor",
    })).status, "observed");
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
    assert.equal(record.schema_version, 3);
    assert.equal(record.integration.state, "consumed");
    assert.equal(record.integration.observation_source, "journal-monitor");
    assert.deepEqual(record.notification, {
      authority: "journal-monitor",
      transport: "none",
      state: "disabled",
      recipient: payload.recipient,
      queue_submission_id: null,
      client_user_message_id: null,
      potentially_live: false,
      attempts: [],
    });
  } finally {
    await removeFixture(root);
  }
});

test("retractable queue uses a pointer payload and retracts before monitor consumption", async () => {
  const root = await createGitFixture("codex-flow-callback-retract-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const payload = receipt({ run_id: "run-retract-01" });
    const paths = callbackPaths(stateRoot, payload);
    const adapter = queueAdapter({ paths });
    const delivered = await deliverCallback({
      stateRoot,
      receipt: payload,
      authority: "retractable-thread-queue",
      queueAdapter: adapter,
    });
    assert.equal(delivered.status, "queued");
    const add = adapter.calls.find((call) => call.action === "add").request;
    assert.equal(add.message, callbackPointerMessage(paths.callbackId, payload.recipient));
    assert.doesNotMatch(add.message, /Bounded result complete|result_or_blocker|accounting/);
    assert.ok(Buffer.byteLength(add.message, "utf8") < 1024);

    assert.equal((await observeCallback({
      stateRoot,
      callbackId: paths.callbackId,
      recipient: payload.recipient,
      source: "monitor-recovery",
      queueAdapter: adapter,
    })).status, "observed");
    assert.equal(adapter.calls.filter((call) => call.action === "delete").length, 1);
    assert.equal((await consumeCallback({
      stateRoot,
      callbackId: paths.callbackId,
      recipient: payload.recipient,
      executorId: payload.executor_id,
    })).status, "consumed");
    const record = await journal(root, payload);
    assert.equal(record.notification.state, "retracted");
    assert.equal(record.notification.potentially_live, false);
  } finally {
    await removeFixture(root);
  }
});

test("supersession and expiry retract queued notifications before becoming terminal", async () => {
  const root = await createGitFixture("codex-flow-callback-terminal-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const prior = receipt({ run_id: "run-supersede-01" });
    const priorPaths = callbackPaths(stateRoot, prior);
    const adapter = queueAdapter({ paths: priorPaths });
    await deliverCallback({ stateRoot, receipt: prior, authority: "retractable-thread-queue", queueAdapter: adapter });
    const successor = receipt({
      run_id: "run-supersede-01",
      sequence: 2,
      supersedes_callback_ids: [priorPaths.callbackId],
    });
    await deliverCallback({ stateRoot, receipt: successor, authority: "retractable-thread-queue", queueAdapter: adapter });
    assert.equal((await journal(root, prior)).integration.state, "superseded");
    assert.equal((await journal(root, prior)).notification.state, "retracted");

    const expiring = receipt({ run_id: "run-expire-01", expires_at: "2030-08-23T12:00:00.000Z" });
    const expiringPaths = callbackPaths(stateRoot, expiring);
    const expiringAdapter = queueAdapter({ paths: expiringPaths });
    await deliverCallback({ stateRoot, receipt: expiring, authority: "retractable-thread-queue", queueAdapter: expiringAdapter });
    assert.equal((await expireCallback({
      stateRoot,
      callbackId: expiringPaths.callbackId,
      now: Date.parse("2030-08-23T12:00:01.000Z"),
      queueAdapter: expiringAdapter,
    })).status, "expired");
    const expired = await journal(root, expiring);
    assert.equal(expired.integration.state, "expired");
    assert.equal(expired.notification.state, "retracted");
  } finally {
    await removeFixture(root);
  }
});

test("queue-start and ambiguous retraction races block monitor terminalization", async () => {
  const root = await createGitFixture("codex-flow-callback-race-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const startedPayload = receipt({ run_id: "run-started-race" });
    const startedPaths = callbackPaths(stateRoot, startedPayload);
    const startedAdapter = queueAdapter({
      paths: startedPaths,
      delete: [{ outcome: "started", reason: "already-started" }],
    });
    await deliverCallback({
      stateRoot,
      receipt: startedPayload,
      authority: "retractable-thread-queue",
      queueAdapter: startedAdapter,
    });
    await assert.rejects(observeCallback({
      stateRoot,
      callbackId: startedPaths.callbackId,
      recipient: startedPayload.recipient,
      source: "monitor-recovery",
      queueAdapter: startedAdapter,
    }), /started before retraction/);
    assert.equal((await journal(root, startedPayload)).integration.state, "persisted");
    assert.equal((await observeCallback({
      stateRoot,
      callbackId: startedPaths.callbackId,
      recipient: startedPayload.recipient,
      source: "queue-turn",
    })).status, "observed");

    const ambiguousPayload = receipt({ run_id: "run-ambiguous-delete" });
    const ambiguousPaths = callbackPaths(stateRoot, ambiguousPayload);
    const ambiguousAdapter = queueAdapter({
      paths: ambiguousPaths,
      delete: [{ outcome: "ambiguous", reason: "timeout" }],
    });
    await deliverCallback({
      stateRoot,
      receipt: ambiguousPayload,
      authority: "retractable-thread-queue",
      queueAdapter: ambiguousAdapter,
    });
    await assert.rejects(observeCallback({
      stateRoot,
      callbackId: ambiguousPaths.callbackId,
      recipient: ambiguousPayload.recipient,
      source: "monitor-recovery",
      queueAdapter: ambiguousAdapter,
    }), /ambiguous or unavailable/);
    const ambiguous = await journal(root, ambiguousPayload);
    assert.equal(ambiguous.integration.state, "persisted");
    assert.equal(ambiguous.notification.state, "ambiguous");
    assert.equal(ambiguous.notification.potentially_live, true);
  } finally {
    await removeFixture(root);
  }
});

test("ambiguous queue add is inspected before a duplicate-safe retry", async () => {
  const root = await createGitFixture("codex-flow-callback-inspect-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const payload = receipt({ run_id: "run-ambiguous-add" });
    const paths = callbackPaths(stateRoot, payload);
    const adapter = queueAdapter({
      paths,
      add: [{ outcome: "ambiguous", submission_id: null, reason: "timeout" }],
      list: [{ outcome: "found", submission_id: "recovered-submission", reason: null }],
    });
    await assert.rejects(deliverCallback({
      stateRoot,
      receipt: payload,
      authority: "retractable-thread-queue",
      queueAdapter: adapter,
    }), /inspect before retrying/);
    assert.equal((await deliverCallback({
      stateRoot,
      receipt: payload,
      authority: "retractable-thread-queue",
      queueAdapter: adapter,
    })).status, "queued");
    assert.equal(adapter.calls.filter((call) => call.action === "add").length, 1);
    assert.equal(adapter.calls.filter((call) => call.action === "list").length, 1);
  } finally {
    await removeFixture(root);
  }
});

test("missing queue CRUD capability fails closed without falling back to mixed authority", async () => {
  const root = await createGitFixture("codex-flow-callback-capability-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const payload = receipt({ run_id: "run-capability-missing" });
    const paths = callbackPaths(stateRoot, payload);
    let addCalls = 0;
    const incompleteAdapter = {
      async probe() {
        return { stable_identity: true, add: true, list: true, delete: false };
      },
      async add() {
        addCalls += 1;
        return { outcome: "queued", submission_id: "must-not-run", reason: null };
      },
      async list() {
        return { outcome: "absent", submission_id: null, reason: null };
      },
      async delete() {
        return { outcome: "deleted", reason: null };
      },
    };
    await assert.rejects(deliverCallback({
      stateRoot,
      receipt: payload,
      authority: "retractable-thread-queue",
      queueAdapter: incompleteAdapter,
    }), /queue unavailable/);
    assert.equal(addCalls, 0);
    const record = await journal(root, payload);
    assert.equal(record.integration.state, "persisted");
    assert.equal(record.notification.state, "unavailable");
    await assert.rejects(deliverCallback({ stateRoot, receipt: payload }), /differs from its immutable persisted authority/);
    assert.equal(paths.callbackId, record.callback_id);
  } finally {
    await removeFixture(root);
  }
});

test("legacy v0.3.1 records migrate read-only and disclose uncancellable notification risk", async () => {
  const root = await createGitFixture("codex-flow-callback-legacy-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    await bind(root);
    const payload = receipt({ run_id: "run-legacy-01" });
    const paths = callbackPaths(stateRoot, payload);
    const now = "2026-08-24T12:00:00.000Z";
    const legacy = {
      schema_version: 2,
      kind: "terminal-callback-record",
      callback_id: paths.callbackId,
      receipt: payload,
      delivery: {
        state: "enqueued",
        recipient: payload.recipient,
        observed_by_recipient: null,
        consumed_by_recipient: null,
        transport: "codex-thread-queue",
        enqueue_attempts: [{
          attempted_at: now,
          recipient: payload.recipient,
          outcome: "enqueued",
          reason: null,
        }],
        superseded_by_callback_id: null,
      },
      lifecycle: {
        persisted_at: now,
        enqueue_attempted_at: now,
        enqueued_at: now,
        observed_at: null,
        consumed_at: null,
        superseded_at: null,
        expired_at: null,
      },
    };
    await mkdir(dirname(paths.record), { recursive: true });
    await writeFile(paths.record, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    const status = await callbackStatus(stateRoot);
    assert.equal(status.notification_risk_count, 1);
    assert.equal(status.legacy_notification_risk_count, 1);
    const doctor = await runDoctor(gitSnapshot(root));
    assert.equal(doctor.callbacks.legacy_notification_risk_count, 1);
    assert.match(doctor.warnings.join("\n"), /lack a retractable legacy identity/);
    assert.equal(JSON.parse(await readFile(paths.record, "utf8")).schema_version, 2, "status must not mutate legacy evidence");
    await assert.rejects(observeCallback({
      stateRoot,
      callbackId: paths.callbackId,
      recipient: payload.recipient,
      source: "monitor-recovery",
    }), /no retractable identity/);
    assert.equal((await observeCallback({
      stateRoot,
      callbackId: paths.callbackId,
      recipient: payload.recipient,
      source: "queue-turn",
    })).status, "observed");
    const migrated = await journal(root, payload);
    assert.equal(migrated.schema_version, 3);
    assert.equal(migrated.legacy_source_schema_version, 2);
    assert.equal(migrated.notification.state, "started");
    assert.equal((await callbackStatus(stateRoot)).notification_risk_count, 0);
    assert.equal((await callbackStatus(stateRoot)).legacy_notification_risk_count, 0);
  } finally {
    await removeFixture(root);
  }
});

test("stale packets route only through a newer lineage binding", async () => {
  const root = await createGitFixture("codex-flow-callback-routing-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
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
    await assert.rejects(observeCallback({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient: stale.recipient,
      source: "journal-monitor",
    }), /binding is stale/);
    assert.equal((await observeCallback({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient: current,
      source: "journal-monitor",
    })).status, "observed");
  } finally {
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
