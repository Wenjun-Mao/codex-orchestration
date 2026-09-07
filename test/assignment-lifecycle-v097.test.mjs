import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { acceptAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { assignmentAuthority } from "../lib/assignment-authority.mjs";
import {
  assignmentPreparation,
  prepareCoordinatorAssignment,
} from "../lib/assignment-preparation.mjs";
import { sha256 } from "../lib/core.mjs";
import {
  acceptReportSubmission,
  beginReportSubmission,
  captureReport,
} from "../lib/report-records.mjs";
import { registerCoordinatorReportRoute, reportRoute } from "../lib/report-routes.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { closeRun, readRun } from "../lib/run-lifecycle.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { createGitFixture } from "./helpers.mjs";
import { createActiveTaskLaunch } from "./v09-lifecycle-fixture.mjs";

const TIME = Date.parse("2026-09-06T15:00:00.000Z");

async function fixture(t) {
  const root = await createGitFixture("codex-flow-v097-assignment-");
  const context = await createActiveTaskLaunch(root, "assignment");
  t.after(async () => {
    try { execFileSync("git", ["worktree", "remove", "--force", context.executorPath], { cwd: root }); } catch {}
    await rm(root, { recursive: true, force: true });
  });
  const director = { lineage_id: "director-lineage", thread_id: "director-thread", generation: 1 };
  await bindRecipient({ stateRoot: context.stateRoot, recipient: director });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId: context.launch.run_id,
    senderThreadId: context.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...director, binding_digest: recipientBindingDigest(director) },
    approvedPlanPath: resolve(root, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: "v0.9.7",
    purpose: "Assignment reporting",
    now: TIME,
  });
  return { ...context, director, ...registered };
}

async function acceptedFinal(context, turnId, text, offset) {
  const captured = await captureReport({
    stateRoot: context.state_root,
    routeId: context.route.route_id,
    source: {
      host_id: context.route.sender.host_id,
      thread_id: context.route.sender.thread_id,
      turn_id: turnId,
      output_kind: "final-assistant-output",
    },
    finalText: text,
    now: TIME + offset,
  });
  await beginReportSubmission({ stateRoot: context.state_root, reportId: captured.report.report_id, now: TIME + offset + 1 });
  return (await acceptReportSubmission({
    stateRoot: context.state_root,
    reportId: captured.report.report_id,
    clientMessageId: `queued-${turnId}`,
    now: TIME + offset + 2,
  })).report;
}

test("assignment reporting survives normal run close and removal of its execution namespace", async (t) => {
  const context = await fixture(t);
  const { run } = await readRun({ gitCommonDirectory: context.commonDir, runId: context.launch.run_id });
  await closeRun({ gitCommonDirectory: context.commonDir, runId: run.run_id, resume: run.binding, closedAt: new Date(TIME + 1000).toISOString() });
  await rm(context.stateRoot, { recursive: true, force: true });

  const restart = await acceptedFinal(context, "restart-turn", "Reload is required; continue this assignment afterward.", 2_000);
  const complete = await acceptedFinal(context, "complete-turn", "Implementation and validation are complete.", 3_000);
  assert.notEqual(restart.report_id, complete.report_id);
  assert.equal((await reportRoute({ stateRoot: context.state_root, routeId: context.route.route_id })).state, "active");

  const accepted = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: complete.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => ({ outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } }),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_000,
  });
  assert.equal(accepted.status, "retired");
  assert.equal((await assignmentAuthority({ stateRoot: context.state_root, assignmentId: context.route.assignment.assignment_id })).state, "retired");
  assert.equal((await reportRoute({ stateRoot: context.state_root, routeId: context.route.route_id })).state, "closed");
});

test("pre-dispatch preparation generates the useful first prompt from bound authority", async (t) => {
  const root = await createGitFixture("codex-flow-v097-preparation-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const commonDir = resolve(root, ".git");
  const director = { lineage_id: "prepared-director-lineage", thread_id: "prepared-director", generation: 1 };
  const prepared = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: resolve(root, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    recipient: { host_id: "local", ...director, binding_digest: recipientBindingDigest(director) },
    iterationLabel: "v0.9.7",
    purpose: "Reporting",
    outcome: "Deliver the approved assignment.",
    scope: ["Implement the bounded runtime slice."],
    acceptanceCriteria: ["The exact final reaches the director."],
    constraints: ["Keep same-host scope."],
    reasons: ["Preserve v0.9.6 authority until cutover."],
    now: TIME,
  });
  assert.match(prepared.text, /^# Coordinator · v0\.9\.7 · Reporting/m);
  assert.match(prepared.text, new RegExp(prepared.preparation.preparation_id));
  assert.match(prepared.text, /codex-orchestration:coordinate/);
  assert.match(prepared.text, /Preserve v0\.9\.6 authority until cutover/);
  assert.deepEqual(
    await assignmentPreparation({ stateRoot: prepared.state_root, preparationId: prepared.preparation.preparation_id }),
    prepared.preparation,
  );
  const replay = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: resolve(root, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    recipient: { host_id: "local", ...director, binding_digest: recipientBindingDigest(director) },
    iterationLabel: "v0.9.7",
    purpose: "Reporting",
    outcome: "Deliver the approved assignment.",
    scope: ["Implement the bounded runtime slice."],
    acceptanceCriteria: ["The exact final reaches the director."],
    constraints: ["Keep same-host scope."],
    reasons: ["Preserve v0.9.6 authority until cutover."],
    now: TIME + 60_000,
  });
  assert.deepEqual(replay.preparation, prepared.preparation);
});

test("assignment acceptance is fail-closed for an active coordinator and resumes without duplicate archival", async (t) => {
  const context = await fixture(t);
  const report = await acceptedFinal(context, "complete", "Complete.", 1_000);
  let calls = 0;
  const first = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => { calls += 1; return { outcome: "blocked", reason: "thread-active", archive_attempted: false, diagnostics: { categories: [] } }; },
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 2_000,
  });
  assert.equal(first.status, "closeout-pending");
  assert.equal(calls, 1);
  const second = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => { calls += 1; return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } }; },
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_000,
  });
  assert.equal(second.status, "retired");
  assert.equal(calls, 2);
  const replay = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => { calls += 1; return { outcome: "accepted" }; },
    retireLocator: async () => ({ status: "retired" }),
  });
  assert.equal(replay.status, "already-retired");
  assert.equal(calls, 2);
});
