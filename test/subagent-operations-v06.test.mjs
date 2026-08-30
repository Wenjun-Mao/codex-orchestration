import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/core.mjs";
import {
  acceptedSubagentDependency,
  beginSubagentOperationAttempt,
  completeSubagentOperation,
  isSubagentDependencyUnblocked,
  prepareSubagentOperation,
  reconcileSubagentOperationAttempt,
  recordSubagentCoordinatorDisposition,
  subagentOperationStatus,
  validateSubagentOperation,
} from "../lib/subagent-operations-v06.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal-v06.mjs";
import {
  activateV06FixtureRun,
  createGitFixture,
  packageRoot,
  removeFixture,
} from "./helpers.mjs";

const START = Date.parse("2026-08-29T12:00:00.000Z");
const PROMPT = "Inspect the bounded source and return only the generated subagent contract result.";

async function fixture(t) {
  const root = await createGitFixture("codex-flow-v06-subagent-operation-");
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.1");
  const coordinator = {
    lineage_id: "subagent-operation-lineage",
    thread_id: "subagent-operation-coordinator",
    generation: 1,
  };
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "subagent-operation-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "bounded-review",
      title: "Review the bounded source",
      execution_kind: "subagent",
      mode: "read",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "3",
      dependencies: [],
      read_paths: ["docs/mission.md"],
      write_paths: [],
      shared_resources: [],
      primary_outcome: "Return a bounded source review.",
      causal_question: "Does the source preserve the named contract?",
      cheapest_safe_direct_attempt: "Read the named source and report the result.",
      instrument_role: "primary-deliverable",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  const runId = "run-subagent-operation";
  await activateV06FixtureRun({
    root,
    runId,
    plan,
    lineage: coordinator,
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
    taskId: "bounded-review",
    currentBaseline: { revision },
    dependencyAuthorities: [],
    now: START - 1_000,
  });
  return { root, commonDir, stateRoot, contract };
}

async function prepared(t, overrides = {}) {
  const context = await fixture(t);
  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "3",
    mode: "read",
    prompt_digest: sha256(PROMPT),
    worktree_path: context.root,
    now: START,
    ...overrides,
  });
  return { ...context, operation };
}

test("one generated contract claims one prepared subagent operation and one dispatch attempt", async (t) => {
  const context = await prepared(t);
  assert.equal(context.operation.state, "prepared");
  assert.equal(context.operation.attempt, null);
  assert.deepEqual(validateSubagentOperation(context.operation), context.operation);

  const repeatedPreparation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "3",
    mode: "read",
    prompt_digest: sha256(PROMPT),
    worktree_path: context.root,
    now: START + 1_000,
  });
  assert.deepEqual(repeatedPreparation, context.operation);
  await assert.rejects(
    () => prepareSubagentOperation({
      stateRoot: context.stateRoot,
      task_contract: context.contract,
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "3",
      mode: "read",
      prompt_digest: "f".repeat(64),
      worktree_path: context.root,
      now: START + 1_000,
    }),
    /already claimed by a different operation/,
  );
  await assert.rejects(
    () => prepareSubagentOperation({
      stateRoot: context.stateRoot,
      task_contract: context.contract,
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "all",
      mode: "read",
      prompt_digest: sha256(PROMPT),
      worktree_path: context.root,
      now: START + 1_000,
    }),
    /full-history forks cannot override model routing/,
  );

  const attempt = await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 300,
    now: START + 2_000,
  });
  assert.equal(attempt.state, "attempting");
  assert.equal(attempt.dispatch_permitted, true);
  assert.equal(attempt.reconciliation_open, true);
  assert.match(attempt.attempt.attempt_id, /^subagent-attempt-v1-[a-f0-9]{64}$/);
  assert.deepEqual(attempt.host_request, {
    kind: "spawn-native-subagent",
    task_name: "flow_bounded_review_609add57253e",
    message: PROMPT,
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "3",
  });
  const {
    dispatch_permitted: ignoredDispatch,
    reconciliation_open: ignoredOpen,
    host_request: ignoredRequest,
    ...durableAttempt
  } = attempt;
  assert.deepEqual(validateSubagentOperation(durableAttempt), durableAttempt);

  const replay = await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 300,
    now: START + 3_000,
  });
  assert.equal(replay.dispatch_permitted, false);
  assert.equal(Object.hasOwn(replay, "host_request"), false);
  assert.equal(replay.attempt.attempt_id, attempt.attempt.attempt_id);
  await assert.rejects(
    () => beginSubagentOperationAttempt({
      stateRoot: context.stateRoot,
      operationId: context.operation.operation_id,
      prompt: `${PROMPT} changed`,
      timeoutSeconds: 300,
      now: START + 3_000,
    }),
    /prompt does not match/,
  );
});
test("accepted spawn reconciliation binds one exact agent before completion and disposition", async (t) => {
  const context = await prepared(t);
  await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 300,
    now: START + 1_000,
  });
  const created = await reconcileSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    outcome: "accepted",
    agent_id: "native-agent-42",
    now: START + 2_000,
  });
  assert.equal(created.state, "created");
  assert.equal(created.agent_id, "native-agent-42");
  assert.equal(created.attempt.outcome, "accepted");
  assert.equal(created.created_at, created.attempt.reconciled_at);
  const replay = await reconcileSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    outcome: "accepted",
    agent_id: "native-agent-42",
    now: START + 3_000,
  });
  assert.deepEqual(replay, created);
  await assert.rejects(
    () => reconcileSubagentOperationAttempt({
      stateRoot: context.stateRoot,
      operationId: context.operation.operation_id,
      outcome: "accepted",
      agent_id: "different-agent",
      now: START + 3_000,
    }),
    /already reconciled as accepted/,
  );

  const completed = await completeSubagentOperation({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    classification: "PASS",
    summary: "The bounded source preserves the contract.",
    evidence_digests: ["4".repeat(64)],
    now: START + 4_000,
  });
  assert.equal(isSubagentDependencyUnblocked(completed), false);
  const accepted = await recordSubagentCoordinatorDisposition({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    disposition: "accepted",
    now: START + 5_000,
  });
  assert.equal(isSubagentDependencyUnblocked(accepted), true);
  assert.deepEqual(acceptedSubagentDependency(accepted), accepted);
});

test("rejected-before-send is terminal and never authorizes a second spawn", async (t) => {
  const context = await prepared(t);
  await assert.rejects(
    () => reconcileSubagentOperationAttempt({
      stateRoot: context.stateRoot,
      operationId: context.operation.operation_id,
      outcome: "rejected-before-send",
      now: START + 1_000,
    }),
    /must begin its one-shot attempt/,
  );
  await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 60,
    now: START + 1_000,
  });
  const rejected = await reconcileSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    outcome: "rejected-before-send",
    now: START + 2_000,
  });
  assert.equal(rejected.state, "rejected-before-send");
  assert.equal(rejected.agent_id, null);
  const replay = await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 60,
    now: START + 3_000,
  });
  assert.equal(replay.dispatch_permitted, false);
  await assert.rejects(
    () => completeSubagentOperation({
      stateRoot: context.stateRoot,
      operationId: context.operation.operation_id,
      classification: "PASS",
      summary: "No executor existed.",
      evidence_digests: [],
    }),
    /Only a created/,
  );
});

test("ambiguous and expired attempts fail closed without retry or late acceptance", async (t) => {
  const explicit = await prepared(t);
  await beginSubagentOperationAttempt({
    stateRoot: explicit.stateRoot,
    operationId: explicit.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 60,
    now: START + 1_000,
  });
  const ambiguous = await reconcileSubagentOperationAttempt({
    stateRoot: explicit.stateRoot,
    operationId: explicit.operation.operation_id,
    outcome: "ambiguous",
    now: START + 2_000,
  });
  assert.equal(ambiguous.state, "ambiguous");
  assert.equal(ambiguous.attempt.ambiguity_reason, "host-result-ambiguous");
  const noRetry = await beginSubagentOperationAttempt({
    stateRoot: explicit.stateRoot,
    operationId: explicit.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 60,
    now: START + 3_000,
  });
  assert.equal(noRetry.dispatch_permitted, false);
  await assert.rejects(
    () => reconcileSubagentOperationAttempt({
      stateRoot: explicit.stateRoot,
      operationId: explicit.operation.operation_id,
      outcome: "accepted",
      agent_id: "late-agent",
      now: START + 3_000,
    }),
    /already reconciled as ambiguous/,
  );

  const expired = await prepared(t, { now: START + 10_000 });
  const started = await beginSubagentOperationAttempt({
    stateRoot: expired.stateRoot,
    operationId: expired.operation.operation_id,
    prompt: PROMPT,
    timeoutSeconds: 5,
    now: START + 11_000,
  });
  const beforeReconcile = await subagentOperationStatus({
    stateRoot: expired.stateRoot,
    operationId: expired.operation.operation_id,
  });
  assert.equal(beforeReconcile.state, "attempting");
  const status = await reconcileSubagentOperationAttempt({
    stateRoot: expired.stateRoot,
    operationId: expired.operation.operation_id,
    outcome: "ambiguous",
    now: START + 17_000,
  });
  assert.equal(status.state, "ambiguous");
  assert.equal(status.attempt.ambiguity_reason, "reconciliation-window-expired");
  assert.equal(status.attempt.reconciled_at, started.attempt.reconcile_by);
  await assert.rejects(
    () => reconcileSubagentOperationAttempt({
      stateRoot: expired.stateRoot,
      operationId: expired.operation.operation_id,
      outcome: "accepted",
      agent_id: "late-expired-agent",
      now: START + 18_000,
    }),
    /already reconciled as ambiguous/,
  );
});

test("subagent completion still fails closed on any Git mutation", async (t) => {
  const context = await prepared(t);
  await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    prompt: PROMPT,
    now: START + 1_000,
  });
  await reconcileSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: context.operation.operation_id,
    outcome: "accepted",
    agent_id: "native-agent-dirty",
    now: START + 2_000,
  });
  await writeFile(resolve(context.root, "unexpected.txt"), "write violation\n", "utf8");
  await assert.rejects(
    () => completeSubagentOperation({
      stateRoot: context.stateRoot,
      operationId: context.operation.operation_id,
      classification: "FAIL",
      summary: "Write violation.",
      evidence_digests: [],
      now: START + 3_000,
    }),
    /changed Git HEAD.*worktree status/,
  );
});

test("subagent operation schema closes the durable attempt and ambiguity contract", async () => {
  const schema = JSON.parse(await readFile(
    resolve(packageRoot, "schemas", "subagent-operation.schema.json"),
    "utf8",
  ));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.required.includes("attempt"), true);
  assert.equal(schema.properties.state.enum.includes("attempting"), true);
  assert.equal(schema.properties.state.enum.includes("ambiguous"), true);
  assert.equal(schema.properties.state.enum.includes("rejected-before-send"), true);
  assert.equal(schema.$defs.attempt.additionalProperties, false);
  assert.match(schema.$defs.attempt.properties.attempt_id.pattern, /subagent-attempt-v1/);
  assert.deepEqual(
    schema.$defs.attempt.properties.outcome.enum,
    [null, "accepted", "rejected-before-send", "ambiguous"],
  );
});
