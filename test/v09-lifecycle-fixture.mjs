import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  prepareTaskLaunch,
  reconcileTaskLaunch,
  recordTaskLaunchAttempt,
  startTaskLaunch,
} from "../lib/core/task-launch.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal.mjs";
import {
  recipientBindingDigest,
  validateTerminalReceiptV4,
} from "../lib/task-results.mjs";
import { activateFixtureRun } from "./helpers.mjs";

const BASE_TIME = Date.parse("2026-09-04T12:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function workflowTask(suffix, overrides = {}) {
  return {
    task_id: `lifecycle-task-${suffix}`,
    title: `Execute v0.9 lifecycle task ${suffix}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded lifecycle fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Complete v0.9 lifecycle task ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Execute lifecycle task ${suffix} once.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

export async function createActiveTaskLaunch(root, suffix, {
  task = {},
  executorBranch = `codex/lifecycle-v09-${suffix}`,
  executorPath = resolve(root, `../${basename(root)}-${suffix}-executor`),
  reconcileCreation = true,
} = {}) {
  const commonDir = await realpath(resolve(root, ".git"));
  const stateRoot = resolve(commonDir, "codex-flow", "v0.9.0");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const coordinator = {
    lineage_id: `lifecycle-lineage-${suffix}`,
    thread_id: `lifecycle-coordinator-${suffix}`,
    generation: 1,
  };
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `lifecycle-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [workflowTask(suffix, task)],
  });
  const runId = `lifecycle-run-${suffix}`;
  const activated = await activateFixtureRun({
    root,
    runId,
    plan,
    branchFences: [executorBranch],
    lineage: coordinator,
    now: BASE_TIME - 3_000,
  });
  await bindRecipient({
    stateRoot,
    recipient: coordinator,
    fenceToken: activated.run.binding.fence_token,
  });
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: BASE_TIME - 2_000,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: plan.tasks[0].task_id,
    currentBaseline: { revision: baseline },
    dependencyAuthorities: [],
    now: BASE_TIME - 1_000,
  });
  const requestedSelectors = {
    project_id: `lifecycle-project-${suffix}`,
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: executorBranch,
      path: null,
    },
  };
  const prepared = await prepareTaskLaunch({
    stateRoot,
    taskContract: contract,
    requestedSelectors,
    now: BASE_TIME,
  });
  const attempted = await recordTaskLaunchAttempt({
    stateRoot,
    launchId: prepared.launch_id,
    hostSessionId: `lifecycle-session-${suffix}`,
    timeoutSeconds: 300,
    now: BASE_TIME + 1_000,
  });
  git(root, ["worktree", "add", "--quiet", "--detach", executorPath, baseline]);
  const executorThreadId = `lifecycle-executor-${suffix}`;
  const started = await startTaskLaunch({
    stateRoot,
    launchId: prepared.launch_id,
    launchNonce: prepared.launch_nonce,
    executorThreadId,
    repositoryPath: executorPath,
    now: BASE_TIME + 2_000,
  });
  const launch = reconcileCreation
    ? await reconcileTaskLaunch({
      stateRoot,
      launchId: prepared.launch_id,
      outcome: "ready",
      hostId: "local",
      readyThreadId: executorThreadId,
      selectorEvidence: {
        accepted: {
          project_id: requestedSelectors.project_id,
          model: requestedSelectors.model,
          reasoning_effort: requestedSelectors.reasoning_effort,
          observed_at: new Date(BASE_TIME + 2_500).toISOString(),
        },
        observed: null,
      },
      observedAt: new Date(BASE_TIME + 2_500).toISOString(),
      now: BASE_TIME + 2_500,
    })
    : started;
  return {
    root,
    stateRoot,
    commonDir,
    baseline,
    coordinator: {
      ...coordinator,
      binding_digest: coordinatorBindingDigest(coordinator),
    },
    plan,
    contract,
    requestedSelectors,
    executorBranch,
    executorPath,
    executorThreadId,
    attempted,
    launch,
  };
}

export function terminalReceiptV4(context, gitOutcome, {
  classification = "PASS",
  completedAt = "2026-09-04T12:00:06.000Z",
} = {}) {
  const selector = {
    model: context.requestedSelectors.model,
    reasoning_effort: context.requestedSelectors.reasoning_effort,
  };
  const recipient = {
    lineage_id: context.coordinator.lineage_id,
    thread_id: context.coordinator.thread_id,
    generation: context.coordinator.generation,
  };
  return validateTerminalReceiptV4({
    schema_version: 4,
    kind: "codex-flow-task-terminal-receipt-v4",
    recipient: {
      ...recipient,
      binding_digest: recipientBindingDigest(recipient),
    },
    executor_thread_id: context.executorThreadId,
    run_id: context.contract.run_id,
    runtime_context_digest: context.contract.runtime_context_digest,
    configuration_digest: context.contract.configuration_digest,
    repository_id: context.contract.repository_id,
    common_dir: context.contract.common_dir,
    plan_id: context.contract.plan_id,
    revision_digest: context.contract.revision_digest,
    task_id: context.contract.task_id,
    task_digest: context.contract.task_digest,
    contract_id: context.contract.contract_id,
    launch_id: context.launch.launch_id,
    classification,
    git_outcome: gitOutcome,
    model_evidence: {
      configured: selector,
      requested: selector,
      accepted: selector,
      observed: null,
    },
    result_or_blocker: classification === "PASS"
      ? "The exact v0.9 lifecycle task completed."
      : "The v0.9 lifecycle task stopped with preserved evidence.",
    next_decision: "Apply the exact coordinator disposition.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: completedAt,
  });
}
