import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  auditRunClosure,
  closeRunFromAudit,
  readRunClosureAudit,
  runClosureAuditStatus,
  validateRunClosureAudit,
} from "../lib/run-audit-v06.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
} from "../lib/runtime-context.mjs";
import {
  admitRun,
  buildFencePlan,
  readRun,
  withActiveRunMutation,
} from "../lib/run-lifecycle.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
  reviseWorkflowJournal,
} from "../lib/workflow-journal-v06.mjs";
import {
  beginSubagentOperationAttempt,
  completeSubagentOperation,
  prepareSubagentOperation,
  reconcileSubagentOperationAttempt,
  recordSubagentCoordinatorDisposition,
} from "../lib/subagent-operations-v06.mjs";
import {
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
} from "../lib/task-creation-v06.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  expireUrgentSignalV06,
  persistUrgentSignalV06,
} from "../lib/urgent-signals-v06.mjs";
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import {
  cancelTaskBeforeExecution,
  finalizeTaskDisposition,
  prepareTaskDisposition,
} from "../lib/dispositions.mjs";
import { validateTerminalReceiptV3 } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications-v06.mjs";
import {
  archiveIdFor,
  prepareTaskArchive,
  reconcileTaskArchive,
} from "../lib/archive-lifecycle.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration-v06.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T19:00:00.000Z");
const digest = (character) => character.repeat(64);
const at = (offset) => START + offset;
const SUBAGENT_PROMPT = "Inspect the bounded source and return the exact generated contract result.";

async function reconcileCreatedSubagent({ stateRoot, operationId, agent_id, now = Date.now() }) {
  await beginSubagentOperationAttempt({
    stateRoot,
    operationId,
    prompt: SUBAGENT_PROMPT,
    timeoutSeconds: 300,
    now,
  });
  return reconcileSubagentOperationAttempt({
    stateRoot,
    operationId,
    outcome: "accepted",
    agent_id,
    now: now + 1,
  });
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function taskThread(suffix, overrides = {}) {
  return {
    task_id: `audit-task-${suffix}`,
    title: `Audit visible task ${suffix}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Use the implementation model lane for the visible audit task.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Complete visible audit task ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Attempt visible audit task ${suffix} once.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function subagentTask(suffix) {
  return {
    task_id: `audit-subagent-${suffix}`,
    title: `Audit native subagent ${suffix}`,
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Use the read-only model lane for the native audit subagent.",
    fork_turns: "3",
    dependencies: [],
    read_paths: ["README.md"],
    write_paths: [],
    shared_resources: [],
    primary_outcome: `Inspect bounded source for ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Read the bounded source for ${suffix}.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

async function runtimeBundle(t, suffix) {
  const packageRoot = await mkdtemp(resolve(tmpdir(), `codex-flow-audit-runtime-${suffix}-`));
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  const files = new Map([
    ["bin/codex-flow.mjs", "#!/usr/bin/env node\n"],
    ["lib/runtime.mjs", "export const runtime = true;\n"],
    ["schemas/runtime.schema.json", "{}\n"],
    ["templates/roles/coordinator.md", "Coordinator role.\n"],
    ["templates/references/lifecycle.md", "Lifecycle reference.\n"],
  ]);
  for (const [relativePath, contents] of files) {
    const path = resolve(packageRoot, relativePath);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return loadRuntimeBundleSource({ packageRoot });
}

async function runFixture(t, suffix, task, { branchFences = [] } = {}) {
  const root = await createGitFixture(`codex-flow-v06-run-audit-${suffix}-`);
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.4");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const coordinator = {
    lineage_id: `audit-lineage-${suffix}`,
    thread_id: `audit-coordinator-${suffix}`,
    generation: 1,
  };
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `audit-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [task],
  });
  await createWorkflowJournal({
    stateRoot,
    runId: `audit-run-${suffix}`,
    planId: plan.plan_id,
    planRevision: plan,
    now: at(1_000),
  });
  const bundleSource = await runtimeBundle(t, suffix);
  const context = buildRuntimeContext({
    bundle: bundleSource.bundle,
    createdAt: new Date(at(2_000)).toISOString(),
    config: {
      config_id: "audit-runtime-config-v1",
      snapshot: { model_routing: "explicit" },
    },
    policy: {
      policy_id: "audit-runtime-policy-v1",
      snapshot: { callbacks: "journaled", urgent: "direct" },
    },
    repository: {
      common_dir: commonDir,
      root,
      branch: "main",
      revision: baseline,
    },
    host: {
      host_id: `audit-host-${suffix}`,
      session_id: `audit-session-${suffix}`,
    },
    lineage: coordinator,
  });
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context,
    bundleSource,
  });
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: `audit-run-${suffix}`,
    runtimeId: context.runtime_id,
    workflowPlanId: plan.plan_id,
    workflowRevisionDigest: plan.revision_digest,
    plan: buildFencePlan({
      pathFences: task.write_paths,
      resourceFences: task.shared_resources,
      branchFences,
    }),
    admittedAt: new Date(at(3_000)).toISOString(),
  });
  await bindRecipient({
    stateRoot,
    recipient: coordinator,
    fenceToken: admitted.run.binding.fence_token,
  });
  const coordinatorBinding = {
    ...coordinator,
    binding_digest: coordinatorBindingDigest(coordinator),
  };
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId: admitted.run.run_id,
    planId: plan.plan_id,
    taskId: task.task_id,
    currentBaseline: { revision: baseline },
    dependencyAuthorities: [],
    now: at(4_000),
  });
  assert.equal(contract.repository_id, admitted.run.binding.repository_hash);
  return {
    root,
    commonDir,
    stateRoot,
    baseline,
    coordinator,
    coordinatorBinding,
    plan,
    admitted,
    contract,
  };
}

function blockerCodes(result) {
  return new Set(result.audit.blockers.map((blocker) => blocker.code));
}

async function audit(context, offset = 100_000) {
  return auditRunClosure({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    now: at(offset),
  });
}

async function completeRejectedSubagent(context, suffix, offset = 20_000) {
  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    fork_turns: context.contract.task.fork_turns,
    mode: "read",
    prompt_digest: sha256(SUBAGENT_PROMPT),
    worktree_path: context.root,
    now: at(offset),
  });
  await reconcileCreatedSubagent({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    agent_id: `audit-agent-${suffix}`,
    now: at(offset + 1_000),
  });
  await completeSubagentOperation({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    classification: "FAIL",
    summary: `The bounded ${suffix} operation reached a terminal rejected result.`,
    evidence_digests: [],
    now: at(offset + 2_000),
  });
  await recordSubagentCoordinatorDisposition({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    disposition: "rejected",
    now: at(offset + 3_000),
  });
  return operation;
}

async function prepareVisible(context, suffix, { ready = false } = {}) {
  const requested = {
    project_id: `audit-project-${suffix}`,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    worktree: {
      mode: "local",
      starting_revision: context.baseline,
      starting_branch: null,
      executor_branch: null,
      path: context.root,
    },
  };
  const creation = await prepareVisibleTaskCreation({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    requestedSelectors: requested,
    now: at(5_000),
  });
  if (!ready) return { creation, requested };
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot: context.stateRoot,
    operationId: creation.operation_id,
    hostSessionId: `visible-host-session-${suffix}`,
    timeoutSeconds: 300,
    now: at(6_000),
  });
  const readyThreadId = `audit-executor-${suffix}`;
  await reconcileVisibleTaskCreation({
    stateRoot: context.stateRoot,
    operationId: creation.operation_id,
    outcome: "ready",
    readyThreadId,
    initialTurn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: `audit-turn-${suffix}`,
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(at(7_000)).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        ...requested,
        accepted_at: new Date(at(6_500)).toISOString(),
      },
      observed: null,
    },
    now: at(7_000),
  });
  return { creation, requested, attempt, readyThreadId };
}

async function prepareHostVisible(context, suffix, { executorBranch, worktreePath }) {
  const requested = {
    project_id: `audit-project-${suffix}`,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: context.baseline,
      starting_branch: "main",
      executor_branch: executorBranch,
      path: null,
    },
  };
  const creation = await prepareVisibleTaskCreation({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    requestedSelectors: requested,
    now: at(5_000),
  });
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot: context.stateRoot,
    operationId: creation.operation_id,
    hostSessionId: `visible-host-session-${suffix}`,
    timeoutSeconds: 300,
    now: at(6_000),
  });
  git(context.root, ["worktree", "add", "-q", "-b", executorBranch, worktreePath, "main"]);
  const observedPath = await realpath(worktreePath);
  const readyThreadId = `audit-executor-${suffix}`;
  await reconcileVisibleTaskCreation({
    stateRoot: context.stateRoot,
    operationId: creation.operation_id,
    outcome: "ready",
    readyThreadId,
    initialTurn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: `audit-turn-${suffix}`,
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(at(7_000)).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        ...requested,
        accepted_at: new Date(at(6_500)).toISOString(),
      },
      observed: {
        project_id: requested.project_id,
        model: requested.model,
        reasoning_effort: requested.reasoning_effort,
        worktree: { ...requested.worktree, path: observedPath },
        observed_at: new Date(at(7_000)).toISOString(),
      },
    },
    now: at(7_000),
  });
  return { creation, requested, attempt, readyThreadId, observedPath };
}

async function acceptRelease(context, visible, suffix) {
  const prepared = await prepareTaskRelease({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    operationId: visible.creation.operation_id,
    now: at(8_000),
  });
  await reconcileTaskRelease({
    stateRoot: context.stateRoot,
    releaseId: prepared.release_id,
    outcome: "sent",
    now: at(9_000),
  });
  const release = await acceptTaskRelease({
    stateRoot: context.stateRoot,
    releaseId: prepared.release_id,
    readyThreadId: visible.readyThreadId,
    contractId: context.contract.contract_id,
    runtimeContextDigest: context.contract.runtime_context_digest,
    commonDir: context.commonDir,
    now: at(10_000),
  });
  await bindRecipient({ stateRoot: context.stateRoot, recipient: context.coordinator });
  return { prepared, release, suffix };
}

function receipt(context, visible, release, gitOutcome, classification = "PASS") {
  const selector = {
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: context.coordinatorBinding,
    executor_thread_id: visible.readyThreadId,
    run_id: context.contract.run_id,
    runtime_context_digest: context.contract.runtime_context_digest,
    configuration_digest: context.contract.configuration_digest,
    repository_id: context.contract.repository_id,
    common_dir: context.commonDir,
    plan_id: context.contract.plan_id,
    revision_digest: context.contract.revision_digest,
    task_id: context.contract.task_id,
    task_digest: context.contract.task_digest,
    contract_id: context.contract.contract_id,
    operation_id: visible.creation.operation_id,
    release_id: release.prepared.release_id,
    classification,
    git_outcome: gitOutcome,
    model_evidence: {
      configured: selector,
      requested: selector,
      accepted: selector,
      observed: null,
    },
    result_or_blocker: classification === "PASS"
      ? "The exact visible task completed."
      : "The exact visible task returned a durable blocker.",
    next_decision: "Apply the exact coordinator disposition.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: new Date(at(11_000)).toISOString(),
  });
}

test("terminal subagent authority produces one idempotent closure proof and stale proofs cannot close", async (t) => {
  const context = await runFixture(t, "subagent", subagentTask("subagent"));
  const unstarted = await audit(context);
  assert.equal(unstarted.audit.terminal_ready, false);
  assert(blockerCodes(unstarted).has("current-unstarted-claim"));

  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    fork_turns: context.contract.task.fork_turns,
    mode: "read",
    prompt_digest: sha256(SUBAGENT_PROMPT),
    worktree_path: context.root,
    now: at(12_000),
  });
  assert(blockerCodes(await audit(context, 101_000)).has("subagent-incomplete"));
  await reconcileCreatedSubagent({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    agent_id: "audit-native-agent",
    now: at(13_000),
  });
  await completeSubagentOperation({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    classification: "BLOCKED",
    summary: "The bounded source does not establish the requested fact.",
    evidence_digests: [],
    now: at(14_000),
  });
  assert(blockerCodes(await audit(context, 102_000)).has("subagent-incomplete"));
  await recordSubagentCoordinatorDisposition({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    disposition: "rejected",
    now: at(15_000),
  });
  const completed = await audit(context, 103_000);
  assert.equal(completed.audit.terminal_ready, true, JSON.stringify(completed.audit.blockers));
  assert.deepEqual(validateRunClosureAudit(completed.audit), completed.audit);
  const replay = await audit(context, 104_000);
  assert.equal(replay.status, "existing");
  assert.equal(replay.audit.audit_id, completed.audit.audit_id);
  assert.equal(replay.audit.audited_at, completed.audit.audited_at);
  assert.equal((await runClosureAuditStatus({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    auditId: completed.audit.audit_id,
  })).close_permitted, true);
  await assert.rejects(
    readRunClosureAudit({
      stateRoot: context.stateRoot,
      runId: "different-run",
      auditId: completed.audit.audit_id,
    }),
    /does not belong to the explicit runId/,
  );

  const nextTask = subagentTask("later");
  await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    planId: context.plan.plan_id,
    draft: {
      schema_version: 1,
      plan_id: context.plan.plan_id,
      revision: 2,
      parent_revision_digest: context.plan.revision_digest,
      tasks: [context.plan.tasks[0], nextTask],
    },
    now: at(16_000),
  });
  await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    planId: context.plan.plan_id,
    taskId: nextTask.task_id,
    currentBaseline: { revision: context.baseline },
    dependencyAuthorities: [],
    now: at(17_000),
  });
  const stale = await runClosureAuditStatus({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    auditId: completed.audit.audit_id,
  });
  assert.equal(stale.current, false);
  assert.equal(stale.close_permitted, false);
  assert(stale.blockers.some((blocker) => blocker.code === "current-unstarted-claim"));
  assert.deepEqual((await readRunClosureAudit({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    auditId: completed.audit.audit_id,
  })).audit, completed.audit);
});

test("active-run mutation authority serializes commands and closes only from a current audit", async (t) => {
  const context = await runFixture(t, "atomic-close", subagentTask("atomic-close"));
  await completeRejectedSubagent(context, "atomic-close");
  const terminal = await audit(context, 120_000);
  assert.equal(terminal.audit.terminal_ready, true);

  let releaseMutation;
  let mutationStarted;
  const release = new Promise((resolvePromise) => { releaseMutation = resolvePromise; });
  const started = new Promise((resolvePromise) => { mutationStarted = resolvePromise; });
  const holding = withActiveRunMutation({
    gitCommonDirectory: context.commonDir,
    runId: context.admitted.run.run_id,
  }, async ({ run, commonDir, path }) => {
    assert.equal(run.run_id, context.admitted.run.run_id);
    assert.equal(commonDir, context.commonDir);
    assert.equal(path, resolve(context.stateRoot, "runs", "lifecycle.json"));
    mutationStarted();
    await release;
    return run.run_id;
  });
  await started;
  await assert.rejects(
    withActiveRunMutation({
      gitCommonDirectory: context.commonDir,
      runId: context.admitted.run.run_id,
    }, async () => null),
    /active run mutation .* already in progress/,
  );
  releaseMutation();
  assert.equal(await holding, context.admitted.run.run_id);

  const closed = await closeRunFromAudit({
    stateRoot: context.stateRoot,
    gitCommonDirectory: context.commonDir,
    runId: context.admitted.run.run_id,
    resume: context.admitted.run.binding,
    auditId: terminal.audit.audit_id,
    closedAt: new Date(at(130_000)).toISOString(),
  });
  assert.equal(closed.run.status, "closed");
  assert.equal((await readRun({
    gitCommonDirectory: context.commonDir,
    runId: context.admitted.run.run_id,
  })).run.status, "closed");
  await assert.rejects(
    withActiveRunMutation({
      gitCommonDirectory: context.commonDir,
      runId: context.admitted.run.run_id,
    }, async () => null),
    /is not active/,
  );
});

test("closure evidence binds live Git state and stales on dirt or baseline drift", async (t) => {
  const context = await runFixture(t, "git-drift", subagentTask("git-drift"));
  await completeRejectedSubagent(context, "git-drift");
  const terminal = await audit(context, 120_000);
  assert.equal(terminal.audit.terminal_ready, true);
  assert.equal(terminal.audit.repository.expected_source, "activation-baseline");
  assert.equal(terminal.audit.repository.head_revision, context.baseline);
  assert.equal(terminal.audit.repository.branch, "main");
  assert.equal(terminal.audit.repository.cleanliness, "clean");

  const dirtyPath = resolve(context.root, "untracked-after-audit.txt");
  await writeFile(dirtyPath, "dirty\n", "utf8");
  const dirtyStatus = await runClosureAuditStatus({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    auditId: terminal.audit.audit_id,
  });
  assert.equal(dirtyStatus.current, false);
  assert.equal(dirtyStatus.close_permitted, false);
  assert(dirtyStatus.blockers.some((blocker) => blocker.code === "repository-dirty"));
  await assert.rejects(closeRunFromAudit({
    stateRoot: context.stateRoot,
    runId: context.admitted.run.run_id,
    resume: context.admitted.run.binding,
    auditId: terminal.audit.audit_id,
    closedAt: new Date(at(130_000)).toISOString(),
  }), /current terminal-ready/);

  git(context.root, ["add", "untracked-after-audit.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "post-audit drift"]);
  const drifted = await audit(context, 131_000);
  assert.equal(drifted.audit.repository.cleanliness, "clean");
  assert.equal(drifted.audit.terminal_ready, false);
  assert(blockerCodes(drifted).has("repository-drift"));
  assert.notEqual(drifted.audit.audit_id, terminal.audit.audit_id);
});

test("audit fails closed on persisted audit tampering", async (t) => {
  const context = await runFixture(t, "tamper", subagentTask("tamper"));
  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    fork_turns: context.contract.task.fork_turns,
    mode: "read",
    prompt_digest: sha256(SUBAGENT_PROMPT),
    worktree_path: context.root,
  });
  await reconcileCreatedSubagent({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    agent_id: "audit-tamper-agent",
  });
  await completeSubagentOperation({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    classification: "FAIL",
    summary: "The read-only audit failed with durable evidence.",
    evidence_digests: [],
  });
  await recordSubagentCoordinatorDisposition({
    stateRoot: context.stateRoot,
    operationId: operation.operation_id,
    disposition: "rejected",
  });
  const completed = await audit(context);
  const raw = JSON.parse(await readFile(completed.path, "utf8"));
  raw.audited_at = "2026-08-29T23:59:59.000Z";
  await writeFile(completed.path, `${JSON.stringify(raw)}\n`, "utf8");
  await assert.rejects(
    readRunClosureAudit({
      stateRoot: context.stateRoot,
      runId: context.admitted.run.run_id,
      auditId: completed.audit.audit_id,
    }),
    /record digest is invalid/,
  );
});

test("closure binds the exact active recipient fence", async (t) => {
  const context = await runFixture(t, "recipient-drift", subagentTask("recipient-drift"));
  await completeRejectedSubagent(context, "recipient-drift");
  let result = await audit(context);
  assert.equal(result.audit.terminal_ready, true);

  const registryPath = resolve(
    context.stateRoot,
    "recipients",
    "bindings",
    `${context.coordinator.lineage_id}.json`,
  );
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  registry.current.thread_id = "different-coordinator";
  registry.bindings.at(-1).thread_id = "different-coordinator";
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  result = await audit(context, 101_000);
  assert.equal(result.audit.terminal_ready, false);
  assert(blockerCodes(result).has("recipient-binding-drift"));
});

test("an unresolved urgent interrupt blocks closure until durably expired", async (t) => {
  const context = await runFixture(t, "urgent-closure", taskThread("urgent-closure"));
  const visible = await prepareVisible(context, "urgent-closure", { ready: true });
  const release = await acceptRelease(context, visible, "urgent-closure");
  const persisted = await persistUrgentSignalV06({
    stateRoot: context.stateRoot,
    signal: {
      schema_version: 1,
      recipient: context.coordinator,
      executor_id: visible.readyThreadId,
      run_id: context.admitted.run.run_id,
      sequence: 1,
      supersedes_urgent_ids: [],
      expires_at: new Date(at(12_000)).toISOString(),
      classification: "high-risk-drift",
      summary: "A bounded authority mismatch requires immediate coordinator attention.",
      requested_action: "Resolve the exact mismatch before continuing the run.",
    },
    now: at(11_000),
  });

  let result = await audit(context, 101_000);
  assert(blockerCodes(result).has("urgent-unresolved"));
  assert.equal(result.audit.counts.urgent_signals, 1);
  await expireUrgentSignalV06({
    stateRoot: context.stateRoot,
    urgentId: persisted.urgent_id,
    now: at(13_000),
  });
  result = await audit(context, 102_000);
  assert.equal(blockerCodes(result).has("urgent-unresolved"), false);
  assert(blockerCodes(result).has("callback-missing"));
  assert.equal(release.prepared.task_id, context.contract.task_id);
});

test("visible creation reports in-flight, ambiguous, and session-blocked host authority", async (t) => {
  for (const [suffix, outcome, reasonCode, expected] of [
    ["ambiguous", "ambiguous", "host-result-ambiguous", "visible-creation-ambiguous"],
    ["session", "session-blocked", "backend-unavailable", "visible-creation-session-blocked"],
  ]) {
    const context = await runFixture(t, suffix, taskThread(suffix));
    const visible = await prepareVisible(context, suffix);
    assert(blockerCodes(await audit(context)).has("visible-creation-in-flight"));
    await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: visible.creation.operation_id,
      hostSessionId: `audit-${suffix}-session`,
      timeoutSeconds: 300,
      now: at(6_000),
    });
    await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: visible.creation.operation_id,
      outcome,
      reasonCode,
      now: at(7_000),
    });
    const result = await audit(context, 101_000);
    assert.equal(result.audit.terminal_ready, false);
    assert(blockerCodes(result).has(expected));
  }
});

test("non-created closes while rejected, blocked, and cancelled visible paths retain closure fences", async (t) => {
  const notCreated = await runFixture(t, "not-created", taskThread("not-created"));
  const notCreatedVisible = await prepareVisible(notCreated, "not-created");
  await recordVisibleTaskCreationAttempt({
    stateRoot: notCreated.stateRoot,
    operationId: notCreatedVisible.creation.operation_id,
    hostSessionId: "audit-not-created-session",
    timeoutSeconds: 300,
    now: at(6_000),
  });
  await reconcileVisibleTaskCreation({
    stateRoot: notCreated.stateRoot,
    operationId: notCreatedVisible.creation.operation_id,
    outcome: "not-created",
    reasonCode: "create-returned-not-created",
    now: at(7_000),
  });
  const notCreatedAudit = await audit(notCreated);
  assert.equal(
    notCreatedAudit.audit.terminal_ready,
    true,
    JSON.stringify(notCreatedAudit.audit.blockers),
  );

  const blocked = await runFixture(t, "retained-blocked", taskThread("retained-blocked"));
  const blockedVisible = await prepareVisible(blocked, "retained-blocked", { ready: true });
  const blockedRelease = await acceptRelease(blocked, blockedVisible, "retained-blocked");
  const blockedReceipt = receipt(blocked, blockedVisible, blockedRelease, {
    kind: "unchanged",
    baseline_revision: blocked.baseline,
    final_revision: blocked.baseline,
    branch: "main",
    upstream: null,
    cleanliness: "clean",
  }, "BLOCKED");
  const delivered = await deliverCallbackV06({
    stateRoot: blocked.stateRoot,
    receipt: blockedReceipt,
  });
  await observeCallbackV06({
    stateRoot: blocked.stateRoot,
    callbackId: delivered.callback_id,
    recipient: blocked.coordinator,
  });
  const blockedDisposition = await prepareTaskDisposition({
    stateRoot: blocked.stateRoot,
    callbackId: delivered.callback_id,
    decision: "retained-blocked",
    reason: "The durable blocker must remain visible to the coordinator.",
  });
  await finalizeTaskDisposition({
    stateRoot: blocked.stateRoot,
    dispositionId: blockedDisposition.disposition_id,
    recipient: blocked.coordinator,
    executorThreadId: blockedVisible.readyThreadId,
  });
  const blockedAudit = await audit(blocked, 101_000);
  assert.equal(blockedAudit.audit.terminal_ready, false);
  assert(blockerCodes(blockedAudit).has("retained-visible-task"));
  assert.equal(blockedAudit.audit.counts.archives, 0);

  const rejected = await runFixture(t, "rejected", taskThread("rejected"));
  const rejectedVisible = await prepareVisible(rejected, "rejected", { ready: true });
  const rejectedRelease = await acceptRelease(rejected, rejectedVisible, "rejected");
  const rejectedReceipt = receipt(rejected, rejectedVisible, rejectedRelease, {
    kind: "unchanged",
    baseline_revision: rejected.baseline,
    final_revision: rejected.baseline,
    branch: "main",
    upstream: null,
    cleanliness: "clean",
  });
  const rejectedCallback = await deliverCallbackV06({
    stateRoot: rejected.stateRoot,
    receipt: rejectedReceipt,
  });
  await observeCallbackV06({
    stateRoot: rejected.stateRoot,
    callbackId: rejectedCallback.callback_id,
    recipient: rejected.coordinator,
  });
  const rejectedDisposition = await prepareTaskDisposition({
    stateRoot: rejected.stateRoot,
    callbackId: rejectedCallback.callback_id,
    decision: "rejected",
    reason: "The coordinator rejected the otherwise clean result.",
  });
  await finalizeTaskDisposition({
    stateRoot: rejected.stateRoot,
    dispositionId: rejectedDisposition.disposition_id,
    recipient: rejected.coordinator,
    executorThreadId: rejectedVisible.readyThreadId,
  });
  const rejectedAudit = await audit(rejected, 101_500);
  assert.equal(rejectedAudit.audit.terminal_ready, false);
  assert(blockerCodes(rejectedAudit).has("retained-visible-task"));
  assert.equal(rejectedAudit.audit.counts.archives, 0);

  const cancelled = await runFixture(t, "cancelled", taskThread("cancelled"));
  const cancelledVisible = await prepareVisible(cancelled, "cancelled", { ready: true });
  const cancelledRelease = await prepareTaskRelease({
    stateRoot: cancelled.stateRoot,
    taskContract: cancelled.contract,
    operationId: cancelledVisible.creation.operation_id,
    now: at(8_000),
  });
  await reconcileTaskRelease({
    stateRoot: cancelled.stateRoot,
    releaseId: cancelledRelease.release_id,
    outcome: "rejected-before-send",
    now: at(9_000),
  });
  await cancelTaskBeforeExecution({
    stateRoot: cancelled.stateRoot,
    releaseId: cancelledRelease.release_id,
    reason: "The coordinator durably cancelled before objective delivery.",
    now: at(10_000),
  });
  const cancelledAudit = await audit(cancelled, 102_000);
  assert.equal(cancelledAudit.audit.terminal_ready, false);
  assert(blockerCodes(cancelledAudit).has("retained-visible-task"));
  assert.equal(cancelledAudit.audit.counts.archives, 0);
});

test("accepted no-change task advances through release, callback, proof, disposition, and archive gates", async (t) => {
  const context = await runFixture(t, "visible", taskThread("visible"));
  const visible = await prepareVisible(context, "visible", { ready: true });
  assert(blockerCodes(await audit(context)).has("release-missing"));

  const preparedRelease = await prepareTaskRelease({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    operationId: visible.creation.operation_id,
    now: at(8_000),
  });
  assert(blockerCodes(await audit(context, 101_000)).has("release-unaccepted"));
  await reconcileTaskRelease({
    stateRoot: context.stateRoot,
    releaseId: preparedRelease.release_id,
    outcome: "sent",
    now: at(9_000),
  });
  await acceptTaskRelease({
    stateRoot: context.stateRoot,
    releaseId: preparedRelease.release_id,
    readyThreadId: visible.readyThreadId,
    contractId: context.contract.contract_id,
    runtimeContextDigest: context.contract.runtime_context_digest,
    commonDir: context.commonDir,
    now: at(10_000),
  });
  await bindRecipient({ stateRoot: context.stateRoot, recipient: context.coordinator });
  assert(blockerCodes(await audit(context, 102_000)).has("callback-missing"));

  const release = { prepared: preparedRelease };
  const payload = receipt(context, visible, release, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: "main",
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  let result = await audit(context, 103_000);
  assert(blockerCodes(result).has("callback-unconsumed"));
  assert(blockerCodes(result).has("disposition-missing"));
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: context.coordinator,
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-no-change",
    reason: "The task remained clean at the exact authenticated baseline.",
    now: at(12_000),
  });
  result = await audit(context, 104_000);
  assert(blockerCodes(result).has("disposition-unfinalized"));
  assert(blockerCodes(result).has("verification-missing"));

  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    receipt: payload,
    checks: [{
      check_id: "run-audit-no-change",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  result = await audit(context, 105_000);
  assert(blockerCodes(result).has("disposition-unfinalized"));
  assert.equal(blockerCodes(result).has("verification-missing"), false);
  const completedDisposition = await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: context.coordinator,
    executorThreadId: visible.readyThreadId,
    verificationId: verification.verification_id,
    now: at(13_000),
  });
  result = await audit(context, 106_000);
  assert(blockerCodes(result).has("archive-missing"));

  const archive = await prepareTaskArchive({
    stateRoot: context.stateRoot,
    dispositionId: completedDisposition.disposition_id,
    taskObservation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
    hostId: "local",
    now: at(14_000),
  });
  result = await audit(context, 107_000);
  assert(blockerCodes(result).has("archive-incomplete"));
  await reconcileTaskArchive({
    stateRoot: context.stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: false,
      archived_visible: true,
    },
    now: at(15_000),
  });
  const terminal = await audit(context, 108_000);
  assert.equal(terminal.audit.terminal_ready, true);
  assert.deepEqual(terminal.audit.blockers, []);
  assert.equal(terminal.audit.counts.archives, 1);
  assert.equal(terminal.audit.repository.expected_source, "activation-baseline");
  assert.equal(terminal.audit.repository.expected_verification_id, null);

  const archivePath = resolve(
    context.stateRoot,
    "archives",
    "records",
    `${archive.archive_id}.json`,
  );
  const tamperedArchive = {
    ...JSON.parse(await readFile(archivePath, "utf8")),
    archive_id: "pending",
    callback_id: "mismatched-callback",
  };
  tamperedArchive.host_intent.attempt_id = "pending";
  tamperedArchive.archive_id = archiveIdFor(tamperedArchive);
  tamperedArchive.host_intent.attempt_id = `archive-attempt-v1-${sha256(
    tamperedArchive.archive_id,
  )}`;
  await rm(archivePath);
  await writeFile(
    resolve(
      context.stateRoot,
      "archives",
      "records",
      `${tamperedArchive.archive_id}.json`,
    ),
    `${JSON.stringify(tamperedArchive, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    audit(context, 109_000),
    /exact callback authority/,
  );
});

test("archived host-worktree no-change proof leaves coordinator authority at activation baseline", async (t) => {
  const executorBranch = "codex/run-audit-no-change-cleanup";
  const context = await runFixture(
    t,
    "host-no-change",
    taskThread("host-no-change", { write_paths: ["host-no-change.txt"] }),
    { branchFences: [executorBranch] },
  );
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-run-audit-no-change-"));
  const worktreePath = resolve(worktreeParent, "executor");
  t.after(async () => {
    if (await realpath(worktreePath).catch(() => null)) {
      try {
        git(context.root, ["worktree", "remove", "--force", worktreePath]);
      } catch {
        // Fixture teardown only; assertions below cover the authoritative path.
      }
    }
    await rm(worktreeParent, { recursive: true, force: true });
  });

  const visible = await prepareHostVisible(context, "host-no-change", {
    executorBranch,
    worktreePath,
  });
  const release = await acceptRelease(context, visible, "host-no-change");
  const payload = receipt(context, visible, release, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  payload.model_evidence.observed = {
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
  };
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: context.coordinator,
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-no-change",
    reason: "The exact host-worktree remained clean at its authenticated baseline.",
  });
  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: worktreePath,
    receipt: payload,
    checks: [{
      check_id: "run-audit-host-no-change",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  const completedDisposition = await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: context.coordinator,
    executorThreadId: visible.readyThreadId,
    verificationId: verification.verification_id,
  });
  git(context.root, ["worktree", "remove", worktreePath]);
  const archive = await prepareTaskArchive({
    stateRoot: context.stateRoot,
    dispositionId: completedDisposition.disposition_id,
    taskObservation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
    hostId: "local",
  });
  await reconcileTaskArchive({
    stateRoot: context.stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: false,
      archived_visible: true,
    },
  });

  const retained = await audit(context, 120_000);
  assert.equal(retained.audit.repository.expected_source, "activation-baseline");
  assert.equal(retained.audit.repository.expected_verification_id, null);
  assert.equal(retained.audit.repository.head_revision, context.baseline);
  assert.equal(retained.audit.repository.branch, "main");
  assert.deepEqual([...blockerCodes(retained)], ["cleanup-unresolved"]);

  git(context.root, ["branch", "-d", executorBranch]);
  const terminal = await audit(context, 121_000);
  assert.equal(terminal.audit.terminal_ready, true, JSON.stringify(terminal.audit.blockers));
  assert.deepEqual(terminal.audit.blockers, []);

  const dirtyPath = resolve(context.root, "host-no-change-dirty.txt");
  await writeFile(dirtyPath, "dirty\n", "utf8");
  const dirty = await audit(context, 122_000);
  assert.equal(dirty.audit.terminal_ready, false);
  assert(blockerCodes(dirty).has("repository-dirty"));
  assert.equal(blockerCodes(dirty).has("repository-drift"), false);

  git(context.root, ["add", "host-no-change-dirty.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "host no-change coordinator drift"]);
  const drifted = await audit(context, 123_000);
  assert.equal(drifted.audit.terminal_ready, false);
  assert(blockerCodes(drifted).has("repository-drift"));
});

test("archived host-worktree integration cannot close until its exact executor branch is absent", async (t) => {
  const executorBranch = "codex/run-audit-cleanup-guard";
  const context = await runFixture(
    t,
    "cleanup-guard",
    taskThread("cleanup-guard", { write_paths: ["cleanup-guard.txt"] }),
    { branchFences: [executorBranch] },
  );
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-run-audit-cleanup-"));
  const worktreePath = resolve(worktreeParent, "executor");
  t.after(async () => {
    if (await realpath(worktreePath).catch(() => null)) {
      try {
        git(context.root, ["worktree", "remove", "--force", worktreePath]);
      } catch {
        // Fixture teardown only; assertions below cover the authoritative path.
      }
    }
    await rm(worktreeParent, { recursive: true, force: true });
  });

  const visible = await prepareHostVisible(context, "cleanup-guard", {
    executorBranch,
    worktreePath,
  });
  const release = await acceptRelease(context, visible, "cleanup-guard");
  await writeFile(resolve(worktreePath, "cleanup-guard.txt"), "cleanup guard\n", "utf8");
  git(worktreePath, ["add", "cleanup-guard.txt"]);
  git(worktreePath, ["commit", "--quiet", "-m", "cleanup guard result"]);
  const executorTip = git(worktreePath, ["rev-parse", "HEAD"]);
  const payload = receipt(context, visible, release, {
    kind: "clean-commit",
    baseline_revision: context.baseline,
    commit: executorTip,
    branch: executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  payload.model_evidence.observed = {
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
  };
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: context.coordinator,
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-for-integration",
    reason: "The exact clean executor commit is accepted for integration.",
  });
  const integration = await prepareSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    dispositionId: disposition.disposition_id,
    mainBranch: "main",
  });
  git(context.root, ["merge", "--quiet", "--ff-only", executorBranch]);
  const verificationRequest = await integrationVerificationRequest({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    integrationId: integration.integration_id,
  });
  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    receipt: verificationRequest.receipt,
    integrationScope: verificationRequest.integration_scope,
    checks: [{
      check_id: "run-audit-cleanup-guard",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  await reconcileSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    integrationId: integration.integration_id,
    verificationId: verification.verification_id,
  });
  const completedDisposition = await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: context.coordinator,
    executorThreadId: visible.readyThreadId,
    integrationId: integration.integration_id,
    verificationId: verification.verification_id,
  });
  git(context.root, ["worktree", "remove", worktreePath]);
  const archive = await prepareTaskArchive({
    stateRoot: context.stateRoot,
    dispositionId: completedDisposition.disposition_id,
    taskObservation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
    hostId: "local",
  });
  await reconcileTaskArchive({
    stateRoot: context.stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: {
      execution_kind: "task-thread",
      thread_id: visible.readyThreadId,
      source: "host-observed",
      active_visible: false,
      archived_visible: true,
    },
  });

  const retained = await audit(context, 120_000);
  assert.equal(retained.audit.terminal_ready, false);
  assert(blockerCodes(retained).has("cleanup-unresolved"));
  assert.equal(retained.audit.cleanup.counts.cleanup_candidates, 1);
  assert.equal(retained.audit.cleanup.counts.close_blocked, 1);
  const retainedPlanId = retained.audit.cleanup.plan_id;

  git(context.root, ["branch", "-d", executorBranch]);
  const cleaned = await audit(context, 121_000);
  assert.equal(cleaned.audit.terminal_ready, true, JSON.stringify(cleaned.audit.blockers));
  assert.equal(cleaned.audit.cleanup.counts.close_blocked, 0);
  assert.notEqual(cleaned.audit.cleanup.plan_id, retainedPlanId);
});

test("prepared and unsafe integrations remain explicit closure blockers", async (t) => {
  const context = await runFixture(t, "integration", taskThread("integration", {
    write_paths: ["audit-integration.txt"],
  }));
  const visible = await prepareVisible(context, "integration", { ready: true });
  const release = await acceptRelease(context, visible, "integration");
  const executorBranch = "codex/run-audit-integration";
  git(context.root, ["checkout", "-q", "-b", executorBranch]);
  await writeFile(resolve(context.root, "audit-integration.txt"), "integration result\n", "utf8");
  git(context.root, ["add", "audit-integration.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "audit integration result"]);
  const executorTip = git(context.root, ["rev-parse", "HEAD"]);
  git(context.root, ["checkout", "-q", "main"]);
  const payload = receipt(context, visible, release, {
    kind: "clean-commit",
    baseline_revision: context.baseline,
    commit: executorTip,
    branch: executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: context.coordinator,
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-for-integration",
    reason: "The clean executor commit is eligible for serial integration.",
  });
  let result = await audit(context);
  assert(blockerCodes(result).has("integration-missing"));
  assert(blockerCodes(result).has("verification-missing"));
  const integration = await prepareSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    dispositionId: disposition.disposition_id,
    mainBranch: "main",
  });
  result = await audit(context, 101_000);
  assert(blockerCodes(result).has("integration-unreconciled"));
  const reconciled = await reconcileSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    integrationId: integration.integration_id,
    verificationId: null,
  });
  assert.equal(reconciled.outcome, "unmerged");
  result = await audit(context, 102_000);
  assert(blockerCodes(result).has("integration-unsafe"));
  assert.equal(result.audit.terminal_ready, false);
});

test("safe integration must preserve its exact combined-verification digest", async (t) => {
  const context = await runFixture(t, "integration-proof", taskThread("integration-proof", {
    write_paths: ["audit-integration-proof.txt"],
  }));
  const visible = await prepareVisible(context, "integration-proof", { ready: true });
  const release = await acceptRelease(context, visible, "integration-proof");
  const executorBranch = "codex/run-audit-integration-proof";
  git(context.root, ["checkout", "-q", "-b", executorBranch]);
  await writeFile(
    resolve(context.root, "audit-integration-proof.txt"),
    "integration proof\n",
    "utf8",
  );
  git(context.root, ["add", "audit-integration-proof.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "audit integration proof"]);
  const executorTip = git(context.root, ["rev-parse", "HEAD"]);
  git(context.root, ["checkout", "-q", "main"]);
  const payload = receipt(context, visible, release, {
    kind: "clean-commit",
    baseline_revision: context.baseline,
    commit: executorTip,
    branch: executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient: context.coordinator,
  });
  const disposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-for-integration",
    reason: "The exact clean commit is eligible for integration proof.",
  });
  const integration = await prepareSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    dispositionId: disposition.disposition_id,
    mainBranch: "main",
  });
  git(context.root, ["merge", "--quiet", "--ff-only", executorBranch]);
  const verificationRequest = await integrationVerificationRequest({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    integrationId: integration.integration_id,
  });
  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    receipt: verificationRequest.receipt,
    integrationScope: verificationRequest.integration_scope,
    checks: [{
      check_id: "run-audit-integration-proof",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  const reconciled = await reconcileSerialIntegration({
    stateRoot: context.stateRoot,
    repositoryPath: context.root,
    integrationId: integration.integration_id,
    verificationId: verification.verification_id,
  });
  const beforeTamper = await audit(context, 110_000);
  assert(blockerCodes(beforeTamper).has("disposition-unfinalized"));
  assert.equal(beforeTamper.audit.repository.expected_source, "combined-verification");
  assert.equal(beforeTamper.audit.repository.expected_verification_id, verification.verification_id);

  const integrationPath = resolve(
    context.stateRoot,
    "integration-lifecycle",
    "records",
    `${integration.integration_id}.json`,
  );
  const tampered = JSON.parse(await readFile(integrationPath, "utf8"));
  tampered.combined_verification_digest = digest("b");
  tampered.reconciliation_digest = sha256(stableStringify({
    integration_id: tampered.integration_id,
    outcome: tampered.outcome,
    reconciled_main_tip: tampered.reconciled_main_tip,
    executor_tip: tampered.executor_tip,
    verification_id: tampered.verification_id,
    combined_verification_digest: tampered.combined_verification_digest,
  }));
  await writeFile(integrationPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  assert.equal(reconciled.safe_to_finalize, true);
  await assert.rejects(
    audit(context, 111_000),
    /exact combined verification authority/,
  );
});
