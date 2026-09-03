import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  captureRefreshGitAuthority,
  deleteRefreshExecutorBranch,
  refreshGitPresence,
  removeRefreshExecutorWorktree,
} from "../lib/refresh-discard-git-v08.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function executorFixture(suffix) {
  const root = await createGitFixture(`codex-flow-refresh-discard-${suffix}-`);
  const worktreeParent = await mkdtemp(resolve(tmpdir(), `codex-flow-refresh-discard-${suffix}-`));
  const worktree = resolve(worktreeParent, "executor");
  const branch = `codex/refresh-discard-${suffix}`;
  await writeFile(resolve(root, ".gitignore"), "ignored-output/\n", "utf8");
  git(root, ["add", ".gitignore"]);
  git(root, ["commit", "--quiet", "-m", "ignore executor output"]);
  git(root, ["worktree", "add", "-q", "-b", branch, worktree, "HEAD"]);
  const commonDir = await realpath(resolve(root, ".git"));
  return {
    root,
    commonDir,
    worktree,
    branch,
    async dispose() {
      spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
      await Promise.all([
        removeFixture(root),
        rm(worktreeParent, { recursive: true, force: true }),
      ]);
    },
  };
}

async function capture(value, overrides = {}) {
  return captureRefreshGitAuthority({
    commonDir: value.commonDir,
    worktreePath: value.worktree,
    branch: value.branch,
    expectedHead: null,
    forbiddenRoots: [value.root],
    protectedBranches: ["main", "master"],
    ...overrides,
  });
}

test("refresh removes only an authenticated dirty, unmerged executor worktree before its local branch", async () => {
  const value = await executorFixture("dirty");
  try {
    await writeFile(resolve(value.worktree, "unmerged.txt"), "committed executor work\n", "utf8");
    git(value.worktree, ["add", "unmerged.txt"]);
    git(value.worktree, ["commit", "--quiet", "-m", "unmerged executor work"]);
    await writeFile(resolve(value.worktree, "untracked.txt"), "discardable\n", "utf8");
    await mkdir(resolve(value.worktree, "ignored-output"));
    await writeFile(resolve(value.worktree, "ignored-output", "artifact.bin"), "ignored\n", "utf8");
    const authority = await capture(value);
    assert.equal(authority.dirty, true);
    assert.equal(authority.branch, value.branch);
    assert.equal(authority.worktree_path, await realpath(value.worktree));
    assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", value.branch, "main"], {
      cwd: value.root,
    }).status, 1);

    const worktreeRemoval = await removeRefreshExecutorWorktree(authority);
    assert.equal(worktreeRemoval.worktree_present, false);
    assert.equal((await refreshGitPresence(authority)).worktree_present, false);
    assert.equal((await refreshGitPresence(authority)).branch_tip, authority.head);
    const branchRemoval = await deleteRefreshExecutorBranch(authority);
    assert.equal(branchRemoval.branch_tip, null);
    assert.equal((await refreshGitPresence(authority)).branch_tip, null);
  } finally {
    await value.dispose();
  }
});

test("refresh discard rejects retained external refs, protected paths, and detached attachment drift", async (t) => {
  await t.test("remote ref", async () => {
    const value = await executorFixture("remote");
    try {
      const tip = git(value.root, ["rev-parse", value.branch]);
      git(value.root, ["update-ref", `refs/remotes/origin/${value.branch}`, tip]);
      await assert.rejects(capture(value), /upstream, remote ref, or tag/);
    } finally {
      await value.dispose();
    }
  });

  await t.test("tag", async () => {
    const value = await executorFixture("tagged");
    try {
      git(value.root, ["tag", "refresh-retained-tag", value.branch]);
      await assert.rejects(capture(value), /upstream, remote ref, or tag/);
    } finally {
      await value.dispose();
    }
  });

  await t.test("protected target", async () => {
    const value = await executorFixture("protected");
    try {
      await assert.rejects(capture(value, { protectedBranches: [value.branch] }), /protected or source branch/);
      await assert.rejects(capture(value, { forbiddenRoots: [value.worktree] }), /coordinator or primary worktree/);
    } finally {
      await value.dispose();
    }
  });

  await t.test("detached worktree", async () => {
    const root = await createGitFixture("codex-flow-refresh-discard-detached-");
    const parent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-discard-detached-"));
    const worktree = resolve(parent, "executor");
    try {
      git(root, ["worktree", "add", "-q", "--detach", worktree, "HEAD"]);
      await assert.rejects(captureRefreshGitAuthority({
        commonDir: await realpath(resolve(root, ".git")),
        worktreePath: worktree,
        branch: "codex/refresh-detached",
        expectedHead: null,
        forbiddenRoots: [root],
        protectedBranches: ["main"],
      }), /bare, detached, locked, or prunable/);
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
      await Promise.all([removeFixture(root), rm(parent, { recursive: true, force: true })]);
    }
  });
});
