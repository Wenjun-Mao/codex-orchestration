import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import {
  completeCoordinatorWork,
  startCoordinatorWork,
} from "../lib/coordinator-work.mjs";
import { auditRunClosure } from "../lib/run-audit.mjs";
import { createWorkflowJournal, persistWorkflowTaskContract } from "../lib/workflow-journal.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import { activateFixtureRun, createGitFixture, removeFixture } from "./helpers.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function localTask(suffix) {
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
  };
}

async function fixture(t, suffix) {
  const root = await createGitFixture(`codex-flow-v097-local-${suffix}-`);
  t.after(() => removeFixture(root));
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `local-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [localTask(suffix)],
  });
  const lineage = {
    lineage_id: `local-lineage-${suffix}`,
    thread_id: `local-coordinator-${suffix}`,
    generation: 1,
  };
  const runId = `local-run-${suffix}`;
  const activated = await activateFixtureRun({ root, runId, plan, lineage });
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
    taskId: plan.tasks[0].task_id,
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
