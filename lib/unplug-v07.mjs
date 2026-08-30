import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rmdir,
  rm,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  ensureDirectory,
  requireInteger,
  requireExactFields,
  requireText,
  SAFE_ID,
  sha256,
  stableStringify,
} from "./core.mjs";

const PLAN_V1_KIND = "codex-flow-v07-unplug-plan";
const PLAN_V2_KIND = "codex-flow-v07-unplug-plan-v2";
const JOURNAL_KIND = "codex-flow-v07-unplug-journal";
const RECEIPT_KIND = "codex-flow-v07-unplug-receipt";
const JOURNAL_DIRECTORY = "codex-flow-unplug-v07";
const JOURNAL_FILE = "journal.json";
const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const MAX_STATE_ENTRIES = 64;
const MAX_STATE_FILES = 10_000;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_STATE_DEPTH = 32;
const GIT_TIMEOUT_MS = 30_000;
const HOST_MANAGED_TURN_DIFF_REF_PREFIX = "refs/codex/turn-diffs/";

function runGit(cwd, args, label, { allowedStatuses = [0] } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (!allowedStatuses.includes(result.status)) {
    throw new CliError(
      String(result.stderr || result.stdout).trim() || `${label} failed`,
      73,
    );
  }
  return result;
}

function gitText(cwd, args, label, options = {}) {
  return runGit(cwd, args, label, options).stdout.trim();
}

function absolutePath(value, label) {
  const text = requireText(value, label, { max: 2048 });
  if (!isAbsolute(text)) throw new CliError(`${label} must be absolute`);
  return resolve(text);
}

function nullableBranch(value, label) {
  return value === null ? null : requireText(value, label, { max: 256 });
}

function revision(value, label) {
  if (typeof value !== "string" || !REVISION.test(value)) {
    throw new CliError(`${label} must be a Git revision`);
  }
  return value;
}

function timestamp(value, label) {
  const text = requireText(value, label, { max: 64 });
  if (!Number.isFinite(Date.parse(text)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return text;
}

function timestampFromNow(now) {
  if (!Number.isFinite(now)) throw new CliError("Unplug time must be finite");
  return new Date(now).toISOString();
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function contained(root, target) {
  const child = relative(root, target);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function accountStateFile(budget, size) {
  const nextFileCount = budget.fileCount + 1;
  const nextTotalBytes = budget.totalBytes + size;
  if (nextFileCount > MAX_STATE_FILES || nextTotalBytes > MAX_STATE_BYTES) {
    throw new CliError("Codex Flow state exceeds the unplug inventory bound");
  }
  budget.fileCount = nextFileCount;
  budget.totalBytes = nextTotalBytes;
}

async function authenticatedFile(path, budget) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new CliError(`Unplug state entry is not a real file: ${path}`);
  }
  accountStateFile(budget, before.size);
  const contents = await readFile(path);
  const after = await lstat(path);
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || after.size !== before.size
    || contents.length !== before.size
  ) {
    throw new CliError(`Codex Flow state changed during unplug inventory: ${path}`);
  }
  return { size: before.size, digest: sha256(contents) };
}

async function boundedTreeDigest(root, budget) {
  const rows = [];

  async function walk(path, relativePath, depth) {
    if (depth > MAX_STATE_DEPTH) throw new CliError("Codex Flow state exceeds the unplug depth bound");
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = resolve(path, entry.name);
      const key = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      const info = await lstat(child);
      if (info.isSymbolicLink()) throw new CliError(`Unplug state contains a symbolic link: ${child}`);
      if (info.isDirectory()) {
        rows.push([key, "directory"]);
        await walk(child, key, depth + 1);
        continue;
      }
      if (!info.isFile()) throw new CliError(`Unplug state contains a special file: ${child}`);
      const file = await authenticatedFile(child, budget);
      rows.push([key, "file", file.size, file.digest]);
    }
  }

  await walk(root, "", 0);
  return sha256(stableStringify(rows));
}

async function lifecycleActiveRun(commonDir, namespace, namespacePath) {
  const path = resolve(namespacePath, "runs", "lifecycle.json");
  await assertNoSymlinkComponents(commonDir, path, "Unplug lifecycle path");
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
    throw new CliError(`Cannot authenticate lifecycle state in namespace ${namespace}`);
  }
  let lifecycle;
  try {
    lifecycle = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new CliError(`Cannot authenticate lifecycle state in namespace ${namespace}`);
  }
  if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)) {
    throw new CliError(`Cannot authenticate lifecycle state in namespace ${namespace}`);
  }
  if (!("active_run_id" in lifecycle)) {
    throw new CliError(`Cannot authenticate lifecycle state in namespace ${namespace}`);
  }
  if (lifecycle.active_run_id === null) return null;
  if (typeof lifecycle.active_run_id !== "string" || !SAFE_ID.test(lifecycle.active_run_id)) {
    throw new CliError(`Cannot authenticate lifecycle state in namespace ${namespace}`);
  }
  return lifecycle.active_run_id;
}

async function stateEntryInventory(commonDir) {
  const stateRoot = resolve(commonDir, "codex-flow");
  await assertNoSymlinkComponents(commonDir, stateRoot, "Codex Flow state root");
  let entries;
  try {
    entries = await readdir(stateRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], activeRuns: [] };
    throw error;
  }
  if (entries.length > MAX_STATE_ENTRIES) {
    throw new CliError(`Codex Flow state exceeds ${MAX_STATE_ENTRIES} root entries`);
  }
  const result = [];
  const activeRuns = [];
  const budget = { fileCount: 0, totalBytes: 0 };
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!SAFE_ID.test(entry.name) || entry.name.length > 128) {
      throw new CliError(`Invalid Codex Flow state entry name: ${entry.name}`);
    }
    const path = resolve(stateRoot, entry.name);
    await assertNoSymlinkComponents(commonDir, path, "Codex Flow state entry");
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new CliError(`Unplug state contains a symbolic link: ${path}`);
    if (info.isDirectory()) {
      const activeRun = await lifecycleActiveRun(commonDir, entry.name, path);
      if (activeRun !== null) activeRuns.push(activeRun);
      result.push({
        kind: "namespace-directory",
        name: entry.name,
        path,
        digest: await boundedTreeDigest(path, budget),
      });
      continue;
    }
    if (!info.isFile()) throw new CliError(`Unplug state contains a special file: ${path}`);
    const file = await authenticatedFile(path, budget);
    result.push({
      kind: "opaque-file",
      name: entry.name,
      path,
      size: file.size,
      digest: file.digest,
    });
  }
  return { entries: result, activeRuns: [...new Set(activeRuns)].sort() };
}

async function legacyNamespaceInventory(commonDir) {
  const stateRoot = resolve(commonDir, "codex-flow");
  await assertNoSymlinkComponents(commonDir, stateRoot, "Codex Flow state root");
  let entries;
  try {
    entries = await readdir(stateRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], activeRuns: [] };
    throw error;
  }
  if (entries.length > MAX_STATE_ENTRIES) {
    throw new CliError(`Codex Flow state exceeds ${MAX_STATE_ENTRIES} namespaces`);
  }
  const result = [];
  const activeRuns = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new CliError(`Invalid Codex Flow namespace entry: ${entry.name}`);
    }
    if (!SAFE_ID.test(entry.name)) throw new CliError(`Invalid Codex Flow namespace: ${entry.name}`);
    const path = resolve(stateRoot, entry.name);
    await assertNoSymlinkComponents(commonDir, path, "Codex Flow namespace");
    const activeRun = await lifecycleActiveRun(commonDir, entry.name, path);
    if (activeRun !== null) activeRuns.push(activeRun);
    result.push({
      name: entry.name,
      path,
      digest: await boundedTreeDigest(path, { fileCount: 0, totalBytes: 0 }),
    });
  }
  return { entries: result, activeRuns: [...new Set(activeRuns)].sort() };
}

function parseWorktreeInventory(output) {
  return output.split("\0\0").filter(Boolean).map((block) => {
    const fields = block.split("\0").filter(Boolean);
    const pathField = fields.find((field) => field.startsWith("worktree "));
    const headField = fields.find((field) => field.startsWith("HEAD "));
    if (!pathField || !headField) throw new CliError("Git worktree inventory is incomplete");
    const branchField = fields.find((field) => field.startsWith("branch "));
    if (branchField && !branchField.startsWith("branch refs/heads/")) {
      throw new CliError("Git worktree branch is not a local head");
    }
    return {
      path: resolve(pathField.slice("worktree ".length)),
      head: revision(headField.slice("HEAD ".length), "worktree HEAD"),
      branch: branchField
        ? requireText(branchField.slice("branch refs/heads/".length), "worktree branch", { max: 256 })
        : null,
      bare: fields.includes("bare"),
      detached: fields.includes("detached"),
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      prunable: fields.some((field) => field === "prunable" || field.startsWith("prunable ")),
    };
  });
}

async function gitFacts(repositoryPath) {
  const lexicalRoot = resolve(gitText(repositoryPath, ["rev-parse", "--show-toplevel"], "Repository discovery"));
  const lexicalCommon = resolve(gitText(
    lexicalRoot,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Git common-directory discovery",
  ));
  const root = await realpath(lexicalRoot);
  const commonDir = await realpath(lexicalCommon);
  const head = revision(gitText(root, ["rev-parse", "--verify", "HEAD"], "Repository HEAD inspection"), "repository HEAD");
  const branchResult = runGit(
    root,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "Repository branch inspection",
    { allowedStatuses: [0, 1] },
  );
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : null;
  const status = gitText(
    root,
    ["-c", "status.showUntrackedFiles=all", "status", "--porcelain=v1", "--untracked-files=all"],
    "Repository status inspection",
  );
  const worktrees = parseWorktreeInventory(runGit(
    root,
    ["worktree", "list", "--porcelain", "-z"],
    "Git worktree inventory",
  ).stdout);
  for (const worktree of worktrees) {
    worktree.path = await realpath(worktree.path).catch(() => resolve(worktree.path));
  }
  const controller = worktrees.find((worktree) => worktree.path === root);
  if (!controller) throw new CliError("The invoking checkout is not a registered Git worktree");
  const refs = gitText(
    root,
    ["for-each-ref", "--format=%(refname) %(objectname)"],
    "Git ref inventory",
  ).split("\n")
    .filter(Boolean)
    // Codex App writes these capture refs as host evidence between approval
    // turns. They are not source or cleanup authority for repository unplug.
    .filter((entry) => !entry.startsWith(HOST_MANAGED_TURN_DIFF_REF_PREFIX))
    .sort();
  const statusDigest = sha256(status);
  const primaryWorktreePath = worktrees[0]?.path ?? root;
  return {
    root,
    commonDir,
    head,
    branch,
    statusDigest,
    primaryWorktreePath,
    worktrees,
    refs,
    digest: sha256(stableStringify({
      root,
      common_dir: commonDir,
      head,
      branch,
      status_digest: statusDigest,
      primary_worktree_path: primaryWorktreePath,
      worktrees,
      refs,
    })),
  };
}

function normalizeResource(resource, index, repository) {
  const label = `resource[${index}]`;
  requireExactFields(resource, {
    required: [
      "kind", "id", "provenance", "path", "branch", "expected_tip",
      "common_dir", "protected", "thread_id",
    ],
  }, label);
  const kind = requireText(resource.kind, `${label}.kind`, { max: 32, safeId: true });
  if (!["worktree", "branch", "task"].includes(kind)) throw new CliError(`${label}.kind is unsupported`);
  const id = requireText(resource.id, `${label}.id`, { max: 128, safeId: true });
  const provenance = requireText(resource.provenance, `${label}.provenance`, { max: 32, safeId: true });
  if (!["state-derived", "user-bound"].includes(provenance)) {
    throw new CliError(`${label}.provenance is unsupported`);
  }
  const commonDir = absolutePath(resource.common_dir, `${label}.common_dir`);
  if (commonDir !== repository.common_dir) throw new CliError(`${label} belongs to a different Git common directory`);
  const path = resource.path === null ? null : absolutePath(resource.path, `${label}.path`);
  const branch = nullableBranch(resource.branch, `${label}.branch`);
  const expectedTip = resource.expected_tip === null
    ? null
    : revision(resource.expected_tip, `${label}.expected_tip`);
  const threadId = resource.thread_id === null
    ? null
    : requireText(resource.thread_id, `${label}.thread_id`, { max: 256, safeId: true });
  if (typeof resource.protected !== "boolean") throw new CliError(`${label}.protected must be boolean`);

  if (kind === "worktree") {
    if (
      path === null
      || expectedTip === null
      || threadId !== null
      || (branch !== null && !branch.startsWith("codex/"))
    ) {
      throw new CliError(`${label} is not an exact Codex worktree resource`);
    }
  } else if (kind === "branch") {
    if (path !== null || branch === null || expectedTip === null || threadId !== null || resource.protected || !branch.startsWith("codex/")) {
      throw new CliError(`${label} is not an eligible local Codex branch resource`);
    }
  } else if (path !== null || branch !== null || expectedTip !== null || threadId === null || resource.protected) {
    throw new CliError(`${label} is not an exact task resource`);
  }
  return {
    kind,
    id,
    provenance,
    path,
    branch,
    expected_tip: expectedTip,
    common_dir: commonDir,
    protected: resource.protected,
    thread_id: threadId,
  };
}

const RESOURCE_ORDER = Object.freeze({ worktree: 0, branch: 1, task: 2 });

function sortedResources(resources) {
  return [...resources].sort((left, right) => (
    RESOURCE_ORDER[left.kind] - RESOURCE_ORDER[right.kind]
    || left.id.localeCompare(right.id)
  ));
}

function planSeed(plan) {
  const { plan_id: ignored, ...seed } = plan;
  return seed;
}

function normalizePlanRepository(value) {
  requireExactFields(value, {
    required: [
      "root", "common_dir", "head", "branch", "status_digest",
      "primary_worktree_path",
    ],
  }, "unplug repository");
  const repository = {
    root: absolutePath(value.root, "repository.root"),
    common_dir: absolutePath(value.common_dir, "repository.common_dir"),
    head: revision(value.head, "repository.head"),
    branch: nullableBranch(value.branch, "repository.branch"),
    status_digest: requireText(value.status_digest, "repository.status_digest", { max: 64 }),
    primary_worktree_path: absolutePath(value.primary_worktree_path, "repository.primary_worktree_path"),
  };
  if (!DIGEST.test(repository.status_digest)) throw new CliError("repository.status_digest must be SHA-256");
  return repository;
}

function normalizePlanResources(value, repository) {
  if (!Array.isArray(value) || value.length > 512) {
    throw new CliError("resources must contain at most 512 entries");
  }
  const resources = sortedResources(value.map((entry, index) => (
    normalizeResource(entry, index, repository)
  )));
  if (new Set(resources.map((entry) => entry.id)).size !== resources.length) {
    throw new CliError("unplug plan contains duplicate resource IDs");
  }
  return resources;
}

function normalizeActiveRuns(value) {
  if (!Array.isArray(value) || value.length > 128) {
    throw new CliError("active_runs must contain at most 128 entries");
  }
  const activeRuns = value.map((entry, index) => (
    requireText(entry, `active_runs[${index}]`, { max: 128, safeId: true })
  )).sort();
  if (new Set(activeRuns).size !== activeRuns.length) throw new CliError("active_runs contains duplicates");
  return activeRuns;
}

function normalizeLegacyNamespaces(value, repository) {
  if (!Array.isArray(value) || value.length > MAX_STATE_ENTRIES) {
    throw new CliError(`namespaces must contain at most ${MAX_STATE_ENTRIES} entries`);
  }
  const namespaces = value.map((entry, index) => {
    requireExactFields(entry, { required: ["name", "path", "digest"] }, `namespace[${index}]`);
    const name = requireText(entry.name, `namespace[${index}].name`, { max: 128, safeId: true });
    const path = absolutePath(entry.path, `namespace[${index}].path`);
    if (path !== resolve(repository.common_dir, "codex-flow", name)) {
      throw new CliError(`namespace[${index}] is outside the repository state root`);
    }
    const digest = requireText(entry.digest, `namespace[${index}].digest`, { max: 64 });
    if (!DIGEST.test(digest)) throw new CliError(`namespace[${index}].digest must be SHA-256`);
    return { name, path, digest };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(namespaces.map((entry) => entry.name)).size !== namespaces.length) {
    throw new CliError("unplug plan contains duplicate namespaces");
  }
  return namespaces;
}

function normalizeStateEntries(value, repository) {
  if (!Array.isArray(value) || value.length > MAX_STATE_ENTRIES) {
    throw new CliError(`state_entries must contain at most ${MAX_STATE_ENTRIES} entries`);
  }
  const stateEntries = value.map((entry, index) => {
    const label = `state_entries[${index}]`;
    const kind = requireText(entry?.kind, `${label}.kind`, { max: 32, safeId: true });
    if (!["namespace-directory", "opaque-file"].includes(kind)) {
      throw new CliError(`${label}.kind is unsupported`);
    }
    requireExactFields(entry, {
      required: kind === "opaque-file"
        ? ["kind", "name", "path", "size", "digest"]
        : ["kind", "name", "path", "digest"],
    }, label);
    const name = requireText(entry.name, `${label}.name`, { max: 128, safeId: true });
    const path = absolutePath(entry.path, `${label}.path`);
    if (path !== resolve(repository.common_dir, "codex-flow", name)) {
      throw new CliError(`${label} is outside the repository state root`);
    }
    const digest = requireText(entry.digest, `${label}.digest`, { max: 64 });
    if (!DIGEST.test(digest)) throw new CliError(`${label}.digest must be SHA-256`);
    if (kind === "opaque-file") {
      return {
        kind,
        name,
        path,
        size: requireInteger(entry.size, `${label}.size`, { min: 0, max: MAX_STATE_BYTES }),
        digest,
      };
    }
    return { kind, name, path, digest };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(stateEntries.map((entry) => entry.name)).size !== stateEntries.length) {
    throw new CliError("unplug plan contains duplicate state-entry names");
  }
  if (new Set(stateEntries.map((entry) => entry.path)).size !== stateEntries.length) {
    throw new CliError("unplug plan contains duplicate state-entry paths");
  }
  return stateEntries;
}

function validatePlanEnvelope(value, {
  schemaVersion,
  kind,
  planIdPrefix,
  stateField,
  normalizeState,
}) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "plan_id", "repository", stateField,
      "resources", "active_runs", "state_digest", "git_digest", "mutation_performed",
    ],
  }, "unplug plan");
  const planIdPattern = new RegExp(`^${planIdPrefix}[0-9a-f]{64}$`);
  if (value.schema_version !== schemaVersion || value.kind !== kind || !planIdPattern.test(value.plan_id)) {
    throw new CliError("Invalid v0.7 unplug plan");
  }
  const repository = normalizePlanRepository(value.repository);
  const stateInventory = normalizeState(value[stateField], repository);
  const resources = normalizePlanResources(value.resources, repository);
  const activeRuns = normalizeActiveRuns(value.active_runs);
  if (!DIGEST.test(value.state_digest) || !DIGEST.test(value.git_digest)) {
    throw new CliError("unplug digests must be SHA-256");
  }
  if (value.state_digest !== sha256(stableStringify(stateInventory))) {
    throw new CliError(`unplug state digest does not match its ${stateField} inventory`);
  }
  if (value.mutation_performed !== false) throw new CliError("unplug plan must be read-only");
  const plan = {
    schema_version: schemaVersion,
    kind,
    plan_id: value.plan_id,
    repository,
    [stateField]: stateInventory,
    resources,
    active_runs: activeRuns,
    state_digest: value.state_digest,
    git_digest: value.git_digest,
    mutation_performed: false,
  };
  if (plan.plan_id !== `${planIdPrefix}${sha256(stableStringify(planSeed(plan)))}`) {
    throw new CliError("unplug plan ID does not match its content");
  }
  return plan;
}

function validateUnplugPlanV1(value) {
  return validatePlanEnvelope(value, {
    schemaVersion: 1,
    kind: PLAN_V1_KIND,
    planIdPrefix: "unplug-plan-v1-",
    stateField: "namespaces",
    normalizeState: normalizeLegacyNamespaces,
  });
}

function validateUnplugPlanV2(value) {
  return validatePlanEnvelope(value, {
    schemaVersion: 2,
    kind: PLAN_V2_KIND,
    planIdPrefix: "unplug-plan-v2-",
    stateField: "state_entries",
    normalizeState: normalizeStateEntries,
  });
}

export function validateUnplugPlanV07(value) {
  if (value?.schema_version === 1) return validateUnplugPlanV1(value);
  if (value?.schema_version === 2) return validateUnplugPlanV2(value);
  throw new CliError("Invalid v0.7 unplug plan");
}

export function unplugPlanDigestV07(plan) {
  return sha256(stableStringify(planSeed(validateUnplugPlanV07(plan))));
}

async function buildUnplugPlanV07({ repositoryPath, resources = [] }, schemaVersion) {
  if (![1, 2].includes(schemaVersion)) throw new CliError("Unsupported unplug plan schema version");
  if (!Array.isArray(resources)) throw new CliError("resources must be an array");
  const git = await gitFacts(absolutePath(repositoryPath, "repositoryPath"));
  const repository = {
    root: git.root,
    common_dir: git.commonDir,
    head: git.head,
    branch: git.branch,
    status_digest: git.statusDigest,
    primary_worktree_path: git.primaryWorktreePath,
  };
  const normalized = sortedResources(resources.map((entry, index) => (
    normalizeResource(entry, index, repository)
  )));
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) {
    throw new CliError("unplug resources contain duplicate IDs");
  }
  for (const resource of normalized) {
    if (resource.kind === "worktree") {
      const canonicalPath = await realpath(resource.path).catch(() => resource.path);
      resource.path = canonicalPath;
      const live = git.worktrees.find((entry) => entry.path === canonicalPath);
      if (
        !live
        || live.head !== resource.expected_tip
        || live.branch !== resource.branch
        || (resource.branch === null && !live.detached)
      ) {
        throw new CliError(`Worktree resource does not match live Git state: ${resource.id}`);
      }
      if (
        resource.branch === null
        && !isAncestor(git.root, resource.expected_tip, git.head)
      ) {
        throw new CliError(
          `Detached worktree tip is not an ancestor of the authenticated base: ${resource.id}`,
          73,
        );
      }
      if (canonicalPath === git.root || canonicalPath === git.primaryWorktreePath) {
        resource.protected = true;
      }
    } else if (resource.kind === "branch") {
      const result = runGit(
        git.root,
        ["show-ref", "--verify", `refs/heads/${resource.branch}`],
        `Branch resource inspection for ${resource.branch}`,
        { allowedStatuses: [0, 1] },
      );
      if (result.status !== 0 || result.stdout.trim().split(/\s+/)[0] !== resource.expected_tip) {
        throw new CliError(`Branch resource does not match live Git state: ${resource.id}`);
      }
    }
  }
  const state = schemaVersion === 1
    ? await legacyNamespaceInventory(git.commonDir)
    : await stateEntryInventory(git.commonDir);
  const stateField = schemaVersion === 1 ? "namespaces" : "state_entries";
  const planIdPrefix = schemaVersion === 1 ? "unplug-plan-v1-" : "unplug-plan-v2-";
  const draft = {
    schema_version: schemaVersion,
    kind: schemaVersion === 1 ? PLAN_V1_KIND : PLAN_V2_KIND,
    plan_id: "",
    repository,
    [stateField]: state.entries,
    resources: normalized,
    active_runs: state.activeRuns,
    state_digest: sha256(stableStringify(state.entries)),
    git_digest: git.digest,
    mutation_performed: false,
  };
  draft.plan_id = `${planIdPrefix}${sha256(stableStringify(planSeed(draft)))}`;
  return validateUnplugPlanV07(draft);
}

export async function unplugPlanV07(options) {
  return buildUnplugPlanV07(options, 2);
}

function archiveEvidenceForPlan(plan, archiveEvidence) {
  if (typeof archiveEvidence !== "object" || archiveEvidence === null || Array.isArray(archiveEvidence)) {
    throw new CliError("archive_evidence must be an object keyed by task resource ID");
  }
  const tasks = plan.resources.filter((resource) => resource.kind === "task");
  const expectedIds = tasks.map((resource) => resource.id).sort();
  const actualIds = Object.keys(archiveEvidence).sort();
  if (stableStringify(expectedIds) !== stableStringify(actualIds)) {
    throw new CliError("archive_evidence must exactly cover every planned task and no others");
  }
  const normalized = {};
  for (const task of tasks) {
    const evidence = archiveEvidence[task.id];
    requireExactFields(evidence, {
      required: ["thread_id", "archived", "observed_at", "source"],
    }, `archive_evidence.${task.id}`);
    if (evidence.thread_id !== task.thread_id || evidence.archived !== true || evidence.source !== "codex-app") {
      throw new CliError(`archive_evidence.${task.id} does not prove the exact task is archived`);
    }
    normalized[task.id] = {
      thread_id: task.thread_id,
      archived: true,
      observed_at: timestamp(evidence.observed_at, `archive_evidence.${task.id}.observed_at`),
      source: "codex-app",
    };
  }
  return normalized;
}

function expectedActions(plan) {
  return plan.resources
    .filter((resource) => resource.kind === "worktree" || resource.kind === "branch")
    .map((resource) => ({ id: resource.id, kind: resource.kind, state: "pending" }));
}

function validateJournal(value, plan, archiveEvidenceDigest) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "plan_id", "phase", "state_digest", "git_digest",
      "archive_evidence_digest", "started_at", "updated_at", "actions",
    ],
  }, "unplug journal");
  if (
    value.schema_version !== 1
    || value.kind !== JOURNAL_KIND
    || value.plan_id !== plan.plan_id
    || !["actions", "state-removal"].includes(value.phase)
    || value.state_digest !== plan.state_digest
    || value.git_digest !== plan.git_digest
    || value.archive_evidence_digest !== archiveEvidenceDigest
  ) {
    throw new CliError("Unplug journal does not match the approved exact plan");
  }
  timestamp(value.started_at, "unplug journal.started_at");
  timestamp(value.updated_at, "unplug journal.updated_at");
  if (!Array.isArray(value.actions)) throw new CliError("unplug journal.actions must be an array");
  const expected = expectedActions(plan);
  if (value.actions.length !== expected.length) throw new CliError("Unplug journal action inventory is invalid");
  const actions = value.actions.map((action, index) => {
    requireExactFields(action, { required: ["id", "kind", "state"] }, `unplug journal.actions[${index}]`);
    if (
      action.id !== expected[index].id
      || action.kind !== expected[index].kind
      || !["pending", "completed"].includes(action.state)
    ) {
      throw new CliError("Unplug journal action identity or state is invalid");
    }
    return { id: action.id, kind: action.kind, state: action.state };
  });
  if (value.phase === "state-removal" && actions.some((action) => action.state !== "completed")) {
    throw new CliError("Unplug journal entered state removal before local actions completed");
  }
  return {
    schema_version: 1,
    kind: JOURNAL_KIND,
    plan_id: plan.plan_id,
    phase: value.phase,
    state_digest: value.state_digest,
    git_digest: value.git_digest,
    archive_evidence_digest: value.archive_evidence_digest,
    started_at: value.started_at,
    updated_at: value.updated_at,
    actions,
  };
}

function journalPaths(commonDir) {
  const root = resolve(commonDir, JOURNAL_DIRECTORY);
  return { root, file: resolve(root, JOURNAL_FILE) };
}

export async function assertNoUnplugInProgressV07({ gitCommonDirectory }) {
  const commonDir = await realpath(absolutePath(gitCommonDirectory, "gitCommonDirectory"));
  const { root } = journalPaths(commonDir);
  await assertNoSymlinkComponents(commonDir, root, "Unplug progress marker");
  if (await exists(root)) {
    throw new CliError(
      "Clean-start unplug is already in progress; resume the exact approved unplug plan before activation",
      73,
    );
  }
}

async function readJournal(commonDir, plan, archiveEvidenceDigest) {
  const paths = journalPaths(commonDir);
  await assertNoSymlinkComponents(commonDir, paths.root, "Unplug journal directory");
  let info;
  try {
    info = await lstat(paths.root);
  } catch (error) {
    if (error?.code === "ENOENT") return { paths, state: "missing", journal: null };
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError("Unplug progress marker is not a real directory");
  const entries = await readdir(paths.root, { withFileTypes: true });
  if (entries.length === 0) return { paths, state: "empty", journal: null };
  if (entries.length !== 1 || entries[0].name !== JOURNAL_FILE || !entries[0].isFile() || entries[0].isSymbolicLink()) {
    throw new CliError("Unplug journal directory contains unexpected state");
  }
  let raw;
  try {
    raw = JSON.parse(await readFile(paths.file, "utf8"));
  } catch {
    throw new CliError("Unplug journal is not valid JSON");
  }
  return {
    paths,
    state: "present",
    journal: validateJournal(raw, plan, archiveEvidenceDigest),
  };
}

async function writeJournal(commonDir, paths, journal, { exclusive = false } = {}) {
  await ensureDirectory(paths.root, { guardRoot: commonDir });
  await atomicWriteJson(paths.file, journal, { guardRoot: commonDir, exclusive });
}

function sameStateInventory(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function plannedStateInventory(plan) {
  return plan.schema_version === 1 ? plan.namespaces : plan.state_entries;
}

async function currentStateInventory(plan, commonDir) {
  return plan.schema_version === 1
    ? legacyNamespaceInventory(commonDir)
    : stateEntryInventory(commonDir);
}

function repositoryIdentityMatches(plan, git) {
  return (
    git.root === plan.repository.root
    && git.commonDir === plan.repository.common_dir
    && git.head === plan.repository.head
    && git.branch === plan.repository.branch
    && git.statusDigest === plan.repository.status_digest
    && git.primaryWorktreePath === plan.repository.primary_worktree_path
  );
}

function localBranchTip(root, branch) {
  const tip = gitText(
    root,
    ["for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`],
    `Local branch inspection for ${branch}`,
  );
  return tip === "" ? null : revision(tip, `Local branch tip for ${branch}`);
}

function branchHasRemoteRef(root, branch) {
  const refs = gitText(
    root,
    ["for-each-ref", "--format=%(refname)", "refs/remotes"],
    "Remote ref inspection",
  ).split("\n").filter(Boolean);
  return refs.some((ref) => ref.endsWith(`/${branch}`));
}

function isAncestor(root, ancestor, descendant) {
  return runGit(
    root,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    "Git ancestry inspection",
    { allowedStatuses: [0, 1] },
  ).status === 0;
}

async function worktreeTrackedClean(path) {
  return gitText(
    path,
    ["-c", "status.showUntrackedFiles=all", "status", "--porcelain=v1", "--untracked-files=all"],
    "Worktree cleanliness inspection",
  ) === "";
}

async function localResourcePreflight(plan, git, journal, { initial }) {
  const actions = new Map((journal?.actions ?? expectedActions(plan)).map((action) => [action.id, action]));
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));
  const plannedWorktreePaths = new Set(
    plan.resources.filter((resource) => resource.kind === "worktree").map((resource) => resource.path),
  );
  const blockers = [];
  const autoCompleted = [];
  for (const action of actions.values()) {
    const resource = resources.get(action.id);
    if (resource.kind === "worktree") {
      const live = git.worktrees.find((entry) => entry.path === resource.path);
      const pathPresent = await exists(resource.path);
      if (resource.protected || resource.path === git.root || resource.path === git.primaryWorktreePath) {
        blockers.push(`${resource.id}:protected-worktree`);
      } else if (action.state === "completed") {
        if (live || pathPresent) blockers.push(`${resource.id}:completed-worktree-still-present`);
      } else if (!live) {
        if (!initial && !pathPresent) autoCompleted.push(resource.id);
        else blockers.push(`${resource.id}:worktree-missing-or-unregistered`);
      } else if (
        live.head !== resource.expected_tip
        || live.branch !== resource.branch
        || (resource.branch === null && !live.detached)
        || live.bare
        || live.locked
        || live.prunable
      ) {
        blockers.push(`${resource.id}:worktree-drift`);
      } else if (
        resource.branch === null
        && !isAncestor(git.root, resource.expected_tip, plan.repository.head)
      ) {
        blockers.push(`${resource.id}:detached-tip-not-ancestor`);
      } else if (!(await worktreeTrackedClean(resource.path))) {
        blockers.push(`${resource.id}:worktree-dirty`);
      }
    } else {
      const tip = localBranchTip(git.root, resource.branch);
      if (action.state === "completed") {
        if (tip !== null) blockers.push(`${resource.id}:completed-branch-still-present`);
        continue;
      }
      if (tip === null) {
        if (!initial) autoCompleted.push(resource.id);
        else blockers.push(`${resource.id}:branch-missing`);
        continue;
      }
      if (tip !== resource.expected_tip) blockers.push(`${resource.id}:branch-tip-drift`);
      if (!isAncestor(git.root, tip, plan.repository.head)) blockers.push(`${resource.id}:branch-not-ancestor`);
      if (branchHasRemoteRef(git.root, resource.branch)) blockers.push(`${resource.id}:remote-ref-present`);
      const attachments = git.worktrees.filter((entry) => entry.branch === resource.branch);
      if (attachments.some((entry) => !plannedWorktreePaths.has(entry.path))) {
        blockers.push(`${resource.id}:branch-attached-outside-plan`);
      }
    }
  }
  if (blockers.length > 0) throw new CliError(`Unplug blocked: ${[...new Set(blockers)].join(", ")}`, 73);
  return autoCompleted;
}

async function allLocalResourcePostconditions(plan, git) {
  for (const resource of plan.resources) {
    if (resource.kind === "worktree") {
      if (git.worktrees.some((entry) => entry.path === resource.path) || await exists(resource.path)) return false;
    } else if (resource.kind === "branch" && localBranchTip(git.root, resource.branch) !== null) {
      return false;
    }
  }
  return true;
}

async function assertActionPhaseState(plan, git) {
  const state = await currentStateInventory(plan, git.commonDir);
  if (state.activeRuns.length > 0) throw new CliError("Unplug is blocked by an active run", 73);
  if (!sameStateInventory(state.entries, plannedStateInventory(plan))) {
    throw new CliError("Unplug state drifted; prepare a new exact plan", 73);
  }
}

async function assertStateRemovalPhaseState(plan, git) {
  const state = await currentStateInventory(plan, git.commonDir);
  if (state.activeRuns.length > 0) throw new CliError("Unplug is blocked by an active run", 73);
  const planned = new Map(plannedStateInventory(plan).map((entry) => [entry.path, entry]));
  for (const entry of state.entries) {
    const expected = planned.get(entry.path);
    if (!expected || stableStringify(expected) !== stableStringify(entry)) {
      throw new CliError("Unplug state changed during state removal", 73);
    }
  }
  return state;
}

async function reauthenticateStateEntryBeforeRemoval(plan, git, entry) {
  await assertNoSymlinkComponents(git.commonDir, entry.path, "Codex Flow state entry removal");
  const info = await lstat(entry.path);
  const directoryExpected = plan.schema_version === 1 || entry.kind === "namespace-directory";
  if (info.isSymbolicLink() || (directoryExpected ? !info.isDirectory() : !info.isFile())) {
    throw new CliError("Unplug state entry type changed during state removal", 73);
  }
  const budget = { fileCount: 0, totalBytes: 0 };
  if (directoryExpected) {
    const activeRun = await lifecycleActiveRun(git.commonDir, entry.name, entry.path);
    if (activeRun !== null) throw new CliError("Unplug is blocked by an active run", 73);
    if (await boundedTreeDigest(entry.path, budget) !== entry.digest) {
      throw new CliError("Unplug state entry changed during state removal", 73);
    }
    return;
  }
  const current = await authenticatedFile(entry.path, budget);
  if (current.size !== entry.size || current.digest !== entry.digest) {
    throw new CliError("Unplug state entry changed during state removal", 73);
  }
}

async function removePlannedState(plan, git, testHook) {
  await assertStateRemovalPhaseState(plan, git);
  let index = 0;
  for (const entry of plannedStateInventory(plan)) {
    index += 1;
    if (typeof testHook === "function") await testHook(`before-state-entry-${index}`);
    const state = await assertStateRemovalPhaseState(plan, git);
    if (!state.entries.some((current) => current.path === entry.path)) continue;
    await reauthenticateStateEntryBeforeRemoval(plan, git, entry);
    if (plan.schema_version === 1 || entry.kind === "namespace-directory") {
      await rm(entry.path, { recursive: true, force: false });
    } else {
      await rm(entry.path, { force: false });
    }
    if (
      testHook === `after-state-entry-${index}`
      || (plan.schema_version === 1 && testHook === `after-state-namespace-${index}`)
    ) {
      throw new CliError("Test interruption after state entry removal");
    }
  }
  const stateRoot = resolve(git.commonDir, "codex-flow");
  try {
    await rmdir(stateRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw new CliError("Codex Flow state root retained unexpected residue", 73);
  }
}

async function removeJournal(paths) {
  await rm(paths.file, { force: true });
  try {
    await rmdir(paths.root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw new CliError("Unplug journal retained unexpected residue", 73);
  }
}

async function completionReceipt(plan, git, paths, now) {
  const stateRoot = resolve(git.commonDir, "codex-flow");
  if (await exists(stateRoot) || await exists(paths.root)) {
    throw new CliError("Unplug could not prove zero repository residue", 73);
  }
  return {
    schema_version: 1,
    kind: RECEIPT_KIND,
    plan_id: plan.plan_id,
    completed_at: timestampFromNow(now),
    mutation_performed: true,
    repository_root: git.root,
    state_root_removed: true,
    journal_removed: true,
    residue: false,
  };
}

export async function unplugApplyV07({
  repositoryPath,
  plan,
  archiveEvidence = {},
  now = Date.now(),
  testHook = null,
}) {
  const checked = validateUnplugPlanV07(plan);
  const evidence = archiveEvidenceForPlan(checked, archiveEvidence);
  const archiveEvidenceDigest = sha256(stableStringify(evidence));
  if (checked.active_runs.length > 0) throw new CliError("Unplug is blocked by an active run", 73);

  let git = await gitFacts(absolutePath(repositoryPath, "repositoryPath"));
  if (!repositoryIdentityMatches(checked, git)) {
    throw new CliError("Unplug repository identity or controller worktree drifted", 73);
  }
  let retained = await readJournal(git.commonDir, checked, archiveEvidenceDigest);

  if (retained.state === "missing" || retained.state === "empty") {
    const stateRootMissing = !(await exists(resolve(git.commonDir, "codex-flow")));
    if (stateRootMissing && await allLocalResourcePostconditions(checked, git)) {
      if (retained.state === "empty") await rmdir(retained.paths.root);
      return completionReceipt(checked, git, retained.paths, now);
    }
    const fresh = await buildUnplugPlanV07(
      { repositoryPath: git.root, resources: checked.resources },
      checked.schema_version,
    );
    if (fresh.plan_id !== checked.plan_id) {
      throw new CliError("Unplug plan drifted; prepare a new exact plan", 73);
    }
    if (retained.state === "empty") await rmdir(retained.paths.root);
    await assertActionPhaseState(checked, git);
    await localResourcePreflight(checked, git, null, { initial: true });
    const recordedAt = timestampFromNow(now);
    const journal = {
      schema_version: 1,
      kind: JOURNAL_KIND,
      plan_id: checked.plan_id,
      phase: "actions",
      state_digest: checked.state_digest,
      git_digest: checked.git_digest,
      archive_evidence_digest: archiveEvidenceDigest,
      started_at: recordedAt,
      updated_at: recordedAt,
      actions: expectedActions(checked),
    };
    await writeJournal(git.commonDir, retained.paths, journal, { exclusive: true });
    retained = { ...retained, state: "present", journal };
  }

  let journal = validateJournal(retained.journal, checked, archiveEvidenceDigest);
  if (journal.phase === "actions") {
    await assertActionPhaseState(checked, git);
    const autoCompleted = new Set(await localResourcePreflight(checked, git, journal, { initial: false }));
    if (autoCompleted.size > 0) {
      journal.actions = journal.actions.map((action) => (
        autoCompleted.has(action.id) ? { ...action, state: "completed" } : action
      ));
      journal.updated_at = timestampFromNow(now);
      await writeJournal(git.commonDir, retained.paths, journal);
    }
    const resources = new Map(checked.resources.map((resource) => [resource.id, resource]));
    for (let index = 0; index < journal.actions.length; index += 1) {
      const action = journal.actions[index];
      if (action.state === "completed") continue;
      if (testHook === "before-action" || testHook === `before-action-${index + 1}`) {
        throw new CliError("Test interruption before unplug action");
      }
      if (typeof testHook === "function") {
        await testHook(`before-action-git-facts-${index + 1}`);
      }
      git = await gitFacts(git.root);
      if (!repositoryIdentityMatches(checked, git)) {
        throw new CliError("Unplug repository identity or controller worktree drifted", 73);
      }
      await assertActionPhaseState(checked, git);
      await localResourcePreflight(checked, git, journal, { initial: false });
      const resource = resources.get(action.id);
      if (action.kind === "worktree") {
        runGit(git.root, ["worktree", "remove", resource.path], `Removing worktree ${resource.path}`);
      } else {
        runGit(git.root, ["branch", "-d", "--", resource.branch], `Removing branch ${resource.branch}`);
      }
      journal.actions[index] = { ...action, state: "completed" };
      journal.updated_at = timestampFromNow(now);
      await writeJournal(git.commonDir, retained.paths, journal);
      if (testHook === `after-action-${index + 1}`) {
        throw new CliError("Test interruption after unplug action");
      }
    }
    journal.phase = "state-removal";
    journal.updated_at = timestampFromNow(now);
    await writeJournal(git.commonDir, retained.paths, journal);
  }

  git = await gitFacts(git.root);
  if (!repositoryIdentityMatches(checked, git)) {
    throw new CliError("Unplug repository identity or controller worktree drifted", 73);
  }
  if (!(await allLocalResourcePostconditions(checked, git))) {
    throw new CliError("Unplug local cleanup postconditions are incomplete", 73);
  }
  if (testHook === "before-state-removal") {
    throw new CliError("Test interruption before state removal");
  }
  await removePlannedState(checked, git, testHook);
  if (testHook === "after-state-removal") {
    throw new CliError("Test interruption after state removal");
  }
  await removeJournal(retained.paths);
  return completionReceipt(checked, git, retained.paths, now);
}
