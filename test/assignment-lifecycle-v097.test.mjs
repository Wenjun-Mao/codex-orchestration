import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import test from "node:test";
import { acceptAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { assignmentAuthority } from "../lib/assignment-authority.mjs";
import {
  assignmentPreparation,
  prepareCoordinatorAssignment,
  validateAssignmentPreparation,
} from "../lib/assignment-preparation.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import { deliverCallback, observeCallback } from "../lib/callbacks.mjs";
import { finalizeTaskDisposition, prepareTaskDisposition } from "../lib/dispositions.mjs";
import {
  closeoutIteration,
  iterationStatus,
  registerExecutorIterationMember,
} from "../lib/iteration-registry.mjs";
import {
  acceptReportSubmission,
  beginReportSubmission,
  captureReport,
} from "../lib/report-records.mjs";
import {
  registerCoordinatorReportRoute,
  registerReportRoute,
  reportRoute,
} from "../lib/report-routes.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { closeRun, readRun } from "../lib/run-lifecycle.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications.mjs";
import { createGitFixture } from "./helpers.mjs";
import { createActiveTaskLaunch, terminalReceiptV4 } from "./v09-lifecycle-fixture.mjs";

const TIME = Date.parse("2026-09-06T15:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fixture(t) {
  const primaryRoot = await createGitFixture("codex-flow-v097-assignment-");
  const coordinatorPath = resolve(primaryRoot, `../${basename(primaryRoot)}-coordinator`);
  const coordinatorBranch = "codex/coordinator-assignment";
  git(primaryRoot, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
  const context = await createActiveTaskLaunch(coordinatorPath, "assignment");
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", context.executorPath], { cwd: primaryRoot, encoding: "utf8" });
    spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], { cwd: primaryRoot, encoding: "utf8" });
    await rm(primaryRoot, { recursive: true, force: true });
  });
  const director = { lineage_id: "director-lineage", thread_id: "director-thread", generation: 1 };
  await bindRecipient({ stateRoot: context.stateRoot, recipient: director });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId: context.launch.run_id,
    senderThreadId: context.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...director, binding_digest: recipientBindingDigest(director) },
    approvedPlanPath: resolve(coordinatorPath, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: "v0.9.7",
    purpose: "Assignment reporting",
    repositoryRoot: coordinatorPath,
    repositoryBranch: coordinatorBranch,
    now: TIME,
  });
  return { ...context, primaryRoot, coordinatorPath, coordinatorBranch, director, ...registered };
}

function reclaimCoordinator(context) {
  git(context.primaryRoot, ["worktree", "remove", context.coordinatorPath]);
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

async function acceptedChildFixture(t, suffix, { disposableCoordinator = false } = {}) {
  const primaryRoot = await createGitFixture(`codex-flow-v097-child-closeout-${suffix}-`);
  const coordinatorBranch = disposableCoordinator ? `codex/coordinator-${suffix}` : "main";
  const coordinatorPath = disposableCoordinator
    ? resolve(primaryRoot, `../${basename(primaryRoot)}-${suffix}-coordinator`)
    : primaryRoot;
  if (disposableCoordinator) {
    git(primaryRoot, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
  }
  const taskTitle = "Executor · v0.9.7 · Assignment reporting";
  const context = await createActiveTaskLaunch(coordinatorPath, suffix, { taskTitle });
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", context.executorPath], {
      cwd: primaryRoot,
      encoding: "utf8",
    });
    if (disposableCoordinator) {
      spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], {
        cwd: primaryRoot,
        encoding: "utf8",
      });
    }
    await rm(primaryRoot, { recursive: true, force: true });
  });
  const director = {
    lineage_id: `director-lineage-${suffix}`,
    thread_id: `director-thread-${suffix}`,
    generation: 1,
  };
  await bindRecipient({ stateRoot: context.stateRoot, recipient: director });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId: context.launch.run_id,
    senderThreadId: context.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...director, binding_digest: recipientBindingDigest(director) },
    approvedPlanPath: resolve(coordinatorPath, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: "v0.9.7",
    purpose: "Assignment reporting",
    repositoryRoot: disposableCoordinator ? coordinatorPath : null,
    repositoryBranch: disposableCoordinator ? coordinatorBranch : null,
    now: TIME,
  });
  const assignment = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
  });
  await registerExecutorIterationMember({
    assignment,
    launch: context.launch,
    stateRoot: context.stateRoot,
    now: TIME + 100,
  });
  await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
  });
  const receipt = terminalReceiptV4(context, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: context.executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallback({
    stateRoot: context.stateRoot,
    receipt,
    expectedRunId: context.contract.run_id,
  });
  await observeCallback({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: {
      lineage_id: context.coordinator.lineage_id,
      thread_id: context.coordinator.thread_id,
      generation: context.coordinator.generation,
    },
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-no-change",
    reason: "The child returned verified no-change work.",
  });
  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: context.executorPath,
    receipt,
    checks: [{ check_id: "exact-child", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: {
      lineage_id: context.coordinator.lineage_id,
      thread_id: context.coordinator.thread_id,
      generation: context.coordinator.generation,
    },
    executorThreadId: context.executorThreadId,
    verificationId: verification.verification_id,
  });
  return { root: primaryRoot, coordinatorPath, coordinatorBranch, context, assignment };
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
    archiveThread: async () => {
      reclaimCoordinator(context);
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
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
  const planPath = resolve(root, "approved-uncommitted-plan.md");
  await writeFile(planPath, "# Approved plan\n\nShip the bounded change.\n", "utf8");
  const director = { lineage_id: "prepared-director-lineage", thread_id: "prepared-director", generation: 1 };
  const prepared = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: planPath,
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
  assert.match(prepared.text, /Approved plan snapshot \(source: [^)]+\.md\): \[open the approved plan\]\(<\//);
  assert.doesNotMatch(prepared.text, new RegExp(prepared.preparation.approved_plan.digest));
  assert.doesNotMatch(prepared.text, /checksum|authenticate.*bytes|plan hash/i);
  assert.equal(await readFile(prepared.preparation.approved_plan.snapshot_path, "utf8"), "# Approved plan\n\nShip the bounded change.\n");
  const legacyDraft = { ...prepared.preparation, schema_version: 1, preparation_id: "pending" };
  const { preparation_id: ignoredId, created_at: ignoredTime, ...legacySeed } = legacyDraft;
  const legacy = validateAssignmentPreparation({
    ...legacyDraft,
    preparation_id: `assignment-preparation-v1-${sha256(stableStringify(legacySeed))}`,
  });
  assert.equal(legacy.schema_version, 1);
  await writeFile(planPath, "# Later source edit\n", "utf8");
  assert.equal(await readFile(prepared.preparation.approved_plan.snapshot_path, "utf8"), "# Approved plan\n\nShip the bounded change.\n");
  assert.deepEqual(
    await assignmentPreparation({ stateRoot: prepared.state_root, preparationId: prepared.preparation.preparation_id }),
    prepared.preparation,
  );
  const replay = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: prepared.preparation.approved_plan.snapshot_path,
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
  await writeFile(prepared.preparation.approved_plan.snapshot_path, "corrupt\n", "utf8");
  await assert.rejects(
    () => assignmentPreparation({
      stateRoot: prepared.state_root,
      preparationId: prepared.preparation.preparation_id,
    }),
    /plan was tampered/,
  );
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
    archiveThread: async () => {
      calls += 1;
      reclaimCoordinator(context);
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
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

test("iteration closeout fences the coordinator until child archival and exact branch cleanup complete", async (t) => {
  const { root, context, assignment } = await acceptedChildFixture(
    t,
    "child-first",
    { disposableCoordinator: true },
  );
  const calls = [];
  const archiveThread = async ({ threadId }) => {
    calls.push(threadId);
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };

  const pending = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 10_000,
  });
  assert.equal(pending.status, "pending");
  assert.deepEqual(calls, [context.executorThreadId]);
  assert.equal(
    pending.iteration.members.find((member) => member.role === "executor").state,
    "archive-pending",
  );

  git(root, ["worktree", "remove", context.executorPath]);
  await rm(context.executorPath, { recursive: true, force: true });
  const resumed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 11_000,
  });
  assert.deepEqual(calls, [context.executorThreadId, context.coordinator.thread_id]);
  assert.equal(
    resumed.iteration.members.find((member) => member.role === "executor").state,
    "archived",
  );
  assert.notEqual(
    spawnSync("git", ["show-ref", "--verify", `refs/heads/${context.executorBranch}`], {
      cwd: root,
      encoding: "utf8",
    }).status,
    0,
  );
});

test("iteration closeout atomically claims native archival across concurrent callers", async (t) => {
  const { context, assignment } = await acceptedChildFixture(t, "archive-claim");
  let archiveCalls = 0;
  let releaseArchive;
  let signalArchiveStarted;
  const archiveStarted = new Promise((resolveStarted) => { signalArchiveStarted = resolveStarted; });
  const archiveReleased = new Promise((resolveReleased) => { releaseArchive = resolveReleased; });
  const archiveThread = async () => {
    archiveCalls += 1;
    signalArchiveStarted();
    await archiveReleased;
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };

  const first = closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    archiveThread,
    now: TIME + 15_000,
  });
  await archiveStarted;
  const concurrent = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    archiveThread,
    now: TIME + 15_001,
  });
  assert.equal(concurrent.status, "pending");
  assert.equal(archiveCalls, 1);
  releaseArchive();
  const completed = await first;
  assert.equal(completed.status, "pending");
  assert.equal(archiveCalls, 1);
});

test("iteration closeout removes the exact disposable coordinator branch after its worktree is reclaimed", async (t) => {
  const {
    root, coordinatorPath, coordinatorBranch, context, assignment,
  } = await acceptedChildFixture(t, "coordinator-cleanup", { disposableCoordinator: true });
  const calls = [];
  const archiveThread = async ({ threadId }) => {
    calls.push(threadId);
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };

  await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 17_000,
  });
  git(root, ["worktree", "remove", context.executorPath]);
  assert.equal(git(coordinatorPath, ["branch", "--show-current"]), coordinatorBranch);
  assert.equal(
    (await iterationStatus({ commonDir: context.commonDir, iterationId: assignment.iteration_id }))
      .members.find((member) => member.role === "coordinator").worktree_path,
    coordinatorPath,
  );
  const coordinatorPending = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 18_000,
  });
  assert.equal(coordinatorPending.status, "pending");
  assert.deepEqual(calls, [context.executorThreadId, context.coordinator.thread_id]);
  git(root, ["worktree", "remove", coordinatorPath]);
  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 19_000,
  });
  assert.equal(closed.status, "closed");
  assert.equal(calls.length, 2);
  assert.notEqual(
    spawnSync("git", ["show-ref", "--verify", `refs/heads/${coordinatorBranch}`], {
      cwd: root,
      encoding: "utf8",
    }).status,
    0,
  );
  assert.equal(git(root, ["branch", "--show-current"]), "main");
});

test("iteration closeout refuses an unmerged coordinator commit before native archival", async (t) => {
  const {
    root, coordinatorPath, context, assignment,
  } = await acceptedChildFixture(t, "coordinator-unmerged", { disposableCoordinator: true });
  const calls = [];
  const archiveThread = async ({ threadId }) => {
    calls.push(threadId);
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };
  await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 30_000,
  });
  git(root, ["worktree", "remove", context.executorPath]);
  await writeFile(resolve(coordinatorPath, "coordinator-change.txt"), "unmerged\n", "utf8");
  git(coordinatorPath, ["add", "coordinator-change.txt"]);
  git(coordinatorPath, ["commit", "--quiet", "-m", "unmerged coordinator change"]);
  await assert.rejects(
    () => closeoutIteration({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      allowCoordinator: true,
      archiveThread,
      now: TIME + 31_000,
    }),
    /not preserved in the source checkout/,
  );
  assert.deepEqual(calls, [context.executorThreadId]);
});

test("iteration closeout refuses dirty and detached coordinator worktrees", async (t) => {
  const dirty = await acceptedChildFixture(t, "coordinator-dirty", { disposableCoordinator: true });
  const archiveThread = async () => ({ outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } });
  await closeoutIteration({
    commonDir: dirty.context.commonDir,
    iterationId: dirty.assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 32_000,
  });
  git(dirty.root, ["worktree", "remove", dirty.context.executorPath]);
  await writeFile(resolve(dirty.coordinatorPath, "dirty.txt"), "dirty\n", "utf8");
  await assert.rejects(
    () => closeoutIteration({
      commonDir: dirty.context.commonDir,
      iterationId: dirty.assignment.iteration_id,
      allowCoordinator: true,
      archiveThread,
      now: TIME + 33_000,
    }),
    /does not match its cleanup authority/,
  );

  const detached = await acceptedChildFixture(t, "coordinator-detached", { disposableCoordinator: true });
  await closeoutIteration({
    commonDir: detached.context.commonDir,
    iterationId: detached.assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 34_000,
  });
  git(detached.root, ["worktree", "remove", detached.context.executorPath]);
  git(detached.coordinatorPath, ["checkout", "--quiet", "--detach"]);
  await assert.rejects(
    () => closeoutIteration({
      commonDir: detached.context.commonDir,
      iterationId: detached.assignment.iteration_id,
      allowCoordinator: true,
      archiveThread,
      now: TIME + 35_000,
    }),
    /not an eligible linked task worktree/,
  );
});

test("iteration closeout refuses to archive the caller checkout", async (t) => {
  const fixtureContext = await acceptedChildFixture(t, "coordinator-caller", { disposableCoordinator: true });
  const archiveThread = async () => ({ outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } });
  await closeoutIteration({
    commonDir: fixtureContext.context.commonDir,
    iterationId: fixtureContext.assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 36_000,
  });
  git(fixtureContext.root, ["worktree", "remove", fixtureContext.context.executorPath]);
  git(fixtureContext.coordinatorPath, ["checkout", "--quiet", "--detach"]);
  const originalCwd = process.cwd();
  process.chdir(fixtureContext.coordinatorPath);
  try {
    await assert.rejects(
      () => closeoutIteration({
        commonDir: fixtureContext.context.commonDir,
        iterationId: fixtureContext.assignment.iteration_id,
        allowCoordinator: true,
        archiveThread,
        now: TIME + 37_000,
      }),
      /refuses a caller or source checkout/,
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test("an interrupted native archive is observed and resumed without replay", async (t) => {
  const { root, context, assignment } = await acceptedChildFixture(t, "archive-crash");
  let archiveCalls = 0;
  await assert.rejects(
    () => closeoutIteration({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      archiveThread: async () => {
        archiveCalls += 1;
        throw new Error("simulated crash after the native boundary");
      },
      now: TIME + 20_000,
    }),
    /simulated crash/,
  );
  let iteration = await iterationStatus({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
  });
  assert.equal(iteration.members.find((member) => member.role === "executor").archive_attempt.state, "ambiguous");

  git(root, ["worktree", "remove", context.executorPath]);
  await rm(context.executorPath, { recursive: true, force: true });
  const resumed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    archiveThread: async () => {
      archiveCalls += 1;
      throw new Error("archive must not replay");
    },
    observeArchivedThread: async ({ threadId }) => ({
      kind: "private-archive-observation",
      thread_id: threadId,
    }),
    now: TIME + 21_000,
  });
  assert.equal(archiveCalls, 1);
  assert.equal(resumed.status, "phase-complete");
  iteration = resumed.iteration;
  assert.equal(iteration.members.find((member) => member.role === "executor").state, "archived");
  assert.notEqual(
    spawnSync("git", ["show-ref", "--verify", `refs/heads/${context.executorBranch}`], {
      cwd: root,
      encoding: "utf8",
    }).status,
    0,
  );
});
