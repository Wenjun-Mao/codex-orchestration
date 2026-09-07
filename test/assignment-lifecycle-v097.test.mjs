import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import { acceptAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { observeCodexAppPrivateArchive } from "../lib/adapters/codex-app/private-archive-observer.mjs";
import {
  assignmentAuthority,
  bindAssignmentRefreshExecution,
  openAssignmentForSender,
} from "../lib/assignment-authority.mjs";
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

async function fixture(t, { detachedCoordinator = false } = {}) {
  const primaryRoot = await createGitFixture("codex-flow-v097-assignment-");
  const coordinatorPath = resolve(primaryRoot, `../${basename(primaryRoot)}-coordinator`);
  const coordinatorBranch = detachedCoordinator ? "detached" : "codex/coordinator-assignment";
  git(primaryRoot, detachedCoordinator
    ? ["worktree", "add", "--quiet", "--detach", coordinatorPath]
    : ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
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

test("coordinator route registration is idempotent after assignment iteration persistence", async (t) => {
  const context = await fixture(t);
  const replay = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId: context.launch.run_id,
    senderThreadId: context.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...context.director,
      binding_digest: recipientBindingDigest(context.director),
    },
    approvedPlanPath: resolve(context.coordinatorPath, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: "v0.9.7",
    purpose: "Assignment reporting",
    repositoryRoot: context.coordinatorPath,
    repositoryBranch: context.coordinatorBranch,
    now: TIME + 1_000,
  });
  assert.equal(replay.status, "already-registered");
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const iteration = await iterationStatus({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
  });
  assert.equal(iteration.created_at, new Date(TIME).toISOString());
});

test("assignment refresh binding appends once and rejects conflicting or stale transitions", async (t) => {
  const context = await fixture(t);
  const beforeRoute = await reportRoute({
    stateRoot: context.state_root,
    routeId: context.route.route_id,
  });
  const before = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const source = before.execution_bindings[0];
  const sourceAuthority = {
    run_id: source.run_id,
    runtime_context_digest: source.runtime_context_digest,
    plan_id: source.plan_id,
    namespace: source.namespace,
  };
  const target = {
    run_id: "assignment-refresh-target",
    runtime_context_digest: sha256("target runtime"),
    configuration_digest: sha256("target configuration"),
    repository_digest: sha256("target repository"),
    repository_root: context.coordinatorPath,
    repository_branch: context.coordinatorBranch,
    plan_id: "assignment-refresh-target-plan",
    revision_digest: sha256("target revision"),
    namespace: "v0.9.7-refresh-target",
    bound_at: new Date(TIME + 1_000).toISOString(),
  };
  const request = {
    commonDir: context.commonDir,
    sender: context.route.sender,
    source: sourceAuthority,
    targetExecutionBinding: target,
  };

  const bound = await bindAssignmentRefreshExecution(request);
  assert.equal(bound.status, "bound");
  assert.deepEqual(bound.assignment.execution_bindings, [source, target]);
  const replay = await bindAssignmentRefreshExecution(request);
  assert.equal(replay.status, "already-bound");
  assert.deepEqual(replay.assignment.execution_bindings, [source, target]);
  assert.deepEqual(await reportRoute({
    stateRoot: context.state_root,
    routeId: context.route.route_id,
  }), beforeRoute);
  assert.equal((await openAssignmentForSender({
    stateRoot: context.state_root,
    hostId: context.route.sender.host_id,
    threadId: context.route.sender.thread_id,
    runId: target.run_id,
  })).assignment_id, before.assignment_id);

  await assert.rejects(bindAssignmentRefreshExecution({
    ...request,
    targetExecutionBinding: { ...target, configuration_digest: sha256("conflict") },
  }), /target conflicts/);
  await assert.rejects(bindAssignmentRefreshExecution({
    ...request,
    targetExecutionBinding: {
      ...target,
      run_id: "assignment-refresh-second-target",
      namespace: "v0.9.7-second-target",
    },
  }), /source is not its latest/);
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

test("assignment acceptance reclaims an exact archived coordinator before retiring reporting", async (t) => {
  const context = await fixture(t);
  const report = await acceptedFinal(context, "flow-owned-cleanup", "Complete.", 4_500);
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-assignment-private-archive-"));
  await mkdir(resolve(codexHome, "sessions"), { recursive: true });
  await mkdir(resolve(codexHome, "archived_sessions"), { recursive: true });
  await writeFile(
    resolve(codexHome, "archived_sessions", `rollout-${context.coordinator.thread_id}.jsonl`),
    `${JSON.stringify({
      timestamp: new Date(TIME + 4_550).toISOString(),
      type: "session_meta",
      payload: {
        id: context.coordinator.thread_id,
        cwd: context.coordinatorPath,
        thread_source: "agent_created_thread",
        cli_version: "0.153.4",
      },
    })}\n`,
    "utf8",
  );
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const observeArchivedThread = ({ threadId }) => observeCodexAppPrivateArchive({
    threadId,
    codexHome,
    now: TIME + 4_650,
  });
  let archiveCalls = 0;
  let retirementCalls = 0;
  const first = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => {
      archiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    observeArchivedThread,
    retireLocator: async () => { retirementCalls += 1; return { status: "retired" }; },
    now: TIME + 4_600,
  });
  assert.equal(first.status, "closeout-pending");
  assert.equal(retirementCalls, 0);

  const retired = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    archiveThread: async () => { throw new Error("accepted archive must not replay"); },
    observeArchivedThread,
    retireLocator: async () => { retirementCalls += 1; return { status: "retired" }; },
    now: TIME + 4_700,
  });
  assert.equal(retired.status, "retired");
  assert.equal(archiveCalls, 1);
  assert.equal(retirementCalls, 1);
  assert.equal(git(context.primaryRoot, ["branch", "--list", context.coordinatorBranch]), "");
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

test("iteration closeout archives a registered detached coordinator without branch authority", async (t) => {
  const context = await fixture(t, { detachedCoordinator: true });
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  await writeFile(resolve(context.coordinatorPath, "detached-coordinator.txt"), "preserved detached coordinator\n", "utf8");
  git(context.coordinatorPath, ["add", "detached-coordinator.txt"]);
  git(context.coordinatorPath, ["commit", "--quiet", "-m", "detached coordinator result"]);
  const detachedTip = git(context.coordinatorPath, ["rev-parse", "HEAD"]);
  git(context.primaryRoot, ["merge", "--quiet", "--no-ff", detachedTip, "-m", "integrate detached coordinator"]);
  const calls = [];
  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async ({ threadId }) => {
      calls.push(threadId);
      git(context.primaryRoot, ["worktree", "remove", context.coordinatorPath]);
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 19_500,
  });
  assert.equal(closed.status, "closed");
  assert.deepEqual(calls, [context.route.sender.thread_id]);
  const coordinator = closed.iteration.members.find((entry) => entry.role === "coordinator");
  assert.equal(coordinator.state, "archived");
  assert.equal(coordinator.archive_attempt.branch_tip, detachedTip);
  assert.equal(coordinator.branch, "detached");
  assert.equal(git(context.primaryRoot, ["branch", "--list", "codex/coordinator*"]), "");
});

test("iteration closeout reclaims exact archived child and coordinator worktrees without archive replay", async (t) => {
  const {
    root, coordinatorPath, coordinatorBranch, context, assignment,
  } = await acceptedChildFixture(t, "flow-owned-reclamation", { disposableCoordinator: true });
  const calls = [];
  const archiveThread = async ({ threadId }) => {
    calls.push(threadId);
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };
  const observeArchivedThread = async ({ threadId }) => ({
    kind: "private-archive-observation",
    thread_id: threadId,
    active_session_absent: true,
  });

  const childPending = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    observeArchivedThread,
    now: TIME + 19_100,
  });
  assert.equal(childPending.status, "pending");
  assert.deepEqual(calls, [context.executorThreadId]);

  const coordinatorPending = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    observeArchivedThread,
    now: TIME + 19_200,
  });
  assert.equal(coordinatorPending.status, "pending");
  assert.deepEqual(calls, [context.executorThreadId, context.coordinator.thread_id]);
  assert.equal(await readFile(resolve(coordinatorPath, ".gitkeep"), "utf8"), "fixture\n");

  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => { throw new Error("accepted archive must not replay"); },
    observeArchivedThread,
    now: TIME + 19_300,
  });
  assert.equal(closed.status, "closed");
  assert.equal(calls.length, 2);
  assert.equal(await rm(context.executorPath, { recursive: false }).then(() => true, (error) => error.code === "ENOENT"), true);
  assert.equal(await rm(coordinatorPath, { recursive: false }).then(() => true, (error) => error.code === "ENOENT"), true);
  assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
  assert.equal(git(root, ["branch", "--list", coordinatorBranch]), "");
});

test("iteration closeout reclaims an exact detached coordinator without deleting any branch", async (t) => {
  const context = await fixture(t, { detachedCoordinator: true });
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  await writeFile(resolve(context.coordinatorPath, "detached-reclamation.txt"), "preserved\n", "utf8");
  git(context.coordinatorPath, ["add", "detached-reclamation.txt"]);
  git(context.coordinatorPath, ["commit", "--quiet", "-m", "detached reclamation result"]);
  const detachedTip = git(context.coordinatorPath, ["rev-parse", "HEAD"]);
  git(context.primaryRoot, ["merge", "--quiet", "--no-ff", detachedTip, "-m", "integrate detached reclamation result"]);
  const branchesBefore = git(context.primaryRoot, ["branch", "--format=%(refname:short)"]);
  let archiveCalls = 0;
  const archiveThread = async () => {
    archiveCalls += 1;
    return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };

  const pending = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 19_400,
  });
  assert.equal(pending.status, "pending");
  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => { throw new Error("accepted archive must not replay"); },
    observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
    now: TIME + 19_500,
  });
  assert.equal(closed.status, "closed");
  assert.equal(archiveCalls, 1);
  assert.equal(closed.iteration.members.find((entry) => entry.role === "coordinator").archive_attempt.branch_tip, detachedTip);
  assert.equal(git(context.primaryRoot, ["branch", "--format=%(refname:short)"]), branchesBefore);
});

test("iteration reclamation refuses dirty and attachment-drifted accepted worktrees", async (t) => {
  const dirty = await fixture(t);
  const dirtyAssignment = await assignmentAuthority({
    stateRoot: dirty.state_root,
    assignmentId: dirty.route.assignment.assignment_id,
  });
  let dirtyArchiveCalls = 0;
  await closeoutIteration({
    commonDir: dirty.commonDir,
    iterationId: dirtyAssignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => {
      dirtyArchiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 19_600,
  });
  await writeFile(resolve(dirty.coordinatorPath, "post-archive-dirty.txt"), "dirty\n", "utf8");
  await assert.rejects(
    () => closeoutIteration({
      commonDir: dirty.commonDir,
      iterationId: dirtyAssignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => { throw new Error("accepted archive must not replay"); },
      observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
      now: TIME + 19_700,
    }),
    /changed after cleanup authority was persisted/,
  );
  assert.equal(dirtyArchiveCalls, 1);

  const drift = await fixture(t);
  const driftAssignment = await assignmentAuthority({
    stateRoot: drift.state_root,
    assignmentId: drift.route.assignment.assignment_id,
  });
  let driftArchiveCalls = 0;
  await closeoutIteration({
    commonDir: drift.commonDir,
    iterationId: driftAssignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => {
      driftArchiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 19_800,
  });
  git(drift.coordinatorPath, ["checkout", "--quiet", "--detach"]);
  await assert.rejects(
    () => closeoutIteration({
      commonDir: drift.commonDir,
      iterationId: driftAssignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => { throw new Error("accepted archive must not replay"); },
      observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
      now: TIME + 19_900,
    }),
    /attachment drifted before reclamation/,
  );
  assert.equal(driftArchiveCalls, 1);

  const movedDetached = await fixture(t, { detachedCoordinator: true });
  const movedAssignment = await assignmentAuthority({
    stateRoot: movedDetached.state_root,
    assignmentId: movedDetached.route.assignment.assignment_id,
  });
  let movedArchiveCalls = 0;
  await closeoutIteration({
    commonDir: movedDetached.commonDir,
    iterationId: movedAssignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => {
      movedArchiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 20_000,
  });
  const movedPath = `${movedDetached.coordinatorPath}-moved`;
  git(movedDetached.primaryRoot, ["worktree", "move", movedDetached.coordinatorPath, movedPath]);
  try {
    await assert.rejects(
      () => closeoutIteration({
        commonDir: movedDetached.commonDir,
        iterationId: movedAssignment.iteration_id,
        allowCoordinator: true,
        archiveThread: async () => { throw new Error("accepted archive must not replay"); },
        observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
        now: TIME + 20_050,
      }),
      /remains attached at an ambiguous path/,
    );
  } finally {
    git(movedDetached.primaryRoot, ["worktree", "move", movedPath, movedDetached.coordinatorPath]);
  }
  assert.equal(movedArchiveCalls, 1);
});

test("iteration reclamation resumes after interruption following exact worktree removal", async (t) => {
  const context = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  let archiveCalls = 0;
  await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => {
      archiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 20_100,
  });
  await assert.rejects(
    () => closeoutIteration({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => { throw new Error("accepted archive must not replay"); },
      observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
      removeWorktree: ({ primaryPath, worktreePath }) => {
        git(primaryPath, ["worktree", "remove", worktreePath]);
        throw new Error("simulated crash after non-force worktree removal");
      },
      now: TIME + 20_200,
    }),
    /simulated crash after non-force worktree removal/,
  );
  const interrupted = await iterationStatus({ commonDir: context.commonDir, iterationId: assignment.iteration_id });
  assert.equal(interrupted.state, "closeout-pending");
  assert.equal(interrupted.members.find((entry) => entry.role === "coordinator").state, "archive-pending");

  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => { throw new Error("accepted archive must not replay"); },
    now: TIME + 20_300,
  });
  assert.equal(closed.status, "closed");
  assert.equal(archiveCalls, 1);
  assert.equal(git(context.primaryRoot, ["branch", "--list", context.coordinatorBranch]), "");
});

test("iteration reclamation refuses a worktree shared by another persisted iteration", async (t) => {
  const context = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const original = await iterationStatus({ commonDir: context.commonDir, iterationId: assignment.iteration_id });
  const otherAssignmentId = "coordinator-assignment-v1-shared-path-fixture";
  const sharedSeed = {
    assignment_id: otherAssignmentId,
    label: "v0.9.7 shared",
    members: original.members,
    state: "open",
    created_at: new Date(TIME + 20_400).toISOString(),
    updated_at: new Date(TIME + 20_400).toISOString(),
  };
  const sharedIteration = {
    schema_version: 1,
    kind: "codex-flow-v097-iteration",
    iteration_id: `iteration-v1-${sha256(otherAssignmentId)}`,
    ...sharedSeed,
    record_digest: sha256(stableStringify(sharedSeed)),
  };
  await writeFile(
    resolve(context.commonDir, "codex-flow", "iterations-v1", "records", `${sharedIteration.iteration_id}.json`),
    `${stableStringify(sharedIteration)}\n`,
    "utf8",
  );
  let archiveCalls = 0;
  await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => {
      archiveCalls += 1;
      return { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
    },
    now: TIME + 20_500,
  });
  await assert.rejects(
    () => closeoutIteration({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => { throw new Error("accepted archive must not replay"); },
      observeArchivedThread: async ({ threadId }) => ({ thread_id: threadId, active_session_absent: true }),
      now: TIME + 20_600,
    }),
    /shared by another persisted member/,
  );
  assert.equal(archiveCalls, 1);
  assert.equal(git(context.coordinatorPath, ["status", "--porcelain"]), "");
});

test("registered detached coordinator closeout rejects attachment drift and unpreserved work", async (t) => {
  const drift = await fixture(t, { detachedCoordinator: true });
  const driftAssignment = await assignmentAuthority({
    stateRoot: drift.state_root,
    assignmentId: drift.route.assignment.assignment_id,
  });
  git(drift.coordinatorPath, ["checkout", "--quiet", "-b", "codex/detached-drift"]);
  await assert.rejects(
    () => closeoutIteration({
      commonDir: drift.commonDir,
      iterationId: driftAssignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => ({ outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } }),
      now: TIME + 19_600,
    }),
    /not an eligible linked task worktree/,
  );

  const unpreserved = await fixture(t, { detachedCoordinator: true });
  const unpreservedAssignment = await assignmentAuthority({
    stateRoot: unpreserved.state_root,
    assignmentId: unpreserved.route.assignment.assignment_id,
  });
  await writeFile(resolve(unpreserved.coordinatorPath, "unpreserved-detached.txt"), "unpreserved\n", "utf8");
  git(unpreserved.coordinatorPath, ["add", "unpreserved-detached.txt"]);
  git(unpreserved.coordinatorPath, ["commit", "--quiet", "-m", "unpreserved detached coordinator"]);
  await assert.rejects(
    () => closeoutIteration({
      commonDir: unpreserved.commonDir,
      iterationId: unpreservedAssignment.iteration_id,
      allowCoordinator: true,
      archiveThread: async () => ({ outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } }),
      now: TIME + 19_700,
    }),
    /not preserved in the source checkout/,
  );
});

test("iteration closeout observes a manually archived coordinator without replaying native archival", async (t) => {
  const {
    root, coordinatorPath, coordinatorBranch, context, assignment,
  } = await acceptedChildFixture(t, "coordinator-already-archived", { disposableCoordinator: true });
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
    now: TIME + 20_000,
  });
  git(root, ["worktree", "remove", context.executorPath]);
  git(root, ["worktree", "remove", coordinatorPath]);
  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    observeArchivedThread: async ({ threadId }) => ({
      kind: "private-archive-observation",
      thread_id: threadId,
    }),
    now: TIME + 21_000,
  });
  assert.equal(closed.status, "closed");
  assert.deepEqual(calls, [context.executorThreadId]);
  const coordinator = closed.iteration.members.find((member) => member.role === "coordinator");
  assert.equal(coordinator.state, "archived");
  assert.equal(coordinator.archive_attempt.reason, "private-archive-observed");
  assert.notEqual(
    spawnSync("git", ["show-ref", "--verify", `refs/heads/${coordinatorBranch}`], {
      cwd: root,
      encoding: "utf8",
    }).status,
    0,
  );
});

test("iteration closeout reconciles manual archival after a definitive blocked coordinator attempt", async (t) => {
  const {
    root, coordinatorPath, context, assignment,
  } = await acceptedChildFixture(t, "coordinator-blocked-then-archived", { disposableCoordinator: true });
  const calls = [];
  const archiveThread = async ({ threadId }) => {
    calls.push(threadId);
    return threadId === context.coordinator.thread_id
      ? { outcome: "blocked", reason: "thread-active", archive_attempted: false, diagnostics: { categories: [] } }
      : { outcome: "accepted", archive_attempted: true, diagnostics: { categories: [] } };
  };
  await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 22_000,
  });
  git(root, ["worktree", "remove", context.executorPath]);
  const blocked = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
    now: TIME + 23_000,
  });
  assert.equal(blocked.status, "pending");
  assert.equal(
    blocked.iteration.members.find((member) => member.role === "coordinator").archive_attempt.state,
    "blocked",
  );
  git(root, ["worktree", "remove", coordinatorPath]);
  const closed = await closeoutIteration({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread: async () => { throw new Error("native archive must not replay"); },
    observeArchivedThread: async ({ threadId }) => ({
      kind: "private-archive-observation",
      thread_id: threadId,
    }),
    now: TIME + 24_000,
  });
  assert.equal(closed.status, "closed");
  assert.deepEqual(calls, [context.executorThreadId, context.coordinator.thread_id]);
  const coordinator = closed.iteration.members.find((member) => member.role === "coordinator");
  assert.equal(coordinator.archive_attempt.state, "accepted");
  assert.equal(coordinator.archive_attempt.reason, "private-archive-observed");
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

test("iteration closeout refuses dirty and attachment-drifted coordinator worktrees", async (t) => {
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
