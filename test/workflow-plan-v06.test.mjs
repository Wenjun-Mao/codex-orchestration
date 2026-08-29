import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createGeneratedTaskResult,
  createNextWorkflowPlanRevision,
  createWorkflowPlanRevision,
  generateTaskContract,
  validateGeneratedTaskContract,
  validateGeneratedTaskResult,
  validateWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { packageRoot } from "./helpers.mjs";

const BASELINE = { revision: "a".repeat(40) };
const RESULT_A = "1".repeat(64);

function workflowTask(overrides = {}) {
  return {
    task_id: "research",
    title: "Collect bounded evidence",
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    fork_turns: "all",
    dependencies: [],
    read_paths: ["docs/mission.md"],
    write_paths: [],
    primary_outcome: "A read-only evidence digest for the direct implementation attempt.",
    causal_question: "What source-backed constraint should the direct attempt preserve?",
    cheapest_safe_direct_attempt: "Inspect the bounded source and return evidence only.",
    instrument_role: "supporting",
    supporting_follow_up: { kind: "direct-attempt", task_id: "implementation" },
    supporting_authorization: null,
    ...overrides,
  };
}

function implementationTask(overrides = {}) {
  return {
    task_id: "implementation",
    title: "Implement the bounded change",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    fork_turns: null,
    dependencies: ["research"],
    read_paths: ["lib"],
    write_paths: ["lib/new-module.mjs"],
    primary_outcome: "A reviewed implementation that preserves the evidence-backed contract.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Implement and run the focused test.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function rootDraft(overrides = {}) {
  return {
    schema_version: 1,
    plan_id: "identity-foundation",
    revision: 1,
    parent_revision_digest: null,
    tasks: [implementationTask(), workflowTask()],
    ...overrides,
  };
}

function nextDraft(previous, tasks) {
  return {
    schema_version: 1,
    plan_id: previous.plan_id,
    revision: previous.revision + 1,
    parent_revision_digest: previous.revision_digest,
    tasks,
  };
}

test("workflow revisions canonicalize task order and bind a stable logical plan ID", () => {
  const first = createWorkflowPlanRevision(rootDraft());
  const reordered = createWorkflowPlanRevision(rootDraft({ tasks: [workflowTask(), implementationTask()] }));
  assert.equal(first.plan_id, "identity-foundation");
  assert.equal(first.revision_digest, reordered.revision_digest);
  assert.deepEqual(first.tasks.map((task) => task.task_id), ["implementation", "research"]);
  assert.deepEqual(validateWorkflowPlanRevision(first), first);
  assert.throws(
    () => validateWorkflowPlanRevision({ ...first, revision_digest: "0".repeat(64) }),
    /canonical workflow plan revision/,
  );
});

test("later revisions can change only unstarted task contracts and their edges", () => {
  const report = implementationTask({
    task_id: "report",
    title: "Document the result",
    dependencies: [],
    write_paths: ["docs/result.md"],
  });
  const first = createWorkflowPlanRevision(rootDraft({
    tasks: [workflowTask(), implementationTask(), report],
  }));
  const revisedImplementation = implementationTask({
    primary_outcome: "An implementation revised before launch.",
  });
  const second = createNextWorkflowPlanRevision({
    previous_revision: first,
    task_states: { research: "started", implementation: "unstarted", report: "unstarted" },
    draft: nextDraft(first, [
      workflowTask(),
      revisedImplementation,
      implementationTask({
        task_id: "report",
        title: "Document the result",
        dependencies: ["implementation"],
        write_paths: ["docs/result.md"],
      }),
    ]),
  });
  assert.equal(second.revision, 2);
  assert.equal(second.parent_revision_digest, first.revision_digest);
  assert.throws(
    () => createNextWorkflowPlanRevision({
      previous_revision: first,
      task_states: { research: "accepted", implementation: "unstarted", report: "unstarted" },
      draft: nextDraft(first, [
        workflowTask({ primary_outcome: "Mutated after start." }),
        implementationTask(),
        report,
      ]),
    }),
    /Started task research.*immutable/,
  );
});

test("generated contracts require a concrete baseline and accepted dependency result identities", () => {
  const plan = createWorkflowPlanRevision(rootDraft());
  const research = generateTaskContract({
    plan_revision: plan,
    task_id: "research",
    current_baseline: BASELINE,
    dependency_dispositions: [],
  });
  assert.equal(validateGeneratedTaskContract(research).contract_id, research.contract_id);
  assert.throws(
    () => generateTaskContract({
      plan_revision: plan,
      task_id: "implementation",
      current_baseline: BASELINE,
      dependency_dispositions: [{ task_id: "research", disposition: "rejected", result_digest: null }],
    }),
    /remains blocked/,
  );
  const implementation = generateTaskContract({
    plan_revision: plan,
    task_id: "implementation",
    current_baseline: BASELINE,
    dependency_dispositions: [{ task_id: "research", disposition: "accepted", result_digest: RESULT_A }],
  });
  assert.equal(implementation.accepted_dependencies[0].result_digest, RESULT_A);
  assert.throws(
    () => generateTaskContract({
      plan_revision: plan,
      task_id: "research",
      current_baseline: { revision: "not-a-concrete-baseline" },
      dependency_dispositions: [],
    }),
    /concrete lowercase Git revision/,
  );
  const result = createGeneratedTaskResult({
    task_contract: implementation,
    outcome: "Implemented the bounded change.",
    evidence_digests: ["2".repeat(64)],
  });
  assert.equal(validateGeneratedTaskResult(result).result_digest, result.result_digest);
});

test("goal-proximate supporting instrumentation has a direct follow-up and later authorization", () => {
  assert.throws(
    () => createWorkflowPlanRevision(rootDraft({
      tasks: [
        implementationTask({ dependencies: ["research", "audit"] }),
        workflowTask(),
        workflowTask({ task_id: "audit", title: "Audit source", supporting_authorization: null }),
      ],
    })),
    /Additional supporting instrumentation.*later revision/,
  );

  const first = createWorkflowPlanRevision(rootDraft());
  const audit = workflowTask({
    task_id: "audit",
    title: "Audit the evidence boundary",
    supporting_authorization: { authorized_revision: 2, reason: "The first evidence pass exposed a named uncertainty." },
  });
  const second = createNextWorkflowPlanRevision({
    previous_revision: first,
    task_states: { research: "unstarted", implementation: "unstarted" },
    draft: nextDraft(first, [
      workflowTask(),
      audit,
      implementationTask({ dependencies: ["research", "audit"] }),
    ]),
  });
  assert.equal(second.tasks.filter((task) => task.instrument_role === "supporting").length, 2);
  assert.throws(
    () => createWorkflowPlanRevision(rootDraft({
      tasks: [
        workflowTask({ supporting_follow_up: { kind: "direct-attempt", task_id: "missing" } }),
        implementationTask(),
      ],
    })),
    /unknown direct follow-up/,
  );
});

test("v0.6 workflow schemas describe persisted revisions and generated identities", async () => {
  const schema = JSON.parse(await readFile(resolve(packageRoot, "schemas/workflow-plan.schema.json"), "utf8"));
  assert.equal(schema.$defs.planRevision.properties.revision_digest.$ref, "#/$defs/digest");
  assert.equal(schema.$defs.generatedTaskContract.properties.kind.const, "codex-flow-generated-task-contract");
  assert.equal(schema.$defs.task.properties.instrument_role.enum.includes("supporting"), true);
});
