import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/core.mjs";
import {
  beginSubagentOperationAttempt,
  completeSubagentOperation,
  prepareSubagentOperation,
  reconcileSubagentOperationAttempt,
  recordSubagentCoordinatorDisposition,
} from "../lib/subagent-operations-v07.mjs";
import { prepareVisibleTaskCreation } from "../lib/task-creation-v07.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import {
  assertWorkflowTaskContractCurrent,
  createWorkflowJournal,
  persistWorkflowTaskContract,
  reviseWorkflowJournal,
  validateWorkflowJournal,
  workflowJournalStatus,
  workflowTaskContractStatus,
} from "../lib/workflow-journal-v07.mjs";
import {
  activateV07FixtureRun,
  createGitFixture,
  packageRoot,
  removeFixture,
} from "./helpers.mjs";

const START = Date.parse("2026-08-29T22:00:00.000Z");
const SUBAGENT_PROMPT = "Inspect the bounded source and return the exact generated contract result.";

function visibleTask(overrides = {}) {
  return {
    task_id: "implementation",
    title: "Implement the bounded change",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Use the implementation model lane for the bounded visible write.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/bounded-change.mjs"],
    shared_resources: [],
    primary_outcome: "Complete one bounded implementation.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Implement the smallest source change and run its focused test.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function subagentTask(overrides = {}) {
  return {
    task_id: "review",
    title: "Review the bounded evidence",
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Use the read-only review model lane for bounded evidence.",
    fork_turns: "3",
    dependencies: [],
    read_paths: ["docs"],
    write_paths: [],
    shared_resources: [],
    primary_outcome: "Return a bounded source review.",
    causal_question: "Does the source preserve the named contract?",
    cheapest_safe_direct_attempt: "Read the bounded source and report the result.",
    instrument_role: "primary-deliverable",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function revisionOne(planId, tasks) {
  return {
    schema_version: 1,
    plan_id: planId,
    revision: 1,
    parent_revision_digest: null,
    tasks,
  };
}

function revisionTwo(first, tasks) {
  return {
    schema_version: 1,
    plan_id: first.plan_id,
    revision: 2,
    parent_revision_digest: first.revision_digest,
    tasks,
  };
}

async function fixture(t, suffix) {
  const root = await createGitFixture(`codex-flow-workflow-journal-${suffix}-`);
  t.after(() => removeFixture(root));
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const coordinator = {
    lineage_id: "coordinator-lineage",
    thread_id: "coordinator-thread",
    generation: 1,
  };
  const runId = `run-${suffix}`;
  return {
    root,
    commonDir,
    stateRoot: resolve(commonDir, "codex-flow", "v0.8.2-dev.0"),
    revision,
    runId,
    coordinator,
  };
}

async function createJournal(context, planId, tasks, now = START, { branchFences = [] } = {}) {
  const planRevision = revisionOne(planId, tasks);
  await activateV07FixtureRun({
    root: context.root,
    runId: context.runId,
    plan: createWorkflowPlanRevision(planRevision),
    lineage: context.coordinator,
    branchFences,
    now: now - 1_000,
  });
  return createWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    planRevision,
    now,
  });
}

async function contractFor(context, planId, taskId, now = START + 1_000) {
  return persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    taskId,
    currentBaseline: { revision: context.revision },
    dependencyAuthorities: [],
    now,
  });
}

test("workflow create, contract, and revise are idempotent while revisions remain content-addressed", async (t) => {
  const context = await fixture(t, "idempotency");
  const planId = "persisted-plan";
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-workflow-source-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const sourcePath = resolve(sourceRoot, "temporary-plan-source.json");
  await writeFile(sourcePath, `${JSON.stringify(revisionOne(planId, [visibleTask()]))}\n`, "utf8");
  const draft = JSON.parse(await readFile(sourcePath, "utf8"));
  await activateV07FixtureRun({
    root: context.root,
    runId: context.runId,
    plan: createWorkflowPlanRevision(draft),
    lineage: context.coordinator,
    now: START - 1_000,
  });
  const created = await createWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    planRevision: draft,
    now: START,
  });
  const repeatedCreate = await createWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    planRevision: draft,
    now: START + 10_000,
  });
  assert.equal(repeatedCreate.journal.journal_digest, created.journal.journal_digest);
  assert.equal(repeatedCreate.journal.updated_at, created.journal.updated_at);

  const contract = await contractFor(context, planId, "implementation");
  const repeatedContract = await contractFor(context, planId, "implementation", START + 20_000);
  assert.equal(repeatedContract.contract_id, contract.contract_id);
  const firstRevisionPath = resolve(
    context.stateRoot,
    "workflows",
    context.runId,
    planId,
    "revisions",
    `${created.current_revision.revision_digest}.json`,
  );
  const firstRevisionBytes = await readFile(firstRevisionPath, "utf8");

  await rm(sourcePath);
  const sourceIndependent = await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
  });
  assert.equal(sourceIndependent.current_revision.revision_digest, created.current_revision.revision_digest);
  assert.equal(sourceIndependent.contracts[0].contract.contract_id, contract.contract_id);

  const nextDraft = revisionTwo(created.current_revision, [
    visibleTask({ title: "Implement the revised bounded change" }),
  ]);
  const revised = await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    draft: nextDraft,
    now: START + 30_000,
  });
  const repeatedRevision = await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    draft: nextDraft,
    now: START + 40_000,
  });
  assert.equal(repeatedRevision.journal.journal_digest, revised.journal.journal_digest);
  assert.equal(repeatedRevision.current_revision.revision_digest, revised.current_revision.revision_digest);
  assert.equal(await readFile(firstRevisionPath, "utf8"), firstRevisionBytes);
  assert.equal(revised.journal.revisions.length, 2);
  assert.deepEqual(validateWorkflowJournal(revised.journal), revised.journal);

  await assert.rejects(
    () => createWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      planRevision: revisionOne(planId, [visibleTask({ title: "A colliding root plan" })]),
      now: START + 50_000,
    }),
    /different root revision/,
  );
});

test("unstarted claims are revoked by the next revision and cannot authorize a stale launch", async (t) => {
  const context = await fixture(t, "stale-claim");
  const planId = "stale-claim-plan";
  const created = await createJournal(context, planId, [visibleTask()]);
  const oldContract = await contractFor(context, planId, "implementation");
  const revised = await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    draft: revisionTwo(created.current_revision, [visibleTask({ title: "Replanned before launch" })]),
    now: START + 2_000,
  });
  const oldStatus = await workflowTaskContractStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    contractId: oldContract.contract_id,
  });
  assert.equal(oldStatus.claim.state, "revoked");
  assert.equal(oldStatus.start_permitted, false);
  await assert.rejects(
    () => assertWorkflowTaskContractCurrent({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      taskContract: oldContract,
    }),
    /not current and startable/,
  );
  const currentContract = await contractFor(context, planId, "implementation", START + 3_000);
  assert.notEqual(currentContract.contract_id, oldContract.contract_id);
  assert.equal(currentContract.revision_digest, revised.current_revision.revision_digest);
});

test("workflow revisions cannot exceed the admitted path or resource envelope", async (t) => {
  const context = await fixture(t, "reservation-envelope");
  const planId = "reservation-envelope-plan";
  const created = await createJournal(context, planId, [visibleTask()]);

  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      draft: revisionTwo(created.current_revision, [visibleTask({
        write_paths: ["lib/outside-envelope.mjs"],
      })]),
      now: START + 1_000,
    }),
    /write path is outside the admitted run fence envelope/,
  );
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      draft: revisionTwo(created.current_revision, [visibleTask({
        shared_resources: ["browser-session"],
      })]),
      now: START + 2_000,
    }),
    /shared resource is outside the admitted run fence envelope/,
  );

  const status = await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
  });
  assert.equal(status.current_revision.revision, 1);
  assert.equal(status.journal.revisions.length, 1);
});

test("revision admission derives visible-task starts from the persisted native operation", async (t) => {
  const context = await fixture(t, "visible-started");
  const planId = "visible-started-plan";
  const created = await createJournal(
    context,
    planId,
    [visibleTask()],
    START,
    { branchFences: ["codex/visible-started"] },
  );
  const contract = await contractFor(context, planId, "implementation");
  await prepareVisibleTaskCreation({
    stateRoot: context.stateRoot,
    taskContract: contract,
    requestedSelectors: {
      project_id: "saved-project",
      model: contract.task.model,
      reasoning_effort: contract.task.reasoning_effort,
      worktree: {
        mode: "host-worktree",
        starting_revision: context.revision,
        starting_branch: "codex/v0.7",
        executor_branch: "codex/visible-started",
        path: null,
      },
    },
    now: START + 2_000,
  });
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      draft: revisionTwo(created.current_revision, [visibleTask({ title: "Illegal mutation after start" })]),
      now: START + 3_000,
    }),
    /Started task implementation.*immutable/,
  );
  const revised = await reviseWorkflowJournal({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    draft: revisionTwo(created.current_revision, [visibleTask(), subagentTask()]),
    now: START + 4_000,
  });
  const status = await workflowTaskContractStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    contractId: contract.contract_id,
  });
  assert.equal(status.claim.state, "started");
  assert.equal(status.claim.operation_kind, "visible-task-creation");
  assert.equal(status.historical_authority, true);
  assert.equal(status.start_permitted, false);
  assert.equal(revised.current_revision.revision, 2);
  const invalidJournal = structuredClone((await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
  })).journal);
  const visibleClaim = invalidJournal.contract_claims.find(
    (claim) => claim.contract_id === contract.contract_id,
  );
  visibleClaim.operation_kind = "subagent-operation";
  assert.throws(
    () => validateWorkflowJournal(invalidJournal),
    /subagent operation does not match its task execution kind/,
  );
});

test("revision admission also derives native-subagent starts without caller assertions", async (t) => {
  const context = await fixture(t, "subagent-started");
  const planId = "subagent-started-plan";
  const created = await createJournal(context, planId, [subagentTask()]);
  const contract = await contractFor(context, planId, "review");
  await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: contract,
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    fork_turns: contract.task.fork_turns,
    mode: "read",
    prompt_digest: "3".repeat(64),
    worktree_path: context.root,
    now: START + 2_000,
  });
  await assert.rejects(
    () => reviseWorkflowJournal({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      draft: revisionTwo(created.current_revision, [subagentTask({ causal_question: "A mutated question?" })]),
      now: START + 3_000,
    }),
    /Started task review.*immutable/,
  );
  const status = await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
  });
  assert.equal(status.contracts[0].claim.state, "started");
  assert.equal(status.contracts[0].claim.operation_kind, "subagent-operation");
  assert.equal(status.contracts[0].operation_record_present, true);
  const invalidJournal = structuredClone(status.journal);
  invalidJournal.contract_claims[0].operation_kind = "visible-task-creation";
  assert.throws(
    () => validateWorkflowJournal(invalidJournal),
    /visible-task operation does not match its task execution kind/,
  );
});

test("dependent contracts resolve exact persisted accepted authority instead of caller lookalikes", async (t) => {
  const context = await fixture(t, "dependency-authority");
  const planId = "dependency-authority-plan";
  await createJournal(context, planId, [
    subagentTask(),
    visibleTask({ dependencies: ["review"] }),
  ]);
  const review = await contractFor(context, planId, "review");
  await assert.rejects(
    () => persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      taskId: "implementation",
      currentBaseline: { revision: context.revision },
      dependencyAuthorities: [{
        authority_kind: "subagent-operation",
        authority_id: `subagent-operation-v1-${"1".repeat(64)}`,
        record: { state: "accepted" },
      }],
    }),
    /field is not allowed/,
  );
  await assert.rejects(
    () => persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId,
      taskId: "implementation",
      currentBaseline: { revision: context.revision },
      dependencyAuthorities: [{
        authority_kind: "subagent-operation",
        authority_id: `subagent-operation-v1-${"1".repeat(64)}`,
      }],
    }),
    /does not exist/,
  );

  const prepared = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: review,
    model: review.task.model,
    reasoning_effort: review.task.reasoning_effort,
    fork_turns: review.task.fork_turns,
    mode: "read",
    prompt_digest: sha256(SUBAGENT_PROMPT),
    worktree_path: context.root,
    now: START + 2_000,
  });
  await beginSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: prepared.operation_id,
    prompt: SUBAGENT_PROMPT,
    timeoutSeconds: 300,
    now: START + 3_000,
  });
  const created = await reconcileSubagentOperationAttempt({
    stateRoot: context.stateRoot,
    operationId: prepared.operation_id,
    outcome: "accepted",
    agent_id: "dependency-authority-agent",
    now: START + 3_001,
  });
  const completed = await completeSubagentOperation({
    stateRoot: context.stateRoot,
    operationId: created.operation_id,
    classification: "PASS",
    summary: "The exact persisted dependency evidence is accepted.",
    evidence_digests: ["3".repeat(64)],
    now: START + 4_000,
  });
  const accepted = await recordSubagentCoordinatorDisposition({
    stateRoot: context.stateRoot,
    operationId: completed.operation_id,
    disposition: "accepted",
    now: START + 5_000,
  });
  const implementation = await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId,
    taskId: "implementation",
    currentBaseline: { revision: context.revision },
    dependencyAuthorities: [{
      authority_kind: "subagent-operation",
      authority_id: accepted.operation_id,
    }],
    now: START + 6_000,
  });
  assert.deepEqual(implementation.accepted_dependencies, [{
    task_id: "review",
    authority_kind: "subagent-operation",
    authority_id: accepted.operation_id,
    authority_digest: implementation.accepted_dependencies[0].authority_digest,
    result_digest: accepted.result.result_digest,
  }]);
});

test("workflow journal schema closes both the journal and contract-claim records", async () => {
  const schema = JSON.parse(await readFile(
    resolve(packageRoot, "schemas/workflow-journal-v07.schema.json"),
    "utf8",
  ));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.kind.const, "codex-flow-v07-workflow-journal");
  assert.equal(schema.$defs.contractClaim.additionalProperties, false);
  assert.equal(schema.$defs.contractClaim.required.includes("runtime_context_digest"), true);
  assert.equal(schema.$defs.contractClaim.required.includes("operation_id"), true);
});
