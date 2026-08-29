import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gitSnapshot } from "../lib/git.mjs";
import { admitRun, emptyFencePlan } from "../lib/run-lifecycle.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  runtimeBindingFromContext,
  runtimeContextHash,
} from "../lib/runtime-context.mjs";
import { coordinatorBindingDigest } from "../lib/workflow-plan.mjs";

export const packageRoot = resolve(import.meta.dirname, "..");
export const cli = resolve(packageRoot, "bin", "codex-flow.mjs");

export async function activateV06FixtureRun({
  root,
  runId,
  plan,
  lineage,
  now = Date.parse("2026-08-29T00:00:00.000Z"),
}) {
  const snapshot = gitSnapshot(root);
  const bundleSource = await loadRuntimeBundleSource({ packageRoot });
  const runtime = buildRuntimeContext({
    bundle: bundleSource.bundle,
    createdAt: new Date(now).toISOString(),
    config: { config_id: "fixture-config", snapshot: {} },
    policy: { policy_id: "fixture-policy", snapshot: {} },
    repository: {
      common_dir: snapshot.commonDir,
      root: snapshot.root,
      branch: snapshot.branch,
      revision: snapshot.revision,
    },
    host: { host_id: "fixture-host", session_id: "fixture-session" },
    lineage,
  });
  await acquireRuntimeContext({
    gitCommonDirectory: snapshot.commonDir,
    context: runtime,
    bundleSource,
  });
  const admitted = await admitRun({
    gitCommonDirectory: snapshot.commonDir,
    runId,
    runtimeId: runtime.runtime_id,
    workflowPlanId: plan.plan_id,
    workflowRevisionDigest: plan.revision_digest,
    plan: emptyFencePlan(),
    admittedAt: new Date(now).toISOString(),
  });
  const binding = runtimeBindingFromContext(runtime);
  const coordinator = {
    lineage_id: admitted.run.binding.lineage.lineage_id,
    thread_id: admitted.run.binding.lineage.thread_id,
    generation: admitted.run.binding.lineage.generation,
  };
  return {
    runtime,
    run: admitted.run,
    authority: {
      run_id: runId,
      runtime_context_digest: runtimeContextHash(runtime),
      configuration_digest: binding.config_hash,
      repository_id: binding.repository_hash,
      common_dir: snapshot.commonDir,
      coordinator_binding: {
        ...coordinator,
        binding_digest: coordinatorBindingDigest(coordinator),
      },
    },
  };
}

export async function createGitFixture(prefix = "codex-flow-test-", { commit = true } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  if (commit) {
    await writeFile(resolve(root, ".gitkeep"), "fixture\n", "utf8");
    execFileSync("git", ["add", ".gitkeep"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  }
  return root;
}

export function runCli(args, { cwd, env = {}, input } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    input: input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
}

export function runLegacyCli(args, options = {}) {
  return runCli(["legacy-v05", ...args], options);
}

export function assertSuccess(result, label = "command") {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

export function initializeFixture(args = [], { cwd, env = {} } = {}) {
  const planned = runLegacyCli(["init", "--plan", "--json", ...args], { cwd, env });
  assertSuccess(planned, "initialization plan");
  const plan = JSON.parse(planned.stdout);
  const applied = runLegacyCli(["init", "--apply-plan", plan.plan_id, "--json", ...args], { cwd, env });
  assertSuccess(applied, "initialization apply");
  return { plan, applied, result: JSON.parse(applied.stdout) };
}

export async function removeFixture(root) {
  await rm(root, { recursive: true, force: true });
}
