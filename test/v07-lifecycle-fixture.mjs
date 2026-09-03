import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import {
  bindVisibleTaskWorktree,
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
} from "../lib/task-creation-v07.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal-v07.mjs";
import {
  recipientBindingDigest,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { activateV07FixtureRun } from "./helpers.mjs";

const BASE_TIME = Date.parse("2026-08-29T20:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function workflowTask(suffix, overrides = {}) {
  return {
    task_id: `lifecycle-task-${suffix}`,
    title: `Execute lifecycle task ${suffix}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Terra-xhigh is required for this multi-module lifecycle fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Complete lifecycle task ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Execute lifecycle task ${suffix} once.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

export async function createAcceptedVisibleTask(root, suffix, {
  task = {},
  executorBranch = `codex/lifecycle-${suffix}`,
  coordinator: requestedCoordinator = null,
  observedWorktreePath = null,
} = {}) {
  const commonDir = await realpath(resolve(root, ".git"));
  const stateRoot = resolve(commonDir, "codex-flow", "v0.8.1-dev.0");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const coordinator = requestedCoordinator === null
    ? {
        lineage_id: `lifecycle-lineage-${suffix}`,
        thread_id: `lifecycle-coordinator-${suffix}`,
        generation: 1,
      }
    : {
        lineage_id: requestedCoordinator.lineage_id,
        thread_id: requestedCoordinator.thread_id,
        generation: requestedCoordinator.generation,
  };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `lifecycle-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [workflowTask(suffix, task)],
  });
  const runId = `lifecycle-run-${suffix}`;
  const activated = await activateV07FixtureRun({
    root,
    runId,
    plan,
    branchFences: [executorBranch],
    lineage: {
      lineage_id: coordinator.lineage_id,
      thread_id: coordinator.thread_id,
      generation: coordinator.generation,
    },
    now: BASE_TIME - 3_000,
  });
  await bindRecipient({
    stateRoot,
    recipient: {
      lineage_id: coordinator.lineage_id,
      thread_id: coordinator.thread_id,
      generation: coordinator.generation,
    },
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
    worktree: observedWorktreePath === null
      ? {
        mode: "local",
        starting_revision: baseline,
        starting_branch: null,
        executor_branch: null,
        path: root,
      }
      : {
        mode: "host-worktree",
        starting_revision: baseline,
        starting_branch: "main",
        executor_branch: executorBranch,
        path: null,
      },
  };
  const creation = await prepareVisibleTaskCreation({
    stateRoot,
    taskContract: contract,
    requestedSelectors,
    now: BASE_TIME,
  });
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot,
    operationId: creation.operation_id,
    hostSessionId: `lifecycle-session-${suffix}`,
    timeoutSeconds: 300,
    now: BASE_TIME + 1_000,
  });
  const readyThreadId = `lifecycle-executor-${suffix}`;
  let finalCreation = await reconcileVisibleTaskCreation({
    stateRoot,
    operationId: creation.operation_id,
    outcome: "ready",
    readyThreadId,
    initialTurn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: `lifecycle-initial-turn-${suffix}`,
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(BASE_TIME + 2_000).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: requestedSelectors.worktree,
        accepted_at: new Date(BASE_TIME + 1_500).toISOString(),
      },
      observed: observedWorktreePath === null ? null : {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: {
          ...requestedSelectors.worktree,
          path: observedWorktreePath,
        },
        observed_at: new Date(BASE_TIME + 2_000).toISOString(),
      },
    },
    now: BASE_TIME + 2_000,
  });
  if (observedWorktreePath !== null) {
    finalCreation = await bindVisibleTaskWorktree({
      stateRoot,
      operationId: creation.operation_id,
      now: BASE_TIME + 2_500,
    });
  }
  const preparedRelease = await prepareTaskRelease({
    stateRoot,
    taskContract: contract,
    operationId: creation.operation_id,
    now: BASE_TIME + 3_000,
  });
  await reconcileTaskRelease({
    stateRoot,
    releaseId: preparedRelease.release_id,
    outcome: "sent",
    now: BASE_TIME + 4_000,
  });
  const release = await acceptTaskRelease({
    stateRoot,
    releaseId: preparedRelease.release_id,
    readyThreadId,
    contractId: contract.contract_id,
    runtimeContextDigest: contract.runtime_context_digest,
    commonDir,
    now: BASE_TIME + 5_000,
  });
  return {
    root,
    stateRoot,
    commonDir,
    baseline,
    coordinator,
    plan,
    contract,
    requestedSelectors,
    observedWorktreePath,
    creation: finalCreation,
    readyThreadId,
    release,
  };
}

export function terminalReceipt(context, gitOutcome, {
  classification = "PASS",
  completedAt = "2026-08-29T20:00:06.000Z",
} = {}) {
  const selector = {
    model: context.requestedSelectors.model,
    reasoning_effort: context.requestedSelectors.reasoning_effort,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: {
      lineage_id: context.coordinator.lineage_id,
      thread_id: context.coordinator.thread_id,
      generation: context.coordinator.generation,
      binding_digest: recipientBindingDigest({
        lineage_id: context.coordinator.lineage_id,
        thread_id: context.coordinator.thread_id,
        generation: context.coordinator.generation,
      }),
    },
    executor_thread_id: context.readyThreadId,
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
    operation_id: context.creation.operation_id,
    release_id: context.release.release_id,
    classification,
    git_outcome: gitOutcome,
    model_evidence: {
      configured: selector,
      requested: selector,
      accepted: selector,
      observed: context.observedWorktreePath === null ? null : selector,
    },
    result_or_blocker: classification === "PASS"
      ? "The exact lifecycle task completed."
      : "The lifecycle task is blocked with preserved evidence.",
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
