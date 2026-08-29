import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
  taskArchiveStatus,
} from "../lib/archive-lifecycle.mjs";
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
} from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration-v06.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { runCombinedVerification } from "../lib/verifications-v06.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v06-lifecycle-fixture.mjs";

const digest = (character) => character.repeat(64);
const recipient = {
  lineage_id: "archive-lineage-v06",
  thread_id: "archive-coordinator-v06",
  generation: 1,
};

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function activeObservation(threadId) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "host-observed",
    active_visible: true,
    archived_visible: false,
  };
}

function archivedObservation(threadId) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "host-observed",
    active_visible: false,
    archived_visible: true,
  };
}

async function acceptedRelease(root, suffix, options = {}) {
  const context = await createAcceptedVisibleTask(root, `archive-${suffix}`, {
    coordinator: recipient,
    ...options,
  });
  return { ...context, releaseId: context.release.release_id };
}

function receipt(release, gitOutcome, classification = "PASS") {
  return terminalReceipt(release, gitOutcome, { classification });
}

async function observedDisposition({
  stateRoot,
  payload,
  decision,
  integrationId = null,
  verificationId = null,
}) {
  const delivered = await deliverCallbackV06({ stateRoot, receipt: payload });
  await observeCallbackV06({ stateRoot, callbackId: delivered.callback_id, recipient });
  const disposition = await prepareTaskDisposition({
    stateRoot,
    callbackId: delivered.callback_id,
    decision,
    reason: `Archive test decision ${decision}.`,
  });
  if (decision === "accepted-for-integration" && integrationId === null) {
    return { delivered, disposition };
  }
  const completed = await finalizeTaskDisposition({
    stateRoot,
    dispositionId: disposition.disposition_id,
    recipient,
    executorThreadId: payload.executor_thread_id,
    integrationId,
    verificationId,
  });
  return { delivered, disposition: completed };
}

async function noChangeAuthority(root, suffix) {
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  await bindRecipient({ stateRoot, recipient });
  const release = await acceptedRelease(root, suffix);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const payload = receipt(release, {
    kind: "unchanged",
    baseline_revision: baseline,
    final_revision: baseline,
    branch: "main",
    upstream: null,
    cleanliness: "clean",
  });
  const verification = await runCombinedVerification({
    stateRoot,
    repositoryPath: root,
    receipt: payload,
    checks: [{
      check_id: "archive-no-change-pass",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
  });
  const { disposition } = await observedDisposition({
    stateRoot,
    payload,
    decision: "accepted-no-change",
    verificationId: verification.verification_id,
  });
  return { stateRoot, release, payload, disposition };
}

test("clean no-change visible task archives only after setter and independent observation", async () => {
  const root = await createGitFixture("codex-flow-v06-archive-");
  try {
    const authority = await noChangeAuthority(root, "no-change");
    await bindRecipient({ stateRoot: authority.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: authority.stateRoot,
      dispositionId: authority.disposition.disposition_id,
      taskObservation: activeObservation(authority.release.readyThreadId),
      hostId: "local",
      worktree: { management: "none", path: null },
    });
    assert.equal(prepared.state, "prepared");
    assert.equal(prepared.call_required, true);
    assert.deepEqual(prepared.host_intent, {
      action: "set-thread-archived",
      attempt_id: prepared.host_intent.attempt_id,
      thread_id: authority.release.readyThreadId,
      host_id: "local",
      archived: true,
    });
    const replay = await prepareTaskArchive({
      stateRoot: authority.stateRoot,
      dispositionId: authority.disposition.disposition_id,
      taskObservation: activeObservation(authority.release.readyThreadId),
      hostId: "local",
      worktree: { management: "none", path: null },
    });
    assert.equal(replay.archive_id, prepared.archive_id);
    assert.equal(replay.call_required, false);
    await assert.rejects(
      prepareTaskArchive({
        stateRoot: authority.stateRoot,
        dispositionId: authority.disposition.disposition_id,
        taskObservation: activeObservation(authority.release.readyThreadId),
        hostId: "different-host",
        worktree: { management: "none", path: null },
      }),
      /already has a different exact archive intent/,
    );

    const accepted = await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
    });
    assert.equal(accepted.state, "accepted-awaiting-observation");
    assert.equal(accepted.keep_visible, true);
    assert.deepEqual(
      await reconcileTaskArchive({
        stateRoot: authority.stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
      }),
      accepted,
    );

    const completed = await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: archivedObservation(authority.release.readyThreadId),
    });
    assert.equal(completed.state, "completed");
    assert.equal(completed.keep_visible, false);
    assert.equal(completed.observation.worktree_state, "not-applicable");
    assert.equal((await taskArchiveStatus({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
    })).state, "completed");
  } finally {
    await removeFixture(root);
  }
});

test("integrated host-worktree task remains visible until the clean worktree is absent", async () => {
  const root = await createGitFixture("codex-flow-v06-archive-integrated-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v06-archive-worktree-"));
  const worktreePath = resolve(worktreeParent, "executor");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
    await bindRecipient({ stateRoot, recipient });
    const release = await acceptedRelease(root, "integrated", {
      executorBranch: "codex/archive-integrated",
      task: { write_paths: ["archive-result.txt"] },
    });
    const baseline = git(root, ["rev-parse", "HEAD"]);
    const executorBranch = "codex/archive-integrated";
    git(root, ["worktree", "add", "-q", "-b", executorBranch, worktreePath, "main"]);
    await writeFile(resolve(worktreePath, "archive-result.txt"), "integrated\n", "utf8");
    git(worktreePath, ["add", "archive-result.txt"]);
    git(worktreePath, ["commit", "--quiet", "-m", "archive integration result"]);
    const executorTip = git(worktreePath, ["rev-parse", "HEAD"]);
    const payload = receipt(release, {
      kind: "clean-commit",
      baseline_revision: baseline,
      commit: executorTip,
      branch: executorBranch,
      upstream: null,
      cleanliness: "clean",
    });
    const preparedDisposition = await observedDisposition({
      stateRoot,
      payload,
      decision: "accepted-for-integration",
    });
    const integration = await prepareSerialIntegration({
      stateRoot,
      repositoryPath: root,
      dispositionId: preparedDisposition.disposition.disposition_id,
      mainBranch: "main",
    });
    git(root, ["merge", "--ff-only", executorBranch]);
    const verificationRequest = await integrationVerificationRequest({
      stateRoot,
      repositoryPath: root,
      integrationId: integration.integration_id,
    });
    const verification = await runCombinedVerification({
      stateRoot,
      repositoryPath: root,
      receipt: verificationRequest.receipt,
      integrationScope: verificationRequest.integration_scope,
      checks: [{
        check_id: "archive-integrated-pass",
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
    });
    const reconciled = await reconcileSerialIntegration({
      stateRoot,
      repositoryPath: root,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    assert.equal(reconciled.safe_to_finalize, true);
    const disposition = await finalizeTaskDisposition({
      stateRoot,
      dispositionId: preparedDisposition.disposition.disposition_id,
      recipient,
      executorThreadId: payload.executor_thread_id,
      integrationId: integration.integration_id,
      verificationId: verification.verification_id,
    });
    const driftPath = resolve(worktreePath, "untracked-drift.txt");
    await writeFile(driftPath, "dirty\n", "utf8");
    await assert.rejects(
      prepareTaskArchive({
        stateRoot,
        dispositionId: disposition.disposition_id,
        taskObservation: activeObservation(release.readyThreadId),
        worktree: { management: "host-managed", path: worktreePath },
      }),
      /Dirty worktree must remain visible/,
    );
    await rm(driftPath);
    const prepared = await prepareTaskArchive({
      stateRoot,
      dispositionId: disposition.disposition_id,
      taskObservation: activeObservation(release.readyThreadId),
      worktree: { management: "host-managed", path: worktreePath },
    });
    assert.equal(prepared.worktree.prepared_state, "present-clean");
    await reconcileTaskArchive({
      stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
    });
    await assert.rejects(
      reconcileTaskArchive({
        stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
        observation: archivedObservation(release.readyThreadId),
      }),
      /worktree still exists/,
    );
    git(root, ["worktree", "remove", worktreePath]);
    const completed = await reconcileTaskArchive({
      stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: archivedObservation(release.readyThreadId),
    });
    assert.equal(completed.state, "completed");
    assert.equal(completed.observation.worktree_state, "absent");
  } finally {
    if (await realpath(worktreePath).catch(() => null)) {
      try {
        git(root, ["worktree", "remove", "--force", worktreePath]);
      } catch {
        // Fixture cleanup only; the assertion path reports the causal failure.
      }
    }
    await removeFixture(root);
    await rm(worktreeParent, { recursive: true, force: true });
  }
});

test("blocked and ambiguous archive outcomes remain visible", async () => {
  const blockedRoot = await createGitFixture("codex-flow-v06-archive-blocked-");
  const ambiguousRoot = await createGitFixture("codex-flow-v06-archive-ambiguous-");
  try {
    const blockedState = resolve(blockedRoot, ".git", "codex-flow", "v0.6.0");
    await bindRecipient({ stateRoot: blockedState, recipient });
    const blockedRelease = await acceptedRelease(blockedRoot, "blocked");
    const baseline = git(blockedRoot, ["rev-parse", "HEAD"]);
    const blockedPayload = receipt(blockedRelease, {
      kind: "dirty-blocked",
      baseline_revision: baseline,
      commit: baseline,
      branch: "main",
      upstream: null,
      cleanliness: "dirty",
      status_digest: digest("f"),
    }, "BLOCKED");
    const blocked = await observedDisposition({
      stateRoot: blockedState,
      payload: blockedPayload,
      decision: "retained-blocked",
    });
    await assert.rejects(
      prepareTaskArchive({
        stateRoot: blockedState,
        dispositionId: blocked.disposition.disposition_id,
        taskObservation: activeObservation(blockedRelease.readyThreadId),
        worktree: { management: "none", path: null },
      }),
      /must remain visible/,
    );

    const ambiguous = await noChangeAuthority(ambiguousRoot, "ambiguous");
    await bindRecipient({ stateRoot: ambiguous.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: ambiguous.stateRoot,
      dispositionId: ambiguous.disposition.disposition_id,
      taskObservation: activeObservation(ambiguous.release.readyThreadId),
      worktree: { management: "none", path: null },
    });
    const unresolved = await reconcileTaskArchive({
      stateRoot: ambiguous.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "ambiguous",
    });
    assert.equal(unresolved.state, "ambiguous");
    assert.equal(unresolved.keep_visible, true);
    assert.equal(unresolved.call_required, false);
    await assert.rejects(
      reconcileTaskArchive({
        stateRoot: ambiguous.stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
      }),
      /already reconciled differently/,
    );
    const observedAfterAmbiguity = await reconcileTaskArchive({
      stateRoot: ambiguous.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "ambiguous",
      observation: archivedObservation(ambiguous.release.readyThreadId),
    });
    assert.equal(observedAfterAmbiguity.state, "completed");
    assert.equal(observedAfterAmbiguity.keep_visible, false);
  } finally {
    await removeFixture(blockedRoot);
    await removeFixture(ambiguousRoot);
  }
});
