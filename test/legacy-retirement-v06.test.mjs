import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  applyLegacyRetirementPlan,
  planLegacyRetirement,
  validateLegacyRetirementPlan,
} from "../lib/legacy-retirement-v06.mjs";
import { sha256 } from "../lib/core.mjs";
import { assertNoTrackedLegacyAuthority } from "../lib/runtime-context.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const REVIEW = {
  reason: "The accepted v0.5.1 authority has been settled and is ready for retirement.",
  plannedAt: "2026-08-29T20:00:00-04:00",
};

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fileSnapshot(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result[path.slice(root.length + 1)] = (await readFile(path)).toString("base64");
    }
  }
  try { await visit(root); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return result;
}

async function write(root, relativePath, contents) {
  const path = resolve(root, relativePath);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

async function authority(root, { agents = "managed" } = {}) {
  const runtime = "export const legacy = true;\n";
  await write(root, ".codex/orchestration/lib/runtime.mjs", runtime);
  const config = {
    schema_version: 4,
    project_id: "legacy-fixture",
    max_parallel_executors: 2,
    default_model: "gpt-5.6-terra",
    default_reasoning_effort: "xhigh",
    agents_integration: agents === "managed"
      ? { mode: "managed" }
      : { mode: "external", path: "instructions/external.md", sha256: sha256("External instructions.\n"), contract_version: "1", attested: true },
    git_lifecycle: { protected_branches: ["main"], warn_at: 5, block_at: 10 },
  };
  await write(root, ".codex/orchestration/project.json", `${JSON.stringify(config, null, 2)}\n`);
  await write(root, ".codex/orchestration/version.json", `${JSON.stringify({
    schema_version: 1,
    package_version: "0.5.1",
    files: { "lib/runtime.mjs": sha256(runtime) },
  }, null, 2)}\n`);
  if (agents === "managed") {
    await write(root, "AGENTS.md", "Before instructions.\n\n<!-- codex-flow:start v0.5.1 -->\nManaged v0.5.1 instructions.\n<!-- codex-flow:end -->\n\nAfter instructions.\n");
  } else {
    await write(root, "instructions/external.md", "External instructions.\n");
  }
  await write(root, "unrelated.txt", "keep this byte-for-byte\n");
  await write(root, ".git/codex-flow/v0.5.1/audit/evidence.json", "{\"retained\":true}\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "seed legacy authority"]);
}

test("v0.5.1 retirement plans exact owned files, retains Git-common evidence, and replays safely", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-retirement-");
  t.after(() => removeFixture(root));
  await authority(root);
  const stateRoot = resolve(root, ".git/codex-flow/v0.5.1");
  const stateBefore = await fileSnapshot(stateRoot);
  const plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });

  assert.equal(plan.applicable, true);
  assert.equal(plan.reason, REVIEW.reason);
  assert.equal(plan.planned_at, REVIEW.plannedAt);
  assert.equal(plan.repository.cleanliness, "clean");
  assert.equal(plan.authority.manifest.package_version, "0.5.1");
  assert.deepEqual(plan.operations.map((item) => item.path), [
    ".codex/orchestration/lib/runtime.mjs",
    ".codex/orchestration/project.json",
    ".codex/orchestration/version.json",
    "AGENTS.md",
  ]);
  assert.equal(plan.authority.agents.mode, "managed");
  assert.ok(plan.authority.agents.managed_block_sha256);
  assert.equal(plan.retained_authority.git_common_evidence.raw_tree_sha256, plan.git_common_evidence.raw_tree_sha256);
  assert.equal(validateLegacyRetirementPlan(plan).plan_id, plan.plan_id);

  const result = await applyLegacyRetirementPlan({ repositoryRoot: root, plan });
  assert.equal(result.status, "applied");
  assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), "Before instructions.\n\nAfter instructions.\n");
  await assert.rejects(readFile(resolve(root, ".codex/orchestration/version.json")), { code: "ENOENT" });
  assert.equal(await readFile(resolve(root, "unrelated.txt"), "utf8"), "keep this byte-for-byte\n");
  assert.deepEqual(await fileSnapshot(stateRoot), stateBefore);
  await assertNoTrackedLegacyAuthority(root);
  assert.deepEqual(await applyLegacyRetirementPlan({ repositoryRoot: root, plan }), {
    plan_id: plan.plan_id, status: "already-applied", applied: [],
  });
});

test("retirement leaves a managed AGENTS.md empty when its exact block is its only content", async (t) => {
  const root = await createGitFixture("codex-flow-empty-agents-");
  t.after(() => removeFixture(root));
  await authority(root);
  await write(root, "AGENTS.md", "<!-- codex-flow:start v0.5.1 -->\nOnly managed content.\n<!-- codex-flow:end -->\n");
  git(root, ["add", "AGENTS.md"]); git(root, ["commit", "--quiet", "-m", "only managed AGENTS"]);
  const plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  await applyLegacyRetirementPlan({ repositoryRoot: root, plan });
  assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), "");
});

test("external AGENTS files are attested but never retirement operations", async (t) => {
  const root = await createGitFixture("codex-flow-external-agents-");
  t.after(() => removeFixture(root));
  await authority(root, { agents: "external" });
  const plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  assert.equal(plan.applicable, true);
  assert.equal(plan.authority.agents.mode, "external");
  assert.equal(plan.operations.some((item) => item.path === "instructions/external.md"), false);
  await applyLegacyRetirementPlan({ repositoryRoot: root, plan });
  assert.equal(await readFile(resolve(root, "instructions/external.md"), "utf8"), "External instructions.\n");
});

test("drift, unowned files, malformed markers, symlinks, dirty Git, and pending signals block without mutation", async (t) => {
  const root = await createGitFixture("codex-flow-retirement-blockers-");
  t.after(() => removeFixture(root));
  await authority(root);
  const runtimePath = resolve(root, ".codex/orchestration/lib/runtime.mjs");
  const before = await readFile(runtimePath, "utf8");
  await writeFile(runtimePath, "tampered\n", "utf8");
  await assert.rejects(planLegacyRetirement({ repositoryRoot: root, plannedAt: REVIEW.plannedAt }), /reason/);
  await assert.rejects(planLegacyRetirement({ repositoryRoot: root, reason: REVIEW.reason, plannedAt: "not-a-date" }), /plannedAt/);
  let plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  assert.equal(plan.applicable, false);
  assert.ok(plan.blockers.some((item) => item.code === "dirty-git-worktree"));
  assert.ok(plan.blockers.some((item) => item.code === "managed-runtime-drift"));
  await assert.rejects(applyLegacyRetirementPlan({ repositoryRoot: root, plan }), /blocked/);
  assert.equal(await readFile(runtimePath, "utf8"), "tampered\n");
  await writeFile(runtimePath, before, "utf8");
  git(root, ["checkout", "--", "."]);

  await write(root, ".codex/orchestration/unowned.txt", "not owned\n");
  plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  assert.ok(plan.blockers.some((item) => item.code === "unowned-runtime-file"));
  await rm(resolve(root, ".codex/orchestration/unowned.txt"));
  await write(root, "AGENTS.md", "<!-- codex-flow:start v0.5.1 -->\nmissing end\n");
  plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  assert.ok(plan.blockers.some((item) => item.code === "invalid-managed-agents"));
  git(root, ["checkout", "--", "AGENTS.md"]);

  await symlink("runtime.mjs", resolve(root, ".codex/orchestration/lib/link.mjs"));
  plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  assert.ok(plan.blockers.some((item) => item.code === "runtime-symlink"));
});

test("apply restores every owned byte when an in-process failure interrupts retirement", async (t) => {
  const root = await createGitFixture("codex-flow-retirement-rollback-");
  t.after(() => removeFixture(root));
  await authority(root);
  const before = await fileSnapshot(resolve(root, ".codex/orchestration"));
  const agentsBefore = await readFile(resolve(root, "AGENTS.md"), "utf8");
  const plan = await planLegacyRetirement({ repositoryRoot: root, ...REVIEW });
  await assert.rejects(applyLegacyRetirementPlan({
    repositoryRoot: root,
    plan,
    hooks: { afterDirectory: () => { throw new Error("simulated interruption"); } },
  }), /simulated interruption/);
  assert.deepEqual(await fileSnapshot(resolve(root, ".codex/orchestration")), before);
  assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), agentsBefore);
  assert.deepEqual((await (await import("node:fs/promises")).readdir(resolve(root, ".codex/orchestration"))).sort(), ["lib", "project.json", "version.json"]);
});
