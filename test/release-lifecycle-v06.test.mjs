import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
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
} from "../lib/task-creation-v06.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
  generateTaskContract,
} from "../lib/workflow-plan.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T22:00:00.000Z");

function task(overrides = {}) {
  return {
    task_id: "release-visible-task",
    title: "Execute the canonical release contract",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/release-visible-task.mjs"],
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
  const root = await createGitFixture("codex-flow-v06-release-");
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
  const authority = {
    run_id: "release-run",
    runtime_context_digest: "a".repeat(64),
    configuration_digest: "b".repeat(64),
    repository_id: "release-repository",
    common_dir: commonDir,
    coordinator_binding: coordinator,
  };
  const contract = generateTaskContract({
    plan_revision: plan,
    task_id: "release-visible-task",
    current_baseline: { revision },
    dependency_records: [],
    authority,
  });
  const requestedSelectors = {
    project_id: "release-saved-project",
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: revision,
      starting_branch: "codex/v0.6",
      executor_branch: "codex/release-visible-task",
      path: null,
    },
  };
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.0");
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
    stateRoot,
    coordinator,
    authority,
    plan,
    contract,
    requestedSelectors,
    operationId: creation.operation_id,
  };
}

async function makeReady(context) {
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
      observed: null,
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
