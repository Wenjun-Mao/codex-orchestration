import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
  taskDispositionStatus,
} from "../lib/dispositions.mjs";
import { recipientBindingDigest, validateTerminalReceiptV3 } from "../lib/task-results.mjs";
import { runCombinedVerification } from "../lib/verifications-v06.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const digest = (character) => character.repeat(64);
const recipient = {
  lineage_id: "disposition-lineage-v06",
  thread_id: "disposition-coordinator-v06",
  generation: 1,
};

function receipt(
  kind = "unchanged",
  baseline = "2".repeat(40),
  branch = "main",
  releaseId = "disposition-release-v06",
) {
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: { ...recipient, binding_digest: recipientBindingDigest(recipient) },
    executor_id: "disposition-executor-v06",
    run_id: "disposition-run-v06",
    runtime_digest: digest("b"),
    config_digest: digest("c"),
    plan_id: "disposition-plan-v06",
    revision_id: "disposition-revision-v06",
    task_id: "disposition-task-v06",
    task_contract_digest: digest("d"),
    operation_id: "disposition-operation-v06",
    release_id: releaseId,
    classification: "PASS",
    git_outcome: kind === "unchanged"
      ? {
        kind,
        baseline_revision: baseline,
        final_revision: baseline,
        branch,
        upstream: null,
        cleanliness: "clean",
      }
      : {
        kind,
        baseline_revision: baseline,
        commit: "3".repeat(40),
        branch,
        upstream: null,
        cleanliness: "clean",
      },
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
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
    completed_at: "2026-08-29T12:00:00-04:00",
  });
}

async function acceptedRelease(stateRoot, root) {
  const commonDir = await realpath(resolve(root, ".git"));
  const input = {
    run_id: "disposition-run-v06",
    plan_id: "disposition-plan-v06",
    revision_id: "disposition-revision-v06",
    task_id: "disposition-task-v06",
    task_contract_digest: digest("d"),
    operation_id: "disposition-operation-v06",
    ready_thread_id: "disposition-thread-v06",
    runtime_digest: digest("b"),
    config_digest: digest("c"),
    repository_id: "disposition-repository-v06",
    common_dir: commonDir,
    prompt: "Execute the bounded disposition test task.",
  };
  const prepared = await prepareTaskRelease({ stateRoot, input });
  await reconcileTaskRelease({
    stateRoot,
    releaseId: prepared.release_id,
    outcome: "sent",
  });
  await acceptTaskRelease({
    stateRoot,
    releaseId: prepared.release_id,
    executorThreadId: input.ready_thread_id,
    taskContractDigest: input.task_contract_digest,
    runtimeDigest: input.runtime_digest,
    commonDir,
  });
  return prepared.release_id;
}

async function observedCallback(stateRoot, payload) {
  const delivered = await deliverCallbackV06({ stateRoot, receipt: payload });
  await observeCallbackV06({ stateRoot, callbackId: delivered.callback_id, recipient });
  return delivered.callback_id;
}

test("accepted no-change disposition finalizes, consumes, and unblocks once", async () => {
  const root = await createGitFixture("codex-flow-v06-disposition-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  try {
    await bindRecipient({ stateRoot, recipient });
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const releaseId = await acceptedRelease(stateRoot, root);
    const payload = receipt("unchanged", baseline, "main", releaseId);
    const callbackId = await observedCallback(stateRoot, payload);
    const prepared = await prepareTaskDisposition({
      stateRoot,
      callbackId,
      decision: "accepted-no-change",
      reason: "The clean task remained at its authenticated baseline.",
    });
    const verification = await runCombinedVerification({
      stateRoot,
      repositoryPath: root,
      receipt: payload,
      checks: [{
        check_id: "no-change-pass",
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
    });
    await assert.rejects(finalizeTaskDisposition({
      stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorId: payload.executor_id,
      integrationId: null,
      verificationId: `verification-v1-${digest("f")}`,
    }), /verification record does not exist/i);
    const completed = await finalizeTaskDisposition({
      stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorId: payload.executor_id,
      integrationId: null,
      verificationId: verification.verification_id,
    });
    assert.equal(completed.state, "completed");
    assert.equal((await taskDispositionStatus({
      stateRoot,
      dispositionId: prepared.disposition_id,
    })).unblocks_dependencies, true);
    assert.equal((await finalizeTaskDisposition({
      stateRoot,
      dispositionId: prepared.disposition_id,
      recipient,
      executorId: payload.executor_id,
      integrationId: null,
      verificationId: verification.verification_id,
    })).state, "completed");
  } finally {
    await removeFixture(root);
  }
});

test("disposition mechanically matches the receipt Git outcome", async () => {
  const root = await createGitFixture("codex-flow-v06-disposition-match-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  try {
    await bindRecipient({ stateRoot, recipient });
    const callbackId = await observedCallback(stateRoot, receipt("clean-commit"));
    await assert.rejects(
      prepareTaskDisposition({
        stateRoot,
        callbackId,
        decision: "accepted-no-change",
        reason: "This decision does not match the committed result.",
      }),
      /requires a PASS unchanged receipt/,
    );
  } finally {
    await removeFixture(root);
  }
});
