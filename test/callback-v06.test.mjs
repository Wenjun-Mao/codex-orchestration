import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  callbackStatusV06,
  consumeCallbackV06,
  deliverCallbackV06,
  observeCallbackV06,
} from "../lib/callbacks-v06.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  recipientBindingDigest,
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const digest = (character) => character.repeat(64);

function receipt(commonDir) {
  const recipient = {
    lineage_id: "callback-lineage-v06",
    thread_id: "callback-coordinator-v06",
    generation: 1,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: {
      ...recipient,
      binding_digest: recipientBindingDigest(recipient),
    },
    executor_thread_id: "callback-executor-v06",
    run_id: "callback-run-v06",
    runtime_context_digest: digest("b"),
    configuration_digest: digest("c"),
    repository_id: "callback-repository-v06",
    common_dir: commonDir,
    plan_id: "callback-plan-v06",
    revision_digest: digest("e"),
    task_id: "callback-task-v06",
    task_digest: digest("d"),
    contract_id: digest("f"),
    operation_id: "callback-operation-v06",
    release_id: "callback-release-v06",
    classification: "PASS",
    git_outcome: {
      kind: "unchanged",
      baseline_revision: "1".repeat(40),
      final_revision: "1".repeat(40),
      branch: "codex/callback-v06",
      upstream: null,
      cleanliness: "clean",
    },
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      observed: null,
    },
    result_or_blocker: "Bounded callback result complete.",
    next_decision: "Record a coordinator disposition.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-08-29T12:00:00-04:00",
  });
}

test("v0.6 callback is quiet, durable, and consumable only by a disposition", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  const recipient = {
    lineage_id: "callback-lineage-v06",
    thread_id: "callback-coordinator-v06",
    generation: 1,
  };
  try {
    await bindRecipient({ stateRoot, recipient });
    const payload = receipt(resolve(root, ".git"));
    const delivered = await deliverCallbackV06({
      stateRoot,
      receipt: payload,
      expectedRunId: payload.run_id,
    });
    assert.equal(delivered.status, "persisted");
    assert.equal(delivered.callback_id, terminalCallbackIdForV3(payload));
    assert.equal((await deliverCallbackV06({ stateRoot, receipt: payload })).status, "already-persisted");
    const conflicting = validateTerminalReceiptV3({
      ...payload,
      result_or_blocker: "A different result cannot occupy the same released-task terminal slot.",
    });
    assert.equal(terminalCallbackIdForV3(conflicting), delivered.callback_id);
    await assert.rejects(
      deliverCallbackV06({ stateRoot, receipt: conflicting }),
      /collides with immutable callback identity/,
    );
    await assert.rejects(
      consumeCallbackV06({
        stateRoot,
        callbackId: delivered.callback_id,
        recipient,
        executorThreadId: payload.executor_thread_id,
        dispositionId: "disposition-v06",
      }),
      /must be observed/,
    );
    assert.equal((await observeCallbackV06({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient,
    })).status, "observed");
    await assert.rejects(
      consumeCallbackV06({
        stateRoot,
        callbackId: delivered.callback_id,
        recipient,
        executorThreadId: payload.executor_thread_id,
        dispositionId: "disposition-v06",
      }),
      /authoritative persisted disposition/,
    );
    const status = await callbackStatusV06({ stateRoot, runId: payload.run_id });
    assert.equal(status.pending.length, 1);
    assert.equal(status.pending[0].executor_thread_id, payload.executor_thread_id);
    assert.equal(Object.hasOwn(status.pending[0], "executor_id"), false);
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 callback rejects cross-run delivery", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-run-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  try {
    await bindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "callback-lineage-v06",
        thread_id: "callback-coordinator-v06",
        generation: 1,
      },
    });
    await assert.rejects(
      deliverCallbackV06({
        stateRoot,
        receipt: receipt(resolve(root, ".git")),
        expectedRunId: "different-run",
      }),
      /does not match the active run/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 callback rejects a disposition-shaped lookalike with invalid canonical identity", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-lookalike-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  const recipient = {
    lineage_id: "callback-lineage-v06",
    thread_id: "callback-coordinator-v06",
    generation: 1,
  };
  try {
    await bindRecipient({ stateRoot, recipient });
    const payload = receipt(resolve(root, ".git"));
    const delivered = await deliverCallbackV06({ stateRoot, receipt: payload });
    await observeCallbackV06({
      stateRoot,
      callbackId: delivered.callback_id,
      recipient,
    });
    const dispositionId = "forged-disposition-lookalike";
    const dispositionDirectory = resolve(stateRoot, "dispositions", "records");
    await mkdir(dispositionDirectory, { recursive: true });
    await writeFile(resolve(dispositionDirectory, `${dispositionId}.json`), `${JSON.stringify({
      schema_version: 1,
      kind: "codex-flow-v06-task-disposition",
      disposition_id: dispositionId,
      run_id: payload.run_id,
      runtime_context_digest: payload.runtime_context_digest,
      configuration_digest: payload.configuration_digest,
      repository_id: payload.repository_id,
      common_dir: payload.common_dir,
      coordinator_binding: payload.recipient,
      plan_id: payload.plan_id,
      revision_digest: payload.revision_digest,
      task_id: payload.task_id,
      task_digest: payload.task_digest,
      contract_id: payload.contract_id,
      operation_id: payload.operation_id,
      release_id: payload.release_id,
      executor_thread_id: payload.executor_thread_id,
      callback_id: delivered.callback_id,
      receipt_digest: "0".repeat(64),
      decision: "rejected",
      reason: "This object matches the former callback-local field parser only.",
      integration_id: null,
      verification_id: null,
      verification_digest: null,
      state: "finalized",
      prepared_at: "2026-08-29T12:00:01-04:00",
      finalized_at: "2026-08-29T12:00:02-04:00",
      callback_consumed_at: null,
    }, null, 2)}\n`, "utf8");
    await assert.rejects(
      consumeCallbackV06({
        stateRoot,
        callbackId: delivered.callback_id,
        recipient,
        executorThreadId: payload.executor_thread_id,
        dispositionId,
      }),
      /disposition_id does not match its terminal authority/,
    );
  } finally {
    await removeFixture(root);
  }
});
