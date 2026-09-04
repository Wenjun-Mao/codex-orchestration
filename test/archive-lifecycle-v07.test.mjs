import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  observePrivateTaskArchive,
  prepareTaskArchive,
  reconcileTaskArchive,
  taskArchiveStatus,
} from "../lib/archive-lifecycle.mjs";
import { deliverCallbackV07, observeCallbackV07 } from "../lib/callbacks-v07.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
} from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration-v07.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { runCombinedVerification } from "../lib/verifications-v07.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v07-lifecycle-fixture.mjs";

const digest = (character) => character.repeat(64);
const recipient = {
  lineage_id: "archive-lineage-v07",
  thread_id: "archive-coordinator-v07",
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

async function writePrivateArchiveSession(codexHome, threadId) {
  const archiveDirectory = resolve(codexHome, "archived_sessions");
  await mkdir(archiveDirectory, { recursive: true });
  const session = {
    timestamp: "2026-09-02T12:00:00.000Z",
    type: "session_meta",
    payload: {
      id: threadId,
      cwd: resolve(codexHome, "worktrees", "archive-task"),
      thread_source: "agent_created_thread",
      cli_version: "0.152.0",
    },
  };
  await writeFile(
    resolve(archiveDirectory, `rollout-fixture-${threadId}.jsonl`),
    `${JSON.stringify(session)}\n`,
  );
}

async function acceptedRelease(root, suffix, options = {}) {
  const context = await createAcceptedVisibleTask(root, `archive-${suffix}`, {
    coordinator: recipient,
    ...options,
  });
  return { ...context, releaseId: context.release.release_id };
}

function receipt(release, gitOutcome, classification = "PASS") {
  const payload = terminalReceipt(release, gitOutcome, { classification });
  const observed = release.creation.selector_evidence.observed;
  payload.model_evidence.observed = observed === null
    ? null
    : {
        model: observed.model,
        reasoning_effort: observed.reasoning_effort,
      };
  return payload;
}

async function observedDisposition({
  stateRoot,
  payload,
  decision,
  integrationId = null,
  verificationId = null,
}) {
  const delivered = await deliverCallbackV07({ stateRoot, receipt: payload });
  await observeCallbackV07({ stateRoot, callbackId: delivered.callback_id, recipient });
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

async function noChangeAuthority(root, suffix, { retainWorktree = false } = {}) {
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.8.3-dev.0");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-archive-observed-"));
  const worktreePath = resolve(worktreeParent, "executor");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  git(root, ["worktree", "add", "-q", "--detach", worktreePath, baseline]);
  const observedWorktreePath = await realpath(worktreePath);
  const release = await acceptedRelease(root, suffix, { observedWorktreePath });
  const payload = receipt(release, {
    kind: "unchanged",
    baseline_revision: baseline,
    final_revision: baseline,
    branch: release.requestedSelectors.worktree.executor_branch,
    upstream: null,
    cleanliness: "clean",
  });
  const verification = await runCombinedVerification({
    stateRoot,
    repositoryPath: worktreePath,
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
  if (!retainWorktree) {
    git(root, ["worktree", "remove", worktreePath]);
    await rm(worktreeParent, { recursive: true, force: true });
  }
  return {
    stateRoot,
    release,
    payload,
    disposition,
    worktreePath: observedWorktreePath,
    worktreeParent,
  };
}

test("clean no-change visible task archives only after setter and independent observation", async () => {
  const root = await createGitFixture("codex-flow-v07-archive-");
  try {
    const authority = await noChangeAuthority(root, "no-change");
    await bindRecipient({ stateRoot: authority.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: authority.stateRoot,
      dispositionId: authority.disposition.disposition_id,
      taskObservation: activeObservation(authority.release.readyThreadId),
      hostId: "local",
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
    });
    assert.equal(replay.archive_id, prepared.archive_id);
    assert.equal(replay.call_required, false);
    await assert.rejects(
      prepareTaskArchive({
        stateRoot: authority.stateRoot,
        dispositionId: authority.disposition.disposition_id,
        taskObservation: activeObservation(authority.release.readyThreadId),
        hostId: "different-host",
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
    assert.equal(completed.worktree.management, "host-managed");
    assert.equal(completed.worktree.path, authority.worktreePath);
    assert.equal(completed.observation.worktree_state, "absent");
    assert.equal((await taskArchiveStatus({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
    })).state, "completed");
  } finally {
    await removeFixture(root);
  }
});

test("private archive observation completes archival when public task indexing is stale", async () => {
  const root = await createGitFixture("codex-flow-v07-private-archive-lifecycle-");
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-private-archive-home-"));
  try {
    const authority = await noChangeAuthority(root, "private-observation");
    await bindRecipient({ stateRoot: authority.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: authority.stateRoot,
      dispositionId: authority.disposition.disposition_id,
      taskObservation: activeObservation(authority.release.readyThreadId),
    });
    await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
    });
    await writePrivateArchiveSession(codexHome, authority.release.readyThreadId);
    const observed = await observePrivateTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      codexHome,
    });
    assert.equal(observed.private_host_surface, true);
    assert.equal(observed.observation.source, "codex-app-private-archive-session-v1");
    const completed = await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: observed.observation,
    });
    assert.equal(completed.state, "completed");
    assert.equal(completed.observation.task.private_observation.thread_id, authority.release.readyThreadId);

    const forged = structuredClone(observed.observation);
    forged.private_observation.binding_digest = "f".repeat(64);
    await assert.rejects(
      reconcileTaskArchive({
        stateRoot: authority.stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
        observation: forged,
      }),
      /binding_digest is invalid/,
    );
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(root);
  }
});

test("private archive evidence does not bypass host-managed worktree reclamation", async () => {
  const root = await createGitFixture("codex-flow-v07-private-archive-worktree-");
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-private-archive-worktree-home-"));
  let authority = null;
  try {
    authority = await noChangeAuthority(root, "private-worktree", { retainWorktree: true });
    await bindRecipient({ stateRoot: authority.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: authority.stateRoot,
      dispositionId: authority.disposition.disposition_id,
      taskObservation: activeObservation(authority.release.readyThreadId),
    });
    await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
    });
    await writePrivateArchiveSession(codexHome, authority.release.readyThreadId);
    const observed = await observePrivateTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      codexHome,
    });
    const pending = await reconcileTaskArchive({
      stateRoot: authority.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: observed.observation,
    });
    assert.equal(pending.state, "archived-awaiting-worktree-reclamation");
    assert.equal(pending.keep_visible, false);
    assert.equal(pending.observation.worktree_state, "present");
  } finally {
    if (authority !== null && await realpath(authority.worktreePath).catch(() => null)) {
      try {
        git(root, ["worktree", "remove", "--force", authority.worktreePath]);
      } catch {
        // Fixture cleanup only; the assertion path reports the causal failure.
      }
    }
    if (authority !== null) {
      await rm(authority.worktreeParent, { recursive: true, force: true });
    }
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(root);
  }
});

test("local task archive does not claim host-managed worktree authority", async () => {
  const root = await createGitFixture("codex-flow-v07-archive-unobserved-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.8.3-dev.0");
    const release = await acceptedRelease(root, "unobserved");
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
        check_id: "archive-unobserved-pass",
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
    });
    const { disposition } = await observedDisposition({
      stateRoot,
      payload,
      decision: "accepted-no-change",
      verificationId: verification.verification_id,
    });
    const prepared = await prepareTaskArchive({
      stateRoot,
      dispositionId: disposition.disposition_id,
      taskObservation: activeObservation(release.readyThreadId),
    });
    assert.equal(prepared.worktree.management, "none");
    assert.equal(prepared.worktree.path, null);
  } finally {
    await removeFixture(root);
  }
});

test("archived host-worktree task waits durably for asynchronous reclamation", async () => {
  const root = await createGitFixture("codex-flow-v07-archive-integrated-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-archive-worktree-"));
  const worktreePath = resolve(worktreeParent, "executor");
  try {
    await writeFile(resolve(root, ".gitignore"), "*.ignored\n", "utf8");
    git(root, ["add", ".gitignore"]);
    git(root, ["commit", "--quiet", "-m", "ignore generated archive artifacts"]);
    const stateRoot = resolve(root, ".git", "codex-flow", "v0.8.3-dev.0");
    const baseline = git(root, ["rev-parse", "HEAD"]);
    const executorBranch = "codex/archive-integrated";
    git(root, ["worktree", "add", "-q", "--detach", worktreePath, baseline]);
    const release = await acceptedRelease(root, "integrated", {
      executorBranch,
      observedWorktreePath: await realpath(worktreePath),
      task: { write_paths: ["archive-result.txt"] },
    });
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
        worktree: { management: "none", path: null },
      }),
      /Archive preparation request field is not allowed: worktree/,
    );
    await assert.rejects(
      prepareTaskArchive({
        stateRoot,
        dispositionId: disposition.disposition_id,
        taskObservation: activeObservation(release.readyThreadId),
      }),
      /Dirty worktree must remain visible/,
    );
    await rm(driftPath);
    const ignoredPath = resolve(worktreePath, "archive-generated.ignored");
    await writeFile(ignoredPath, "generated\n", "utf8");
    assert.equal(
      git(worktreePath, ["check-ignore", "archive-generated.ignored"]),
      "archive-generated.ignored",
    );
    assert.equal(await readFile(ignoredPath, "utf8"), "generated\n");
    const prepared = await prepareTaskArchive({
      stateRoot,
      dispositionId: disposition.disposition_id,
      taskObservation: activeObservation(release.readyThreadId),
    });
    assert.equal(prepared.worktree.prepared_state, "present-clean");
    await reconcileTaskArchive({
      stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
    });
    const pending = await reconcileTaskArchive({
      stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: archivedObservation(release.readyThreadId),
    });
    assert.equal(pending.state, "archived-awaiting-worktree-reclamation");
    assert.equal(pending.call_required, false);
    assert.equal(pending.keep_visible, false);
    assert.equal(pending.observation.worktree_state, "present");
    assert.deepEqual(
      await reconcileTaskArchive({
        stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
        observation: archivedObservation(release.readyThreadId),
      }),
      pending,
    );
    assert.deepEqual(
      await reconcileTaskArchive({
        stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
      }),
      pending,
    );
    assert.equal((await taskArchiveStatus({
      stateRoot,
      archiveId: prepared.archive_id,
    })).state, "archived-awaiting-worktree-reclamation");
    git(root, ["worktree", "remove", worktreePath]);
    const completed = await reconcileTaskArchive({
      stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "accepted",
      observation: archivedObservation(release.readyThreadId),
    });
    assert.equal(completed.state, "completed");
    assert.equal(completed.keep_visible, false);
    assert.equal(completed.observation.worktree_state, "absent");
    await mkdir(worktreePath);
    await assert.rejects(
      reconcileTaskArchive({
        stateRoot,
        archiveId: prepared.archive_id,
        attemptId: prepared.host_intent.attempt_id,
        outcome: "accepted",
        observation: archivedObservation(release.readyThreadId),
      }),
      /postcondition is no longer true/,
    );
    await rm(worktreePath, { recursive: true, force: true });
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
  const blockedRoot = await createGitFixture("codex-flow-v07-archive-blocked-");
  const ambiguousRoot = await createGitFixture("codex-flow-v07-archive-ambiguous-");
  let ambiguousAuthority = null;
  try {
    const blockedState = resolve(blockedRoot, ".git", "codex-flow", "v0.8.3-dev.0");
    const blockedRelease = await acceptedRelease(blockedRoot, "blocked");
    const baseline = git(blockedRoot, ["rev-parse", "HEAD"]);
    const blockedPayload = receipt(blockedRelease, {
      kind: "dirty-blocked",
      baseline_revision: baseline,
      commit: baseline,
      branch: blockedRelease.requestedSelectors.worktree.executor_branch,
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
      }),
      /must remain visible/,
    );

    const ambiguous = await noChangeAuthority(ambiguousRoot, "ambiguous", {
      retainWorktree: true,
    });
    ambiguousAuthority = ambiguous;
    await bindRecipient({ stateRoot: ambiguous.stateRoot, recipient });
    const prepared = await prepareTaskArchive({
      stateRoot: ambiguous.stateRoot,
      dispositionId: ambiguous.disposition.disposition_id,
      taskObservation: activeObservation(ambiguous.release.readyThreadId),
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
    assert.equal(observedAfterAmbiguity.state, "archived-awaiting-worktree-reclamation");
    assert.equal(observedAfterAmbiguity.keep_visible, false);
    assert.equal(observedAfterAmbiguity.observation.worktree_state, "present");
    git(ambiguousRoot, ["worktree", "remove", ambiguous.worktreePath]);
    const completedAfterAmbiguity = await reconcileTaskArchive({
      stateRoot: ambiguous.stateRoot,
      archiveId: prepared.archive_id,
      attemptId: prepared.host_intent.attempt_id,
      outcome: "ambiguous",
      observation: archivedObservation(ambiguous.release.readyThreadId),
    });
    assert.equal(completedAfterAmbiguity.state, "completed");
    assert.equal(completedAfterAmbiguity.observation.worktree_state, "absent");
    await rm(ambiguous.worktreeParent, { recursive: true, force: true });
    ambiguousAuthority = null;
  } finally {
    if (ambiguousAuthority !== null) {
      if (await realpath(ambiguousAuthority.worktreePath).catch(() => null)) {
        try {
          git(ambiguousRoot, ["worktree", "remove", "--force", ambiguousAuthority.worktreePath]);
        } catch {
          // Fixture cleanup only; the assertion path reports the causal failure.
        }
      }
      await rm(ambiguousAuthority.worktreeParent, { recursive: true, force: true });
    }
    await removeFixture(blockedRoot);
    await removeFixture(ambiguousRoot);
  }
});
