import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
  taskReleaseStatus,
  validateReleaseRecord,
} from "../lib/release-lifecycle.mjs";
import {
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
} from "../lib/task-creation-v07.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
  generateTaskContract,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal-v07.mjs";
import {
  activateV07FixtureRun,
  assertSuccess,
  createGitFixture,
  packageRoot,
  removeFixture,
  runCli,
} from "./helpers.mjs";

const START = Date.parse("2026-08-29T22:00:00.000Z");

function task(overrides = {}) {
  return {
    task_id: "release-visible-task",
    title: "Execute the canonical release contract",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Terra-xhigh is required for this multi-module release lifecycle fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/release-visible-task.mjs"],
    shared_resources: [],
    primary_outcome: "Implement the exact generated release task.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Execute the generated task contract once.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

async function fixture() {
  const root = await createGitFixture("codex-flow-v07-release-");
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const coordinator = {
    lineage_id: "release-coordinator-lineage",
    thread_id: "release-coordinator-thread",
    generation: 1,
  };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "release-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [task()],
  });
  const runId = "release-run";
  const stateRoot = resolve(commonDir, "codex-flow", "v0.7.1");
  const { authority, runtime } = await activateV07FixtureRun({
    root,
    runId,
    plan,
    branchFences: ["codex/release-visible-task"],
    lineage: {
      lineage_id: coordinator.lineage_id,
      thread_id: coordinator.thread_id,
      generation: coordinator.generation,
    },
    now: START - 3_000,
  });
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: START - 2_000,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: "release-visible-task",
    currentBaseline: { revision },
    dependencyAuthorities: [],
    now: START - 1_000,
  });
  const requestedSelectors = {
    project_id: "release-saved-project",
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: revision,
      starting_branch: "main",
      executor_branch: "codex/release-visible-task",
      path: null,
    },
  };
  const creation = await prepareVisibleTaskCreation({
    stateRoot,
    taskContract: contract,
    requestedSelectors,
    now: START,
  });
  return {
    root,
    commonDir,
    revision,
    runId,
    stateRoot,
    coordinator,
    authority,
    runtime,
    plan,
    contract,
    requestedSelectors,
    operationId: creation.operation_id,
  };
}

async function makeReady(context, { observedWorktreePath = null } = {}) {
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operationId,
    hostSessionId: "release-desktop-session",
    timeoutSeconds: 300,
    now: START + 1_000,
  });
  await reconcileVisibleTaskCreation({
    stateRoot: context.stateRoot,
    operationId: context.operationId,
    outcome: "ready",
    readyThreadId: "release-ready-thread",
    initialTurn: {
      source: "host-observed",
      thread_id: "release-ready-thread",
      turn_id: "release-initial-turn",
      turn_index: 1,
      role: "user",
      content: attempt.bootstrap,
      observed_at: new Date(START + 2_000).toISOString(),
    },
    selectorEvidence: {
      accepted: {
        project_id: context.requestedSelectors.project_id,
        model: context.requestedSelectors.model,
        reasoning_effort: context.requestedSelectors.reasoning_effort,
        worktree: context.requestedSelectors.worktree,
        accepted_at: new Date(START + 1_500).toISOString(),
      },
      observed: observedWorktreePath === null
        ? null
        : {
          project_id: null,
          model: null,
          reasoning_effort: null,
          worktree: {
            ...context.requestedSelectors.worktree,
            path: observedWorktreePath,
          },
          observed_at: new Date(START + 2_000).toISOString(),
        },
    },
    now: START + 2_000,
  });
}

function acceptance(context, releaseId, overrides = {}) {
  return {
    stateRoot: context.stateRoot,
    releaseId,
    readyThreadId: "release-ready-thread",
    contractId: context.contract.contract_id,
    runtimeContextDigest: context.contract.runtime_context_digest,
    commonDir: context.commonDir,
    now: START + 5_000,
    ...overrides,
  };
}

test("release derives its identity and one-shot prompt from ready creation plus canonical contract", async () => {
  const context = await fixture();
  try {
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        operationId: context.operationId,
        now: START + 1_000,
      }),
      /ready-unreleased visible-task creation/,
    );
    await makeReady(context);

    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        operationId: context.operationId,
        prompt: "Caller-authored release text is forbidden.",
        now: START + 3_000,
      }),
      /Release preparation request/,
    );
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: { ...context.contract, run_id: "forged-run" },
        operationId: context.operationId,
        now: START + 3_000,
      }),
      /contract_id does not match/,
    );

    const changedPlan = createWorkflowPlanRevision({
      schema_version: 1,
      plan_id: "changed-release-plan",
      revision: 1,
      parent_revision_digest: null,
      tasks: [task({ primary_outcome: "A different outcome must require a different creation." })],
    });
    const changedContract = generateTaskContract({
      plan_revision: changedPlan,
      task_id: "release-visible-task",
      current_baseline: { revision: context.revision },
      dependency_records: [],
      authority: context.authority,
    });
    await assert.rejects(
      prepareTaskRelease({
        stateRoot: context.stateRoot,
        taskContract: changedContract,
        operationId: context.operationId,
        now: START + 3_000,
      }),
      /does not match the canonical generated task contract/,
    );

    const prepared = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: START + 3_000,
    });
    assert.match(prepared.release_id, /^release-v1-[0-9a-f]{64}$/);
    assert.equal(prepared.dispatch_permitted, true);
    assert.match(prepared.prompt, /Invoke `codex-orchestration:execute`/);
    assert.match(prepared.prompt, /Implement the exact generated release task/);
    assert.equal(prepared.contract_id, context.contract.contract_id);
    assert.equal(prepared.runtime_context_digest, context.contract.runtime_context_digest);
    const {
      status: _status,
      dispatch_permitted: _dispatchPermitted,
      prompt: _prompt,
      ...durablePrepared
    } = prepared;
    assert.deepEqual(validateReleaseRecord(durablePrepared), durablePrepared);

    const replay = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: START + 30_000,
    });
    assert.equal(replay.release_id, prepared.release_id);
    assert.equal(replay.dispatch_permitted, false);
    assert.equal(Object.hasOwn(replay, "prompt"), false);
  } finally {
    await removeFixture(context.root);
  }
});

test("delivery is exactly once and ambiguous delivery accepts only the exact executor echo", async () => {
  const context = await fixture();
  try {
    await makeReady(context);
    const prepared = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: START + 3_000,
    });
    await assert.rejects(
      acceptTaskRelease(acceptance(context, prepared.release_id)),
      /requires delivery reconciliation/,
    );
    assert.equal((await reconcileTaskRelease({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      outcome: "ambiguous",
      now: START + 4_000,
    })).status, "ambiguous");
    await assert.rejects(
      reconcileTaskRelease({
        stateRoot: context.stateRoot,
        releaseId: prepared.release_id,
        outcome: "sent",
        now: START + 4_500,
      }),
      /already reconciled differently/,
    );

    for (const forged of [
      { readyThreadId: "forged-ready-thread" },
      { contractId: "c".repeat(64) },
      { runtimeContextDigest: "d".repeat(64) },
      { commonDir: context.root },
    ]) {
      await assert.rejects(
        acceptTaskRelease(acceptance(context, prepared.release_id, forged)),
        /does not match the prepared authority/,
      );
    }

    const accepted = await acceptTaskRelease(acceptance(context, prepared.release_id));
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(accepted.acceptance, {
      ready_thread_id: "release-ready-thread",
      contract_id: context.contract.contract_id,
      runtime_context_digest: context.contract.runtime_context_digest,
      common_dir: context.commonDir,
      accepted_at: new Date(START + 5_000).toISOString(),
    });
    assert.equal((await taskReleaseStatus({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
    })).status, "accepted");
    assert.equal((await acceptTaskRelease(acceptance(
      context,
      prepared.release_id,
      { now: START + 50_000 },
    ))).status, "accepted");
  } finally {
    await removeFixture(context.root);
  }
});

test("rejected-before-send is terminal and cannot be accepted", async () => {
  const context = await fixture();
  try {
    await makeReady(context);
    const prepared = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: START + 3_000,
    });
    await reconcileTaskRelease({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      outcome: "rejected-before-send",
      now: START + 4_000,
    });
    await assert.rejects(
      acceptTaskRelease(acceptance(context, prepared.release_id)),
      /cannot be accepted/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("release acceptance authenticates the exact linked executor worktree", async () => {
  const context = await fixture();
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-v07-release-linked-"));
  const worktreePath = resolve(worktreeParent, "executor");
  try {
    execFileSync("git", [
      "worktree", "add", "-q", "-b",
      context.requestedSelectors.worktree.executor_branch,
      worktreePath,
      context.requestedSelectors.worktree.starting_branch,
    ], { cwd: context.root });
    const observedWorktreePath = await realpath(worktreePath);
    await makeReady(context, { observedWorktreePath });
    const prepared = await prepareTaskRelease({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      operationId: context.operationId,
      now: START + 3_000,
    });
    await reconcileTaskRelease({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
      outcome: "sent",
      now: START + 4_000,
    });
    const requestPath = resolve(worktreeParent, "release accept's request.json");
    await writeFile(requestPath, `${JSON.stringify({
      run_id: context.runId,
      release_id: prepared.release_id,
      ready_thread_id: prepared.ready_thread_id,
      contract_id: prepared.contract_id,
      runtime_context_digest: prepared.runtime_context_digest,
      common_dir: context.commonDir,
      accepted_at: new Date(START + 5_000).toISOString(),
    })}\n`, "utf8");
    const acceptArgs = [
      "release", "accept", "--run-id", context.runId,
      "--file", requestPath, "--json",
    ];
    const wrongCheckout = runCli(acceptArgs, { cwd: context.root });
    assert.notEqual(wrongCheckout.status, 0);
    assert.match(wrongCheckout.stderr, /exact persisted executor worktree/);
    assert.equal((await taskReleaseStatus({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
    })).acceptance, null);

    const reconcilePath = resolve(worktreeParent, "release-reconcile.json");
    await writeFile(reconcilePath, `${JSON.stringify({
      run_id: context.runId,
      release_id: prepared.release_id,
      outcome: "sent",
      reconciled_at: new Date(START + 4_000).toISOString(),
    })}\n`, "utf8");
    const coordinatorOnlyMutation = runCli([
      "release", "reconcile", "--run-id", context.runId,
      "--file", reconcilePath, "--json",
    ], { cwd: observedWorktreePath });
    assert.equal(coordinatorOnlyMutation.status, 73);
    assert.match(coordinatorOnlyMutation.stderr, /coordinator-only mutation authority/);

    execFileSync("git", ["switch", "--quiet", "--detach", context.revision], {
      cwd: observedWorktreePath,
    });
    const wrongBranch = runCli(acceptArgs, { cwd: observedWorktreePath });
    assert.equal(wrongBranch.status, 73);
    assert.match(wrongBranch.stderr, /wrong branch/);
    execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "release baseline drift"], {
      cwd: observedWorktreePath,
    });
    const wrongBaseline = runCli(acceptArgs, { cwd: observedWorktreePath });
    assert.equal(wrongBaseline.status, 73);
    assert.match(wrongBaseline.stderr, /exact task baseline/);
    execFileSync("git", [
      "switch", "--quiet", context.requestedSelectors.worktree.executor_branch,
    ], { cwd: observedWorktreePath });

    execFileSync("git", ["config", "status.showUntrackedFiles", "no"], {
      cwd: observedWorktreePath,
    });
    const driftPath = resolve(observedWorktreePath, "untracked-release-drift.txt");
    await writeFile(driftPath, "drift\n", "utf8");
    const dirtyWorktree = runCli(acceptArgs, { cwd: observedWorktreePath });
    assert.notEqual(dirtyWorktree.status, 0);
    assert.match(dirtyWorktree.stderr, /must be pristine/);
    await rm(driftPath);
    assert.equal((await taskReleaseStatus({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
    })).acceptance, null);

    const mismatchedPackage = resolve(worktreeParent, "mismatched-package");
    for (const path of ["bin", "lib", "schemas", "templates/roles", "templates/references"]) {
      await cp(resolve(packageRoot, path), resolve(mismatchedPackage, path), { recursive: true });
    }
    await writeFile(
      resolve(mismatchedPackage, "templates", "references", "bundle-mismatch-sentinel.md"),
      "This file deliberately changes only the executing test bundle.\n",
      "utf8",
    );
    const mismatched = spawnSync(process.execPath, [
      resolve(mismatchedPackage, "bin", "codex-flow.mjs"),
      ...acceptArgs,
    ], { cwd: observedWorktreePath, encoding: "utf8" });
    assert.equal(mismatched.status, 73);
    assert.match(mismatched.stderr, /executing_bundle_sha256=[0-9a-f]{64}/);
    assert.match(
      mismatched.stderr,
      new RegExp(`run_bound_bundle_sha256=${context.runtime.bundle.bundle_sha256}`),
    );
    assert.equal((await taskReleaseStatus({
      stateRoot: context.stateRoot,
      releaseId: prepared.release_id,
    })).acceptance, null);

    const boundCli = resolve(
      context.stateRoot,
      "runtimes",
      context.runtime.bundle.bundle_sha256,
      "files",
      "bin",
      "codex-flow.mjs",
    );
    assert.match(mismatched.stderr, new RegExp(boundCli.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const recovery = mismatched.stderr.match(/^recovery_command=(.+)$/m);
    assert.notEqual(recovery, null);
    const accepted = spawnSync("/bin/zsh", ["-c", recovery[1]], {
      cwd: observedWorktreePath,
      encoding: "utf8",
    });
    assertSuccess(accepted, "linked-worktree release acceptance");
    assert.equal(JSON.parse(accepted.stdout).status, "accepted");
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: context.root,
    });
    await rm(worktreeParent, { recursive: true, force: true });
    await removeFixture(context.root);
  }
});

test("release schema exposes only canonical identity names and exact acceptance echoes", async () => {
  const schema = JSON.parse(await readFile(resolve(packageRoot, "schemas/release-record.schema.json"), "utf8"));
  for (const field of [
    "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
    "common_dir", "coordinator_binding", "plan_id", "revision_digest",
    "task_id", "task_digest", "contract_id", "operation_id", "ready_thread_id",
  ]) assert.equal(schema.required.includes(field), true);
  for (const retired of ["revision_id", "task_contract_digest", "runtime_digest", "config_digest"]) {
    assert.equal(Object.hasOwn(schema.properties, retired), false);
  }
  const acceptance = schema.properties.acceptance.oneOf.find((entry) => entry.type === "object");
  assert.deepEqual(acceptance.required, [
    "ready_thread_id", "contract_id", "runtime_context_digest", "common_dir", "accepted_at",
  ]);
});
