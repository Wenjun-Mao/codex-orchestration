import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  acceptTaskRelease,
  authenticateTaskReleaseExecutorWorktree,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import {
  bindVisibleTaskWorktree,
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
  visibleTaskCreationStatus,
} from "../lib/task-creation-v07.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal-v07.mjs";
import {
  activateV07FixtureRun,
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

const CLOCK = Date.parse("2026-08-30T12:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function task(suffix) {
  return {
    task_id: `binding-task-${suffix}`,
    title: `Bind detached worktree ${suffix}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is the exact admitted selector for the binding fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`binding-${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Exercise detached worktree binding ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: "Bind the exact observed detached worktree once.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

async function fixture(suffix, {
  target = "detached",
  foreignPath = null,
  linkedCoordinator = false,
} = {}) {
  const root = await createGitFixture(`codex-flow-v07-binding-${suffix}-`);
  const commonDir = await realpath(resolve(root, ".git"));
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const coordinatorParent = linkedCoordinator
    ? await mkdtemp(resolve(tmpdir(), `codex-flow-v07-binding-coordinator-${suffix}-`))
    : null;
  const coordinatorRoot = linkedCoordinator ? resolve(coordinatorParent, "coordinator") : root;
  if (linkedCoordinator) {
    git(root, [
      "worktree", "add", "-q", "--detach", coordinatorRoot, baseline,
    ]);
  }
  const executorBranch = `codex/binding-${suffix}`;
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `binding-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [task(suffix)],
  });
  const runId = `binding-run-${suffix}`;
  const coordinator = {
    lineage_id: `binding-lineage-${suffix}`,
    thread_id: `binding-coordinator-${suffix}`,
    generation: 1,
  };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  await activateV07FixtureRun({
    root: coordinatorRoot,
    runId,
    plan,
    branchFences: [executorBranch],
    lineage: {
      lineage_id: coordinator.lineage_id,
      thread_id: coordinator.thread_id,
      generation: coordinator.generation,
    },
    now: CLOCK - 3_000,
  });
  const stateRoot = resolve(commonDir, "codex-flow", "v0.8.1-rc.1");
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: CLOCK - 2_000,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: plan.tasks[0].task_id,
    currentBaseline: { revision: baseline },
    dependencyAuthorities: [],
    now: CLOCK - 1_000,
  });
  const requestedSelectors = {
    project_id: `binding-project-${suffix}`,
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: executorBranch,
      path: null,
    },
  };
  const creation = await prepareVisibleTaskCreation({
    stateRoot,
    taskContract: contract,
    requestedSelectors,
    now: CLOCK,
  });
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot,
    operationId: creation.operation_id,
    hostSessionId: `binding-session-${suffix}`,
    now: CLOCK + 1_000,
  });
  const worktreeParent = await mkdtemp(resolve(tmpdir(), `codex-flow-v07-binding-target-${suffix}-`));
  const worktreePath = target === "coordinator"
    ? coordinatorRoot
    : resolve(worktreeParent, "executor");
  if (foreignPath === null && target !== "coordinator") {
    const args = target === "detached"
      ? ["worktree", "add", "-q", "--detach", worktreePath, baseline]
      : ["worktree", "add", "-q", "-b", `codex/wrong-${suffix}`, worktreePath, baseline];
    git(root, args);
  }
  const observedPath = foreignPath === null ? await realpath(worktreePath) : await realpath(foreignPath);
  const readyThreadId = `binding-ready-${suffix}`;
  await reconcileVisibleTaskCreation({
    stateRoot,
    operationId: creation.operation_id,
    outcome: "ready",
    readyThreadId,
    initialTurn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: `binding-turn-${suffix}`,
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(CLOCK + 2_000).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: requestedSelectors.worktree,
        accepted_at: new Date(CLOCK + 1_500).toISOString(),
      },
      observed: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: { ...requestedSelectors.worktree, path: observedPath },
        observed_at: new Date(CLOCK + 2_000).toISOString(),
      },
    },
    now: CLOCK + 2_000,
  });
  return {
    root,
    coordinatorParent,
    coordinatorRoot,
    commonDir,
    stateRoot,
    baseline,
    executorBranch,
    runId,
    contract,
    operationId: creation.operation_id,
    readyThreadId,
    worktreeParent,
    worktreePath: foreignPath === null ? worktreePath : null,
    ownsExecutorWorktree: foreignPath === null && target !== "coordinator",
    observedPath,
  };
}

async function dispose(context) {
  if (context.ownsExecutorWorktree) {
    try {
      git(context.root, ["worktree", "remove", "--force", context.worktreePath]);
    } catch {
      // A foreign-path fixture or an already removed target has no owned worktree to remove.
    }
  }
  await rm(context.worktreeParent, { recursive: true, force: true });
  if (context.coordinatorParent) {
    try {
      git(context.root, ["worktree", "remove", "--force", context.coordinatorRoot]);
    } catch {
      // Cleanup remains best-effort if an isolation regression mutates the coordinator worktree.
    }
    await rm(context.coordinatorParent, { recursive: true, force: true });
  }
  await removeFixture(context.root);
}

async function releaseRecordNames(context) {
  const directory = resolve(context.stateRoot, "releases", "records");
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("real detached worktree binds through the CLI before prepare and accept", async () => {
  const context = await fixture("end-to-end");
  const requestPath = resolve(context.worktreeParent, "bind.json");
  try {
    await writeFile(requestPath, `${JSON.stringify({
      run_id: context.runId,
      operation_id: context.operationId,
    })}\n`, "utf8");
    const boundResult = runCli([
      "task", "create", "bind", "--run-id", context.runId,
      "--file", requestPath, "--json",
    ], { cwd: context.root });
    assertSuccess(boundResult, "task create bind");
    const bound = JSON.parse(boundResult.stdout);
    assert.equal(bound.worktree_binding.state, "completed");
    assert.equal(bound.release_permitted, true);
    assert.equal(git(context.worktreePath, ["branch", "--show-current"]), context.executorBranch);

    const prepared = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: CLOCK + 3_000,
    });
    assert.equal(prepared.worktree_binding_id, bound.worktree_binding.binding_id);
    await reconcileTaskRelease({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      outcome: "sent",
      now: CLOCK + 4_000,
    });
    await authenticateTaskReleaseExecutorWorktree({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      repositoryPath: context.worktreePath,
    });
    const accepted = await acceptTaskRelease({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      readyThreadId: context.readyThreadId,
      contractId: context.contract.contract_id,
      runtimeContextDigest: context.contract.runtime_context_digest,
      commonDir: context.commonDir,
      now: CLOCK + 5_000,
    });
    assert.equal(accepted.status, "accepted");
  } finally {
    await dispose(context);
  }
});

test("unbound release prepare rejects without persisting release authority", async () => {
  const context = await fixture("unbound");
  try {
    const ready = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: context.operationId,
    });
    assert.equal(ready.binding_permitted, true);
    assert.equal(ready.release_permitted, false);
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        operationId: context.operationId,
        now: CLOCK + 3_000,
      }),
      /requires completed worktree binding/,
    );
    assert.deepEqual(await releaseRecordNames(context), []);
  } finally {
    await dispose(context);
  }
});

test("binding rejects the active linked coordinator worktree as an executor target", async () => {
  const context = await fixture("coordinator-isolation", {
    target: "coordinator",
    linkedCoordinator: true,
  });
  try {
    const coordinatorBranch = git(context.coordinatorRoot, ["branch", "--show-current"]);
    await assert.rejects(
      bindVisibleTaskWorktree({
        stateRoot: context.stateRoot,
        operationId: context.operationId,
        now: CLOCK + 2_500,
      }),
      /distinct from the active coordinator repository root/,
    );
    assert.equal(git(context.coordinatorRoot, ["branch", "--show-current"]), coordinatorBranch);
    assert.equal(git(context.root, ["branch", "--list", context.executorBranch]), "");
  } finally {
    await dispose(context);
  }
});

test("binding recovers idempotently across both persisted-intent crash windows", async () => {
  for (const [suffix, hook, branchAfterCrash] of [
    ["crash-before-switch", "afterPreparedIntent", ""],
    ["crash-after-switch", "afterBranchSwitch", "codex/binding-crash-after-switch"],
  ]) {
    const context = await fixture(suffix);
    try {
      await assert.rejects(
        bindVisibleTaskWorktree({
          stateRoot: context.stateRoot,
          operationId: context.operationId,
          now: CLOCK + 2_500,
          hooks: { [hook]: () => { throw new Error(`simulated ${hook}`); } },
        }),
        new RegExp(`simulated ${hook}`),
      );
      const interrupted = await visibleTaskCreationStatus({
        stateRoot: context.stateRoot,
        operationId: context.operationId,
      });
      assert.equal(interrupted.worktree_binding.state, "prepared");
      assert.equal(interrupted.release_permitted, false);
      assert.equal(git(context.worktreePath, ["branch", "--show-current"]), branchAfterCrash);

      await assert.rejects(
        bindVisibleTaskWorktree({
          stateRoot: context.stateRoot,
          operationId: context.operationId,
          now: CLOCK + 2_000,
        }),
        /completion time predates prepared intent/,
      );

      const recovered = await bindVisibleTaskWorktree({
        stateRoot: context.stateRoot,
        operationId: context.operationId,
        now: CLOCK + 20_000,
      });
      assert.equal(recovered.worktree_binding.state, "completed");
      assert.equal(recovered.worktree_binding.prepared_at, interrupted.worktree_binding.prepared_at);
      assert.equal(recovered.worktree_binding.bound_at, new Date(CLOCK + 20_000).toISOString());
      assert.equal(recovered.updated_at, recovered.worktree_binding.bound_at);
      const replay = await bindVisibleTaskWorktree({
        stateRoot: context.stateRoot,
        operationId: context.operationId,
        now: CLOCK + 40_000,
      });
      assert.equal(replay.binding_performed, false);
      assert.deepEqual(replay.worktree_binding, recovered.worktree_binding);
    } finally {
      await dispose(context);
    }
  }
});

test("binding fails closed on dirty, attached, local-colliding, and foreign worktrees", async () => {
  const dirty = await fixture("dirty");
  const attached = await fixture("attached", { target: "attached" });
  const collision = await fixture("collision");
  const worktreeCollision = await fixture("worktree-collision");
  const collisionParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-binding-collision-"));
  const collisionWorktree = resolve(collisionParent, "executor");
  git(worktreeCollision.root, [
    "worktree", "add", "-q", "-b", worktreeCollision.executorBranch,
    collisionWorktree, worktreeCollision.baseline,
  ]);
  const foreignRoot = await createGitFixture("codex-flow-v07-binding-foreign-");
  const foreignParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-binding-foreign-target-"));
  const foreignWorktree = resolve(foreignParent, "executor");
  git(foreignRoot, ["worktree", "add", "-q", "--detach", foreignWorktree, "main"]);
  const foreign = await fixture("foreign", { foreignPath: foreignWorktree });
  try {
    await writeFile(resolve(dirty.worktreePath, "untracked.txt"), "dirty\n", "utf8");
    await assert.rejects(
      bindVisibleTaskWorktree({ stateRoot: dirty.stateRoot, operationId: dirty.operationId }),
      /must be pristine/,
    );
    await assert.rejects(
      bindVisibleTaskWorktree({ stateRoot: attached.stateRoot, operationId: attached.operationId }),
      /already attached without an exact prepared binding intent/,
    );
    git(collision.root, ["branch", collision.executorBranch, collision.baseline]);
    await assert.rejects(
      bindVisibleTaskWorktree({ stateRoot: collision.stateRoot, operationId: collision.operationId }),
      /collides with an existing local branch/,
    );
    await assert.rejects(
      bindVisibleTaskWorktree({
        stateRoot: worktreeCollision.stateRoot,
        operationId: worktreeCollision.operationId,
      }),
      /attached to another worktree/,
    );
    await assert.rejects(
      bindVisibleTaskWorktree({ stateRoot: foreign.stateRoot, operationId: foreign.operationId }),
      /path\/common-dir authority drifted/,
    );
  } finally {
    await dispose(dirty);
    await dispose(attached);
    await dispose(collision);
    try {
      git(worktreeCollision.root, ["worktree", "remove", "--force", collisionWorktree]);
    } catch {
      // Cleanup remains best-effort after the attachment-collision rejection.
    }
    await rm(collisionParent, { recursive: true, force: true });
    await dispose(worktreeCollision);
    await dispose(foreign);
    try {
      git(foreignRoot, ["worktree", "remove", "--force", foreignWorktree]);
    } catch {
      // Cleanup remains best-effort after the foreign-authority rejection.
    }
    await rm(foreignParent, { recursive: true, force: true });
    await removeFixture(foreignRoot);
  }
});

test("post-bind worktree drift blocks prepare without persisting a release", async () => {
  const context = await fixture("post-bind-drift");
  const revisionDrift = await fixture("post-bind-revision-drift");
  try {
    await bindVisibleTaskWorktree({
      stateRoot: context.stateRoot,
      operationId: context.operationId,
      now: CLOCK + 2_500,
    });
    await writeFile(resolve(context.worktreePath, "post-bind.txt"), "drift\n", "utf8");
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        operationId: context.operationId,
        now: CLOCK + 3_000,
      }),
      /must be pristine/,
    );
    assert.deepEqual(await releaseRecordNames(context), []);

    await bindVisibleTaskWorktree({
      stateRoot: revisionDrift.stateRoot,
      operationId: revisionDrift.operationId,
      now: CLOCK + 2_500,
    });
    git(revisionDrift.worktreePath, [
      "commit", "--quiet", "--allow-empty", "-m", "post-bind baseline drift",
    ]);
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: revisionDrift.stateRoot,
        taskContract: revisionDrift.contract,
        operationId: revisionDrift.operationId,
        now: CLOCK + 3_000,
      }),
      /exact task baseline/,
    );
    assert.deepEqual(await releaseRecordNames(revisionDrift), []);
  } finally {
    await dispose(context);
    await dispose(revisionDrift);
  }
});
