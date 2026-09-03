import { consumeRefreshActivation } from "./lib/refresh-v08.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  readRuntimeContext,
} from "./lib/runtime-context.mjs";
import { createWorkflowPlanRevision } from "./lib/workflow-plan.mjs";
import {
  admitRunWithRepositoryLockHeld,
  buildFencePlan,
  readRunLifecycle,
} from "./lib/run-lifecycle.mjs";
import {
  createWorkflowJournal,
  workflowJournalStatus,
} from "./lib/workflow-journal-v07.mjs";
import { gitSnapshot } from "./lib/git.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const { activation } = request;
const git = gitSnapshot(request.repository_root);
const workflow = createWorkflowPlanRevision(activation.workflow);
const fences = buildFencePlan({
  pathFences: activation.fences.path_fences,
  resourceFences: activation.fences.resource_fences,
  branchFences: activation.fences.branch_fences,
});
const bundleSource = await loadRuntimeBundleSource({ packageRoot: request.package_root });
const runtime = buildRuntimeContext({
  bundle: bundleSource.bundle,
  createdAt: activation.activated_at,
  config: activation.runtime.config,
  policy: activation.runtime.policy,
  repository: {
    common_dir: git.commonDir,
    root: git.root,
    branch: git.branch,
    revision: git.revision,
  },
  host: activation.runtime.host,
  lineage: activation.runtime.lineage,
});
const lifecycle = await readRunLifecycle({ gitCommonDirectory: git.commonDir });
const existingRun = lifecycle.state.runs[activation.run_id] ?? null;
const prepare = async () => ({
  acquired: await acquireRuntimeContext({
    gitCommonDirectory: git.commonDir,
    context: runtime,
    bundleSource,
  }),
  journal: await createWorkflowJournal({
    stateRoot: git.stateRoot,
    runId: activation.run_id,
    planId: workflow.plan_id,
    planRevision: workflow,
    now: Date.parse(activation.activated_at),
  }),
});
const readExisting = async () => ({
  acquired: {
    ...await readRuntimeContext({
      gitCommonDirectory: git.commonDir,
      runtimeId: runtime.runtime_id,
    }),
    status: "existing",
  },
  journal: await workflowJournalStatus({
    stateRoot: git.stateRoot,
    runId: activation.run_id,
    planId: workflow.plan_id,
  }),
});
const hooks = request.crash_after === null || request.crash_after === undefined
  ? {}
  : {
      [request.crash_after]() {
        throw new Error(`simulated crash at ${request.crash_after}`);
      },
    };

const result = await consumeRefreshActivation({
  commonDir: git.commonDir,
  stateRoot: git.stateRoot,
  refreshId: request.refresh_id,
  runId: activation.run_id,
  runtime,
  workflow,
  fences,
  activatedAt: activation.activated_at,
  prepare,
  readExisting,
  existingRun,
  admit: (repositoryLockToken) => admitRunWithRepositoryLockHeld({
    gitCommonDirectory: git.commonDir,
    runId: activation.run_id,
    runtimeId: runtime.runtime_id,
    workflowPlanId: workflow.plan_id,
    workflowRevisionDigest: workflow.revision_digest,
    plan: fences,
    admittedAt: activation.activated_at,
    repositoryLockToken,
  }),
  hooks,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
