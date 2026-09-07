import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import test from "node:test";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import {
  assertReporterAuthority,
  assertRepositoryReportLocatorAvailable,
  captureStopReport,
  installReportHookLocator,
  installRepositoryReportLocator,
  queuedReportText,
  reporterAuthorityFor,
  retireRepositoryReportLocator,
  resolveReportHookRoute,
  withRepositoryReportLocatorRegistration,
} from "../lib/report-hook.mjs";
import { reportDelivery } from "../lib/report-records.mjs";
import { closeReportRoute, registerReportRoute } from "../lib/report-routes.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
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
  assert.equal(calls[0].deliveryKey, sha256(first.report_id));
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

test("closed routes retire their exact sender locator through a durable replayable tombstone", async (t) => {
  const { context, route } = await fixture(t, "retirement");
  await installRepositoryReportLocator({
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const closed = await closeReportRoute({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    reason: "terminal",
    now: TIME + 2_000,
  });
  const first = await retireRepositoryReportLocator({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    now: TIME + 3_000,
  });
  assert.equal(first.status, "retired");
  assert.equal(first.retirement.closed_route_sha256, sha256(stableStringify(closed.route)));
  const resolved = await resolveReportHookRoute({
    pluginData: "",
    senderThreadId: context.executorThreadId,
    cwd: context.executorPath,
  });
  assert.equal(resolved, null);
  const retirementFiles = await readdir(resolve(
    context.commonDir,
    "codex-flow",
    "report-locators",
    "retirements",
  ));
  assert.equal(retirementFiles.length, 1);
  const persisted = JSON.parse(await readFile(resolve(
    context.commonDir,
    "codex-flow",
    "report-locators",
    "retirements",
    retirementFiles[0],
  ), "utf8"));
  assert.equal(persisted.retirement_id, first.retirement.retirement_id);
  const replay = await retireRepositoryReportLocator({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    now: TIME + 9_000,
  });
  assert.equal(replay.status, "already-retired");
  assert.deepEqual(replay.retirement, first.retirement);
  const nextStateRoot = resolve(context.commonDir, "codex-flow", "v0.9.5-restart");
  const available = await assertRepositoryReportLocatorAvailable({
    stateRoot: nextStateRoot,
    senderThreadId: context.executorThreadId,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  assert.equal(available.status, "available");
});

test("ambiguous delivery evidence blocks locator retirement and preserves the active pointer", async (t) => {
  const { context, route } = await fixture(t, "retirement-blocked");
  await installRepositoryReportLocator({
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const captured = await captureStopReport({
    event: event(context.executorThreadId, "ambiguous final"),
    route,
    stateRoot: context.stateRoot,
    nativeQueue: nativeQueue(),
    submit: async () => ({ outcome: "ambiguous", reason: "eof", queue_attempted: true, diagnostics: {} }),
    now: () => TIME + 1_000,
  });
  assert.equal(captured.state, "ambiguous");
  await closeReportRoute({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    reason: "terminal",
    now: TIME + 2_000,
  });
  await assert.rejects(
    () => retireRepositoryReportLocator({
      stateRoot: context.stateRoot,
      routeId: route.route_id,
      now: TIME + 3_000,
    }),
    /Pending or ambiguous report evidence/,
  );
  const locatorFiles = await readdir(resolve(
    context.commonDir,
    "codex-flow",
    "report-locators",
    "records",
  ));
  assert.equal(locatorFiles.length, 1);
});

test("a crash after tombstone persistence resumes with the original retirement identity", async (t) => {
  const { context, route } = await fixture(t, "retirement-crash");
  await installRepositoryReportLocator({
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  await closeReportRoute({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    reason: "refresh",
    now: TIME + 2_000,
  });
  await assert.rejects(
    () => retireRepositoryReportLocator({
      stateRoot: context.stateRoot,
      routeId: route.route_id,
      reason: "refresh",
      now: TIME + 3_000,
      hooks: { afterRetirementWrite() { throw new Error("simulated retirement crash"); } },
    }),
    /simulated retirement crash/,
  );
  const resumed = await retireRepositoryReportLocator({
    stateRoot: context.stateRoot,
    routeId: route.route_id,
    reason: "refresh",
    now: TIME + 8_000,
  });
  assert.equal(resumed.status, "retired");
  assert.equal(resumed.retirement.retired_at, new Date(TIME + 3_000).toISOString());
});

test("a locator from another namespace blocks re-registration before current-state writes", async (t) => {
  const { context, route } = await fixture(t, "retirement-conflict");
  await installRepositoryReportLocator({
    stateRoot: context.stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const nextStateRoot = resolve(context.commonDir, "codex-flow", "v0.9.5-conflict");
  await assert.rejects(
    () => assertRepositoryReportLocatorAvailable({
      stateRoot: nextStateRoot,
      senderThreadId: context.executorThreadId,
      packageRoot,
      nativeQueue: nativeQueue(),
    }),
    /authentically retired before re-registration/,
  );
  await assert.rejects(readFile(resolve(nextStateRoot, "runs", "lifecycle.json")), /ENOENT/);
});

test("registration resumes after a pre-locator crash and competing sender operations serialize", async (t) => {
  const { context, route } = await fixture(t, "registration-resume");
  await assert.rejects(
    () => withRepositoryReportLocatorRegistration({
      stateRoot: context.stateRoot,
      senderThreadId: context.executorThreadId,
    }, async () => {
      const available = await assertRepositoryReportLocatorAvailable({
        stateRoot: context.stateRoot,
        senderThreadId: context.executorThreadId,
        packageRoot,
        nativeQueue: nativeQueue(),
      });
      assert.equal(available.status, "available");
      throw new Error("simulated crash before locator write");
    }),
    /simulated crash before locator write/,
  );
  await withRepositoryReportLocatorRegistration({
    stateRoot: context.stateRoot,
    senderThreadId: context.executorThreadId,
  }, async () => {
    await assertRepositoryReportLocatorAvailable({
      stateRoot: context.stateRoot,
      senderThreadId: context.executorThreadId,
      packageRoot,
      nativeQueue: nativeQueue(),
    });
    await installRepositoryReportLocator({
      stateRoot: context.stateRoot,
      route,
      packageRoot,
      nativeQueue: nativeQueue(),
    });
  });

  let releaseFirst;
  let markEntered;
  const gate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  const entered = new Promise((resolveEntered) => { markEntered = resolveEntered; });
  const order = [];
  const first = withRepositoryReportLocatorRegistration({
    stateRoot: context.stateRoot,
    senderThreadId: context.executorThreadId,
  }, async () => {
    order.push("first-enter");
    markEntered();
    await gate;
    order.push("first-exit");
  });
  await entered;
  assert.deepEqual(order, ["first-enter"]);
  await assert.rejects(
    () => withRepositoryReportLocatorRegistration({
      stateRoot: context.stateRoot,
      senderThreadId: context.executorThreadId,
    }, async () => { order.push("second-enter"); }),
    /already in progress/,
  );
  releaseFirst();
  await first;
  assert.deepEqual(order, ["first-enter", "first-exit"]);
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

test("reporter authority reflects the packaged release identity", async () => {
  const authority = await reporterAuthorityFor({ packageRoot });
  assert.equal(authority.package_version, "0.9.7-rc.4");
  assert.match(authority.routes_sha256, /^[0-9a-f]{64}$/);
  assert.match(authority.records_sha256, /^[0-9a-f]{64}$/);
});
