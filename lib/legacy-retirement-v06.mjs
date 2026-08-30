import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWrite,
  CliError,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { validateProjectConfig } from "./config.mjs";
import { gitSnapshot } from "./git.mjs";
import { assertNoTrackedLegacyAuthority } from "./runtime-context.mjs";

export const LEGACY_RETIREMENT_SCHEMA_VERSION = 1;
export const LEGACY_RETIREMENT_PLAN_KIND = "codex-flow-v051-retirement-plan";
export const LEGACY_PACKAGE_VERSION = "0.5.1";

const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const MANAGED_PREFIXES = ["bin/", "lib/", "schemas/", "roles/", "references/"];
const START = "<!-- codex-flow:start v0.5.1 -->";
const END = "<!-- codex-flow:end -->";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function absolute(value, label) {
  requireText(value, label, { max: 2048 });
  if (!isAbsolute(value)) throw new CliError(`${label} must be absolute`);
  return resolve(value);
}

async function canonicalRoot(value, label = "repositoryRoot") {
  const root = absolute(value, label);
  await assertNoSymlinkComponents(root, root, "Repository root");
  return realpath(root);
}

function digest(value, label) {
  requireText(value, label, { max: 64 });
  if (!DIGEST.test(value)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function timestamp(value, label) {
  requireText(value, label, { max: 64 });
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  return value;
}

function safeRelative(value, label) {
  requireText(value, label, { max: 512 });
  if (
    value.startsWith("/") || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
    || !MANAGED_PREFIXES.some((prefix) => value.startsWith(prefix))
  ) throw new CliError(`${label} is not a safe v0.5.1 managed runtime path`);
  return value;
}

function target(root, path) {
  const result = resolve(root, ...path.split("/"));
  if (relative(root, result).split(sep).join("/") !== path) {
    throw new CliError(`Retirement path escapes the repository: ${path}`);
  }
  return result;
}

async function optionalBytes(root, path, label) {
  await assertNoSymlinkComponents(root, path, label);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new CliError(`${label} contains a symbolic link: ${path}`);
    if (!info.isFile()) throw new CliError(`${label} is not a regular file: ${path}`);
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function rawTree(root, label) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new CliError(`${label} contains a symbolic link: ${path}`);
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: sha256(await readFile(path)),
      });
      else throw new CliError(`${label} contains an unsupported entry: ${path}`);
    }
  }
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) throw new CliError(`${label} contains a symbolic link: ${root}`);
    if (!info.isDirectory()) throw new CliError(`${label} is not a directory: ${root}`);
    await walk(root);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, file_count: 0, raw_tree_sha256: sha256("[]") };
    throw error;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { exists: true, file_count: files.length, raw_tree_sha256: sha256(stableStringify(files)) };
}

async function directoryInventory(root, label) {
  const directories = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new CliError(`${label} contains a symbolic link: ${path}`);
      if (info.isDirectory()) { directories.push(path); await walk(path); }
      else if (!info.isFile()) throw new CliError(`${label} contains an unsupported entry: ${path}`);
    }
  }
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError(`${label} root is not a real directory`);
    directories.push(root); await walk(root);
  } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const depth = (path) => relative(root, path).split(sep).filter(Boolean).length;
  return directories.sort((left, right) => depth(right) - depth(left) || left.localeCompare(right));
}

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new CliError(String(error?.stderr ?? "").trim() || `Git inspection failed: ${args.join(" ")}`);
  }
}

function gitStatusPaths(root) {
  try {
    return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).split("\n").filter(Boolean).map((line) => line.slice(3)).sort();
  } catch (error) {
    throw new CliError(String(error?.stderr ?? "").trim() || "Git status inspection failed");
  }
}

function worktrees(root) {
  const result = [];
  let current = null;
  for (const field of git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0")) {
    if (field === "") { if (current) result.push(current); current = null; continue; }
    const split = field.indexOf(" ");
    const key = split < 0 ? field : field.slice(0, split);
    const value = split < 0 ? true : field.slice(split + 1);
    if (key === "worktree") current = { path: value, revision: null, branch: null };
    else if (!current) throw new CliError("Malformed Git worktree inventory");
    else if (key === "HEAD") current.revision = value;
    else if (key === "branch") current.branch = value === "(detached)" ? "detached" : value.replace(/^refs\/heads\//, "");
  }
  return result;
}

function markers(text) {
  const starts = [...text.matchAll(/<!-- codex-flow:start v[^\s]+ -->/g)];
  const ends = text.split(END).length - 1;
  if (starts.length !== ends || starts.length > 1) throw new CliError("AGENTS.md contains malformed or duplicate codex-flow managed markers");
  if (starts.length === 0) return null;
  if (starts[0][0] !== START) throw new CliError("AGENTS.md does not contain the exact v0.5.1 managed block");
  const start = starts[0].index;
  const end = text.indexOf(END, start);
  if (end < start) throw new CliError("AGENTS.md contains malformed codex-flow managed markers");
  return { start, end: end + END.length, block: text.slice(start, end + END.length) };
}

function removeExactAgentsBlock(text) {
  const range = markers(text);
  if (!range) throw new CliError("AGENTS.md is missing the exact v0.5.1 managed block");
  const before = text.slice(0, range.start).trimEnd();
  const after = text.slice(range.end).trimStart();
  if (before === "" && after === "") return { value: "", block: range.block };
  if (before === "") return { value: `${after.trimEnd()}\n`, block: range.block };
  if (after === "") return { value: `${before}\n`, block: range.block };
  return { value: `${before}\n\n${after.trimEnd()}\n`, block: range.block };
}

function validateManifest(value) {
  requireExactFields(value, { required: ["schema_version", "package_version", "files"] }, "v0.5.1 version manifest");
  if (value.schema_version !== 1 || value.package_version !== LEGACY_PACKAGE_VERSION) {
    throw new CliError("Retirement supports only an exact v0.5.1 version manifest");
  }
  if (!value.files || typeof value.files !== "object" || Array.isArray(value.files)) {
    throw new CliError("v0.5.1 version manifest.files must be an object");
  }
  const files = Object.fromEntries(Object.entries(value.files).map(([path, hash]) => [
    safeRelative(path, "v0.5.1 version manifest path"), digest(hash, `v0.5.1 version manifest ${path}`),
  ]).sort(([a], [b]) => a.localeCompare(b)));
  return { schema_version: 1, package_version: LEGACY_PACKAGE_VERSION, files };
}

async function json(root, path, label) {
  const raw = await optionalBytes(root, path, label);
  if (raw === null) throw new CliError(`${label} is missing: ${path}`);
  try { return { raw, value: JSON.parse(raw.toString("utf8")) }; }
  catch { throw new CliError(`${label} is invalid JSON: ${path}`); }
}

function add(blockers, code, detail) {
  blockers.push({ code, detail: String(detail).slice(0, 512) });
}

async function jsonRecords(root, relativeRoot, label, blockers) {
  const start = target(root, relativeRoot);
  const result = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) { add(blockers, "state-symlink", relative(root, path)); continue; }
      if (info.isDirectory()) { await walk(path); continue; }
      if (!info.isFile()) { add(blockers, "state-unsupported-entry", relative(root, path)); continue; }
      if (!entry.name.endsWith(".json")) continue;
      try { result.push({ path: relative(root, path).split(sep).join("/"), value: JSON.parse(await readFile(path, "utf8")) }); }
      catch { add(blockers, "invalid-state-record", relative(root, path)); }
    }
  }
  try { await walk(start); } catch (error) { add(blockers, "state-inspection-failed", `${label}: ${error.message}`); }
  return result;
}

function validCallbackChain(record, records, seen = new Set()) {
  if (!record || typeof record !== "object" || typeof record.callback_id !== "string") return false;
  if (record.state === "consumed") return true;
  if (record.state !== "superseded" || typeof record.superseded_by_callback_id !== "string") return false;
  if (seen.has(record.callback_id)) return false;
  seen.add(record.callback_id);
  const successor = records.get(record.superseded_by_callback_id);
  if (!successor || successor.state === "persisted" || successor.state === "observed") return false;
  const supersedes = successor?.receipt?.supersedes_callback_ids;
  return Array.isArray(supersedes) && supersedes.includes(record.callback_id)
    && validCallbackChain(successor, records, seen);
}

async function lifecycle(root, commonDir, snapshot, blockers) {
  const stateRoot = join(commonDir, "codex-flow", "v0.5.1");
  const callbackRows = await jsonRecords(stateRoot, "callbacks/journal", "callbacks", blockers);
  const urgentRows = await jsonRecords(stateRoot, "urgent-signals/journal", "urgent signals", blockers);
  const operationRows = await jsonRecords(stateRoot, "task-operations/records", "task operations", blockers);
  const ownershipRows = await jsonRecords(stateRoot, "git-lifecycle/ownership", "Git ownership", blockers);
  const integrationRows = await jsonRecords(stateRoot, "git-lifecycle/integrations", "Git integrations", blockers);
  const leaseRows = await jsonRecords(stateRoot, "leases", "leases", blockers);
  const callbacks = new Map();
  for (const row of callbackRows) {
    const record = row.value;
    if (!record?.callback_id || !["persisted", "observed", "consumed", "superseded", "expired"].includes(record.state)) {
      add(blockers, "invalid-callback-chain", row.path); continue;
    }
    if (callbacks.has(record.callback_id)) { add(blockers, "invalid-callback-chain", `duplicate ${record.callback_id}`); continue; }
    callbacks.set(record.callback_id, record);
  }
  for (const record of callbacks.values()) {
    if (!validCallbackChain(record, callbacks)) add(blockers, "pending-or-invalid-callback", record.callback_id);
  }
  const operationSummary = { total: operationRows.length, observed: 0, settled: 0, unresolved: 0, ambiguous: 0 };
  for (const row of operationRows) {
    const operation = row.value;
    const status = operation?.status;
    if (!operation?.operation_id || typeof status !== "string") { add(blockers, "invalid-task-operation", row.path); continue; }
    if (status === "observed") {
      operationSummary.observed += 1;
      const settled = [...callbacks.values()].some((callback) => (
        callback.receipt?.run_id === operation.request?.run_id
        && callback.receipt?.executor_id === operation.request?.task_id
        && validCallbackChain(callback, callbacks)
      ));
      if (settled) operationSummary.settled += 1;
      else { operationSummary.unresolved += 1; add(blockers, "unsettled-observed-operation", operation.operation_id); }
    } else if (status !== "rejected-before-release") {
      operationSummary.unresolved += 1;
      if (status === "ambiguous") operationSummary.ambiguous += 1;
      add(blockers, status === "ambiguous" ? "ambiguous-task-operation" : "unresolved-task-operation", operation.operation_id);
    }
  }
  const urgentSummary = { total: urgentRows.length, pending: 0, settled: 0 };
  for (const row of urgentRows) {
    const record = row.value;
    if (!record?.urgent_id || !["persisted", "observed", "consumed", "superseded", "expired"].includes(record.state)) {
      add(blockers, "invalid-urgent-signal", row.path); continue;
    }
    if (["consumed", "superseded", "expired"].includes(record.state)) urgentSummary.settled += 1;
    else { urgentSummary.pending += 1; add(blockers, "pending-urgent-signal", record.urgent_id); }
  }
  const leaseSummary = { total: leaseRows.length, active: 0, expired: 0 };
  for (const row of leaseRows) {
    const lease = row.value;
    if (lease?.kind !== "codex-flow-lease" || typeof lease.expires_at !== "string") { add(blockers, "invalid-lease", row.path); continue; }
    if (Date.parse(lease.expires_at) > Date.now()) { leaseSummary.active += 1; add(blockers, "active-lease", lease.resource ?? row.path); }
    else leaseSummary.expired += 1;
  }
  const ownership = new Map();
  for (const row of ownershipRows) {
    const value = row.value;
    if (!value?.operation_id || typeof value.worktree_path !== "string" || typeof value.branch !== "string") {
      add(blockers, "invalid-git-ownership", row.path); continue;
    }
    ownership.set(resolve(value.worktree_path), value);
  }
  const inventory = worktrees(root);
  const retainedWorktrees = inventory.map((item) => ({
    path: resolve(item.path), branch: item.branch, revision: item.revision,
    bound_operation_id: ownership.get(resolve(item.path))?.operation_id ?? null,
  }));
  for (const item of retainedWorktrees) {
    if (item.path !== snapshot.root && item.bound_operation_id === null) add(blockers, "unbound-worktree", item.path);
  }
  const integrations = new Map(integrationRows.map((row) => [row.value?.operation_id, row.value]));
  const cleanupEligible = [...ownership.values()]
    .filter((item) => ["ancestor", "patch-equivalent", "superseded"].includes(integrations.get(item.operation_id)?.disposition))
    .map((item) => ({ operation_id: item.operation_id, branch: item.branch, worktree_path: item.worktree_path }))
    .sort((a, b) => a.operation_id.localeCompare(b.operation_id));
  const tree = await rawTree(stateRoot, "v0.5.1 Git-common evidence");
  return {
    state: { relative_path: "codex-flow/v0.5.1", ...tree },
    lifecycle_summary: {
      operations: operationSummary,
      callbacks: { total: callbackRows.length, settled: [...callbacks.values()].filter((value) => validCallbackChain(value, callbacks)).length, pending_or_invalid: blockers.filter((item) => item.code === "pending-or-invalid-callback").length },
      urgent_signals: urgentSummary,
      leases: leaseSummary,
      worktrees: { total: retainedWorktrees.length, unbound: retainedWorktrees.filter((item) => item.path !== snapshot.root && item.bound_operation_id === null).length },
    },
    retained_authority: {
      git_common_evidence: { relative_path: "codex-flow/v0.5.1", ...tree },
      tasks: operationRows.map((row) => row.value?.operation_id).filter(Boolean).sort(),
      retained_worktrees: retainedWorktrees.sort((a, b) => a.path.localeCompare(b.path)),
      cleanup_eligible_branches: cleanupEligible,
      tags: git(root, ["for-each-ref", "--format=%(refname:strip=2)", "refs/tags"]).split("\n").filter(Boolean).sort(),
      branches: git(root, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]).split("\n").filter(Boolean).sort(),
    },
  };
}

function planId(plan) { const { plan_id: ignored, ...base } = plan; return sha256(stableStringify(base)); }

function operation(path, before, after = null) {
  return { path, action: after === null ? "delete" : "update", before_sha256: sha256(before), after_sha256: after === null ? null : sha256(after) };
}

export async function planLegacyRetirement({ repositoryRoot, reason, plannedAt }) {
  const root = await canonicalRoot(repositoryRoot);
  const reviewedReason = requireText(reason, "reason", { max: 512 });
  const plannedAtValue = timestamp(plannedAt, "plannedAt");
  const blockers = [];
  const snapshot = gitSnapshot(root);
  if (snapshot.root !== root) add(blockers, "repository-root-drift", snapshot.root);
  if (snapshot.cleanliness !== "clean") add(blockers, "dirty-git-worktree", snapshot.cleanliness);
  if (snapshot.branch === "detached" || snapshot.revision === "unborn") add(blockers, "unbound-git-head", snapshot.branch);
  const runtimeRoot = target(root, ".codex/orchestration");
  const versionPath = target(root, ".codex/orchestration/version.json");
  const configPath = target(root, ".codex/orchestration/project.json");
  let version; let config; let versionRaw; let configRaw;
  try { ({ value: version, raw: versionRaw } = await json(root, versionPath, "v0.5.1 version manifest")); version = validateManifest(version); }
  catch (error) { add(blockers, "invalid-version-manifest", error.message); version = null; }
  try { ({ value: config, raw: configRaw } = await json(root, configPath, "v0.5.1 project configuration")); config = validateProjectConfig(config); }
  catch (error) { add(blockers, "invalid-project-config", error.message); config = null; }
  const owned = new Set([".codex/orchestration/version.json", ".codex/orchestration/project.json"]);
  const operations = [];
  if (version) {
    for (const [path, expected] of Object.entries(version.files)) {
      const relativePath = `.codex/orchestration/${path}`;
      owned.add(relativePath);
      try {
        const bytes = await optionalBytes(root, target(root, relativePath), "Managed v0.5.1 runtime path");
        if (bytes === null) add(blockers, "managed-runtime-drift", `${path}: missing`);
        else if (sha256(bytes) !== expected) add(blockers, "managed-runtime-drift", `${path}: modified`);
        else operations.push(operation(relativePath, bytes));
      } catch (error) { add(blockers, "managed-runtime-drift", error.message); }
    }
    try {
      const inventory = await rawTree(runtimeRoot, "Managed v0.5.1 runtime");
      if (inventory.exists) {
        async function check(directory) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name); const info = await lstat(path);
            if (info.isSymbolicLink()) { add(blockers, "runtime-symlink", relative(root, path)); continue; }
            if (info.isDirectory()) {
              const rel = relative(root, path).split(sep).join("/");
              const ownedDirectory = Object.keys(version.files).some((file) => rel === `.codex/orchestration/${dirname(file).split(sep).join("/")}` || file.startsWith(`${relative(runtimeRoot, path).split(sep).join("/")}/`));
              if (!ownedDirectory) add(blockers, "unowned-runtime-directory", rel);
              await check(path);
            }
            else if (info.isFile()) {
              const rel = relative(root, path).split(sep).join("/");
              if (!owned.has(rel)) add(blockers, "unowned-runtime-file", rel);
            }
          }
        }
        await check(runtimeRoot);
      }
    } catch (error) {
      add(blockers, String(error.message).includes("symbolic link") ? "runtime-symlink" : "runtime-inventory-failed", error.message);
    }
  }
  if (versionRaw) operations.push(operation(".codex/orchestration/version.json", versionRaw));
  if (configRaw) operations.push(operation(".codex/orchestration/project.json", configRaw));
  let agents = { mode: config?.agents_integration?.mode ?? "unknown", path: null, before_sha256: null, after_sha256: null, managed_block_sha256: null };
  if (config?.agents_integration?.mode === "managed") {
    const path = target(root, "AGENTS.md");
    try {
      const before = await optionalBytes(root, path, "AGENTS.md");
      if (before === null) throw new CliError("AGENTS.md is missing");
      const removed = removeExactAgentsBlock(before.toString("utf8"));
      const after = Buffer.from(removed.value, "utf8");
      agents = { mode: "managed", path: "AGENTS.md", before_sha256: sha256(before), after_sha256: sha256(after), managed_block_sha256: sha256(removed.block) };
      operations.push(operation("AGENTS.md", before, after));
    } catch (error) { add(blockers, "invalid-managed-agents", error.message); }
  } else if (config?.agents_integration?.mode === "external") {
    const externalPath = config.agents_integration.path;
    try {
      const bytes = await optionalBytes(root, target(root, externalPath), "External AGENTS instruction path");
      if (bytes === null || sha256(bytes) !== config.agents_integration.sha256) throw new CliError("External AGENTS instruction attestation has drifted");
      if (markers(bytes.toString("utf8"))) throw new CliError("External AGENTS instruction file still contains a codex-flow managed block");
      agents = { mode: "external", path: externalPath, before_sha256: sha256(bytes), after_sha256: sha256(bytes), managed_block_sha256: null };
    } catch (error) { add(blockers, "external-agents-drift", error.message); }
  }
  const evidence = await lifecycle(root, snapshot.commonDir, snapshot, blockers);
  const binding = { root, common_dir: snapshot.commonDir, branch: snapshot.branch, revision: snapshot.revision, cleanliness: snapshot.cleanliness };
  const deduped = [...new Map(blockers.map((item) => [`${item.code}:${item.detail}`, item])).values()].sort((a, b) => `${a.code}:${a.detail}`.localeCompare(`${b.code}:${b.detail}`));
  const retiredDirectories = deduped.length === 0
    ? (await directoryInventory(runtimeRoot, "Managed v0.5.1 runtime")).map((path) => relative(root, path).split(sep).join("/"))
    : [];
  const draft = {
    schema_version: LEGACY_RETIREMENT_SCHEMA_VERSION,
    kind: LEGACY_RETIREMENT_PLAN_KIND,
    reason: reviewedReason,
    planned_at: plannedAtValue,
    repository: binding,
    authority: {
      manifest: { path: ".codex/orchestration/version.json", sha256: versionRaw ? sha256(versionRaw) : null, package_version: version?.package_version ?? null, files: version?.files ?? {} },
      config: { path: ".codex/orchestration/project.json", sha256: configRaw ? sha256(configRaw) : null },
      agents,
    },
    git_common_evidence: evidence.state,
    lifecycle_summary: evidence.lifecycle_summary,
    retained_authority: evidence.retained_authority,
    blockers: deduped,
    applicable: deduped.length === 0,
    operations: deduped.length === 0 ? operations.sort((a, b) => a.path.localeCompare(b.path)) : [],
    retired_directories: retiredDirectories,
  };
  return { ...draft, plan_id: planId(draft) };
}

function validateOperation(value, label) {
  requireExactFields(value, { required: ["path", "action", "before_sha256", "after_sha256"] }, label);
  const path = requireText(value.path, `${label}.path`, { max: 1024 });
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new CliError(`${label}.path is unsafe`);
  const action = requireText(value.action, `${label}.action`, { max: 16, safeId: true });
  if (!["delete", "update"].includes(action)) throw new CliError(`${label}.action is invalid`);
  const before = digest(value.before_sha256, `${label}.before_sha256`);
  const after = value.after_sha256 === null ? null : digest(value.after_sha256, `${label}.after_sha256`);
  if ((action === "delete") !== (after === null)) throw new CliError(`${label} action and after hash disagree`);
  return { path, action, before_sha256: before, after_sha256: after };
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new CliError(`${label} must be a non-negative integer`);
  return value;
}

function validateTree(value, label) {
  requireExactFields(value, { required: ["relative_path", "exists", "file_count", "raw_tree_sha256"] }, label);
  if (value.relative_path !== "codex-flow/v0.5.1" || typeof value.exists !== "boolean") throw new CliError(`${label} is invalid`);
  nonNegativeInteger(value.file_count, `${label}.file_count`); digest(value.raw_tree_sha256, `${label}.raw_tree_sha256`);
}

function validatePlanDetail(value) {
  requireExactFields(value.authority, { required: ["manifest", "config", "agents"] }, "legacy retirement authority");
  requireExactFields(value.authority.manifest, { required: ["path", "sha256", "package_version", "files"] }, "legacy retirement authority.manifest");
  if (value.authority.manifest.path !== ".codex/orchestration/version.json") throw new CliError("Legacy retirement manifest path is invalid");
  if (value.authority.manifest.sha256 !== null) digest(value.authority.manifest.sha256, "legacy retirement manifest.sha256");
  if (value.authority.manifest.package_version !== null && value.authority.manifest.package_version !== LEGACY_PACKAGE_VERSION) throw new CliError("Legacy retirement package version is invalid");
  if (!value.authority.manifest.files || typeof value.authority.manifest.files !== "object" || Array.isArray(value.authority.manifest.files)) throw new CliError("Legacy retirement manifest files are invalid");
  for (const [path, hash] of Object.entries(value.authority.manifest.files)) { safeRelative(path, "legacy retirement manifest file"); digest(hash, `legacy retirement manifest ${path}`); }
  requireExactFields(value.authority.config, { required: ["path", "sha256"] }, "legacy retirement authority.config");
  if (value.authority.config.path !== ".codex/orchestration/project.json") throw new CliError("Legacy retirement project path is invalid");
  if (value.authority.config.sha256 !== null) digest(value.authority.config.sha256, "legacy retirement config.sha256");
  requireExactFields(value.authority.agents, { required: ["mode", "path", "before_sha256", "after_sha256", "managed_block_sha256"] }, "legacy retirement authority.agents");
  if (!["managed", "external", "unknown"].includes(value.authority.agents.mode)) throw new CliError("Legacy retirement AGENTS mode is invalid");
  for (const key of ["before_sha256", "after_sha256", "managed_block_sha256"]) if (value.authority.agents[key] !== null) digest(value.authority.agents[key], `legacy retirement agents.${key}`);
  if (value.authority.agents.path !== null) requireText(value.authority.agents.path, "legacy retirement agents.path", { max: 512 });
  validateTree(value.git_common_evidence, "legacy retirement Git-common evidence");
  requireExactFields(value.lifecycle_summary, { required: ["operations", "callbacks", "urgent_signals", "leases", "worktrees"] }, "legacy retirement lifecycle summary");
  const summaries = [["operations", ["total", "observed", "settled", "unresolved", "ambiguous"]], ["callbacks", ["total", "settled", "pending_or_invalid"]], ["urgent_signals", ["total", "pending", "settled"]], ["leases", ["total", "active", "expired"]], ["worktrees", ["total", "unbound"]]];
  for (const [name, fields] of summaries) { requireExactFields(value.lifecycle_summary[name], { required: fields }, `legacy retirement lifecycle ${name}`); for (const field of fields) nonNegativeInteger(value.lifecycle_summary[name][field], `legacy retirement lifecycle ${name}.${field}`); }
  requireExactFields(value.retained_authority, { required: ["git_common_evidence", "tasks", "retained_worktrees", "cleanup_eligible_branches", "tags", "branches"] }, "legacy retained authority");
  validateTree(value.retained_authority.git_common_evidence, "legacy retained Git-common evidence");
  for (const [key, max] of [["tasks", 96], ["tags", 512], ["branches", 256]]) {
    if (!Array.isArray(value.retained_authority[key])) throw new CliError(`legacy retained ${key} must be an array`);
    for (const item of value.retained_authority[key]) requireText(item, `legacy retained ${key} item`, { max });
  }
  if (!Array.isArray(value.retained_authority.retained_worktrees) || !Array.isArray(value.retained_authority.cleanup_eligible_branches)) throw new CliError("Legacy retained worktree inventory is invalid");
  for (const worktree of value.retained_authority.retained_worktrees) {
    requireExactFields(worktree, { required: ["path", "branch", "revision", "bound_operation_id"] }, "legacy retained worktree");
    absolute(worktree.path, "legacy retained worktree.path");
    if (worktree.branch !== null) requireText(worktree.branch, "legacy retained worktree.branch", { max: 256 });
    if (worktree.revision !== null && !REVISION.test(worktree.revision)) throw new CliError("Legacy retained worktree revision is invalid");
    if (worktree.bound_operation_id !== null) requireText(worktree.bound_operation_id, "legacy retained worktree.bound_operation_id", { max: 96, safeId: true });
  }
  for (const branch of value.retained_authority.cleanup_eligible_branches) {
    requireExactFields(branch, { required: ["operation_id", "branch", "worktree_path"] }, "legacy cleanup-eligible branch");
    requireText(branch.operation_id, "legacy cleanup branch operation", { max: 96, safeId: true }); requireText(branch.branch, "legacy cleanup branch", { max: 256 }); absolute(branch.worktree_path, "legacy cleanup worktree path");
  }
  if (!Array.isArray(value.blockers)) throw new CliError("Legacy retirement blockers must be an array");
  for (const blocker of value.blockers) { requireExactFields(blocker, { required: ["code", "detail"] }, "legacy retirement blocker"); requireText(blocker.code, "legacy retirement blocker.code", { max: 128, safeId: true }); requireText(blocker.detail, "legacy retirement blocker.detail", { max: 512 }); }
}

export function validateLegacyRetirementPlan(value) {
  requireExactFields(value, { required: ["schema_version", "kind", "reason", "planned_at", "repository", "authority", "git_common_evidence", "lifecycle_summary", "retained_authority", "blockers", "applicable", "operations", "retired_directories", "plan_id"] }, "legacy retirement plan");
  if (value.schema_version !== LEGACY_RETIREMENT_SCHEMA_VERSION || value.kind !== LEGACY_RETIREMENT_PLAN_KIND) throw new CliError("Unsupported legacy retirement plan");
  requireText(value.reason, "legacy retirement plan.reason", { max: 512 }); timestamp(value.planned_at, "legacy retirement plan.planned_at");
  requireExactFields(value.repository, { required: ["root", "common_dir", "branch", "revision", "cleanliness"] }, "legacy retirement repository");
  absolute(value.repository.root, "legacy retirement repository.root"); absolute(value.repository.common_dir, "legacy retirement repository.common_dir");
  if (!REVISION.test(value.repository.revision) || !["clean", "dirty"].includes(value.repository.cleanliness)) throw new CliError("Legacy retirement plan has an invalid Git binding");
  validatePlanDetail(value);
  if (typeof value.applicable !== "boolean" || !Array.isArray(value.blockers) || !Array.isArray(value.operations) || !Array.isArray(value.retired_directories)) throw new CliError("Legacy retirement plan has invalid applicability fields");
  const operations = value.operations.map((item, index) => validateOperation(item, `legacy retirement operations[${index}]`));
  if (new Set(operations.map((item) => item.path)).size !== operations.length) throw new CliError("Legacy retirement plan has duplicate operations");
  const retiredDirectories = value.retired_directories.map((path, index) => {
    requireText(path, `legacy retirement retired_directories[${index}]`, { max: 1024 });
    if (!path.startsWith(".codex/orchestration") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new CliError("Legacy retirement plan contains an unsafe retired directory");
    return path;
  });
  if (new Set(retiredDirectories).size !== retiredDirectories.length) throw new CliError("Legacy retirement plan has duplicate retired directories");
  if (!value.applicable && (operations.length !== 0 || retiredDirectories.length !== 0)) throw new CliError("Blocked legacy retirement plans cannot contain retirement actions");
  digest(value.plan_id, "legacy retirement plan.plan_id");
  if (planId(value) !== value.plan_id) throw new CliError("Legacy retirement plan_id does not match plan contents");
  return value;
}

function expectedPaths(plan) {
  const files = Object.keys(plan.authority.manifest.files ?? {}).map((path) => `.codex/orchestration/${safeRelative(path, "manifest file")}`);
  const result = new Set([".codex/orchestration/version.json", ".codex/orchestration/project.json", ...files]);
  if (plan.authority.agents.mode === "managed") result.add("AGENTS.md");
  return result;
}

async function currentPlan(root, plan) {
  return planLegacyRetirement({ repositoryRoot: root, reason: plan.reason, plannedAt: plan.planned_at });
}

async function isAlreadyApplied(root, plan) {
  const snapshot = gitSnapshot(root);
  if (snapshot.branch !== plan.repository.branch || snapshot.revision !== plan.repository.revision) return false;
  const status = gitStatusPaths(root);
  const paths = plan.operations.map((item) => item.path).sort();
  if (stableStringify(status) !== stableStringify(paths)) return false;
  for (const item of plan.operations) {
    const path = target(root, item.path);
    if (item.action === "delete") {
      const info = await lstat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (info !== null) return false;
      continue;
    }
    const bytes = await optionalBytes(root, path, "Retirement replay target");
    if (bytes === null || sha256(bytes) !== item.after_sha256) return false;
  }
  if (plan.authority.agents.mode === "external") {
    const bytes = await optionalBytes(root, target(root, plan.authority.agents.path), "External AGENTS instruction path");
    if (bytes === null || sha256(bytes) !== plan.authority.agents.after_sha256) return false;
  }
  for (const directory of plan.retired_directories) {
    try { await lstat(target(root, directory)); return false; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const state = await rawTree(join(snapshot.commonDir, "codex-flow", "v0.5.1"), "v0.5.1 Git-common evidence");
  return state.exists === plan.git_common_evidence.exists
    && state.file_count === plan.git_common_evidence.file_count
    && state.raw_tree_sha256 === plan.git_common_evidence.raw_tree_sha256;
}

export async function applyLegacyRetirementPlan({ repositoryRoot, plan, hooks = {} }) {
  const root = await canonicalRoot(repositoryRoot);
  const validated = validateLegacyRetirementPlan(plan);
  if (validated.repository.root !== root) throw new CliError("Legacy retirement plan is bound to a different repository root");
  if (!validated.applicable) throw new CliError("Legacy retirement plan is blocked and cannot be applied");
  if (await isAlreadyApplied(root, validated)) return { plan_id: validated.plan_id, status: "already-applied", applied: [] };
  const fresh = await currentPlan(root, validated);
  if (!fresh.applicable || fresh.plan_id !== validated.plan_id) throw new CliError("Legacy retirement plan is stale; regenerate it from current authority");
  const allowed = expectedPaths(validated);
  if (validated.operations.length !== allowed.size || validated.operations.some((item) => !allowed.has(item.path))) throw new CliError("Legacy retirement plan does not cover exactly the owned v0.5.1 authority");
  const original = new Map();
  const originalDirectories = new Set();
  for (const directory of validated.retired_directories) {
    const path = target(root, directory);
    const info = await lstat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new CliError(`Legacy retirement directory is stale at ${directory}`);
    originalDirectories.add(directory);
  }
  for (const item of validated.operations) {
    const path = target(root, item.path); const bytes = await optionalBytes(root, path, "Retirement apply target");
    if (bytes === null || sha256(bytes) !== item.before_sha256) throw new CliError(`Legacy retirement plan is stale at ${item.path}`);
    original.set(item.path, bytes);
  }
  const applied = [];
  const removedDirectories = [];
  try {
    for (const item of validated.operations) {
      const path = target(root, item.path);
      if (item.action === "delete") await rm(path, { force: false });
      else {
        const removed = removeExactAgentsBlock(original.get(item.path).toString("utf8"));
        const output = Buffer.from(removed.value, "utf8");
        if (sha256(output) !== item.after_sha256) throw new CliError(`Legacy retirement AGENTS transformation drifted at ${item.path}`);
        await atomicWrite(path, output, { guardRoot: root });
      }
      applied.push({ path: item.path, action: item.action });
      if (hooks.afterOperation) await hooks.afterOperation({ operation: item, applied: [...applied] });
    }
    for (const directory of validated.retired_directories) {
      await rmdir(target(root, directory));
      removedDirectories.push(directory);
      if (hooks.afterDirectory) await hooks.afterDirectory({ directory, removed_directories: [...removedDirectories] });
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const directory of [...removedDirectories].reverse()) {
      try { await mkdir(target(root, directory), { recursive: true }); } catch (rollback) { rollbackErrors.push(rollback.message); }
    }
    for (const [path, bytes] of [...original.entries()].reverse()) {
      try { await atomicWrite(target(root, path), bytes, { guardRoot: root }); } catch (rollback) { rollbackErrors.push(rollback.message); }
    }
    if (rollbackErrors.length) throw new CliError(`Legacy retirement failed and rollback was incomplete: ${rollbackErrors.join("; ")}`);
    throw error;
  }
  if (!await isAlreadyApplied(root, validated)) throw new CliError("Legacy retirement postcondition did not match the reviewed plan");
  await assertNoTrackedLegacyAuthority(root);
  return { plan_id: validated.plan_id, status: "applied", applied };
}

// Clear aliases for coordinator wiring while retaining the release-qualified names.
export const planLegacyV051Retirement = planLegacyRetirement;
export const applyLegacyV051RetirementPlan = applyLegacyRetirementPlan;
