import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import {
  assertReporterAuthority,
  captureStopReport,
  queuedReportText,
  reporterAuthorityFor,
  resolveReportHookRoute,
} from "../lib/report-hook.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function route() {
  return {
    schema_version: 1,
    kind: "codex-flow-report-route-v1",
    route_id: "route-current",
    assignment_id: "assignment-current",
    sender: { thread_id: "sender-current", host_id: "local" },
    recipient: {
      thread_id: "recipient-current",
      host_id: "local",
      lineage_id: "recipient-lineage",
      generation: 1,
    },
    runtime_context_digest: "b".repeat(64),
    reporter: {
      package_version: "0.9.3-rc.1",
      entrypoint_sha256: "c".repeat(64),
      report_hook_sha256: "d".repeat(64),
      adapter_sha256: "e".repeat(64),
      core_sha256: "f".repeat(64),
      git_sha256: "a".repeat(64),
    },
    native_queue: {
      binary_path: CODEX_APP_BINARY_PATH,
      expected_version: CODEX_APP_CLI_VERSION,
      sqlite_home: resolve(homedir(), ".codex"),
    },
  };
}

function event(final = "line one\n雪 ☃") {
  return {
    hook_event_name: "Stop",
    session_id: "sender-current",
    turn_id: "turn-current",
    last_assistant_message: final,
  };
}

async function fixtureState() {
  const root = await createGitFixture("codex-flow-report-hook-");
  return { root, stateRoot: join(root, ".git", "codex-flow", "v0.9.3") };
}

test("a Stop captures exact Unicode final text and makes one persisted native attempt", async (t) => {
  const fixture = await fixtureState();
  t.after(() => removeFixture(fixture.root));
  const calls = [];
  const first = await captureStopReport({
    event: event(),
    route: route(),
    stateRoot: fixture.stateRoot,
    submit: async (value) => {
      calls.push(value);
      return { outcome: "accepted", queued_submission_id: "queue-one", queue_attempted: true, diagnostics: {} };
    },
    now: () => Date.parse("2026-09-06T00:00:00.000Z"),
  });
  assert.equal(first.status, "submitted");
  assert.equal(first.state, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].queueText, /UNTRUSTED TASK REPORT/);
  assert.match(calls[0].queueText, /雪/);
  const record = JSON.parse(await readFile(join(fixture.stateRoot, "queued-reports", "records", `${first.report_id}.json`), "utf8"));
  assert.equal(record.final.text, "line one\n雪 ☃");
  assert.equal(record.submission.queued_submission_id, "queue-one");

  const duplicate = await captureStopReport({
    event: event(), route: route(), stateRoot: fixture.stateRoot,
    submit: async () => { throw new Error("duplicate must not queue"); },
  });
  assert.equal(duplicate.status, "already-recorded");
  assert.equal(calls.length, 1);
});

test("a changed final is conflict evidence, and a continued Stop never captures a provisional final", async (t) => {
  const fixture = await fixtureState();
  t.after(() => removeFixture(fixture.root));
  await captureStopReport({
    event: event("first"), route: route(), stateRoot: fixture.stateRoot,
    submit: async () => ({ outcome: "ambiguous", reason: "eof", queue_attempted: true, diagnostics: {} }),
  });
  const conflict = await captureStopReport({
    event: event("changed"), route: route(), stateRoot: fixture.stateRoot,
    submit: async () => { throw new Error("conflict must not queue"); },
  });
  assert.equal(conflict.status, "conflict");
  const continuation = await captureStopReport({
    event: { ...event("provisional"), stop_hook_active: true }, route: route(), stateRoot: fixture.stateRoot,
    submit: async () => { throw new Error("continuation must not queue"); },
  });
  assert.deepEqual(continuation, { status: "ignored", reason: "continued-stop" });
});

test("missing and oversize final output become inspectable rejection evidence without copying the body", async (t) => {
  const fixture = await fixtureState();
  t.after(() => removeFixture(fixture.root));
  const oversized = await captureStopReport({
    event: event("x".repeat(24 * 1024 + 1)), route: route(), stateRoot: fixture.stateRoot,
    submit: async () => { throw new Error("oversize must not queue"); },
  });
  assert.equal(oversized.status, "rejected");
  const rejection = await readFile(join(fixture.stateRoot, "queued-reports", "rejections", `${oversized.rejection_id}.json`), "utf8");
  assert.match(rejection, /final-too-large/);
  assert.equal(rejection.includes("x".repeat(128)), false);
});

test("the host-local locator points to a digest-checked repository route, not a global route scan", async (t) => {
  const fixture = await fixtureState();
  const pluginData = await createGitFixture("codex-flow-plugin-data-", { commit: false });
  t.after(async () => {
    await removeFixture(fixture.root);
    await removeFixture(pluginData);
  });
  const reportRoute = route();
  const recordPath = join(fixture.stateRoot, "report-routes", "records", "route-current.json");
  await mkdir(resolve(recordPath, ".."), { recursive: true });
  await writeFile(recordPath, `${stableStringify(reportRoute)}\n`, "utf8");
  const locatorPath = join(pluginData, "report-hooks", "locators", `${sha256("sender-current")}.json`);
  await mkdir(resolve(locatorPath, ".."), { recursive: true });
  await writeFile(locatorPath, `${stableStringify({
    schema_version: 1,
    kind: "codex-flow-report-route-locator-v1",
    sender_thread_id: "sender-current",
    state_root: fixture.stateRoot,
    route_id: "route-current",
    route_sha256: sha256(stableStringify(reportRoute)),
  })}\n`, "utf8");
  const resolved = await resolveReportHookRoute({ pluginData, senderThreadId: "sender-current" });
  assert.equal(resolved.route.route_id, "route-current");
  assert.equal(resolved.stateRoot, fixture.stateRoot);
});

test("queue text labels the final as untrusted data and preserves its digest", () => {
  const finalText = "work complete\n雪";
  const text = queuedReportText({
    route: route(), sourceThreadId: "sender-current", sourceTurnId: "turn-current",
    finalSha256: sha256(finalText), finalText,
  });
  assert.match(text, /not user input/);
  assert.match(text, new RegExp(sha256(finalText)));
  assert.match(text, /雪/);
});

test("a bound route pins every packaged reporter dependency instead of hot-switching", async () => {
  const packageRoot = resolve(import.meta.dirname, "..");
  const authority = await reporterAuthorityFor({ packageRoot });
  assert.equal(authority.package_version, "0.9.3-rc.1");
  await assertReporterAuthority({ route: { ...route(), reporter: authority }, packageRoot });
  await assert.rejects(
    () => assertReporterAuthority({
      route: { ...route(), reporter: { ...authority, core_sha256: "0".repeat(64) } },
      packageRoot,
    }),
    /reporter authority/,
  );
});
