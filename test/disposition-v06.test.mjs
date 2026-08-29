import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
  taskDispositionStatus,
} from "../lib/dispositions.mjs";
import { validateTerminalReceiptV3 } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications-v06.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import {
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
} from "../lib/task-creation-v06.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
  generateTaskContract,
} from "../lib/workflow-plan.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T23:00:00.000Z");
const digest = (character) => character.repeat(64);
const recipient = {
  lineage_id: "disposition-lineage-v06",
  thread_id: "disposition-coordinator-v06",
  generation: 1,
};

function task() {
  return {
    task_id: "disposition-task-v06",
    title: "Exercise the exact disposition authority",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/disposition-result.mjs"],
    primary_outcome: "Return one exact terminal result for disposition.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Execute the generated task contract once.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

async function acceptedAuthority() {
  const root = await createGitFixture("codex-flow-v06-disposition-");
  const commonDir = await realpath(resolve(root, ".git"));
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const coordinator = { ...recipient };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "disposition-plan-v06",
    revision: 1,
    parent_revision_digest: null,
    tasks: [task()],
  });
  const contract = generateTaskContract({
    plan_revision: plan,
    task_id: task().task_id,
    current_baseline: { revision: baseline },
    dependency_records: [],
    authority: {
      run_id: "disposition-run-v06",
      runtime_context_digest: digest("b"),
      configuration_digest: digest("c"),
      repository_id: "disposition-repository-v06",
      common_dir: commonDir,
      coordinator_binding: coordinator,
    },
  });
  const requested = {
    project_id: "disposition-project-v06",
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "local",
      starting_revision: baseline,
      starting_branch: null,
      executor_branch: null,
      path: root,
    },
  };
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.0");
  const creation = await prepareVisibleTaskCreation({
    stateRoot,
    taskContract: contract,
    requestedSelectors: requested,
    now: START,
  });
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot,
    operationId: creation.operation_id,
    hostSessionId: "disposition-session-v06",
    timeoutSeconds: 300,
    now: START + 1_000,
  });
  await reconcileVisibleTaskCreation({
    stateRoot,
    operationId: creation.operation_id,
    outcome: "ready",
    readyThreadId: "disposition-executor-v06",
    initialTurn: {
      source: "host-observed",
      thread_id: "disposition-executor-v06",
      turn_id: "disposition-initial-turn-v06",
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(START + 2_000).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        ...requested,
        accepted_at: new Date(START + 1_500).toISOString(),
      },
      observed: null,
    },
    now: START + 2_000,
  });
  const preparedRelease = await prepareTaskRelease({
    stateRoot,
    taskContract: contract,
    operationId: creation.operation_id,
    now: START + 3_000,
  });
  await reconcileTaskRelease({
    stateRoot,
    releaseId: preparedRelease.release_id,
    outcome: "sent",
    now: START + 4_000,
  });
  await acceptTaskRelease({
    stateRoot,
    releaseId: preparedRelease.release_id,
    readyThreadId: "disposition-executor-v06",
    contractId: contract.contract_id,
    runtimeContextDigest: contract.runtime_context_digest,
    commonDir,
    now: START + 5_000,
  });
  await bindRecipient({ stateRoot, recipient });
  return {
    root,
    commonDir,
    baseline,
    stateRoot,
    coordinator,
    contract,
    operationId: creation.operation_id,
    releaseId: preparedRelease.release_id,
  };
}

function receipt(context, { kind = "unchanged", identity = {}, modelEvidence = null } = {}) {
  const gitOutcome = kind === "unchanged"
    ? {
      kind,
      baseline_revision: context.baseline,
      final_revision: context.baseline,
      branch: "main",
      upstream: null,
      cleanliness: "clean",
    }
    : {
      kind,
      baseline_revision: context.baseline,
      commit: "3".repeat(40),
      branch: "codex/disposition-result",
      upstream: null,
      cleanliness: "clean",
    };
  const selector = {
    model: context.contract.task.model,
    reasoning_effort: context.contract.task.reasoning_effort,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: context.coordinator,
    executor_thread_id: "disposition-executor-v06",
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
    operation_id: context.operationId,
    release_id: context.releaseId,
    ...identity,
    classification: "PASS",
    git_outcome: gitOutcome,
    model_evidence: modelEvidence ?? {
      configured: selector,
      requested: selector,
      accepted: selector,
      observed: null,
    },
    result_or_blocker: "Disposition result complete.",
    next_decision: "Finalize the exact coordinator decision.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-08-29T23:10:00.000Z",
  });
}

async function observedCallback(context, payload) {
  const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
  await observeCallbackV06({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient,
  });
  return delivered.callback_id;
}

test("accepted no-change disposition finalizes, consumes, and unblocks once", async () => {
  const context = await acceptedAuthority();
  try {
    const payload = receipt(context);
    const callbackId = await observedCallback(context, payload);
    const prepared = await prepareTaskDisposition({
      stateRoot: context.stateRoot,
      callbackId,
      decision: "accepted-no-change",
      reason: "The clean task remained at its authenticated baseline.",
    });
    assert.equal(prepared.executor_thread_id, payload.executor_thread_id);
    assert.equal(prepared.contract_id, context.contract.contract_id);
    const verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: context.root,
      receipt: payload,
      checks: [{
        check_id: "no-change-pass",
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
    });
    await assert.rejects(finalizeTaskDisposition({
      stateRoot: context.stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorThreadId: payload.executor_thread_id,
      integrationId: null,
      verificationId: `verification-v1-${digest("f")}`,
    }), /verification record does not exist/i);
    const completed = await finalizeTaskDisposition({
      stateRoot: context.stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorThreadId: payload.executor_thread_id,
      integrationId: null,
      verificationId: verification.verification_id,
    });
    assert.equal(completed.state, "completed");
    assert.equal((await taskDispositionStatus({
      stateRoot: context.stateRoot,
      dispositionId: prepared.disposition_id,
    })).unblocks_dependencies, true);
    assert.equal((await finalizeTaskDisposition({
      stateRoot: context.stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorThreadId: payload.executor_thread_id,
      integrationId: null,
      verificationId: verification.verification_id,
    })).state, "completed");
  } finally {
    await removeFixture(context.root);
  }
});

test("disposition preparation fails closed on ready-task, baseline, selector, and recipient drift", async () => {
  const variants = [
    {
      label: "ready task",
      build: (context) => ({
        payload: receipt(context, { identity: { executor_thread_id: "different-executor-v06" } }),
        observingRecipient: recipient,
      }),
      pattern: /Accepted release executor_thread_id/,
    },
    {
      label: "baseline",
      build: (context) => {
        const baselineReceipt = receipt(context);
        return {
          payload: validateTerminalReceiptV3({
            ...baselineReceipt,
            git_outcome: {
              ...baselineReceipt.git_outcome,
              baseline_revision: "4".repeat(40),
              final_revision: "4".repeat(40),
            },
          }),
          observingRecipient: recipient,
        };
      },
      pattern: /Git baseline/,
    },
    {
      label: "selector",
      build: (context) => ({
        payload: receipt(context, {
          modelEvidence: {
            configured: { model: "gpt-5.6-luna", reasoning_effort: "high" },
            requested: { model: "gpt-5.6-luna", reasoning_effort: "high" },
            accepted: { model: "gpt-5.6-luna", reasoning_effort: "high" },
            observed: null,
          },
        }),
        observingRecipient: recipient,
      }),
      pattern: /model evidence/,
    },
    {
      label: "recipient",
      build: async (context) => {
        const alternate = {
          lineage_id: "alternate-disposition-lineage",
          thread_id: "alternate-disposition-coordinator",
          generation: 1,
        };
        alternate.binding_digest = coordinatorBindingDigest(alternate);
        await bindRecipient({
          stateRoot: context.stateRoot,
          recipient: {
            lineage_id: alternate.lineage_id,
            thread_id: alternate.thread_id,
            generation: alternate.generation,
          },
        });
        return {
          payload: receipt(context, { identity: { recipient: alternate } }),
          observingRecipient: {
            lineage_id: alternate.lineage_id,
            thread_id: alternate.thread_id,
            generation: alternate.generation,
          },
        };
      },
      pattern: /coordinator_binding/,
    },
  ];
  for (const variant of variants) {
    const context = await acceptedAuthority();
    try {
      const built = await variant.build(context);
      const delivered = await deliverCallbackV06({
        stateRoot: context.stateRoot,
        receipt: built.payload,
      });
      await observeCallbackV06({
        stateRoot: context.stateRoot,
        callbackId: delivered.callback_id,
        recipient: built.observingRecipient,
      });
      await assert.rejects(
        prepareTaskDisposition({
          stateRoot: context.stateRoot,
          callbackId: delivered.callback_id,
          decision: "accepted-no-change",
          reason: `Reject ${variant.label} authority drift.`,
        }),
        variant.pattern,
      );
    } finally {
      await removeFixture(context.root);
    }
  }
});

test("disposition mechanically matches Git outcome and exposes only canonical schema fields", async () => {
  const context = await acceptedAuthority();
  try {
    const callbackId = await observedCallback(context, receipt(context, { kind: "clean-commit" }));
    await assert.rejects(
      prepareTaskDisposition({
        stateRoot: context.stateRoot,
        callbackId,
        decision: "accepted-no-change",
        reason: "This decision does not match the committed result.",
      }),
      /requires a PASS unchanged receipt/,
    );
    const schema = JSON.parse(await readFile(
      resolve(packageRoot, "schemas/task-disposition.schema.json"),
      "utf8",
    ));
    for (const field of [
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "revision_digest", "task_digest", "contract_id",
      "operation_id", "release_id", "executor_thread_id",
    ]) assert.equal(schema.required.includes(field), true);
    for (const retired of [
      "executor_id", "runtime_digest", "config_digest", "revision_id", "task_contract_digest",
    ]) assert.equal(Object.hasOwn(schema.properties, retired), false);
  } finally {
    await removeFixture(context.root);
  }
});
