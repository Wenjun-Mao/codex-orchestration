import { spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  CliError,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "../core.mjs";
import { validateGitBranchName } from "../git.mjs";

const COMMIT = /^[0-9a-f]{40,64}$/;

function runGit(cwd, args, label, { allow = [] } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0 && !allow.includes(result.status)) {
    throw new CliError(
      String(result.stderr || result.stdout).trim() || `${label} failed`,
      73,
    );
  }
  return result;
}

function requireCommit(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a concrete Git commit`);
  return result;
}

function requireAbsolute(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function parseWorktreeInventory(raw) {
  const records = [];
  let current = null;
  for (const field of raw.split("\0").filter(Boolean)) {
    if (field.startsWith("worktree ")) {
      if (current !== null) records.push(current);
      current = {
        path: resolve(field.slice("worktree ".length)),
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (current === null) throw new CliError("Git worktree inventory is malformed", 73);
    if (field.startsWith("HEAD ")) current.head = field.slice("HEAD ".length);
    else if (field.startsWith("branch refs/heads/")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (field === "bare") current.bare = true;
    else if (field === "detached") current.detached = true;
    else if (field === "locked" || field.startsWith("locked ")) current.locked = true;
    else if (field === "prunable" || field.startsWith("prunable ")) current.prunable = true;
  }
  if (current !== null) records.push(current);
  return records;
}

function worktrees(commonDir) {
  return parseWorktreeInventory(runGit(
    commonDir,
    ["worktree", "list", "--porcelain", "-z"],
    "Refresh worktree inventory",
  ).stdout);
}

function localBranchTip(commonDir, branch, { allowMissing = false } = {}) {
  const name = validateGitBranchName(commonDir, branch, "Refresh executor branch");
  const result = runGit(
    commonDir,
    ["rev-parse", "--verify", `refs/heads/${name}^{commit}`],
    "Refresh executor branch inspection",
    { allow: allowMissing ? [128] : [] },
  );
  if (result.status === 128) return null;
  return requireCommit(result.stdout.trim(), "Refresh executor branch tip");
}

function branchExternalRefs(commonDir, branch, tip) {
  const upstream = runGit(
    commonDir,
    ["for-each-ref", "--format=%(upstream)", `refs/heads/${branch}`],
    "Refresh executor upstream inspection",
  ).stdout.trim();
  const remoteNames = runGit(
    commonDir,
    ["for-each-ref", "--format=%(refname)", "refs/remotes"],
    "Refresh remote ref inspection",
  ).stdout.split("\n").filter(Boolean);
  const matchingRemote = remoteNames.find((ref) => ref.endsWith(`/${branch}`)) ?? null;
  const tagsAtTip = runGit(
    commonDir,
    ["tag", "--points-at", tip],
    "Refresh tag inspection",
  ).stdout.split("\n").filter(Boolean);
  return { upstream: upstream || null, matching_remote: matchingRemote, tags_at_tip: tagsAtTip };
}

function statusDigest(path) {
  const raw = runGit(
    path,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"],
    "Refresh executor status inspection",
  ).stdout;
  return { status_digest: sha256(raw), dirty: raw !== "" };
}

export function validateRefreshGitAuthority(value, label = "refresh Git authority") {
  requireExactFields(value, {
    required: [
      "common_dir", "worktree_path", "branch", "head", "status_digest", "dirty",
      "worktree_inventory_digest", "upstream", "matching_remote", "tags_at_tip",
    ],
  }, label);
  const authority = {
    common_dir: requireAbsolute(value.common_dir, `${label}.common_dir`),
    worktree_path: requireAbsolute(value.worktree_path, `${label}.worktree_path`),
    branch: requireText(value.branch, `${label}.branch`, { max: 256 }),
    head: requireCommit(value.head, `${label}.head`),
    status_digest: requireText(value.status_digest, `${label}.status_digest`, { max: 64 }),
    dirty: value.dirty === true,
    worktree_inventory_digest: requireText(
      value.worktree_inventory_digest,
      `${label}.worktree_inventory_digest`,
      { max: 64 },
    ),
    upstream: value.upstream === null
      ? null
      : requireText(value.upstream, `${label}.upstream`, { max: 512 }),
    matching_remote: value.matching_remote === null
      ? null
      : requireText(value.matching_remote, `${label}.matching_remote`, { max: 512 }),
    tags_at_tip: Array.isArray(value.tags_at_tip)
      ? value.tags_at_tip.map((entry, index) => requireText(
        entry,
        `${label}.tags_at_tip[${index}]`,
        { max: 256 },
      )).sort()
      : (() => { throw new CliError(`${label}.tags_at_tip must be an array`); })(),
  };
  for (const field of ["status_digest", "worktree_inventory_digest"]) {
    if (!/^[0-9a-f]{64}$/.test(authority[field])) {
      throw new CliError(`${label}.${field} must be a lowercase SHA-256 digest`);
    }
  }
  if (!authority.branch.startsWith("codex/")) {
    throw new CliError("Refresh may discard only a codex/ executor branch", 73);
  }
  return authority;
}

export async function captureRefreshGitAuthority({
  commonDir,
  worktreePath,
  branch,
  expectedHead,
  forbiddenRoots,
  protectedBranches,
}) {
  const common = requireAbsolute(commonDir, "commonDir");
  const path = requireAbsolute(worktreePath, "worktreePath");
  const branchName = validateGitBranchName(common, branch, "Refresh executor branch");
  if (!branchName.startsWith("codex/")) {
    throw new CliError("Refresh may discard only a codex/ executor branch", 73);
  }
  const forbidden = new Set(await Promise.all((forbiddenRoots ?? []).map(async (entry) => (
    realpath(requireAbsolute(entry, "forbiddenRoots entry")).catch(() => resolve(entry))
  ))));
  const canonicalPath = await realpath(path).catch(() => null);
  if (canonicalPath === null) throw new CliError("Refresh executor worktree path is absent", 73);
  if (forbidden.has(canonicalPath)) {
    throw new CliError("Refresh refuses to discard a coordinator or primary worktree", 73);
  }
  if ((protectedBranches ?? []).includes(branchName)) {
    throw new CliError("Refresh refuses to discard a protected or source branch", 73);
  }
  const commonObserved = resolve(runGit(
    path,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Refresh executor common-directory inspection",
  ).stdout.trim());
  if (commonObserved !== common) {
    throw new CliError("Refresh executor worktree belongs to another repository", 73);
  }
  const inventory = worktrees(common);
  const attached = inventory.filter((entry) => entry.path === canonicalPath);
  if (attached.length !== 1) throw new CliError("Refresh executor worktree attachment is ambiguous", 73);
  const record = attached[0];
  if (record.bare || record.detached || record.locked || record.prunable) {
    throw new CliError("Refresh executor worktree is bare, detached, locked, or prunable", 73);
  }
  if (record.branch !== branchName) throw new CliError("Refresh executor worktree branch drifted", 73);
  const tip = localBranchTip(common, branchName);
  const expected = expectedHead === null || expectedHead === undefined
    ? tip
    : requireCommit(expectedHead, "expectedHead");
  if (record.head !== expected) throw new CliError("Refresh executor worktree HEAD drifted", 73);
  if (tip !== expected) throw new CliError("Refresh executor branch tip drifted", 73);
  const external = branchExternalRefs(common, branchName, tip);
  if (external.upstream !== null || external.matching_remote !== null || external.tags_at_tip.length > 0) {
    throw new CliError("Refresh refuses an executor branch retained by an upstream, remote ref, or tag", 73);
  }
  const status = statusDigest(canonicalPath);
  return validateRefreshGitAuthority({
    common_dir: common,
    worktree_path: canonicalPath,
    branch: branchName,
    head: tip,
    ...status,
    worktree_inventory_digest: sha256(stableStringify(inventory)),
    ...external,
  });
}

export async function refreshGitPresence(authority) {
  const expected = validateRefreshGitAuthority(authority);
  const pathInfo = await lstat(expected.worktree_path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const inventory = worktrees(expected.common_dir);
  const attachment = inventory.find((entry) => entry.path === expected.worktree_path) ?? null;
  const branchTip = localBranchTip(expected.common_dir, expected.branch, { allowMissing: true });
  return {
    worktree_present: pathInfo !== null || attachment !== null,
    attachment,
    branch_tip: branchTip,
  };
}

export async function removeRefreshExecutorWorktree(authority) {
  const expected = validateRefreshGitAuthority(authority);
  const current = await captureRefreshGitAuthority({
    commonDir: expected.common_dir,
    worktreePath: expected.worktree_path,
    branch: expected.branch,
    expectedHead: expected.head,
    forbiddenRoots: [],
    protectedBranches: [],
  });
  const { worktree_inventory_digest: currentInventory, ...currentStable } = current;
  const { worktree_inventory_digest: expectedInventory, ...expectedStable } = expected;
  if (stableStringify(currentStable) !== stableStringify(expectedStable)) {
    throw new CliError("Refresh executor Git authority drifted before worktree removal", 73);
  }
  runGit(
    expected.common_dir,
    ["worktree", "remove", "--force", expected.worktree_path],
    "Refresh executor worktree removal",
  );
  const after = await refreshGitPresence(expected);
  if (after.worktree_present) {
    throw new CliError("Refresh executor worktree removal postcondition failed", 73);
  }
  return after;
}

export async function deleteRefreshExecutorBranch(authority) {
  const expected = validateRefreshGitAuthority(authority);
  const before = await refreshGitPresence(expected);
  if (before.worktree_present) {
    throw new CliError("Refresh executor branch deletion requires worktree removal first", 73);
  }
  if (before.branch_tip !== expected.head) {
    throw new CliError("Refresh executor branch tip drifted before deletion", 73);
  }
  const external = branchExternalRefs(expected.common_dir, expected.branch, expected.head);
  if (external.upstream !== null || external.matching_remote !== null || external.tags_at_tip.length > 0) {
    throw new CliError("Refresh refuses an executor branch retained by an upstream, remote ref, or tag", 73);
  }
  runGit(
    expected.common_dir,
    ["branch", "-D", expected.branch],
    "Refresh executor branch deletion",
  );
  const after = await refreshGitPresence(expected);
  if (after.branch_tip !== null) {
    throw new CliError("Refresh executor branch deletion postcondition failed", 73);
  }
  return after;
}
