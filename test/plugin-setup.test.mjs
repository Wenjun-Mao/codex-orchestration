import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  packageRoot,
  removeFixture,
} from "./helpers.mjs";
import { PACKAGE_VERSION } from "../lib/core.mjs";

async function createCachedPlugin() {
  const cacheRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-plugin-cache-"));
  const packageMetadata = JSON.parse(
    await readFile(resolve(packageRoot, "package.json"), "utf8"),
  );
  await cp(resolve(packageRoot, "package.json"), resolve(cacheRoot, "package.json"));
  for (const entry of packageMetadata.files) {
    const source = resolve(packageRoot, entry);
    const destination = resolve(cacheRoot, basename(entry));
    await cp(source, destination, { recursive: true });
  }
  return cacheRoot;
}

function runCachedCli(cacheRoot, args, cwd) {
  return spawnSync(
    process.execPath,
    [resolve(cacheRoot, "bin", "codex-flow.mjs"), ...args],
    { cwd, encoding: "utf8" },
  );
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function snapshotFiles(root) {
  const snapshot = {};
  async function visit(directory, prefix = "") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) {
        snapshot[relativePath] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("cached plugin initializes a Python repository without a source checkout", async () => {
  const cacheRoot = await createCachedPlugin();
  const repositoryRoot = await createGitFixture("codex-flow-cached-python-");
  try {
    const resolvedPluginRoot = spawnSync(
      process.execPath,
      [resolve(cacheRoot, "skills/setup/scripts/resolve-plugin-root.mjs")],
      { encoding: "utf8" },
    );
    assertSuccess(resolvedPluginRoot, "cached setup root resolver");
    assert.equal(resolvedPluginRoot.stdout.trim(), await realpath(cacheRoot));

    const agentsPath = resolve(repositoryRoot, "AGENTS.md");
    const pythonPath = resolve(repositoryRoot, "pyproject.toml");
    const originalAgents = "# Python Project\n\nUse uv, ruff, and pytest.\n";
    const originalPython = "[project]\nname = \"held-out\"\nversion = \"0.0.0\"\n";
    await writeFile(agentsPath, originalAgents, "utf8");
    await writeFile(pythonPath, originalPython, "utf8");

    const planResult = runCachedCli(cacheRoot, ["init", "--plan", "--json"], repositoryRoot);
    assertSuccess(planResult, "cached plugin plan");
    const plan = JSON.parse(planResult.stdout);
    assert.equal(plan.applicable, true);
    assert.equal(await pathExists(resolve(repositoryRoot, ".codex/orchestration/version.json")), false);
    assert.equal(await readFile(agentsPath, "utf8"), originalAgents);
    assert.equal(await readFile(pythonPath, "utf8"), originalPython);

    const apply = runCachedCli(
      cacheRoot,
      ["init", "--apply-plan", plan.plan_id, "--json"],
      repositoryRoot,
    );
    assertSuccess(apply, "cached plugin apply");
    const installedAgents = await readFile(agentsPath, "utf8");
    assert.ok(installedAgents.startsWith(originalAgents.trimEnd()));
    assert.equal((installedAgents.match(/codex-flow:start/g) ?? []).length, 1);
    assert.equal(await readFile(pythonPath, "utf8"), originalPython);

    const manifest = JSON.parse(
      await readFile(resolve(repositoryRoot, ".codex/orchestration/version.json"), "utf8"),
    );
    assert.equal(manifest.package_version, PACKAGE_VERSION);
    assertSuccess(
      runCachedCli(cacheRoot, ["init", "--check"], repositoryRoot),
      "cached plugin check",
    );
    const pinnedDoctor = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, ".codex/orchestration/bin/codex-flow.mjs"), "doctor", "--json"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assertSuccess(pinnedDoctor, "pinned doctor");
    assert.equal(JSON.parse(pinnedDoctor.stdout).runtime.package_version, PACKAGE_VERSION);
  } finally {
    await removeFixture(repositoryRoot);
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

for (const mismatch of ["package", "plugin", "runtime"]) {
  test(`cached ${mismatch} version mismatch fails before planning`, async () => {
    const cacheRoot = await createCachedPlugin();
    const repositoryRoot = await createGitFixture(`codex-flow-${mismatch}-mismatch-`);
    try {
      if (mismatch === "package") {
        const path = resolve(cacheRoot, "package.json");
        const metadata = JSON.parse(await readFile(path, "utf8"));
        metadata.version = "9.9.9";
        await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      } else if (mismatch === "plugin") {
        const path = resolve(cacheRoot, ".codex-plugin/plugin.json");
        const metadata = JSON.parse(await readFile(path, "utf8"));
        metadata.version = "9.9.9";
        await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      } else {
        const path = resolve(cacheRoot, "lib/core.mjs");
        const source = await readFile(path, "utf8");
        await writeFile(path, source.replace(`"${PACKAGE_VERSION}"`, '"9.9.9"'), "utf8");
      }

      const result = runCachedCli(cacheRoot, ["init", "--plan", "--json"], repositoryRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /metadata must exactly match version/);
      assert.equal(await pathExists(resolve(repositoryRoot, ".codex/orchestration/version.json")), false);
    } finally {
      await removeFixture(repositoryRoot);
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
}

test("an installed v0.5.1 runtime requires explicit retirement without mutation", async () => {
  const cacheRoot = await createCachedPlugin();
  const repositoryRoot = await createGitFixture("codex-flow-breaking-reinstall-");
  try {
    const firstPlanResult = runCachedCli(cacheRoot, ["init", "--plan", "--json"], repositoryRoot);
    assertSuccess(firstPlanResult, "initial plan");
    const firstPlan = JSON.parse(firstPlanResult.stdout);
    assertSuccess(
      runCachedCli(
        cacheRoot,
        ["init", "--apply-plan", firstPlan.plan_id, "--json"],
        repositoryRoot,
      ),
      "initial apply",
    );

    const manifestPath = resolve(repositoryRoot, ".codex/orchestration/version.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.package_version = "0.5.1";
    const retainedBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, retainedBytes, "utf8");
    const runtimeRoot = resolve(repositoryRoot, ".codex", "orchestration");
    await writeFile(resolve(runtimeRoot, "v0.5.1-runtime-fixture.txt"), "accepted v0.5.1 runtime bytes\n", "utf8");
    const retainedRuntime = await snapshotFiles(runtimeRoot);
    const v051StateRoot = resolve(repositoryRoot, ".git", "codex-flow", "v0.5.1");
    await mkdir(resolve(v051StateRoot, "callbacks"), { recursive: true });
    await writeFile(
      resolve(v051StateRoot, "callbacks", "retained-v0.5.1.json"),
      "{\"schema_version\":2,\"retained\":true}\n",
      "utf8",
    );
    const retainedState = await snapshotFiles(v051StateRoot);

    const planResult = runCachedCli(cacheRoot, ["init", "--plan", "--json"], repositoryRoot);
    assert.notEqual(planResult.status, 0);
    const plan = JSON.parse(planResult.stdout || planResult.stderr);
    assert.equal(plan.applicable, false);
    assert.ok(plan.conflicts.some((item) => item.code === "installed-package-version"));
    assert.deepEqual(await snapshotFiles(runtimeRoot), retainedRuntime);
    assert.deepEqual(await snapshotFiles(v051StateRoot), retainedState);
    for (const bypassArgs of [
      ["--force"],
      [
        "--agents-mode",
        "external",
        "--external-agents-path",
        "AGENTS.md",
        "--attest-external-agents",
      ],
    ]) {
      const bypass = runCachedCli(
        cacheRoot,
        ["init", "--plan", "--json", ...bypassArgs],
        repositoryRoot,
      );
      assert.notEqual(bypass.status, 0);
      const bypassPlan = JSON.parse(bypass.stdout);
      assert.ok(bypassPlan.conflicts.some(
        (item) => item.code === "installed-package-version",
      ));
      assert.deepEqual(await snapshotFiles(runtimeRoot), retainedRuntime);
      assert.deepEqual(await snapshotFiles(v051StateRoot), retainedState);
    }
    const stateRoot = resolve(repositoryRoot, ".git", "codex-flow", `v${PACKAGE_VERSION}`);
    const stateBefore = await snapshotFiles(stateRoot);

    for (const args of [
      ["config", "show", "--json"],
      ["task", "start", "--role", "coordinator"],
      ["recipient", "status", "--json"],
      ["callback", "status", "--json"],
      ["urgent", "status", "--json"],
      ["lease", "status", "--json"],
      ["git", "status", "--json"],
      ["cleanup", "audit", "--json"],
    ]) {
      const result = runCachedCli(cacheRoot, args, repositoryRoot);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.match(result.stderr, /explicit retirement/, args.join(" "));
    }
    const doctor = runCachedCli(cacheRoot, ["doctor", "--json"], repositoryRoot);
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /explicit retirement/);
    assert.deepEqual(await snapshotFiles(stateRoot), stateBefore);

    const apply = runCachedCli(
      cacheRoot,
      ["init", "--apply-plan", plan.plan_id, "--json"],
      repositoryRoot,
    );
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /unresolved conflict/);
    assert.deepEqual(await snapshotFiles(runtimeRoot), retainedRuntime);
    assert.deepEqual(await snapshotFiles(v051StateRoot), retainedState);
  } finally {
    await removeFixture(repositoryRoot);
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
