import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  coordinatorBindingDigest,
  createNextWorkflowPlanRevision,
  createWorkflowPlanRevision,
  generateTaskContract,
  validateGeneratedTaskContract,
  validateWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { packageRoot } from "./helpers.mjs";

const BASELINE = { revision: "a".repeat(40) };
const RUNTIME_DIGEST = "1".repeat(64);
const CONFIGURATION_DIGEST = "2".repeat(64);

function authority(commonDir = "/tmp/codex-flow-authority/.git") {
  const coordinator = {
    lineage_id: "coordinator-lineage",
    thread_id: "coordinator-thread",
    generation: 1,
  };
  return {
    run_id: "run-workflow-v07",
    runtime_context_digest: RUNTIME_DIGEST,
    configuration_digest: CONFIGURATION_DIGEST,
    repository_id: "repository-workflow-v07",
    common_dir: commonDir,
    coordinator_binding: {
      ...coordinator,
      binding_digest: coordinatorBindingDigest(coordinator),
    },
  };
}

function workflowTask(overrides = {}) {
  return {
    task_id: "research",
    title: "Collect bounded evidence",
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Use the read-only research model lane for the bounded evidence task.",
    fork_turns: "3",
    dependencies: [],
    read_paths: ["docs/mission.md"],
    write_paths: [],
    shared_resources: [],
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
    selector_rationale: "Use the implementation model lane for the owned write and verification slice.",
    fork_turns: null,
    dependencies: ["research"],
    read_paths: ["lib"],
    write_paths: ["lib/new-module.mjs"],
    shared_resources: [],
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

function contractFor(plan, taskId, dependencyRecords = []) {
  return generateTaskContract({
    plan_revision: plan,
    task_id: taskId,
    current_baseline: BASELINE,
    dependency_records: dependencyRecords,
    authority: authority(),
  });
}

function acceptedDisposition(plan) {
  const research = contractFor(plan, "research");
  return {
    schema_version: 1,
    kind: "codex-flow-v07-task-disposition",
    disposition_id: "disposition-research",
    run_id: authority().run_id,
    runtime_context_digest: authority().runtime_context_digest,
    configuration_digest: authority().configuration_digest,
    repository_id: authority().repository_id,
    common_dir: authority().common_dir,
    coordinator_binding: authority().coordinator_binding,
    plan_id: plan.plan_id,
    revision_digest: plan.revision_digest,
    task_id: "research",
    task_digest: research.task_digest,
    contract_id: research.contract_id,
    operation_id: "operation-research",
    release_id: "release-research",
    executor_thread_id: "executor-research",
    callback_id: "callback-research",
    receipt_digest: "4".repeat(64),
    decision: "accepted-no-change",
    reason: "Read-only evidence accepted.",
    integration_id: null,
    verification_id: `verification-v1-${"5".repeat(64)}`,
    verification_digest: "5".repeat(64),
    state: "completed",
    prepared_at: "2026-08-29T12:00:00Z",
    finalized_at: "2026-08-29T12:01:00Z",
    callback_consumed_at: "2026-08-29T12:02:00Z",
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

test("later revisions derive immutable started tasks from generated contracts", () => {
  const report = implementationTask({
    task_id: "report",
    title: "Document the result",
    dependencies: [],
    read_paths: ["docs"],
    write_paths: ["docs/result.md"],
  });
  const first = createWorkflowPlanRevision(rootDraft({
    tasks: [workflowTask(), implementationTask(), report],
  }));
  const startedResearch = contractFor(first, "research");
  const second = createNextWorkflowPlanRevision({
    previous_revision: first,
    started_task_contracts: [startedResearch],
    draft: nextDraft(first, [
      workflowTask(),
      implementationTask({ primary_outcome: "An implementation revised before launch." }),
      { ...report, dependencies: ["implementation"] },
    ]),
  });
  assert.equal(second.revision, 2);
  assert.throws(
    () => createNextWorkflowPlanRevision({
      previous_revision: first,
      started_task_contracts: [startedResearch],
      draft: nextDraft(first, [
        workflowTask({ primary_outcome: "Mutated after contract generation." }),
        implementationTask(),
        report,
      ]),
    }),
    /Started task research.*immutable/,
  );
  assert.throws(
    () => createNextWorkflowPlanRevision({
      previous_revision: first,
      started_task_contracts: [{ ...startedResearch, revision_digest: "9".repeat(64) }],
      draft: nextDraft(first, first.tasks),
    }),
    /task_digest does not match|contract_id does not match|different workflow revision/,
  );
});

test("generated contracts bind run, runtime, repository, coordinator, and durable dependency authority", () => {
  const plan = createWorkflowPlanRevision(rootDraft());
  const research = contractFor(plan, "research");
  assert.equal(validateGeneratedTaskContract(research).contract_id, research.contract_id);
  assert.equal(research.run_id, authority().run_id);
  assert.equal(research.task.selector_rationale, workflowTask().selector_rationale);
  assert.equal(research.runtime_context_digest, RUNTIME_DIGEST);
  assert.equal(research.coordinator_binding.binding_digest, authority().coordinator_binding.binding_digest);
  assert.throws(
    () => generateTaskContract({
      plan_revision: plan,
      task_id: "implementation",
      current_baseline: BASELINE,
      dependency_records: [{ task_id: "research", disposition: "accepted", result_digest: "4".repeat(64) }],
      authority: authority(),
    }),
    /durable task disposition or subagent operation/,
  );
  assert.throws(
    () => contractFor(plan, "implementation", [{ ...acceptedDisposition(plan), state: "finalized" }]),
    /completed accepted task disposition/,
  );
  const implementation = contractFor(plan, "implementation", [acceptedDisposition(plan)]);
  assert.deepEqual(implementation.accepted_dependencies.map((entry) => entry.authority_kind), ["task-disposition"]);
  assert.equal(implementation.accepted_dependencies[0].result_digest, "4".repeat(64));
  assert.throws(
    () => validateGeneratedTaskContract({
      ...implementation,
      coordinator_binding: { ...implementation.coordinator_binding, generation: 2 },
    }),
    /binding_digest does not match/,
  );
  assert.throws(
    () => generateTaskContract({
      plan_revision: plan,
      task_id: "research",
      current_baseline: { revision: "not-a-concrete-baseline" },
      dependency_records: [],
      authority: authority(),
    }),
    /concrete lowercase Git revision/,
  );
});

test("DAG ordering uses transitive closure and rejects unordered write/read overlap", () => {
  const direct = implementationTask({
    task_id: "direct",
    title: "Write shared source",
    dependencies: [],
    read_paths: [],
    write_paths: ["src/shared"],
  });
  const bridge = implementationTask({
    task_id: "bridge",
    title: "Ordered bridge",
    mode: "read",
    dependencies: ["direct"],
    read_paths: ["docs"],
    write_paths: [],
  });
  const transitiveReader = implementationTask({
    task_id: "reader",
    title: "Read shared source after bridge",
    mode: "read",
    dependencies: ["bridge"],
    read_paths: ["src/shared/file.mjs"],
    write_paths: [],
  });
  assert.doesNotThrow(() => createWorkflowPlanRevision(rootDraft({
    tasks: [direct, bridge, transitiveReader],
  })));
  assert.throws(
    () => createWorkflowPlanRevision(rootDraft({
      tasks: [direct, { ...transitiveReader, dependencies: [] }],
    })),
    /Unordered tasks.*write\/read/,
  );

  const sharedBrowser = { shared_resources: ["browser-session"] };
  assert.throws(
    () => createWorkflowPlanRevision(rootDraft({
      tasks: [
        direct,
        implementationTask({
          task_id: "other",
          dependencies: [],
          write_paths: ["src/other"],
          ...sharedBrowser,
        }),
        implementationTask({
          task_id: "third",
          dependencies: [],
          write_paths: ["src/third"],
          ...sharedBrowser,
        }),
      ],
    })),
    /Unordered tasks.*share exclusive resources: browser-session/,
  );
  assert.doesNotThrow(() => createWorkflowPlanRevision(rootDraft({
    tasks: [
      implementationTask({ task_id: "first", dependencies: [], ...sharedBrowser }),
      implementationTask({ task_id: "second", dependencies: ["first"], ...sharedBrowser }),
    ],
  })));
});

test("native subagent routing rejects full-history inheritance", () => {
  assert.throws(
    () => createWorkflowPlanRevision(rootDraft({
      tasks: [workflowTask({ fork_turns: "all" }), implementationTask()],
    })),
    /fork_turns must explicitly be none or a positive integer string/,
  );
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
    supporting_authorization: { authorized_revision: 2, reason: "A named uncertainty needs one bounded check." },
  });
  const second = createNextWorkflowPlanRevision({
    previous_revision: first,
    started_task_contracts: [],
    draft: nextDraft(first, [
      workflowTask(),
      audit,
      implementationTask({ dependencies: ["research", "audit"] }),
    ]),
  });
  assert.equal(second.tasks.filter((task) => task.instrument_role === "supporting").length, 2);
});

test("v0.7 workflow and generated-contract schemas have one closed root authority each", async () => {
  const workflowSchema = JSON.parse(await readFile(resolve(packageRoot, "schemas/workflow-plan.schema.json"), "utf8"));
  const contractSchema = JSON.parse(await readFile(resolve(packageRoot, "schemas/generated-task-contract.schema.json"), "utf8"));
  assert.equal(workflowSchema.oneOf, undefined);
  assert.equal(workflowSchema.properties.revision_digest.$ref, "#/$defs/digest");
  assert.equal(workflowSchema.$defs.task.required.includes("selector_rationale"), true);
  assert.equal(contractSchema.properties.kind.const, "codex-flow-generated-task-contract");
  assert.equal(contractSchema.required.includes("runtime_context_digest"), true);
  assert.equal(contractSchema.required.includes("coordinator_binding"), true);
  assert.equal(contractSchema.properties.accepted_dependencies.items.required.includes("authority_digest"), true);
});
