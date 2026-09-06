import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import test from "node:test";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import {
  assertReporterAuthority,
  captureStopReport,
  installReportHookLocator,
  installRepositoryReportLocator,
  queuedReportText,
  reporterAuthorityFor,
  resolveReportHookRoute,
} from "../lib/report-hook.mjs";
import { reportDelivery } from "../lib/report-records.mjs";
import { registerReportRoute } from "../lib/report-routes.mjs";
import { sha256 } from "../lib/core.mjs";
import { createGitFixture } from "./helpers.mjs";
import { createActiveTaskLaunch } from "./v09-lifecycle-fixture.mjs";

const TIME = Date.parse("2026-09-06T05:00:00.000Z");
const packageRoot = resolve(import.meta.dirname, "..");

function nativeQueue() {
  return {
    binary_path: CODEX_APP_BINARY_PATH,
    expected_version: CODEX_APP_CLI_VERSION,
    sqlite_home: resolve(homedir(), ".codex"),
  };
}

function event(threadId, final = "line one\n雪 ☃") {
  return {
    hook_event_name: "Stop",
    session_id: threadId,
    turn_id: "turn-current",
    last_assistant_message: final,
  };
}

function subagentEvent(threadId, final = "thread-spawn final\n雪 ☃") {
  return {
    ...event(threadId, final),
    hook_event_name: "SubagentStop",
    agent_id: threadId,
    agent_type: "default",
    agent_transcript_path: "/tmp/checkpoint-transcript.jsonl",
  };
}

async function fixture(t, suffix) {
  const root = await createGitFixture(`codex-flow-report-hook-${suffix}-`);
  const context = await createActiveTaskLaunch(root, suffix);
  const pluginData = await createGitFixture(`codex-flow-plugin-data-${suffix}-`, { commit: false });
  t.after(async () => {
    try {
      execFileSync("git", ["worktree", "remove", "--force", context.executorPath], { cwd: context.root });
    } catch {
      // A failing assertion may already have removed the fixture worktree.
    }
    await rm(context.root, { recursive: true, force: true });
    await rm(pluginData, { recursive: true, force: true });
  });
  const { route } = await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
    now: TIME,
  });
  return { context, route, pluginData };
}

test("a Stop uses the canonical route and delivery record for one exact Unicode final", async (t) => {
  const { context, route } = await fixture(t, "exact");
  const calls = [];
  const first = await captureStopReport({
    event: event(context.executorThreadId),
    route,
    stateRoot: context.stateRoot,
    nativeQueue: nativeQueue(),
    submit: async (value) => {
      calls.push(value);
      return { outcome: "accepted", queued_submission_id: "queue-one", queue_attempted: true, diagnostics: {} };
    },
    now: () => TIME + 1_000,
  });
  assert.equal(first.status, "submitted");
  assert.equal(first.state, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].queueText, /UNTRUSTED TASK REPORT/);
  assert.match(calls[0].queueText, /雪/);
  const record = await reportDelivery({ stateRoot: context.stateRoot, reportId: first.report_id });
  assert.equal(record.envelope.text, "line one\n雪 ☃");
  assert.equal(record.queue_acceptance.client_message_id, "queue-one");

  const duplicate = await captureStopReport({
    event: event(context.executorThreadId),
    route,
    stateRoot: context.stateRoot,
    nativeQueue: nativeQueue(),
    submit: async () => { throw new Error("duplicate must not queue"); },
  });
  assert.equal(duplicate.status, "already-accepted");
  assert.equal(calls.length, 1);
});

test("a thread-spawn SubagentStop uses the same authenticated final-output route", async (t) => {
  const { context, route } = await fixture(t, "subagent-stop");
  const calls = [];
  const finalText = "thread-spawn final\n雪 ☃";
  const result = await captureStopReport({
    event: subagentEvent(context.executorThreadId, finalText),
    route,
    stateRoot: context.stateRoot,
    nativeQueue: nativeQueue(),
    submit: async (value) => {
      calls.push(value);
      return { outcome: "accepted", queued_submission_id: "queue-subagent", queue_attempted: true, diagnostics: {} };
    },
    now: () => TIME + 1_000,
  });
  assert.equal(result.status, "submitted");
  assert.equal(result.state, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].queueText, /thread-spawn final\n雪/);
  const record = await reportDelivery({ stateRoot: context.stateRoot, reportId: result.report_id });
  assert.equal(record.envelope.text, finalText);

  const mismatch = await fixture(t, "subagent-mismatch");
  const rejected = await captureStopReport({
    event: { ...subagentEvent(mismatch.context.executorThreadId), agent_id: "different-task" },
    route: mismatch.route,
    stateRoot: mismatch.context.stateRoot,
    nativeQueue: nativeQueue(),
    submit: async () => { throw new Error("identity mismatch must not queue"); },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "subagent-identity-mismatch");
});

test("changed, continued, and oversize finals keep core evidence without another queue attempt", async (t) => {
  const first = await fixture(t, "conflict");
  await captureStopReport({
    event: event(first.context.executorThreadId, "first"), route: first.route,
    stateRoot: first.context.stateRoot, nativeQueue: nativeQueue(),
    submit: async () => ({ outcome: "ambiguous", reason: "eof", queue_attempted: true, diagnostics: {} }),
  });
  const conflict = await captureStopReport({
    event: event(first.context.executorThreadId, "changed"), route: first.route,
    stateRoot: first.context.stateRoot, nativeQueue: nativeQueue(),
    submit: async () => { throw new Error("conflict must not queue"); },
  });
  assert.equal(conflict.status, "conflict");
  const continuation = await captureStopReport({
    event: { ...event(first.context.executorThreadId, "provisional"), stop_hook_active: true },
    route: first.route, stateRoot: first.context.stateRoot, nativeQueue: nativeQueue(),
    submit: async () => { throw new Error("continuation must not queue"); },
  });
  assert.deepEqual(continuation, { status: "ignored", reason: "continued-stop" });

  const oversize = await fixture(t, "oversize");
  const manual = await captureStopReport({
    event: event(oversize.context.executorThreadId, "x".repeat(24 * 1024 + 1)),
    route: oversize.route, stateRoot: oversize.context.stateRoot, nativeQueue: nativeQueue(),
    submit: async () => { throw new Error("oversize must not queue"); },
  });
  assert.equal(manual.status, "manual-required");
  const record = await reportDelivery({ stateRoot: oversize.context.stateRoot, reportId: manual.report_id });
  assert.equal(record.envelope, null);
  assert.equal(record.manual_reason, "oversize-final");
});

test("the host-local locator pins core route bytes and every reporter dependency", async (t) => {
  const { context, route, pluginData } = await fixture(t, "locator");
  const locator = await installReportHookLocator({
    pluginData,
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const resolved = await resolveReportHookRoute({ pluginData, senderThreadId: context.executorThreadId });
  assert.equal(resolved.route.route_id, route.route_id);
  assert.equal(resolved.stateRoot, context.stateRoot);
  assert.equal(resolved.locator.route_sha256, locator.route_sha256);
  await assertReporterAuthority({ reporter: locator.reporter, packageRoot });
  await assert.rejects(
    () => assertReporterAuthority({
      reporter: { ...locator.reporter, core_sha256: "0".repeat(64) },
      packageRoot,
    }),
    /reporter authority/,
  );

  await installRepositoryReportLocator({
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const repositoryResolved = await resolveReportHookRoute({
    pluginData: "",
    senderThreadId: context.executorThreadId,
    cwd: context.executorPath,
  });
  assert.equal(repositoryResolved.route.route_id, route.route_id);
});

test("queue text labels the exact final as untrusted data", async (t) => {
  const { context, route } = await fixture(t, "envelope");
  const finalText = "work complete\n雪";
  const text = queuedReportText({
    route,
    sourceThreadId: context.executorThreadId,
    sourceTurnId: "turn-current",
    finalSha256: sha256(finalText),
    finalText,
  });
  assert.match(text, /not user input/);
  assert.match(text, new RegExp(sha256(finalText)));
  assert.match(text, /雪/);
});

test("reporter authority reflects the packaged RC identity", async () => {
  const authority = await reporterAuthorityFor({ packageRoot });
  assert.equal(authority.package_version, "0.9.3-rc.2");
  assert.match(authority.routes_sha256, /^[0-9a-f]{64}$/);
  assert.match(authority.records_sha256, /^[0-9a-f]{64}$/);
});
