import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  acceptedSubagentDependency,
  completeSubagentOperation,
  isSubagentDependencyUnblocked,
  prepareSubagentOperation,
  reconcileCreatedSubagent,
  recordSubagentCoordinatorDisposition,
  validateSubagentOperation,
} from "../lib/subagent-lifecycle.mjs";
import { createWorkflowPlanRevision, generateTaskContract } from "../lib/workflow-plan.mjs";
import { packageRoot } from "./helpers.mjs";

const DIGEST = "3".repeat(64);

function subagentContract() {
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
  return generateTaskContract({
    plan_revision: plan,
    task_id: "evidence",
    current_baseline: { revision: "b".repeat(40) },
    dependency_dispositions: [],
  });
}

function preparedOperation() {
  return prepareSubagentOperation({
    task_contract: subagentContract(),
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "3",
    mode: "read",
    prompt_digest: DIGEST,
  });
}

test("native subagent lifecycle binds exact selection and read-only task identity", () => {
  const prepared = preparedOperation();
  assert.equal(prepared.state, "prepared");
  assert.match(prepared.operation_id, /^subagent-operation-v1-[a-f0-9]{64}$/);
  assert.deepEqual(validateSubagentOperation(prepared), prepared);
  assert.throws(
    () => prepareSubagentOperation({
      task_contract: subagentContract(),
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      fork_turns: "3",
      mode: "write",
      prompt_digest: DIGEST,
    }),
    /mode must be read/,
  );
  assert.throws(
    () => prepareSubagentOperation({
      task_contract: subagentContract(),
      model: "gpt-5.6-terra",
      reasoning_effort: "ultra",
      fork_turns: "3",
      mode: "read",
      prompt_digest: DIGEST,
    }),
    /reasoning_effort must be one of/,
  );
});

test("only accepted coordinator dispositions unblock dependent contracts", () => {
  const prepared = preparedOperation();
  const created = reconcileCreatedSubagent(prepared, "native-agent-42");
  const completed = completeSubagentOperation(created, {
    summary: "The source establishes the required boundary.",
    evidence_digests: ["4".repeat(64)],
  });
  assert.equal(isSubagentDependencyUnblocked(completed), false);
  assert.throws(() => acceptedSubagentDependency(completed), /Only an accepted/);

  const rejected = recordSubagentCoordinatorDisposition(completed, "rejected");
  assert.equal(isSubagentDependencyUnblocked(rejected), false);
  assert.throws(() => acceptedSubagentDependency(rejected), /Only an accepted/);

  const accepted = recordSubagentCoordinatorDisposition(completed, "accepted");
  assert.equal(isSubagentDependencyUnblocked(accepted), true);
  assert.deepEqual(acceptedSubagentDependency(accepted), {
    task_id: "evidence",
    disposition: "accepted",
    result_digest: accepted.result.result_digest,
  });
  assert.throws(() => reconcileCreatedSubagent(accepted, "other-agent"), /Only a prepared/);
});

test("subagent operations reject mutable task-final authority and malformed evidence", () => {
  const prepared = preparedOperation();
  assert.throws(
    () => validateSubagentOperation({ ...prepared, callback: { thread_id: "forbidden" } }),
    /field is not allowed/,
  );
  const created = reconcileCreatedSubagent(prepared, "native-agent-42");
  assert.throws(
    () => completeSubagentOperation(created, {
      summary: "Evidence",
      evidence_digests: ["not-a-digest"],
    }),
    /lowercase SHA-256 digest/,
  );
});

test("v0.6 subagent schema makes native operations read-only and forbids Ultra", async () => {
  const schema = JSON.parse(await readFile(resolve(packageRoot, "schemas/subagent-operation.schema.json"), "utf8"));
  assert.equal(schema.properties.mode.const, "read");
  assert.equal(schema.properties.reasoning_effort.enum.includes("ultra"), false);
  assert.equal(schema.required.includes("coordinator_disposition"), true);
});
