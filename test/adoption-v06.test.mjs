import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  readRuntimeContext,
} from "../lib/runtime-context.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const REVISION = "b".repeat(40);

function runtimeFor(root, bundleSource) {
  return buildRuntimeContext({
    bundle: bundleSource.bundle,
    createdAt: "2026-08-29T14:00:00.000Z",
    config: {
      config_id: "ephemeral-config",
      snapshot: { activation: "v0.6", mutable: false },
    },
    policy: {
      policy_id: "ephemeral-policy",
      snapshot: { retirement: "plan-apply", v05: "preserve" },
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

async function runtimeBundleFor(root) {
  const packageRoot = resolve(root, "plugin-source-adoption");
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
  const path = join(commonDir, "codex-flow", "v0.5.1", "existing-audit.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "unchanged v0.5 audit\n", "utf8");
  return { path, bytes: await readFile(path) };
}

async function prepareAdoption(root) {
  const commonDir = resolve(root, ".git");
  const { packageRoot, bundleSource } = await runtimeBundleFor(root);
  const runtime = runtimeFor(root, bundleSource);
  await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime, bundleSource });
  const plan = await planAdoption({
    repositoryRoot: root,
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
    adoptedAt: "2026-08-29T14:02:00.000Z",
  });
  return { commonDir, runtime, plan, packageRoot };
}

test("adoption plan applies only the exact runtime, config, and structured policy", async (t) => {
  const root = await createGitFixture("codex-flow-v06-adoption-");
  t.after(() => removeFixture(root));
  const { commonDir, runtime, plan, packageRoot } = await prepareAdoption(root);
  const v05 = await seedV05Audit(commonDir);
  const runtimeBytes = await readFile(
    resolve(commonDir, "codex-flow", "v0.6.5", "contexts", `${runtime.runtime_id}.json`),
  );
  await rm(packageRoot, { recursive: true, force: true });

  const operationPaths = plan.operations.map((operation) => operation.path);
  assert.ok(operationPaths.includes(".codex/orchestration/v0.6/adoption.json"));
  assert.equal(operationPaths.includes(".codex/orchestration/v0.6/INSTRUCTIONS.md"), false);
  assert.ok(operationPaths.includes(".codex/orchestration/v0.6/runtime/bundle.json"));
  assert.ok(operationPaths.includes(".codex/orchestration/v0.6/runtime/files/bin/codex-flow.mjs"));
  const applied = await applyAdoptionPlan({ repositoryRoot: root, plan });
  assert.equal(applied.applied.length, plan.operations.length);
  const adoption = await readAdoption({ repositoryRoot: root });
  assert.deepEqual(adoption.adoption.bundle, runtime.bundle);
  assert.deepEqual(adoption.adoption.config, runtime.config);
  assert.deepEqual(adoption.adoption.policy, runtime.policy);
  assert.equal(adoption.adoption.schema_version, 2);
  assert.equal(Object.hasOwn(adoption.adoption, "reviewed_instructions"), false);
  assert.equal(stableAdoptionText(adoption.adoption).includes(root), false);
  assert.equal(stableAdoptionText(adoption.adoption).includes("host-adoption"), false);
  await assert.rejects(stat(adoptionInstructionsPath(root)), { code: "ENOENT" });
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual(
    await readFile(resolve(commonDir, "codex-flow", "v0.6.5", "contexts", `${runtime.runtime_id}.json`)),
    runtimeBytes,
  );

  const repeatPlan = await planAdoption({
    repositoryRoot: root,
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
    adoptedAt: "2026-08-29T14:02:00.000Z",
  });
  assert.deepEqual(repeatPlan.operations, []);
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual((await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: runtime.runtime_id,
  })).context, runtime);
  await writeFile(adoptionInstructionsPath(root), "unexpected tracked instructions\n", "utf8");
  await assert.rejects(
    readAdoption({ repositoryRoot: root }),
    /file inventory does not match/,
  );
});

function stableAdoptionText(value) {
  return JSON.stringify(value);
}

test("retirement requires a reviewed plan and deletes only v0.6 tracked adoption files", async (t) => {
  const root = await createGitFixture("codex-flow-v06-retirement-");
  t.after(() => removeFixture(root));
  const { commonDir, runtime, plan } = await prepareAdoption(root);
  const v05 = await seedV05Audit(commonDir);
  await applyAdoptionPlan({ repositoryRoot: root, plan });
  const runtimePath = resolve(commonDir, "codex-flow", "v0.6.5", "contexts", `${runtime.runtime_id}.json`);
  const runtimeBytes = await readFile(runtimePath);

  const retirement = await planAdoptionRetirement({
    repositoryRoot: root,
    retiredAt: "2026-08-29T14:03:00.000Z",
    reason: "The permanent adoption was deliberately retired.",
  });
  assert.deepEqual(
    retirement.operations.map((operation) => operation.action),
    Array(retirement.operations.length).fill("delete"),
  );
  const applied = await applyAdoptionRetirementPlan({ repositoryRoot: root, plan: retirement });
  assert.equal(applied.applied.length, retirement.operations.length);
  await assert.rejects(stat(adoptionManifestPath(root)), { code: "ENOENT" });
  await assert.rejects(stat(adoptionInstructionsPath(root)), { code: "ENOENT" });
  assert.deepEqual(await readFile(v05.path), v05.bytes);
  assert.deepEqual(await readFile(runtimePath), runtimeBytes);
});

test("tracked v0.5 authority blocks activation and adoption instead of migrating silently", async (t) => {
  const root = await createGitFixture("codex-flow-v06-legacy-gate-");
  t.after(() => removeFixture(root));
  const commonDir = resolve(root, ".git");
  const { bundleSource } = await runtimeBundleFor(root);
  const runtime = runtimeFor(root, bundleSource);
  const versionPath = resolve(root, ".codex", "orchestration", "version.json");
  await mkdir(resolve(versionPath, ".."), { recursive: true });
  await writeFile(versionPath, `${JSON.stringify({
    schema_version: 1,
    package_version: "0.5.1",
    files: {},
  })}\n`, "utf8");

  await assert.rejects(
    acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime, bundleSource }),
    /must be explicitly retired/,
  );
  await rm(versionPath);
  await acquireRuntimeContext({ gitCommonDirectory: commonDir, context: runtime, bundleSource });
  await writeFile(versionPath, `${JSON.stringify({
    schema_version: 1,
    package_version: "0.5.1",
    files: {},
  })}\n`, "utf8");
  await assert.rejects(
    planAdoption({
      repositoryRoot: root,
      gitCommonDirectory: commonDir,
      runtimeId: runtime.runtime_id,
      adoptedAt: "2026-08-29T16:01:00.000Z",
    }),
    /must be explicitly retired/,
  );
});

test("schema-v1 tracked adoption stays auditable and retireable without migration", async (t) => {
  const root = await createGitFixture("codex-flow-v06-legacy-adoption-");
  t.after(() => removeFixture(root));
  const { plan } = await prepareAdoption(root);
  await applyAdoptionPlan({ repositoryRoot: root, plan });

  const legacy = {
    ...plan.adoption,
    schema_version: 1,
    reviewed_instructions: {
      reviewed_by: "v0.6.1-release",
      reviewed_at: "2026-08-29T14:01:00.000Z",
      text: "Historical tracked instructions remain read-only until explicit retirement.",
    },
  };
  await writeFile(adoptionManifestPath(root), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  await writeFile(adoptionInstructionsPath(root), [
    "# Codex Flow v0.6 adoption instructions",
    "",
    "Reviewed by: v0.6.1-release",
    "Reviewed at: 2026-08-29T14:01:00.000Z",
    `Runtime bundle: ${legacy.bundle.bundle_sha256}`,
    `Configuration: ${legacy.config.config_id}`,
    `Policy: ${legacy.policy.policy_id}`,
    "",
    legacy.reviewed_instructions.text,
    "",
  ].join("\n"), "utf8");

  const status = await readAdoption({ repositoryRoot: root });
  assert.equal(status.adoption.schema_version, 1);
  const retirement = await planAdoptionRetirement({
    repositoryRoot: root,
    retiredAt: "2026-08-29T14:04:00.000Z",
    reason: "Explicitly retire the historical schema-v1 adoption.",
  });
  assert.ok(retirement.operations.some((operation) => (
    operation.path === ".codex/orchestration/v0.6/INSTRUCTIONS.md"
  )));
  await applyAdoptionRetirementPlan({ repositoryRoot: root, plan: retirement });
  await assert.rejects(stat(adoptionManifestPath(root)), { code: "ENOENT" });
  await assert.rejects(stat(adoptionInstructionsPath(root)), { code: "ENOENT" });
});
