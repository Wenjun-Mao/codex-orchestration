import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  readRuntimeContext,
} from "../lib/runtime-context.mjs";
import {
  abandonRun,
  admitRun,
  buildFencePlan,
  closeRun,
  fencePlanConflicts,
  readRunLifecycle,
  rebindRun,
  retainedRunFences,
  resumeRun,
} from "../lib/run-lifecycle.mjs";
import { createWorkflowJournal } from "../lib/workflow-journal-v06.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const REVISION = "a".repeat(40);
const INITIAL_TIME = "2026-08-29T12:00:00.000Z";

function runtimeFor(root, bundleSource, {
  hostId = "host-a",
  sessionId = "session-a",
  lineageId = "lineage-a",
  threadId = "thread-a",
  generation = 1,
} = {}) {
  const commonDir = resolve(root, ".git");
  return buildRuntimeContext({
    bundle: bundleSource.bundle,
    createdAt: INITIAL_TIME,
    config: {
      config_id: "runtime-config-v1",
      snapshot: { mode: "ephemeral", selectors: { model: "gpt-5.6-terra" } },
    },
    policy: {
      policy_id: "runtime-policy-v1",
      snapshot: { callbacks: "journaled", urgent: "direct" },
    },
    repository: {
      common_dir: commonDir,
      root,
      branch: "main",
      revision: REVISION,
    },
    host: {
      host_id: hostId,
      session_id: sessionId,
    },
    lineage: {
      lineage_id: lineageId,
      thread_id: threadId,
      generation,
    },
  });
}

async function runtimeBundleFor(root, suffix) {
  const packageRoot = resolve(root, `plugin-source-${suffix}`);
  const files = new Map([
    ["bin/codex-flow.mjs", "#!/usr/bin/env node\n"],
    ["lib/runtime.mjs", "export const runtime = true;\n"],
    ["schemas/runtime.schema.json", "{}\n"],
    ["templates/roles/coordinator.md", "Coordinator runtime role.\n"],
    ["templates/references/lifecycle.md", "Runtime lifecycle.\n"],
  ]);
  for (const [path, contents] of files) {
    const target = resolve(packageRoot, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return {
    packageRoot,
    bundleSource: await loadRuntimeBundleSource({ packageRoot }),
  };
}

async function seedV05Audit(commonDir) {
  const path = join(commonDir, "codex-flow", "v0.5.1", "audit.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "v0.5 audit must remain byte-for-byte\n", "utf8");
  return { path, bytes: await readFile(path) };
}

function fullPlan(suffix) {
  return buildFencePlan({
    pathFences: [`lib/${suffix}`],
    resourceFences: [`resource-${suffix}`],
    branchFences: [`codex/${suffix}`],
  });
}

function workflowBinding(suffix) {
  return {
    workflowPlanId: `workflow-${suffix}`,
    workflowRevisionDigest: "c".repeat(64),
  };
}

test("v0.6 runtime snapshots are immutable while one active run resumes and rebinds", async (t) => {
  const root = await createGitFixture("codex-flow-v06-run-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const v05 = await seedV05Audit(commonDir);
  const { bundleSource } = await runtimeBundleFor(root, "run");
  const runtime = runtimeFor(root, bundleSource);

  const firstAcquisition = await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  assert.equal(firstAcquisition.status, "created");
  const repeatedAcquisition = await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  assert.equal(repeatedAcquisition.status, "existing");
  await assert.rejects(
    acquireRuntimeContext({
      gitCommonDirectory: commonDir,
      context: {
        ...runtime,
        config: {
          ...runtime.config,
          snapshot: { mode: "different" },
        },
      },
      bundleSource,
    }),
    /content-addressed context/,
  );

  const plan = fullPlan("runtime");
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    runtimeId: runtime.runtime_id,
    ...workflowBinding("runtime"),
    plan,
    admittedAt: "2026-08-29T12:01:00.000Z",
  });
  assert.equal(admitted.status, "admitted");
  const repeatedAdmission = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    runtimeId: runtime.runtime_id,
    ...workflowBinding("runtime"),
    plan,
    admittedAt: "2026-08-29T12:01:00.000Z",
  });
  assert.equal(repeatedAdmission.status, "already-active");
  await assert.rejects(
    admitRun({
      gitCommonDirectory: commonDir,
      runId: "run-one",
      runtimeId: runtime.runtime_id,
      workflowPlanId: "workflow-runtime",
      workflowRevisionDigest: "d".repeat(64),
      plan,
      admittedAt: "2026-08-29T12:01:00.000Z",
    }),
    /does not match its immutable activation/,
  );
  const resumed = await resumeRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    resume: admitted.run.binding,
  });
  assert.equal(resumed.run.binding.generation, 1);

  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  await assert.rejects(
    admitRun({
      gitCommonDirectory: commonDir,
      runId: "run-two",
      runtimeId: runtime.runtime_id,
      ...workflowBinding("other"),
      plan: fullPlan("other"),
      admittedAt: "2026-08-29T12:02:00.000Z",
    }),
    /already active/,
  );

  const rebound = await rebindRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    resume: resumed.resume,
    next: {
      host: { host_id: "host-b", session_id: "session-b" },
      lineage: { lineage_id: "lineage-b", thread_id: "thread-b", generation: 2 },
    },
    reboundAt: "2026-08-29T12:03:00.000Z",
  });
  assert.equal(rebound.run.binding.generation, 2);
  assert.equal(rebound.run.workflow_plan_id, "workflow-runtime");
  assert.equal(rebound.run.workflow_revision_digest, "c".repeat(64));
  await assert.rejects(
    resumeRun({
      gitCommonDirectory: commonDir,
      runId: "run-one",
      resume: resumed.resume,
    }),
    /resume fence does not match/,
  );
  const resumedAfterRebind = await resumeRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    resume: rebound.resume,
  });
  assert.equal(resumedAfterRebind.run.binding.host.host_id, "host-b");

  const closed = await closeRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    resume: rebound.resume,
    closedAt: "2026-08-29T12:04:00.000Z",
  });
  assert.equal(closed.run.status, "closed");
  const restarted = await readRunLifecycle({ gitCommonDirectory: commonDir });
  assert.equal(restarted.state.active_run_id, null);
  assert.equal(restarted.state.runs["run-one"].terminal.kind, "closed");
  assert.deepEqual(await readFile(v05.path), v05.bytes);
});

test("abandoned runs retain all fence types and permit only a disjoint next plan", async (t) => {
  const root = await createGitFixture("codex-flow-v06-fence-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const v05 = await seedV05Audit(commonDir);
  const { bundleSource } = await runtimeBundleFor(root, "fence");
  const runtime = runtimeFor(root, bundleSource);
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  const abandonedPlan = fullPlan("claimed");
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-abandoned",
    runtimeId: runtime.runtime_id,
    ...workflowBinding("claimed"),
    plan: abandonedPlan,
    admittedAt: "2026-08-29T13:00:00.000Z",
  });
  await abandonRun({
    gitCommonDirectory: commonDir,
    runId: "run-abandoned",
    resume: admitted.run.binding,
    unresolvedFences: buildFencePlan({ pathFences: ["lib/claimed"] }),
    reason: "Executor ownership could not be reconciled.",
    abandonedAt: "2026-08-29T13:01:00.000Z",
  });
  assert.deepEqual(await retainedRunFences({ gitCommonDirectory: commonDir }), [{
    run_id: "run-abandoned",
    unresolved_fences: abandonedPlan,
  }]);

  await assert.rejects(
    admitRun({
      gitCommonDirectory: commonDir,
      runId: "run-overlap",
      runtimeId: runtime.runtime_id,
      ...workflowBinding("overlap"),
      plan: buildFencePlan({
        pathFences: ["lib/claimed/child"],
        resourceFences: [],
        branchFences: [],
      }),
      admittedAt: "2026-08-29T13:02:00.000Z",
    }),
    /retained fences/,
  );

  const disjointPlan = fullPlan("disjoint");
  const conflicts = fencePlanConflicts(abandonedPlan, disjointPlan);
  assert.deepEqual(conflicts, []);
  const next = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-disjoint",
    runtimeId: runtime.runtime_id,
    ...workflowBinding("disjoint"),
    plan: disjointPlan,
    admittedAt: "2026-08-29T13:03:00.000Z",
  });
  assert.equal(next.status, "admitted");
  await closeRun({
    gitCommonDirectory: commonDir,
    runId: "run-disjoint",
    resume: next.run.binding,
    closedAt: "2026-08-29T13:04:00.000Z",
  });
  assert.deepEqual(await readFile(v05.path), v05.bytes);
});

test("fence conflict detection covers path, resource, and branch reservations", () => {
  const original = buildFencePlan({
    pathFences: ["lib/foundation"],
    resourceFences: ["shared-resource"],
    branchFences: ["codex/foundation"],
  });
  const candidate = buildFencePlan({
    pathFences: ["lib/foundation/runtime"],
    resourceFences: ["shared-resource"],
    branchFences: ["codex/foundation"],
  });
  assert.deepEqual(
    fencePlanConflicts(original, candidate).map((conflict) => conflict.type),
    ["path", "resource", "branch"],
  );
});

test("run admission binds a persisted root workflow to its path and resource envelope", async (t) => {
  const root = await createGitFixture("codex-flow-v06-root-envelope-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const { bundleSource } = await runtimeBundleFor(root, "root-envelope");
  const runtime = runtimeFor(root, bundleSource);
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  const workflow = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "root-envelope-plan",
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: "implementation",
      title: "Implement inside the reservation",
      execution_kind: "task-thread",
      mode: "write",
      model: "gpt-5.6-terra",
      reasoning_effort: "xhigh",
      fork_turns: null,
      dependencies: [],
      read_paths: ["lib"],
      write_paths: ["lib/reserved.mjs"],
      shared_resources: ["browser-session"],
      primary_outcome: "Implement one bounded change.",
      causal_question: null,
      cheapest_safe_direct_attempt: "Implement the file and run its focused test.",
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
  await createWorkflowJournal({
    stateRoot: resolve(commonDir, "codex-flow", "v0.6.0"),
    runId: "run-root-envelope",
    planId: workflow.plan_id,
    planRevision: workflow,
    now: Date.parse("2026-08-29T14:00:00.000Z"),
  });
  const request = {
    gitCommonDirectory: commonDir,
    runId: "run-root-envelope",
    runtimeId: runtime.runtime_id,
    workflowPlanId: workflow.plan_id,
    workflowRevisionDigest: workflow.revision_digest,
    admittedAt: "2026-08-29T14:01:00.000Z",
  };
  await assert.rejects(
    admitRun({ ...request, plan: buildFencePlan() }),
    /write path is outside the admitted run fence envelope/,
  );
  await assert.rejects(
    admitRun({
      ...request,
      plan: buildFencePlan({ pathFences: ["lib"] }),
    }),
    /shared resource is outside the admitted run fence envelope/,
  );
  const admitted = await admitRun({
    ...request,
    plan: buildFencePlan({
      pathFences: ["lib"],
      resourceFences: ["browser-session"],
    }),
  });
  assert.equal(admitted.status, "admitted");
});

test("runtime reads retain the exact bundle after the plugin source disappears", async (t) => {
  const root = await createGitFixture("codex-flow-v06-runtime-read-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const { packageRoot, bundleSource } = await runtimeBundleFor(root, "retained");
  const runtime = runtimeFor(root, bundleSource);
  const acquired = await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  assert.match(acquired.bundle_root, /codex-flow\/v0\.6\.0\/runtimes\/[0-9a-f]{64}\/files$/);
  await stat(resolve(acquired.bundle_root, "bin", "codex-flow.mjs"));
  await rm(packageRoot, { recursive: true, force: true });
  const read = await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
  });
  assert.deepEqual(read.context, runtime);
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-after-plugin-removal",
    runtimeId: runtime.runtime_id,
    ...workflowBinding("plugin-removed"),
    plan: fullPlan("plugin-removed"),
    admittedAt: "2026-08-29T15:00:00.000Z",
  });
  assert.equal(admitted.run.binding.bundle_hash, runtime.bundle.bundle_sha256);
  assert.equal(admitted.run.binding.policy_hash.length, 64);
  await writeFile(resolve(acquired.bundle_root, "bin", "codex-flow.mjs"), "tampered\n", "utf8");
  await assert.rejects(
    readRuntimeContext({ gitCommonDirectory: commonDir, runtimeId: runtime.runtime_id }),
    /file hash does not match/,
  );
});
