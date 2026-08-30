import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/core.mjs";
import { assertNoTrackedLegacyAuthority } from "../lib/runtime-context.mjs";
import { assertSuccess, createGitFixture, removeFixture, runCli } from "./helpers.mjs";

const PLANNED_AT = "2026-08-29T21:00:00-04:00";

async function write(root, path, contents) {
  const absolute = resolve(root, path);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, contents, "utf8");
}

async function installAcceptedAuthority(root) {
  const runtime = "export const accepted = 'v0.5.1';\n";
  await write(root, ".codex/orchestration/lib/runtime.mjs", runtime);
  await write(root, ".codex/orchestration/project.json", `${JSON.stringify({
    schema_version: 4,
    project_id: "legacy-cli-fixture",
    max_parallel_executors: 2,
    default_model: "gpt-5.6-terra",
    default_reasoning_effort: "xhigh",
    agents_integration: { mode: "managed" },
    git_lifecycle: { protected_branches: ["main"], warn_at: 5, block_at: 10 },
  }, null, 2)}\n`);
  await write(root, ".codex/orchestration/version.json", `${JSON.stringify({
    schema_version: 1,
    package_version: "0.5.1",
    files: { "lib/runtime.mjs": sha256(runtime) },
  }, null, 2)}\n`);
  await write(
    root,
    "AGENTS.md",
    "Repository instructions.\n\n<!-- codex-flow:start v0.5.1 -->\nAccepted legacy authority.\n<!-- codex-flow:end -->\n",
  );
  await write(root, ".git/codex-flow/v0.5.1/audit/evidence.json", "{\"retained\":true}\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "accepted v0.5.1 authority"], { cwd: root });
}

async function requestFile(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

test("repository-scoped CLI plans and applies exact v0.5.1 retirement without an active run", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-transition-cli-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-legacy-transition-requests-"));
  t.after(async () => Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]));
  await installAcceptedAuthority(root);

  const planRequest = await requestFile(requests, "plan", {
    reason: "Retire the exact accepted predecessor after explicit review.",
    planned_at: PLANNED_AT,
  });
  const planned = runCli(["adopt", "legacy-retire-plan", "--file", planRequest, "--json"], { cwd: root });
  assertSuccess(planned, "legacy retirement plan");
  const plan = JSON.parse(planned.stdout).result;
  assert.equal(plan.applicable, true);
  assert.equal(plan.reason, "Retire the exact accepted predecessor after explicit review.");
  assert.equal(plan.planned_at, PLANNED_AT);

  const applyRequest = await requestFile(requests, "apply", { plan });
  const applied = runCli(["adopt", "legacy-retire-apply", "--file", applyRequest, "--json"], { cwd: root });
  assertSuccess(applied, "legacy retirement apply");
  assert.equal(JSON.parse(applied.stdout).result.status, "applied");
  await assertNoTrackedLegacyAuthority(root);
  assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), "Repository instructions.\n");
  assert.equal(await readFile(resolve(root, ".git/codex-flow/v0.5.1/audit/evidence.json"), "utf8"), "{\"retained\":true}\n");

  const replay = runCli(["adopt", "legacy-retire-apply", "--file", applyRequest, "--json"], { cwd: root });
  assertSuccess(replay, "legacy retirement replay");
  assert.equal(JSON.parse(replay.stdout).result.status, "already-applied");
});

test("legacy retirement commands reject run binding and blocked plans fail closed", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-transition-blocked-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-legacy-transition-blocked-requests-"));
  t.after(async () => Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]));
  await installAcceptedAuthority(root);
  await write(root, ".git/codex-flow/v0.5.1/leases/pending.json", `${JSON.stringify({
    kind: "codex-flow-lease",
    resource: "shared-release",
    expires_at: "2999-01-01T00:00:00.000Z",
  })}\n`);

  const planRequest = await requestFile(requests, "plan", {
    reason: "This request must remain blocked by live predecessor state.",
    planned_at: PLANNED_AT,
  });
  const bound = runCli([
    "adopt", "legacy-retire-plan", "--run-id", "run-not-allowed", "--file", planRequest, "--json",
  ], { cwd: root });
  assert.notEqual(bound.status, 0);
  assert.match(bound.stderr, /does not accept --run-id/);

  const planned = runCli(["adopt", "legacy-retire-plan", "--file", planRequest, "--json"], { cwd: root });
  assertSuccess(planned, "blocked legacy retirement plan");
  const plan = JSON.parse(planned.stdout).result;
  assert.equal(plan.applicable, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "active-lease"));
  const applyRequest = await requestFile(requests, "apply", { plan });
  const applied = runCli(["adopt", "legacy-retire-apply", "--file", applyRequest, "--json"], { cwd: root });
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /blocked/);
});
