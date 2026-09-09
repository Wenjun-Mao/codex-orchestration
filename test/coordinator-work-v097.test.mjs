import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  completeCoordinatorWork,
  startCoordinatorWork,
} from "../lib/coordinator-work.mjs";
import { prepareTaskLaunch } from "../lib/core/task-launch.mjs";
import { sha256 } from "../lib/core.mjs";
import { auditRunClosure } from "../lib/run-audit.mjs";
import { prepareSubagentOperation } from "../lib/subagent-operations.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
  workflowJournalStatus,
} from "../lib/workflow-journal.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import { activateFixtureRun, createGitFixture, removeFixture } from "./helpers.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function commitSibling(root, baseline, name) {
  git(root, ["reset", "--hard", baseline]);
  await writeFile(resolve(root, `${name}.txt`), `${name}\n`, "utf8");
  git(root, ["add", `${name}.txt`]);
  git(root, ["commit", "--quiet", "-m", `test: ${name}`]);
  return git(root, ["rev-parse", "HEAD"]);
}

function localTask(suffix, overrides = {}) {
  return {
    task_id: `local-${suffix}`,
    title: `Coordinator · Test · ${suffix}`,
    execution_kind: "coordinator",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded coordinator-work fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: [],
    write_paths: [`local-output/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Complete local work ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Run local work ${suffix} once.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

async function fixture(t, suffix, { tasks = [localTask(suffix)], branchFences = [] } = {}) {
  const root = await createGitFixture(`codex-flow-v097-local-${suffix}-`);
  t.after(() => removeFixture(root));
  const initialTaskId = tasks[0].task_id;
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `local-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks,
  });
  const lineage = {
    lineage_id: `local-lineage-${suffix}`,
    thread_id: `local-coordinator-${suffix}`,
    generation: 1,
  };
  const runId = `local-run-${suffix}`;
  const activated = await activateFixtureRun({ root, runId, plan, lineage, branchFences });
  await bindRecipient({
    stateRoot: activated.runtime.repository.common_dir + `/codex-flow/v${activated.runtime.bundle.package_version}`,
    recipient: lineage,
    fenceToken: activated.run.binding.fence_token,
  });
  const stateRoot = activated.runtime.repository.common_dir + `/codex-flow/v${activated.runtime.bundle.package_version}`;
  await createWorkflowJournal({ stateRoot, runId, planId: plan.plan_id, planRevision: plan });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: initialTaskId,
    currentBaseline: { revision: git(root, ["rev-parse", "HEAD"]) },
    dependencyAuthorities: [],
  });
  const previousThread = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = lineage.thread_id;
  t.after(() => {
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
  });
  return { root, stateRoot, runId, plan, contract };
}

function dependencyTask(suffix, executionKind, dependency, overrides = {}) {
  return localTask(suffix, {
    task_id: `${executionKind}-${suffix}`,
    title: `${executionKind} dependent ${suffix}`,
    execution_kind: executionKind,
    mode: executionKind === "subagent" ? "read" : "write",
    fork_turns: executionKind === "subagent" ? "3" : null,
    dependencies: [dependency],
    write_paths: executionKind === "subagent" ? [] : [`local-output/${suffix}.txt`],
    read_paths: executionKind === "subagent" ? ["docs/mission.md"] : [],
    ...overrides,
  });
}

test("coordinator-owned mutation closes through current audit without a fabricated child", async (t) => {
  const context = await fixture(t, "mutation");
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await mkdir(`${context.root}/local-output`, { recursive: true });
  await writeFile(`${context.root}/local-output/mutation.txt`, "coordinator-owned\n", "utf8");
  git(context.root, ["add", "local-output/mutation.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: coordinator-owned mutation"]);
  const completed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "file-present", argv: [process.execPath, "-e", "require('fs').accessSync('local-output/mutation.txt')"] }],
  });
  assert.equal(completed.result.kind, "mutation");
  const audited = await auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId });
  assert.equal(audited.audit.terminal_ready, true, JSON.stringify(audited.audit.blockers));
  assert.equal(audited.audit.counts.coordinator_work, 1);
  assert.equal(audited.audit.counts.task_launches, 0);
});

test("coordinator-owned no-change requires real passing checks and preserves the baseline", async (t) => {
  const context = await fixture(t, "no-change");
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: context.root,
      checks: [{ check_id: "fails", argv: [process.execPath, "-e", "process.exit(1)"] }],
    }),
    /verification failed/,
  );
  const completed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "passes", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  assert.equal(completed.result.kind, "no-change");
  const audited = await auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId });
  assert.equal(audited.audit.terminal_ready, true, JSON.stringify(audited.audit.blockers));
});

test("run audit rejects a clean checkout that matches no authenticated terminal Git fact", async (t) => {
  const context = await fixture(t, "unverified-terminal-revision");
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "passes", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  await writeFile(`${context.root}/unverified.txt`, "not terminal evidence\n", "utf8");
  git(context.root, ["add", "unverified.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: create unverified terminal revision"]);

  const audited = await auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId });
  assert.equal(audited.audit.terminal_ready, false);
  assert.equal(audited.audit.blockers.some((blocker) => blocker.code === "repository-drift"), true);
});

test("run audit rejects divergent maximal coordinator terminal facts", async (t) => {
  const firstTask = localTask("divergent-first");
  const secondTask = localTask("divergent-second");
  const context = await fixture(t, "divergent-terminal-facts", { tasks: [firstTask, secondTask] });
  const baseline = context.contract.current_baseline.revision;
  const secondContract = await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    taskId: secondTask.task_id,
    currentBaseline: { revision: baseline },
    dependencyAuthorities: [],
  });
  const firstStart = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  const secondStart = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: secondContract,
    repositoryPath: context.root,
  });
  await writeFile(resolve(context.root, "first-divergent.txt"), "first\n", "utf8");
  git(context.root, ["add", "first-divergent.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: first divergent result"]);
  await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: firstStart.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "first-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  await commitSibling(context.root, baseline, "second-divergent");
  await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: secondStart.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "second-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const audited = await auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId });
  assert.equal(audited.audit.terminal_ready, false);
  assert.equal(
    audited.audit.blockers.some((blocker) => blocker.code === "conflicting-authority"),
    true,
  );
});

test("completed coordinator work supplies persisted dependency authority to every consumer", async (t) => {
  const source = localTask("dependency-source");
  const localDependent = dependencyTask("dependency-local", "coordinator", source.task_id);
  const visibleDependent = dependencyTask("dependency-visible", "task-thread", source.task_id);
  const subagentDependent = dependencyTask("dependency-subagent", "subagent", source.task_id);
  const executorBranch = "codex/local-dependency-visible";
  const context = await fixture(t, "dependency-consumers", {
    tasks: [source, localDependent, visibleDependent, subagentDependent],
    branchFences: [executorBranch],
  });
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await mkdir(`${context.root}/local-output`, { recursive: true });
  await writeFile(`${context.root}/local-output/dependency-source.txt`, "source\n", "utf8");
  git(context.root, ["add", "local-output/dependency-source.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: persist local dependency source"]);
  const completed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "source-present", argv: [process.execPath, "-e", "require('fs').accessSync('local-output/dependency-source.txt')"] }],
  });
  const baseline = git(context.root, ["rev-parse", "HEAD"]);
  const dependencyAuthorities = [{
    authority_kind: "coordinator-work",
    authority_id: completed.local_work_id,
  }];
  const contracts = new Map();
  for (const task of [localDependent, visibleDependent, subagentDependent]) {
    const contract = await persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      taskId: task.task_id,
      currentBaseline: { revision: baseline },
      dependencyAuthorities,
    });
    assert.equal(contract.accepted_dependencies.length, 1);
    assert.equal(contract.accepted_dependencies[0].task_id, source.task_id);
    assert.equal(contract.accepted_dependencies[0].authority_kind, "coordinator-work");
    assert.equal(contract.accepted_dependencies[0].authority_id, completed.local_work_id);
    contracts.set(task.execution_kind, contract);
  }
  const localStart = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: contracts.get("coordinator"),
    repositoryPath: context.root,
  });
  assert.equal(localStart.task_id, localDependent.task_id);
  const visibleStart = await prepareTaskLaunch({
    stateRoot: context.stateRoot,
    taskContract: contracts.get("task-thread"),
    requestedSelectors: {
      project_id: "project-local-dependency",
      model: visibleDependent.model,
      reasoning_effort: visibleDependent.reasoning_effort,
      worktree: {
        mode: "host-worktree",
        starting_revision: baseline,
        starting_branch: "main",
        executor_branch: executorBranch,
        path: null,
      },
    },
  });
  assert.equal(visibleStart.task_id, visibleDependent.task_id);
  const subagentStart = await prepareSubagentOperation({
    stateRoot: context.stateRoot,
    task_contract: contracts.get("subagent"),
    model: subagentDependent.model,
    reasoning_effort: subagentDependent.reasoning_effort,
    fork_turns: subagentDependent.fork_turns,
    mode: "read",
    prompt_digest: sha256("Review the completed local dependency."),
    worktree_path: context.root,
  });
  assert.equal(subagentStart.task_id, subagentDependent.task_id);
});

test("coordinator dependency consumption rejects unfinished, failed, and wrong-task authority", async (t) => {
  const source = localTask("dependency-negative-source");
  const unrelated = localTask("dependency-negative-unrelated");
  const dependent = dependencyTask("dependency-negative-target", "coordinator", source.task_id);
  const context = await fixture(t, "dependency-negative", { tasks: [source, unrelated, dependent] });
  const sourceStart = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  const dependentRequest = (authorityId) => persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    taskId: dependent.task_id,
    currentBaseline: { revision: git(context.root, ["rev-parse", "HEAD"]) },
    dependencyAuthorities: [{ authority_kind: "coordinator-work", authority_id: authorityId }],
  });
  await assert.rejects(dependentRequest(sourceStart.local_work_id), /not completed and verified/);
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: sourceStart.local_work_id,
      repositoryPath: context.root,
      checks: [{ check_id: "failed-source", argv: [process.execPath, "-e", "process.exit(1)"] }],
    }),
    /verification failed/,
  );
  await assert.rejects(dependentRequest(sourceStart.local_work_id), /not completed and verified/);
  const unrelatedContract = await persistWorkflowTaskContract({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
    taskId: unrelated.task_id,
    currentBaseline: { revision: git(context.root, ["rev-parse", "HEAD"]) },
    dependencyAuthorities: [],
  });
  const unrelatedStart = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: unrelatedContract,
    repositoryPath: context.root,
  });
  const unrelatedComplete = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: unrelatedStart.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "unrelated-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  await assert.rejects(dependentRequest(unrelatedComplete.local_work_id), /resolved outside the task dependency set/);

  const foreign = await fixture(t, "dependency-wrong-runtime", {
    tasks: [localTask("dependency-negative-source")],
  });
  const foreignStart = await startCoordinatorWork({
    stateRoot: foreign.stateRoot,
    taskContract: foreign.contract,
    repositoryPath: foreign.root,
  });
  const foreignComplete = await completeCoordinatorWork({
    stateRoot: foreign.stateRoot,
    localWorkId: foreignStart.local_work_id,
    repositoryPath: foreign.root,
    checks: [{ check_id: "foreign-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const foreignRecordPath = resolve(
    foreign.stateRoot,
    "coordinator-work",
    "records",
    `${foreignComplete.local_work_id}.json`,
  );
  await writeFile(
    resolve(context.stateRoot, "coordinator-work", "records", `${foreignComplete.local_work_id}.json`),
    await readFile(foreignRecordPath),
  );
  process.env.CODEX_THREAD_ID = context.contract.coordinator_binding.thread_id;
  await assert.rejects(
    dependentRequest(foreignComplete.local_work_id),
    /no persisted workflow contract claim|does not match its persisted workflow authority|absent from the current baseline/,
  );
});

test("coordinator dependency admission rejects a sibling baseline that omits the completed mutation", async (t) => {
  const source = localTask("dependency-sibling-source");
  const dependent = dependencyTask("dependency-sibling-target", "coordinator", source.task_id);
  const context = await fixture(t, "dependency-sibling", { tasks: [source, dependent] });
  const startingRevision = context.contract.current_baseline.revision;
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await writeFile(resolve(context.root, "source-mutation.txt"), "required\n", "utf8");
  git(context.root, ["add", "source-mutation.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: required dependency mutation"]);
  const completed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "source-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const siblingRevision = await commitSibling(context.root, startingRevision, "sibling-baseline");
  await assert.rejects(
    persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      taskId: dependent.task_id,
      currentBaseline: { revision: siblingRevision },
      dependencyAuthorities: [{
        authority_kind: "coordinator-work",
        authority_id: completed.local_work_id,
      }],
    }),
    /absent from the current baseline/,
  );
});

test("coordinator authority rejects a self-consistent terminal record with a substituted contract baseline", async (t) => {
  const context = await fixture(t, "substituted-baseline");
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await writeFile(resolve(context.root, "substituted-baseline.txt"), "mutation\n", "utf8");
  git(context.root, ["add", "substituted-baseline.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: substituted baseline mutation"]);
  const completed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks: [{ check_id: "passes", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const recordPath = resolve(
    context.stateRoot,
    "coordinator-work",
    "records",
    `${completed.local_work_id}.json`,
  );
  const substituted = JSON.parse(await readFile(recordPath, "utf8"));
  substituted.baseline.revision = completed.result.final_revision;
  substituted.result = {
    kind: "no-change",
    baseline_revision: completed.result.final_revision,
    final_revision: completed.result.final_revision,
  };
  await writeFile(recordPath, `${JSON.stringify(substituted)}\n`, "utf8");
  await assert.rejects(
    auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId }),
    /baseline does not match its persisted task contract/,
  );
});

test("later-time start replay preserves identity and reconciles interrupted start persistence", async (t) => {
  const context = await fixture(t, "start-replay");
  const startedAt = Date.now() + 60_000;
  const interrupted = startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
    now: startedAt,
    interruptAfterStartPersist() {
      throw new Error("simulated process interruption after start persistence");
    },
  });
  await assert.rejects(interrupted, /simulated process interruption/);
  const replayed = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
    now: startedAt + 60_000,
  });
  assert.equal(replayed.started_at, new Date(startedAt).toISOString());
  const laterReplay = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
    now: startedAt + 120_000,
  });
  assert.deepEqual(laterReplay, replayed);
  await writeFile(resolve(context.root, "dirty-replay.txt"), "dirty\n", "utf8");
  await assert.rejects(
    startCoordinatorWork({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      repositoryPath: context.root,
      now: startedAt + 180_000,
    }),
    /clean authoritative repository/,
  );
  await rm(resolve(context.root, "dirty-replay.txt"));
});

test("completion replay reconciles its claim without rerunning verification", async (t) => {
  const context = await fixture(t, "completion-replay");
  const counterRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-completion-count-"));
  t.after(() => rm(counterRoot, { recursive: true, force: true }));
  const counterPath = resolve(counterRoot, "count.txt");
  const checks = [{
    check_id: "count-once",
    argv: [process.execPath, "-e", "require('fs').appendFileSync(process.argv[1], 'x')", counterPath],
  }];
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: context.root,
      checks,
      interruptAfterCompletionPersist() {
        throw new Error("simulated process interruption after completion persistence");
      },
    }),
    /simulated process interruption/,
  );
  assert.equal(await readFile(counterPath, "utf8"), "x");
  const replayed = await completeCoordinatorWork({
    stateRoot: context.stateRoot,
    localWorkId: started.local_work_id,
    repositoryPath: context.root,
    checks,
  });
  assert.equal(await readFile(counterPath, "utf8"), "x");
  const status = await workflowJournalStatus({
    stateRoot: context.stateRoot,
    runId: context.runId,
    planId: context.plan.plan_id,
  });
  assert.equal(status.contracts[0].claim.state, "completed");
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: context.root,
      checks: [{ check_id: "different", argv: [process.execPath, "-e", "process.exit(0)"] }],
    }),
    /different verification authority/,
  );
  const audited = await auditRunClosure({ stateRoot: context.stateRoot, runId: context.runId });
  assert.equal(audited.audit.terminal_ready, true, JSON.stringify(audited.audit.blockers));
  assert.equal(replayed.completed_at, (await readFile(
    resolve(context.stateRoot, "coordinator-work", "records", `${started.local_work_id}.json`),
    "utf8",
  ).then(JSON.parse)).completed_at);
});

test("completion replay rejects a sibling checkout that omits the persisted mutation", async (t) => {
  const context = await fixture(t, "completion-sibling-replay");
  const startingRevision = context.contract.current_baseline.revision;
  const checks = [{ check_id: "passes", argv: [process.execPath, "-e", "process.exit(0)"] }];
  const started = await startCoordinatorWork({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    repositoryPath: context.root,
  });
  await writeFile(resolve(context.root, "persisted-mutation.txt"), "required\n", "utf8");
  git(context.root, ["add", "persisted-mutation.txt"]);
  git(context.root, ["commit", "--quiet", "-m", "test: persisted replay mutation"]);
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: context.root,
      checks,
      interruptAfterCompletionPersist() {
        throw new Error("simulated process interruption after mutation persistence");
      },
    }),
    /simulated process interruption after mutation persistence/,
  );
  await commitSibling(context.root, startingRevision, "sibling-replay");
  await assert.rejects(
    completeCoordinatorWork({
      stateRoot: context.stateRoot,
      localWorkId: started.local_work_id,
      repositoryPath: context.root,
      checks,
    }),
    /required authority/,
  );
});
