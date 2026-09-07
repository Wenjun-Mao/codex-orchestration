import { lstat, readdir } from "node:fs/promises";
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
import { validateDispositionRecord } from "./dispositions.mjs";

export const ITERATION_STATE_DIRECTORY = "iterations-v1";
export const ITERATION_KIND = "codex-flow-v097-iteration";

const DIGEST = /^[0-9a-f]{64}$/;
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
    required: ["attempt_id", "state", "started_at", "completed_at", "result_digest", "reason"],
  }, label);
  return {
    attempt_id: requireText(value.attempt_id, `${label}.attempt_id`, { max: 128, safeId: true }),
    state: requireEnum(value.state, ["prepared", "accepted", "ambiguous", "blocked"], `${label}.state`),
    started_at: timestamp(value.started_at, `${label}.started_at`),
    completed_at: value.completed_at === null ? null : timestamp(value.completed_at, `${label}.completed_at`),
    result_digest: value.result_digest === null ? null : digest(value.result_digest, `${label}.result_digest`),
    reason: nullableText(value.reason, `${label}.reason`, { max: 128, safeId: true }),
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
      if (stableStringify(validated) !== stableStringify(record)) throw new CliError("Existing iteration conflicts with assignment authority", 73);
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
  const threadId = launch.start_claim?.executor_thread_id ?? launch.creation_evidence?.ready_thread_id ?? null;
  const provisionalId = threadId === null ? launch.creation_evidence?.provisional_id ?? null : null;
  if (threadId === null && provisionalId === null) return iterationStatus({ commonDir: assignment.common_dir, iterationId: assignment.iteration_id });
  return updateIteration(assignment.common_dir, assignment.iteration_id, async (current) => {
    const authorityValue = { kind: "task-launch", authority_id: launch.launch_id, authority_digest: sha256(stableStringify(launch)), state_root: stateRoot };
    const candidate = memberFor({
      role: "executor", hostId: launch.creation_evidence?.host_id ?? assignment.sender.host_id,
      threadId, provisionalId, parentThreadId: assignment.sender.thread_id, retained: false,
      authority: authorityValue, requestedTitle: iterationTitle("Executor", assignment.iteration_label, launch.task_id),
      observedTitle: null, worktreePath: launch.git_activation?.worktree_path ?? null,
      branch: launch.git_activation?.branch ?? launch.requested_selectors.worktree.executor_branch,
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
  if (memberRecord.retained) return "retained";
  if (memberRecord.thread_id === null) throw new CliError("Provisional iteration membership cannot authorize archival", 73);
  if (memberRecord.role === "coordinator") {
    if (!allowCoordinator) return "deferred";
    return "eligible";
  }
  const dispositions = await dispositionsForMember(memberRecord);
  if (dispositions.length !== 1) throw new CliError("Executor closeout requires one exact disposition", 73);
  const disposition = dispositions[0];
  if (disposition.state !== "completed" || !["accepted-no-change", "accepted-for-integration"].includes(disposition.decision) || disposition.verification_id === null) {
    throw new CliError("Executor closeout requires accepted verified work", 73);
  }
  return "eligible";
}

async function pathExists(path) {
  if (path === null) return false;
  return lstat(path).then(() => true, (error) => { if (error?.code === "ENOENT") return false; throw error; });
}

export async function closeoutIteration({
  commonDir,
  iterationId,
  allowCoordinator = false,
  archiveThread,
  now = Date.now(),
}) {
  if (typeof archiveThread !== "function") throw new CliError("closeout requires a native archive adapter");
  const roles = allowCoordinator ? ["executor", "coordinator"] : ["executor"];
  let current = await iterationStatus({ commonDir, iterationId });
  for (const role of roles) {
    for (const candidate of current.members.filter((entry) => entry.role === role && !entry.retained)) {
      if (candidate.state === "archived") continue;
      const eligibility = await assertMemberEligible(candidate, allowCoordinator);
      if (eligibility !== "eligible") continue;
      if (candidate.archive_attempt?.state === "ambiguous") continue;
      if (candidate.archive_attempt?.state === "accepted") {
        if (await pathExists(candidate.worktree_path)) continue;
        current = await updateIteration(commonDir, iterationId, async (record) => ({
          ...record,
          members: record.members.map((entry) => entry.member_id === candidate.member_id ? { ...entry, state: "archived", updated_at: new Date(now).toISOString() } : entry),
          updated_at: new Date(now).toISOString(),
        }));
        continue;
      }
      const startedAt = new Date(now).toISOString();
      const attemptId = `iteration-archive-attempt-v1-${sha256(stableStringify({ iteration_id: iterationId, member_id: candidate.member_id }))}`;
      current = await updateIteration(commonDir, iterationId, async (record) => ({
        ...record,
        state: "closeout-pending",
        members: record.members.map((entry) => entry.member_id === candidate.member_id ? {
          ...entry, archive_attempt: { attempt_id: attemptId, state: "prepared", started_at: startedAt, completed_at: null, result_digest: null, reason: null }, updated_at: startedAt,
        } : entry),
        updated_at: startedAt,
      }));
      const result = await archiveThread({ threadId: candidate.thread_id });
      const completedAt = new Date(now).toISOString();
      const attemptState = ["accepted", "accepted-with-anomaly"].includes(result.outcome) ? "accepted" : result.outcome;
      current = await updateIteration(commonDir, iterationId, async (record) => ({
        ...record,
        members: record.members.map((entry) => entry.member_id === candidate.member_id ? {
          ...entry,
          state: attemptState === "accepted" ? "archive-pending" : "accepted",
          archive_attempt: { attempt_id: attemptId, state: attemptState, started_at: startedAt, completed_at: completedAt, result_digest: sha256(stableStringify(result)), reason: result.reason ?? null },
          updated_at: completedAt,
        } : entry),
        updated_at: completedAt,
      }));
      if (attemptState === "accepted" && !(await pathExists(candidate.worktree_path))) {
        current = await updateIteration(commonDir, iterationId, async (record) => ({
          ...record,
          members: record.members.map((entry) => entry.member_id === candidate.member_id ? {
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
