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
import {
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v06-lifecycle-fixture.mjs";

function receipt(context) {
  return terminalReceipt(context, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: context.requestedSelectors.worktree.executor_branch,
    upstream: null,
    cleanliness: "clean",
  });
}

function recipient(context) {
  return {
    lineage_id: context.coordinator.lineage_id,
    thread_id: context.coordinator.thread_id,
    generation: context.coordinator.generation,
  };
}

test("v0.6 callback is quiet, durable, and consumable only by a disposition", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-");
  try {
    const context = await createAcceptedVisibleTask(root, "callback");
    const payload = receipt(context);
    const delivered = await deliverCallbackV06({
      stateRoot: context.stateRoot,
      receipt: payload,
      expectedRunId: payload.run_id,
    });
    assert.equal(delivered.status, "persisted");
    assert.equal(delivered.callback_id, terminalCallbackIdForV3(payload));
    assert.equal((await deliverCallbackV06({
      stateRoot: context.stateRoot,
      receipt: payload,
    })).status, "already-persisted");
    const conflicting = validateTerminalReceiptV3({
      ...payload,
      result_or_blocker: "A different result cannot occupy the same released-task terminal slot.",
    });
    assert.equal(terminalCallbackIdForV3(conflicting), delivered.callback_id);
    await assert.rejects(
      deliverCallbackV06({ stateRoot: context.stateRoot, receipt: conflicting }),
      /collides with immutable callback identity/,
    );
    await assert.rejects(
      consumeCallbackV06({
        stateRoot: context.stateRoot,
        callbackId: delivered.callback_id,
        recipient: recipient(context),
        executorThreadId: payload.executor_thread_id,
        dispositionId: "disposition-v06",
      }),
      /must be observed/,
    );
    assert.equal((await observeCallbackV06({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      recipient: recipient(context),
    })).status, "observed");
    await assert.rejects(
      consumeCallbackV06({
        stateRoot: context.stateRoot,
        callbackId: delivered.callback_id,
        recipient: recipient(context),
        executorThreadId: payload.executor_thread_id,
        dispositionId: "disposition-v06",
      }),
      /authoritative persisted disposition/,
    );
    const status = await callbackStatusV06({
      stateRoot: context.stateRoot,
      runId: payload.run_id,
    });
    assert.equal(status.pending.length, 1);
    assert.equal(status.pending[0].executor_thread_id, payload.executor_thread_id);
    assert.equal(Object.hasOwn(status.pending[0], "executor_id"), false);
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 callback rejects cross-run delivery", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-run-");
  try {
    const context = await createAcceptedVisibleTask(root, "callback-run");
    await assert.rejects(
      deliverCallbackV06({
        stateRoot: context.stateRoot,
        receipt: receipt(context),
        expectedRunId: "different-run",
      }),
      /does not match the active run/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 callback rejects contradictory selector evidence before journal persistence", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-selector-");
  try {
    const context = await createAcceptedVisibleTask(root, "callback-selector");
    const valid = receipt(context);
    const contradictory = validateTerminalReceiptV3({
      ...valid,
      model_evidence: {
        ...valid.model_evidence,
        observed: {
          model: context.requestedSelectors.model,
          reasoning_effort: context.requestedSelectors.reasoning_effort,
        },
      },
    });
    await assert.rejects(
      deliverCallbackV06({ stateRoot: context.stateRoot, receipt: contradictory }),
      /model evidence/,
    );
    const status = await callbackStatusV06({
      stateRoot: context.stateRoot,
      runId: context.contract.run_id,
    });
    assert.deepEqual(status, { pending: [], consumed_count: 0 });
  } finally {
    await removeFixture(root);
  }
});

test("v0.6 callback rejects a disposition-shaped lookalike with invalid canonical identity", async () => {
  const root = await createGitFixture("codex-flow-v06-callback-lookalike-");
  try {
    const context = await createAcceptedVisibleTask(root, "callback-lookalike");
    const payload = receipt(context);
    const delivered = await deliverCallbackV06({ stateRoot: context.stateRoot, receipt: payload });
    await observeCallbackV06({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      recipient: recipient(context),
    });
    const dispositionId = "forged-disposition-lookalike";
    const dispositionDirectory = resolve(context.stateRoot, "dispositions", "records");
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
        stateRoot: context.stateRoot,
        callbackId: delivered.callback_id,
        recipient: recipient(context),
        executorThreadId: payload.executor_thread_id,
        dispositionId,
      }),
      /disposition_id does not match its terminal authority/,
    );
  } finally {
    await removeFixture(root);
  }
});
