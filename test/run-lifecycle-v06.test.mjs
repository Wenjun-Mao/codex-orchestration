import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
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
import { createGitFixture, removeFixture } from "./helpers.mjs";

const REVISION = "a".repeat(40);
const INITIAL_TIME = "2026-08-29T12:00:00.000Z";

function runtimeFor(root, runtimeId, {
  hostId = "host-a",
  sessionId = "session-a",
  lineageId = "lineage-a",
  threadId = "thread-a",
  generation = 1,
} = {}) {
  const commonDir = resolve(root, ".git");
  return buildRuntimeContext({
    runtimeId,
    createdAt: INITIAL_TIME,
    config: {
      config_id: "runtime-config-v1",
      snapshot: { mode: "ephemeral", selectors: { model: "gpt-5.6-terra" } },
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
    operationFences: [`operation-${suffix}`],
  });
}

test("v0.6 runtime snapshots are immutable while one active run resumes and rebinds", async (t) => {
  const root = await createGitFixture("codex-flow-v06-run-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const v05 = await seedV05Audit(commonDir);
  const runtime = runtimeFor(root, "runtime-one");

  const firstAcquisition = await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime });
  assert.equal(firstAcquisition.status, "created");
  const repeatedAcquisition = await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime });
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
    }),
    /Existing state does not match/,
  );

  const plan = fullPlan("runtime");
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    runtimeId: "runtime-one",
    plan,
    admittedAt: "2026-08-29T12:01:00.000Z",
  });
  assert.equal(admitted.status, "admitted");
  const resumed = await resumeRun({
    gitCommonDirectory: commonDir,
    runId: "run-one",
    resume: admitted.run.binding,
  });
  assert.equal(resumed.run.binding.generation, 1);

  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtimeFor(root, "runtime-two"),
  });
  await assert.rejects(
    admitRun({
      gitCommonDirectory: commonDir,
      runId: "run-two",
      runtimeId: "runtime-two",
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
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtimeFor(root, "runtime-abandoned"),
  });
  const abandonedPlan = fullPlan("claimed");
  const admitted = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-abandoned",
    runtimeId: "runtime-abandoned",
    plan: abandonedPlan,
    admittedAt: "2026-08-29T13:00:00.000Z",
  });
  await abandonRun({
    gitCommonDirectory: commonDir,
    runId: "run-abandoned",
    resume: admitted.run.binding,
    unresolvedFences: abandonedPlan,
    reason: "Executor ownership could not be reconciled.",
    abandonedAt: "2026-08-29T13:01:00.000Z",
  });
  assert.deepEqual(await retainedRunFences({ gitCommonDirectory: commonDir }), [{
    run_id: "run-abandoned",
    unresolved_fences: abandonedPlan,
  }]);

  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtimeFor(root, "runtime-overlap"),
  });
  await assert.rejects(
    admitRun({
      gitCommonDirectory: commonDir,
      runId: "run-overlap",
      runtimeId: "runtime-overlap",
      plan: buildFencePlan({
        pathFences: ["lib/claimed/child"],
        resourceFences: [],
        branchFences: [],
        operationFences: [],
      }),
      admittedAt: "2026-08-29T13:02:00.000Z",
    }),
    /retained fences/,
  );

  const disjointPlan = fullPlan("disjoint");
  const conflicts = fencePlanConflicts(abandonedPlan, disjointPlan);
  assert.deepEqual(conflicts, []);
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtimeFor(root, "runtime-disjoint"),
  });
  const next = await admitRun({
    gitCommonDirectory: commonDir,
    runId: "run-disjoint",
    runtimeId: "runtime-disjoint",
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

test("fence conflict detection covers paths, resources, branches, and operations", () => {
  const original = buildFencePlan({
    pathFences: ["lib/foundation"],
    resourceFences: ["shared-resource"],
    branchFences: ["codex/foundation"],
    operationFences: ["task-operation-foundation"],
  });
  const candidate = buildFencePlan({
    pathFences: ["lib/foundation/runtime"],
    resourceFences: ["shared-resource"],
    branchFences: ["codex/foundation"],
    operationFences: ["task-operation-foundation"],
  });
  assert.deepEqual(
    fencePlanConflicts(original, candidate).map((conflict) => conflict.type),
    ["path", "resource", "branch", "operation"],
  );
});

test("runtime reads retain the exact persisted snapshot", async (t) => {
  const root = await createGitFixture("codex-flow-v06-runtime-read-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const runtime = runtimeFor(root, "runtime-retained");
  await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime });
  const read = await readRuntimeContext({ gitCommonDirectory: commonDir, runtimeId: "runtime-retained" });
  assert.deepEqual(read.context, runtime);
});
