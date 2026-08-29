import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  adoptionInstructionsPath,
  adoptionManifestPath,
  applyAdoptionPlan,
  applyAdoptionRetirementPlan,
  planAdoption,
  planAdoptionRetirement,
  readAdoption,
} from "../lib/adoption-v06.mjs";
import { acquireRuntimeContext, buildRuntimeContext, readRuntimeContext } from "../lib/runtime-context.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const REVISION = "b".repeat(40);

function runtimeFor(root) {
  return buildRuntimeContext({
    runtimeId: "runtime-adoption",
    createdAt: "2026-08-29T14:00:00.000Z",
    config: {
      config_id: "ephemeral-config",
      snapshot: { activation: "v0.6", mutable: false },
    },
    repository: {
      common_dir: resolve(root, ".git"),
      root,
      branch: "main",
      revision: REVISION,
    },
    host: { host_id: "host-adoption", session_id: "session-adoption" },
    lineage: { lineage_id: "lineage-adoption", thread_id: "thread-adoption", generation: 1 },
  });
}

async function seedV05Audit(commonDir) {
  const path = join(commonDir, "codex-flow", "v0.5.1", "existing-audit.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "unchanged v0.5 audit\n", "utf8");
  return { path, bytes: await readFile(path) };
}

async function prepareAdoption(root) {
  const commonDir = resolve(root, ".git");
  const runtime = runtimeFor(root);
  await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime });
  const plan = await planAdoption({
    repositoryRoot: root,
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
    config: { coordinator: "v0.6", version: 1 },
    policy: { retirement: "plan-apply", v05: "preserve" },
    reviewedInstructions: {
      reviewed_by: "release-review",
      reviewed_at: "2026-08-29T14:01:00.000Z",
      text: "Use the exact bound runtime. Review retirement before applying it.",
    },
    adoptedAt: "2026-08-29T14:02:00.000Z",
  });
  return { commonDir, runtime, plan };
}

test("adoption plan applies exact runtime, config, policy, and reviewed instructions", async (t) => {
  const root = await createGitFixture("codex-flow-v06-adoption-");
  t.after(() => removeFixture(root));
  const { commonDir, runtime, plan } = await prepareAdoption(root);
  const v05 = await seedV05Audit(commonDir);
  const runtimeBytes = await readFile(
    resolve(commonDir, "codex-flow", "v0.6", "runtimes", runtime.runtime_id, "runtime.json"),
  );

  assert.deepEqual(
    plan.operations.map((operation) => operation.path),
    [".codex/orchestration/v0.6/adoption.json", ".codex/orchestration/v0.6/INSTRUCTIONS.md"],
  );
  const applied = await applyAdoptionPlan({ repositoryRoot: root, plan });
  assert.equal(applied.applied.length, 2);
  const adoption = await readAdoption({ repositoryRoot: root });
  assert.deepEqual(adoption.adoption.runtime, runtime);
  assert.deepEqual(adoption.adoption.config, { coordinator: "v0.6", version: 1 });
  assert.deepEqual(adoption.adoption.policy, { retirement: "plan-apply", v05: "preserve" });
  assert.match(await readFile(adoptionInstructionsPath(root), "utf8"), /Review retirement before applying it/);
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual(
    await readFile(resolve(commonDir, "codex-flow", "v0.6", "runtimes", runtime.runtime_id, "runtime.json")),
    runtimeBytes,
  );

  const repeatPlan = await planAdoption({
    repositoryRoot: root,
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
    config: { coordinator: "v0.6", version: 1 },
    policy: { retirement: "plan-apply", v05: "preserve" },
    reviewedInstructions: {
      reviewed_by: "release-review",
      reviewed_at: "2026-08-29T14:01:00.000Z",
      text: "Use the exact bound runtime. Review retirement before applying it.",
    },
    adoptedAt: "2026-08-29T14:02:00.000Z",
  });
  assert.deepEqual(repeatPlan.operations, []);
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual((await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
  })).context, runtime);
});

test("retirement requires a reviewed plan and deletes only v0.6 tracked adoption files", async (t) => {
  const root = await createGitFixture("codex-flow-v06-retirement-");
  t.after(() => removeFixture(root));
  const { commonDir, runtime, plan } = await prepareAdoption(root);
  const v05 = await seedV05Audit(commonDir);
  await applyAdoptionPlan({ repositoryRoot: root, plan });
  const runtimePath = resolve(commonDir, "codex-flow", "v0.6", "runtimes", runtime.runtime_id, "runtime.json");
  const runtimeBytes = await readFile(runtimePath);

  const retirement = await planAdoptionRetirement({
    repositoryRoot: root,
    retiredAt: "2026-08-29T14:03:00.000Z",
    reason: "The permanent adoption was deliberately retired.",
  });
  assert.deepEqual(
    retirement.operations.map((operation) => operation.action),
    ["delete", "delete"],
  );
  const applied = await applyAdoptionRetirementPlan({ repositoryRoot: root, plan: retirement });
  assert.equal(applied.applied.length, 2);
  await assert.rejects(stat(adoptionManifestPath(root)), { code: "ENOENT" });
  await assert.rejects(stat(adoptionInstructionsPath(root)), { code: "ENOENT" });
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual(await readFile(runtimePath), runtimeBytes);
});
