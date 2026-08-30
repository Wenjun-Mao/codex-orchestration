import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertNoUnplugInProgressV07,
  unplugApplyV07,
  unplugPlanV07,
  validateUnplugPlanV07,
} from "../lib/unplug-v07.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).trim();
}

function gitStatus(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).status;
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

async function namespace(common, name = "v0.7.0", activeRunId = null) {
  const root = resolve(common, "codex-flow", name);
  await mkdir(resolve(root, "runs"), { recursive: true });
  await writeFile(
    resolve(root, "runs", "lifecycle.json"),
    `${JSON.stringify({ active_run_id: activeRunId, runs: {} })}\n`,
  );
  return root;
}

async function worktreeFixture(prefix, { commitOnBranch = false, detached = false } = {}) {
  const root = await createGitFixture(prefix);
  const parent = await mkdtemp(resolve(tmpdir(), `${prefix}wt-`));
  const worktree = resolve(parent, "executor");
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const localBranch = detached
    ? null
    : `codex/${prefix.replace(/[^a-z0-9-]/gi, "").toLowerCase()}`;
  const addArgs = detached
    ? ["worktree", "add", "-q", "--detach", worktree, "HEAD"]
    : ["worktree", "add", "-q", "-b", localBranch, worktree, "HEAD"];
  git(root, addArgs);
  if (commitOnBranch) {
    await writeFile(resolve(worktree, "executor.txt"), "executor\n");
    git(worktree, ["add", "executor.txt"]);
    git(worktree, ["commit", "--quiet", "-m", "executor"]);
  }
  const tip = git(worktree, ["rev-parse", "HEAD"]);
  return { root, parent, worktree, common, branch: localBranch, localBranch, tip };
}

function resources(fixture, { includeTask = false } = {}) {
  const result = [
    {
      kind: "worktree",
      id: "executor-worktree",
      provenance: "state-derived",
      path: fixture.worktree,
      branch: fixture.branch,
      expected_tip: fixture.tip,
      common_dir: fixture.common,
      protected: false,
      thread_id: null,
    },
  ];
  if (fixture.localBranch !== null) {
    result.push({
      kind: "branch",
      id: "executor-branch",
      provenance: "state-derived",
      path: null,
      branch: fixture.localBranch,
      expected_tip: fixture.tip,
      common_dir: fixture.common,
      protected: false,
      thread_id: null,
    });
  }
  if (includeTask) {
    result.push({
      kind: "task",
      id: "executor-task",
      provenance: "state-derived",
      path: null,
      branch: null,
      expected_tip: null,
      common_dir: fixture.common,
      protected: false,
      thread_id: "01a-test-visible-task",
    });
  }
  return result;
}

async function cleanupFixture(fixture) {
  if (await pathExists(fixture.worktree)) {
    spawnSync("git", ["worktree", "remove", "--force", fixture.worktree], { cwd: fixture.root });
  }
  await removeFixture(fixture.root);
  await removeFixture(fixture.parent);
}

function legacyPlanWithNamespaces(plan, namespaces) {
  const draft = {
    schema_version: 1,
    kind: "codex-flow-v07-unplug-plan",
    plan_id: "",
    repository: plan.repository,
    namespaces,
    resources: plan.resources,
    active_runs: plan.active_runs,
    state_digest: sha256(stableStringify(namespaces)),
    git_digest: plan.git_digest,
    mutation_performed: false,
  };
  const { plan_id: ignored, ...seed } = draft;
  draft.plan_id = `unplug-plan-v1-${sha256(stableStringify(seed))}`;
  return validateUnplugPlanV07(draft);
}

function legacyPlanFromV2(plan) {
  const namespaces = plan.state_entries.map((entry) => {
    assert.equal(entry.kind, "namespace-directory");
    return { name: entry.name, path: entry.path, digest: entry.digest };
  });
  return legacyPlanWithNamespaces(plan, namespaces);
}

test("unplug v2 authenticates mixed namespace directories and opaque root files", async () => {
  const root = await createGitFixture("codex-flow-unplug-opaque-mixed-");
  try {
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    await namespace(common, "v0.4");
    await namespace(common, "v0.6.0");
    const stateRoot = resolve(common, "codex-flow");
    await writeFile(resolve(stateRoot, "ade-plan.json"), "{not-json-on-purpose\n");
    await writeFile(resolve(stateRoot, "restyle-evidence.json"), "{\"retained\":true}\n");

    const first = await unplugPlanV07({ repositoryPath: root, resources: [] });
    const second = await unplugPlanV07({ repositoryPath: root, resources: [] });
    assert.deepEqual(first, second);
    assert.equal(first.schema_version, 2);
    assert.equal(first.kind, "codex-flow-v07-unplug-plan-v2");
    assert.match(first.plan_id, /^unplug-plan-v2-[0-9a-f]{64}$/);
    assert.deepEqual(first.state_entries.map((entry) => [entry.name, entry.kind]), [
      ["ade-plan.json", "opaque-file"],
      ["restyle-evidence.json", "opaque-file"],
      ["v0.4", "namespace-directory"],
      ["v0.6.0", "namespace-directory"],
    ]);
    assert.equal(first.active_runs.length, 0);
    assert.deepEqual(validateUnplugPlanV07(first), first);

    const receipt = await unplugApplyV07({ repositoryPath: root, plan: first });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(stateRoot), false);
  } finally {
    await removeFixture(root);
  }
});

test("host-managed Codex turn-diff refs do not invalidate an exact unplug plan", async () => {
  const root = await createGitFixture("codex-flow-unplug-turn-diff-ref-");
  try {
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = await namespace(common);
    const plan = await unplugPlanV07({ repositoryPath: root, resources: [] });

    git(root, [
      "update-ref",
      "refs/codex/turn-diffs/captures/1788124442550/task/base",
      "HEAD",
    ]);

    const refreshed = await unplugPlanV07({ repositoryPath: root, resources: [] });
    assert.equal(refreshed.plan_id, plan.plan_id);
    assert.equal(refreshed.git_digest, plan.git_digest);

    const receipt = await unplugApplyV07({ repositoryPath: root, plan });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(stateRoot), false);
  } finally {
    await removeFixture(root);
  }
});

test("ordinary and turn-diff-lookalike refs still invalidate an exact unplug plan", async () => {
  const authoritativeRefs = [
    "refs/heads/unrelated-source",
    "refs/heads/codex/unrelated-cleanup",
    "refs/remotes/origin/unrelated-source",
    "refs/tags/unrelated-release",
    "refs/codex/turn-diffs-like/captures/task/base",
    "refs/codex/Turn-Diffs/captures/task/base",
  ];

  for (const ref of authoritativeRefs) {
    const root = await createGitFixture("codex-flow-unplug-authoritative-ref-");
    try {
      const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const stateRoot = await namespace(common);
      const plan = await unplugPlanV07({ repositoryPath: root, resources: [] });
      git(root, ["update-ref", ref, "HEAD"]);

      await assert.rejects(
        () => unplugApplyV07({ repositoryPath: root, plan }),
        /plan drifted/,
      );
      assert.equal(await pathExists(stateRoot), true);
      assert.equal(await pathExists(resolve(common, "codex-flow-unplug-v07")), false);
    } finally {
      await removeFixture(root);
    }
  }
});

test("opaque state content and type drift block before deletion", async () => {
  const contentRoot = await createGitFixture("codex-flow-unplug-opaque-drift-");
  try {
    const common = git(contentRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const retained = await namespace(common);
    const opaque = resolve(common, "codex-flow", "retained.json");
    await writeFile(opaque, "one\n");
    const plan = await unplugPlanV07({ repositoryPath: contentRoot, resources: [] });
    await writeFile(opaque, "two\n");
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: contentRoot, plan }),
      /plan drifted|state drifted/,
    );
    assert.equal(await pathExists(opaque), true);
    assert.equal(await pathExists(retained), true);
  } finally {
    await removeFixture(contentRoot);
  }

  const typeRoot = await createGitFixture("codex-flow-unplug-opaque-type-");
  try {
    const common = git(typeRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    await namespace(common);
    const opaque = resolve(common, "codex-flow", "retained.json");
    await writeFile(opaque, "retained\n");
    const plan = await unplugPlanV07({ repositoryPath: typeRoot, resources: [] });
    await rm(opaque);
    await mkdir(opaque);
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: typeRoot, plan }),
      /plan drifted|state drifted/,
    );
    assert.equal((await lstat(opaque)).isDirectory(), true);
  } finally {
    await removeFixture(typeRoot);
  }

  const directoryTypeRoot = await createGitFixture("codex-flow-unplug-directory-type-");
  try {
    const common = git(directoryTypeRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const retained = await namespace(common, "v0.6.0");
    const plan = await unplugPlanV07({ repositoryPath: directoryTypeRoot, resources: [] });
    await rm(retained, { recursive: true });
    await writeFile(retained, "replacement\n");
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: directoryTypeRoot, plan }),
      /plan drifted|state drifted/,
    );
    assert.equal((await lstat(retained)).isFile(), true);
  } finally {
    await removeFixture(directoryTypeRoot);
  }
});

test("opaque content changed inside the state-removal phase is reauthenticated", async () => {
  const root = await createGitFixture("codex-flow-unplug-opaque-phase-drift-");
  try {
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await mkdir(stateRoot, { recursive: true });
    const opaque = resolve(stateRoot, "retained.json");
    await writeFile(opaque, "original\n");
    const plan = await unplugPlanV07({ repositoryPath: root, resources: [] });
    let injected = false;
    await assert.rejects(
      () => unplugApplyV07({
        repositoryPath: root,
        plan,
        testHook: async (point) => {
          if (point === "before-state-entry-1" && !injected) {
            injected = true;
            await writeFile(opaque, "changed\n");
          }
        },
      }),
      /state(?: entry)? changed during state removal/,
    );
    assert.equal(injected, true);
    assert.equal(await readFile(opaque, "utf8"), "changed\n");
  } finally {
    await removeFixture(root);
  }
});

test("unplug rejects root symlinks, special files, and inventory overflow", async () => {
  const symlinkRoot = await createGitFixture("codex-flow-unplug-opaque-symlink-");
  try {
    const common = git(symlinkRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await mkdir(stateRoot, { recursive: true });
    const target = resolve(common, "retained-target.json");
    await writeFile(target, "target\n");
    await symlink(target, resolve(stateRoot, "retained.json"));
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: symlinkRoot, resources: [] }),
      /symbolic link/,
    );
  } finally {
    await removeFixture(symlinkRoot);
  }

  const specialRoot = await createGitFixture("codex-flow-unplug-opaque-special-");
  try {
    const common = git(specialRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await mkdir(stateRoot, { recursive: true });
    execFileSync("mkfifo", [resolve(stateRoot, "retained.pipe")]);
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: specialRoot, resources: [] }),
      /special file/,
    );
  } finally {
    await removeFixture(specialRoot);
  }

  const overflowRoot = await createGitFixture("codex-flow-unplug-opaque-overflow-");
  try {
    const common = git(overflowRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await mkdir(stateRoot, { recursive: true });
    await Promise.all(Array.from({ length: 65 }, (_, index) => (
      writeFile(resolve(stateRoot, `retained-${String(index).padStart(2, "0")}.json`), "{}\n")
    )));
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: overflowRoot, resources: [] }),
      /exceeds 64 root entries/,
    );
  } finally {
    await removeFixture(overflowRoot);
  }

  const byteRoot = await createGitFixture("codex-flow-unplug-opaque-byte-bound-");
  try {
    const common = git(byteRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await mkdir(stateRoot, { recursive: true });
    const oversized = resolve(stateRoot, "oversized.bin");
    await writeFile(oversized, "");
    await truncate(oversized, (64 * 1024 * 1024) + 1);
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: byteRoot, resources: [] }),
      /inventory bound/,
    );
  } finally {
    await removeFixture(byteRoot);
  }

  const depthRoot = await createGitFixture("codex-flow-unplug-depth-bound-");
  try {
    const common = git(depthRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const namespaceRoot = resolve(common, "codex-flow", "v0.6.0");
    await mkdir(resolve(namespaceRoot, ...Array.from({ length: 34 }, (_, index) => `d${index}`)), {
      recursive: true,
    });
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: depthRoot, resources: [] }),
      /depth bound/,
    );
  } finally {
    await removeFixture(depthRoot);
  }
});

test("opaque-file removal resumes safely and v1 directory-only journals remain resumable", async () => {
  const opaqueRoot = await createGitFixture("codex-flow-unplug-opaque-resume-");
  try {
    const common = git(opaqueRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await namespace(common, "v0.7.0");
    const opaque = resolve(stateRoot, "legacy.json");
    await writeFile(opaque, "legacy\n");
    const plan = await unplugPlanV07({ repositoryPath: opaqueRoot, resources: [] });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: opaqueRoot, plan, testHook: "after-state-entry-1" }),
      /Test interruption/,
    );
    assert.equal(await pathExists(opaque), false);
    assert.equal(await pathExists(stateRoot), true);
    const receipt = await unplugApplyV07({ repositoryPath: opaqueRoot, plan });
    assert.equal(receipt.residue, false);
  } finally {
    await removeFixture(opaqueRoot);
  }

  const legacyRoot = await createGitFixture("codex-flow-unplug-v1-resume-");
  try {
    const common = git(legacyRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    await namespace(common, "v0.7.0");
    const v2 = await unplugPlanV07({ repositoryPath: legacyRoot, resources: [] });
    const v1 = legacyPlanFromV2(v2);
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: legacyRoot, plan: v1, testHook: "before-state-removal" }),
      /Test interruption/,
    );
    const receipt = await unplugApplyV07({ repositoryPath: legacyRoot, plan: v1 });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(stateRoot), false);
  } finally {
    await removeFixture(legacyRoot);
  }
});

test("v1 resume preserves the original per-namespace inventory byte bound", async () => {
  const root = await createGitFixture("codex-flow-unplug-v1-budget-");
  try {
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const stateRoot = resolve(common, "codex-flow");
    const namespaceNames = ["v0.7.0", "v0.7.1"];
    await Promise.all(namespaceNames.map((name) => mkdir(resolve(stateRoot, name), { recursive: true })));
    const base = await unplugPlanV07({ repositoryPath: root, resources: [] });
    const payloadSize = (32 * 1024 * 1024) + 1;
    const payloadDigest = sha256(Buffer.alloc(payloadSize));
    const namespaces = [];
    for (const name of namespaceNames) {
      const path = resolve(stateRoot, name);
      const payload = resolve(path, "payload.bin");
      await writeFile(payload, "");
      await truncate(payload, payloadSize);
      namespaces.push({
        name,
        path,
        digest: sha256(stableStringify([["payload.bin", "file", payloadSize, payloadDigest]])),
      });
    }
    const v1 = legacyPlanWithNamespaces(base, namespaces);
    const receipt = await unplugApplyV07({ repositoryPath: root, plan: v1 });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(stateRoot), false);
  } finally {
    await removeFixture(root);
  }
});

test("a newly active later namespace blocks before any state entry is removed", async () => {
  const root = await createGitFixture("codex-flow-unplug-active-race-");
  try {
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const first = await namespace(common, "v0.5.1");
    const later = await namespace(common, "v0.6.0");
    const plan = await unplugPlanV07({ repositoryPath: root, resources: [] });
    let activated = false;
    await assert.rejects(
      () => unplugApplyV07({
        repositoryPath: root,
        plan,
        testHook: async (point) => {
          if (point === "before-state-entry-1" && !activated) {
            activated = true;
            await writeFile(
              resolve(later, "runs", "lifecycle.json"),
              `${JSON.stringify({ active_run_id: "became-active", runs: {} })}\n`,
            );
          }
        },
      }),
      /active run/,
    );
    assert.equal(activated, true);
    assert.equal(await pathExists(first), true);
    assert.equal(await pathExists(later), true);
  } finally {
    await removeFixture(root);
  }
});

test("unplug plan is deterministic and exact apply leaves zero repository residue", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-clean-");
  try {
    await namespace(fixture.common);
    const first = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
    const second = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
    assert.deepEqual(first, second);
    assert.deepEqual(validateUnplugPlanV07(first), first);
    assert.equal(first.mutation_performed, false);
    assert.equal(first.active_runs.length, 0);
    const receipt = await unplugApplyV07({ repositoryPath: fixture.root, plan: first });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(resolve(fixture.common, "codex-flow")), false);
    assert.equal(await pathExists(resolve(fixture.common, "codex-flow-unplug-v07")), false);
    assert.notEqual(gitStatus(fixture.root, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]), 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("unplug accepts ignored artifacts but blocks ordinary untracked files before mutation", async () => {
  const ignored = await worktreeFixture("codex-flow-unplug-ignored-");
  try {
    await namespace(ignored.common);
    await writeFile(resolve(ignored.common, "info", "exclude"), "ignored-output\n");
    await writeFile(resolve(ignored.worktree, "ignored-output"), "generated\n");
    const plan = await unplugPlanV07({ repositoryPath: ignored.root, resources: resources(ignored) });
    const receipt = await unplugApplyV07({ repositoryPath: ignored.root, plan });
    assert.equal(receipt.residue, false);
  } finally {
    await cleanupFixture(ignored);
  }

  const dirty = await worktreeFixture("codex-flow-unplug-dirty-");
  try {
    const state = await namespace(dirty.common);
    await writeFile(resolve(dirty.worktree, "ordinary-untracked.txt"), "dirty\n");
    const plan = await unplugPlanV07({ repositoryPath: dirty.root, resources: resources(dirty) });
    await assert.rejects(() => unplugApplyV07({ repositoryPath: dirty.root, plan }), /worktree-dirty/);
    assert.equal(await pathExists(state), true);
    assert.equal(await pathExists(resolve(dirty.common, "codex-flow-unplug-v07")), false);
    assert.equal(gitStatus(dirty.root, ["show-ref", "--verify", `refs/heads/${dirty.branch}`]), 0);
  } finally {
    await cleanupFixture(dirty);
  }
});

test("unplug removes a clean detached Codex App worktree already integrated into the base", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-detached-", { detached: true });
  try {
    await namespace(fixture.common);
    const planned = resources(fixture);
    assert.equal(planned[0].branch, null);
    assert.equal(planned.length, 1);
    const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: planned });
    assert.equal(plan.resources[0].branch, null);
    const receipt = await unplugApplyV07({ repositoryPath: fixture.root, plan });
    assert.equal(receipt.residue, false);
    assert.equal(await pathExists(fixture.worktree), false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("unplug rejects a detached worktree whose commit is not integrated into the base", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-detached-unmerged-", {
    detached: true,
    commitOnBranch: true,
  });
  try {
    await namespace(fixture.common);
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) }),
      /Detached worktree tip is not an ancestor of the authenticated base/,
    );
    assert.equal(await pathExists(fixture.worktree), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("controller identity drift immediately before removal preserves detached work and state", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-controller-drift-", {
    detached: true,
    commitOnBranch: true,
  });
  try {
    git(fixture.root, ["merge", "--ff-only", fixture.tip]);
    const retained = await namespace(fixture.common);
    const plan = await unplugPlanV07({
      repositoryPath: fixture.root,
      resources: resources(fixture),
    });
    let injected = false;
    await assert.rejects(
      () => unplugApplyV07({
        repositoryPath: fixture.root,
        plan,
        testHook: async (point) => {
          if (point === "before-action-git-facts-1" && !injected) {
            injected = true;
            git(fixture.root, ["reset", "--hard", "HEAD^"]);
          }
        },
      }),
      /repository identity or controller worktree drifted/,
    );
    assert.equal(injected, true);
    assert.equal(await pathExists(fixture.worktree), true);
    assert.equal(await pathExists(retained), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("detached worktree plans fail closed on attachment mismatch and protected paths", async () => {
  const mismatch = await worktreeFixture("codex-flow-unplug-detached-mismatch-", { detached: true });
  try {
    await namespace(mismatch.common);
    const incorrect = resources(mismatch);
    incorrect[0] = { ...incorrect[0], branch: "codex/not-attached" };
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: mismatch.root, resources: incorrect }),
      /does not match live Git state/,
    );
  } finally {
    await cleanupFixture(mismatch);
  }

  const protectedFixture = await worktreeFixture("codex-flow-unplug-detached-protected-", { detached: true });
  try {
    await namespace(protectedFixture.common);
    const protectedResource = { ...resources(protectedFixture)[0], protected: true };
    const plan = await unplugPlanV07({
      repositoryPath: protectedFixture.root,
      resources: [protectedResource],
    });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: protectedFixture.root, plan }),
      /protected-worktree/,
    );
  } finally {
    await cleanupFixture(protectedFixture);
  }
});

test("active and malformed lifecycle state fail closed", async () => {
  const active = await worktreeFixture("codex-flow-unplug-active-");
  try {
    await namespace(active.common, "v0.7.0", "still-running");
    const opaque = resolve(active.common, "codex-flow", "retained-evidence.json");
    await writeFile(opaque, "{not-runtime-json\n");
    const plan = await unplugPlanV07({ repositoryPath: active.root, resources: resources(active) });
    assert.deepEqual(plan.active_runs, ["still-running"]);
    assert.equal(plan.state_entries.some((entry) => entry.kind === "opaque-file"), true);
    await assert.rejects(() => unplugApplyV07({ repositoryPath: active.root, plan }), /active run/);
    assert.equal(await pathExists(opaque), true);
  } finally {
    await cleanupFixture(active);
  }

  const malformed = await worktreeFixture("codex-flow-unplug-malformed-");
  try {
    const root = resolve(malformed.common, "codex-flow", "v0.7.0", "runs");
    await mkdir(root, { recursive: true });
    await writeFile(resolve(root, "lifecycle.json"), "{}\n");
    await assert.rejects(
      () => unplugPlanV07({ repositoryPath: malformed.root, resources: resources(malformed) }),
      /Cannot authenticate lifecycle state/,
    );
  } finally {
    await cleanupFixture(malformed);
  }
});

test("structured archive evidence must exactly prove every planned task", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-archive-");
  try {
    await namespace(fixture.common);
    const plan = await unplugPlanV07({
      repositoryPath: fixture.root,
      resources: resources(fixture, { includeTask: true }),
    });
    await assert.rejects(() => unplugApplyV07({ repositoryPath: fixture.root, plan }), /exactly cover/);
    await assert.rejects(() => unplugApplyV07({
      repositoryPath: fixture.root,
      plan,
      archiveEvidence: {
        "executor-task": {
          thread_id: "wrong-task",
          archived: true,
          observed_at: "2026-08-30T12:00:00.000Z",
          source: "codex-app",
        },
      },
    }), /does not prove/);
    const receipt = await unplugApplyV07({
      repositoryPath: fixture.root,
      plan,
      archiveEvidence: {
        "executor-task": {
          thread_id: "01a-test-visible-task",
          archived: true,
          observed_at: "2026-08-30T12:00:00.000Z",
          source: "codex-app",
        },
      },
    });
    assert.equal(receipt.residue, false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("remote refs and unmerged branches block apply", async () => {
  const remote = await worktreeFixture("codex-flow-unplug-remote-");
  try {
    await namespace(remote.common);
    git(remote.root, ["update-ref", `refs/remotes/origin/${remote.branch}`, remote.tip]);
    const plan = await unplugPlanV07({ repositoryPath: remote.root, resources: resources(remote) });
    await assert.rejects(() => unplugApplyV07({ repositoryPath: remote.root, plan }), /remote-ref-present/);
  } finally {
    await cleanupFixture(remote);
  }

  const unmerged = await worktreeFixture("codex-flow-unplug-unmerged-", { commitOnBranch: true });
  try {
    await namespace(unmerged.common);
    const plan = await unplugPlanV07({ repositoryPath: unmerged.root, resources: resources(unmerged) });
    await assert.rejects(() => unplugApplyV07({ repositoryPath: unmerged.root, plan }), /branch-not-ancestor/);
  } finally {
    await cleanupFixture(unmerged);
  }
});

test("a branch attached to an unplanned worktree cannot be removed", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-attached-");
  try {
    await namespace(fixture.common);
    const branchOnly = resources(fixture).find((resource) => resource.kind === "branch");
    const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: [branchOnly] });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: fixture.root, plan }),
      /branch-attached-outside-plan/,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("invoking linked worktree and primary checkout are dynamically protected", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-protected-");
  try {
    await namespace(fixture.common);
    const plan = await unplugPlanV07({
      repositoryPath: fixture.worktree,
      resources: [resources(fixture)[0]],
    });
    assert.equal(plan.resources[0].protected, true);
    await assert.rejects(() => unplugApplyV07({ repositoryPath: fixture.worktree, plan }), /protected-worktree/);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("action and state-removal interruptions both resume to zero residue", async () => {
  for (const hook of ["after-action-1", "before-state-removal", "after-state-removal"]) {
    const fixture = await worktreeFixture(`codex-flow-unplug-${hook}-`);
    try {
      await namespace(fixture.common);
      const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
      await assert.rejects(
        () => unplugApplyV07({ repositoryPath: fixture.root, plan, testHook: hook }),
        /Test interruption/,
      );
      await assert.rejects(
        () => assertNoUnplugInProgressV07({ gitCommonDirectory: fixture.common }),
        /already in progress/,
      );
      const receipt = await unplugApplyV07({ repositoryPath: fixture.root, plan });
      assert.equal(receipt.residue, false);
      assert.equal(await pathExists(resolve(fixture.common, "codex-flow")), false);
      assert.equal(await pathExists(resolve(fixture.common, "codex-flow-unplug-v07")), false);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("new namespace drift after journal creation blocks state deletion", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-state-drift-");
  try {
    const original = await namespace(fixture.common);
    const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: fixture.root, plan, testHook: "before-action" }),
      /Test interruption/,
    );
    const added = await namespace(fixture.common, "v0.7.1");
    await assert.rejects(() => unplugApplyV07({ repositoryPath: fixture.root, plan }), /state drifted/);
    assert.equal(await pathExists(original), true);
    assert.equal(await pathExists(added), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("new opaque-file drift during state-removal phase blocks without deleting it", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-state-phase-drift-");
  try {
    await namespace(fixture.common);
    const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: fixture.root, plan, testHook: "before-state-removal" }),
      /Test interruption/,
    );
    const added = resolve(fixture.common, "codex-flow", "late-evidence.json");
    await writeFile(added, "late\n");
    await assert.rejects(() => unplugApplyV07({ repositoryPath: fixture.root, plan }), /changed during state removal/);
    assert.equal(await pathExists(added), true);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a malformed or reordered unplug journal never authorizes cleanup", async () => {
  const fixture = await worktreeFixture("codex-flow-unplug-journal-forgery-");
  try {
    const retained = await namespace(fixture.common);
    const plan = await unplugPlanV07({ repositoryPath: fixture.root, resources: resources(fixture) });
    await assert.rejects(
      () => unplugApplyV07({ repositoryPath: fixture.root, plan, testHook: "before-action" }),
      /Test interruption/,
    );
    const journalPath = resolve(fixture.common, "codex-flow-unplug-v07", "journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.actions.reverse();
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`);
    await assert.rejects(() => unplugApplyV07({ repositoryPath: fixture.root, plan }), /action identity or state is invalid/);
    assert.equal(await pathExists(retained), true);
    assert.equal(gitStatus(fixture.root, ["show-ref", "--verify", `refs/heads/${fixture.branch}`]), 0);
  } finally {
    await cleanupFixture(fixture);
  }
});
