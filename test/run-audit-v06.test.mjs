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
  readRunClosureAudit,
  runClosureAuditStatus,
  validateRunClosureAudit,
} from "../lib/run-audit-v06.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
} from "../lib/runtime-context.mjs";
import { admitRun, buildFencePlan } from "../lib/run-lifecycle.mjs";
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
  completeSubagentOperation,
  prepareSubagentOperation,
  reconcileCreatedSubagent,
  recordSubagentCoordinatorDisposition,
} from "../lib/subagent-lifecycle.mjs";
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
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
  validateDispositionRecord,
} from "../lib/dispositions.mjs";
import { validateTerminalReceiptV3 } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications-v06.mjs";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
} from "../lib/archive-lifecycle.mjs";
import {
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration-v06.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T19:00:00.000Z");
const digest = (character) => character.repeat(64);
const at = (offset) => START + offset;

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
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${suffix}.txt`],
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
    fork_turns: "all",
    dependencies: [],
    read_paths: ["README.md"],
    write_paths: [],
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

async function runFixture(t, suffix, task) {
  const root = await createGitFixture(`codex-flow-v06-run-audit-${suffix}-`);
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.0");
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
      operationFences: [task.task_id],
    }),
    admittedAt: new Date(at(3_000)).toISOString(),
  });
  const coordinatorBinding = {
    ...coordinator,
    binding_digest: coordinatorBindingDigest(coordinator),
  };
  const authority = {
    run_id: admitted.run.run_id,
    runtime_context_digest: admitted.run.runtime_context_hash,
    configuration_digest: admitted.run.binding.config_hash,
    repository_id: `audit-repository-${suffix}`,
    common_dir: commonDir,
    coordinator_binding: coordinatorBinding,
  };
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId: admitted.run.run_id,
    planId: plan.plan_id,
    taskId: task.task_id,
    currentBaseline: { revision: baseline },
    dependencyRecords: [],
    authority,
    now: at(4_000),
  });
  return {
    root,
    commonDir,
    stateRoot,
    baseline,
    coordinator,
    coordinatorBinding,
    plan,
    admitted,
    authority,
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
    prompt_digest: digest("f"),
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
  assert.equal(completed.audit.terminal_ready, true);
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
    dependencyRecords: [],
    authority: context.authority,
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

test("audit fails closed on persisted audit tampering", async (t) => {
  const context = await runFixture(t, "tamper", subagentTask("tamper"));
  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
    fork_turns: context.contract.task.fork_turns,
    mode: "read",
    prompt_digest: digest("e"),
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

test("non-created, retained-blocked, and durably cancelled visible paths remain visible without archive", async (t) => {
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
    reasonCode: "host-rejected-before-create",
    now: at(7_000),
  });
  assert.equal((await audit(notCreated)).audit.terminal_ready, true);

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
  assert.equal(blockedAudit.audit.terminal_ready, true);
  assert.equal(blockedAudit.audit.counts.archives, 0);

  const cancelled = await runFixture(t, "cancelled", taskThread("cancelled"));
  const cancelledVisible = await prepareVisible(cancelled, "cancelled", { ready: true });
  const cancelledRelease = await acceptRelease(cancelled, cancelledVisible, "cancelled");
  const dispositionId = "audit-cancelled-disposition";
  const cancellation = validateDispositionRecord({
    schema_version: 1,
    kind: "codex-flow-v06-task-disposition",
    disposition_id: dispositionId,
    run_id: cancelled.contract.run_id,
    runtime_context_digest: cancelled.contract.runtime_context_digest,
    configuration_digest: cancelled.contract.configuration_digest,
    repository_id: cancelled.contract.repository_id,
    common_dir: cancelled.contract.common_dir,
    coordinator_binding: cancelled.contract.coordinator_binding,
    plan_id: cancelled.contract.plan_id,
    revision_digest: cancelled.contract.revision_digest,
    task_id: cancelled.contract.task_id,
    task_digest: cancelled.contract.task_digest,
    contract_id: cancelled.contract.contract_id,
    operation_id: cancelledVisible.creation.operation_id,
    release_id: cancelledRelease.prepared.release_id,
    executor_thread_id: cancelledVisible.readyThreadId,
    callback_id: null,
    receipt_digest: null,
    decision: "cancelled",
    reason: "The coordinator durably cancelled the task and keeps it visible.",
    integration_id: null,
    verification_id: null,
    verification_digest: null,
    state: "completed",
    prepared_at: new Date(at(12_000)).toISOString(),
    finalized_at: new Date(at(13_000)).toISOString(),
    callback_consumed_at: new Date(at(14_000)).toISOString(),
  });
  const dispositionRoot = resolve(cancelled.stateRoot, "dispositions", "records");
  await mkdir(dispositionRoot, { recursive: true });
  await writeFile(
    resolve(dispositionRoot, `${dispositionId}.json`),
    `${JSON.stringify(cancellation, null, 2)}\n`,
    "utf8",
  );
  const cancelledAudit = await audit(cancelled, 102_000);
  assert.equal(cancelledAudit.audit.terminal_ready, true);
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
    worktree: { management: "none", path: null },
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
