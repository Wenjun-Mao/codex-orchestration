import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { acceptAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { assertCodexAppCoordinatorWorktree } from "../lib/adapters/codex-app/coordinator-worktree.mjs";
import {
  completeCoordinatorWork,
  startCoordinatorWork,
} from "../lib/coordinator-work.mjs";
import {
  assignmentAuthority,
  assignmentStateRoot,
} from "../lib/assignment-authority.mjs";
import { inspectRefresh } from "../lib/compat/refresh.mjs";
import {
  loadRefreshSourceAuthority,
  reconcileSettledV097CoordinatorPredecessor,
  refreshNamespaceCandidates,
} from "../lib/compat/refresh-source.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import {
  acceptReportSubmission,
  beginReportSubmission,
  captureReport,
} from "../lib/report-records.mjs";
import { registerCoordinatorReportRoute } from "../lib/report-routes.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { closeRun } from "../lib/run-lifecycle.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal.mjs";
import {
  activateFixtureRun,
  createGitFixture,
  packageRoot,
  removeFixture,
} from "./helpers.mjs";

const TIME = Date.parse("2026-09-08T05:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function invoke(cli, args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...env },
    encoding: "utf8",
  });
}

async function taggedPackage(tag) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v097-recovery-source-"));
  const archive = resolve(root, "source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, tag], { cwd: packageRoot });
  execFileSync("tar", ["-xf", archive, "-C", root]);
  await rm(archive);
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

function archivedObservation(threadId, now = TIME + 4_000) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "host-observed",
    active_visible: false,
    archived_visible: true,
    observed_at: new Date(now).toISOString(),
  };
}

function activeObservation(threadId, now = TIME) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "typed-host-activity-v1",
    active_visible: true,
    archived_visible: false,
    activity_state: "idle",
    observed_at: new Date(now).toISOString(),
  };
}

function recoveryPlan(prefix) {
  return createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `${prefix}-plan`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: `${prefix}-work`,
      title: "Recover one coordinator closeout",
      execution_kind: "coordinator",
      mode: "read",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "The recovery fixture has one bounded coordinator authority.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: [],
      shared_resources: [],
      primary_outcome: "Close one authenticated coordinator assignment.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Register and accept the exact coordinator report.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
}

function freshActivationRequest({ runId, coordinator }) {
  return {
    run_id: runId,
    activated_at: new Date(TIME + 6_000).toISOString(),
    runtime: {
      config: { config_id: `${runId}-config`, snapshot: { project_id: "recovery-fixture" } },
      policy: { policy_id: `${runId}-policy`, snapshot: { routine_callbacks: "journal" } },
      host: { host_id: "fixture-host", session_id: `${runId}-session` },
      lineage: coordinator,
    },
    workflow: {
      schema_version: 1,
      plan_id: `${runId}-plan`,
      revision: 1,
      parent_revision_digest: null,
      tasks: [{
        task_id: `${runId}-work`,
        title: "Start one fresh settled-predecessor regression run",
        execution_kind: "coordinator",
        mode: "read",
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        selector_rationale: "The regression needs one bounded coordinator authority after exact predecessor reconciliation.",
        fork_turns: null,
        dependencies: [],
        read_paths: ["lib"],
        write_paths: [],
        shared_resources: [],
        primary_outcome: "Admit one fresh run without altering the settled predecessor.",
        causal_question: "Does fresh activation revalidate the exact settled predecessor under its admission lock?",
        cheapest_safe_direct_attempt: "Activate one empty-fence coordinator run after refresh inspection.",
        instrument_role: "none",
        supporting_follow_up: null,
        supporting_authorization: null,
      }],
    },
    fences: { path_fences: [], resource_fences: [], branch_fences: [] },
  };
}

async function currentRecoveryFixture(t, { wrongInitialBinding = false } = {}) {
  const primary = await createGitFixture("codex-flow-v099-current-recovery-");
  const coordinatorPath = resolve(primary, `../${basename(primary)}-coordinator`);
  const coordinatorBranch = "codex/v099-current-recovery";
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-v099-current-recovery-requests-"));
  git(primary, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], { cwd: primary, stdio: "ignore" });
    await Promise.all([removeFixture(primary), rm(requests, { recursive: true, force: true })]);
  });
  const coordinator = {
    lineage_id: "current-recovery-coordinator-lineage",
    thread_id: "current-recovery-coordinator-thread",
    generation: 1,
  };
  const plan = recoveryPlan("current-recovery");
  const activation = await activateFixtureRun({
    root: coordinatorPath,
    runId: "current-recovery-run",
    plan,
    lineage: coordinator,
    now: TIME,
  });
  const commonDir = git(primary, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const stateRoot = resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY);
  const director = {
    lineage_id: "current-recovery-director-lineage",
    thread_id: "current-recovery-director-thread",
    generation: 1,
  };
  await bindRecipient({ stateRoot, recipient: director });
  const planPath = resolve(primary, "current-recovery-plan.md");
  await writeFile(planPath, "# current recovery fixture\n", "utf8");
  const registration = await registerCoordinatorReportRoute({
    stateRoot,
    runId: activation.run.run_id,
    senderThreadId: coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...director, binding_digest: recipientBindingDigest(director) },
    approvedPlanPath: planPath,
    approvedPlanDigest: sha256(await readFile(planPath)),
    iterationLabel: "current recovery",
    purpose: "Recover a coordinator closeout with current registry authority.",
    repositoryRoot: wrongInitialBinding ? primary : coordinatorPath,
    repositoryBranch: wrongInitialBinding ? "main" : coordinatorBranch,
    now: TIME + 1_000,
  });
  const report = await captureReport({
    stateRoot: registration.state_root,
    routeId: registration.route.route_id,
    source: {
      host_id: "fixture-host",
      thread_id: coordinator.thread_id,
      turn_id: "current-recovery-final",
      output_kind: "final-assistant-output",
    },
    finalText: "The current coordinator result is ready for director acceptance.",
    now: TIME + 2_000,
  });
  await beginReportSubmission({
    stateRoot: registration.state_root,
    reportId: report.report.report_id,
    now: TIME + 2_001,
  });
  const acceptedReport = await acceptReportSubmission({
    stateRoot: registration.state_root,
    reportId: report.report.report_id,
    clientMessageId: "current-recovery-queue",
    now: TIME + 2_002,
  });
  const gitDir = git(coordinatorPath, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  await writeFile(resolve(gitDir, "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: coordinator.thread_id,
  })}\n`, "utf8");
  return {
    primary,
    commonDir,
    coordinatorPath,
    coordinatorBranch,
    coordinator,
    director,
    plan,
    activation,
    registration,
    report: acceptedReport.report,
    requests,
  };
}

async function completeExactCoordinatorWork(fixture) {
  const stateRoot = resolve(fixture.commonDir, "codex-flow", RUNTIME_DIRECTORY);
  await createWorkflowJournal({
    stateRoot,
    runId: fixture.activation.run.run_id,
    planId: fixture.plan.plan_id,
    planRevision: fixture.plan,
    now: TIME + 2_100,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId: fixture.activation.run.run_id,
    planId: fixture.plan.plan_id,
    taskId: fixture.plan.tasks[0].task_id,
    currentBaseline: { revision: git(fixture.coordinatorPath, ["rev-parse", "HEAD"]) },
    dependencyAuthorities: [],
    now: TIME + 2_200,
  });
  const previousThread = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = fixture.coordinator.thread_id;
  try {
    const started = await startCoordinatorWork({
      stateRoot,
      taskContract: contract,
      repositoryPath: fixture.coordinatorPath,
      now: TIME + 2_300,
    });
    await writeFile(resolve(fixture.coordinatorPath, "authenticated-coordinator-result.txt"), "preserved\n", "utf8");
    git(fixture.coordinatorPath, ["add", "authenticated-coordinator-result.txt"]);
    git(fixture.coordinatorPath, ["commit", "--quiet", "-m", "authenticated coordinator result"]);
    const completed = await completeCoordinatorWork({
      stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: fixture.coordinatorPath,
      checks: [{ check_id: "result-present", argv: [process.execPath, "-e", "process.exit(0)"] }],
      now: TIME + 2_400,
    });
    git(fixture.primary, ["merge", "--ff-only", completed.result.final_revision]);
    return completed;
  } finally {
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
  }
}

async function settledV097Fixture(t) {
  const primary = await createGitFixture("codex-flow-v099-closeout-recovery-");
  const coordinatorPath = resolve(primary, `../${basename(primary)}-coordinator`);
  const coordinatorBranch = "codex/v099-closeout-recovery";
  const sourcePackage = await taggedPackage("v0.9.7");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-v099-closeout-recovery-requests-"));
  git(primary, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], { cwd: primary, stdio: "ignore" });
    await Promise.all([
      removeFixture(primary),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(requests, { recursive: true, force: true }),
    ]);
  });

  const coordinator = {
    lineage_id: "v097-closeout-recovery-lineage",
    thread_id: "v097-closeout-recovery-coordinator",
    generation: 1,
  };
  const activation = {
    run_id: "v097-closeout-recovery-run",
    activated_at: new Date(TIME).toISOString(),
    runtime: {
      config: { config_id: "v097-closeout-recovery-config", snapshot: {} },
      policy: { policy_id: "v097-closeout-recovery-policy", snapshot: {} },
      host: { host_id: "fixture-host", session_id: "v097-closeout-recovery-session" },
      lineage: coordinator,
    },
    workflow: {
      schema_version: 1,
      plan_id: "v097-closeout-recovery-plan",
      revision: 1,
      parent_revision_digest: null,
      tasks: [{
        task_id: "v097-closeout-recovery-work",
        title: "Close out the recovery fixture",
        execution_kind: "coordinator",
        mode: "read",
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        selector_rationale: "The fixture exercises a settled coordinator authority.",
        fork_turns: null,
        dependencies: [],
        read_paths: ["lib"],
        write_paths: [],
        shared_resources: [],
        primary_outcome: "Close out the fixture.",
        causal_question: null,
        cheapest_safe_direct_attempt: "Close the exact fixture coordinator.",
        instrument_role: "none",
        supporting_follow_up: null,
        supporting_authorization: null,
      }],
    },
    fences: { path_fences: [], resource_fences: [], branch_fences: [] },
  };
  const activationPath = resolve(requests, "activation.json");
  await writeFile(activationPath, `${JSON.stringify(activation)}\n`, "utf8");
  const activated = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", activation.run_id, "--file", activationPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id });
  assert.equal(activated.status, 0, activated.stderr);

  const commonDir = git(primary, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const stateRoot = resolve(commonDir, "codex-flow", "v0.9.7");
  const director = { lineage_id: "v097-closeout-recovery-director", thread_id: "v097-closeout-recovery-director-thread", generation: 1 };
  await bindRecipient({ stateRoot, recipient: director });
  const planPath = resolve(primary, "approved-plan.md");
  await writeFile(planPath, "# v0.9.7 settled coordinator fixture\n", "utf8");
  const registration = await registerCoordinatorReportRoute({
    stateRoot,
    runId: activation.run_id,
    senderThreadId: coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...director, binding_digest: recipientBindingDigest(director) },
    approvedPlanPath: planPath,
    approvedPlanDigest: sha256(await readFile(planPath)),
    iterationLabel: "v0.9.7 recovery",
    purpose: "Close out the stranded v0.9.7 coordinator.",
    repositoryRoot: coordinatorPath,
    repositoryBranch: coordinatorBranch,
    now: TIME + 1_000,
  });
  // Registration has already snapshotted this fixture-only source plan. Remove
  // the untracked original so the successor CLI journey tests its real clean
  // activation precondition instead of inheriting fixture residue.
  await rm(planPath);
  const report = await captureReport({
    stateRoot: registration.state_root,
    routeId: registration.route.route_id,
    source: {
      host_id: "fixture-host",
      thread_id: coordinator.thread_id,
      turn_id: "v097-closeout-recovery-final",
      output_kind: "final-assistant-output",
    },
    finalText: "The exact coordinator closeout is complete.",
    now: TIME + 2_000,
  });
  await beginReportSubmission({ stateRoot: registration.state_root, reportId: report.report.report_id, now: TIME + 2_001 });
  const acceptedReport = await acceptReportSubmission({
    stateRoot: registration.state_root,
    reportId: report.report.report_id,
    clientMessageId: "v097-closeout-recovery-queue",
    now: TIME + 2_002,
  });
  await acceptAssignmentResult({
    stateRoot: registration.state_root,
    assignmentId: registration.route.assignment.assignment_id,
    reportId: acceptedReport.report.report_id,
    directorThreadId: director.thread_id,
    taskObservation: archivedObservation(coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_000,
  });
  const lifecycle = JSON.parse(await readFile(resolve(
    commonDir,
    "codex-flow",
    "v0.9.7",
    "runs",
    "lifecycle.json",
  ), "utf8"));
  const run = lifecycle.runs[activation.run_id];
  assert.ok(run, "source runtime must retain the activated run for closeout");
  const closeScript = resolve(requests, "close-v097-source-run.mjs");
  await writeFile(closeScript, [
    `import { closeRun } from ${JSON.stringify(pathToFileURL(resolve(sourcePackage.root, "lib", "run-lifecycle.mjs")).href)};`,
    `await closeRun(${JSON.stringify({
      gitCommonDirectory: commonDir,
      runId: run.run_id,
      resume: run.binding,
      closedAt: new Date(TIME + 5_000).toISOString(),
    })});`,
    "",
  ].join("\n"), "utf8");
  const closed = spawnSync(process.execPath, [closeScript], {
    cwd: primary,
    encoding: "utf8",
  });
  assert.equal(closed.status, 0, closed.stderr);
  git(primary, ["tag", "v099-closeout-recovery-preserved", "HEAD"]);
  return {
    primary,
    commonDir,
    coordinatorPath,
    sourcePackage,
    requests,
    reportPath: resolve(
      assignmentStateRoot(commonDir),
      "reports", "deliveries", "records", `${acceptedReport.report.report_id}.json`,
    ),
  };
}

test("settled v0.9.7 coordinator reconciliation requires accepted closeout evidence and a preserved ref", async (t) => {
  const fixture = await settledV097Fixture(t);
  const candidates = await refreshNamespaceCandidates({ commonDir: fixture.commonDir, currentNamespace: RUNTIME_DIRECTORY });
  const candidate = candidates.find((entry) => entry.namespace === "v0.9.7");
  const reconciled = await reconcileSettledV097CoordinatorPredecessor({ commonDir: fixture.commonDir, candidate });
  assert.equal(reconciled.status, "reconciled", reconciled.reason);
  assert.equal(reconciled.summary.preserved_tip, git(fixture.primary, ["rev-parse", "HEAD"]));
  assert.equal(await readFile(fixture.reportPath, "utf8").then(() => true), true);

  const inspection = await inspectRefresh({
    commonDir: fixture.commonDir,
    currentNamespace: RUNTIME_DIRECTORY,
    packageRoot,
    invokingSkillPath: resolve(packageRoot, "skills", "refresh", "SKILL.md"),
  });
  assert.equal(inspection.route, "fresh", inspection.reason);
  assert.equal(inspection.authority.settled_predecessors[0].run_id, "v097-closeout-recovery-run");
  const predecessorLifecyclePath = resolve(
    fixture.commonDir,
    "codex-flow",
    "v0.9.7",
    "runs",
    "lifecycle.json",
  );
  const predecessorLifecycleBytes = await readFile(predecessorLifecyclePath, "utf8");
  const predecessorReportBytes = await readFile(fixture.reportPath, "utf8");

  const nextCoordinator = {
    lineage_id: "v099-next-assignment-lineage",
    thread_id: "v099-next-assignment-coordinator",
    generation: 1,
  };
  const nextRequest = freshActivationRequest({
    runId: "v099-next-assignment-run",
    coordinator: nextCoordinator,
  });
  const nextRequestPath = resolve(fixture.requests, "fresh-activation.json");
  await writeFile(nextRequestPath, `${JSON.stringify(nextRequest)}\n`, "utf8");
  const nextActivation = invoke(resolve(packageRoot, "bin", "codex-flow.mjs"), [
    "run", "activate", "--run-id", nextRequest.run_id, "--file", nextRequestPath, "--json",
  ], fixture.primary, { CODEX_THREAD_ID: nextCoordinator.thread_id });
  assert.equal(nextActivation.status, 0, nextActivation.stderr || nextActivation.stdout);
  const next = JSON.parse(nextActivation.stdout);
  assert.equal(next.run.run_id, nextRequest.run_id);
  assert.equal(await readFile(predecessorLifecyclePath, "utf8"), predecessorLifecycleBytes);
  assert.equal(await readFile(fixture.reportPath, "utf8"), predecessorReportBytes);
  const nextDirector = {
    lineage_id: "v099-next-assignment-director",
    thread_id: "v099-next-assignment-director-thread",
    generation: 1,
  };
  const nextStateRoot = resolve(fixture.commonDir, "codex-flow", RUNTIME_DIRECTORY);
  await bindRecipient({ stateRoot: nextStateRoot, recipient: nextDirector });
  const nextPlanPath = resolve(fixture.primary, "next-approved-plan.md");
  await writeFile(nextPlanPath, "# next assignment\n", "utf8");
  const nextRegistration = await registerCoordinatorReportRoute({
    stateRoot: nextStateRoot,
    runId: next.run.run_id,
    senderThreadId: nextCoordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...nextDirector,
      binding_digest: recipientBindingDigest(nextDirector),
    },
    approvedPlanPath: nextPlanPath,
    approvedPlanDigest: sha256(await readFile(nextPlanPath)),
    iterationLabel: "v0.9.9 development next assignment",
    purpose: "Prove the next assignment can begin after settled closeout.",
    repositoryRoot: fixture.primary,
    repositoryBranch: "main",
    now: TIME + 7_000,
  });
  assert.equal(nextRegistration.route.assignment.run_id, "v099-next-assignment-run");

  git(fixture.primary, ["tag", "-d", "v099-closeout-recovery-preserved"]);
  git(fixture.primary, ["commit", "--allow-empty", "--quiet", "-m", "move primary beyond the archived coordinator tip"]);
  const missingRef = await reconcileSettledV097CoordinatorPredecessor({ commonDir: fixture.commonDir, candidate });
  assert.equal(missingRef.status, "blocked");
  assert.match(missingRef.reason, /preserved non-host Git ref/);
});

test("settled v0.9.7 reconciliation fails closed on missing accepted-report evidence and source authentication names the spawn failure", async (t) => {
  const fixture = await settledV097Fixture(t);
  const candidates = await refreshNamespaceCandidates({ commonDir: fixture.commonDir, currentNamespace: RUNTIME_DIRECTORY });
  const candidate = candidates.find((entry) => entry.namespace === "v0.9.7");
  await rm(fixture.reportPath);
  const missingReport = await reconcileSettledV097CoordinatorPredecessor({ commonDir: fixture.commonDir, candidate });
  assert.equal(missingReport.status, "blocked");
  assert.match(missingReport.reason, /accepted report record/i);
  assert.match(missingReport.reason, /Do not recreate, remove, or rebind/);
  const blockedCoordinator = {
    lineage_id: "v097-missing-report-fresh-lineage",
    thread_id: "v097-missing-report-fresh-coordinator",
    generation: 1,
  };
  const blockedRequest = freshActivationRequest({
    runId: "v097-missing-report-fresh-run",
    coordinator: blockedCoordinator,
  });
  const blockedRequestPath = resolve(fixture.requests, "missing-report-fresh-activation.json");
  await writeFile(blockedRequestPath, `${JSON.stringify(blockedRequest)}\n`, "utf8");
  const blockedActivation = invoke(resolve(packageRoot, "bin", "codex-flow.mjs"), [
    "run", "activate", "--run-id", blockedRequest.run_id, "--file", blockedRequestPath, "--json",
  ], fixture.primary, { CODEX_THREAD_ID: blockedCoordinator.thread_id });
  assert.notEqual(blockedActivation.status, 0);
  assert.match(`${blockedActivation.stderr}\n${blockedActivation.stdout}`, /accepted report record/i);
  await assert.rejects(
    loadRefreshSourceAuthority({
      commonDir: fixture.commonDir,
      namespace: "v0.9.7",
      runId: "v097-closeout-recovery-run",
    }),
    /Refresh source repository authentication: .*ENOENT/,
  );
});

test("accepted coordinator binding correction preserves the recorded primary binding and closes only the authenticated worktree", async (t) => {
  const fixture = await currentRecoveryFixture(t, { wrongInitialBinding: true });
  await assert.rejects(
    acceptAssignmentResult({
      stateRoot: fixture.registration.state_root,
      assignmentId: fixture.registration.route.assignment.assignment_id,
      reportId: fixture.report.report_id,
      directorThreadId: fixture.director.thread_id,
      taskObservation: activeObservation(fixture.coordinator.thread_id, TIME + 3_000),
      retireLocator: async () => ({ status: "retired" }),
      now: TIME + 3_000,
    }),
    /exact disposable Codex worktree/,
  );
  const requestPath = resolve(fixture.requests, "binding-correction.json");
  await writeFile(requestPath, `${JSON.stringify({
    assignment_id: fixture.registration.route.assignment.assignment_id,
  })}\n`, "utf8");
  const corrected = invoke(packageRoot + "/bin/codex-flow.mjs", [
    "assignment", "reconcile-binding", "--assignment-id", fixture.registration.route.assignment.assignment_id,
    "--file", requestPath, "--json",
  ], fixture.coordinatorPath, { CODEX_THREAD_ID: fixture.coordinator.thread_id });
  assert.equal(corrected.status, 0, corrected.stderr);
  assert.equal(JSON.parse(corrected.stdout).status, "corrected");

  const afterCorrection = JSON.parse((await invoke(packageRoot + "/bin/codex-flow.mjs", [
    "assignment", "status", "--assignment-id", fixture.registration.route.assignment.assignment_id, "--json",
  ], fixture.primary)).stdout);
  const coordinatorMember = afterCorrection.iteration.members.find((member) => member.role === "coordinator");
  assert.equal(coordinatorMember.worktree_path, fixture.primary);
  assert.equal(coordinatorMember.branch, "main");
  assert.equal(coordinatorMember.binding_correction.corrected.worktree_path, await realpath(fixture.coordinatorPath));
  assert.equal(coordinatorMember.binding_correction.corrected.branch, fixture.coordinatorBranch);

  const retired = await acceptAssignmentResult({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
    reportId: fixture.report.report_id,
    directorThreadId: fixture.director.thread_id,
    taskObservation: archivedObservation(fixture.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_000,
  });
  assert.equal(retired.status, "retired");
  assert.equal(git(fixture.primary, ["branch", "--show-current"]), "main");
  assert.equal(await readFile(resolve(fixture.primary, ".gitkeep"), "utf8"), "fixture\n");
  assert.equal(git(fixture.primary, ["branch", "--list", fixture.coordinatorBranch]), "");
});

test("accepted coordinator resource loss without an exact completed result record fails with an actionable disposition", async (t) => {
  const fixture = await currentRecoveryFixture(t);
  git(fixture.primary, ["worktree", "remove", fixture.coordinatorPath]);
  git(fixture.primary, ["branch", "-D", fixture.coordinatorBranch]);

  await assert.rejects(
    acceptAssignmentResult({
      stateRoot: fixture.registration.state_root,
      assignmentId: fixture.registration.route.assignment.assignment_id,
      reportId: fixture.report.report_id,
      directorThreadId: fixture.director.thread_id,
      taskObservation: activeObservation(fixture.coordinator.thread_id, TIME + 3_000),
      retireLocator: async () => ({ status: "retired" }),
      now: TIME + 3_000,
    }),
    /worktree is absent before native archival/,
  );
  await assert.rejects(
    acceptAssignmentResult({
      stateRoot: fixture.registration.state_root,
      assignmentId: fixture.registration.route.assignment.assignment_id,
      reportId: fixture.report.report_id,
      directorThreadId: fixture.director.thread_id,
      coordinatorRecovery: {
        kind: "resources-absent",
        preserved_tip: git(fixture.primary, ["rev-parse", "HEAD"]),
      },
      retireLocator: async () => ({ status: "retired" }),
      now: TIME + 3_100,
    }),
    /no completed coordinator-work result is authenticated.*director disposition/,
  );
});

test("completed coordinator work from another checkout cannot supply a vanished coordinator result tip", async (t) => {
  const fixture = await currentRecoveryFixture(t);
  const completed = await completeExactCoordinatorWork(fixture);
  const recordPath = resolve(
    fixture.commonDir,
    "codex-flow",
    RUNTIME_DIRECTORY,
    "coordinator-work",
    "records",
    `${completed.local_work_id}.json`,
  );
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.baseline.root = fixture.primary;
  await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
  git(fixture.primary, ["worktree", "remove", fixture.coordinatorPath]);
  git(fixture.primary, ["branch", "-D", fixture.coordinatorBranch]);

  await assert.rejects(
    acceptAssignmentResult({
      stateRoot: fixture.registration.state_root,
      assignmentId: fixture.registration.route.assignment.assignment_id,
      reportId: fixture.report.report_id,
      directorThreadId: fixture.director.thread_id,
      taskObservation: activeObservation(fixture.coordinator.thread_id, TIME + 3_000),
      coordinatorRecovery: {
        kind: "resources-absent",
        preserved_tip: completed.result.final_revision,
      },
      retireLocator: async () => ({ status: "retired" }),
      now: TIME + 3_000,
    }),
    /no completed coordinator-work result is authenticated/,
  );
});

test("accepted coordinator resource loss reuses one exact completed coordinator-work result when pre-archive capture never ran", async (t) => {
  const fixture = await currentRecoveryFixture(t);
  const completed = await completeExactCoordinatorWork(fixture);
  const unrelatedAncestor = completed.result.baseline_revision;
  git(fixture.primary, ["worktree", "remove", fixture.coordinatorPath]);
  git(fixture.primary, ["branch", "-D", fixture.coordinatorBranch]);

  await assert.rejects(
    acceptAssignmentResult({
      stateRoot: fixture.registration.state_root,
      assignmentId: fixture.registration.route.assignment.assignment_id,
      reportId: fixture.report.report_id,
      directorThreadId: fixture.director.thread_id,
      taskObservation: activeObservation(fixture.coordinator.thread_id, TIME + 3_000),
      coordinatorRecovery: {
        kind: "resources-absent",
        preserved_tip: unrelatedAncestor,
      },
      retireLocator: async () => ({ status: "retired" }),
      now: TIME + 3_000,
    }),
    /does not match the authenticated coordinator result tip/,
  );

  const recovered = await acceptAssignmentResult({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
    reportId: fixture.report.report_id,
    directorThreadId: fixture.director.thread_id,
    taskObservation: activeObservation(fixture.coordinator.thread_id, TIME + 3_100),
    coordinatorRecovery: {
      kind: "resources-absent",
      preserved_tip: completed.result.final_revision,
    },
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_100,
  });
  assert.equal(recovered.status, "closeout-pending");
  assert.equal(recovered.closeout.status, "host-action-required");
  const coordinatorMember = recovered.closeout.iteration.members.find((member) => member.role === "coordinator");
  assert.equal(coordinatorMember.absence_reconciliation.preserved_tip, completed.result.final_revision);
  assert.deepEqual(coordinatorMember.absence_reconciliation.result_authority, {
    kind: "completed-coordinator-work-v1",
    namespace: RUNTIME_DIRECTORY,
    local_work_id: completed.local_work_id,
    record_digest: sha256(stableStringify(completed)),
    final_revision: completed.result.final_revision,
    verification_id: completed.verification.verification_id,
    verification_evidence_digest: completed.verification.evidence_digest,
  });

  const retired = await acceptAssignmentResult({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
    reportId: fixture.report.report_id,
    directorThreadId: fixture.director.thread_id,
    taskObservation: archivedObservation(fixture.coordinator.thread_id, TIME + 3_200),
    hostResult: {
      attempt_id: recovered.closeout.host_request.attempt_id,
      thread_id: fixture.coordinator.thread_id,
      outcome: "accepted",
    },
    coordinatorRecovery: {
      kind: "resources-absent",
      preserved_tip: completed.result.final_revision,
    },
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_200,
  });
  assert.equal(retired.status, "retired");
  assert.equal((await assignmentAuthority({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
  })).state, "retired");
});

test("accepted coordinator resource-loss recovery reuses the captured result tip across host-result re-entry and permits a next run in the same release namespace", async (t) => {
  const fixture = await currentRecoveryFixture(t);
  const unrelatedAncestor = git(fixture.primary, ["rev-parse", "HEAD"]);
  await writeFile(resolve(fixture.coordinatorPath, "accepted-coordinator-result.txt"), "preserved\n", "utf8");
  git(fixture.coordinatorPath, ["add", "accepted-coordinator-result.txt"]);
  git(fixture.coordinatorPath, ["commit", "--quiet", "-m", "accepted coordinator result"]);
  const preservedTip = git(fixture.coordinatorPath, ["rev-parse", "HEAD"]);
  git(fixture.primary, ["merge", "--ff-only", preservedTip]);

  const initialRequestPath = resolve(fixture.requests, "initial-archive.json");
  await writeFile(initialRequestPath, `${JSON.stringify({
    assignment_id: fixture.registration.route.assignment.assignment_id,
    report_id: fixture.report.report_id,
    task_observation: activeObservation(fixture.coordinator.thread_id, Date.now()),
  })}\n`, "utf8");
  const initial = invoke(packageRoot + "/bin/codex-flow.mjs", [
    "assignment", "accept", "--assignment-id", fixture.registration.route.assignment.assignment_id,
    "--file", initialRequestPath, "--json",
  ], fixture.primary, { CODEX_THREAD_ID: fixture.director.thread_id });
  assert.equal(initial.status, 0, initial.stderr);
  const preparedArchive = JSON.parse(initial.stdout);
  assert.equal(preparedArchive.status, "closeout-pending");
  assert.equal(preparedArchive.closeout.status, "host-action-required");
  assert.equal(preparedArchive.closeout.host_request.thread_id, fixture.coordinator.thread_id);

  git(fixture.primary, ["worktree", "remove", fixture.coordinatorPath]);
  git(fixture.primary, ["branch", "-D", fixture.coordinatorBranch]);

  const unrelatedRequestPath = resolve(fixture.requests, "resources-absent-unrelated-ancestor.json");
  await writeFile(unrelatedRequestPath, `${JSON.stringify({
    assignment_id: fixture.registration.route.assignment.assignment_id,
    report_id: fixture.report.report_id,
    coordinator_recovery: { kind: "resources-absent", preserved_tip: unrelatedAncestor },
  })}\n`, "utf8");
  const unrelated = invoke(packageRoot + "/bin/codex-flow.mjs", [
    "assignment", "accept", "--assignment-id", fixture.registration.route.assignment.assignment_id,
    "--file", unrelatedRequestPath, "--json",
  ], fixture.primary, { CODEX_THREAD_ID: fixture.director.thread_id });
  assert.notEqual(unrelated.status, 0);
  assert.match(unrelated.stderr, /does not match the authenticated coordinator result tip/);

  const recoveryRequestPath = resolve(fixture.requests, "resources-absent.json");
  await writeFile(recoveryRequestPath, `${JSON.stringify({
    assignment_id: fixture.registration.route.assignment.assignment_id,
    report_id: fixture.report.report_id,
    coordinator_recovery: { kind: "resources-absent", preserved_tip: preservedTip },
  })}\n`, "utf8");
  const recovered = invoke(packageRoot + "/bin/codex-flow.mjs", [
    "assignment", "accept", "--assignment-id", fixture.registration.route.assignment.assignment_id,
    "--file", recoveryRequestPath, "--json",
  ], fixture.primary, { CODEX_THREAD_ID: fixture.director.thread_id });
  assert.equal(recovered.status, 0, recovered.stderr);
  const pending = JSON.parse(recovered.stdout);
  assert.equal(pending.status, "closeout-pending");
  assert.equal(pending.closeout.status, "host-result-required");

  const retired = await acceptAssignmentResult({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
    reportId: fixture.report.report_id,
    directorThreadId: fixture.director.thread_id,
    taskObservation: archivedObservation(fixture.coordinator.thread_id, Date.now()),
    hostResult: {
      attempt_id: preparedArchive.closeout.host_request.attempt_id,
      thread_id: fixture.coordinator.thread_id,
      outcome: "accepted",
    },
    coordinatorRecovery: { kind: "resources-absent", preserved_tip: preservedTip },
    retireLocator: async () => ({ status: "retired" }),
    now: Date.now(),
  });
  assert.equal(retired.status, "retired");
  assert.equal((await assignmentAuthority({
    stateRoot: fixture.registration.state_root,
    assignmentId: fixture.registration.route.assignment.assignment_id,
  })).state, "retired");
  assert.equal(git(fixture.primary, ["branch", "--list", fixture.coordinatorBranch]), "");

  await closeRun({
    gitCommonDirectory: fixture.commonDir,
    runId: fixture.activation.run.run_id,
    resume: fixture.activation.run.binding,
    closedAt: new Date(TIME + 5_000).toISOString(),
  });
  const nextPath = resolve(fixture.primary, `../${basename(fixture.primary)}-next`);
  const nextBranch = "codex/v099-current-recovery-next";
  git(fixture.primary, ["worktree", "add", "--quiet", "-b", nextBranch, nextPath]);
  t.after(() => {
    spawnSync("git", ["worktree", "remove", "--force", nextPath], { cwd: fixture.primary, stdio: "ignore" });
  });
  const nextCoordinator = {
    lineage_id: "current-recovery-next-lineage",
    thread_id: "current-recovery-next-thread",
    generation: 1,
  };
  const nextActivation = await activateFixtureRun({
    root: nextPath,
    runId: "current-recovery-next-run",
    plan: recoveryPlan("current-recovery-next"),
    lineage: nextCoordinator,
    now: TIME + 6_000,
  });
  const nextDirector = {
    lineage_id: "current-recovery-next-director-lineage",
    thread_id: "current-recovery-next-director-thread",
    generation: 1,
  };
  const stateRoot = resolve(fixture.commonDir, "codex-flow", RUNTIME_DIRECTORY);
  await bindRecipient({ stateRoot, recipient: nextDirector });
  const nextPlanPath = resolve(fixture.primary, "current-recovery-next-plan.md");
  await writeFile(nextPlanPath, "# current recovery next run\n", "utf8");
  const nextRegistration = await registerCoordinatorReportRoute({
    stateRoot,
    runId: nextActivation.run.run_id,
    senderThreadId: nextCoordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: { host_id: "fixture-host", ...nextDirector, binding_digest: recipientBindingDigest(nextDirector) },
    approvedPlanPath: nextPlanPath,
    approvedPlanDigest: sha256(await readFile(nextPlanPath)),
    iterationLabel: "current recovery next",
    purpose: "Start the next coordinator assignment in the same release namespace.",
    repositoryRoot: nextPath,
    repositoryBranch: nextBranch,
    now: TIME + 7_000,
  });
  assert.equal(nextRegistration.route.assignment.run_id, "current-recovery-next-run");
  assert.equal((await assignmentAuthority({
    stateRoot: nextRegistration.state_root,
    assignmentId: nextRegistration.route.assignment.assignment_id,
  })).execution_bindings[0].namespace, RUNTIME_DIRECTORY);
});

test("Codex App coordinator ownership binds the current task to the persisted checkout", async (t) => {
  const root = await createGitFixture("codex-flow-v099-coordinator-owner-");
  t.after(() => removeFixture(root));
  const ownerPath = resolve(root, ".git", "codex-thread.json");
  await writeFile(ownerPath, `${JSON.stringify({ version: 1, ownerThreadId: "owner-thread" })}\n`, "utf8");
  const evidence = await assertCodexAppCoordinatorWorktree({
    repositoryPath: root,
    commonDir: resolve(root, ".git"),
    coordinatorThreadId: "owner-thread",
  });
  assert.equal(evidence.owner_thread_id, "owner-thread");
  await assert.rejects(
    assertCodexAppCoordinatorWorktree({
      repositoryPath: root,
      commonDir: resolve(root, ".git"),
      coordinatorThreadId: "different-thread",
    }),
    /owned by a different Codex task/,
  );
});
