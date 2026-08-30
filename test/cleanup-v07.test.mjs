import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
} from "../lib/archive-lifecycle.mjs";
import { deliverCallbackV07, observeCallbackV07 } from "../lib/callbacks-v07.mjs";
import {
  cleanupPlanDigestV07,
  cleanupPlanV07,
  validateCleanupPlanV07,
} from "../lib/cleanup-v07.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
} from "../lib/dispositions.mjs";
import {
  runLifecyclePath,
  validateRunLifecycleState,
} from "../lib/run-lifecycle.mjs";
import { validateVisibleTaskCreationRecord } from "../lib/task-creation-v07.mjs";
import { runCombinedVerification } from "../lib/verifications-v07.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v07-lifecycle-fixture.mjs";

const CLOCK = Date.parse("2026-08-29T20:00:07.000Z");
const recipient = {
  lineage_id: "cleanup-lineage-v07",
  thread_id: "cleanup-coordinator-v07",
  generation: 1,
};

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
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

async function persistObservedWorktree(context, worktreePath) {
  const path = resolve(
    context.stateRoot,
    "visible-task-creations",
    "records",
    `${context.creation.operation_id}.json`,
  );
  const raw = JSON.parse(await readFile(path, "utf8"));
  const canonicalPath = await realpath(worktreePath);
  const record = validateVisibleTaskCreationRecord({
    ...raw,
    selector_evidence: {
      ...raw.selector_evidence,
      observed: {
        project_id: context.requestedSelectors.project_id,
        model: context.requestedSelectors.model,
        reasoning_effort: context.requestedSelectors.reasoning_effort,
        worktree: {
          ...context.requestedSelectors.worktree,
          path: canonicalPath,
        },
        observed_at: raw.updated_at,
      },
    },
  });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  context.creation = record;
  return canonicalPath;
}

async function fileSnapshot(root) {
  const entries = [];
  async function walk(directory, relative = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const child = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(child, childRelative);
      else if (entry.isFile()) entries.push([childRelative, (await readFile(child)).toString("base64")]);
      else entries.push([childRelative, entry.isSymbolicLink() ? "symlink" : "special"]);
    }
  }
  await walk(root);
  return entries;
}

async function completedArchiveFixture(root, remoteRoot) {
  git(resolve(remoteRoot, ".."), ["init", "--bare", "--quiet", remoteRoot]);
  git(root, ["remote", "add", "origin", remoteRoot]);
  const branch = "codex/cleanup-v07-candidate";
  const context = await createAcceptedVisibleTask(root, "cleanup-plan", {
    coordinator: recipient,
    executorBranch: branch,
  });
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-cleanup-worktree-"));
  const worktreePath = resolve(worktreeParent, "executor");
  git(root, ["worktree", "add", "-q", "-b", branch, worktreePath, "main"]);
  const originalPath = await persistObservedWorktree(context, worktreePath);
  git(worktreePath, ["push", "-q", "-u", "origin", branch]);
  const upstream = git(worktreePath, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const payload = terminalReceipt(context, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch,
    upstream,
    cleanliness: "clean",
  });
  payload.model_evidence.observed = {
    model: context.requestedSelectors.model,
    reasoning_effort: context.requestedSelectors.reasoning_effort,
  };
  let clock = CLOCK;
  const verification = await runCombinedVerification({
    stateRoot: context.stateRoot,
    repositoryPath: worktreePath,
    receipt: payload,
    checks: [{
      check_id: "cleanup-v07-no-change",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
    now: () => clock++,
  });
  const delivered = await deliverCallbackV07({
    stateRoot: context.stateRoot,
    receipt: payload,
    now: CLOCK + 10,
  });
  await observeCallbackV07({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    recipient,
    now: CLOCK + 20,
  });
  const preparedDisposition = await prepareTaskDisposition({
    stateRoot: context.stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-no-change",
    reason: "Cleanup planner test accepts the exact unchanged result.",
    now: CLOCK + 30,
  });
  const disposition = await finalizeTaskDisposition({
    stateRoot: context.stateRoot,
    dispositionId: preparedDisposition.disposition_id,
    recipient,
    executorThreadId: context.readyThreadId,
    verificationId: verification.verification_id,
    now: CLOCK + 40,
  });
  git(root, ["worktree", "remove", worktreePath]);
  await rm(worktreeParent, { recursive: true, force: true });
  const preparedArchive = await prepareTaskArchive({
    stateRoot: context.stateRoot,
    dispositionId: disposition.disposition_id,
    taskObservation: activeObservation(context.readyThreadId),
    hostId: "local",
    now: CLOCK + 50,
  });
  await reconcileTaskArchive({
    stateRoot: context.stateRoot,
    archiveId: preparedArchive.archive_id,
    attemptId: preparedArchive.host_intent.attempt_id,
    outcome: "accepted",
    observation: archivedObservation(context.readyThreadId),
    now: CLOCK + 60,
  });
  return { ...context, branch, upstream, originalPath, archiveId: preparedArchive.archive_id };
}

test("v0.7 cleanup plan is deterministic, read-only, and blocks closure until exact candidate cleanup", async () => {
  const root = await createGitFixture("codex-flow-v07-cleanup-plan-");
  const remoteParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-cleanup-remote-"));
  const remoteRoot = resolve(remoteParent, "origin.git");
  const alternateParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-cleanup-alternate-"));
  const alternatePath = resolve(alternateParent, "executor");
  try {
    const context = await completedArchiveFixture(root, remoteRoot);
    const beforeState = await fileSnapshot(context.stateRoot);
    const beforeRefs = git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]);
    const beforeWorktrees = git(root, ["worktree", "list", "--porcelain"]);
    const first = await cleanupPlanV07({ stateRoot: context.stateRoot, runId: context.contract.run_id });
    const second = await cleanupPlanV07({ stateRoot: context.stateRoot, runId: context.contract.run_id });
    assert.deepEqual(second, first);
    assert.deepEqual(validateCleanupPlanV07(first), first);
    assert.equal(cleanupPlanDigestV07(first), first.plan_id.slice("cleanup-plan-v1-".length));
    assert.equal(first.mutation_performed, false);
    const [item] = first.items;
    assert.equal(item.classification, "cleanup-ready", JSON.stringify(item, null, 2));
    assert.deepEqual(first.counts, {
      host_worktree_tasks: 1,
      unbound_branch_fences: 0,
      cleanup_required: 1,
      cleanup_candidates: 1,
      close_blocked: 1,
    });
    assert.equal(item.candidate, true);
    assert.equal(item.close_blocked, true);
    assert.equal(item.branch, context.branch);
    assert.equal(item.expected_tip, context.baseline);
    assert.deepEqual(item.local_ref, { exists: true, tip: context.baseline });
    assert.deepEqual(item.worktree, {
      original_path: context.originalPath,
      original_path_state: "absent",
      attachments: [],
    });
    assert.equal(item.upstream.expected, context.upstream);
    assert.equal(item.upstream.configured, context.upstream);
    assert.equal(item.upstream.remote_tip, context.baseline);
    assert.equal(item.upstream.state, "exact");
    assert.equal(item.archive.state, "completed");
    assert.equal(item.archive.worktree_state, "absent");
    assert.deepEqual(await fileSnapshot(context.stateRoot), beforeState);
    assert.equal(git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]), beforeRefs);
    assert.equal(git(root, ["worktree", "list", "--porcelain"]), beforeWorktrees);

    git(root, ["worktree", "add", "-q", alternatePath, context.branch]);
    const attached = await cleanupPlanV07({ stateRoot: context.stateRoot, runId: context.contract.run_id });
    assert.equal(attached.items[0].classification, "cleanup-blocked");
    assert.equal(attached.items[0].candidate, false);
    assert.ok(attached.items[0].reason_codes.includes("branch-attached-worktree"));
    assert.equal(attached.items[0].worktree.attachments[0].path, await realpath(alternatePath));
  } finally {
    if (await realpath(alternatePath).catch(() => null)) {
      try {
        git(root, ["worktree", "remove", "--force", alternatePath]);
      } catch {
        // Temporary fixture teardown only.
      }
    }
    await removeFixture(root);
    await rm(remoteParent, { recursive: true, force: true });
    await rm(alternateParent, { recursive: true, force: true });
  }
});

test("every unbound run branch fence is represented and a live one blocks closure", async () => {
  const root = await createGitFixture("codex-flow-v07-cleanup-fence-");
  try {
    const context = await createAcceptedVisibleTask(root, "cleanup-fence", {
      coordinator: recipient,
      executorBranch: "codex/cleanup-bound-task",
    });
    const commonDir = await realpath(resolve(root, ".git"));
    const path = runLifecyclePath(commonDir);
    const lifecycle = validateRunLifecycleState(JSON.parse(await readFile(path, "utf8")));
    const branch = "codex/cleanup-unbound-live";
    lifecycle.runs[context.contract.run_id].plan.branch_fences = [branch];
    await writeFile(path, `${JSON.stringify(validateRunLifecycleState(lifecycle), null, 2)}\n`, "utf8");
    git(root, ["branch", branch]);
    const live = await cleanupPlanV07({ stateRoot: context.stateRoot, runId: context.contract.run_id });
    assert.deepEqual(live.branch_fences, [branch]);
    assert.deepEqual(live.blocking_branch_fences, [branch]);
    assert.equal(live.unbound_branch_fences[0].close_blocked, true);
    assert.deepEqual(live.unbound_branch_fences[0].reason_codes, ["unbound-branch-fence-live"]);
    assert.equal(live.counts.unbound_branch_fences, 1);

    git(root, ["branch", "-D", branch]);
    const absent = await cleanupPlanV07({ stateRoot: context.stateRoot, runId: context.contract.run_id });
    assert.deepEqual(absent.blocking_branch_fences, []);
    assert.equal(absent.unbound_branch_fences[0].close_blocked, false);
    assert.deepEqual(absent.unbound_branch_fences[0].reason_codes, ["unbound-branch-fence-resolved"]);
  } finally {
    await removeFixture(root);
  }
});
