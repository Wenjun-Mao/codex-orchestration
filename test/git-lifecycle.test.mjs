import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { defaultProjectConfig } from "../lib/config.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  applyGitCleanupPlan,
  authorizeGitBoundTaskRelease,
  bindGitOwnership,
  createGitCleanupPlan,
  GitCleanupApplyError,
  gitLifecycleAudit,
  gitLifecycleReadiness,
  recordGitIntegration,
} from "../lib/git-lifecycle.mjs";
import {
  beginTaskOperationAttempt,
  prepareTaskOperation,
  recordTaskOperationHostPreflight,
  rejectTaskOperationBeforeRelease,
  reconcileTaskOperation,
  taskOperationStatus,
} from "../lib/task-operations.mjs";
import { acquireLease, releaseLease } from "../lib/leases.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fixture() {
  const root = await createGitFixture("codex-flow-git-life-");
  const bare = await mkdtemp(resolve(tmpdir(), "codex-flow-git-remote-"));
  const worktreeRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-git-worktrees-"));
  const worktree = resolve(worktreeRoot, "executor");
  git(bare, ["init", "--quiet", "--bare"]);
  git(root, ["remote", "add", "origin", bare]);
  git(root, ["push", "-u", "origin", "main"]);
  git(root, ["worktree", "add", "-q", "-b", "codex/fixture-task", worktree, "main"]);
  return {
    root,
    bare,
    worktreeRoot,
    worktree: await realpath(worktree),
    config: defaultProjectConfig(root),
  };
}

async function dispose(value) {
  if (value?.root && value?.worktree) {
    spawnSync("git", ["worktree", "remove", "--force", value.worktree], { cwd: value.root });
  }
  if (value?.root) await removeFixture(value.root);
  if (value?.bare) await rm(value.bare, { recursive: true, force: true });
  if (value?.worktreeRoot) await rm(value.worktreeRoot, { recursive: true, force: true });
}

function packet(worktree, revision, suffix) {
  return {
    schema_version: 5,
    task_id: `git-executor-${suffix}`,
    run_id: `run-git-${suffix}`,
    role: "executor",
    execution_kind: "task-thread",
    title: `Git executor ${suffix}`,
    objective: "Exercise bounded Git lifecycle ownership.",
    baseline: { revision, cleanliness: "clean" },
    environment: { type: "local", project_path: worktree },
    host_placement: {
      mode: "same-project",
      target_project_id: "saved-project-git-lifecycle",
      reason: null,
    },
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    launch_deadline: { at: "2030-08-24T17:00:00-04:00", timezone: "America/Toronto" },
    ownership: { write_paths: ["src/fixture"], read_paths: ["src"], exclusions: [] },
    dependencies: [],
    shared_resources: [],
    verification: ["Inspect Git lifecycle state."],
    callback: {
      recipient: { lineage_id: "coordinator", thread_id: "coordinator-thread", generation: 1 },
      executor_id: `git-executor-${suffix}`,
      receipt_schema_version: 2,
    },
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "journal-monitor",
    },
    integration_gate: { gate_id: `git-gate-${suffix}`, reproof: ["Recheck main."] },
    cleanup_owner: "coordinator",
  };
}

function hostWorktreePacket(value, suffix) {
  return {
    ...packet(value.root, git(value.root, ["rev-parse", "refs/heads/main"]), suffix),
    environment: {
      type: "host-worktree",
      repository_path: value.root,
      starting_branch: "main",
      executor_branch: `codex/host-${suffix}`,
    },
  };
}

function capability(suffix, environmentType = "local") {
  return {
    schema_version: 3,
    adapter_id: "codex-desktop-host",
    host_session_id: `host-session-${suffix}`,
    checked_at: "2026-08-24T12:00:00Z",
    execution_kind: "task-thread",
    environment_type: environmentType,
    placement_mode: "same-project",
    support: {
      execution_kind: { state: "supported", basis: "host-contract" },
      environment: { state: "supported", basis: "tool-schema" },
      execution_path: environmentType === "host-worktree"
        ? { state: "supported", basis: "host-contract" }
        : { state: "not-required", basis: "not-required" },
      project_placement: { state: "supported", basis: "tool-schema" },
      model: { state: "supported", basis: "open-selector" },
      reasoning_effort: { state: "supported", basis: "open-selector" },
    },
    thread_discovery: { query: "rejected", fallback: "bounded-unfiltered" },
  };
}

function observation(title, executionPath = null) {
  return {
    schema_version: 3,
    title: { source: "host-observed", value: title, normalization: "none" },
    visibility: { source: "host-observed", value: true },
    model: { source: "host-observed", value: "gpt-5.6-terra" },
    reasoning_effort: { source: "host-observed", value: "xhigh" },
    host_label: { source: "unavailable", value: null },
    execution_path: executionPath === null
      ? { source: "not-required", value: null }
      : { source: "host-observed", value: executionPath },
    project_placement: { source: "host-observed", value: "saved-project-git-lifecycle" },
  };
}

async function observedOperation(
  value,
  suffix = "a",
  environmentType = "local",
  bind = true,
  projectPath = value.worktree,
) {
  const controller = gitSnapshot(value.root);
  const revision = git(projectPath, ["rev-parse", "HEAD"]);
  const request = packet(projectPath, revision, suffix);
  request.environment.type = environmentType;
  const prepared = await prepareTaskOperation({
    stateRoot: controller.stateRoot,
    projectId: "fixture-project",
    packet: request,
  });
  await recordTaskOperationHostPreflight({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
    evidence: capability(suffix),
  });
  const attempt = await beginTaskOperationAttempt({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
  });
  await reconcileTaskOperation({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
    attemptId: attempt.attempt.attempt_id,
    outcome: "observed",
    objectId: `thread-${suffix}`,
    actualKind: "task-thread",
    evidence: observation(request.title),
  });
  if (bind) {
    await bindGitOwnership({
      git: controller,
      operationId: prepared.operation_id,
    });
  }
  return prepared.operation_id;
}

async function observedHostWorktree(
  value,
  suffix = "host",
  executionPath = value.worktree,
  evidenceOverrides = {},
) {
  const controller = gitSnapshot(value.root);
  const request = hostWorktreePacket(value, suffix);
  const prepared = await prepareTaskOperation({
    stateRoot: controller.stateRoot,
    projectId: "fixture-project",
    packet: request,
  });
  await recordTaskOperationHostPreflight({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
    evidence: capability(suffix, "host-worktree"),
  });
  const attempt = await beginTaskOperationAttempt({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
  });
  await reconcileTaskOperation({
    stateRoot: controller.stateRoot,
    operationId: prepared.operation_id,
    attemptId: attempt.attempt.attempt_id,
    outcome: "observed",
    objectId: `thread-${suffix}`,
    actualKind: "task-thread",
    evidence: { ...observation(request.title, executionPath), ...evidenceOverrides },
  });
  return { controller, request, operationId: prepared.operation_id };
}

async function commitExecutor(value, suffix = "a") {
  await writeFile(resolve(value.worktree, `change-${suffix}.txt`), `${suffix}\n`, "utf8");
  git(value.worktree, ["add", `change-${suffix}.txt`]);
  git(value.worktree, ["commit", "--quiet", "-m", `executor ${suffix}`]);
  git(value.worktree, ["push", "-u", "origin", "codex/fixture-task"]);
  return git(value.worktree, ["rev-parse", "HEAD"]);
}

async function mergeAndRecord(value, operationId) {
  git(value.root, ["merge", "--ff-only", "codex/fixture-task"]);
  git(value.root, ["push", "origin", "main"]);
  return recordGitIntegration({
    git: gitSnapshot(value.root),
    operationId,
    mainBranch: "main",
  });
}

test("host-created worktree binds only from observed path and gates task release", async () => {
  const value = await fixture();
  try {
    git(value.worktree, ["switch", "--detach", "main"]);
    const observed = await observedHostWorktree(value, "two-phase");
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: observed.controller,
        operationId: observed.operationId,
        packet: observed.request,
      }),
      /requires bound Git ownership/,
    );
    const ownership = await bindGitOwnership({
      git: observed.controller,
      operationId: observed.operationId,
    });
    assert.equal(ownership.worktree_path, value.worktree);
    assert.equal(ownership.branch, "codex/host-two-phase");
    assert.equal(ownership.initial_revision, observed.request.baseline.revision);
    assert.equal(git(value.worktree, ["branch", "--show-current"]), "codex/host-two-phase");
    const released = await authorizeGitBoundTaskRelease({
      git: observed.controller,
      operationId: observed.operationId,
      packet: observed.request,
    });
    assert.equal(released.object_id, "thread-two-phase");
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: observed.controller,
        operationId: observed.operationId,
        packet: { ...observed.request, objective: "A replayed packet with different authority." },
      }),
      /does not match the prepared operation/,
    );
    await writeFile(resolve(value.worktree, "premature.txt"), "premature\n", "utf8");
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: observed.controller,
        operationId: observed.operationId,
        packet: observed.request,
      }),
      /drifted after Git ownership binding/,
    );
  } finally {
    await dispose(value);
  }
});

test("policy-rejected host placement is journaled, blocks bind and release, then settles after archive", async () => {
  const value = await fixture();
  try {
    const observed = await observedHostWorktree(
      value,
      "placement-rejected",
      resolve(value.root, "archived-placement-worktree"),
      {
        project_placement: { source: "host-observed", value: "different-saved-project" },
      },
    );
    const status = (await taskOperationStatus({
      stateRoot: observed.controller.stateRoot,
      operationId: observed.operationId,
    }))[0];
    assert.equal(status.status, "observed");
    assert.equal(status.attempts.at(-1).status, "observed");
    assert.equal(status.observed.object_id, "thread-placement-rejected");
    assert.deepEqual(status.observation_policy, {
      state: "rejected",
      reason_code: "project-placement-mismatch",
    });
    await assert.rejects(
      bindGitOwnership({ git: observed.controller, operationId: observed.operationId }),
      /requires accepted host observation policy: project-placement-mismatch/,
    );
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: observed.controller,
        operationId: observed.operationId,
        packet: observed.request,
      }),
      /requires accepted host observation policy: project-placement-mismatch/,
    );
    const rejected = await rejectTaskOperationBeforeRelease({
      stateRoot: observed.controller.stateRoot,
      operationId: observed.operationId,
      reasonCode: "host-placement-rejected",
      hostObjectState: "archived",
    });
    assert.equal(rejected.status, "rejected-before-release");
    assert.deepEqual(rejected.observation_policy, {
      state: "rejected",
      reason_code: "project-placement-mismatch",
    });
  } finally {
    await dispose(value);
  }
});

test("rejection and Git binding share one mutation boundary", async () => {
  const value = await fixture();
  try {
    const rejectedHost = await observedHostWorktree(
      value,
      "rejected-release",
      resolve(value.root, "archived-host-worktree"),
    );
    await rejectTaskOperationBeforeRelease({
      stateRoot: rejectedHost.controller.stateRoot,
      operationId: rejectedHost.operationId,
      reasonCode: "operator-cancelled",
      hostObjectState: "archived",
    });
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: rejectedHost.controller,
        operationId: rejectedHost.operationId,
        packet: rejectedHost.request,
      }),
      /requires an observed task operation/,
    );

    const operationId = await observedOperation(value, "rejection-race", "local", false);
    let releaseBinding;
    const holdBinding = new Promise((resolveBinding) => {
      releaseBinding = resolveBinding;
    });
    let bindingPaused;
    const bindingReady = new Promise((resolveBindingReady) => {
      bindingPaused = resolveBindingReady;
    });
    const binding = bindGitOwnership({
      git: gitSnapshot(value.root),
      operationId,
      hooks: {
        async beforeMutationLock() {
          bindingPaused();
          await holdBinding;
        },
      },
    });
    await bindingReady;
    const rejected = await rejectTaskOperationBeforeRelease({
      stateRoot: gitSnapshot(value.root).stateRoot,
      operationId,
      reasonCode: "operator-cancelled",
      hostObjectState: "archived",
    });
    releaseBinding();
    await assert.rejects(binding, /requires an observed task operation/);
    assert.equal(rejected.status, "rejected-before-release");
    assert.equal((await taskOperationStatus({
      stateRoot: gitSnapshot(value.root).stateRoot,
      operationId,
    }))[0].status, "rejected-before-release");
    const lifecycle = await gitLifecycleAudit({
      git: gitSnapshot(value.root),
      config: value.config,
      inspectRemotes: false,
    });
    assert.equal(lifecycle.items.some((item) => item.operation_id === operationId), false);
  } finally {
    await dispose(value);
  }
});

test("host-created worktree rejects source checkout and pre-bind dirt", async () => {
  const sourcePath = await fixture();
  const dirtyTarget = await fixture();
  const unrelatedTarget = await fixture();
  try {
    const sourceObserved = await observedHostWorktree(sourcePath, "source-path", sourcePath.root);
    await assert.rejects(
      bindGitOwnership({ git: sourceObserved.controller, operationId: sourceObserved.operationId }),
      /distinct from its source repository path/,
    );

    git(dirtyTarget.worktree, ["switch", "--detach", "main"]);
    const dirtyObserved = await observedHostWorktree(dirtyTarget, "dirty-path");
    await writeFile(resolve(dirtyTarget.worktree, "before-bind.txt"), "dirty\n", "utf8");
    await assert.rejects(
      bindGitOwnership({ git: dirtyObserved.controller, operationId: dirtyObserved.operationId }),
      /changed before Git ownership binding/,
    );

    const unrelatedObserved = await observedHostWorktree(
      sourcePath,
      "unrelated-path",
      unrelatedTarget.worktree,
    );
    await assert.rejects(
      bindGitOwnership({
        git: unrelatedObserved.controller,
        operationId: unrelatedObserved.operationId,
      }),
      /different Git repository/,
    );
  } finally {
    await dispose(sourcePath);
    await dispose(dirtyTarget);
    await dispose(unrelatedTarget);
  }
});

test("host-created worktree rejects unexpected or newly unavailable executor branches", async () => {
  const unexpected = await fixture();
  const raced = await fixture();
  try {
    const unexpectedObserved = await observedHostWorktree(unexpected, "unexpected");
    await assert.rejects(
      bindGitOwnership({
        git: unexpectedObserved.controller,
        operationId: unexpectedObserved.operationId,
      }),
      /unexpected named branch/,
    );
    git(unexpected.worktree, ["switch", "--detach", "main"]);
    git(unexpected.worktree, [
      "switch", "--no-track", "-c", unexpectedObserved.request.environment.executor_branch, "main",
    ]);
    await assert.rejects(
      bindGitOwnership({
        git: unexpectedObserved.controller,
        operationId: unexpectedObserved.operationId,
      }),
      /unexpected named branch/,
    );

    git(raced.worktree, ["switch", "--detach", "main"]);
    const racedObserved = await observedHostWorktree(raced, "raced");
    git(raced.root, ["branch", racedObserved.request.environment.executor_branch, "main"]);
    await assert.rejects(
      bindGitOwnership({ git: racedObserved.controller, operationId: racedObserved.operationId }),
      /became unavailable/,
    );
    assert.equal(git(raced.worktree, ["branch", "--show-current"]), "");
  } finally {
    await dispose(unexpected);
    await dispose(raced);
  }
});

test("host-created worktree resumes only from its persisted branch-claim receipt", async () => {
  const value = await fixture();
  try {
    git(value.worktree, ["switch", "--detach", "main"]);
    const observed = await observedHostWorktree(value, "claim-recovery");
    await assert.rejects(
      bindGitOwnership({
        git: observed.controller,
        operationId: observed.operationId,
        hooks: {
          afterBranchClaim() {
            throw new Error("simulated post-claim interruption");
          },
        },
      }),
      /simulated post-claim interruption/,
    );
    assert.equal(git(value.worktree, ["branch", "--show-current"]), "codex/host-claim-recovery");
    git(value.worktree, ["switch", "--detach", "main"]);
    assert.equal(git(value.worktree, ["branch", "--show-current"]), "");
    await assert.rejects(
      authorizeGitBoundTaskRelease({
        git: observed.controller,
        operationId: observed.operationId,
        packet: observed.request,
      }),
      /requires bound Git ownership/,
    );
    const interruptedAudit = await gitLifecycleAudit({
      git: observed.controller,
      config: value.config,
      inspectRemotes: false,
    });
    assert.equal(interruptedAudit.incomplete_claim_count, 1);
    assert.equal(interruptedAudit.blocked, true);
    await assert.rejects(
      rejectTaskOperationBeforeRelease({
        stateRoot: observed.controller.stateRoot,
        operationId: observed.operationId,
        reasonCode: "operator-cancelled",
        hostObjectState: "archived",
      }),
      /branch claim requires recovery/,
    );
    assert.equal((await taskOperationStatus({
      stateRoot: observed.controller.stateRoot,
      operationId: observed.operationId,
    }))[0].status, "observed");
    const ownership = await bindGitOwnership({
      git: observed.controller,
      operationId: observed.operationId,
    });
    assert.equal(ownership.branch, "codex/host-claim-recovery");
    const recoveredAudit = await gitLifecycleAudit({
      git: observed.controller,
      config: value.config,
      inspectRemotes: false,
    });
    assert.equal(recoveredAudit.incomplete_claim_count, 0);
  } finally {
    await dispose(value);
  }
});

test("cleanup plan removes only a proven merged worktree and exact local/remote refs", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "cleanup");
    await assert.rejects(
      observedOperation(value, "duplicate-owner"),
      /already owned by another task operation/,
    );
    await commitExecutor(value, "cleanup");
    const rebound = await bindGitOwnership({
      git: gitSnapshot(value.root),
      operationId,
    });
    assert.equal(rebound.executor_id, "git-executor-cleanup");
    const integration = await mergeAndRecord(value, operationId);
    assert.equal(integration.disposition, "ancestor");
    const audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.eligible_count, 1);
    const plan = await createGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      operationIds: [operationId],
      mainBranch: "main",
      includeRemote: true,
    });
    let interrupted = false;
    let partialFailure;
    try {
      await applyGitCleanupPlan({
        git: gitSnapshot(value.root),
        config: value.config,
        expectedPlanId: plan.plan_id,
        operationIds: [operationId],
        mainBranch: "main",
        includeRemote: true,
        hooks: {
          afterAction({ action }) {
            if (action === "worktree-remove" && !interrupted) {
              interrupted = true;
              throw undefined;
            }
          },
        },
      });
    } catch (error) {
      partialFailure = error;
    }
    assert.equal(partialFailure instanceof GitCleanupApplyError, true);
    assert.equal(partialFailure.result.status, "partial");
    assert.equal(partialFailure.result.plan_id, plan.plan_id);
    assert.deepEqual(partialFailure.result.completed_actions, [`${operationId}:worktree-remove`]);
    assert.equal(partialFailure.result.failed_action, `${operationId}:worktree-remove:post-action`);
    assert.equal(partialFailure.result.error, "Unknown cleanup failure");
    assert.match(partialFailure.message, /Unknown cleanup failure/);
    await assert.rejects(applyGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      expectedPlanId: plan.plan_id,
      operationIds: [operationId],
      mainBranch: "main",
      includeRemote: true,
    }), /Cleanup plan changed/);
    const replacement = await createGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      operationIds: [operationId],
      mainBranch: "main",
      includeRemote: true,
    });
    const completed = await applyGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      expectedPlanId: replacement.plan_id,
      operationIds: [operationId],
      mainBranch: "main",
      includeRemote: true,
    });
    assert.equal(completed.status, "complete");
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "refs/heads/codex/fixture-task"], { cwd: value.root }).status, 128);
    assert.equal(spawnSync("git", ["ls-remote", "--exit-code", "origin", "refs/heads/codex/fixture-task"], { cwd: value.root }).status, 2);
    assert.equal(git(value.root, ["worktree", "list", "--porcelain"]).includes(value.worktree), false);
    const readiness = await gitLifecycleReadiness({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(readiness.backlog_count, 0);
  } finally {
    await dispose(value);
  }
});

test("audit preserves dirty, current, and remote-drifted task state", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "guard");
    await commitExecutor(value, "guard");
    await mergeAndRecord(value, operationId);
    await writeFile(resolve(value.worktree, "dirty.txt"), "dirty\n", "utf8");
    let audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.deepEqual(audit.items[0].blockers.includes("worktree-dirty"), true);
    assert.equal(audit.backlog_count, 1);
    await rm(resolve(value.worktree, "dirty.txt"));

    const fromExecutor = await gitLifecycleAudit({ git: gitSnapshot(value.worktree), config: value.config });
    assert.deepEqual(fromExecutor.items[0].blockers.includes("worktree-current"), true);
    assert.deepEqual(fromExecutor.items[0].blockers.includes("protected-branch"), true);

    await writeFile(resolve(value.root, "main-only.txt"), "main\n", "utf8");
    git(value.root, ["add", "main-only.txt"]);
    git(value.root, ["commit", "--quiet", "-m", "advance main"]);
    git(value.root, ["push", "origin", "main"]);
    git(value.root, ["push", "--force", "origin", "main:refs/heads/codex/fixture-task"]);
    audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.deepEqual(audit.items[0].blockers.includes("remote-tip-drift"), true);
    assert.equal(audit.items[0].eligible, false);
  } finally {
    await dispose(value);
  }
});

test("patch-equivalent and explicitly superseded integration are cleanup-safe", async () => {
  const patchValue = await fixture();
  try {
    const operationId = await observedOperation(patchValue, "patch");
    const executorTip = await commitExecutor(patchValue, "patch");
    await writeFile(resolve(patchValue.root, "unrelated.txt"), "main\n", "utf8");
    git(patchValue.root, ["add", "unrelated.txt"]);
    git(patchValue.root, ["commit", "--quiet", "-m", "unrelated main"]);
    git(patchValue.root, ["cherry-pick", executorTip]);
    git(patchValue.root, ["push", "origin", "main"]);
    const integration = await recordGitIntegration({
      git: gitSnapshot(patchValue.root),
      operationId,
      mainBranch: "main",
    });
    assert.equal(integration.disposition, "patch-equivalent");
  } finally {
    await dispose(patchValue);
  }

  const superseded = await fixture();
  try {
    const operationId = await observedOperation(superseded, "superseded");
    await commitExecutor(superseded, "superseded");
    await writeFile(resolve(superseded.root, "replacement.txt"), "replacement\n", "utf8");
    git(superseded.root, ["add", "replacement.txt"]);
    git(superseded.root, ["commit", "--quiet", "-m", "replacement"]);
    git(superseded.root, ["push", "origin", "main"]);
    const integration = await recordGitIntegration({
      git: gitSnapshot(superseded.root),
      operationId,
      mainBranch: "main",
      supersededBy: "HEAD",
    });
    assert.equal(integration.disposition, "superseded");
  } finally {
    await dispose(superseded);
  }
});

test("remote-only cleanup is explicit while task-wave readiness remains network-free", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "remote-only");
    await commitExecutor(value, "remote-only");
    await mergeAndRecord(value, operationId);
    git(value.root, ["worktree", "remove", value.worktree]);
    git(value.root, ["branch", "-d", "codex/fixture-task"]);
    value.config.git_lifecycle.warn_at = 1;
    value.config.git_lifecycle.block_at = 1;
    const readiness = await gitLifecycleReadiness({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(readiness.blocked, false);
    const audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.items[0].worktree_state, "missing");
    assert.equal(audit.items[0].local_tip, null);
    assert.equal(audit.items[0].eligible, true);
  } finally {
    await dispose(value);
  }
});

test("integration rejects an executor upstream changed after ownership binding", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "protected-upstream");
    await commitExecutor(value, "protected-upstream");
    git(value.root, ["branch", "--set-upstream-to=origin/main", "codex/fixture-task"]);
    git(value.root, ["merge", "--ff-only", "codex/fixture-task"]);
    git(value.root, ["push", "origin", "main"]);
    await assert.rejects(recordGitIntegration({
      git: gitSnapshot(value.root),
      operationId,
      mainBranch: "main",
    }), /upstream drifted/);
    const audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.items[0].classification, "active");
    assert.equal(audit.items[0].blockers.includes("integration-unrecorded"), true);
    assert.equal(audit.items[0].eligible, false);
  } finally {
    await dispose(value);
  }
});

test("ownership canonicalizes packet paths and rejects a first bind after branch advance", async () => {
  const value = await fixture();
  const aliasRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-git-alias-"));
  const alias = resolve(aliasRoot, "executor-link");
  try {
    const operationId = await observedOperation(value, "late", "local", false);
    await commitExecutor(value, "late-bind");
    await assert.rejects(bindGitOwnership({
      git: gitSnapshot(value.root),
      operationId,
    }), /before the executor branch advances/);

    await symlink(value.worktree, alias);
    const aliasOperation = await observedOperation(value, "alias", "local", true, alias);
    const bound = await bindGitOwnership({
      git: gitSnapshot(value.root),
      operationId: aliasOperation,
    });
    assert.equal(bound.worktree_path, value.worktree);
  } finally {
    await rm(aliasRoot, { recursive: true, force: true });
    await dispose(value);
  }
});

test("cleanup preserves ignored and config-hidden untracked worktree files", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "hidden-files");
    await commitExecutor(value, "hidden-files");
    await mergeAndRecord(value, operationId);

    await writeFile(resolve(value.root, ".git", "info", "exclude"), "ignored-local.txt\n", "utf8");
    await writeFile(resolve(value.worktree, "ignored-local.txt"), "preserve me\n", "utf8");
    let audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.items[0].worktree_state, "dirty");
    await assert.rejects(createGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      operationIds: [operationId],
      mainBranch: "main",
    }), /worktree-dirty/);

    await rm(resolve(value.worktree, "ignored-local.txt"));
    git(value.worktree, ["config", "status.showUntrackedFiles", "no"]);
    await writeFile(resolve(value.worktree, "hidden-untracked.txt"), "preserve me too\n", "utf8");
    audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.items[0].worktree_state, "dirty");
  } finally {
    await dispose(value);
  }
});

test("executor-only merge commits cannot qualify as patch-equivalent", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "merge-delta");
    await writeFile(resolve(value.worktree, "task.txt"), "task\n", "utf8");
    git(value.worktree, ["add", "task.txt"]);
    git(value.worktree, ["commit", "--quiet", "-m", "task constituent"]);
    const taskCommit = git(value.worktree, ["rev-parse", "HEAD"]);

    git(value.worktree, ["switch", "--quiet", "-c", "fixture-side", "main"]);
    await writeFile(resolve(value.worktree, "side.txt"), "side\n", "utf8");
    git(value.worktree, ["add", "side.txt"]);
    git(value.worktree, ["commit", "--quiet", "-m", "side constituent"]);
    const sideCommit = git(value.worktree, ["rev-parse", "HEAD"]);
    git(value.worktree, ["switch", "--quiet", "codex/fixture-task"]);
    git(value.worktree, ["merge", "--quiet", "--no-ff", "--no-commit", "fixture-side"]);
    await writeFile(resolve(value.worktree, "resolution.txt"), "merge-only delta\n", "utf8");
    git(value.worktree, ["add", "resolution.txt"]);
    git(value.worktree, ["commit", "--quiet", "-m", "executor merge"]);
    git(value.worktree, ["push", "-u", "origin", "codex/fixture-task"]);

    git(value.root, ["cherry-pick", taskCommit, sideCommit]);
    git(value.root, ["push", "origin", "main"]);
    const integration = await recordGitIntegration({
      git: gitSnapshot(value.root),
      operationId,
      mainBranch: "main",
    });
    assert.equal(integration.disposition, "unmerged");
  } finally {
    await dispose(value);
  }
});

test("remote identity drift invalidates cleanup even when branch tips match", async () => {
  const value = await fixture();
  const replacementRemote = await mkdtemp(resolve(tmpdir(), "codex-flow-replacement-remote-"));
  try {
    const operationId = await observedOperation(value, "remote-identity");
    await commitExecutor(value, "remote-identity");
    await mergeAndRecord(value, operationId);
    git(replacementRemote, ["init", "--quiet", "--bare"]);
    git(value.root, ["push", replacementRemote, "HEAD~1:refs/heads/main", "codex/fixture-task:refs/heads/codex/fixture-task"]);
    git(value.root, ["remote", "set-url", "--push", "origin", replacementRemote]);

    const audit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(audit.items[0].remote.state, "unavailable");
    assert.equal(audit.items[0].blockers.includes("remote-unavailable"), true);
    await assert.rejects(createGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      operationIds: [operationId],
      mainBranch: "main",
      includeRemote: true,
    }), /exactly one identical|remote-unavailable/);

    git(value.root, ["config", "--unset-all", "remote.origin.pushurl"]);
    git(value.root, ["remote", "set-url", "--add", "--push", "origin", value.bare]);
    git(value.root, ["remote", "set-url", "--add", "--push", "origin", replacementRemote]);
    const multiPushAudit = await gitLifecycleAudit({ git: gitSnapshot(value.root), config: value.config });
    assert.equal(multiPushAudit.items[0].remote.state, "unavailable");
    assert.match(multiPushAudit.items[0].remote.error, /exactly one identical/);
  } finally {
    await rm(replacementRemote, { recursive: true, force: true });
    await dispose(value);
  }
});

test("a lease acquired after planning invalidates cleanup apply", async () => {
  const value = await fixture();
  try {
    const operationId = await observedOperation(value, "late-lease");
    await commitExecutor(value, "late-lease");
    await mergeAndRecord(value, operationId);
    const plan = await createGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      operationIds: [operationId],
      mainBranch: "main",
    });
    const lease = await acquireLease({
      stateRoot: gitSnapshot(value.root).stateRoot,
      resource: "cleanup-fixture",
      owner: "git-executor-late-lease",
      ttlSeconds: 60,
    });
    await assert.rejects(applyGitCleanupPlan({
      git: gitSnapshot(value.root),
      config: value.config,
      expectedPlanId: plan.plan_id,
      operationIds: [operationId],
      mainBranch: "main",
    }), /active-lease/);
    await releaseLease({
      stateRoot: gitSnapshot(value.root).stateRoot,
      resource: "cleanup-fixture",
      owner: "git-executor-late-lease",
      token: lease.lease.token,
    });
  } finally {
    await dispose(value);
  }
});

test("local-only repositories record integration without an upstream", async () => {
  const root = await createGitFixture("codex-flow-local-only-");
  const worktreeRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-local-only-worktree-"));
  const worktree = resolve(worktreeRoot, "executor");
  const value = {
    root,
    worktree: null,
    worktreeRoot,
    config: defaultProjectConfig(root),
  };
  try {
    git(root, ["worktree", "add", "--quiet", "-b", "codex/local-only", worktree, "main"]);
    value.worktree = await realpath(worktree);
    const operationId = await observedOperation(value, "local-only");
    await writeFile(resolve(value.worktree, "local.txt"), "local\n", "utf8");
    git(value.worktree, ["add", "local.txt"]);
    git(value.worktree, ["commit", "--quiet", "-m", "local executor"]);
    git(root, ["merge", "--ff-only", "codex/local-only"]);
    const integration = await recordGitIntegration({
      git: gitSnapshot(root),
      operationId,
      mainBranch: "main",
    });
    assert.equal(integration.upstream, null);
    assert.equal(integration.disposition, "ancestor");
  } finally {
    await dispose(value);
  }
});
