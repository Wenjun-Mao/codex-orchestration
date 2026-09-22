import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import test from "node:test";
import {
  acceptReportSubmission,
  beginReportSubmission,
  captureReport,
  markReportSubmissionAmbiguous,
  MAX_REPORT_BYTES,
  reportCleanupStatus,
} from "../lib/report-records.mjs";
import { closeReportRoute, registerReportRoute } from "../lib/report-routes.mjs";
import { createActiveTaskLaunch } from "./v09-lifecycle-fixture.mjs";
import { createGitFixture } from "./helpers.mjs";

const TIME = Date.parse("2026-09-06T04:35:00.000Z");

async function destroy(context) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", context.executorPath], { cwd: context.root });
  } catch {
    // The fixture may already be removed by a failing-path assertion.
  }
  await rm(context.root, { recursive: true, force: true });
}

async function reportingFixture(t, suffix) {
  const root = await createGitFixture(`codex-flow-report-life-${suffix}-`);
  const context = await createActiveTaskLaunch(root, suffix);
  t.after(() => destroy(context));
  const { route } = await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
    now: TIME,
  });
  return {
    context,
    route,
    source: {
      host_id: "local",
      thread_id: context.executorThreadId,
      turn_id: `turn-${suffix}`,
      output_kind: "final-assistant-output",
    },
  };
}

test("report capture preserves one exact Unicode final and makes one persisted queue attempt", async (t) => {
  const { context, route, source } = await reportingFixture(t, "unicode");
  const finalText = "Done.\n\nRésumé: ✅ 你好";
  const captured = await captureReport({ stateRoot: context.stateRoot, routeId: route.route_id, source, finalText, now: TIME + 1_000 });
  assert.equal(captured.status, "captured");
  assert.equal(captured.report.envelope.text, finalText);
  assert.equal(captured.report.envelope.byte_length, Buffer.byteLength(finalText));
  assert.equal((await captureReport({ stateRoot: context.stateRoot, routeId: route.route_id, source, finalText, now: TIME + 2_000 })).status, "already-captured");

  const prepared = await beginReportSubmission({ stateRoot: context.stateRoot, reportId: captured.report.report_id, now: TIME + 3_000 });
  assert.equal(prepared.status, "submission-prepared");
  const accepted = await acceptReportSubmission({
    stateRoot: context.stateRoot,
    reportId: captured.report.report_id,
    clientMessageId: "native-queue-message-1",
    now: TIME + 4_000,
  });
  assert.equal(accepted.status, "accepted");
  const diagnostic = await markReportSubmissionAmbiguous({
    stateRoot: context.stateRoot,
    reportId: captured.report.report_id,
    code: "queue-protocol-error",
    detail: "response closed after acceptance",
    now: TIME + 5_000,
  });
  assert.equal(diagnostic.status, "accepted-with-diagnostic");
  assert.equal(diagnostic.report.state, "accepted");
  assert.equal(diagnostic.report.queue_acceptance.client_message_id, "native-queue-message-1");
});

test("ambiguous, conflicting, and oversize reports stay visible and are never retried", async (t) => {
  const ambiguous = await reportingFixture(t, "ambiguous");
  const captured = await captureReport({
    stateRoot: ambiguous.context.stateRoot,
    routeId: ambiguous.route.route_id,
    source: ambiguous.source,
    finalText: "Need a decision.",
    now: TIME + 1_000,
  });
  await beginReportSubmission({ stateRoot: ambiguous.context.stateRoot, reportId: captured.report.report_id, now: TIME + 2_000 });
  const result = await markReportSubmissionAmbiguous({
    stateRoot: ambiguous.context.stateRoot,
    reportId: captured.report.report_id,
    detail: "native queue EOF",
    now: TIME + 3_000,
  });
  assert.equal(result.status, "ambiguous");
  assert.equal((await beginReportSubmission({ stateRoot: ambiguous.context.stateRoot, reportId: captured.report.report_id, now: TIME + 4_000 })).status, "already-ambiguous");
  await closeReportRoute({ stateRoot: ambiguous.context.stateRoot, routeId: ambiguous.route.route_id, now: TIME + 5_000 });
  assert.deepEqual(await reportCleanupStatus({ stateRoot: ambiguous.context.stateRoot, routeId: ambiguous.route.route_id }), {
    route_id: ambiguous.route.route_id,
    route_state: "closed",
    cleanup_eligible: false,
    blocking_reports: [{ report_id: captured.report.report_id, state: "ambiguous" }],
    accepted_reports: [],
  });

  const conflict = await reportingFixture(t, "conflict");
  const first = await captureReport({
    stateRoot: conflict.context.stateRoot,
    routeId: conflict.route.route_id,
    source: conflict.source,
    finalText: "First final.",
    now: TIME + 1_000,
  });
  assert.equal((await captureReport({
    stateRoot: conflict.context.stateRoot,
    routeId: conflict.route.route_id,
    source: conflict.source,
    finalText: "Changed final.",
    now: TIME + 2_000,
  })).status, "conflict");
  assert.equal((await beginReportSubmission({ stateRoot: conflict.context.stateRoot, reportId: first.report.report_id })).status, "already-conflict");

  const oversize = await reportingFixture(t, "oversize");
  const tooLarge = "x".repeat(MAX_REPORT_BYTES + 1);
  const manual = await captureReport({
    stateRoot: oversize.context.stateRoot,
    routeId: oversize.route.route_id,
    source: oversize.source,
    finalText: tooLarge,
    now: TIME + 1_000,
  });
  assert.equal(manual.status, "manual-required");
  assert.equal(manual.report.envelope, null);
  assert.equal(manual.report.source_byte_length, MAX_REPORT_BYTES + 1);
});

test("route closure rejects a late final instead of delivering it to a newer task generation", async (t) => {
  const { context, route, source } = await reportingFixture(t, "late");
  await closeReportRoute({ stateRoot: context.stateRoot, routeId: route.route_id, now: TIME + 1_000 });
  await assert.rejects(
    () => captureReport({
      stateRoot: context.stateRoot,
      routeId: route.route_id,
      source,
      finalText: "This final is late.",
      now: TIME + 2_000,
    }),
    /late reports are fenced/,
  );
});

test("capture rejects non-final output evidence", async (t) => {
  const { context, route, source } = await reportingFixture(t, "source-kind");
  await assert.rejects(
    () => captureReport({
      stateRoot: context.stateRoot,
      routeId: route.route_id,
      source: { ...source, output_kind: "tool-output" },
      finalText: "A tool result must not become a report.",
    }),
    /output_kind must be one of: final-assistant-output/,
  );
});
