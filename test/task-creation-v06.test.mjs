import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
  validateVisibleTaskCreationRecord,
  visibleTaskCreationStatus,
} from "../lib/task-creation-v06.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
  generateTaskContract,
} from "../lib/workflow-plan.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

const START = Date.parse("2026-08-29T20:00:00.000Z");

function visibleTask() {
  return {
    task_id: "visible-implementation",
    title: "Implement the bounded visible task",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/bounded-visible-task.mjs"],
    primary_outcome: "Complete one bounded implementation in a visible task.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Create the exact task once and execute its generated contract.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

async function fixture() {
  const root = await createGitFixture("codex-flow-visible-create-");
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "visible-task-creation",
    revision: 1,
    parent_revision_digest: null,
    tasks: [visibleTask()],
  });
  const coordinator = {
    lineage_id: "coordinator-lineage",
    thread_id: "coordinator-thread",
    generation: 1,
  };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  const contract = generateTaskContract({
    plan_revision: plan,
    task_id: "visible-implementation",
    current_baseline: { revision },
    dependency_records: [],
    authority: {
      run_id: "run-visible-task",
      runtime_context_digest: "1".repeat(64),
      configuration_digest: "2".repeat(64),
      repository_id: "repository-visible-task",
      common_dir: commonDir,
      coordinator_binding: coordinator,
    },
  });
  const requested = {
    project_id: "saved-project-id",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    worktree: {
      mode: "host-worktree",
      starting_revision: revision,
      starting_branch: "codex/v0.6",
      executor_branch: "codex/visible-implementation",
      path: null,
    },
  };
  return {
    root,
    stateRoot: resolve(commonDir, "codex-flow", "v0.6.0"),
    contract,
    requested,
  };
}

function acceptedSelectors(requested, at = START + 500) {
  return {
    project_id: requested.project_id,
    model: requested.model,
    reasoning_effort: requested.reasoning_effort,
    worktree: requested.worktree,
    accepted_at: new Date(at).toISOString(),
  };
}

test("one-shot visible creation binds provisional and ready identities through the exact launch nonce", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.attempt_permitted, true);
    assert.match(prepared.operation_id, /^visible-task-operation-v1-[0-9a-f]{64}$/);
    const {
      attempt_permitted: _attemptPermitted,
      release_permitted: _releasePermitted,
      reconciliation_open: _reconciliationOpen,
      ...durablePrepared
    } = prepared;
    assert.deepEqual(validateVisibleTaskCreationRecord(durablePrepared), durablePrepared);
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-1",
      timeoutSeconds: 300,
      now: START,
    });
    assert.equal(attempt.status, "attempting");
    assert.equal(attempt.dispatch_permitted, true);
    assert.match(attempt.bootstrap, new RegExp(`CODEX_FLOW_LAUNCH_NONCE=${attempt.launch_nonce}`));
    assert.equal(attempt.host_request.prompt, attempt.bootstrap);

    const provisional = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "provisional",
      provisionalClientThreadId: "client-thread-1",
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: null,
      },
      now: START + 1_000,
    });
    assert.equal(provisional.status, "provisional");
    assert.equal(provisional.release_permitted, false);
    assert.equal(provisional.provisional.client_thread_id, "client-thread-1");

    const ready = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ready",
      provisionalClientThreadId: "client-thread-1",
      readyThreadId: "ready-thread-1",
      initialTurn: {
        source: "host-observed",
        thread_id: "ready-thread-1",
        turn_id: "initial-user-turn-1",
        turn_index: 1,
        role: "user",
        content: attempt.bootstrap,
        observed_at: new Date(START + 2_000).toISOString(),
      },
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: {
          project_id: null,
          model: null,
          reasoning_effort: null,
          worktree: null,
          observed_at: new Date(START + 2_000).toISOString(),
        },
      },
      now: START + 2_000,
    });
    assert.equal(ready.status, "ready-unreleased");
    assert.equal(ready.release_permitted, true);
    assert.equal(ready.ready.thread_id, "ready-thread-1");
    assert.notEqual(ready.provisional.client_thread_id, ready.ready.thread_id);
    assert.equal(ready.selector_evidence.accepted.model, "gpt-5.6-terra");
    assert.equal(ready.selector_evidence.observed.model, null);
    assert.equal(ready.selector_evidence.observed.reasoning_effort, null);

    const replay = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ready",
      provisionalClientThreadId: "client-thread-1",
      readyThreadId: "ready-thread-1",
      initialTurn: {
        source: "host-observed",
        thread_id: "ready-thread-1",
        turn_id: "initial-user-turn-1",
        turn_index: 1,
        role: "user",
        content: attempt.bootstrap,
        observed_at: new Date(START + 2_000).toISOString(),
      },
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: {
          project_id: null,
          model: null,
          reasoning_effort: null,
          worktree: null,
          observed_at: new Date(START + 2_000).toISOString(),
        },
      },
      now: START + 9_000,
    });
    assert.equal(replay.ready.recorded_at, ready.ready.recorded_at);
  } finally {
    await removeFixture(context.root);
  }
});

test("title and timing similarity never recover a ready task without exact initial-turn nonce evidence", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-ambiguous",
      timeoutSeconds: 60,
      now: START,
    });
    await assert.rejects(
      reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        readyThreadId: "similar-title-thread",
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      }),
      /exact initial host-visible turn evidence/,
    );
    await assert.rejects(
      reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        readyThreadId: "similar-title-thread",
        initialTurn: {
          source: "host-observed",
          thread_id: "similar-title-thread",
          turn_id: "similar-time-turn",
          turn_index: 1,
          role: "user",
          content: `${attempt.host_request.title}\nCODEX_FLOW_LAUNCH_NONCE=${"f".repeat(64)}`,
          observed_at: new Date(START + 1_000).toISOString(),
        },
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      }),
      /exact launch nonce/,
    );
    const ambiguous = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ambiguous",
      reasonCode: "identity-evidence-missing",
      now: START + 2_000,
    });
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.release_permitted, false);
    assert.equal((await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 3_000,
    })).status, "ambiguous");
  } finally {
    await removeFixture(context.root);
  }
});

test("a generated visible-task contract authorizes exactly one native creation attempt", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const replayedPreparation = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START + 5_000,
    });
    assert.equal(replayedPreparation.operation_id, prepared.operation_id);
    assert.equal(replayedPreparation.launch_nonce, prepared.launch_nonce);

    const firstAttempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-once",
      timeoutSeconds: 30,
      now: START,
    });
    assert.equal(firstAttempt.dispatch_permitted, true);
    const replayedAttempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-once",
      timeoutSeconds: 30,
      now: START + 1_000,
    });
    assert.equal(replayedAttempt.dispatch_permitted, false);
    assert.equal(Object.hasOwn(replayedAttempt, "bootstrap"), false);
    await assert.rejects(
      recordVisibleTaskCreationAttempt({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        hostSessionId: "different-session",
        timeoutSeconds: 30,
        now: START + 1_000,
      }),
      /different one-shot attempt/,
    );
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: { ...context.requested, project_id: "different-project" },
        now: START + 2_000,
      }),
      /already claimed by a different creation request/,
    );

    const expired = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 31_000,
    });
    assert.equal(expired.status, "ambiguous");
    assert.equal(expired.resolution.reason_code, "reconciliation-window-expired");
    assert.equal(expired.attempt_permitted, false);
  } finally {
    await removeFixture(context.root);
  }
});

test("visible task creation schema preserves provisional/ready distinction and fail-closed terminals", async () => {
  const schema = JSON.parse(await readFile(
    resolve(packageRoot, "schemas/visible-task-creation.schema.json"),
    "utf8",
  ));
  assert.equal(schema.properties.kind.const, "codex-flow-v06-visible-task-creation");
  for (const status of ["provisional", "ready-unreleased", "ambiguous", "not-created", "session-blocked"]) {
    assert.equal(schema.properties.status.enum.includes(status), true);
  }
  assert.equal(schema.properties.operation_id.pattern.startsWith("^visible-task-operation-v1-"), true);
});
