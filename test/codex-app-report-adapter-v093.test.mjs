import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
  nativeQueueDiagnostics,
  submitNativeThreadArchive,
  submitNativeQueuedReport,
  validateNativeQueueConfiguration,
} from "../lib/codex-app-report-adapter.mjs";

const FIXTURE = resolve(import.meta.dirname, "fixtures", "report-adapter", "fake-app-server.mjs");

function configuration() {
  return {
    binary_path: CODEX_APP_BINARY_PATH,
    expected_version: CODEX_APP_CLI_VERSION,
    sqlite_home: resolve(homedir(), ".codex"),
  };
}

function fakeFactory(scenario) {
  return (_binary, _args, options) => spawn(process.execPath, [FIXTURE, scenario], options);
}

function currentVersion() {
  return { exit_code: 0, stdout: `${CODEX_APP_CLI_VERSION}\n`, stderr: "" };
}

async function submit(scenario, queueText = "report line one\n雪 ☃") {
  return submitNativeQueuedReport({
    configuration: configuration(),
    recipientThreadId: "recipient-current",
    deliveryKey: "a".repeat(64),
    queueText,
    spawnFactory: fakeFactory(scenario),
    versionReader: async () => currentVersion(),
  });
}

test("adapter only accepts the current App binary, version, and data root", () => {
  assert.deepEqual(validateNativeQueueConfiguration(configuration()), configuration());
  assert.throws(
    () => validateNativeQueueConfiguration({ ...configuration(), expected_version: "codex-cli 0.153.1" }),
    /compatibility evidence/,
  );
  assert.throws(
    () => validateNativeQueueConfiguration({ ...configuration(), binary_path: "/tmp/codex" }),
    /supported Codex App binary/,
  );
});

test("adapter queues one complete Unicode report through framed pipe messages", async () => {
  const result = await submit("accepted");
  assert.equal(result.outcome, "accepted");
  assert.equal(result.queued_submission_id, "queue-ack");
  assert.equal(result.queue_attempted, true);
  assert.equal(result.diagnostics.child_closed, true);
});

test("startup anomalies prevent queue/add, while a post-ack anomaly preserves the acknowledgement", async () => {
  const blocked = await submit("startup-diagnostic");
  assert.equal(blocked.outcome, "ambiguous");
  assert.equal(blocked.reason, "diagnostic-before-add");
  assert.equal(blocked.queue_attempted, false);
  assert.deepEqual(blocked.diagnostics.categories, ["migration"]);

  const acceptedWithAnomaly = await submit("delayed-diagnostic");
  assert.equal(acceptedWithAnomaly.outcome, "accepted-with-anomaly");
  assert.equal(acceptedWithAnomaly.queued_submission_id, "queue-ack");
  assert.deepEqual(acceptedWithAnomaly.diagnostics.categories, ["recovery"]);
});

test("EOF, malformed framing, and missing acknowledgements fail closed without replay", async () => {
  for (const scenario of ["eof", "malformed", "empty-ack", "malformed-ack"]) {
    const result = await submit(scenario);
    assert.equal(result.outcome, "ambiguous", scenario);
  }
  assert.equal((await submit("empty-ack")).reason, "missing-ack");
});

test("partial lines, oversized output, and a stubborn child remain bounded and are cleaned up", async () => {
  const started = Date.now();
  const partial = await submit("partial");
  assert.equal(partial.outcome, "ambiguous");
  assert.equal(partial.reason, "rpc-timeout");
  assert.equal(partial.diagnostics.child_closed, true);

  const overflow = await submit("overflow");
  assert.equal(overflow.outcome, "ambiguous");
  assert.equal(overflow.reason, "stdout-size-limit");

  const stubborn = await submit("stubborn");
  assert.equal(stubborn.outcome, "ambiguous");
  assert.equal(stubborn.diagnostics.child_closed, true);
  assert.ok(Date.now() - started < 7_000, "bounded hook producer did not finish promptly");
});

test("diagnostics retain only bounded classification evidence", () => {
  const diagnostics = nativeQueueDiagnostics(Buffer.from("migration then recovery"), { childClosed: true });
  assert.equal(diagnostics.stderr_bytes, 23);
  assert.deepEqual(diagnostics.categories, ["migration", "recovery"]);
  assert.match(diagnostics.stderr_sha256, /^[0-9a-f]{64}$/);
});

test("native closeout archives only an exact idle thread and fails closed on activity", async () => {
  const archive = (scenario) => submitNativeThreadArchive({
    configuration: configuration(),
    threadId: "closeout-thread",
    spawnFactory: fakeFactory(scenario),
    versionReader: async () => currentVersion(),
  });
  const accepted = await archive("archive-accepted");
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.archive_attempted, true);
  const active = await archive("archive-active");
  assert.equal(active.outcome, "blocked");
  assert.equal(active.reason, "thread-active");
  assert.equal(active.archive_attempted, false);
  const ambiguous = await archive("archive-ambiguous");
  assert.equal(ambiguous.outcome, "ambiguous");
  assert.equal(ambiguous.archive_attempted, true);
});
