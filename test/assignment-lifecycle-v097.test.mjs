import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import { acceptAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { taskArchiveForDisposition } from "../lib/archive-lifecycle.mjs";
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
  closeoutIterationWithOwningHost,
  iterationStatus,
  registerExecutorIterationMember,
} from "../lib/iteration-registry.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration.mjs";
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
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications.mjs";
import { activateFixtureRun, createGitFixture } from "./helpers.mjs";
import { createActiveTaskLaunch, terminalReceiptV4 } from "./v09-lifecycle-fixture.mjs";
import { coordinatorBindingDigest, createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";

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
  const commonDir = resolve(git(coordinatorPath, [
    "rev-parse", "--path-format=absolute", "--git-common-dir",
  ]));
  const coordinator = {
    lineage_id: "assignment-coordinator-lineage",
    thread_id: "assignment-coordinator-thread",
    generation: 1,
  };
  const runId = "assignment-coordinator-run";
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "assignment-coordinator-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "assignment-coordinator-task",
      title: "Coordinate assignment reporting",
      execution_kind: "coordinator",
      mode: "write",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "The fixture needs one same-host coordinator authority.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: ["audit-sentinel/assignment-coordinator.txt"],
      shared_resources: [],
      primary_outcome: "Exercise coordinator reporting authority.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Register one coordinator report route.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  const activated = await activateFixtureRun({
    root: coordinatorPath,
    runId,
    plan,
    branchFences: [],
    lineage: coordinator,
    now: TIME - 3_000,
  });
  const context = {
    ...activated,
    commonDir,
    stateRoot: resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY),
    launch: { run_id: runId },
    coordinator: {
      ...coordinator,
      binding_digest: coordinatorBindingDigest(coordinator),
    },
  };
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], { cwd: primaryRoot, encoding: "utf8" });
    await rm(primaryRoot, { recursive: true, force: true });
  });
  const director = { lineage_id: "director-lineage", thread_id: "director-thread", generation: 1 };
  await bindRecipient({ stateRoot: context.stateRoot, recipient: director });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId,
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

function activeTaskObservation(threadId) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "typed-host-activity-v1",
    active_visible: true,
    archived_visible: false,
    activity_state: "idle",
    observed_at: new Date(TIME).toISOString(),
  };
}

function archivedTaskObservation(threadId, observedAt = TIME) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "host-observed",
    active_visible: false,
    archived_visible: true,
    observed_at: new Date(observedAt).toISOString(),
  };
}

function hostResult(hostRequest, outcome, reason = undefined) {
  return {
    attempt_id: hostRequest.attempt_id,
    thread_id: hostRequest.thread_id,
    outcome,
    ...(reason === undefined ? {} : { reason }),
  };
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

async function acceptedChildFixture(
  t,
  suffix,
  { disposableCoordinator = false, patchEquivalentIntegration = false } = {},
) {
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
  let executorCommit = null;
  if (patchEquivalentIntegration) {
    await writeFile(resolve(context.executorPath, "patch-equivalent.txt"), `${suffix}\n`, "utf8");
    git(context.executorPath, ["add", "patch-equivalent.txt"]);
    git(context.executorPath, ["commit", "--quiet", "-m", `executor ${suffix}`]);
    executorCommit = git(context.executorPath, ["rev-parse", "HEAD"]);
  }
  const receipt = terminalReceiptV4(context, patchEquivalentIntegration ? {
    kind: "clean-commit",
    baseline_revision: context.baseline,
    commit: executorCommit,
    branch: context.executorBranch,
    upstream: null,
    cleanliness: "clean",
  } : {
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
    decision: patchEquivalentIntegration ? "accepted-for-integration" : "accepted-no-change",
    reason: patchEquivalentIntegration
      ? "The child returned one clean commit for serial integration."
      : "The child returned verified no-change work.",
  });
  let integration = null;
  let verification;
  if (patchEquivalentIntegration) {
    integration = await prepareSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: primaryRoot,
      dispositionId: disposition.disposition_id,
      mainBranch: "main",
    });
    // Ensure cherry-pick preservation is exercised even when Git timestamps
    // would otherwise reproduce the executor commit byte-for-byte.
    git(primaryRoot, ["commit", "--allow-empty", "--quiet", "-m", "independent primary work"]);
    git(primaryRoot, ["cherry-pick", "--quiet", executorCommit]);
    const request = await integrationVerificationRequest({
      stateRoot: context.stateRoot,
      repositoryPath: primaryRoot,
      integrationId: integration.integration_id,
    });
    verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: primaryRoot,
      receipt: request.receipt,
      integrationScope: request.integration_scope,
      checks: [{ check_id: "exact-child", argv: [process.execPath, "-e", "process.exit(0)"] }],
    });
    integration = await reconcileSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: primaryRoot,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    assert.equal(integration.outcome, "patch-equivalent");
  } else {
    verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: context.executorPath,
      receipt,
      checks: [{ check_id: "exact-child", argv: [process.execPath, "-e", "process.exit(0)"] }],
    });
  }
  await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: {
      lineage_id: context.coordinator.lineage_id,
      thread_id: context.coordinator.thread_id,
      generation: context.coordinator.generation,
    },
    executorThreadId: context.executorThreadId,
    integrationId: integration?.integration_id ?? null,
    verificationId: verification.verification_id,
  });
  return {
    root: primaryRoot,
    coordinatorPath,
    coordinatorBranch,
    context,
    assignment,
    disposition,
    integration,
  };
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
  const prepared = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: complete.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_000,
  });
  assert.equal(prepared.status, "closeout-pending");
  assert.equal(prepared.closeout.status, "host-action-required");
  const accepted = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: complete.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: archivedTaskObservation(context.coordinator.thread_id, TIME + 4_100),
    hostResult: hostResult(prepared.closeout.host_request, "accepted"),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_100,
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
  const prepared = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 2_000,
  });
  assert.equal(prepared.closeout.status, "host-action-required");
  const rejected = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    hostResult: hostResult(prepared.closeout.host_request, "rejected-before-send", "thread-active"),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_000,
  });
  assert.equal(rejected.status, "closeout-pending");
  const retried = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_100,
  });
  assert.equal(retried.closeout.status, "host-action-required");
  const second = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: archivedTaskObservation(context.coordinator.thread_id, TIME + 3_200),
    hostResult: hostResult(retried.closeout.host_request, "accepted"),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_200,
  });
  assert.equal(second.status, "retired");
  const replay = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    retireLocator: async () => ({ status: "retired" }),
  });
  assert.equal(replay.status, "already-retired");
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
  const observeArchivedThread = async ({ threadId }) => {
    await observeCodexAppPrivateArchive({ threadId, codexHome, now: TIME + 4_650 });
    return archivedTaskObservation(threadId, TIME + 4_650);
  };
  let retirementCalls = 0;
  const first = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    observeArchivedThread,
    retireLocator: async () => { retirementCalls += 1; return { status: "retired" }; },
    now: TIME + 4_600,
  });
  assert.equal(first.status, "closeout-pending");
  assert.equal(first.closeout.status, "host-action-required");
  assert.equal(retirementCalls, 0);

  const retired = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    hostResult: hostResult(first.closeout.host_request, "accepted"),
    observeArchivedThread,
    retireLocator: async () => { retirementCalls += 1; return { status: "retired" }; },
    now: TIME + 4_700,
  });
  assert.equal(retired.status, "retired");
  assert.equal(retirementCalls, 1);
  assert.equal(git(context.primaryRoot, ["branch", "--list", context.coordinatorBranch]), "");
});

test("owning-host child closeout prepares one exact App action and completes the run archive", async (t) => {
  const { root, context, assignment, disposition } = await acceptedChildFixture(
    t,
    "owning-host-archive",
  );
  for (const activityState of ["active", "unknown"]) {
    await assert.rejects(
      closeoutIterationWithOwningHost({
        commonDir: context.commonDir,
        iterationId: assignment.iteration_id,
        taskObservation: {
          ...activeTaskObservation(context.executorThreadId),
          activity_state: activityState,
        },
        now: TIME + 8_900,
      }),
      /requires typed idle evidence/,
    );
  }
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: {
        ...activeTaskObservation(context.executorThreadId),
        observed_at: new Date(TIME - 31_000).toISOString(),
      },
      now: TIME + 8_900,
    }),
    /stale or future-dated/,
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId),
    now: TIME + 9_000,
  });
  assert.equal(prepared.status, "host-action-required");
  assert.equal(prepared.call_required, true);
  assert.deepEqual(prepared.host_request, {
    action: "set-thread-archived",
    attempt_id: prepared.host_request.attempt_id,
    thread_id: context.executorThreadId,
    host_id: "local",
    archived: true,
  });

  const interrupted = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    now: TIME + 9_100,
  });
  assert.equal(interrupted.status, "host-result-required");
  assert.equal(interrupted.call_required, false);
  assert.deepEqual(interrupted.host_request, prepared.host_request);
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      hostResult: {
        ...hostResult(prepared.host_request, "accepted"),
        attempt_id: "archive-attempt-v1-wrong",
      },
      now: TIME + 9_150,
    }),
    /does not match the prepared iteration archive action/,
  );

  const ambiguous = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    hostResult: hostResult(prepared.host_request, "ambiguous", "response-lost"),
    now: TIME + 9_200,
  });
  assert.equal(ambiguous.status, "observation-required");
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      hostResult: hostResult(prepared.host_request, "accepted"),
      now: TIME + 9_250,
    }),
    /already reconciled|must not replay/,
  );

  const closed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: archivedTaskObservation(context.executorThreadId, TIME + 9_300),
    now: TIME + 9_300,
  });
  assert.equal(closed.status, "phase-complete");
  const archive = await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  });
  assert.equal(archive.state, "completed");
  assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
});

test("owning-host child closeout resumes archive completion before member completion", async (t) => {
  const { root, context, assignment, disposition } = await acceptedChildFixture(
    t,
    "owning-host-crash-boundary",
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId),
    now: TIME + 9_350,
  });
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: archivedTaskObservation(context.executorThreadId, TIME + 9_400),
      hostResult: hostResult(prepared.host_request, "accepted"),
      removeWorktree: ({ primaryPath, worktreePath }) => {
        git(primaryPath, ["worktree", "remove", worktreePath]);
        throw new Error("simulated crash after worktree removal");
      },
      now: TIME + 9_400,
    }),
    /simulated crash/,
  );
  const interrupted = await iterationStatus({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
  });
  assert.equal(
    interrupted.members.find((entry) => entry.role === "executor").state,
    "archive-pending",
  );
  assert.equal((await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  })).state, "archived-awaiting-worktree-reclamation");

  const resumed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    now: TIME + 9_450,
  });
  assert.equal(resumed.status, "phase-complete");
  assert.equal((await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  })).state, "completed");
  assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
});

test("owning-host child closeout re-observes archive before resumed worktree removal", async (t) => {
  const { context, assignment, disposition } = await acceptedChildFixture(
    t,
    "owning-host-pre-removal-crash",
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId),
    now: TIME + 9_460,
  });
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: archivedTaskObservation(context.executorThreadId, TIME + 9_470),
      hostResult: hostResult(prepared.host_request, "accepted"),
      removeWorktree: () => { throw new Error("simulated crash before worktree removal"); },
      now: TIME + 9_470,
    }),
    /simulated crash before worktree removal/,
  );
  assert.equal((await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  })).state, "archived-awaiting-worktree-reclamation");

  let observerCalls = 0;
  let removalAttempts = 0;
  const resumed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    observeArchivedThread: async () => {
      observerCalls += 1;
      return {
        ...activeTaskObservation(context.executorThreadId),
        observed_at: new Date(TIME + 9_480).toISOString(),
      };
    },
    removeWorktree: () => { removalAttempts += 1; },
    now: TIME + 9_480,
  });
  assert.equal(resumed.status, "observation-required");
  assert.equal(observerCalls, 1);
  assert.equal(removalAttempts, 0);
  assert.equal(git(context.executorPath, ["rev-parse", "--is-inside-work-tree"]), "true");
});

test("owning-host child closeout reconciles already archived public and private observations", async (t) => {
  for (const source of ["public", "private"]) {
    const { root, context, assignment, disposition } = await acceptedChildFixture(
      t,
      `already-archived-${source}`,
    );
    const privateObservation = {
      execution_kind: "task-thread",
      thread_id: context.executorThreadId,
      source: "typed-host-evidence-v1",
      active_visible: false,
      archived_visible: true,
      host_evidence_digest: "a".repeat(64),
      observed_at: new Date(TIME + 9_500).toISOString(),
    };
    const result = await closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: source === "public"
        ? archivedTaskObservation(context.executorThreadId, TIME + 9_500)
        : null,
      observeArchivedThread: source === "private" ? async () => privateObservation : null,
      now: TIME + 9_500,
    });
    assert.equal(result.status, "phase-complete");
    assert.equal(Object.hasOwn(result, "host_request"), false);
    assert.equal((await taskArchiveForDisposition({
      stateRoot: context.stateRoot,
      dispositionId: disposition.disposition_id,
    })).state, "completed");
    assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
  }
});

test("authenticated patch-equivalent integration preserves exact executor reclamation", async (t) => {
  const { root, context, assignment, integration } = await acceptedChildFixture(
    t,
    "patch-equivalent-reclamation",
    { patchEquivalentIntegration: true },
  );
  assert.equal(integration.outcome, "patch-equivalent");
  git(root, ["commit", "--allow-empty", "--quiet", "-m", "later primary work"]);

  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId),
    now: TIME + 9_500,
  });
  const closed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: archivedTaskObservation(context.executorThreadId, TIME + 9_600),
    hostResult: hostResult(prepared.host_request, "accepted"),
    now: TIME + 9_600,
  });
  assert.equal(closed.status, "phase-complete");
  assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
});

test("owning-host closeout reconciles an already archived coordinator with a remaining worktree", async (t) => {
  const context = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  for (const activityState of ["active", "unknown"]) {
    await assert.rejects(
      closeoutIterationWithOwningHost({
        commonDir: context.commonDir,
        iterationId: assignment.iteration_id,
        allowCoordinator: true,
        taskObservation: {
          ...activeTaskObservation(context.coordinator.thread_id),
          activity_state: activityState,
        },
        now: TIME + 9_650,
      }),
      /requires typed idle evidence/,
    );
  }
  const closed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    taskObservation: archivedTaskObservation(context.coordinator.thread_id, TIME + 9_700),
    now: TIME + 9_700,
  });
  assert.equal(closed.status, "closed");
  assert.equal(git(context.primaryRoot, ["branch", "--list", context.coordinatorBranch]), "");
});

test("owning-host closeout blocks dirty executor and coordinator work before any App action", async (t) => {
  const child = await acceptedChildFixture(t, "owning-host-dirty-executor");
  await writeFile(resolve(child.context.executorPath, "untracked.txt"), "dirty\n", "utf8");
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: child.context.commonDir,
      iterationId: child.assignment.iteration_id,
      taskObservation: activeTaskObservation(child.context.executorThreadId),
      now: TIME + 9_800,
    }),
    /Dirty worktree/,
  );

  const coordinator = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: coordinator.state_root,
    assignmentId: coordinator.route.assignment.assignment_id,
  });
  await writeFile(resolve(coordinator.coordinatorPath, "untracked.txt"), "dirty\n", "utf8");
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: coordinator.commonDir,
      iterationId: assignment.iteration_id,
      allowCoordinator: true,
      taskObservation: activeTaskObservation(coordinator.coordinator.thread_id),
      now: TIME + 9_800,
    }),
    /cleanup authority/,
  );
});

test("owning-host closeout reserves one exact action across concurrent callers", async (t) => {
  const { context, assignment } = await acceptedChildFixture(t, "owning-host-concurrent");
  const [first, second] = await Promise.allSettled([
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: activeTaskObservation(context.executorThreadId),
      now: TIME + 9_900,
    }),
    closeoutIterationWithOwningHost({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
      taskObservation: activeTaskObservation(context.executorThreadId),
      now: TIME + 9_901,
    }),
  ]);
  const results = [first, second];
  const prepared = results.find((result) => (
    result.status === "fulfilled" && result.value.status === "host-action-required"
  ));
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(prepared);
  assert.ok(rejected);
  assert.match(rejected.reason.message, /already in progress/);
});

test("owning-host closeout rejects shared and drifted coordinator worktrees before reclamation", async (t) => {
  const shared = await fixture(t);
  const sharedAssignment = await assignmentAuthority({
    stateRoot: shared.state_root,
    assignmentId: shared.route.assignment.assignment_id,
  });
  const original = await iterationStatus({ commonDir: shared.commonDir, iterationId: sharedAssignment.iteration_id });
  const sharedSeed = {
    assignment_id: "coordinator-assignment-v1-shared-path-fixture",
    label: "v0.9.10 shared",
    members: original.members,
    state: "open",
    created_at: new Date(TIME + 10_000).toISOString(),
    updated_at: new Date(TIME + 10_000).toISOString(),
  };
  const sharedIteration = {
    schema_version: 1,
    kind: "codex-flow-v097-iteration",
    iteration_id: `iteration-v1-${sha256(sharedSeed.assignment_id)}`,
    ...sharedSeed,
    record_digest: sha256(stableStringify(sharedSeed)),
  };
  await writeFile(
    resolve(shared.commonDir, "codex-flow", "iterations-v1", "records", `${sharedIteration.iteration_id}.json`),
    `${stableStringify(sharedIteration)}\n`,
    "utf8",
  );
  const sharedPrepared = await closeoutIterationWithOwningHost({
    commonDir: shared.commonDir,
    iterationId: sharedAssignment.iteration_id,
    allowCoordinator: true,
    taskObservation: activeTaskObservation(shared.coordinator.thread_id),
    now: TIME + 10_100,
  });
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: shared.commonDir,
      iterationId: sharedAssignment.iteration_id,
      allowCoordinator: true,
      taskObservation: archivedTaskObservation(shared.coordinator.thread_id, TIME + 10_200),
      hostResult: hostResult(sharedPrepared.host_request, "accepted"),
      now: TIME + 10_200,
    }),
    /shared by another persisted member/,
  );

  const drifted = await fixture(t);
  const driftedAssignment = await assignmentAuthority({
    stateRoot: drifted.state_root,
    assignmentId: drifted.route.assignment.assignment_id,
  });
  const driftedPrepared = await closeoutIterationWithOwningHost({
    commonDir: drifted.commonDir,
    iterationId: driftedAssignment.iteration_id,
    allowCoordinator: true,
    taskObservation: activeTaskObservation(drifted.coordinator.thread_id),
    now: TIME + 10_300,
  });
  git(drifted.coordinatorPath, ["checkout", "--quiet", "--detach"]);
  await assert.rejects(
    closeoutIterationWithOwningHost({
      commonDir: drifted.commonDir,
      iterationId: driftedAssignment.iteration_id,
      allowCoordinator: true,
      taskObservation: archivedTaskObservation(drifted.coordinator.thread_id, TIME + 10_400),
      hostResult: hostResult(driftedPrepared.host_request, "accepted"),
      now: TIME + 10_400,
    }),
    /attachment drifted before reclamation/,
  );
});
