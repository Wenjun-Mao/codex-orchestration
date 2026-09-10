import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import { acceptAssignmentResult, cancelAssignmentResult } from "../lib/assignment-acceptance.mjs";
import { completeCoordinatorWork, startCoordinatorWork } from "../lib/coordinator-work.mjs";
import { reconcileTaskArchive, taskArchiveForDisposition } from "../lib/archive-lifecycle.mjs";
import { observeCodexAppPrivateArchive } from "../lib/adapters/codex-app/private-archive-observer.mjs";
import {
  assignmentIdFor,
  assignmentAuthority,
  assignmentStateRoot,
  bindAssignmentRefreshExecution,
  createAssignmentAuthority,
  markAssignmentRegistrationStage,
  openAssignmentForSender,
  publishAssignmentReadiness,
} from "../lib/assignment-authority.mjs";
import {
  assignmentPreparation,
  prepareCoordinatorAssignment,
  validateAssignmentPreparation,
} from "../lib/assignment-preparation.mjs";
import { PACKAGE_VERSION, sha256, stableStringify } from "../lib/core.mjs";
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
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import {
  installRepositoryReportLocator,
  retireRepositoryReportLocator,
} from "../lib/report-hook.mjs";
import {
  acceptReportSubmission,
  beginReportSubmission,
  captureReport,
} from "../lib/report-records.mjs";
import {
  registerCoordinatorReportRoute,
  registerReportRoute,
  closeReportRoute,
  reportRoute,
} from "../lib/report-routes.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { auditRunClosure } from "../lib/run-audit.mjs";
import { abandonRun, closeRun, readRun } from "../lib/run-lifecycle.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications.mjs";
import { activateFixtureRun, createGitFixture, packageRoot } from "./helpers.mjs";
import { createActiveTaskLaunch, terminalReceiptV4 } from "./v09-lifecycle-fixture.mjs";
import { coordinatorBindingDigest, createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import { persistWorkflowTaskContract } from "../lib/workflow-journal.mjs";

const TIME = Date.parse("2026-09-06T15:00:00.000Z");
const FROZEN_RC1_COMMIT = "ac301363976d4433885323530e7ccedbc5fcc5e5";
const cli = resolve(packageRoot, "bin", "codex-flow.mjs");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function frozenRc1Package(t) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v0911-rc1-package-"));
  const archive = resolve(root, "source.tar");
  execFileSync("git", [
    "archive", "--format=tar", `--output=${archive}`, FROZEN_RC1_COMMIT,
  ], { cwd: packageRoot });
  execFileSync("tar", ["-xf", archive, "-C", root]);
  await rm(archive);
  t.after(() => rm(root, { recursive: true, force: true }));
  const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(metadata.version, "0.9.11-rc.1");
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

function invokePackage(cli, args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function assertPackageSuccess(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function jsonRequest(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

function activationRequest({ runId, plan, lineage, branchFences, now }) {
  return {
    run_id: runId,
    activated_at: new Date(now).toISOString(),
    runtime: {
      config: { config_id: `${runId}-config`, snapshot: {} },
      policy: { policy_id: `${runId}-policy`, snapshot: {} },
      host: { host_id: "fixture-host", session_id: `${runId}-session` },
      lineage,
    },
    workflow: {
      schema_version: plan.schema_version,
      plan_id: plan.plan_id,
      revision: plan.revision,
      parent_revision_digest: plan.parent_revision_digest,
      tasks: plan.tasks,
    },
    fences: {
      path_fences: [...new Set(plan.tasks.flatMap((task) => task.write_paths))],
      resource_fences: [...new Set(plan.tasks.flatMap((task) => task.shared_resources))],
      branch_fences: branchFences,
    },
  };
}

async function fixture(t, { detachedCoordinator = false, publishRegistration = true } = {}) {
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
    plan,
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
  let assignment = registered.assignment;
  if (publishRegistration) {
    await installRepositoryReportLocator({
      stateRoot: registered.state_root,
      route: registered.route,
      packageRoot,
      nativeQueue: nativeQueue(),
    });
    await markAssignmentRegistrationStage({
      stateRoot: registered.state_root,
      assignmentId: registered.route.assignment.assignment_id,
      stage: "locator",
      now: TIME,
    });
    assignment = await publishAssignmentReadiness({
      stateRoot: registered.state_root,
      assignmentId: registered.route.assignment.assignment_id,
      now: TIME,
    });
  }
  return {
    ...context,
    primaryRoot,
    coordinatorPath,
    coordinatorBranch,
    director,
    ...registered,
    assignment,
  };
}

function successorAssignmentPlan(suffix) {
  return createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `successor-assignment-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: `successor-assignment-task-${suffix}`,
      title: "Coordinate the successor assignment",
      execution_kind: "coordinator",
      mode: "write",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "The fixture needs one successor on the retained coordinator checkout.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: [`audit-sentinel/successor-assignment-${suffix}.txt`],
      shared_resources: [],
      primary_outcome: "Exercise successor coordinator ownership.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Register and accept one successor assignment.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
}

async function registerSuccessorAssignment(
  predecessor,
  {
    suffix,
    senderThreadId = predecessor.coordinator.thread_id,
    repositoryRoot = predecessor.coordinatorPath,
    repositoryBranch = predecessor.coordinatorBranch,
    now,
  },
) {
  const plan = successorAssignmentPlan(suffix);
  const runId = `successor-assignment-run-${suffix}`;
  const activation = await activateFixtureRun({
    root: repositoryRoot,
    runId,
    plan,
    branchFences: [],
    lineage: {
      lineage_id: `successor-lineage-${suffix}`,
      thread_id: senderThreadId,
      generation: 1,
    },
    now,
  });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: predecessor.stateRoot,
    runId,
    senderThreadId,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...predecessor.director,
      binding_digest: recipientBindingDigest(predecessor.director),
    },
    approvedPlanPath: resolve(repositoryRoot, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: `v0.9.7-successor-${suffix}`,
    purpose: "Successor assignment reporting",
    repositoryRoot,
    repositoryBranch,
    now: now + 100,
  });
  await installRepositoryReportLocator({
    stateRoot: registered.state_root,
    route: registered.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  await markAssignmentRegistrationStage({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
    stage: "locator",
    now: now + 100,
  });
  const assignment = await publishAssignmentReadiness({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
    now: now + 100,
  });
  return { ...registered, assignment, activation };
}

async function abandonAndCancelPredecessor(predecessor, now) {
  const { run } = await readRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: predecessor.launch.run_id,
  });
  const reason = "Exercise an unsuccessful predecessor before a lawful successor assignment.";
  await abandonRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason,
    abandonedAt: new Date(now).toISOString(),
  });
  await installRepositoryReportLocator({
    stateRoot: predecessor.state_root,
    route: predecessor.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  return cancelAssignmentResult({
    stateRoot: predecessor.state_root,
    assignmentId: predecessor.route.assignment.assignment_id,
    directorThreadId: predecessor.director.thread_id,
    reason,
    retireLocator: ({ routeId, reason: retirementReason, now: retirementNow }) => (
      retireRepositoryReportLocator({
        stateRoot: predecessor.state_root,
        routeId,
        reason: retirementReason,
        now: retirementNow,
      })
    ),
    now: now + 100,
  });
}

function activeTaskObservation(threadId, observedAt = TIME) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "typed-host-activity-v1",
    active_visible: true,
    archived_visible: false,
    activity_state: "idle",
    observed_at: new Date(observedAt).toISOString(),
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

function nativeQueue() {
  return {
    binary_path: CODEX_APP_BINARY_PATH,
    expected_version: CODEX_APP_CLI_VERSION,
    sqlite_home: resolve(homedir(), ".codex"),
  };
}

function arrivalBarrier(participants) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolveReady) => {
    release = resolveReady;
  });
  return async () => {
    arrived += 1;
    if (arrived === participants) release();
    await ready;
  };
}

function orderedAssignmentInterleave() {
  const bothArrived = arrivalBarrier(2);
  let releaseSecond;
  const secondMayProceed = new Promise((resolveSecond) => {
    releaseSecond = resolveSecond;
  });
  return {
    first: bothArrived,
    async second() {
      await bothArrived();
      await secondMayProceed;
    },
    releaseSecond,
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
  {
    disposableCoordinator = false,
    deliveryBranch = false,
    integrationOutcome = null,
    integrationTargetExecutor = false,
    patchEquivalentIntegration = false,
    stateNamespace = RUNTIME_DIRECTORY,
    localPredecessor = false,
  } = {},
) {
  const selectedIntegrationOutcome = patchEquivalentIntegration
    ? "patch-equivalent"
    : integrationOutcome;
  if (![null, "ancestor", "patch-equivalent"].includes(selectedIntegrationOutcome)) {
    throw new Error("Fixture integration outcome is unsupported");
  }
  const primaryRoot = await createGitFixture(`codex-flow-v097-child-closeout-${suffix}-`);
  const coordinatorWorktree = disposableCoordinator || deliveryBranch;
  const coordinatorBranch = coordinatorWorktree ? `codex/coordinator-${suffix}` : "main";
  const coordinatorPath = coordinatorWorktree
    ? resolve(primaryRoot, `../${basename(primaryRoot)}-${suffix}-coordinator`)
    : primaryRoot;
  if (coordinatorWorktree) {
    git(primaryRoot, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
    if (deliveryBranch) {
      git(coordinatorPath, ["commit", "--allow-empty", "--quiet", "-m", "delivery branch baseline"]);
    }
  }
  const taskTitle = "Executor · v0.9.7 · Assignment reporting";
  const predecessorTask = localPredecessor ? {
    task_id: `local-predecessor-${suffix}`,
    title: `Complete local predecessor ${suffix}`,
    execution_kind: "coordinator",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for the bounded local predecessor.",
    fork_turns: null,
    dependencies: [],
    read_paths: [],
    write_paths: [`local-predecessor/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: "Produce the exact local input for the visible executor.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Commit and verify the local predecessor once.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  } : null;
  let localWork = null;
  const context = await createActiveTaskLaunch(coordinatorPath, suffix, {
    taskTitle,
    task: localPredecessor ? { dependencies: [predecessorTask.task_id] } : {},
    predecessorTask,
    baseTime: localPredecessor ? TIME - 5_000 : undefined,
    beforeTaskContract: localPredecessor ? async ({
      stateRoot,
      runId,
      plan,
      coordinator,
      baseline,
      baseTime,
    }) => {
      const contract = await persistWorkflowTaskContract({
        stateRoot,
        runId,
        planId: plan.plan_id,
        taskId: predecessorTask.task_id,
        currentBaseline: { revision: baseline },
        dependencyAuthorities: [],
        now: baseTime - 1_500,
      });
      const previousThread = process.env.CODEX_THREAD_ID;
      process.env.CODEX_THREAD_ID = coordinator.thread_id;
      try {
        const started = await startCoordinatorWork({
          stateRoot,
          taskContract: contract,
          repositoryPath: coordinatorPath,
          now: baseTime - 1_250,
        });
        await mkdir(resolve(coordinatorPath, "local-predecessor"), { recursive: true });
        await writeFile(resolve(coordinatorPath, `local-predecessor/${suffix}.txt`), "local input\n", "utf8");
        git(coordinatorPath, ["add", `local-predecessor/${suffix}.txt`]);
        git(coordinatorPath, ["commit", "--quiet", "-m", `local predecessor ${suffix}`]);
        localWork = await completeCoordinatorWork({
          stateRoot,
          localWorkId: started.local_work_id,
          repositoryPath: coordinatorPath,
          checks: [{ check_id: "local-input", argv: [process.execPath, "-e", "process.exit(0)"] }],
          now: baseTime - 1_000,
        });
      } finally {
        if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
        else process.env.CODEX_THREAD_ID = previousThread;
      }
      return [{ authority_kind: "coordinator-work", authority_id: localWork.local_work_id }];
    } : null,
  });
  const currentStateRoot = context.stateRoot;
  const legacyStateRoot = resolve(context.commonDir, "codex-flow", stateNamespace);
  const usesLegacyState = stateNamespace !== RUNTIME_DIRECTORY;
  if (usesLegacyState) {
    await rename(currentStateRoot, legacyStateRoot);
    context.stateRoot = legacyStateRoot;
  }
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", context.executorPath], {
      cwd: primaryRoot,
      encoding: "utf8",
    });
    if (coordinatorWorktree) {
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
    repositoryRoot: coordinatorWorktree ? coordinatorPath : null,
    repositoryBranch: coordinatorWorktree ? coordinatorBranch : null,
    now: TIME,
  });
  await installRepositoryReportLocator({
    stateRoot: registered.state_root,
    route: registered.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  await markAssignmentRegistrationStage({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
    stage: "locator",
    now: TIME,
  });
  await publishAssignmentReadiness({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
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
  if (usesLegacyState) {
    await rename(legacyStateRoot, currentStateRoot);
    context.stateRoot = currentStateRoot;
  }
  await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
  });
  if (usesLegacyState) {
    await rename(currentStateRoot, legacyStateRoot);
    context.stateRoot = legacyStateRoot;
  }
  let executorCommit = null;
  if (selectedIntegrationOutcome !== null) {
    await writeFile(resolve(context.executorPath, "integration-result.txt"), `${suffix}\n`, "utf8");
    git(context.executorPath, ["add", "integration-result.txt"]);
    git(context.executorPath, ["commit", "--quiet", "-m", `executor ${suffix}`]);
    executorCommit = git(context.executorPath, ["rev-parse", "HEAD"]);
  }
  const receipt = terminalReceiptV4(context, selectedIntegrationOutcome !== null ? {
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
    decision: selectedIntegrationOutcome !== null ? "accepted-for-integration" : "accepted-no-change",
    reason: selectedIntegrationOutcome !== null
      ? "The child returned one clean commit for serial integration."
      : "The child returned verified no-change work.",
  });
  let integration = null;
  let verification;
  if (selectedIntegrationOutcome !== null) {
    const integrationPath = integrationTargetExecutor
      ? context.executorPath
      : coordinatorWorktree ? coordinatorPath : primaryRoot;
    const integrationBranch = integrationTargetExecutor
      ? context.executorBranch
      : coordinatorWorktree ? coordinatorBranch : "main";
    integration = await prepareSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: integrationPath,
      dispositionId: disposition.disposition_id,
      mainBranch: integrationBranch,
    });
    if (selectedIntegrationOutcome === "ancestor") {
      git(integrationPath, ["merge", "--ff-only", "--quiet", executorCommit]);
    } else {
      // Ensure cherry-pick preservation is exercised even when Git timestamps
      // would otherwise reproduce the executor commit byte-for-byte.
      git(integrationPath, ["commit", "--allow-empty", "--quiet", "-m", "independent target work"]);
      git(integrationPath, ["cherry-pick", "--quiet", executorCommit]);
    }
    const request = await integrationVerificationRequest({
      stateRoot: context.stateRoot,
      repositoryPath: integrationPath,
      integrationId: integration.integration_id,
    });
    verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: integrationPath,
      receipt: request.receipt,
      integrationScope: request.integration_scope,
      checks: [{ check_id: "exact-child", argv: [process.execPath, "-e", "process.exit(0)"] }],
    });
    integration = await reconcileSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: integrationPath,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    assert.equal(integration.outcome, selectedIntegrationOutcome);
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
    localWork,
    reporting: registered,
  };
}

async function closeoutAcceptedExecutor(child, { now = TIME + 12_000 } = {}) {
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    taskObservation: activeTaskObservation(child.context.executorThreadId, now),
    now,
  });
  assert.equal(prepared.status, "host-action-required");
  const closed = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    taskObservation: archivedTaskObservation(child.context.executorThreadId, now + 100),
    hostResult: hostResult(prepared.host_request, "accepted"),
    now: now + 100,
  });
  return { prepared, closed };
}

test("mixed local and visible delivery preserves its owner through closeout and successor admission", async (t) => {
  const child = await acceptedChildFixture(t, "mixed-connected-journey", {
    deliveryBranch: true,
    integrationOutcome: "ancestor",
    localPredecessor: true,
  });
  assert.equal(child.localWork.state, "completed");
  assert.equal(child.context.contract.accepted_dependencies[0].authority_kind, "coordinator-work");
  assert.notEqual(
    git(child.root, ["rev-parse", "main"]),
    git(child.root, ["rev-parse", child.coordinatorBranch]),
  );
  const now = Date.now();
  const executorCloseout = await closeoutAcceptedExecutor(child, { now });
  assert.equal(executorCloseout.closed.status, "phase-complete");
  const report = await acceptedFinal(
    child.reporting,
    "mixed-connected-final",
    "Mixed local and visible delivery complete.",
    now + 500 - TIME,
  );
  const retireLocator = ({ routeId, reason, now: retirementNow }) => (
    retireRepositoryReportLocator({
      stateRoot: child.reporting.state_root,
      routeId,
      reason,
      now: retirementNow,
    })
  );
  const premature = await acceptAssignmentResult({
    stateRoot: child.reporting.state_root,
    assignmentId: child.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: child.assignment.recipient.thread_id,
    taskObservation: activeTaskObservation(child.context.coordinator.thread_id, now + 600),
    retireLocator,
    now: now + 600,
  });
  assert.equal(premature.reason, "execution-terminal-required");
  assert.equal(Object.hasOwn(premature, "closeout"), false);
  const audit = await auditRunClosure({
    stateRoot: child.context.stateRoot,
    runId: child.context.launch.run_id,
  });
  assert.equal(audit.audit.terminal_ready, true, JSON.stringify(audit.audit.blockers));
  const { run } = await readRun({
    gitCommonDirectory: child.context.commonDir,
    runId: child.context.launch.run_id,
  });
  await closeRun({
    gitCommonDirectory: child.context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    closedAt: new Date(now + 1_000).toISOString(),
  });
  git(child.root, ["merge", "--ff-only", "--quiet", child.coordinatorBranch]);
  const preservedTip = git(child.root, ["rev-parse", child.coordinatorBranch]);
  assert.equal(git(child.root, ["rev-parse", "main"]), preservedTip);
  const pending = await acceptAssignmentResult({
    stateRoot: child.reporting.state_root,
    assignmentId: child.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: child.assignment.recipient.thread_id,
    taskObservation: activeTaskObservation(child.context.coordinator.thread_id, now + 3_000),
    retireLocator,
    now: now + 3_000,
  });
  assert.equal(pending.status, "closeout-pending");
  const retired = await acceptAssignmentResult({
    stateRoot: child.reporting.state_root,
    assignmentId: child.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: child.assignment.recipient.thread_id,
    taskObservation: archivedTaskObservation(child.context.coordinator.thread_id, now + 3_100),
    hostResult: hostResult(pending.closeout.host_request, "accepted"),
    retireLocator,
    now: now + 3_100,
  });
  assert.equal(retired.status, "retired");
  assert.equal(git(child.root, ["rev-parse", "main"]), preservedTip);
  assert.equal(git(child.root, ["branch", "--list", child.coordinatorBranch]), "");
  assert.equal(retired.locator_retirement.status, "retired");

  const successorCoordinator = {
    lineage_id: "mixed-successor-lineage",
    thread_id: "mixed-successor-thread",
    generation: 1,
  };
  const successorPlan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "mixed-successor-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "mixed-successor-local",
      title: "Admit the mixed-journey successor",
      execution_kind: "coordinator",
      mode: "read",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "The successor is one bounded coordinator admission check.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: [],
      shared_resources: [],
      primary_outcome: "Admit the successor after mixed closeout.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Activate and register one successor assignment.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  const successorRequests = await mkdtemp(resolve(tmpdir(), "codex-flow-mixed-successor-"));
  t.after(() => rm(successorRequests, { recursive: true, force: true }));
  const successorRunId = "mixed-successor-run";
  const successorNow = Date.now() - 1_000;
  const successorGitDir = resolve(git(child.root, [
    "rev-parse", "--path-format=absolute", "--git-dir",
  ]));
  await writeFile(resolve(successorGitDir, "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: successorCoordinator.thread_id,
  })}\n`, "utf8");
  const successorActivationPath = await jsonRequest(successorRequests, "activation", activationRequest({
    runId: successorRunId,
    plan: successorPlan,
    lineage: successorCoordinator,
    branchFences: [],
    now: successorNow,
  }));
  const successor = assertPackageSuccess(invokePackage(cli, [
    "run", "activate", "--run-id", successorRunId,
    "--file", successorActivationPath, "--json",
  ], child.root, { CODEX_THREAD_ID: successorCoordinator.thread_id }), "mixed successor activation");
  const successorRuntimeCli = resolve(successor.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const successorPreparationPath = await jsonRequest(successorRequests, "preparation", {
    approved_plan_path: resolve(child.root, ".gitkeep"),
    recipient: {
      host_id: "fixture-host",
      lineage_id: child.assignment.recipient.lineage_id,
      thread_id: child.assignment.recipient.thread_id,
      generation: child.assignment.recipient.generation,
    },
    iteration_label: "mixed successor",
    purpose: "Prove successor admission after mixed closeout.",
    outcome: "Admit the successor and complete one useful operation.",
    scope: ["Start and complete the successor's local workflow task."],
    acceptance_criteria: ["The public successor route is ready and local work completes."],
    constraints: [],
    reasons: [],
  });
  const preparation = assertPackageSuccess(invokePackage(cli, [
    "assignment", "prepare", "--file", successorPreparationPath, "--json",
  ], child.root, { CODEX_THREAD_ID: child.assignment.recipient.thread_id }), "mixed successor preparation");
  const successorRoutePath = await jsonRequest(successorRequests, "route", {
    run_id: successorRunId,
    sender_thread_id: successorCoordinator.thread_id,
    preparation_id: preparation.preparation.preparation_id,
  });
  const registration = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "report", "route", "coordinator", "--run-id", successorRunId,
    "--file", successorRoutePath, "--json",
  ], child.root, { CODEX_THREAD_ID: successorCoordinator.thread_id }), "mixed successor registration");
  assert.equal(registration.assignment.state, "open");
  const successorStartPath = await jsonRequest(successorRequests, "local-start", {
    run_id: successorRunId,
    plan_id: successorPlan.plan_id,
    task_id: successorPlan.tasks[0].task_id,
    dependency_authorities: [],
  });
  const successorWork = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "workflow", "local", "start", "--run-id", successorRunId,
    "--file", successorStartPath, "--json",
  ], child.root, { CODEX_THREAD_ID: successorCoordinator.thread_id }), "mixed successor useful work start");
  const successorCompletePath = await jsonRequest(successorRequests, "local-complete", {
    run_id: successorRunId,
    local_work_id: successorWork.local_work_id,
    checks: [{ check_id: "successor-useful-check", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const successorComplete = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "workflow", "local", "complete", "--run-id", successorRunId,
    "--file", successorCompletePath, "--json",
  ], child.root, { CODEX_THREAD_ID: successorCoordinator.thread_id }), "mixed successor useful work completion");
  assert.equal(successorComplete.state, "completed");
});

test("run audit rejects rollback to an older local fact after a later integrated result", async (t) => {
  const child = await acceptedChildFixture(t, "mixed-stale-terminal-fact", {
    deliveryBranch: true,
    integrationOutcome: "ancestor",
    localPredecessor: true,
  });
  const integratedTip = git(child.coordinatorPath, ["rev-parse", "HEAD"]);
  assert.notEqual(integratedTip, child.localWork.result.final_revision);
  await closeoutAcceptedExecutor(child, { now: Date.now() });
  git(child.coordinatorPath, ["reset", "--hard", child.localWork.result.final_revision]);
  const audit = await auditRunClosure({
    stateRoot: child.context.stateRoot,
    runId: child.context.launch.run_id,
  });
  assert.equal(audit.audit.terminal_ready, false);
  assert.equal(audit.audit.blockers.some((blocker) => blocker.code === "repository-drift"), true);
  assert.equal(audit.audit.repository.expected_head_revision, integratedTip);
});

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

test("interrupted coordinator registration exposes status and a lawful public abort", async (t) => {
  const context = await fixture(t, { publishRegistration: false });
  const assignmentId = context.route.assignment.assignment_id;
  const before = assertPackageSuccess(invokePackage(cli, [
    "assignment", "status", "--assignment-id", assignmentId, "--json",
  ], context.coordinatorPath), "partial assignment status");
  assert.equal(before.assignment.state, "registering");
  assert.equal(before.registration.route, "ready");
  assert.equal(before.registration.locator, "pending");
  assert.equal(before.iteration.state, "open");
  assert.equal(before.route.state, "active");
  assert.equal(before.locator.status, "absent");
  assert.match(before.registration.next_action, /locator/);
  await closeReportRoute({
    stateRoot: context.state_root,
    routeId: context.route.route_id,
    reason: "terminal",
    now: TIME + 500,
  });
  const closedWhileActive = assertPackageSuccess(invokePackage(cli, [
    "assignment", "status", "--assignment-id", assignmentId, "--json",
  ], context.coordinatorPath), "closed-route active-registration status");
  assert.match(closedWhileActive.registration.next_action, /terminalize every bound execution/);

  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-registration-abort-"));
  t.after(() => rm(requests, { recursive: true, force: true }));
  const { run } = await readRun({
    gitCommonDirectory: context.commonDir,
    runId: context.launch.run_id,
  });
  const reason = "Abort one interrupted registration while retaining unresolved reservations.";
  const abandonRequest = await jsonRequest(requests, "abandon", {
    run_id: run.run_id,
    resume: run.binding,
    reason,
    abandoned_at: new Date(TIME + 1_000).toISOString(),
  });
  const abandoned = assertPackageSuccess(invokePackage(cli, [
    "run", "abandon", "--run-id", run.run_id, "--file", abandonRequest, "--json",
  ], context.coordinatorPath, { CODEX_THREAD_ID: context.coordinator.thread_id }), "partial registration run abandonment");
  assert.equal(abandoned.run.status, "abandoned");
  assert.deepEqual(abandoned.locator_retirements, []);
  const terminalStatus = assertPackageSuccess(invokePackage(cli, [
    "assignment", "status", "--assignment-id", assignmentId, "--json",
  ], context.coordinatorPath), "terminal partial assignment status");
  assert.equal(terminalStatus.route.state, "closed");
  assert.match(terminalStatus.registration.next_action, /cancel the assignment/);

  const cancelRequest = await jsonRequest(requests, "cancel", {
    assignment_id: assignmentId,
    reason,
  });
  const cancelled = assertPackageSuccess(invokePackage(cli, [
    "assignment", "cancel", "--assignment-id", assignmentId, "--file", cancelRequest, "--json",
  ], context.coordinatorPath, { CODEX_THREAD_ID: context.director.thread_id }), "partial assignment cancellation");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.assignment.registration.status, "aborted");
  assert.equal(cancelled.iteration.iteration.state, "cancelled");
  assert.equal(cancelled.locator_retirement.status, "not-installed");
  assert.equal(cancelled.obligations[0].resource_disposition, "retained");
  assert.equal(cancelled.obligations[0].owner_thread_id, context.coordinator.thread_id);
  assert.match(cancelled.obligations[0].next_action, /retained fences/);

  await assert.rejects(
    activateFixtureRun({
      root: context.coordinatorPath,
      runId: "conflicting-post-abort-run",
      plan: context.plan,
      lineage: {
        lineage_id: "conflicting-post-abort-lineage",
        thread_id: context.coordinator.thread_id,
        generation: 1,
      },
      now: TIME + 2_000,
    }),
    /retained fences/,
  );
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
  const premature = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 2_000,
  });
  assert.equal(premature.status, "closeout-pending");
  assert.equal(premature.reason, "execution-terminal-required");
  assert.equal(premature.active_executions[0].run_id, context.launch.run_id);
  assert.equal(Object.hasOwn(premature, "closeout"), false);
  const { run } = await readRun({
    gitCommonDirectory: context.commonDir,
    runId: context.launch.run_id,
  });
  await closeRun({
    gitCommonDirectory: context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    closedAt: new Date(TIME + 2_500).toISOString(),
  });
  const afterClose = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  assert.equal(afterClose.execution_retirements[0].run_id, run.run_id);
  assert.equal(afterClose.execution_retirements[0].resource_disposition, "released");
  await rm(context.stateRoot, { recursive: true, force: true });
  const prepared = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id, TIME + 3_000),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 3_000,
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

test("concurrent assignment acceptance selects one report inside the lock", async (t) => {
  const context = await fixture(t);
  const firstReport = await acceptedFinal(context, "concurrent-first", "First complete result.", 1_000);
  const secondReport = await acceptedFinal(context, "concurrent-second", "Second complete result.", 1_100);
  const interleave = orderedAssignmentInterleave();
  const request = (report, now, beforeAcceptanceUpdate) => acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    beforeAcceptanceUpdate,
    now,
  });
  const first = request(firstReport, TIME + 2_000, interleave.first);
  const second = request(secondReport, TIME + 3_000, interleave.second);
  const accepted = await first;
  assert.equal(accepted.status, "closeout-pending");
  interleave.releaseSecond();
  await assert.rejects(second, /different report/);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const acceptedAt = assignment.acceptance.accepted_at;
  const replay = await acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: firstReport.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id, TIME + 4_000),
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 4_000,
  });
  assert.equal(replay.status, "closeout-pending");
  assert.equal(replay.assignment.acceptance.accepted_at, acceptedAt);
});

test("concurrent acceptance and cancellation cannot split assignment and reporting state", async (t) => {
  const context = await fixture(t);
  const report = await acceptedFinal(context, "accept-cancel-race", "Terminal result.", 1_000);
  const { run } = await readRun({
    gitCommonDirectory: context.commonDir,
    runId: context.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "Exercise the terminal acceptance and cancellation race.",
    abandonedAt: new Date(TIME + 1_500).toISOString(),
  });
  const interleave = orderedAssignmentInterleave();
  const acceptance = acceptAssignmentResult({
      stateRoot: context.state_root,
      assignmentId: context.route.assignment.assignment_id,
      reportId: report.report_id,
      directorThreadId: context.director.thread_id,
      taskObservation: activeTaskObservation(context.coordinator.thread_id),
      retireLocator: async () => ({ status: "retired" }),
      beforeAcceptanceUpdate: interleave.second,
      now: TIME + 2_000,
    });
  const cancellation = cancelAssignmentResult({
      stateRoot: context.state_root,
      assignmentId: context.route.assignment.assignment_id,
      directorThreadId: context.director.thread_id,
      reason: "Exercise the terminal acceptance and cancellation race.",
      retireLocator: async () => ({ status: "retired" }),
      beforeCancellationUpdate: interleave.first,
      now: TIME + 3_000,
    });
  const cancelled = await cancellation;
  assert.equal(cancelled.status, "cancelled");
  interleave.releaseSecond();
  await assert.rejects(acceptance, /Cancelled assignment cannot be accepted/);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const route = await reportRoute({ stateRoot: context.state_root, routeId: context.route.route_id });
  const iteration = await iterationStatus({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
  });
  assert.equal(assignment.state, "cancelled");
  assert.equal(route.state, "closed");
  assert.equal(iteration.state, "cancelled");
});

test("an accepted decision can still cancel retained execution obligations without cleanup", async (t) => {
  const context = await fixture(t);
  const report = await acceptedFinal(context, "accept-cancel-inverse", "Terminal result.", 1_000);
  const { run } = await readRun({
    gitCommonDirectory: context.commonDir,
    runId: context.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "Exercise the inverse terminal acceptance and cancellation race.",
    abandonedAt: new Date(TIME + 1_500).toISOString(),
  });
  const interleave = orderedAssignmentInterleave();
  const acceptance = acceptAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: context.director.thread_id,
    taskObservation: activeTaskObservation(context.coordinator.thread_id),
    retireLocator: async () => ({ status: "retired" }),
    beforeAcceptanceUpdate: interleave.first,
    now: TIME + 2_000,
  });
  const cancellation = cancelAssignmentResult({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
    directorThreadId: context.director.thread_id,
    reason: "Exercise the inverse terminal acceptance and cancellation race.",
    retireLocator: async () => ({ status: "retired" }),
    beforeCancellationUpdate: interleave.second,
    now: TIME + 3_000,
  });
  const accepted = await acceptance;
  assert.equal(accepted.status, "closeout-pending");
  assert.equal(accepted.reason, "execution-obligations-retained");
  interleave.releaseSecond();
  const cancelled = await cancellation;
  assert.equal(cancelled.status, "cancelled");
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const route = await reportRoute({ stateRoot: context.state_root, routeId: context.route.route_id });
  assert.equal(assignment.state, "cancelled");
  assert.equal(assignment.acceptance.report_id, report.report_id);
  assert.equal(route.state, "closed");
});

test("assignment cancellation proves terminal ownership, retires reporting, and preserves coordinator resources", async (t) => {
  const child = await acceptedChildFixture(t, "failed-assignment-cancellation", { deliveryBranch: true });
  const stateRoot = assignmentStateRoot(child.context.commonDir);
  const route = await reportRoute({ stateRoot, routeId: child.assignment.route_id });
  const cancel = (directorThreadId, reason = "The bounded run was abandoned after an unrecoverable baseline drift.") => (
    cancelAssignmentResult({
      stateRoot,
      assignmentId: child.assignment.assignment_id,
      directorThreadId,
      reason,
      retireLocator: ({ routeId, reason: retirementReason, now }) => retireRepositoryReportLocator({
        stateRoot,
        routeId,
        reason: retirementReason,
        now,
      }),
      now: TIME + 15_000,
    })
  );

  await assert.rejects(
    () => cancel("wrong-director"),
    /Only the assigned director can cancel/,
  );
  await assert.rejects(
    () => cancel(child.assignment.recipient.thread_id),
    /requires terminal execution evidence/,
  );

  const executorCloseout = await closeoutAcceptedExecutor(child, { now: TIME + 15_100 });
  assert.equal(executorCloseout.closed.status, "phase-complete");
  const { run } = await readRun({
    gitCommonDirectory: child.context.commonDir,
    runId: child.context.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: child.context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "The isolated fixture records an honest failed-assignment exit.",
    abandonedAt: new Date(TIME + 15_200).toISOString(),
  });
  await installRepositoryReportLocator({
    stateRoot,
    route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });

  const cancelled = await cancel(child.assignment.recipient.thread_id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.assignment.state, "cancelled");
  assert.equal(cancelled.assignment.acceptance, null);
  assert.equal(cancelled.assignment.cancellation.execution_evidence[0].terminal_status, "abandoned");
  assert.equal(cancelled.iteration.iteration.state, "cancelled");
  const executor = cancelled.iteration.iteration.members.find((member) => member.role === "executor");
  const coordinator = cancelled.iteration.iteration.members.find((member) => member.role === "coordinator");
  assert.equal(executor.state, "archived");
  assert.equal(coordinator.state, "registered");
  assert.notEqual(git(child.root, ["branch", "--list", child.coordinatorBranch]), "");
  assert.equal((await reportRoute({ stateRoot, routeId: route.route_id })).state, "closed");
  await assert.rejects(
    () => captureReport({
      stateRoot,
      routeId: route.route_id,
      source: {
        host_id: route.sender.host_id,
        thread_id: route.sender.thread_id,
        turn_id: "late-cancelled-final",
        output_kind: "final-assistant-output",
      },
      finalText: "This late final must not be accepted after cancellation.",
      now: TIME + 15_300,
    }),
    /reporting assignment is not open|active report route|not active/i,
  );
  const closeout = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    allowCoordinator: true,
    now: TIME + 15_400,
  });
  assert.equal(closeout.status, "cancelled");
  assert.equal(git(child.root, ["branch", "--list", child.coordinatorBranch]) !== "", true);
  const replay = await cancel(child.assignment.recipient.thread_id);
  assert.equal(replay.status, "already-cancelled");
  await assert.rejects(
    () => cancel(child.assignment.recipient.thread_id, "A different cancellation reason must not rewrite the durable exit."),
    /does not match this exact cancellation request/,
  );
});

test("a cancelled coordinator can be rebound to a successor assignment and reclaimed", async (t) => {
  const predecessor = await fixture(t);
  const { run: predecessorRun } = await readRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: predecessor.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: predecessorRun.run_id,
    resume: predecessorRun.binding,
    reason: "Exercise an unsuccessful predecessor before a lawful successor assignment.",
    abandonedAt: new Date(TIME + 15_500).toISOString(),
  });
  await installRepositoryReportLocator({
    stateRoot: predecessor.state_root,
    route: predecessor.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const cancelled = await cancelAssignmentResult({
    stateRoot: predecessor.state_root,
    assignmentId: predecessor.route.assignment.assignment_id,
    directorThreadId: predecessor.director.thread_id,
    reason: "Exercise an unsuccessful predecessor before a lawful successor assignment.",
    retireLocator: ({ routeId, reason, now }) => retireRepositoryReportLocator({
      stateRoot: predecessor.state_root,
      routeId,
      reason,
      now,
    }),
    now: TIME + 15_600,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.iteration.iteration.state, "cancelled");

  await writeFile(
    resolve(predecessor.coordinatorPath, "successor-baseline.txt"),
    "lawful retained coordinator advance\n",
    "utf8",
  );
  git(predecessor.coordinatorPath, ["add", "successor-baseline.txt"]);
  git(predecessor.coordinatorPath, [
    "commit", "-m", "Advance retained coordinator before successor",
  ]);

  const successorPlan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "successor-assignment-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "successor-assignment-task",
      title: "Coordinate the successor assignment",
      execution_kind: "coordinator",
      mode: "write",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "The fixture needs one successor on the retained coordinator checkout.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: ["audit-sentinel/successor-assignment.txt"],
      shared_resources: [],
      primary_outcome: "Exercise successor coordinator ownership.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Register and accept one successor assignment.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  const successorRunId = "successor-assignment-run";
  const successorActivation = await activateFixtureRun({
    root: predecessor.coordinatorPath,
    runId: successorRunId,
    plan: successorPlan,
    branchFences: [],
    lineage: {
      lineage_id: predecessor.coordinator.lineage_id,
      thread_id: predecessor.coordinator.thread_id,
      generation: predecessor.coordinator.generation,
    },
    now: TIME + 15_700,
  });
  const successorPlanDigest = sha256("fixture\n");
  const successorSender = {
    host_id: "fixture-host",
    thread_id: predecessor.coordinator.thread_id,
  };
  const successorRecipient = {
    host_id: "fixture-host",
    ...predecessor.director,
    binding_digest: recipientBindingDigest(predecessor.director),
  };
  const successorExecutionBinding = {
    run_id: successorRunId,
    runtime_context_digest: successorActivation.authority.runtime_context_digest,
    configuration_digest: successorActivation.authority.configuration_digest,
    repository_digest: successorActivation.authority.repository_id,
    repository_root: predecessor.coordinatorPath,
    repository_branch: predecessor.coordinatorBranch,
    plan_id: successorPlan.plan_id,
    revision_digest: successorPlan.revision_digest,
    namespace: basename(resolve(predecessor.stateRoot)),
    bound_at: new Date(TIME + 15_800).toISOString(),
  };
  const successorAssignmentSeed = {
    common_dir: predecessor.commonDir,
    repository_digest: successorActivation.authority.repository_id,
    approved_plan: {
      digest: successorPlanDigest,
      snapshot_path: resolve(
        assignmentStateRoot(predecessor.commonDir),
        "plans",
        `${successorPlanDigest}.md`,
      ),
    },
    sender: successorSender,
    recipient: successorRecipient,
    execution_bindings: [successorExecutionBinding],
  };
  const expectedSuccessorAssignmentId = assignmentIdFor(successorAssignmentSeed);
  const successorAssignmentDraft = {
    kind: "coordinator-delegation",
    assignment_id: expectedSuccessorAssignmentId,
    run_id: successorRunId,
    runtime_context_digest: successorActivation.authority.runtime_context_digest,
    configuration_digest: successorActivation.authority.configuration_digest,
    repository_digest: successorActivation.authority.repository_id,
    common_dir: predecessor.commonDir,
    plan_id: successorPlan.plan_id,
    revision_digest: successorPlan.revision_digest,
    approved_plan_path: successorAssignmentSeed.approved_plan.snapshot_path,
    approved_plan_digest: successorPlanDigest,
  };
  const expectedSuccessorRouteId = `report-route-v1-${sha256(stableStringify({
    assignment: successorAssignmentDraft,
    sender: successorSender,
    recipient: successorRecipient,
  }))}`;
  const partialSuccessor = await createAssignmentAuthority({
    commonDir: predecessor.commonDir,
    routeId: expectedSuccessorRouteId,
    repositoryDigest: successorActivation.authority.repository_id,
    approvedPlanPath: resolve(predecessor.coordinatorPath, ".gitkeep"),
    approvedPlanDigest: successorPlanDigest,
    sender: successorSender,
    recipient: successorRecipient,
    executionBinding: successorExecutionBinding,
    iterationLabel: "v0.9.7-successor",
    purpose: "Successor assignment reporting",
    expectedAssignmentId: expectedSuccessorAssignmentId,
    now: TIME + 15_800,
  });
  assert.equal(partialSuccessor.status, "created");
  const partialStatus = assertPackageSuccess(invokePackage(cli, [
    "assignment", "status", "--assignment-id", expectedSuccessorAssignmentId, "--json",
  ], predecessor.coordinatorPath), "assignment-only public status");
  assert.equal(partialStatus.assignment.state, "registering");
  assert.equal(partialStatus.iteration, null);
  assert.equal(partialStatus.route, null);
  assert.equal(partialStatus.locator.status, "absent");
  assert.match(partialStatus.registration.next_action, /iteration/);
  await assert.rejects(
    iterationStatus({
      commonDir: predecessor.commonDir,
      iterationId: partialSuccessor.assignment.iteration_id,
    }),
    /ENOENT/,
  );
  const successor = await registerCoordinatorReportRoute({
    stateRoot: predecessor.stateRoot,
    runId: successorRunId,
    senderThreadId: predecessor.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...predecessor.director,
      binding_digest: recipientBindingDigest(predecessor.director),
    },
    approvedPlanPath: resolve(predecessor.coordinatorPath, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    iterationLabel: "v0.9.7-successor",
    purpose: "Successor assignment reporting",
    repositoryRoot: predecessor.coordinatorPath,
    repositoryBranch: predecessor.coordinatorBranch,
    now: TIME + 15_900,
  });
  assert.equal(successor.status, "registered");
  assert.equal(successor.route.assignment.assignment_id, expectedSuccessorAssignmentId);
  const successorAssignment = await assignmentAuthority({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
  });
  assert.equal(
    successorAssignment.created_at,
    new Date(TIME + 15_800).toISOString(),
    "route replay must preserve the assignment-only record's original creation time",
  );
  assert.notEqual(
    successorAssignment.repository_digest,
    cancelled.assignment.repository_digest,
    "the successor must exercise a different revision-bearing repository digest",
  );
  await assert.rejects(
    registerExecutorIterationMember({
      assignment: successorAssignment,
      launch: {
        launch_id: "task-launch-v1-competing-successor-owner",
        task_title: "Executor · v0.9.7-successor · Successor assignment reporting",
        coordinator_binding: { thread_id: predecessor.coordinator.thread_id },
        start_claim: { executor_thread_id: "competing-successor-executor" },
        creation_evidence: { host_id: "fixture-host" },
        git_activation: {
          worktree_path: predecessor.coordinatorPath,
          executor_branch: predecessor.coordinatorBranch,
        },
      },
      stateRoot: predecessor.stateRoot,
      now: TIME + 15_850,
    }),
    /shared by another persisted member/,
  );
  await installRepositoryReportLocator({
    stateRoot: successor.state_root,
    route: successor.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  await markAssignmentRegistrationStage({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
    stage: "locator",
    now: TIME + 15_900,
  });
  await publishAssignmentReadiness({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
    now: TIME + 15_900,
  });
  const report = await acceptedFinal(
    successor,
    "successor-assignment-final",
    "Successor assignment complete.",
    15_900,
  );
  const { run: successorTerminalRun } = await readRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: successorRunId,
  });
  await closeRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: successorRunId,
    resume: successorTerminalRun.binding,
    closedAt: new Date(TIME + 15_950).toISOString(),
  });
  git(predecessor.primaryRoot, ["merge", "--ff-only", predecessor.coordinatorBranch]);
  const retireSuccessorLocator = ({ routeId, reason, now }) => retireRepositoryReportLocator({
    stateRoot: successor.state_root,
    routeId,
    reason,
    now,
  });
  const pending = await acceptAssignmentResult({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: predecessor.director.thread_id,
    taskObservation: activeTaskObservation(predecessor.coordinator.thread_id, TIME + 16_000),
    retireLocator: retireSuccessorLocator,
    now: TIME + 16_000,
  });
  assert.equal(pending.status, "closeout-pending");
  const retired = await acceptAssignmentResult({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: predecessor.director.thread_id,
    taskObservation: archivedTaskObservation(predecessor.coordinator.thread_id, TIME + 16_100),
    hostResult: hostResult(pending.closeout.host_request, "accepted"),
    retireLocator: retireSuccessorLocator,
    now: TIME + 16_100,
  });
  assert.equal(retired.status, "retired");
});

test("frozen RC1 cancellation admits and reclaims an exact RC2 successor", async (t) => {
  assert.equal(PACKAGE_VERSION, "0.9.11-rc.2");
  const source = await frozenRc1Package(t);
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-v0911-cross-version-requests-"));
  t.after(() => rm(requests, { recursive: true, force: true }));
  const primaryRoot = await createGitFixture("codex-flow-v0911-cross-version-");
  const coordinatorPath = resolve(primaryRoot, `../${basename(primaryRoot)}-coordinator`);
  const coordinatorBranch = "codex/v0911-cross-version-coordinator";
  git(primaryRoot, ["worktree", "add", "--quiet", "-b", coordinatorBranch, coordinatorPath]);
  const commonDir = resolve(git(coordinatorPath, [
    "rev-parse", "--path-format=absolute", "--git-common-dir",
  ]));
  const coordinatorGitDir = resolve(git(coordinatorPath, [
    "rev-parse", "--path-format=absolute", "--git-dir",
  ]));
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", coordinatorPath], {
      cwd: primaryRoot,
      encoding: "utf8",
    });
    await rm(primaryRoot, { recursive: true, force: true });
  });

  const coordinator = {
    lineage_id: "v0911-cross-version-coordinator-lineage",
    thread_id: "v0911-cross-version-coordinator-thread",
    generation: 1,
  };
  await writeFile(resolve(coordinatorGitDir, "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: coordinator.thread_id,
  })}\n`, "utf8");
  const director = {
    lineage_id: "v0911-cross-version-director-lineage",
    thread_id: "v0911-cross-version-director-thread",
    generation: 1,
  };
  const predecessorPlan = successorAssignmentPlan("frozen-rc1");
  const predecessorRunId = "v0911-cross-version-rc1-run";
  const predecessorActivationPath = await jsonRequest(
    requests,
    "rc1-activation",
    activationRequest({
      runId: predecessorRunId,
      plan: predecessorPlan,
      lineage: coordinator,
      branchFences: [],
      now: TIME + 16_120,
    }),
  );
  const predecessorActivation = assertPackageSuccess(invokePackage(source.cli, [
    "run", "activate", "--run-id", predecessorRunId,
    "--file", predecessorActivationPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "frozen RC1 activation");
  assert.equal(predecessorActivation.package_authority.package_version, "0.9.11-rc.1");
  const predecessorRuntimeCli = resolve(
    predecessorActivation.runtime_authority.bundle_root,
    "bin",
    "codex-flow.mjs",
  );
  const predecessorPreparationPath = await jsonRequest(requests, "rc1-preparation", {
    approved_plan_path: resolve(coordinatorPath, ".gitkeep"),
    recipient: { host_id: "fixture-host", ...director },
    iteration_label: "v0.9.11 RC1 predecessor",
    purpose: "Cross-version cancelled predecessor",
    outcome: "Preserve one cancelled RC1 coordinator assignment.",
    scope: ["Create and cancel the exact RC1 predecessor."],
    acceptance_criteria: ["RC1 cancellation and locator retirement settle."],
    constraints: [],
    reasons: [],
  });
  const predecessorPreparation = assertPackageSuccess(invokePackage(source.cli, [
    "assignment", "prepare", "--file", predecessorPreparationPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: director.thread_id }), "frozen RC1 assignment preparation");
  const predecessorRoutePath = await jsonRequest(requests, "rc1-route", {
    run_id: predecessorRunId,
    sender_thread_id: coordinator.thread_id,
    preparation_id: predecessorPreparation.preparation.preparation_id,
  });
  const predecessor = assertPackageSuccess(invokePackage(predecessorRuntimeCli, [
    "report", "route", "coordinator", "--run-id", predecessorRunId,
    "--file", predecessorRoutePath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "frozen RC1 route registration");
  const predecessorLocalStartPath = await jsonRequest(requests, "rc1-local-start", {
    run_id: predecessorRunId,
    plan_id: predecessorPlan.plan_id,
    task_id: predecessorPlan.tasks[0].task_id,
    dependency_authorities: [],
  });
  const predecessorLocalWork = assertPackageSuccess(invokePackage(predecessorRuntimeCli, [
    "workflow", "local", "start", "--run-id", predecessorRunId,
    "--file", predecessorLocalStartPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "frozen RC1 local work start");
  await writeFile(
    resolve(coordinatorPath, "cross-version-baseline.txt"),
    "completed RC1 coordinator result\n",
    "utf8",
  );
  git(coordinatorPath, ["add", "cross-version-baseline.txt"]);
  git(coordinatorPath, ["commit", "-m", "Complete RC1 coordinator result"]);
  const predecessorLocalCompletePath = await jsonRequest(requests, "rc1-local-complete", {
    run_id: predecessorRunId,
    local_work_id: predecessorLocalWork.local_work_id,
    checks: [{
      check_id: "frozen-rc1-no-change",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  const completedLocalWork = assertPackageSuccess(invokePackage(predecessorRuntimeCli, [
    "workflow", "local", "complete", "--run-id", predecessorRunId,
    "--file", predecessorLocalCompletePath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "frozen RC1 local work completion");
  assert.equal(completedLocalWork.state, "completed");
  const reason = "Exercise the exact frozen RC1 cancellation before RC2 successor admission.";
  const predecessorAbandonPath = await jsonRequest(requests, "rc1-abandon", {
    run_id: predecessorRunId,
    resume: predecessorActivation.run.binding,
    reason,
  });
  assertPackageSuccess(invokePackage(predecessorRuntimeCli, [
    "run", "abandon", "--run-id", predecessorRunId,
    "--file", predecessorAbandonPath, "--json",
  ], coordinatorPath), "frozen RC1 abandonment");
  const predecessorCancelPath = await jsonRequest(requests, "rc1-cancel", {
    assignment_id: predecessor.route.assignment.assignment_id,
    reason,
  });
  const cancelled = assertPackageSuccess(invokePackage(predecessorRuntimeCli, [
    "assignment", "cancel", "--assignment-id", predecessor.route.assignment.assignment_id,
    "--file", predecessorCancelPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: director.thread_id }), "frozen RC1 cancellation");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.assignment.execution_bindings[0].namespace, "v0.9.11-rc.1");

  const successorCli = resolve(packageRoot, "bin", "codex-flow.mjs");
  const refreshSkill = resolve(packageRoot, "skills", "refresh", "SKILL.md");
  const refreshPreparePath = await jsonRequest(requests, "rc1-to-rc2-refresh-prepare", {
    source_namespace: "v0.9.11-rc.1",
    source_run_id: predecessorRunId,
    source_resume: predecessorActivation.run.binding,
    decisions: [],
    replacements: [],
    target_workflow: null,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: coordinator.thread_id,
  });
  const refresh = assertPackageSuccess(invokePackage(successorCli, [
    "refresh", "prepare", "--invoking-skill", refreshSkill,
    "--file", refreshPreparePath, "--json",
  ], coordinatorPath), "RC1 to RC2 refresh preparation");
  const refreshApplyPath = await jsonRequest(requests, "rc1-to-rc2-refresh-apply", {
    refresh_id: refresh.handoff.refresh_id,
    expected_handoff_digest: refresh.handoff.handoff_digest,
    archive_evidence: [],
  });
  const applied = assertPackageSuccess(invokePackage(successorCli, [
    "refresh", "apply", "--invoking-skill", refreshSkill,
    "--file", refreshApplyPath, "--json",
  ], coordinatorPath), "RC1 to RC2 refresh consumption");
  assert.equal(applied.status, "consumed-clean-start");

  const successorPlan = successorAssignmentPlan("rc2-cross-version");
  const successorRunId = "v0911-cross-version-rc2-run";
  const successorActivationPath = await jsonRequest(
    requests,
    "rc2-activation",
    activationRequest({
      runId: successorRunId,
      plan: successorPlan,
      lineage: coordinator,
      branchFences: [],
      now: TIME + 16_200,
    }),
  );
  const successorActivation = assertPackageSuccess(invokePackage(successorCli, [
    "run", "activate", "--run-id", successorRunId,
    "--file", successorActivationPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "RC2 successor activation");
  assert.equal(successorActivation.package_authority.package_version, "0.9.11-rc.2");
  const successorRuntimeCli = resolve(
    successorActivation.runtime_authority.bundle_root,
    "bin",
    "codex-flow.mjs",
  );
  const successorPreparationPath = await jsonRequest(requests, "rc2-preparation", {
    approved_plan_path: resolve(coordinatorPath, ".gitkeep"),
    recipient: { host_id: "fixture-host", ...director },
    iteration_label: "v0.9.11 RC2 successor",
    purpose: "Cross-version successor reclamation",
    outcome: "Admit and reclaim the RC2 successor.",
    scope: ["Use the exact cancelled RC1 predecessor authority."],
    acceptance_criteria: ["RC2 successor reclamation completes."],
    constraints: [],
    reasons: [],
  });
  const successorPreparation = assertPackageSuccess(invokePackage(successorCli, [
    "assignment", "prepare", "--file", successorPreparationPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: director.thread_id }), "RC2 assignment preparation");
  const successorRoutePath = await jsonRequest(requests, "rc2-route", {
    run_id: successorRunId,
    sender_thread_id: coordinator.thread_id,
    preparation_id: successorPreparation.preparation.preparation_id,
  });
  const successor = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "report", "route", "coordinator", "--run-id", successorRunId,
    "--file", successorRoutePath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "RC2 successor admission");
  const successorAssignment = await assignmentAuthority({
    stateRoot: successor.state_root,
    assignmentId: successor.route.assignment.assignment_id,
  });
  assert.equal(successorAssignment.execution_bindings[0].namespace, "v0.9.11-rc.2");
  assert.notEqual(
    successorAssignment.repository_digest,
    cancelled.assignment.repository_digest,
    "the RC2 successor must admit after the completed RC1 baseline advanced",
  );
  const successorLocalStartPath = await jsonRequest(requests, "rc2-successor-local-start", {
    run_id: successorRunId,
    plan_id: successorPlan.plan_id,
    task_id: successorPlan.tasks[0].task_id,
    dependency_authorities: [],
  });
  const successorLocalWork = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "workflow", "local", "start", "--run-id", successorRunId,
    "--file", successorLocalStartPath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "RC2 successor useful work start");
  const successorLocalCompletePath = await jsonRequest(requests, "rc2-successor-local-complete", {
    run_id: successorRunId,
    local_work_id: successorLocalWork.local_work_id,
    checks: [{
      check_id: "rc2-successor-complete",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "workflow", "local", "complete", "--run-id", successorRunId,
    "--file", successorLocalCompletePath, "--json",
  ], coordinatorPath, { CODEX_THREAD_ID: coordinator.thread_id }), "RC2 successor useful work completion");
  const successorAudit = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "run", "audit", "--run-id", successorRunId, "--json",
  ], coordinatorPath), "RC2 successor run audit").audit;
  assert.equal(successorAudit.terminal_ready, true);
  const successorClosePath = await jsonRequest(requests, "rc2-successor-close", {
    run_id: successorRunId,
    resume: successorActivation.run.binding,
    audit_id: successorAudit.audit_id,
  });
  assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "run", "close", "--run-id", successorRunId,
    "--file", successorClosePath, "--json",
  ], coordinatorPath), "RC2 successor run close");
  const report = await acceptedFinal(
    successor,
    "v0911-cross-version-successor-final",
    "RC2 successor complete.",
    16_240,
  );
  git(primaryRoot, ["merge", "--ff-only", coordinatorBranch]);
  const activeObservationAt = Date.now();
  const pendingPath = await jsonRequest(requests, "rc2-accept-pending", {
    assignment_id: successorAssignment.assignment_id,
    report_id: report.report_id,
    task_observation: activeTaskObservation(coordinator.thread_id, activeObservationAt),
  });
  const pending = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "assignment", "accept", "--assignment-id", successorAssignment.assignment_id,
    "--file", pendingPath, "--json",
  ], primaryRoot, { CODEX_THREAD_ID: director.thread_id }), "RC2 pending closeout");
  assert.equal(pending.status, "closeout-pending");
  const retiredPath = await jsonRequest(requests, "rc2-accept-retired", {
    assignment_id: successorAssignment.assignment_id,
    report_id: report.report_id,
    task_observation: archivedTaskObservation(coordinator.thread_id, activeObservationAt + 1),
    host_result: hostResult(pending.closeout.host_request, "accepted"),
  });
  const retired = assertPackageSuccess(invokePackage(successorRuntimeCli, [
    "assignment", "accept", "--assignment-id", successorAssignment.assignment_id,
    "--file", retiredPath, "--json",
  ], primaryRoot, { CODEX_THREAD_ID: director.thread_id }), "RC2 successor reclamation");
  assert.equal(retired.status, "retired");
  assert.doesNotMatch(git(primaryRoot, ["worktree", "list", "--porcelain"]), new RegExp(
    coordinatorPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ));
});

for (const [label, successorOptions] of [
  ["another coordinator task", { senderThreadId: "different-coordinator-thread" }],
  ["another branch binding", { repositoryBranch: "codex/different-coordinator-branch" }],
]) {
  test(`successor admission rejects a cancelled checkout claimed by ${label}`, async (t) => {
    const predecessor = await fixture(t);
    const cancelled = await abandonAndCancelPredecessor(predecessor, TIME + 16_200);
    assert.equal(cancelled.status, "cancelled");
    await assert.rejects(
      registerSuccessorAssignment(predecessor, {
        suffix: label.replaceAll(" ", "-"),
        now: TIME + 16_400,
        ...successorOptions,
      }),
      /shared by another persisted member/,
    );
  });
}

test("successor admission rejects a still-active same-worktree membership", async (t) => {
  const predecessor = await fixture(t);
  const { run } = await readRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: predecessor.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "Keep the predecessor assignment active while checking successor admission.",
    abandonedAt: new Date(TIME + 16_600).toISOString(),
  });
  await assert.rejects(
    registerSuccessorAssignment(predecessor, {
      suffix: "active-predecessor",
      now: TIME + 16_700,
    }),
    /shared by another persisted member/,
  );
});

test("successor admission does not collide with a cancelled coordinator on another worktree", async (t) => {
  const predecessor = await fixture(t);
  const cancelled = await abandonAndCancelPredecessor(predecessor, TIME + 16_900);
  assert.equal(cancelled.status, "cancelled");
  const alternatePath = resolve(
    predecessor.primaryRoot,
    `../${basename(predecessor.primaryRoot)}-alternate-successor`,
  );
  const alternateBranch = "codex/alternate-successor";
  git(predecessor.primaryRoot, [
    "worktree", "add", "--quiet", "-b", alternateBranch, alternatePath,
  ]);
  try {
    const successor = await registerSuccessorAssignment(predecessor, {
      suffix: "alternate-worktree",
      repositoryRoot: alternatePath,
      repositoryBranch: alternateBranch,
      now: TIME + 17_100,
    });
    assert.equal(successor.status, "registered");
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", alternatePath], {
      cwd: predecessor.primaryRoot,
      encoding: "utf8",
    });
  }
});

test("concurrent member registration persists at most one owner for a worktree", async (t) => {
  const context = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const executorPath = resolve(
    context.primaryRoot,
    `../${basename(context.primaryRoot)}-concurrent-executor`,
  );
  const executorBranch = "codex/concurrent-executor-owner";
  git(context.primaryRoot, ["worktree", "add", "--quiet", "-b", executorBranch, executorPath]);
  const launch = (suffix) => ({
    launch_id: `task-launch-v1-concurrent-owner-${suffix}`,
    task_title: "Executor · v0.9.7 · Assignment reporting",
    coordinator_binding: { thread_id: context.coordinator.thread_id },
    start_claim: { executor_thread_id: `concurrent-owner-${suffix}` },
    creation_evidence: { host_id: "fixture-host" },
    git_activation: { worktree_path: executorPath, executor_branch: executorBranch },
  });
  try {
    const outcomes = await Promise.allSettled([
      registerExecutorIterationMember({
        assignment,
        launch: launch("first"),
        stateRoot: context.stateRoot,
        now: TIME + 17_300,
      }),
      registerExecutorIterationMember({
        assignment,
        launch: launch("second"),
        stateRoot: context.stateRoot,
        now: TIME + 17_301,
      }),
    ]);
    assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
    const persisted = await iterationStatus({
      commonDir: context.commonDir,
      iterationId: assignment.iteration_id,
    });
    assert.equal(
      persisted.members.filter((entry) => entry.worktree_path === executorPath).length,
      1,
    );
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", executorPath], {
      cwd: context.primaryRoot,
      encoding: "utf8",
    });
  }
});

test("repeated cancelled assignments leave one reclaimable same-owner successor", async (t) => {
  const first = await fixture(t);
  assert.equal((await abandonAndCancelPredecessor(first, TIME + 17_500)).status, "cancelled");
  const second = await registerSuccessorAssignment(first, {
    suffix: "repeated-second",
    now: TIME + 17_700,
  });
  const secondContext = {
    ...first,
    state_root: second.state_root,
    route: second.route,
    launch: { run_id: second.route.assignment.run_id },
  };
  assert.equal((await abandonAndCancelPredecessor(secondContext, TIME + 17_900)).status, "cancelled");

  const third = await registerSuccessorAssignment(first, {
    suffix: "repeated-third",
    now: TIME + 18_100,
  });
  const report = await acceptedFinal(
    third,
    "repeated-third-final",
    "The third same-owner assignment completed.",
    18_300,
  );
  await closeRun({
    gitCommonDirectory: first.commonDir,
    runId: third.activation.run.run_id,
    resume: third.activation.run.binding,
    closedAt: new Date(TIME + 18_350).toISOString(),
  });
  await installRepositoryReportLocator({
    stateRoot: third.state_root,
    route: third.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const retireLocator = ({ routeId, reason, now }) => retireRepositoryReportLocator({
    stateRoot: third.state_root,
    routeId,
    reason,
    now,
  });
  const pending = await acceptAssignmentResult({
    stateRoot: third.state_root,
    assignmentId: third.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: first.director.thread_id,
    taskObservation: activeTaskObservation(first.coordinator.thread_id, TIME + 18_400),
    retireLocator,
    now: TIME + 18_400,
  });
  assert.equal(pending.status, "closeout-pending");
  const retired = await acceptAssignmentResult({
    stateRoot: third.state_root,
    assignmentId: third.route.assignment.assignment_id,
    reportId: report.report_id,
    directorThreadId: first.director.thread_id,
    taskObservation: archivedTaskObservation(first.coordinator.thread_id, TIME + 18_500),
    hostResult: hostResult(pending.closeout.host_request, "accepted"),
    retireLocator,
    now: TIME + 18_500,
  });
  assert.equal(retired.status, "retired");
});

test("successor admission rejects an iteration cancelled before its reporting assignment settled", async (t) => {
  const predecessor = await fixture(t);
  const { run } = await readRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: predecessor.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: predecessor.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "Leave reporting unsettled while exercising the iteration guard.",
    abandonedAt: new Date(TIME + 16_600).toISOString(),
  });
  await installRepositoryReportLocator({
    stateRoot: predecessor.state_root,
    route: predecessor.route,
    packageRoot,
    nativeQueue: nativeQueue(),
  });
  const prematurelyCancelled = await cancelAssignmentResult({
    stateRoot: predecessor.state_root,
    assignmentId: predecessor.route.assignment.assignment_id,
    directorThreadId: predecessor.director.thread_id,
    reason: "Leave reporting unsettled while exercising the iteration guard.",
    retireLocator: async () => ({ status: "retired" }),
    now: TIME + 16_700,
  });
  assert.equal(prematurelyCancelled.status, "cancelled");
  await assert.rejects(
    registerSuccessorAssignment(predecessor, {
      suffix: "unsettled-reporting",
      now: TIME + 16_800,
    }),
    /shared by another persisted member/,
  );
});

test("assignment cancellation resumes safely after its route was closed before locator retirement", async (t) => {
  const child = await acceptedChildFixture(t, "failed-assignment-cancellation-retry", { deliveryBranch: true });
  const stateRoot = assignmentStateRoot(child.context.commonDir);
  const route = await reportRoute({ stateRoot, routeId: child.assignment.route_id });
  await closeoutAcceptedExecutor(child, { now: TIME + 15_500 });
  const { run } = await readRun({
    gitCommonDirectory: child.context.commonDir,
    runId: child.context.launch.run_id,
  });
  await abandonRun({
    gitCommonDirectory: child.context.commonDir,
    runId: run.run_id,
    resume: run.binding,
    reason: "The isolated fixture records an interrupted cancellation.",
    abandonedAt: new Date(TIME + 15_600).toISOString(),
  });
  await installRepositoryReportLocator({ stateRoot, route, packageRoot, nativeQueue: nativeQueue() });
  await closeReportRoute({ stateRoot, routeId: route.route_id, reason: "terminal", now: TIME + 15_700 });

  const resumed = await cancelAssignmentResult({
    stateRoot,
    assignmentId: child.assignment.assignment_id,
    directorThreadId: child.assignment.recipient.thread_id,
    reason: "The isolated fixture records an interrupted cancellation.",
    retireLocator: ({ routeId, reason, now }) => retireRepositoryReportLocator({ stateRoot, routeId, reason, now }),
    now: TIME + 15_800,
  });
  assert.equal(resumed.status, "cancelled");
  assert.equal(resumed.assignment.state, "cancelled");
  assert.equal(resumed.iteration.iteration.state, "cancelled");
});

test("assignment acceptance reclaims an exact archived coordinator before retiring reporting", async (t) => {
  const context = await fixture(t);
  const report = await acceptedFinal(context, "flow-owned-cleanup", "Complete.", 4_500);
  await closeRun({
    gitCommonDirectory: context.commonDir,
    runId: context.run.run_id,
    resume: context.run.binding,
    closedAt: new Date(TIME + 4_550).toISOString(),
  });
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

test("owning-host closeout uses a post-observer clock for automatic executor reconciliation", async (t) => {
  const { root, context, assignment, disposition } = await acceptedChildFixture(
    t,
    "automatic-executor-clock-boundary",
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId, TIME + 9_550),
    now: TIME + 9_550,
  });
  let observerCalls = 0;
  let clockCalls = 0;
  const completed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    hostResult: hostResult(prepared.host_request, "accepted"),
    observeArchivedThread: async ({ threadId }) => {
      observerCalls += 1;
      return archivedTaskObservation(threadId, TIME + 9_650);
    },
    clock: () => {
      clockCalls += 1;
      return TIME + 9_700;
    },
    now: TIME + 9_600,
  });
  assert.equal(completed.status, "phase-complete");
  assert.equal(observerCalls, 1);
  assert.equal(clockCalls, 1);
  const archive = await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  });
  assert.equal(archive.state, "completed");
  assert.equal(archive.updated_at, new Date(TIME + 9_700).toISOString());
  assert.equal(git(root, ["branch", "--list", context.executorBranch]), "");
});

test("owning-host closeout uses a post-observer clock for automatic coordinator completion", async (t) => {
  const context = await fixture(t);
  const assignment = await assignmentAuthority({
    stateRoot: context.state_root,
    assignmentId: context.route.assignment.assignment_id,
  });
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    taskObservation: activeTaskObservation(context.coordinator.thread_id, TIME + 9_750),
    now: TIME + 9_750,
  });
  let observerCalls = 0;
  let clockCalls = 0;
  const completed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    hostResult: hostResult(prepared.host_request, "accepted"),
    observeArchivedThread: async ({ threadId }) => {
      observerCalls += 1;
      return archivedTaskObservation(threadId, TIME + 9_850);
    },
    clock: () => {
      clockCalls += 1;
      return TIME + 9_900;
    },
    now: TIME + 9_800,
  });
  assert.equal(completed.status, "closed");
  assert.equal(observerCalls, 1);
  assert.equal(clockCalls, 1);
  const member = completed.iteration.members.find((entry) => entry.role === "coordinator");
  assert.equal(member.updated_at, new Date(TIME + 9_900).toISOString());
  assert.equal(completed.iteration.updated_at, new Date(TIME + 9_900).toISOString());
});

test("owning-host closeout keeps supplied evidence on its command-entry boundary", async (t) => {
  const { context, assignment, disposition } = await acceptedChildFixture(
    t,
    "supplied-executor-clock-boundary",
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId, TIME + 9_950),
    now: TIME + 9_950,
  });
  const completed = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: archivedTaskObservation(context.executorThreadId, TIME + 10_000),
    hostResult: hostResult(prepared.host_request, "accepted"),
    clock: () => { throw new Error("supplied evidence must not re-read the closeout clock"); },
    now: TIME + 10_050,
  });
  assert.equal(completed.status, "phase-complete");
  const archive = await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  });
  assert.equal(archive.updated_at, new Date(TIME + 10_050).toISOString());
});

test("owning-host closeout rejects an automatic observation stale at the post-observer boundary", async (t) => {
  const { context, assignment, disposition } = await acceptedChildFixture(
    t,
    "automatic-observer-stale-boundary",
  );
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    taskObservation: activeTaskObservation(context.executorThreadId, TIME + 10_100),
    now: TIME + 10_100,
  });
  const pending = await closeoutIterationWithOwningHost({
    commonDir: context.commonDir,
    iterationId: assignment.iteration_id,
    hostResult: hostResult(prepared.host_request, "accepted"),
    observeArchivedThread: async ({ threadId }) => archivedTaskObservation(threadId, TIME + 13_000),
    clock: () => TIME + 44_000,
    now: TIME + 10_200,
  });
  assert.equal(pending.status, "observation-required");
  const archive = await taskArchiveForDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
  });
  assert.equal(archive.state, "accepted-awaiting-observation");
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

for (const [label, integrationOutcome] of [
  ["no-change", null],
  ["ancestor integration", "ancestor"],
  ["patch-equivalent integration", "patch-equivalent"],
]) {
  test(`owning-host closeout preserves ${label} on its named delivery branch ahead of primary`, async (t) => {
    const child = await acceptedChildFixture(t, `delivery-owner-${label.replaceAll(" ", "-")}`, {
      deliveryBranch: true,
      integrationOutcome,
    });
    assert.notEqual(
      spawnSync("git", ["merge-base", "--is-ancestor", child.context.baseline, "main"], {
        cwd: child.root,
        encoding: "utf8",
      }).status,
      0,
    );

    const { closed } = await closeoutAcceptedExecutor(child, { now: TIME + 12_000 });
    assert.equal(closed.status, "phase-complete");
    assert.equal(Object.hasOwn(closed, "host_request"), false);
    assert.equal(git(child.root, ["branch", "--list", child.context.executorBranch]), "");
  });
}

for (const [label, mutateOwner] of [
  ["is absent", (child) => {
    git(child.root, ["worktree", "remove", "--force", child.coordinatorPath]);
    git(child.root, ["branch", "-D", child.coordinatorBranch]);
  }],
  ["rewinds away from the recorded delivery tip", (child) => {
    git(child.root, ["worktree", "remove", "--force", child.coordinatorPath]);
    git(child.root, ["branch", "-f", child.coordinatorBranch, "main"]);
  }],
]) {
  test(`owning-host closeout retains an executor branch when its no-change source ${label}`, async (t) => {
    const child = await acceptedChildFixture(t, `missing-owner-${label.replaceAll(" ", "-")}`, {
      deliveryBranch: true,
    });
    const prepared = await closeoutIterationWithOwningHost({
      commonDir: child.context.commonDir,
      iterationId: child.assignment.iteration_id,
      taskObservation: activeTaskObservation(child.context.executorThreadId),
      now: TIME + 13_000,
    });
    mutateOwner(child);

    await assert.rejects(
      closeoutIterationWithOwningHost({
        commonDir: child.context.commonDir,
        iterationId: child.assignment.iteration_id,
        taskObservation: archivedTaskObservation(child.context.executorThreadId, TIME + 13_100),
        hostResult: hostResult(prepared.host_request, "accepted"),
        now: TIME + 13_100,
      }),
      /No-change launch source preservation branch/,
    );
    assert.notEqual(git(child.root, ["branch", "--list", child.context.executorBranch]), "");
  });
}

test("serial integration rejects its disposable executor branch as the target owner", async (t) => {
  await assert.rejects(
    acceptedChildFixture(t, "executor-owner", {
      deliveryBranch: true,
      integrationOutcome: "ancestor",
      integrationTargetExecutor: true,
    }),
    /Integration target branch must differ from the disposable executor branch/,
  );
});

test("run-independent closeout completes an RC2-shaped archived absent-worktree executor without replaying archive", async (t) => {
  const child = await acceptedChildFixture(t, "rc2-shaped-recovery", { deliveryBranch: true });
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    taskObservation: activeTaskObservation(child.context.executorThreadId),
    now: TIME + 14_000,
  });
  const archive = await taskArchiveForDisposition({
    stateRoot: child.context.stateRoot,
    dispositionId: child.disposition.disposition_id,
  });
  git(child.root, ["worktree", "remove", "--force", child.context.executorPath]);
  const completedArchive = await reconcileTaskArchive({
    stateRoot: child.context.stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: archivedTaskObservation(child.context.executorThreadId, TIME + 14_100),
    now: TIME + 14_100,
  });
  assert.equal(completedArchive.state, "completed");
  assert.equal(git(child.root, ["branch", "--list", child.context.executorBranch]) !== "", true);

  const recovered = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    taskObservation: archivedTaskObservation(child.context.executorThreadId, TIME + 14_200),
    now: TIME + 14_200,
  });
  assert.equal(recovered.status, "phase-complete");
  assert.equal(Object.hasOwn(recovered, "host_request"), false);
  assert.equal(git(child.root, ["branch", "--list", child.context.executorBranch]), "");
});

test("RC3 CLI closes an archived RC2 namespace through its persisted assignment authority", async (t) => {
  const child = await acceptedChildFixture(t, "rc2-cross-version-cli", {
    deliveryBranch: true,
    stateNamespace: "v0.9.10-rc.2",
  });
  assert.equal(child.assignment.execution_bindings[0].namespace, "v0.9.10-rc.2");
  const recoveryNow = Date.now();
  const prepared = await closeoutIterationWithOwningHost({
    commonDir: child.context.commonDir,
    iterationId: child.assignment.iteration_id,
    taskObservation: activeTaskObservation(child.context.executorThreadId, recoveryNow - 200),
    now: recoveryNow - 200,
  });
  const archive = await taskArchiveForDisposition({
    stateRoot: child.context.stateRoot,
    dispositionId: child.disposition.disposition_id,
  });
  git(child.root, ["worktree", "remove", "--force", child.context.executorPath]);
  await reconcileTaskArchive({
    stateRoot: child.context.stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: archivedTaskObservation(child.context.executorThreadId, recoveryNow - 100),
    now: recoveryNow - 100,
  });

  const requestPath = resolve(child.coordinatorPath, "rc3-closeout-request.json");
  await writeFile(requestPath, `${JSON.stringify({
    assignment_id: child.assignment.assignment_id,
    phase: "coordinator",
    task_observation: archivedTaskObservation(child.context.executorThreadId, recoveryNow),
  })}\n`, "utf8");
  const result = spawnSync(process.execPath, [
    resolve(import.meta.dirname, "..", "bin", "codex-flow.mjs"),
    "assignment", "closeout",
    "--assignment-id", child.assignment.assignment_id,
    "--file", requestPath,
    "--json",
  ], {
    cwd: child.coordinatorPath,
    env: { ...process.env, CODEX_THREAD_ID: child.context.coordinator.thread_id },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const closed = JSON.parse(result.stdout);
  assert.equal(closed.status, "phase-complete");
  assert.equal(Object.hasOwn(closed, "host_request"), false);
  assert.equal(git(child.root, ["branch", "--list", child.context.executorBranch]), "");
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
