import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createWorkflowPlanRevision,
  validateGeneratedTaskContract,
} from "../lib/workflow-plan.mjs";
import {
  reconcileVisibleTaskCreation,
  prepareVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
} from "../lib/task-creation-v07.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
  reviseWorkflowJournal,
  workflowJournalStatus,
} from "../lib/workflow-journal-v07.mjs";
import {
  activateV07FixtureRun,
  createGitFixture,
  removeFixture,
} from "./helpers.mjs";

const START = Date.parse("2026-08-30T00:00:00.000Z");

function selectorTask(overrides = {}) {
  return {
    task_id: "selector-routing",
    title: "Create the explicitly routed visible task",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Use the implementation selector for the owned write and verification task.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/selector-routing-target.mjs"],
    shared_resources: [],
    primary_outcome: "Create one visible task with an explicit native selector choice.",
    causal_question: "Did the host consume the requested selector before native identity existed?",
    cheapest_safe_direct_attempt: "Create the exact visible task once and record its host outcome.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function revisionTwo(first, task) {
  return {
    schema_version: 1,
    plan_id: first.plan_id,
    revision: 2,
    parent_revision_digest: first.revision_digest,
    tasks: [task],
  };
}

async function fixture(t, suffix) {
  const root = await createGitFixture(`codex-flow-selector-routing-${suffix}-`);
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const task = selectorTask();
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `selector-routing-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [task],
  });
  const coordinator = {
    lineage_id: `selector-routing-lineage-${suffix}`,
    thread_id: `selector-routing-coordinator-${suffix}`,
    generation: 1,
  };
  const runId = `selector-routing-run-${suffix}`;
  await activateV07FixtureRun({
    root,
    runId,
    plan,
    lineage: coordinator,
    branchFences: ["codex/selector-routing"],
    now: START - 3_000,
  });
  const stateRoot = resolve(commonDir, "codex-flow", "v0.7.5");
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
    taskId: task.task_id,
    currentBaseline: { revision },
    dependencyAuthorities: [],
    now: START - 1_000,
  });
  const requestedSelectors = {
    project_id: "selector-routing-project",
    model: task.model,
    reasoning_effort: task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: revision,
      starting_branch: "main",
      executor_branch: "codex/selector-routing",
      path: null,
    },
  };
  return { root, stateRoot, runId, plan, task, contract, requestedSelectors, revision };
}

async function rejectBeforeIdentity(context, reasonCode) {
  const prepared = await prepareVisibleTaskCreation({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
    now: START,
  });
  const attempt = await recordVisibleTaskCreationAttempt({
    stateRoot: context.stateRoot,
    operationId: prepared.operation_id,
    hostSessionId: "selector-routing-host-session",
    timeoutSeconds: 60,
    now: START + 1_000,
  });
  const terminal = await reconcileVisibleTaskCreation({
    stateRoot: context.stateRoot,
    operationId: prepared.operation_id,
    outcome: "not-created",
    reasonCode,
    now: START + 2_000,
  });
  return { prepared, attempt, terminal };
}

test("selector rationale is required in the content-addressed task authority", () => {
  assert.throws(
    () => createWorkflowPlanRevision({
      schema_version: 1,
      plan_id: "selector-rationale-required",
      revision: 1,
      parent_revision_digest: null,
      tasks: [selectorTask({ selector_rationale: "" })],
    }),
    /selector_rationale/,
  );

  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "selector-rationale-bound",
    revision: 1,
    parent_revision_digest: null,
    tasks: [selectorTask()],
  });
  assert.equal(plan.tasks[0].selector_rationale, selectorTask().selector_rationale);
});

test("exact selector rejection consumes the call without identity and permits one revised contract", async (t) => {
  const context = await fixture(t, "replan");
  const { prepared, attempt, terminal } = await rejectBeforeIdentity(
    context,
    "selector-rejected-before-task-identity",
  );
  assert.equal(terminal.status, "not-created");
  assert.equal(terminal.provisional, null);
  assert.equal(terminal.ready, null);
  assert.equal(terminal.selector_evidence.accepted, null);
  assert.equal(terminal.selector_evidence.observed, null);
  assert.equal(terminal.selector_rationale, context.task.selector_rationale);
  assert.equal(attempt.host_request.selector_rationale, context.task.selector_rationale);

  const beforeReplan = await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
  });
  const consumed = beforeReplan.contracts.find((entry) => entry.contract.contract_id === context.contract.contract_id);
  assert.equal(consumed.claim.state, "terminal-no-object");
  assert.equal(consumed.claim.operation_id, prepared.operation_id);
  assert.equal(consumed.claim.terminal_at, terminal.resolution.recorded_at);
  assert.equal(consumed.claim.superseded_by_revision_digest, null);

  const revisedTask = selectorTask({
    model: "gpt-5.6-luna",
    reasoning_effort: "high",
    selector_rationale: "The host rejected the original selector before identity, so use the supported implementation lane.",
  });
  const revised = await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    draft: revisionTwo(context.plan, revisedTask),
    now: START + 3_000,
  });
  assert.equal(revised.current_revision.revision, 2);
  const predecessor = revised.contracts.find(
    (entry) => entry.contract.contract_id === context.contract.contract_id,
  ).claim;
  assert.equal(predecessor.state, "terminal-no-object");
  assert.equal(predecessor.superseded_by_revision_digest, revised.current_revision.revision_digest);

  const replacement = await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    taskId: revisedTask.task_id,
    currentBaseline: { revision: context.revision },
    dependencyAuthorities: [],
    now: START + 4_000,
  });
  assert.equal(validateGeneratedTaskContract(replacement).task.model, "gpt-5.6-luna");
  assert.equal(replacement.task.selector_rationale, revisedTask.selector_rationale);
  assert.notEqual(replacement.contract_id, context.contract.contract_id);

  const replacementPrepared = await prepareVisibleTaskCreation({
    stateRoot: context.stateRoot,
    taskContract: replacement,
    requestedSelectors: {
      ...context.requestedSelectors,
      model: revisedTask.model,
      reasoning_effort: revisedTask.reasoning_effort,
    },
    now: START + 5_000,
  });
  await recordVisibleTaskCreationAttempt({
    stateRoot: context.stateRoot,
    operationId: replacementPrepared.operation_id,
    hostSessionId: "selector-routing-replacement-session",
    timeoutSeconds: 60,
    now: START + 6_000,
  });
  await reconcileVisibleTaskCreation({
    stateRoot: context.stateRoot,
    operationId: replacementPrepared.operation_id,
    outcome: "not-created",
    reasonCode: "selector-rejected-before-task-identity",
    now: START + 7_000,
  });
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      draft: {
        schema_version: 1,
        plan_id: context.plan.plan_id,
        revision: 3,
        parent_revision_digest: revised.current_revision.revision_digest,
        tasks: [selectorTask({
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          selector_rationale: "A second selector fallback is forbidden; this draft must be rejected.",
        })],
      },
      now: START + 8_000,
    }),
    /already consumed its one selector-replan child/,
  );
});

test("selector replan rejects unrelated task mutation", async (t) => {
  const context = await fixture(t, "bounded-child");
  await rejectBeforeIdentity(context, "selector-rejected-before-task-identity");
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      draft: revisionTwo(context.plan, selectorTask({
        title: "Also change unrelated task authority",
        model: "gpt-5.6-luna",
        reasoning_effort: "medium",
        selector_rationale: "Use Luna-medium after exact pre-identity selector rejection.",
      })),
      now: START + 3_000,
    }),
    /may change only model, reasoning_effort, and selector_rationale/,
  );
});

test("selector replan branch reuse fails while the local branch exists", async (t) => {
  const context = await fixture(t, "live-branch");
  await rejectBeforeIdentity(context, "selector-rejected-before-task-identity");
  const revisedTask = selectorTask({
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Use Luna-medium after exact pre-identity selector rejection.",
  });
  await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    draft: revisionTwo(context.plan, revisedTask),
    now: START + 3_000,
  });
  const replacement = await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    taskId: revisedTask.task_id,
    currentBaseline: { revision: context.revision },
    dependencyAuthorities: [],
    now: START + 4_000,
  });
  execFileSync("git", ["branch", "codex/selector-routing"], {
    cwd: context.root,
  });
  await assert.rejects(
    () => prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: replacement,
      requestedSelectors: {
        ...context.requestedSelectors,
        model: revisedTask.model,
        reasoning_effort: revisedTask.reasoning_effort,
      },
      now: START + 5_000,
    }),
    /local branch to be absent/,
  );
});

test("a host outcome other than exact selector rejection remains immutable", async (t) => {
  const context = await fixture(t, "no-replan");
  await rejectBeforeIdentity(context, "create-returned-not-created");
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      draft: revisionTwo(context.plan, selectorTask({
        model: "gpt-5.6-luna",
        reasoning_effort: "high",
        selector_rationale: "A different selector would be a new execution authority.",
      })),
      now: START + 3_000,
    }),
    /Started task selector-routing.*immutable/,
  );
});
