import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function runPinned(root, args, cwd = root) {
  return spawnSync(process.execPath, [
    resolve(root, ".codex", "orchestration", "bin", "codex-flow.mjs"),
    ...args,
  ], { cwd, encoding: "utf8" });
}

function receipt() {
  return {
    source_thread_id: "linked-coordinator",
    executor_id: "linked-executor",
    classification: "PASS",
    branch: "codex/linked-executor",
    commit: "0123456789abcdef",
    upstream: "origin/codex/linked-executor",
    cleanliness: "clean",
    result_or_blocker: "Linked worktree state is visible.",
    next_decision: "Consume once.",
    accounting: {
      PRODUCT: 0,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 1,
    },
  };
}

test("a pinned runtime cannot self-sync from a nested repository directory", async () => {
  const root = await createGitFixture();
  try {
    assertSuccess(runCli(["init"], { cwd: root }));
    const nested = resolve(root, "src", "nested");
    await mkdir(nested, { recursive: true });
    for (const command of [["init"], ["sync", "--force"]]) {
      const result = runPinned(root, command, nested);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /canonical codex-orchestration package/);
    }
  } finally {
    await removeFixture(root);
  }
});

test("doctor and cleanup support an unborn repository whose path contains spaces and percent characters", async () => {
  const root = await createGitFixture("codex flow % unborn-", { commit: false });
  try {
    assertSuccess(runCli(["init"], { cwd: root }), "unborn init");
    const doctor = runCli(["doctor", "--json"], { cwd: root });
    assertSuccess(doctor, "unborn doctor");
    assert.equal(JSON.parse(doctor.stdout).git.revision, "unborn");
    const audit = runCli(["cleanup", "audit", "--json"], { cwd: root });
    assertSuccess(audit, "spaced-path cleanup audit");
    assert.equal(JSON.parse(audit.stdout).mutation_performed, false);
  } finally {
    await removeFixture(root);
  }
});

test("managed and Git-common state writes reject symlinked repository paths", {
  skip: process.platform === "win32" ? "symlink creation is not reliably available on Windows CI" : false,
}, async () => {
  const managedRoot = await createGitFixture();
  const managedExternal = await mkdtemp(resolve(tmpdir(), "codex-flow-managed-external-"));
  const stateRoot = await createGitFixture();
  const stateExternal = await mkdtemp(resolve(tmpdir(), "codex-flow-state-external-"));
  try {
    await mkdir(resolve(managedRoot, ".codex"));
    await symlink(managedExternal, resolve(managedRoot, ".codex", "orchestration"), "dir");
    const managed = runCli(["init"], { cwd: managedRoot });
    assert.notEqual(managed.status, 0);
    assert.match(managed.stderr, /symbolic link|real directory/);
    assert.deepEqual(await readdir(managedExternal), []);

    await symlink(stateExternal, resolve(stateRoot, ".git", "codex-flow"), "dir");
    const state = runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-a", "--ttl-seconds", "60",
    ], { cwd: stateRoot });
    assert.notEqual(state.status, 0);
    assert.match(state.stderr, /symbolic link|real directory/);
    assert.deepEqual(await readdir(stateExternal), []);
  } finally {
    await Promise.all([
      removeFixture(managedRoot),
      removeFixture(stateRoot),
      rm(managedExternal, { recursive: true, force: true }),
      rm(stateExternal, { recursive: true, force: true }),
    ]);
  }
});

test("unsafe managed-manifest paths fail before any out-of-root read", async () => {
  const root = await createGitFixture();
  try {
    assertSuccess(runCli(["init"], { cwd: root }));
    const manifestPath = resolve(root, ".codex", "orchestration", "version.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["../outside"] = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const doctor = runCli(["doctor", "--json"], { cwd: root });
    assert.notEqual(doctor.status, 0);
    assert.match(JSON.parse(doctor.stdout).errors.join("\n"), /unsafe path/);
    const sync = runCli(["sync", "--force"], { cwd: root });
    assert.notEqual(sync.status, 0);
    assert.match(sync.stderr, /unsafe path/);
  } finally {
    await removeFixture(root);
  }
});

test("linked Git worktrees share callback and exclusive-resource state", async () => {
  const root = await createGitFixture("codex-flow-linked-main-");
  const linked = resolve(tmpdir(), `${basename(root)}-linked`);
  await rm(linked, { recursive: true, force: true });
  try {
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "linked-fixture", linked], { cwd: root });
    const acquired = runCli([
      "lease", "acquire", "--resource", "creator", "--owner", "executor-a", "--ttl-seconds", "60", "--json",
    ], { cwd: root });
    assertSuccess(acquired, "main-worktree lease acquire");
    const lease = JSON.parse(acquired.stdout).lease;
    const status = runCli(["lease", "status", "--resource", "creator", "--json"], { cwd: linked });
    assertSuccess(status, "linked-worktree lease status");
    assert.equal(JSON.parse(status.stdout)[0].owner, "executor-a");
    assert.equal(JSON.parse(status.stdout)[0].token, undefined);

    assertSuccess(runCli(["callback", "deliver", "--no-queue"], {
      cwd: root,
      input: receipt(),
    }), "main-worktree callback persist");
    const callbacks = runCli(["callback", "status", "--json"], { cwd: linked });
    assertSuccess(callbacks, "linked-worktree callback status");
    assert.equal(JSON.parse(callbacks.stdout).pending[0].executor_id, "linked-executor");

    assertSuccess(runCli([
      "lease", "release", "--resource", "creator", "--owner", "executor-a", "--token", lease.token,
    ], { cwd: linked }), "linked-worktree lease release");
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", linked], { cwd: root });
    } catch {}
    await Promise.all([removeFixture(root), rm(linked, { recursive: true, force: true })]);
  }
});
