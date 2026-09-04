import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  deliverCallback,
  observeCallback,
} from "../lib/callbacks.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
} from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration.mjs";
import { runCombinedVerification } from "../lib/verifications.mjs";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
} from "../lib/archive-lifecycle.mjs";
import { cleanupPlan } from "../lib/cleanup.mjs";
import { auditRunClosure } from "../lib/run-audit.mjs";
import {
  createActiveTaskLaunch,
  terminalReceiptV4,
} from "./v09-lifecycle-fixture.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function recipient(context) {
  return {
    lineage_id: context.coordinator.lineage_id,
    thread_id: context.coordinator.thread_id,
    generation: context.coordinator.generation,
  };
}

test("v0.9 completes launch through quiet callback, no-change proof, archive, cleanup, and audit", async () => {
  const root = await createGitFixture("codex-flow-v09-lifecycle-");
  let context = null;
  try {
    context = await createActiveTaskLaunch(root, "complete");
    const receipt = terminalReceiptV4(context, {
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
    assert.equal(delivered.status, "persisted");
    assert.equal(delivered.interrupt_requested, undefined);
    await observeCallback({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      recipient: recipient(context),
    });
    const disposition = await prepareTaskDisposition({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      decision: "accepted-no-change",
      reason: "The executor returned a clean unchanged result.",
    });
    const verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: context.executorPath,
      receipt,
      checks: [{
        check_id: "exact-baseline",
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
    });
    assert.equal(verification.classification, "PASS");
    const completedDisposition = await finalizeTaskDisposition({
      stateRoot: context.stateRoot,
      dispositionId: disposition.disposition_id,
      recipient: recipient(context),
      executorThreadId: context.executorThreadId,
      verificationId: verification.verification_id,
    });
    assert.equal(completedDisposition.state, "completed");

    const activeObservation = {
      execution_kind: "task-thread",
      thread_id: context.executorThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    };
    const archive = await prepareTaskArchive({
      stateRoot: context.stateRoot,
      dispositionId: completedDisposition.disposition_id,
      taskObservation: activeObservation,
      hostId: "local",
    });
    assert.equal(archive.call_required, true);
    await reconcileTaskArchive({
      stateRoot: context.stateRoot,
      archiveId: archive.archive_id,
      attemptId: archive.host_intent.attempt_id,
      outcome: "accepted",
    });
    git(root, ["worktree", "remove", context.executorPath]);
    await rm(context.executorPath, { recursive: true, force: true });
    const archived = await reconcileTaskArchive({
      stateRoot: context.stateRoot,
      archiveId: archive.archive_id,
      attemptId: archive.host_intent.attempt_id,
      outcome: "accepted",
      observation: {
        ...activeObservation,
        active_visible: false,
        archived_visible: true,
      },
    });
    assert.equal(archived.state, "completed");
    git(root, ["branch", "-d", context.executorBranch]);

    const cleanup = await cleanupPlan({
      stateRoot: context.stateRoot,
      runId: context.contract.run_id,
    });
    assert.equal(cleanup.counts.cleanup_required, 0);
    assert.deepEqual(cleanup.blocking_launch_ids, []);
    const audit = await auditRunClosure({
      stateRoot: context.stateRoot,
      runId: context.contract.run_id,
    });
    assert.equal(audit.audit.terminal_ready, true);
    assert.equal(audit.audit.counts.task_launches, 1);
    assert.equal(audit.audit.counts.callbacks, 1);
    context = null;
  } finally {
    if (context !== null) {
      try {
        git(root, ["worktree", "remove", "--force", context.executorPath]);
      } catch {}
    }
    await removeFixture(root);
  }
});

test("v0.9 admits only launch-bound evidence and completes clean-commit integration", async () => {
  const root = await createGitFixture("codex-flow-v09-integration-");
  let context = null;
  try {
    context = await createActiveTaskLaunch(root, "integrated");
    await mkdir(`${context.executorPath}/audit-sentinel`, { recursive: true });
    await writeFile(
      `${context.executorPath}/audit-sentinel/integrated.txt`,
      "native-first integrated result\n",
      "utf8",
    );
    git(context.executorPath, ["add", "audit-sentinel/integrated.txt"]);
    git(context.executorPath, ["commit", "--quiet", "-m", "test: integrate native-first result"]);
    const executorTip = git(context.executorPath, ["rev-parse", "HEAD"]);
    const receipt = terminalReceiptV4(context, {
      kind: "clean-commit",
      baseline_revision: context.baseline,
      commit: executorTip,
      branch: context.executorBranch,
      upstream: null,
      cleanliness: "clean",
    });

    await assert.rejects(
      deliverCallback({
        stateRoot: context.stateRoot,
        receipt: {
          ...receipt,
          launch_id: `task-launch-v1-${"0".repeat(64)}`,
        },
        expectedRunId: context.contract.run_id,
      }),
      /launch|authority/i,
    );
    const wrongSelector = { model: "different-model", reasoning_effort: "high" };
    await assert.rejects(
      deliverCallback({
        stateRoot: context.stateRoot,
        receipt: {
          ...receipt,
          model_evidence: {
            configured: wrongSelector,
            requested: wrongSelector,
            accepted: wrongSelector,
            observed: null,
          },
        },
        expectedRunId: context.contract.run_id,
      }),
      /model evidence|selector/i,
    );

    const delivered = await deliverCallback({
      stateRoot: context.stateRoot,
      receipt,
      expectedRunId: context.contract.run_id,
    });
    await observeCallback({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      recipient: recipient(context),
    });
    const disposition = await prepareTaskDisposition({
      stateRoot: context.stateRoot,
      callbackId: delivered.callback_id,
      decision: "accepted-for-integration",
      reason: "The executor produced one clean commit on its exact launch branch.",
    });
    const integration = await prepareSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: root,
      dispositionId: disposition.disposition_id,
      mainBranch: "main",
    });
    git(root, ["merge", "--ff-only", context.executorBranch]);
    const verificationRequest = await integrationVerificationRequest({
      stateRoot: context.stateRoot,
      repositoryPath: root,
      integrationId: integration.integration_id,
    });
    const verification = await runCombinedVerification({
      stateRoot: context.stateRoot,
      repositoryPath: root,
      receipt: verificationRequest.receipt,
      integrationScope: verificationRequest.integration_scope,
      checks: [{
        check_id: "integrated-file-present",
        argv: [process.execPath, "-e", "require('fs').accessSync('audit-sentinel/integrated.txt')"],
      }],
    });
    const reconciled = await reconcileSerialIntegration({
      stateRoot: context.stateRoot,
      repositoryPath: root,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    assert.equal(reconciled.outcome, "ancestor");
    const completedDisposition = await finalizeTaskDisposition({
      stateRoot: context.stateRoot,
      dispositionId: disposition.disposition_id,
      recipient: recipient(context),
      executorThreadId: context.executorThreadId,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    assert.equal(completedDisposition.state, "completed");

    const activeObservation = {
      execution_kind: "task-thread",
      thread_id: context.executorThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    };
    const archive = await prepareTaskArchive({
      stateRoot: context.stateRoot,
      dispositionId: completedDisposition.disposition_id,
      taskObservation: activeObservation,
      hostId: "local",
    });
    await reconcileTaskArchive({
      stateRoot: context.stateRoot,
      archiveId: archive.archive_id,
      attemptId: archive.host_intent.attempt_id,
      outcome: "accepted",
    });
    git(root, ["worktree", "remove", context.executorPath]);
    await reconcileTaskArchive({
      stateRoot: context.stateRoot,
      archiveId: archive.archive_id,
      attemptId: archive.host_intent.attempt_id,
      outcome: "accepted",
      observation: {
        ...activeObservation,
        active_visible: false,
        archived_visible: true,
      },
    });
    git(root, ["branch", "-d", context.executorBranch]);
    const audit = await auditRunClosure({
      stateRoot: context.stateRoot,
      runId: context.contract.run_id,
    });
    assert.equal(audit.audit.terminal_ready, true);
    assert.equal(audit.audit.counts.integrations, 1);
    context = null;
  } finally {
    if (context !== null) {
      try {
        git(root, ["worktree", "remove", "--force", context.executorPath]);
      } catch {}
    }
    await removeFixture(root);
  }
});
