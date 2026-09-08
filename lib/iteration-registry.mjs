import { spawnSync } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  readJson,
  requireEnum,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState, gitSnapshot } from "./git.mjs";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
  resolvedTaskArchiveAuthority,
  taskArchiveForDisposition,
} from "./archive-lifecycle.mjs";
import { validateDispositionRecord } from "./dispositions.mjs";

export const ITERATION_STATE_DIRECTORY = "iterations-v1";
export const ITERATION_KIND = "codex-flow-v097-iteration";

const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function iterationStateRoot(commonDir) {
  return resolve(commonDir, "codex-flow", ITERATION_STATE_DIRECTORY);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) throw new CliError(`${label} must be an explicit timestamp`);
  return result;
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function nullableText(value, label, options = {}) {
  return value === null ? null : requireText(value, label, options);
}

function authority(value, label) {
  requireExactFields(value, { required: ["kind", "authority_id", "authority_digest", "state_root"] }, label);
  return {
    kind: requireEnum(value.kind, ["assignment", "task-launch"], `${label}.kind`),
    authority_id: requireText(value.authority_id, `${label}.authority_id`, { max: 128, safeId: true }),
    authority_digest: digest(value.authority_digest, `${label}.authority_digest`),
    state_root: resolve(requireText(value.state_root, `${label}.state_root`, { max: 2048 })),
  };
}

function archiveAttempt(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["attempt_id", "state", "started_at", "completed_at", "result_digest", "reason", "branch_tip"],
  }, label);
  const branchTip = value.branch_tip === null
    ? null
    : requireText(value.branch_tip, `${label}.branch_tip`, { max: 64 });
  if (branchTip !== null && !REVISION.test(branchTip)) {
    throw new CliError(`${label}.branch_tip must be a concrete Git revision`);
  }
  return {
    attempt_id: requireText(value.attempt_id, `${label}.attempt_id`, { max: 128, safeId: true }),
    state: requireEnum(value.state, ["prepared", "accepted", "ambiguous", "blocked"], `${label}.state`),
    started_at: timestamp(value.started_at, `${label}.started_at`),
    completed_at: value.completed_at === null ? null : timestamp(value.completed_at, `${label}.completed_at`),
    result_digest: value.result_digest === null ? null : digest(value.result_digest, `${label}.result_digest`),
    reason: nullableText(value.reason, `${label}.reason`, { max: 128, safeId: true }),
    branch_tip: branchTip,
  };
}

function member(value, label) {
  requireExactFields(value, {
    required: [
      "member_id", "role", "host_id", "thread_id", "provisional_id", "reporting_parent_thread_id",
      "retained", "authority", "requested_title", "observed_title", "worktree_path", "branch",
      "state", "archive_attempt", "registered_at", "updated_at",
    ],
  }, label);
  const record = {
    member_id: requireText(value.member_id, `${label}.member_id`, { max: 128, safeId: true }),
    role: requireEnum(value.role, ["director", "coordinator", "executor"], `${label}.role`),
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    thread_id: nullableText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    provisional_id: nullableText(value.provisional_id, `${label}.provisional_id`, { max: 256 }),
    reporting_parent_thread_id: nullableText(value.reporting_parent_thread_id, `${label}.reporting_parent_thread_id`, { max: 256, safeId: true }),
    retained: value.retained,
    authority: authority(value.authority, `${label}.authority`),
    requested_title: nullableText(value.requested_title, `${label}.requested_title`, { max: 120 }),
    observed_title: nullableText(value.observed_title, `${label}.observed_title`, { max: 160 }),
    worktree_path: nullableText(value.worktree_path, `${label}.worktree_path`, { max: 2048 }),
    branch: nullableText(value.branch, `${label}.branch`, { max: 256 }),
    state: requireEnum(value.state, ["registered", "accepted", "archive-pending", "archived", "retained"], `${label}.state`),
    archive_attempt: archiveAttempt(value.archive_attempt, `${label}.archive_attempt`),
    registered_at: timestamp(value.registered_at, `${label}.registered_at`),
    updated_at: timestamp(value.updated_at, `${label}.updated_at`),
  };
  if (typeof record.retained !== "boolean") throw new CliError(`${label}.retained must be boolean`);
  if ((record.thread_id === null) === (record.provisional_id === null)) {
    throw new CliError(`${label} must have exactly one ready or provisional host identity`);
  }
  if ((record.state === "retained") !== record.retained) throw new CliError(`${label} retained state is inconsistent`);
  if (["archive-pending", "archived"].includes(record.state) && record.archive_attempt?.state !== "accepted") {
    throw new CliError(`${label} archive state requires an accepted native attempt`);
  }
  const expectedId = `iteration-member-v1-${sha256(stableStringify({
    role: record.role,
    host_id: record.host_id,
    authority: record.authority,
  }))}`;
  if (record.member_id !== expectedId) throw new CliError(`${label}.member_id does not match its authority`);
  return record;
}

function iterationSeed(value) {
  return {
    assignment_id: value.assignment_id,
    label: value.label,
    members: value.members,
    state: value.state,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function validateIterationRecord(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "iteration_id", "assignment_id", "label", "members", "state", "created_at", "updated_at", "record_digest"],
  }, "iteration record");
  if (value.schema_version !== 1 || value.kind !== ITERATION_KIND) throw new CliError("Unsupported iteration record");
  if (!Array.isArray(value.members) || value.members.length < 2 || value.members.length > 256) {
    throw new CliError("iteration members must contain between 2 and 256 entries");
  }
  const record = {
    schema_version: 1,
    kind: ITERATION_KIND,
    iteration_id: requireText(value.iteration_id, "iteration_id", { max: 128, safeId: true }),
    assignment_id: requireText(value.assignment_id, "assignment_id", { max: 128, safeId: true }),
    label: requireText(value.label, "label", { max: 80 }),
    members: value.members.map((entry, index) => member(entry, `members[${index}]`)).sort((left, right) => left.member_id.localeCompare(right.member_id)),
    state: requireEnum(value.state, ["open", "accepted", "closeout-pending", "closed", "cancelled"], "state"),
    created_at: timestamp(value.created_at, "created_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  };
  if (record.iteration_id !== `iteration-v1-${sha256(record.assignment_id)}`) throw new CliError("iteration_id does not match assignment_id");
  if (new Set(record.members.map((entry) => entry.member_id)).size !== record.members.length) throw new CliError("iteration contains duplicate members");
  if (record.members.filter((entry) => entry.role === "director").length !== 1 || record.members.filter((entry) => entry.role === "coordinator").length !== 1) {
    throw new CliError("iteration requires one director and one coordinator");
  }
  const recordDigest = digest(value.record_digest, "record_digest");
  if (recordDigest !== sha256(stableStringify(iterationSeed(record)))) throw new CliError("iteration record_digest does not match its state");
  return { ...record, record_digest: recordDigest };
}

function withDigest(value) {
  const normalized = { ...value, members: [...value.members].sort((left, right) => left.member_id.localeCompare(right.member_id)) };
  return validateIterationRecord({ ...normalized, record_digest: sha256(stableStringify(iterationSeed(normalized))) });
}

function paths(stateRoot, iterationId) {
  const id = requireText(iterationId, "iteration_id", { max: 128, safeId: true });
  const records = resolve(stateRoot, "records");
  const record = resolve(records, `${id}.json`);
  if (dirname(record) !== records || basename(record) !== `${id}.json`) throw new CliError("Unsafe iteration path");
  return { record, lock: resolve(stateRoot, "locks", `${id}.lock.json`) };
}

function titlePart(value, fallback) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "" ? fallback : normalized;
}

export function iterationTitle(role, label, purpose) {
  const title = `${titlePart(role, "Task")} · ${titlePart(label, "Iteration")} · ${titlePart(purpose, "Work")}`;
  return title.length <= 120 ? title : `${title.slice(0, 119).trimEnd()}…`;
}

function memberFor({ role, hostId, threadId, provisionalId = null, parentThreadId = null, retained, authority: memberAuthority, requestedTitle = null, observedTitle = null, worktreePath = null, branch = null, now }) {
  const normalizedAuthority = authority(memberAuthority, "member authority");
  const timestampValue = new Date(now).toISOString();
  return member({
    member_id: `iteration-member-v1-${sha256(stableStringify({ role, host_id: hostId, authority: normalizedAuthority }))}`,
    role,
    host_id: hostId,
    thread_id: threadId,
    provisional_id: provisionalId,
    reporting_parent_thread_id: parentThreadId,
    retained,
    authority: normalizedAuthority,
    requested_title: requestedTitle,
    observed_title: observedTitle,
    worktree_path: worktreePath,
    branch,
    state: retained ? "retained" : "registered",
    archive_attempt: null,
    registered_at: timestampValue,
    updated_at: timestampValue,
  }, "member");
}

function assignmentMemberIdentity(value) {
  return {
    member_id: value.member_id,
    role: value.role,
    host_id: value.host_id,
    thread_id: value.thread_id,
    provisional_id: value.provisional_id,
    reporting_parent_thread_id: value.reporting_parent_thread_id,
    retained: value.retained,
    authority: value.authority,
    requested_title: value.requested_title,
    worktree_path: value.worktree_path,
    branch: value.branch,
  };
}

export async function createIterationForAssignment({ assignment, assignmentStateRoot, now = Date.now() }) {
  const stateRoot = iterationStateRoot(assignment.common_dir);
  const director = memberFor({
    role: "director", hostId: assignment.recipient.host_id, threadId: assignment.recipient.thread_id,
    retained: true,
    authority: { kind: "assignment", authority_id: assignment.assignment_id, authority_digest: sha256(stableStringify(assignment)), state_root: assignmentStateRoot },
    now,
  });
  const coordinator = memberFor({
    role: "coordinator", hostId: assignment.sender.host_id, threadId: assignment.sender.thread_id,
    parentThreadId: assignment.recipient.thread_id, retained: false,
    authority: { kind: "assignment", authority_id: assignment.assignment_id, authority_digest: sha256(stableStringify(assignment)), state_root: assignmentStateRoot },
    requestedTitle: iterationTitle("Coordinator", assignment.iteration_label, assignment.purpose),
    worktreePath: assignment.execution_bindings[0].repository_root,
    branch: assignment.execution_bindings[0].repository_branch,
    now,
  });
  const createdAt = new Date(now).toISOString();
  const record = withDigest({
    schema_version: 1, kind: ITERATION_KIND, iteration_id: assignment.iteration_id,
    assignment_id: assignment.assignment_id, label: assignment.iteration_label,
    members: [director, coordinator], state: "open", created_at: createdAt, updated_at: createdAt,
  });
  const location = paths(stateRoot, record.iteration_id);
  return withProcessLock({ path: location.lock, guardRoot: assignment.common_dir, label: `iteration ${record.iteration_id}` }, async () => {
    const existing = await readJson(location.record, { allowMissing: true, guardRoot: assignment.common_dir });
    if (existing !== null) {
      const validated = validateIterationRecord(existing);
      const expectedMembers = new Map(record.members.map((entry) => [entry.member_id, entry]));
      const existingMembers = new Map(validated.members.map((entry) => [entry.member_id, entry]));
      const assignmentMembersMatch = [...expectedMembers].every(([memberId, expected]) => {
        const current = existingMembers.get(memberId);
        return current !== undefined
          && stableStringify(assignmentMemberIdentity(current))
            === stableStringify(assignmentMemberIdentity(expected));
      });
      if (
        validated.assignment_id !== record.assignment_id
        || validated.label !== record.label
        || !assignmentMembersMatch
      ) throw new CliError("Existing iteration conflicts with assignment authority", 73);
      return validated;
    }
    await atomicWriteJson(location.record, record, { guardRoot: assignment.common_dir, mode: 0o600 });
    return record;
  });
}

export async function iterationStatus({ commonDir, iterationId }) {
  const stateRoot = iterationStateRoot(commonDir);
  return validateIterationRecord(await readJson(paths(stateRoot, iterationId).record, { guardRoot: commonDir }));
}

async function updateIteration(commonDir, iterationId, operation) {
  const stateRoot = iterationStateRoot(commonDir);
  const location = paths(stateRoot, iterationId);
  return withProcessLock({ path: location.lock, guardRoot: commonDir, label: `iteration ${iterationId}` }, async () => {
    const current = validateIterationRecord(await readJson(location.record, { guardRoot: commonDir }));
    const next = withDigest(await operation(current));
    await atomicWriteJson(location.record, next, { guardRoot: commonDir, mode: 0o600 });
    return next;
  });
}

export async function registerExecutorIterationMember({ assignment, launch, stateRoot, now = Date.now() }) {
  if (launch.coordinator_binding.thread_id !== assignment.sender.thread_id) throw new CliError("Executor launch does not belong to assignment coordinator", 73);
  const requestedTitle = iterationTitle("Executor", assignment.iteration_label, assignment.purpose);
  if (launch.task_title !== requestedTitle) {
    throw new CliError("Executor launch title does not match its assignment iteration", 73);
  }
  const threadId = launch.start_claim?.executor_thread_id ?? launch.creation_evidence?.ready_thread_id ?? null;
  const provisionalId = threadId === null ? launch.creation_evidence?.provisional_id ?? null : null;
  if (threadId === null && provisionalId === null) return iterationStatus({ commonDir: assignment.common_dir, iterationId: assignment.iteration_id });
  return updateIteration(assignment.common_dir, assignment.iteration_id, async (current) => {
    const authorityValue = { kind: "task-launch", authority_id: launch.launch_id, authority_digest: sha256(stableStringify(launch)), state_root: stateRoot };
    const candidate = memberFor({
      role: "executor", hostId: launch.creation_evidence?.host_id ?? assignment.sender.host_id,
      threadId, provisionalId, parentThreadId: assignment.sender.thread_id, retained: false,
      authority: authorityValue, requestedTitle: launch.task_title,
      observedTitle: null,
      worktreePath: launch.git_activation?.worktree_path ?? launch.selector_evidence.requested.worktree.path,
      branch: launch.git_activation?.executor_branch ?? launch.selector_evidence.requested.worktree.executor_branch,
      now,
    });
    const index = current.members.findIndex((entry) => entry.member_id === candidate.member_id);
    if (index < 0) return { ...current, members: [...current.members, candidate], updated_at: new Date(now).toISOString() };
    const existing = current.members[index];
    if (existing.thread_id !== null && threadId !== null && existing.thread_id !== threadId) throw new CliError("Iteration executor identity conflicts", 73);
    const updated = { ...existing, thread_id: threadId ?? existing.thread_id, provisional_id: threadId === null ? provisionalId : null, authority: authorityValue, worktree_path: candidate.worktree_path ?? existing.worktree_path, branch: candidate.branch, updated_at: new Date(now).toISOString() };
    const members = [...current.members]; members[index] = member(updated, "member");
    return { ...current, members, updated_at: new Date(now).toISOString() };
  });
}

async function dispositionsForMember(memberRecord) {
  if (memberRecord.role !== "executor") return [];
  const directory = resolve(memberRecord.authority.state_root, "dispositions", "records");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateDispositionRecord(await readJson(resolve(directory, entry.name), { guardRoot: gitCommonDirectoryForState(memberRecord.authority.state_root) }));
    if (record.launch_id === memberRecord.authority.authority_id) result.push(record);
  }
  return result;
}

async function assertMemberEligible(memberRecord, allowCoordinator) {
  if (memberRecord.retained) return { status: "retained", authority: null };
  if (memberRecord.thread_id === null) throw new CliError("Provisional iteration membership cannot authorize archival", 73);
  if (memberRecord.role === "coordinator") {
    if (!allowCoordinator) return { status: "deferred", authority: null };
    return { status: "eligible", authority: null };
  }
  const dispositions = await dispositionsForMember(memberRecord);
  if (dispositions.length !== 1) throw new CliError("Executor closeout requires one exact disposition", 73);
  const disposition = dispositions[0];
  if (disposition.state !== "completed" || !["accepted-no-change", "accepted-for-integration"].includes(disposition.decision) || disposition.verification_id === null) {
    throw new CliError("Executor closeout requires accepted verified work", 73);
  }
  const archiveAuthority = await resolvedTaskArchiveAuthority(
    memberRecord.authority.state_root,
    disposition.disposition_id,
  );
  if (
    archiveAuthority.launch.launch_id !== memberRecord.authority.authority_id
    || archiveAuthority.launch.start_claim?.executor_thread_id !== memberRecord.thread_id
    || archiveAuthority.launch.git_activation?.worktree_path !== memberRecord.worktree_path
    || archiveAuthority.launch.selector_evidence.requested.worktree.executor_branch !== memberRecord.branch
  ) throw new CliError("Executor iteration membership conflicts with its exact cleanup authority", 73);
  return { status: "eligible", authority: archiveAuthority };
}

async function pathExists(path) {
  if (path === null) return false;
  return lstat(path).then(() => true, (error) => { if (error?.code === "ENOENT") return false; throw error; });
}

function reclamationAuthority(memberRecord) {
  if (
    memberRecord.retained
    || memberRecord.thread_id === null
    || memberRecord.worktree_path === null
    || memberRecord.state !== "archive-pending"
    || memberRecord.archive_attempt?.state !== "accepted"
    || memberRecord.archive_attempt.branch_tip === null
  ) throw new CliError("Iteration member lacks persisted exact worktree reclamation authority", 73);
  return {
    member_id: memberRecord.member_id,
    thread_id: memberRecord.thread_id,
    authority: memberRecord.authority,
    worktree_path: resolve(memberRecord.worktree_path),
    branch: memberRecord.branch,
    archive_attempt_id: memberRecord.archive_attempt.attempt_id,
    branch_tip: memberRecord.archive_attempt.branch_tip,
  };
}

function sameReclamationAuthority(left, right) {
  return stableStringify(reclamationAuthority(left)) === stableStringify(reclamationAuthority(right));
}

function runGit(commonDir, args, label, allowedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: commonDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (!allowedStatuses.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || label, 73);
  }
  return result;
}

function attachedWorktreeRefs(commonDir) {
  const result = runGit(
    commonDir,
    ["worktree", "list", "--porcelain", "-z"],
    "Unable to inspect iteration worktrees",
  );
  return result.stdout.split("\0").filter((field) => field.startsWith("branch ")).map(
    (field) => field.slice("branch ".length),
  );
}

function worktreeInventory(commonDir) {
  const result = runGit(
    commonDir,
    ["worktree", "list", "--porcelain", "-z"],
    "Unable to inspect iteration worktrees",
  );
  const records = [];
  let current = null;
  for (const field of result.stdout.split("\0").filter(Boolean)) {
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
    if (current === null) throw new CliError("Iteration worktree inventory is malformed", 73);
    if (field.startsWith("HEAD ")) current.head = field.slice("HEAD ".length);
    else if (field.startsWith("branch refs/heads/")) current.branch = field.slice("branch refs/heads/".length);
    else if (field === "bare") current.bare = true;
    else if (field === "detached") current.detached = true;
    else if (field === "locked" || field.startsWith("locked ")) current.locked = true;
    else if (field === "prunable" || field.startsWith("prunable ")) current.prunable = true;
  }
  if (current !== null) records.push(current);
  if (records.length === 0 || records[0].head === null) {
    throw new CliError("Iteration repository has no authenticated source checkout", 73);
  }
  return records;
}

async function codexWorktreeOwnerThread(commonDir, worktreePath) {
  const gitDir = runGit(
    worktreePath,
    ["rev-parse", "--path-format=absolute", "--git-dir"],
    "Unable to inspect iteration worktree administration",
  ).stdout.trim();
  const metadata = await readJson(resolve(gitDir, "codex-thread.json"), {
    allowMissing: true,
    guardRoot: commonDir,
  });
  if (metadata === null) return null;
  requireExactFields(metadata, { required: ["version", "ownerThreadId"] }, "Codex worktree owner metadata");
  if (metadata.version !== 1) throw new CliError("Codex worktree owner metadata has an unsupported version", 73);
  return requireText(metadata.ownerThreadId, "Codex worktree owner thread", { max: 256, safeId: true });
}

async function assertNoIterationAttachmentAfterAbsence(commonDir, memberRecord, expectedTip) {
  const inventory = worktreeInventory(commonDir);
  for (const entry of inventory.slice(1)) {
    // A prunable record has no live checkout from which to authenticate Codex
    // ownership, and cannot be the moved attachment this guard is looking for.
    if (entry.prunable) continue;
    const owner = await codexWorktreeOwnerThread(commonDir, entry.path);
    if (owner === memberRecord.thread_id) {
      throw new CliError("Iteration worktree owner remains attached at an unexpected path", 73);
    }
    if (memberRecord.branch === "detached" && entry.detached && entry.head === expectedTip) {
      throw new CliError("Detached iteration worktree remains attached at an ambiguous path", 73);
    }
  }
}

async function assertExclusiveIterationWorktree(commonDir, iterationId, memberRecord) {
  const target = await realpath(memberRecord.worktree_path).catch(() => null);
  if (target === null) throw new CliError("Iteration worktree path is absent at reclamation", 73);
  const directory = resolve(iterationStateRoot(commonDir), "records");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new CliError("Iteration cleanup authority is unavailable", 73);
    throw error;
  }
  let exactMemberships = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateIterationRecord(await readJson(resolve(directory, entry.name), {
      guardRoot: commonDir,
    }));
    for (const candidate of record.members) {
      if (candidate.worktree_path === null) continue;
      const candidatePath = await realpath(candidate.worktree_path).catch(() => resolve(candidate.worktree_path));
      if (candidatePath !== target) continue;
      if (record.iteration_id === iterationId && candidate.member_id === memberRecord.member_id) {
        exactMemberships += 1;
        continue;
      }
      throw new CliError("Iteration worktree is shared by another persisted member", 73);
    }
  }
  if (exactMemberships !== 1) throw new CliError("Iteration worktree ownership is missing or ambiguous", 73);
}

function revisionIsAncestor(commonDir, ancestor, descendant) {
  const result = runGit(
    commonDir,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    "Unable to inspect coordinator preservation",
    [0, 1],
  );
  return result.status === 0;
}

function callerRepositoryRoot(commonDir) {
  try {
    const caller = gitSnapshot(process.cwd());
    return resolve(caller.commonDir) === resolve(commonDir) ? resolve(caller.root) : null;
  } catch {
    return null;
  }
}

async function authenticatedPrimaryWorktree(commonDir, inventory) {
  const primary = inventory[0];
  const canonicalPath = await realpath(primary.path).catch(() => null);
  if (
    canonicalPath === null
    || primary.bare
    || primary.locked
    || primary.prunable
    || primary.head === null
  ) throw new CliError("Iteration source checkout is not an authenticated live worktree", 73);
  const snapshot = gitSnapshot(canonicalPath);
  if (
    resolve(snapshot.root) !== resolve(canonicalPath)
    || resolve(snapshot.commonDir) !== resolve(commonDir)
    || snapshot.revision !== primary.head
  ) throw new CliError("Iteration source checkout drifted from its Git inventory", 73);
  return { ...primary, path: canonicalPath };
}

async function coordinatorGitAuthority(commonDir, memberRecord) {
  const registeredDetached = memberRecord.branch === "detached";
  if (
    memberRecord.worktree_path === null
    || memberRecord.branch === null
    || (!registeredDetached && !memberRecord.branch.startsWith("codex/"))
  ) throw new CliError("Coordinator closeout requires an exact disposable Codex worktree", 73);
  const inventory = worktreeInventory(commonDir);
  const primary = await authenticatedPrimaryWorktree(commonDir, inventory);
  const memberPath = await realpath(memberRecord.worktree_path).catch(() => null);
  if (memberPath === null) throw new CliError("Coordinator worktree is absent before native archival", 73);
  const protectedPaths = new Set([resolve(primary.path), callerRepositoryRoot(commonDir)].filter(Boolean));
  if (protectedPaths.has(resolve(memberPath))) {
    throw new CliError("Coordinator closeout refuses a caller or source checkout", 73);
  }
  const matches = inventory.filter((entry) => resolve(entry.path) === resolve(memberPath));
  if (matches.length !== 1) throw new CliError("Coordinator worktree ownership is ambiguous", 73);
  const owned = matches[0];
  if (
    owned.bare
    || owned.locked
    || owned.prunable
    || owned.head === null
    || (registeredDetached
      ? !owned.detached || owned.branch !== null
      : owned.detached || owned.branch !== memberRecord.branch)
  ) throw new CliError("Coordinator worktree is not an eligible linked task worktree", 73);
  const snapshot = gitSnapshot(memberPath);
  if (
    resolve(snapshot.root) !== resolve(memberPath)
    || resolve(snapshot.commonDir) !== resolve(commonDir)
    || snapshot.branch !== (registeredDetached ? "detached" : memberRecord.branch)
    || snapshot.revision !== owned.head
    || snapshot.cleanliness !== "clean"
  ) throw new CliError("Coordinator worktree does not match its cleanup authority", 73);
  if (!revisionIsAncestor(commonDir, owned.head, primary.head)) {
    throw new CliError("Coordinator work is not preserved in the source checkout", 73);
  }
  return owned.head;
}

async function archivedCoordinatorGitAuthority(commonDir, memberRecord) {
  const registeredDetached = memberRecord.branch === "detached";
  if (
    memberRecord.worktree_path === null
    || memberRecord.branch === null
    || (!registeredDetached && !memberRecord.branch.startsWith("codex/"))
  ) throw new CliError("Coordinator closeout requires an exact disposable Codex worktree", 73);
  const inventory = worktreeInventory(commonDir);
  const primary = await authenticatedPrimaryWorktree(commonDir, inventory);
  const memberPath = resolve(memberRecord.worktree_path);
  const protectedPaths = new Set([resolve(primary.path), callerRepositoryRoot(commonDir)].filter(Boolean));
  if (protectedPaths.has(memberPath)) {
    throw new CliError("Coordinator closeout refuses a caller or source checkout", 73);
  }
  if (inventory.some((entry) => resolve(entry.path) === memberPath)) {
    throw new CliError("Coordinator worktree remains registered after archival", 73);
  }
  if (registeredDetached) {
    const capturedTip = memberRecord.archive_attempt?.branch_tip ?? null;
    if (capturedTip === null) {
      throw new CliError("Detached coordinator archival lacks an authenticated captured tip", 73);
    }
    if (!revisionIsAncestor(commonDir, capturedTip, primary.head)) {
      throw new CliError("Coordinator work is not preserved in the source checkout", 73);
    }
    return capturedTip;
  }
  const ref = `refs/heads/${memberRecord.branch}`;
  if (attachedWorktreeRefs(commonDir).includes(ref)) {
    throw new CliError("Coordinator branch remains attached after archival", 73);
  }
  const tip = localBranchTip(commonDir, ref);
  if (tip === null || !revisionIsAncestor(commonDir, tip, primary.head)) {
    throw new CliError("Coordinator work is not preserved in the source checkout", 73);
  }
  return tip;
}

async function assertIterationTipPreserved(
  commonDir,
  memberRecord,
  expectedTip,
  archiveAuthority = null,
) {
  const primary = await authenticatedPrimaryWorktree(commonDir, worktreeInventory(commonDir));
  const exactIntegration = archiveAuthority?.integrationPreservation ?? null;
  const preservedByAuthenticatedIntegration = memberRecord.role === "executor"
    && exactIntegration?.outcome === "patch-equivalent"
    && exactIntegration.executor_tip === expectedTip
    && revisionIsAncestor(commonDir, exactIntegration.reconciled_main_tip, primary.head);
  if (
    !revisionIsAncestor(commonDir, expectedTip, primary.head)
    && !preservedByAuthenticatedIntegration
  ) {
    throw new CliError("Iteration work is no longer preserved in the source checkout", 73);
  }
  if (resolve(memberRecord.worktree_path) === resolve(primary.path)) {
    throw new CliError("Iteration cleanup refuses the source checkout", 73);
  }
}

async function reclaimableIterationWorktree({
  commonDir,
  iterationId,
  memberRecord,
  archiveAuthority,
}) {
  const persisted = reclamationAuthority(memberRecord);
  const inventory = worktreeInventory(commonDir);
  const primary = await authenticatedPrimaryWorktree(commonDir, inventory);
  const memberPath = await realpath(persisted.worktree_path).catch(() => null);
  if (memberPath === null) throw new CliError("Iteration worktree path is absent at reclamation", 73);
  const callerPath = callerRepositoryRoot(commonDir);
  const canonicalCaller = callerPath === null ? null : await realpath(callerPath).catch(() => resolve(callerPath));
  const protectedPaths = new Set([resolve(primary.path), canonicalCaller].filter(Boolean));
  if (protectedPaths.has(resolve(memberPath))) {
    throw new CliError("Iteration reclamation refuses a caller or source checkout", 73);
  }
  await assertExclusiveIterationWorktree(commonDir, iterationId, memberRecord);
  const matches = [];
  for (const entry of inventory) {
    const canonicalEntry = await realpath(entry.path).catch(() => resolve(entry.path));
    if (canonicalEntry === resolve(memberPath)) matches.push(entry);
  }
  if (matches.length !== 1) throw new CliError("Iteration worktree attachment is missing or ambiguous", 73);
  const owned = matches[0];
  const registeredDetached = memberRecord.branch === "detached";
  if (
    owned.bare
    || owned.locked
    || owned.prunable
    || owned.head === null
    || (registeredDetached
      ? !owned.detached || owned.branch !== null
      : owned.detached || owned.branch !== memberRecord.branch)
  ) throw new CliError("Iteration worktree attachment drifted before reclamation", 73);
  const snapshot = gitSnapshot(memberPath);
  if (
    resolve(snapshot.root) !== resolve(memberPath)
    || resolve(snapshot.commonDir) !== resolve(commonDir)
    || snapshot.branch !== (registeredDetached ? "detached" : memberRecord.branch)
    || snapshot.revision !== owned.head
    || snapshot.revision !== persisted.branch_tip
    || snapshot.cleanliness !== "clean"
  ) throw new CliError("Iteration worktree changed after cleanup authority was persisted", 73);
  const ownerThreadId = await codexWorktreeOwnerThread(commonDir, memberPath);
  if (ownerThreadId !== null && ownerThreadId !== memberRecord.thread_id) {
    throw new CliError("Iteration worktree is owned by another Codex task", 73);
  }
  if (memberRecord.role === "executor" && executorExpectedTip(archiveAuthority) !== persisted.branch_tip) {
    throw new CliError("Executor worktree conflicts with its accepted result authority", 73);
  }
  await assertIterationTipPreserved(
    commonDir,
    memberRecord,
    persisted.branch_tip,
    archiveAuthority,
  );
  return { path: memberPath, primary_path: primary.path, expected_tip: persisted.branch_tip };
}

function removeIterationWorktree({ primaryPath, worktreePath }) {
  runGit(
    primaryPath,
    ["worktree", "remove", worktreePath],
    "Unable to remove the exact iteration worktree without force",
  );
}

async function reclaimAcceptedIterationMember({
  commonDir,
  iterationId,
  memberRecord,
  archiveAuthority,
  observeArchivedThread,
  removeWorktree,
}) {
  if (!(await pathExists(memberRecord.worktree_path))) {
    return cleanupIterationGit(
      commonDir,
      memberRecord,
      memberRecord.archive_attempt.branch_tip,
      archiveAuthority,
    );
  }
  if (observeArchivedThread === null) return false;
  let observation;
  try {
    observation = await observeArchivedThread({ threadId: memberRecord.thread_id });
  } catch {
    return false;
  }
  if (observation?.thread_id !== memberRecord.thread_id) {
    throw new CliError("Archive observation does not match the iteration member", 73);
  }
  return withProcessLock({
    path: paths(iterationStateRoot(commonDir), iterationId).lock,
    guardRoot: commonDir,
    label: `iteration reclamation ${iterationId}`,
  }, async () => {
    const current = validateIterationRecord(await readJson(
      paths(iterationStateRoot(commonDir), iterationId).record,
      { guardRoot: commonDir },
    ));
    const persisted = current.members.find((entry) => entry.member_id === memberRecord.member_id);
    if (persisted === undefined || !sameReclamationAuthority(persisted, memberRecord)) {
      throw new CliError("Iteration worktree reclamation authority changed before mutation", 73);
    }
    if (!(await pathExists(persisted.worktree_path))) {
      return cleanupIterationGit(
        commonDir,
        persisted,
        persisted.archive_attempt.branch_tip,
        archiveAuthority,
      );
    }
    const reclaimable = await reclaimableIterationWorktree({
      commonDir,
      iterationId,
      memberRecord: persisted,
      archiveAuthority,
    });
    await removeWorktree({
      commonDir,
      primaryPath: reclaimable.primary_path,
      worktreePath: reclaimable.path,
      member: persisted,
    });
    if (
      await pathExists(reclaimable.path)
      || worktreeInventory(commonDir).some((entry) => resolve(entry.path) === resolve(reclaimable.path))
    ) throw new CliError("Iteration worktree remains after non-force reclamation", 73);
    return cleanupIterationGit(commonDir, persisted, reclaimable.expected_tip, archiveAuthority);
  });
}

function localBranchTip(commonDir, ref) {
  const result = runGit(
    commonDir,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    "Unable to inspect iteration branch",
    [0, 128],
  );
  return result.status === 128 ? null : result.stdout.trim();
}

function executorExpectedTip(archiveAuthority) {
  const outcome = archiveAuthority.callback.receipt.git_outcome;
  return outcome.kind === "unchanged" ? outcome.final_revision : outcome.commit;
}

async function captureBranchTip(commonDir, memberRecord, archiveAuthority) {
  if (memberRecord.role === "coordinator") {
    return coordinatorGitAuthority(commonDir, memberRecord);
  }
  if (
    memberRecord.role === "executor"
    && resolve(archiveAuthority.launch.common_dir) !== resolve(commonDir)
  ) throw new CliError("Executor cleanup authority belongs to another repository", 73);
  const ref = `refs/heads/${memberRecord.branch}`;
  const authorityTip = memberRecord.role === "executor" ? executorExpectedTip(archiveAuthority) : null;
  if (await pathExists(memberRecord.worktree_path)) {
    const snapshot = gitSnapshot(memberRecord.worktree_path);
    if (
      resolve(snapshot.commonDir) !== resolve(commonDir)
      || snapshot.cleanliness !== "clean"
      || snapshot.branch !== memberRecord.branch
      || (authorityTip !== null && snapshot.revision !== authorityTip)
    ) throw new CliError("Iteration worktree does not match its exact cleanup authority", 73);
    if (memberRecord.branch === null || memberRecord.branch === "detached") return null;
    return snapshot.revision;
  }
  if (memberRecord.branch === null || memberRecord.branch === "detached") return null;
  const tip = localBranchTip(commonDir, ref);
  if (authorityTip !== null && tip !== null && tip !== authorityTip) {
    throw new CliError("Executor branch changed before iteration archival", 73);
  }
  return authorityTip ?? tip;
}

async function cleanupIterationGit(
  commonDir,
  memberRecord,
  expectedTip,
  archiveAuthority = null,
) {
  if (await pathExists(memberRecord.worktree_path)) return false;
  if (expectedTip === null && memberRecord.role === "coordinator") {
    throw new CliError("Coordinator cleanup lacks an authenticated captured tip", 73);
  }
  await assertNoIterationAttachmentAfterAbsence(commonDir, memberRecord, expectedTip);
  if (expectedTip !== null) {
    await assertIterationTipPreserved(
      commonDir,
      memberRecord,
      expectedTip,
      archiveAuthority,
    );
  }
  if (memberRecord.branch === null || memberRecord.branch === "detached" || expectedTip === null) return true;
  // Assignment closeout owns disposable Codex task branches, never source branches.
  if (!memberRecord.branch.startsWith("codex/")) return true;
  const ref = `refs/heads/${memberRecord.branch}`;
  if (attachedWorktreeRefs(commonDir).includes(ref)) {
    throw new CliError("Iteration branch remains attached after task archival", 73);
  }
  const tip = localBranchTip(commonDir, ref);
  if (tip === null) return true;
  if (tip !== expectedTip) throw new CliError("Iteration branch changed before cleanup", 73);
  runGit(
    commonDir,
    ["update-ref", "-d", ref, expectedTip],
    "Unable to delete the exact iteration branch",
  );
  if (localBranchTip(commonDir, ref) !== null) {
    throw new CliError("Iteration branch still exists after cleanup", 73);
  }
  return true;
}

function closeoutTaskObservation(value, expectedThreadId) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "execution_kind", "thread_id", "source", "active_visible", "archived_visible",
    ],
    optional: ["host_evidence_digest", "observed_at"],
  }, "iteration closeout task observation");
  if (
    value.execution_kind !== "task-thread"
    || value.thread_id !== expectedThreadId
    || typeof value.active_visible !== "boolean"
    || typeof value.archived_visible !== "boolean"
    || value.active_visible === value.archived_visible
  ) throw new CliError("Iteration closeout observation does not match the exact task", 73);
  return value;
}

function closeoutHostResult(value, expectedThreadId, expectedAttemptId) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["attempt_id", "thread_id", "outcome"],
    optional: ["reason", "error_code"],
  }, "iteration closeout host result");
  const result = {
    attempt_id: requireText(value.attempt_id, "host_result.attempt_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "host_result.thread_id", { max: 256, safeId: true }),
    outcome: requireEnum(
      value.outcome,
      ["accepted", "rejected-before-send", "ambiguous"],
      "host_result.outcome",
    ),
    reason: value.reason === undefined
      ? null
      : requireText(value.reason, "host_result.reason", { max: 128, safeId: true }),
    error_code: value.error_code === undefined
      ? null
      : requireText(value.error_code, "host_result.error_code", { max: 128, safeId: true }),
  };
  if (result.thread_id !== expectedThreadId || result.attempt_id !== expectedAttemptId) {
    throw new CliError("Host result does not match the prepared iteration archive action", 73);
  }
  return result;
}

function iterationArchiveAttemptId(iterationId, memberId) {
  return `iteration-archive-attempt-v1-${sha256(stableStringify({
    iteration_id: iterationId,
    member_id: memberId,
  }))}`;
}

function iterationHostRequest(memberRecord, attemptId) {
  return {
    action: "set-thread-archived",
    attempt_id: attemptId,
    thread_id: memberRecord.thread_id,
    host_id: memberRecord.host_id,
    archived: true,
  };
}

async function updateMemberArchiveAttempt({
  commonDir,
  iterationId,
  memberId,
  attempt,
  state,
  now,
}) {
  const updatedAt = new Date(now).toISOString();
  return updateIteration(commonDir, iterationId, async (record) => ({
    ...record,
    state: "closeout-pending",
    members: record.members.map((entry) => entry.member_id === memberId ? {
      ...entry,
      state,
      archive_attempt: attempt,
      updated_at: updatedAt,
    } : entry),
    updated_at: updatedAt,
  }));
}

async function observeExactArchive(observeArchivedThread, candidate, suppliedObservation) {
  if (suppliedObservation?.archived_visible === true) return suppliedObservation;
  if (observeArchivedThread === null) return null;
  try {
    return closeoutTaskObservation(
      await observeArchivedThread({ threadId: candidate.thread_id }),
      candidate.thread_id,
    );
  } catch {
    return null;
  }
}

function nextCloseoutCandidate(iteration, allowCoordinator) {
  const executor = iteration.members.find((entry) => (
    entry.role === "executor" && !entry.retained && entry.state !== "archived"
  ));
  if (executor) return executor;
  if (!allowCoordinator) return null;
  return iteration.members.find((entry) => (
    entry.role === "coordinator" && !entry.retained && entry.state !== "archived"
  )) ?? null;
}

async function finishOwningHostMember({
  commonDir,
  iterationId,
  current,
  candidate,
  authority,
  observation,
  removeWorktree,
  now,
}) {
  const acceptedAttempt = {
    ...candidate.archive_attempt,
    state: "accepted",
    completed_at: candidate.archive_attempt.completed_at ?? new Date(now).toISOString(),
    reason: candidate.archive_attempt.reason === "host-outcome-ambiguous"
      ? "host-archive-observed"
      : candidate.archive_attempt.reason,
  };
  current = await updateMemberArchiveAttempt({
    commonDir,
    iterationId,
    memberId: candidate.member_id,
    attempt: acceptedAttempt,
    state: "archive-pending",
    now,
  });
  const persisted = current.members.find((entry) => entry.member_id === candidate.member_id);
  const reclaimed = await reclaimAcceptedIterationMember({
    commonDir,
    iterationId,
    memberRecord: persisted,
    archiveAuthority: authority,
    observeArchivedThread: async () => observation,
    removeWorktree,
  });
  if (!reclaimed) return current;
  const completedAt = new Date(now).toISOString();
  return updateIteration(commonDir, iterationId, async (record) => ({
    ...record,
    members: record.members.map((entry) => entry.member_id === candidate.member_id ? {
      ...entry,
      state: "archived",
      updated_at: completedAt,
    } : entry),
    updated_at: completedAt,
  }));
}

/**
 * Advances one child-first closeout action without calling the host archive
 * setter. The owning role performs the emitted App action and returns its exact
 * bounded result on a later invocation.
 */
export async function closeoutIterationWithOwningHost({
  commonDir,
  iterationId,
  allowCoordinator = false,
  taskObservation = null,
  hostResult = null,
  observeArchivedThread = null,
  removeWorktree = removeIterationWorktree,
  now = Date.now(),
}) {
  if (observeArchivedThread !== null && typeof observeArchivedThread !== "function") {
    throw new CliError("closeout archive observer must be callable");
  }
  if (typeof removeWorktree !== "function") throw new CliError("closeout worktree remover must be callable");
  let current = await iterationStatus({ commonDir, iterationId });
  let candidate = nextCloseoutCandidate(current, allowCoordinator);
  if (candidate === null) {
    const disposable = current.members.filter((entry) => !entry.retained);
    const phaseMembers = allowCoordinator
      ? disposable
      : disposable.filter((entry) => entry.role === "executor");
    const phaseComplete = phaseMembers.every((entry) => entry.state === "archived");
    const complete = allowCoordinator && disposable.every((entry) => entry.state === "archived");
    if (complete && current.state !== "closed") {
      current = await updateIteration(commonDir, iterationId, async (record) => ({
        ...record,
        state: "closed",
        updated_at: new Date(now).toISOString(),
      }));
    }
    return { status: complete ? "closed" : phaseComplete ? "phase-complete" : "pending", iteration: current };
  }
  const eligibility = await assertMemberEligible(candidate, allowCoordinator);
  if (eligibility.status !== "eligible") return { status: "pending", iteration: current };
  const observation = closeoutTaskObservation(taskObservation, candidate.thread_id);

  if (candidate.role === "executor") {
    const stateRoot = candidate.authority.state_root;
    const dispositionId = eligibility.authority.disposition.disposition_id;
    let archive = await taskArchiveForDisposition({ stateRoot, dispositionId });
    if (archive === null) {
      if (observation?.active_visible !== true) {
        return {
          status: "observation-required",
          observation_request: { thread_id: candidate.thread_id, expected_surface: "active" },
          iteration: current,
        };
      }
      archive = await prepareTaskArchive({
        stateRoot,
        dispositionId,
        taskObservation: observation,
        hostId: candidate.host_id,
        now,
      });
    }
    if (candidate.archive_attempt === null) {
      const branchTip = await captureBranchTip(commonDir, candidate, eligibility.authority);
      current = await updateMemberArchiveAttempt({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        attempt: {
          attempt_id: archive.host_intent.attempt_id,
          state: "prepared",
          started_at: archive.prepared_at,
          completed_at: null,
          result_digest: null,
          reason: "owning-host-action-prepared",
          branch_tip: branchTip,
        },
        state: "accepted",
        now,
      });
      candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
    }
    if (archive.state === "prepared") {
      const result = closeoutHostResult(
        hostResult,
        candidate.thread_id,
        archive.host_intent.attempt_id,
      );
      if (result === null) {
        return {
          status: archive.call_required === true ? "host-action-required" : "host-result-required",
          call_required: archive.call_required === true,
          run_id: archive.run_id,
          archive_id: archive.archive_id,
          host_request: archive.host_intent,
          iteration: current,
        };
      }
      archive = await reconcileTaskArchive({
        stateRoot,
        archiveId: archive.archive_id,
        attemptId: result.attempt_id,
        outcome: result.outcome,
        now,
      });
      const attemptState = result.outcome === "accepted"
        ? "accepted"
        : result.outcome === "ambiguous" ? "ambiguous" : "blocked";
      current = await updateMemberArchiveAttempt({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        attempt: {
          ...candidate.archive_attempt,
          state: attemptState,
          completed_at: new Date(now).toISOString(),
          result_digest: sha256(stableStringify(result)),
          reason: result.reason ?? result.error_code ?? (
            result.outcome === "ambiguous" ? "host-outcome-ambiguous" : result.outcome
          ),
        },
        state: attemptState === "accepted" ? "archive-pending" : "accepted",
        now,
      });
      candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
      if (result.outcome === "rejected-before-send") {
        return { status: "pending", iteration: current };
      }
    } else if (hostResult !== null) {
      throw new CliError("Archive host result was already reconciled; the host action must not replay", 73);
    }
    const archivedObservation = await observeExactArchive(
      observeArchivedThread,
      candidate,
      observation,
    );
    if (archivedObservation === null) {
      return {
        status: "observation-required",
        run_id: archive.run_id,
        archive_id: archive.archive_id,
        observation_request: { thread_id: candidate.thread_id, expected_surface: "archived" },
        iteration: current,
      };
    }
    const setterOutcome = archive.setter?.outcome
      ?? (candidate.archive_attempt.state === "ambiguous" ? "ambiguous" : "accepted");
    archive = await reconcileTaskArchive({
      stateRoot,
      archiveId: archive.archive_id,
      attemptId: archive.host_intent.attempt_id,
      outcome: setterOutcome,
      observation: archivedObservation,
      now,
    });
    current = await finishOwningHostMember({
      commonDir,
      iterationId,
      current,
      candidate,
      authority: eligibility.authority,
      observation: archivedObservation,
      removeWorktree,
      now,
    });
    candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
    if (candidate.state === "archived") {
      archive = await reconcileTaskArchive({
        stateRoot,
        archiveId: archive.archive_id,
        attemptId: archive.host_intent.attempt_id,
        outcome: setterOutcome,
        observation: archivedObservation,
        now,
      });
      if (archive.state !== "completed") {
        throw new CliError("Executor iteration closeout did not complete its run archive lifecycle", 73);
      }
    }
  } else {
    const attemptId = candidate.archive_attempt?.attempt_id
      ?? iterationArchiveAttemptId(iterationId, candidate.member_id);
    let preparedNow = false;
    if (candidate.archive_attempt === null || candidate.archive_attempt.state === "blocked") {
      if (observation?.archived_visible === true) {
        const worktreePresent = await pathExists(candidate.worktree_path);
        const branchTip = await (worktreePresent
          ? captureBranchTip(commonDir, candidate, null)
          : archivedCoordinatorGitAuthority(commonDir, candidate));
        current = await updateMemberArchiveAttempt({
          commonDir,
          iterationId,
          memberId: candidate.member_id,
          attempt: {
            attempt_id: attemptId,
            state: "accepted",
            started_at: new Date(now).toISOString(),
            completed_at: new Date(now).toISOString(),
            result_digest: sha256(stableStringify(observation)),
            reason: "host-archive-observed",
            branch_tip: branchTip,
          },
          state: "archive-pending",
          now,
        });
        candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
      } else {
        if (observation?.active_visible !== true) {
          return {
            status: "observation-required",
            observation_request: { thread_id: candidate.thread_id, expected_surface: "active" },
            iteration: current,
          };
        }
        const branchTip = await captureBranchTip(commonDir, candidate, null);
        current = await updateMemberArchiveAttempt({
          commonDir,
          iterationId,
          memberId: candidate.member_id,
          attempt: {
            attempt_id: attemptId,
            state: "prepared",
            started_at: new Date(now).toISOString(),
            completed_at: null,
            result_digest: null,
            reason: "owning-host-action-prepared",
            branch_tip: branchTip,
          },
          state: "accepted",
          now,
        });
        candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
        preparedNow = true;
      }
    }
    if (candidate.archive_attempt.state === "prepared") {
      const result = closeoutHostResult(hostResult, candidate.thread_id, attemptId);
      if (result === null) {
        return {
          status: preparedNow ? "host-action-required" : "host-result-required",
          call_required: preparedNow,
          host_request: iterationHostRequest(candidate, attemptId),
          iteration: current,
        };
      }
      const attemptState = result.outcome === "accepted"
        ? "accepted"
        : result.outcome === "ambiguous" ? "ambiguous" : "blocked";
      current = await updateMemberArchiveAttempt({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        attempt: {
          ...candidate.archive_attempt,
          state: attemptState,
          completed_at: new Date(now).toISOString(),
          result_digest: sha256(stableStringify(result)),
          reason: result.reason ?? result.error_code ?? (
            result.outcome === "ambiguous" ? "host-outcome-ambiguous" : result.outcome
          ),
        },
        state: attemptState === "accepted" ? "archive-pending" : "accepted",
        now,
      });
      candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
      if (attemptState === "blocked") return { status: "pending", iteration: current };
    } else if (hostResult !== null) {
      throw new CliError("Coordinator archive host result was already reconciled; the host action must not replay", 73);
    }
    const archivedObservation = await observeExactArchive(
      observeArchivedThread,
      candidate,
      observation,
    );
    if (archivedObservation === null) {
      return {
        status: "observation-required",
        observation_request: { thread_id: candidate.thread_id, expected_surface: "archived" },
        iteration: current,
      };
    }
    current = await finishOwningHostMember({
      commonDir,
      iterationId,
      current,
      candidate,
      authority: null,
      observation: archivedObservation,
      removeWorktree,
      now,
    });
  }

  const disposable = current.members.filter((entry) => !entry.retained);
  const phaseMembers = allowCoordinator ? disposable : disposable.filter((entry) => entry.role === "executor");
  const phaseComplete = phaseMembers.every((entry) => entry.state === "archived");
  const complete = allowCoordinator && disposable.every((entry) => entry.state === "archived");
  if (complete) {
    current = await updateIteration(commonDir, iterationId, async (record) => ({
      ...record,
      state: "closed",
      updated_at: new Date(now).toISOString(),
    }));
  }
  return { status: complete ? "closed" : phaseComplete ? "phase-complete" : "pending", iteration: current };
}

export async function closeoutIteration({
  commonDir,
  iterationId,
  allowCoordinator = false,
  archiveThread,
  observeArchivedThread = null,
  removeWorktree = removeIterationWorktree,
  now = Date.now(),
}) {
  if (typeof archiveThread !== "function") throw new CliError("closeout requires a native archive adapter");
  if (observeArchivedThread !== null && typeof observeArchivedThread !== "function") {
    throw new CliError("closeout archive observer must be callable");
  }
  if (typeof removeWorktree !== "function") throw new CliError("closeout worktree remover must be callable");
  const roles = allowCoordinator ? ["executor", "coordinator"] : ["executor"];
  let current = await iterationStatus({ commonDir, iterationId });
  for (const role of roles) {
    if (
      role === "coordinator"
      && current.members.some((entry) => entry.role === "executor" && !entry.retained && entry.state !== "archived")
    ) break;
    for (const candidate of current.members.filter((entry) => entry.role === role && !entry.retained)) {
      if (candidate.state === "archived") continue;
      const eligibility = await assertMemberEligible(candidate, allowCoordinator);
      if (eligibility.status !== "eligible") continue;
      let activeCandidate = candidate;
      if (activeCandidate.archive_attempt?.state === "ambiguous") {
        if (observeArchivedThread === null) continue;
        let observation;
        try {
          observation = await observeArchivedThread({ threadId: activeCandidate.thread_id });
        } catch {
          continue;
        }
        if (observation?.thread_id !== activeCandidate.thread_id) {
          throw new CliError("Archive observation does not match the iteration member", 73);
        }
        const completedAt = new Date(now).toISOString();
        current = await updateIteration(commonDir, iterationId, async (record) => {
          const persisted = record.members.find((entry) => entry.member_id === activeCandidate.member_id);
          if (persisted.archive_attempt?.state !== "ambiguous") return record;
          return {
            ...record,
            members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
              ...entry,
              state: "archive-pending",
              archive_attempt: {
                ...entry.archive_attempt,
                state: "accepted",
                completed_at: completedAt,
                result_digest: sha256(stableStringify(observation)),
                reason: "private-archive-observed",
              },
              updated_at: completedAt,
            } : entry),
            updated_at: completedAt,
          };
        });
        activeCandidate = current.members.find((entry) => entry.member_id === activeCandidate.member_id);
      }
      if (activeCandidate.archive_attempt?.state === "accepted") {
        if (!(await reclaimAcceptedIterationMember({
          commonDir,
          iterationId,
          memberRecord: activeCandidate,
          archiveAuthority: eligibility.authority,
          observeArchivedThread,
          removeWorktree,
        }))) continue;
        current = await updateIteration(commonDir, iterationId, async (record) => ({
          ...record,
          members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
            ...entry, state: "archived", updated_at: new Date(now).toISOString(),
          } : entry),
          updated_at: new Date(now).toISOString(),
        }));
        continue;
      }
      if (
        activeCandidate.role === "coordinator"
        && !(await pathExists(activeCandidate.worktree_path))
      ) {
        if (observeArchivedThread === null) continue;
        let observation;
        try {
          observation = await observeArchivedThread({ threadId: activeCandidate.thread_id });
        } catch {
          continue;
        }
        if (observation?.thread_id !== activeCandidate.thread_id) {
          throw new CliError("Archive observation does not match the iteration member", 73);
        }
        const observedAt = new Date(now).toISOString();
        const attemptId = `iteration-archive-attempt-v1-${sha256(stableStringify({ iteration_id: iterationId, member_id: activeCandidate.member_id }))}`;
        const branchTip = await archivedCoordinatorGitAuthority(commonDir, activeCandidate);
        let observationClaimed = false;
        current = await updateIteration(commonDir, iterationId, async (record) => {
          const persisted = record.members.find((entry) => entry.member_id === activeCandidate.member_id);
          if (
            persisted.state === "archived"
            || (persisted.archive_attempt !== null && persisted.archive_attempt.state !== "blocked")
          ) return record;
          observationClaimed = true;
          return {
            ...record,
            state: "closeout-pending",
            members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
              ...entry,
              state: "archive-pending",
              archive_attempt: {
                attempt_id: attemptId,
                state: "accepted",
                started_at: persisted.archive_attempt?.started_at ?? observedAt,
                completed_at: observedAt,
                result_digest: sha256(stableStringify(observation)),
                reason: "private-archive-observed",
                branch_tip: branchTip,
              },
              updated_at: observedAt,
            } : entry),
            updated_at: observedAt,
          };
        });
        if (!observationClaimed) continue;
        activeCandidate = current.members.find((entry) => entry.member_id === activeCandidate.member_id);
        if (await cleanupIterationGit(commonDir, activeCandidate, branchTip)) {
          current = await updateIteration(commonDir, iterationId, async (record) => ({
            ...record,
            members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
              ...entry, state: "archived", updated_at: observedAt,
            } : entry),
            updated_at: observedAt,
          }));
        }
        continue;
      }
      const startedAt = new Date(now).toISOString();
      const attemptId = `iteration-archive-attempt-v1-${sha256(stableStringify({ iteration_id: iterationId, member_id: activeCandidate.member_id }))}`;
      const branchTip = await captureBranchTip(commonDir, activeCandidate, eligibility.authority);
      let dispatchClaimed = false;
      current = await updateIteration(commonDir, iterationId, async (record) => {
        const persisted = record.members.find((entry) => entry.member_id === activeCandidate.member_id);
        if (
          persisted.state === "archived"
          || ["accepted", "ambiguous"].includes(persisted.archive_attempt?.state)
        ) return record;
        dispatchClaimed = true;
        return {
          ...record,
          state: "closeout-pending",
          members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
            ...entry,
            state: "accepted",
            archive_attempt: {
              attempt_id: attemptId,
              state: "ambiguous",
              started_at: startedAt,
              completed_at: null,
              result_digest: null,
              reason: "native-outcome-pending",
              branch_tip: branchTip,
            },
            updated_at: startedAt,
          } : entry),
          updated_at: startedAt,
        };
      });
      if (!dispatchClaimed) continue;
      activeCandidate = current.members.find((entry) => entry.member_id === activeCandidate.member_id);
      const result = await archiveThread({ threadId: activeCandidate.thread_id });
      const completedAt = new Date(now).toISOString();
      const attemptState = ["accepted", "accepted-with-anomaly"].includes(result.outcome)
        ? "accepted"
        : result.outcome === "blocked" && result.archive_attempted === false
          ? "blocked"
          : "ambiguous";
      current = await updateIteration(commonDir, iterationId, async (record) => {
        const persisted = record.members.find((entry) => entry.member_id === activeCandidate.member_id);
        if (
          persisted.archive_attempt?.attempt_id !== attemptId
          || persisted.archive_attempt.state !== "ambiguous"
          || persisted.archive_attempt.result_digest !== null
        ) return record;
        return {
          ...record,
          members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
            ...entry,
            state: attemptState === "accepted" ? "archive-pending" : "accepted",
            archive_attempt: {
              attempt_id: attemptId,
              state: attemptState,
              started_at: startedAt,
              completed_at: completedAt,
              result_digest: sha256(stableStringify(result)),
              reason: result.reason ?? null,
              branch_tip: branchTip,
            },
            updated_at: completedAt,
          } : entry),
          updated_at: completedAt,
        };
      });
      activeCandidate = current.members.find((entry) => entry.member_id === activeCandidate.member_id);
      if (
        attemptState === "accepted"
        && !(await pathExists(activeCandidate.worktree_path))
        && await cleanupIterationGit(commonDir, activeCandidate, activeCandidate.archive_attempt.branch_tip)
      ) {
        current = await updateIteration(commonDir, iterationId, async (record) => ({
          ...record,
          members: record.members.map((entry) => entry.member_id === activeCandidate.member_id ? {
            ...entry, state: "archived", updated_at: completedAt,
          } : entry),
          updated_at: completedAt,
        }));
      }
    }
  }
  const disposable = current.members.filter((entry) => !entry.retained);
  const phaseMembers = allowCoordinator ? disposable : disposable.filter((entry) => entry.role === "executor");
  const phaseComplete = phaseMembers.every((entry) => entry.state === "archived");
  const complete = allowCoordinator && disposable.every((entry) => entry.state === "archived");
  if (complete) {
    current = await updateIteration(commonDir, iterationId, async (record) => ({ ...record, state: "closed", updated_at: new Date(now).toISOString() }));
  }
  return { status: complete ? "closed" : phaseComplete ? "phase-complete" : "pending", iteration: current };
}
