import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const packageRoot = resolve(import.meta.dirname, "..");
export const cli = resolve(packageRoot, "bin", "codex-flow.mjs");

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

export function assertSuccess(result, label = "command") {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

export function initializeFixture(args = [], { cwd, env = {} } = {}) {
  const planned = runCli(["init", "--plan", "--json", ...args], { cwd, env });
  assertSuccess(planned, "initialization plan");
  const plan = JSON.parse(planned.stdout);
  const applied = runCli(["init", "--apply-plan", plan.plan_id, "--json", ...args], { cwd, env });
  assertSuccess(applied, "initialization apply");
  return { plan, applied, result: JSON.parse(applied.stdout) };
}

export async function removeFixture(root) {
  await rm(root, { recursive: true, force: true });
}
