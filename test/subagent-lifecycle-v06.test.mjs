import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  acceptedSubagentDependency,
  completeSubagentOperation,
  isSubagentDependencyUnblocked,
  prepareSubagentOperation,
  reconcileCreatedSubagent,
  recordSubagentCoordinatorDisposition,
  subagentOperationStatus,
  validateSubagentOperation,
} from "../lib/subagent-lifecycle.mjs";
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

const DIGEST = "3".repeat(64);

async function fixture(t) {
  const root = await createGitFixture("codex-flow-v06-subagent-");
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const stateRoot = resolve(commonDir, "codex-flow", "v0.6.0");
  const coordinator = {
    lineage_id: "coordinator-lineage",
    thread_id: "coordinator-thread",
    generation: 1,
  };
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "subagent-foundation",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "evidence",
      title: "Read source evidence",
      execution_kind: "subagent",
      mode: "read",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "3",
      dependencies: [],
      read_paths: ["docs/mission.md"],
      write_paths: [],
      primary_outcome: "Read-only source evidence.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Read the bounded source and report evidence.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  const runId = "run-subagent-v06";
  await activateV06FixtureRun({
    root,
    runId,
    plan,
    lineage: coordinator,
    now: Date.parse("2026-08-29T11:57:00Z"),
  });
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: Date.parse("2026-08-29T11:58:00Z"),
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: "evidence",
    currentBaseline: { revision },
    dependencyAuthorities: [],
    now: Date.parse("2026-08-29T11:59:00Z"),
  });
  return { root, commonDir, stateRoot, contract };
}

async function preparedOperation(t, overrides = {}) {
  const context = await fixture(t);
  const operation = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: context.contract,
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "3",
    mode: "read",
    prompt_digest: DIGEST,
    worktree_path: context.root,
    now: Date.parse("2026-08-29T12:00:00Z"),
    ...overrides,
  });
  return { ...context, operation };
}

test("native subagent preparation is durable and binds exact run, selection, coordinator, and Git authority", async (t) => {
  const { stateRoot, contract, operation } = await preparedOperation(t);
  assert.equal(operation.state, "prepared");
  assert.match(operation.operation_id, /^subagent-operation-v1-[a-f0-9]{64}$/);
  assert.equal(operation.run_id, contract.run_id);
  assert.equal(operation.runtime_context_digest, contract.runtime_context_digest);
  assert.equal(operation.initial_git_proof.cleanliness, "clean");
  assert.deepEqual(validateSubagentOperation(operation), operation);
  assert.deepEqual(await subagentOperationStatus({ stateRoot, operationId: operation.operation_id }), operation);
  await assert.rejects(
    () => prepareSubagentOperation({
      stateRoot,
      task_contract: contract,
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "3",
      mode: "write",
      prompt_digest: DIGEST,
      worktree_path: operation.initial_git_proof.root,
    }),
    /mode must be read/,
  );
  await assert.rejects(
    () => prepareSubagentOperation({
      stateRoot,
      task_contract: contract,
      model: "gpt-5.6-terra",
      reasoning_effort: "ultra",
      fork_turns: "3",
      mode: "read",
      prompt_digest: DIGEST,
      worktree_path: operation.initial_git_proof.root,
    }),
    /reasoning_effort must be one of/,
  );
});

test("classified completion and accepted disposition persist and unblock dependency generation", async (t) => {
  const { stateRoot, operation } = await preparedOperation(t);
  const created = await reconcileCreatedSubagent({
    stateRoot,
    operationId: operation.operation_id,
    agent_id: "native-agent-42",
    now: Date.parse("2026-08-29T12:01:00Z"),
  });
  const completed = await completeSubagentOperation({
    stateRoot,
    operationId: created.operation_id,
    classification: "PASS",
    summary: "The source establishes the required boundary.",
    evidence_digests: ["4".repeat(64)],
    now: Date.parse("2026-08-29T12:02:00Z"),
  });
  assert.equal(completed.result.classification, "PASS");
  assert.deepEqual(completed.result.final_git_proof, completed.initial_git_proof);
  assert.equal(isSubagentDependencyUnblocked(completed), false);
  assert.throws(() => acceptedSubagentDependency(completed), /Only an accepted/);
  const accepted = await recordSubagentCoordinatorDisposition({
    stateRoot,
    operationId: completed.operation_id,
    disposition: "accepted",
    now: Date.parse("2026-08-29T12:03:00Z"),
  });
  assert.equal(isSubagentDependencyUnblocked(accepted), true);
  assert.deepEqual(acceptedSubagentDependency(accepted), accepted);
  assert.deepEqual(await subagentOperationStatus({ stateRoot, operationId: accepted.operation_id }), accepted);
  await assert.rejects(
    () => reconcileCreatedSubagent({ stateRoot, operationId: accepted.operation_id, agent_id: "other-agent" }),
    /Only a prepared/,
  );
});

test("non-PASS subagent evidence cannot be accepted but can be durably rejected", async (t) => {
  const { stateRoot, operation } = await preparedOperation(t);
  const created = await reconcileCreatedSubagent({
    stateRoot,
    operationId: operation.operation_id,
    agent_id: "native-agent-blocked",
  });
  const completed = await completeSubagentOperation({
    stateRoot,
    operationId: created.operation_id,
    classification: "BLOCKED",
    summary: "The bounded source was unavailable.",
    evidence_digests: [],
  });
  await assert.rejects(
    () => recordSubagentCoordinatorDisposition({
      stateRoot,
      operationId: completed.operation_id,
      disposition: "accepted",
    }),
    /Only a PASS/,
  );
  const rejected = await recordSubagentCoordinatorDisposition({
    stateRoot,
    operationId: completed.operation_id,
    disposition: "rejected",
  });
  assert.equal(rejected.state, "rejected");
  assert.equal(isSubagentDependencyUnblocked(rejected), false);
});

test("subagent completion fails closed when HEAD, branch ref, or worktree status changes", async (t) => {
  const { root, stateRoot, operation } = await preparedOperation(t);
  const created = await reconcileCreatedSubagent({
    stateRoot,
    operationId: operation.operation_id,
    agent_id: "native-agent-dirty",
  });
  await writeFile(resolve(root, "unexpected.txt"), "write violation\n", "utf8");
  await assert.rejects(
    () => completeSubagentOperation({
      stateRoot,
      operationId: created.operation_id,
      classification: "FAIL",
      summary: "Write violation.",
      evidence_digests: [],
    }),
    /changed Git HEAD.*worktree status/,
  );
  assert.equal((await subagentOperationStatus({ stateRoot, operationId: created.operation_id })).state, "created");
});

test("subagent operations reject mutable task-thread lifecycle fields and malformed evidence", async (t) => {
  const { stateRoot, operation } = await preparedOperation(t);
  assert.throws(
    () => validateSubagentOperation({ ...operation, callback: { thread_id: "forbidden" } }),
    /field is not allowed/,
  );
  const created = await reconcileCreatedSubagent({
    stateRoot,
    operationId: operation.operation_id,
    agent_id: "native-agent-42",
  });
  await assert.rejects(
    () => completeSubagentOperation({
      stateRoot,
      operationId: created.operation_id,
      classification: "PASS",
      summary: "Evidence",
      evidence_digests: ["not-a-digest"],
    }),
    /lowercase SHA-256 digest/,
  );
});

test("v0.6 subagent schema makes operations read-only, classified, Git-proven, and non-Ultra", async () => {
  const schema = JSON.parse(await readFile(resolve(packageRoot, "schemas/subagent-operation.schema.json"), "utf8"));
  assert.equal(schema.properties.mode.const, "read");
  assert.equal(schema.properties.reasoning_effort.enum.includes("ultra"), false);
  assert.equal(schema.required.includes("coordinator_binding"), true);
  assert.equal(schema.required.includes("initial_git_proof"), true);
  assert.equal(schema.required.includes("contract_id"), true);
  assert.equal(Object.hasOwn(schema.properties, "task_contract_id"), false);
  assert.deepEqual(schema.$defs.result.properties.classification.enum, ["PASS", "BLOCKED", "FAIL"]);
});
