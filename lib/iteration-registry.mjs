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
import {
  assignmentAuthority,
  assignmentMembershipAuthorityDigest,
} from "./assignment-authority.mjs";
import { validateCoordinatorWorkRecord } from "./coordinator-work.mjs";
import { validateDispositionRecord } from "./dispositions.mjs";
import { repositoryReportLocatorRetirement } from "./report-locator-authority.mjs";
import { reportDelivery } from "./report-records.mjs";

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

function coordinatorBranch(value, label) {
  const branch = requireText(value, label, { max: 256 });
  if (branch !== "detached" && !branch.startsWith("codex/")) {
    throw new CliError(`${label} must be detached or a disposable Codex branch`);
  }
  return branch;
}

function coordinatorBinding(value, label, { disposable = true } = {}) {
  requireExactFields(value, { required: ["worktree_path", "branch"] }, label);
  return {
    worktree_path: resolve(requireText(value.worktree_path, `${label}.worktree_path`, { max: 2048 })),
    branch: disposable
      ? coordinatorBranch(value.branch, `${label}.branch`)
      : requireText(value.branch, `${label}.branch`, { max: 256 }),
  };
}

function coordinatorBindingCorrection(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "kind", "corrected_at", "original", "corrected", "owner_thread_id",
      "revision", "evidence_digest",
    ],
  }, label);
  if (value.kind !== "codex-app-worktree-owner-v1") {
    throw new CliError(`${label}.kind is unsupported`);
  }
  const revision = requireText(value.revision, `${label}.revision`, { max: 64 });
  if (!REVISION.test(revision)) throw new CliError(`${label}.revision must be a concrete Git revision`);
  return {
    kind: value.kind,
    corrected_at: timestamp(value.corrected_at, `${label}.corrected_at`),
    original: coordinatorBinding(value.original, `${label}.original`, { disposable: false }),
    corrected: coordinatorBinding(value.corrected, `${label}.corrected`),
    owner_thread_id: requireText(value.owner_thread_id, `${label}.owner_thread_id`, { max: 256, safeId: true }),
    revision,
    evidence_digest: digest(value.evidence_digest, `${label}.evidence_digest`),
  };
}

function coordinatorAbsenceReconciliation(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "kind", "reconciled_at", "reconciled_by_thread_id", "accepted_report_id",
      "accepted_report_digest", "binding", "preserved_tip",
    ],
    optional: ["result_authority"],
  }, label);
  if (value.kind !== "accepted-coordinator-resources-absent-v1") {
    throw new CliError(`${label}.kind is unsupported`);
  }
  const preservedTip = requireText(value.preserved_tip, `${label}.preserved_tip`, { max: 64 });
  if (!REVISION.test(preservedTip)) throw new CliError(`${label}.preserved_tip must be a concrete Git revision`);
  return {
    kind: value.kind,
    reconciled_at: timestamp(value.reconciled_at, `${label}.reconciled_at`),
    reconciled_by_thread_id: requireText(value.reconciled_by_thread_id, `${label}.reconciled_by_thread_id`, { max: 256, safeId: true }),
    accepted_report_id: requireText(value.accepted_report_id, `${label}.accepted_report_id`, { max: 128, safeId: true }),
    accepted_report_digest: digest(value.accepted_report_digest, `${label}.accepted_report_digest`),
    binding: coordinatorBinding(value.binding, `${label}.binding`),
    preserved_tip: preservedTip,
    ...(Object.hasOwn(value, "result_authority")
      ? { result_authority: completedCoordinatorWorkResultAuthority(value.result_authority, `${label}.result_authority`) }
      : {}),
  };
}

function completedCoordinatorWorkResultAuthority(value, label) {
  requireExactFields(value, {
    required: [
      "kind", "namespace", "local_work_id", "record_digest", "final_revision",
      "verification_id", "verification_evidence_digest",
    ],
  }, label);
  if (value.kind !== "completed-coordinator-work-v1") {
    throw new CliError(`${label}.kind is unsupported`);
  }
  const finalRevision = requireText(value.final_revision, `${label}.final_revision`, { max: 64 });
  if (!REVISION.test(finalRevision)) {
    throw new CliError(`${label}.final_revision must be a concrete Git revision`);
  }
  return {
    kind: value.kind,
    namespace: requireText(value.namespace, `${label}.namespace`, { max: 128, safeId: true }),
    local_work_id: requireText(value.local_work_id, `${label}.local_work_id`, { max: 128, safeId: true }),
    record_digest: digest(value.record_digest, `${label}.record_digest`),
    final_revision: finalRevision,
    verification_id: requireText(value.verification_id, `${label}.verification_id`, { max: 128, safeId: true }),
    verification_evidence_digest: digest(value.verification_evidence_digest, `${label}.verification_evidence_digest`),
  };
}

function member(value, label) {
  requireExactFields(value, {
    required: [
      "member_id", "role", "host_id", "thread_id", "provisional_id", "reporting_parent_thread_id",
      "retained", "authority", "requested_title", "observed_title", "worktree_path", "branch",
      "state", "archive_attempt", "registered_at", "updated_at",
    ],
    optional: ["binding_correction", "absence_reconciliation"],
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
    ...(Object.hasOwn(value, "binding_correction")
      ? { binding_correction: coordinatorBindingCorrection(value.binding_correction, `${label}.binding_correction`) }
      : {}),
    ...(Object.hasOwn(value, "absence_reconciliation")
      ? { absence_reconciliation: coordinatorAbsenceReconciliation(value.absence_reconciliation, `${label}.absence_reconciliation`) }
      : {}),
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

function effectiveCoordinatorBinding(memberRecord) {
  if (memberRecord.role !== "coordinator") {
    return { worktree_path: memberRecord.worktree_path, branch: memberRecord.branch };
  }
  const correction = memberRecord.binding_correction ?? null;
  return correction === null
    ? { worktree_path: memberRecord.worktree_path, branch: memberRecord.branch }
    : correction.corrected;
}

function withEffectiveCoordinatorBinding(memberRecord) {
  if (memberRecord.role !== "coordinator") return memberRecord;
  return { ...memberRecord, ...effectiveCoordinatorBinding(memberRecord) };
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

function worktreeOwnershipLockPath(commonDir) {
  return resolve(iterationStateRoot(commonDir), "worktree-ownership.lock.json");
}

function withWorktreeOwnershipLock(commonDir, operation) {
  return withProcessLock({
    path: worktreeOwnershipLockPath(commonDir),
    guardRoot: commonDir,
    label: "iteration worktree ownership",
  }, operation);
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
  const assignmentDigest = assignmentMembershipAuthorityDigest(assignment);
  const director = memberFor({
    role: "director", hostId: assignment.recipient.host_id, threadId: assignment.recipient.thread_id,
    retained: true,
    authority: { kind: "assignment", authority_id: assignment.assignment_id, authority_digest: assignmentDigest, state_root: assignmentStateRoot },
    now,
  });
  const coordinator = memberFor({
    role: "coordinator", hostId: assignment.sender.host_id, threadId: assignment.sender.thread_id,
    parentThreadId: assignment.recipient.thread_id, retained: false,
    authority: { kind: "assignment", authority_id: assignment.assignment_id, authority_digest: assignmentDigest, state_root: assignmentStateRoot },
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
  return withWorktreeOwnershipLock(assignment.common_dir, () => (
    withProcessLock({ path: location.lock, guardRoot: assignment.common_dir, label: `iteration ${record.iteration_id}` }, async () => {
      const existing = await readJson(location.record, { allowMissing: true, guardRoot: assignment.common_dir });
      if (existing !== null) {
        const validated = validateIterationRecord(existing);
        const expectedMembers = new Map(record.members.map((entry) => [entry.role, entry]));
        const existingMembers = new Map(validated.members
          .filter((entry) => ["director", "coordinator"].includes(entry.role))
          .map((entry) => [entry.role, entry]));
        const assignmentMembersMatch = [...expectedMembers].every(([role, expected]) => {
          const current = existingMembers.get(role);
          if (current === undefined) return false;
          const currentIdentity = assignmentMemberIdentity(current);
          const expectedIdentity = assignmentMemberIdentity(expected);
          return stableStringify({
            ...currentIdentity,
            member_id: expectedIdentity.member_id,
            authority: {
              ...currentIdentity.authority,
              authority_digest: expectedIdentity.authority.authority_digest,
            },
          }) === stableStringify(expectedIdentity);
        });
        if (
          validated.assignment_id !== record.assignment_id
          || validated.label !== record.label
          || !assignmentMembersMatch
        ) throw new CliError("Existing iteration conflicts with assignment authority", 73);
        await assertIterationWorktreeOwnership(
          assignment.common_dir,
          validated.iteration_id,
          validated.members.find((entry) => entry.role === "coordinator"),
          { requirePersistedCurrent: true },
        );
        return validated;
      }
      await assertIterationWorktreeOwnership(
        assignment.common_dir,
        record.iteration_id,
        coordinator,
        { requirePersistedCurrent: false },
      );
      await atomicWriteJson(location.record, record, { guardRoot: assignment.common_dir, mode: 0o600 });
      return record;
    })
  ));
}

export async function iterationStatus({ commonDir, iterationId, allowMissing = false }) {
  const stateRoot = iterationStateRoot(commonDir);
  const value = await readJson(paths(stateRoot, iterationId).record, {
    allowMissing,
    guardRoot: commonDir,
  });
  return value === null ? null : validateIterationRecord(value);
}

/**
 * Terminal failed assignments retain their coordinator resources for later
 * release work. Cancellation marks that ownership inactive; it never performs
 * a host archive, Git reclamation, or member-state rewrite.
 */
export async function cancelIteration({ commonDir, iterationId, assignmentId, now = Date.now() }) {
  const expectedAssignment = requireText(assignmentId, "assignment_id", { max: 128, safeId: true });
  const current = await iterationStatus({ commonDir, iterationId });
  if (current.assignment_id !== expectedAssignment) {
    throw new CliError("Iteration does not belong to the cancelled assignment", 73);
  }
  if (current.state === "closed") {
    throw new CliError("Closed iteration cannot be cancelled", 73);
  }
  const liveExecutor = current.members.find((member) => (
    member.role === "executor" && member.state !== "archived"
  ));
  if (liveExecutor !== undefined) {
    throw new CliError(`Assignment cancellation requires archived executor evidence: ${liveExecutor.member_id}`, 73);
  }
  if (current.state === "cancelled") return { status: "already-cancelled", iteration: current };
  const iteration = await updateIteration(commonDir, iterationId, async (record) => ({
    ...record,
    state: "cancelled",
    updated_at: new Date(now).toISOString(),
  }));
  return { status: "cancelled", iteration };
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
  return withWorktreeOwnershipLock(assignment.common_dir, () => updateIteration(
    assignment.common_dir,
    assignment.iteration_id,
    async (current) => {
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
      await assertIterationWorktreeOwnership(
        assignment.common_dir,
        assignment.iteration_id,
        candidate,
        { requirePersistedCurrent: index < 0 ? false : null },
      );
      if (index < 0) return { ...current, members: [...current.members, candidate], updated_at: new Date(now).toISOString() };
      const existing = current.members[index];
      if (existing.thread_id !== null && threadId !== null && existing.thread_id !== threadId) throw new CliError("Iteration executor identity conflicts", 73);
      const updated = { ...existing, thread_id: threadId ?? existing.thread_id, provisional_id: threadId === null ? provisionalId : null, authority: authorityValue, worktree_path: candidate.worktree_path ?? existing.worktree_path, branch: candidate.branch, updated_at: new Date(now).toISOString() };
      const members = [...current.members]; members[index] = member(updated, "member");
      return { ...current, members, updated_at: new Date(now).toISOString() };
    },
  ));
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

// A coordinator binding may have been persisted through a macOS alias such as
// /var while Git's durable snapshot recorded its physical /private/var path.
// Once the checkout is gone, resolve the deepest surviving parent and append
// the missing suffix so that this alias difference cannot erase otherwise
// exact result evidence. If no ancestor survives, the result is deliberately
// unusable rather than guessed.
async function canonicalPathFromExistingAncestor(path) {
  let candidate = resolve(path);
  const suffix = [];
  while (true) {
    try {
      return resolve(await realpath(candidate), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      suffix.push(basename(candidate));
      candidate = parent;
    }
  }
}

function reclamationAuthority(memberRecord) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  if (
    effective.retained
    || effective.thread_id === null
    || effective.worktree_path === null
    || effective.state !== "archive-pending"
    || effective.archive_attempt?.state !== "accepted"
    || effective.archive_attempt.branch_tip === null
  ) throw new CliError("Iteration member lacks persisted exact worktree reclamation authority", 73);
  return {
    member_id: effective.member_id,
    thread_id: effective.thread_id,
    authority: effective.authority,
    worktree_path: resolve(effective.worktree_path),
    branch: effective.branch,
    archive_attempt_id: effective.archive_attempt.attempt_id,
    branch_tip: effective.archive_attempt.branch_tip,
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
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const inventory = worktreeInventory(commonDir);
  for (const entry of inventory.slice(1)) {
    // A prunable record has no live checkout from which to authenticate Codex
    // ownership, and cannot be the moved attachment this guard is looking for.
    if (entry.prunable) continue;
    const owner = await codexWorktreeOwnerThread(commonDir, entry.path);
    if (owner === effective.thread_id) {
      throw new CliError("Iteration worktree owner remains attached at an unexpected path", 73);
    }
    if (effective.branch === "detached" && entry.detached && entry.head === expectedTip) {
      throw new CliError("Detached iteration worktree remains attached at an ambiguous path", 73);
    }
  }
}

function sameCoordinatorOwnership(left, right) {
  return left.role === "coordinator"
    && right.role === "coordinator"
    && left.retained === false
    && right.retained === false
    && left.host_id === right.host_id
    && left.thread_id !== null
    && left.thread_id === right.thread_id
    && left.reporting_parent_thread_id === right.reporting_parent_thread_id
    && left.branch === right.branch;
}

async function assignmentForIterationMember(commonDir, iteration, memberRecord) {
  if (
    memberRecord.authority.kind !== "assignment"
    || memberRecord.authority.authority_id !== iteration.assignment_id
  ) throw new CliError("Iteration coordinator does not match its assignment authority", 73);
  const assignment = await assignmentAuthority({
    stateRoot: memberRecord.authority.state_root,
    assignmentId: memberRecord.authority.authority_id,
  });
  const [assignmentCommonDir, expectedCommonDir] = await Promise.all([
    realpath(assignment.common_dir),
    realpath(commonDir),
  ]);
  if (
    assignmentCommonDir !== expectedCommonDir
    || assignment.iteration_id !== iteration.iteration_id
    || assignment.assignment_id !== iteration.assignment_id
    || assignment.sender.host_id !== memberRecord.host_id
    || assignment.sender.thread_id !== memberRecord.thread_id
    || assignment.recipient.thread_id !== memberRecord.reporting_parent_thread_id
  ) throw new CliError("Iteration coordinator assignment authority drifted", 73);
  return assignment;
}

function sameAssignmentOwnership(left, right) {
  // repository_digest is the run's full repository snapshot digest, including
  // its revision. A cancelled coordinator may lawfully advance the retained
  // branch before its successor starts, so that digest is not a stable
  // repository identity. assignmentForIterationMember has already bound both
  // assignments to this registry's canonical Git common directory, while the
  // membership classifier binds the exact worktree and branch.
  return stableStringify(left.sender) === stableStringify(right.sender)
    && stableStringify(left.recipient) === stableStringify(right.recipient);
}

async function settledCancelledPredecessor({
  commonDir,
  currentIteration,
  currentMember,
  currentAssignment,
  predecessorIteration,
  predecessorMember,
}) {
  if (
    predecessorIteration.state !== "cancelled"
    || predecessorMember.state === "archived"
    || !sameCoordinatorOwnership(currentMember, predecessorMember)
  ) return false;
  const predecessorAssignment = await assignmentForIterationMember(
    commonDir,
    predecessorIteration,
    predecessorMember,
  );
  if (
    predecessorAssignment.state !== "cancelled"
    || predecessorAssignment.cancellation === null
    || !sameAssignmentOwnership(currentAssignment, predecessorAssignment)
    || Date.parse(predecessorAssignment.cancellation.cancelled_at) > Date.parse(currentAssignment.created_at)
    || Date.parse(predecessorIteration.updated_at) > Date.parse(currentIteration.created_at)
  ) return false;
  try {
    const retirement = await repositoryReportLocatorRetirement({
      stateRoot: predecessorMember.authority.state_root,
      routeId: predecessorAssignment.route_id,
      successorRouteId: currentAssignment.route_id,
    });
    return retirement.reason === "terminal";
  } catch {
    return false;
  }
}

async function assertIterationWorktreeOwnership(
  commonDir,
  iterationId,
  memberRecord,
  { requirePersistedCurrent },
) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  if (effective.worktree_path === null) return;
  const target = await realpath(effective.worktree_path).catch(() => null);
  if (target === null) throw new CliError("Iteration worktree path is absent at ownership validation", 73);
  const sourceCheckout = await authenticatedPrimaryWorktree(commonDir, worktreeInventory(commonDir));
  // The authenticated source checkout is protected infrastructure, not an
  // iteration-owned disposable worktree. Sequential coordinator routes may
  // therefore use it without entering the exclusive ownership set.
  if (target === sourceCheckout.path) return;
  const directory = resolve(iterationStateRoot(commonDir), "records");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") entries = [];
    else throw error;
  }
  const currentIteration = {
    iteration_id: iterationId,
    assignment_id: memberRecord.authority.authority_id,
    created_at: memberRecord.registered_at,
  };
  const currentAssignment = effective.role === "coordinator"
    ? await assignmentForIterationMember(commonDir, currentIteration, memberRecord)
    : null;
  let exactMemberships = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateIterationRecord(await readJson(resolve(directory, entry.name), {
      guardRoot: commonDir,
    }));
    for (const candidate of record.members) {
      const effectiveCandidate = withEffectiveCoordinatorBinding(candidate);
      if (effectiveCandidate.worktree_path === null) continue;
      const candidatePath = await realpath(effectiveCandidate.worktree_path).catch(() => resolve(effectiveCandidate.worktree_path));
      if (candidatePath !== target) continue;
      if (record.iteration_id === iterationId && effectiveCandidate.member_id === effective.member_id) {
        exactMemberships += 1;
        continue;
      }
      if (currentAssignment !== null && await settledCancelledPredecessor({
        commonDir,
        currentIteration,
        currentMember: effective,
        currentAssignment,
        predecessorIteration: record,
        predecessorMember: effectiveCandidate,
      })) continue;
      throw new CliError("Iteration worktree is shared by another persisted member", 73);
    }
  }
  const membershipMatches = requirePersistedCurrent === null
    ? exactMemberships <= 1
    : exactMemberships === (requirePersistedCurrent ? 1 : 0);
  if (!membershipMatches) {
    throw new CliError("Iteration worktree ownership is missing or ambiguous", 73);
  }
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
  const [snapshotCommonDir, expectedCommonDir] = await Promise.all([
    realpath(snapshot.commonDir),
    realpath(commonDir),
  ]);
  if (
    resolve(snapshot.root) !== resolve(canonicalPath)
    || snapshotCommonDir !== expectedCommonDir
    || snapshot.revision !== primary.head
  ) throw new CliError("Iteration source checkout drifted from its Git inventory", 73);
  return { ...primary, path: canonicalPath };
}

async function acceptedCoordinatorResultAuthority(memberRecord) {
  if (memberRecord.role !== "coordinator" || memberRecord.authority.kind !== "assignment") {
    throw new CliError("Coordinator recovery requires assignment-backed iteration authority", 73);
  }
  const assignment = await assignmentAuthority({
    stateRoot: memberRecord.authority.state_root,
    assignmentId: memberRecord.authority.authority_id,
  });
  if (
    assignment.state !== "accepted"
    || assignment.acceptance === null
    || assignment.assignment_id !== memberRecord.authority.authority_id
    || assignment.iteration_id === null
  ) throw new CliError("Coordinator recovery requires an accepted assignment result", 73);
  const report = await reportDelivery({
    stateRoot: memberRecord.authority.state_root,
    reportId: assignment.acceptance.report_id,
  });
  if (
    report.state !== "accepted"
    || report.route_id !== assignment.route_id
    || report.source_text_digest !== assignment.acceptance.report_digest
  ) throw new CliError("Coordinator recovery requires its exact accepted report evidence", 73);
  return { assignment, report };
}

async function coordinatorWorkResultMatchesAssignment({ record, binding, assignment, executionBinding, commonDir, coordinatorThreadId }) {
  const [recordedWorktree, effectiveWorktree] = await Promise.all([
    canonicalPathFromExistingAncestor(record.baseline.root),
    canonicalPathFromExistingAncestor(binding.worktree_path),
  ]);
  return (
    record.state === "completed"
    && record.common_dir === commonDir
    && record.repository_id === assignment.repository_digest
    && record.coordinator_binding.thread_id === coordinatorThreadId
    && recordedWorktree !== null
    && recordedWorktree === effectiveWorktree
    && record.baseline.branch === binding.branch
    && record.run_id === executionBinding.run_id
    && record.runtime_context_digest === executionBinding.runtime_context_digest
    && record.configuration_digest === executionBinding.configuration_digest
    && record.plan_id === executionBinding.plan_id
    && record.revision_digest === executionBinding.revision_digest
  );
}

/**
 * Finds the one completed coordinator-work record that can prove a result tip
 * when the normal pre-archive capture never ran. The assignment execution
 * binding supplies the namespace and run identity, while the record's
 * baseline must name the effective (possibly corrected) coordinator checkout.
 * A record from another task, plan, checkout, or revision cannot contribute a
 * result tip merely because it shares the repository or primary branch.
 */
async function completedCoordinatorWorkResultForAbsence({ commonDir, memberRecord, assignment }) {
  const binding = coordinatorBinding(effectiveCoordinatorBinding(memberRecord), "effective coordinator binding");
  const coordinatorThreadId = memberRecord.thread_id;
  if (coordinatorThreadId === null || assignment.sender.thread_id !== coordinatorThreadId) {
    throw new CliError("Coordinator resource-loss recovery has inconsistent assignment ownership", 73);
  }
  const records = [];
  for (const executionBinding of assignment.execution_bindings) {
    const sourceStateRoot = resolve(commonDir, "codex-flow", executionBinding.namespace);
    const directory = resolve(sourceStateRoot, "coordinator-work", "records");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const record = validateCoordinatorWorkRecord(await readJson(resolve(directory, entry.name), {
        guardRoot: commonDir,
      }));
      if (entry.name !== `${record.local_work_id}.json`) {
        throw new CliError("Coordinator-work result record filename does not match local_work_id", 73);
      }
      if (await coordinatorWorkResultMatchesAssignment({
        record,
        binding,
        assignment,
        executionBinding,
        commonDir,
        coordinatorThreadId,
      })) {
        records.push({
          kind: "completed-coordinator-work-v1",
          namespace: executionBinding.namespace,
          local_work_id: record.local_work_id,
          record_digest: sha256(stableStringify(record)),
          final_revision: record.result.final_revision,
          verification_id: record.verification.verification_id,
          verification_evidence_digest: record.verification.evidence_digest,
        });
      }
    }
  }
  if (records.length === 0) {
    throw new CliError(
      "Coordinator worktree and branch disappeared before native archival and no completed coordinator-work result is authenticated to the accepted assignment; preserve the accepted evidence and obtain a new director disposition",
      73,
    );
  }
  if (records.length !== 1) {
    throw new CliError("Coordinator resource-loss recovery found multiple completed coordinator-work results for the accepted assignment", 73);
  }
  return completedCoordinatorWorkResultAuthority(records[0], "completed coordinator-work result authority");
}

async function assertCompletedCoordinatorWorkResultAuthority({ commonDir, memberRecord, assignment, expected }) {
  const actual = await completedCoordinatorWorkResultForAbsence({ commonDir, memberRecord, assignment });
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new CliError("Coordinator absence reconciliation no longer matches its completed coordinator-work result authority", 73);
  }
  return actual;
}

async function reconciledAbsentCoordinatorGitAuthority(commonDir, memberRecord, inventory, primary) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const reconciliation = effective.absence_reconciliation ?? null;
  if (reconciliation === null) {
    throw new CliError("Coordinator worktree is absent before native archival", 73);
  }
  if (stableStringify(reconciliation.binding) !== stableStringify(effectiveCoordinatorBinding(effective))) {
    throw new CliError("Coordinator absence reconciliation does not match its effective worktree binding", 73);
  }
  const { assignment } = await acceptedCoordinatorResultAuthority(effective);
  if (reconciliation.result_authority !== undefined) {
    const resultAuthority = await assertCompletedCoordinatorWorkResultAuthority({
      commonDir,
      memberRecord: effective,
      assignment,
      expected: reconciliation.result_authority,
    });
    if (resultAuthority.final_revision !== reconciliation.preserved_tip) {
      throw new CliError("Coordinator absence reconciliation tip does not match its completed coordinator-work result", 73);
    }
  } else if (effective.archive_attempt?.branch_tip !== reconciliation.preserved_tip) {
    throw new CliError("Coordinator absence reconciliation is not bound to its authenticated captured result tip", 73);
  }
  const memberPath = resolve(effective.worktree_path);
  if (inventory.some((entry) => resolve(entry.path) === memberPath)) {
    throw new CliError("Coordinator absence reconciliation still has a registered worktree", 73);
  }
  const ref = `refs/heads/${effective.branch}`;
  if (effective.branch !== "detached" && (
    attachedWorktreeRefs(commonDir).includes(ref) || localBranchTip(commonDir, ref) !== null
  )) throw new CliError("Coordinator absence reconciliation still has a local branch", 73);
  if (!revisionIsAncestor(commonDir, reconciliation.preserved_tip, primary.head)) {
    throw new CliError("Coordinator absence reconciliation tip is not preserved in the source checkout", 73);
  }
  return reconciliation.preserved_tip;
}

async function coordinatorGitAuthority(commonDir, memberRecord, { allowCaller = false } = {}) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const registeredDetached = effective.branch === "detached";
  if (
    effective.worktree_path === null
    || effective.branch === null
    || (!registeredDetached && !effective.branch.startsWith("codex/"))
  ) throw new CliError("Coordinator closeout requires an exact disposable Codex worktree", 73);
  const inventory = worktreeInventory(commonDir);
  const primary = await authenticatedPrimaryWorktree(commonDir, inventory);
  const memberPath = await realpath(effective.worktree_path).catch(() => null);
  if (memberPath === null) {
    return reconciledAbsentCoordinatorGitAuthority(commonDir, memberRecord, inventory, primary);
  }
  const protectedPaths = new Set([
    resolve(primary.path),
    ...(allowCaller ? [] : [callerRepositoryRoot(commonDir)]),
  ].filter(Boolean));
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
      : owned.detached || owned.branch !== effective.branch)
  ) throw new CliError("Coordinator worktree is not an eligible linked task worktree", 73);
  const snapshot = gitSnapshot(memberPath);
  if (
    resolve(snapshot.root) !== resolve(memberPath)
    || resolve(snapshot.commonDir) !== resolve(commonDir)
    || snapshot.branch !== (registeredDetached ? "detached" : effective.branch)
    || snapshot.revision !== owned.head
    || snapshot.cleanliness !== "clean"
  ) throw new CliError("Coordinator worktree does not match its cleanup authority", 73);
  if (!revisionIsAncestor(commonDir, owned.head, primary.head)) {
    throw new CliError("Coordinator work is not preserved in the source checkout", 73);
  }
  return owned.head;
}

async function archivedCoordinatorGitAuthority(commonDir, memberRecord) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const registeredDetached = effective.branch === "detached";
  if (
    effective.worktree_path === null
    || effective.branch === null
    || (!registeredDetached && !effective.branch.startsWith("codex/"))
  ) throw new CliError("Coordinator closeout requires an exact disposable Codex worktree", 73);
  const inventory = worktreeInventory(commonDir);
  const primary = await authenticatedPrimaryWorktree(commonDir, inventory);
  const memberPath = resolve(effective.worktree_path);
  const protectedPaths = new Set([resolve(primary.path), callerRepositoryRoot(commonDir)].filter(Boolean));
  if (protectedPaths.has(memberPath)) {
    throw new CliError("Coordinator closeout refuses a caller or source checkout", 73);
  }
  if (inventory.some((entry) => resolve(entry.path) === memberPath)) {
    throw new CliError("Coordinator worktree remains registered after archival", 73);
  }
  if (!(await pathExists(memberPath)) && effective.absence_reconciliation != null) {
    return reconciledAbsentCoordinatorGitAuthority(commonDir, effective, inventory, primary);
  }
  if (registeredDetached) {
    const capturedTip = effective.archive_attempt?.branch_tip ?? null;
    if (capturedTip === null) {
      throw new CliError("Detached coordinator archival lacks an authenticated captured tip", 73);
    }
    if (!revisionIsAncestor(commonDir, capturedTip, primary.head)) {
      throw new CliError("Coordinator work is not preserved in the source checkout", 73);
    }
    return capturedTip;
  }
  const ref = `refs/heads/${effective.branch}`;
  if (attachedWorktreeRefs(commonDir).includes(ref)) {
    throw new CliError("Coordinator branch remains attached after archival", 73);
  }
  const tip = localBranchTip(commonDir, ref);
  if (tip === null || !revisionIsAncestor(commonDir, tip, primary.head)) {
    throw new CliError("Coordinator work is not preserved in the source checkout", 73);
  }
  return tip;
}

function coordinatorOwnershipEvidence(value) {
  requireExactFields(value, {
    required: ["source", "owner_thread_id", "worktree_path", "common_dir", "branch", "revision"],
  }, "coordinator ownership evidence");
  if (value.source !== "codex-app-private") {
    throw new CliError("Coordinator binding correction requires Codex App ownership evidence", 73);
  }
  const revision = requireText(value.revision, "coordinator ownership evidence.revision", { max: 64 });
  if (!REVISION.test(revision)) {
    throw new CliError("Coordinator binding correction requires a concrete Git revision", 73);
  }
  return {
    source: value.source,
    owner_thread_id: requireText(value.owner_thread_id, "coordinator ownership evidence.owner_thread_id", { max: 256, safeId: true }),
    worktree_path: resolve(requireText(value.worktree_path, "coordinator ownership evidence.worktree_path", { max: 2048 })),
    common_dir: resolve(requireText(value.common_dir, "coordinator ownership evidence.common_dir", { max: 2048 })),
    branch: coordinatorBranch(value.branch, "coordinator ownership evidence.branch"),
    revision,
  };
}

/**
 * Records a host-authenticated replacement for a coordinator binding that was
 * originally persisted from the wrong checkout. The original binding remains
 * in the immutable assignment and iteration identity; cleanup reads this
 * auditable correction instead of overwriting it.
 */
export async function reconcileCoordinatorWorktreeBinding({
  commonDir,
  iterationId,
  coordinatorThreadId,
  ownershipEvidence,
  now = Date.now(),
}) {
  const common = resolve(requireText(commonDir, "common_dir", { max: 2048 }));
  const coordinator = requireText(coordinatorThreadId, "coordinator_thread_id", { max: 256, safeId: true });
  const evidence = coordinatorOwnershipEvidence(ownershipEvidence);
  if (evidence.common_dir !== common || evidence.owner_thread_id !== coordinator) {
    throw new CliError("Coordinator binding correction evidence does not match its assigned task or repository", 73);
  }
  return withWorktreeOwnershipLock(common, () => reconcileCoordinatorWorktreeBindingUnderLock({
    common,
    iterationId,
    coordinator,
    evidence,
    now,
  }));
}

async function reconcileCoordinatorWorktreeBindingUnderLock({
  common,
  iterationId,
  coordinator,
  evidence,
  now,
}) {
  const current = await iterationStatus({ commonDir: common, iterationId });
  const memberRecord = current.members.find((entry) => entry.role === "coordinator");
  if (
    memberRecord === undefined
    || memberRecord.thread_id !== coordinator
    || memberRecord.archive_attempt !== null
    || memberRecord.state === "archived"
  ) throw new CliError("Coordinator binding correction is no longer eligible", 73);
  await acceptedCoordinatorResultAuthority(memberRecord);
  const corrected = { worktree_path: evidence.worktree_path, branch: evidence.branch };
  const correction = {
    kind: "codex-app-worktree-owner-v1",
    corrected_at: new Date(now).toISOString(),
    original: coordinatorBinding({
      worktree_path: memberRecord.worktree_path,
      branch: memberRecord.branch,
    }, "recorded coordinator binding", { disposable: false }),
    corrected,
    owner_thread_id: coordinator,
    revision: evidence.revision,
    evidence_digest: sha256(stableStringify(evidence)),
  };
  if (memberRecord.binding_correction !== undefined && memberRecord.binding_correction !== null) {
    const { corrected_at: existingAt, ...existingAuthority } = memberRecord.binding_correction;
    const { corrected_at: requestedAt, ...requestedAuthority } = correction;
    if (stableStringify(existingAuthority) !== stableStringify(requestedAuthority)) {
      throw new CliError("Coordinator binding was already corrected with different authority", 73);
    }
    return { status: "already-corrected", iteration: current };
  }
  const candidate = { ...memberRecord, ...corrected };
  const tip = await coordinatorGitAuthority(common, candidate, { allowCaller: true });
  if (tip !== evidence.revision) {
    throw new CliError("Coordinator binding correction revision does not match its live worktree", 73);
  }
  await assertIterationWorktreeOwnership(common, iterationId, candidate, {
    requirePersistedCurrent: null,
  });
  const iteration = await updateIteration(common, iterationId, async (record) => {
    const persisted = record.members.find((entry) => entry.member_id === memberRecord.member_id);
    if (
      persisted === undefined
      || (persisted.binding_correction !== undefined && persisted.binding_correction !== null)
      || persisted.thread_id !== coordinator
      || persisted.archive_attempt !== null
    ) throw new CliError("Coordinator binding changed before correction could be recorded", 73);
    return {
      ...record,
      members: record.members.map((entry) => entry.member_id === memberRecord.member_id ? {
        ...entry,
        binding_correction: correction,
        updated_at: correction.corrected_at,
      } : entry),
      updated_at: correction.corrected_at,
    };
  });
  return { status: "corrected", iteration };
}

/**
 * Admits a narrowly scoped resource-loss recovery after the director accepted
 * the exact report. It does not infer a vanished branch tip: the director must
 * repeat either the exact pre-archive capture or a uniquely bound completed
 * coordinator-work final revision. The registry records that authority before
 * normal native archival is retried. If neither record exists, it fails closed
 * rather than treating a director-selected ancestor as result evidence.
 */
export async function reconcileAcceptedCoordinatorResourceAbsence({
  commonDir,
  iterationId,
  directorThreadId,
  preservedTip,
  now = Date.now(),
}) {
  const common = resolve(requireText(commonDir, "common_dir", { max: 2048 }));
  const director = requireText(directorThreadId, "director_thread_id", { max: 256, safeId: true });
  const tip = requireText(preservedTip, "preserved_tip", { max: 64 });
  if (!REVISION.test(tip)) throw new CliError("preserved_tip must be a concrete Git revision", 73);
  const current = await iterationStatus({ commonDir: common, iterationId });
  const memberRecord = current.members.find((entry) => entry.role === "coordinator");
  if (
    memberRecord === undefined
    || memberRecord.state === "archived"
  ) throw new CliError("Coordinator resource-loss recovery is no longer eligible", 73);
  const { assignment, report } = await acceptedCoordinatorResultAuthority(memberRecord);
  if (
    assignment.recipient.thread_id !== director
    || assignment.acceptance.accepted_by_thread_id !== director
  ) throw new CliError("Only the director that accepted the exact coordinator result can reconcile missing resources", 73);
  const binding = coordinatorBinding(effectiveCoordinatorBinding(memberRecord), "effective coordinator binding");
  const existing = memberRecord.absence_reconciliation ?? null;
  const capturedTip = memberRecord.archive_attempt?.branch_tip ?? null;
  let resultAuthority = existing?.result_authority;
  let authoritativeTip;
  if (resultAuthority !== undefined) {
    resultAuthority = await assertCompletedCoordinatorWorkResultAuthority({
      commonDir: common,
      memberRecord,
      assignment,
      expected: resultAuthority,
    });
    authoritativeTip = resultAuthority.final_revision;
  } else if (existing !== null) {
    if (memberRecord.archive_attempt?.branch_tip !== existing.preserved_tip) {
      throw new CliError("Coordinator absence reconciliation is not bound to its authenticated captured result tip", 73);
    }
    authoritativeTip = existing.preserved_tip;
  } else if (capturedTip !== null && memberRecord.archive_attempt?.state === "prepared") {
    authoritativeTip = capturedTip;
  } else {
    resultAuthority = await completedCoordinatorWorkResultForAbsence({
      commonDir: common,
      memberRecord,
      assignment,
    });
    authoritativeTip = resultAuthority.final_revision;
  }
  if (tip !== authoritativeTip) {
    throw new CliError("Coordinator recovery preserved_tip does not match the authenticated coordinator result tip", 73);
  }
  const inventory = worktreeInventory(common);
  const primary = await authenticatedPrimaryWorktree(common, inventory);
  if (
    await pathExists(binding.worktree_path)
    || inventory.some((entry) => resolve(entry.path) === binding.worktree_path)
  ) throw new CliError("Coordinator resource-loss recovery requires the registered worktree to be absent", 73);
  if (binding.branch !== "detached") {
    const ref = `refs/heads/${binding.branch}`;
    if (attachedWorktreeRefs(common).includes(ref) || localBranchTip(common, ref) !== null) {
      throw new CliError("Coordinator resource-loss recovery requires the registered branch to be absent", 73);
    }
  }
  if (!revisionIsAncestor(common, authoritativeTip, primary.head)) {
    throw new CliError("Coordinator resource-loss recovery tip is not preserved in the source checkout", 73);
  }
  const reconciliation = {
    kind: "accepted-coordinator-resources-absent-v1",
    reconciled_at: new Date(now).toISOString(),
    reconciled_by_thread_id: director,
    accepted_report_id: report.report_id,
    accepted_report_digest: report.source_text_digest,
    binding,
    preserved_tip: authoritativeTip,
    ...(resultAuthority === undefined ? {} : { result_authority: resultAuthority }),
  };
  if (existing !== null) {
    const { reconciled_at: existingAt, ...existingAuthority } = existing;
    const { reconciled_at: requestedAt, ...requestedAuthority } = reconciliation;
    if (stableStringify(existingAuthority) !== stableStringify(requestedAuthority)) {
      throw new CliError("Coordinator resources were already reconciled with different authority", 73);
    }
    return { status: "already-reconciled", iteration: current };
  }
  const iteration = await updateIteration(common, iterationId, async (record) => {
    const persisted = record.members.find((entry) => entry.member_id === memberRecord.member_id);
    if (
      persisted === undefined
      || (persisted.absence_reconciliation !== undefined && persisted.absence_reconciliation !== null)
      || (resultAuthority === undefined
        ? (
          persisted.archive_attempt?.state !== "prepared"
          || persisted.archive_attempt.branch_tip !== authoritativeTip
        )
        : persisted.archive_attempt !== null)
    ) throw new CliError("Coordinator resource state changed before reconciliation could be recorded", 73);
    return {
      ...record,
      members: record.members.map((entry) => entry.member_id === memberRecord.member_id ? {
        ...entry,
        absence_reconciliation: reconciliation,
        updated_at: reconciliation.reconciled_at,
      } : entry),
      updated_at: reconciliation.reconciled_at,
    };
  });
  return { status: "reconciled", iteration };
}

async function assertIterationTipPreserved(
  commonDir,
  memberRecord,
  expectedTip,
  archiveAuthority = null,
) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const primary = await authenticatedPrimaryWorktree(commonDir, worktreeInventory(commonDir));
  if (effective.role === "executor") {
    assertExecutorResultPreserved(commonDir, effective, expectedTip, archiveAuthority);
  } else if (!revisionIsAncestor(commonDir, expectedTip, primary.head)) {
    throw new CliError("Coordinator work is no longer preserved in the source checkout", 73);
  }
  if (resolve(effective.worktree_path) === resolve(primary.path)) {
    throw new CliError("Iteration cleanup refuses the source checkout", 73);
  }
}

function assertExactResultOwner({
  commonDir,
  executorBranch,
  ownerBranch,
  requiredTip,
  label,
}) {
  if (ownerBranch === executorBranch) {
    throw new CliError(`${label} cannot use the disposable executor branch as its preservation owner`, 73);
  }
  const ownerTip = localBranchTip(commonDir, `refs/heads/${ownerBranch}`);
  if (ownerTip === null) {
    throw new CliError(`${label} preservation branch is absent`, 73);
  }
  if (!revisionIsAncestor(commonDir, requiredTip, ownerTip)) {
    throw new CliError(`${label} preservation branch no longer descends from its authenticated tip`, 73);
  }
}

function assertExecutorResultPreserved(commonDir, memberRecord, expectedTip, archiveAuthority) {
  const noChange = archiveAuthority?.noChangePreservation ?? null;
  if (noChange !== null) {
    if (
      noChange.executor_tip !== expectedTip
      || noChange.source_tip !== expectedTip
    ) throw new CliError("No-change cleanup authority does not match the executor result", 73);
    assertExactResultOwner({
      commonDir,
      executorBranch: memberRecord.branch,
      ownerBranch: noChange.source_branch,
      requiredTip: noChange.source_tip,
      label: "No-change launch source",
    });
    return;
  }

  const integration = archiveAuthority?.integrationPreservation ?? null;
  if (
    integration === null
    || !["ancestor", "patch-equivalent"].includes(integration.outcome)
    || integration.executor_tip !== expectedTip
  ) throw new CliError("Integrated cleanup authority does not match the accepted executor result", 73);
  assertExactResultOwner({
    commonDir,
    executorBranch: memberRecord.branch,
    ownerBranch: integration.main_branch,
    requiredTip: integration.reconciled_main_tip,
    label: "Reconciled integration target",
  });
}

async function reclaimableIterationWorktree({
  commonDir,
  iterationId,
  memberRecord,
  archiveAuthority,
}) {
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  const persisted = reclamationAuthority(effective);
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
  await assertIterationWorktreeOwnership(commonDir, iterationId, memberRecord, {
    requirePersistedCurrent: true,
  });
  const matches = [];
  for (const entry of inventory) {
    const canonicalEntry = await realpath(entry.path).catch(() => resolve(entry.path));
    if (canonicalEntry === resolve(memberPath)) matches.push(entry);
  }
  if (matches.length !== 1) throw new CliError("Iteration worktree attachment is missing or ambiguous", 73);
  const owned = matches[0];
  const registeredDetached = effective.branch === "detached";
  if (
    owned.bare
    || owned.locked
    || owned.prunable
    || owned.head === null
    || (registeredDetached
      ? !owned.detached || owned.branch !== null
      : owned.detached || owned.branch !== effective.branch)
  ) throw new CliError("Iteration worktree attachment drifted before reclamation", 73);
  const snapshot = gitSnapshot(memberPath);
  if (
    resolve(snapshot.root) !== resolve(memberPath)
    || resolve(snapshot.commonDir) !== resolve(commonDir)
    || snapshot.branch !== (registeredDetached ? "detached" : effective.branch)
    || snapshot.revision !== owned.head
    || snapshot.revision !== persisted.branch_tip
    || snapshot.cleanliness !== "clean"
  ) throw new CliError("Iteration worktree changed after cleanup authority was persisted", 73);
  const ownerThreadId = await codexWorktreeOwnerThread(commonDir, memberPath);
  if (ownerThreadId !== null && ownerThreadId !== effective.thread_id) {
    throw new CliError("Iteration worktree is owned by another Codex task", 73);
  }
  if (effective.role === "executor" && executorExpectedTip(archiveAuthority) !== persisted.branch_tip) {
    throw new CliError("Executor worktree conflicts with its accepted result authority", 73);
  }
  await assertIterationTipPreserved(
    commonDir,
    effective,
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
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  if (!(await pathExists(effective.worktree_path))) {
    return cleanupIterationGit(
      commonDir,
      effective,
      effective.archive_attempt.branch_tip,
      archiveAuthority,
    );
  }
  if (observeArchivedThread === null) return false;
  let observation;
  try {
    observation = await observeArchivedThread({ threadId: effective.thread_id });
  } catch {
    return false;
  }
  if (observation?.thread_id !== effective.thread_id) {
    throw new CliError("Archive observation does not match the iteration member", 73);
  }
  return withWorktreeOwnershipLock(commonDir, () => withProcessLock({
    path: paths(iterationStateRoot(commonDir), iterationId).lock,
    guardRoot: commonDir,
    label: `iteration reclamation ${iterationId}`,
  }, async () => {
    const current = validateIterationRecord(await readJson(
      paths(iterationStateRoot(commonDir), iterationId).record,
      { guardRoot: commonDir },
    ));
    const persisted = current.members.find((entry) => entry.member_id === effective.member_id);
    if (persisted === undefined || !sameReclamationAuthority(persisted, effective)) {
      throw new CliError("Iteration worktree reclamation authority changed before mutation", 73);
    }
    const effectivePersisted = withEffectiveCoordinatorBinding(persisted);
    if (!(await pathExists(effectivePersisted.worktree_path))) {
      return cleanupIterationGit(
        commonDir,
        effectivePersisted,
        effectivePersisted.archive_attempt.branch_tip,
        archiveAuthority,
      );
    }
    const reclaimable = await reclaimableIterationWorktree({
      commonDir,
      iterationId,
      memberRecord: effectivePersisted,
      archiveAuthority,
    });
    await removeWorktree({
      commonDir,
      primaryPath: reclaimable.primary_path,
      worktreePath: reclaimable.path,
      member: effectivePersisted,
    });
    if (
      await pathExists(reclaimable.path)
      || worktreeInventory(commonDir).some((entry) => resolve(entry.path) === resolve(reclaimable.path))
    ) throw new CliError("Iteration worktree remains after non-force reclamation", 73);
    return cleanupIterationGit(commonDir, effectivePersisted, reclaimable.expected_tip, archiveAuthority);
  }));
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
  const effective = withEffectiveCoordinatorBinding(memberRecord);
  if (await pathExists(effective.worktree_path)) return false;
  if (expectedTip === null && effective.role === "coordinator") {
    throw new CliError("Coordinator cleanup lacks an authenticated captured tip", 73);
  }
  await assertNoIterationAttachmentAfterAbsence(commonDir, effective, expectedTip);
  if (expectedTip !== null) {
    await assertIterationTipPreserved(
      commonDir,
      effective,
      expectedTip,
      archiveAuthority,
    );
  }
  if (effective.branch === null || effective.branch === "detached" || expectedTip === null) return true;
  // Assignment closeout owns disposable Codex task branches, never source branches.
  if (!effective.branch.startsWith("codex/")) return true;
  const ref = `refs/heads/${effective.branch}`;
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

function closeoutTaskObservation(value, expectedThreadId, now) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "execution_kind", "thread_id", "source", "active_visible", "archived_visible",
    ],
    optional: ["host_evidence_digest", "observed_at", "activity_state"],
  }, "iteration closeout task observation");
  if (
    value.execution_kind !== "task-thread"
    || value.thread_id !== expectedThreadId
    || typeof value.active_visible !== "boolean"
    || typeof value.archived_visible !== "boolean"
    || value.active_visible === value.archived_visible
  ) throw new CliError("Iteration closeout observation does not match the exact task", 73);
  if (value.active_visible === true) {
    if (value.source !== "typed-host-activity-v1" || value.activity_state !== "idle") {
      throw new CliError("Iteration closeout requires typed idle evidence; active or unknown tasks remain visible", 73);
    }
    const observedAt = Date.parse(value.observed_at);
    const boundary = now instanceof Date ? now.getTime() : now;
    if (
      !Number.isFinite(boundary)
      || Number.isNaN(observedAt)
      || observedAt < boundary - 30_000
      || observedAt > boundary + 5_000
    ) throw new CliError("Iteration closeout idle evidence is stale or future-dated", 73);
  } else {
    const observedAt = Date.parse(value.observed_at);
    const boundary = now instanceof Date ? now.getTime() : now;
    if (
      !Number.isFinite(boundary)
      || Number.isNaN(observedAt)
      || observedAt < boundary - 30_000
      || observedAt > boundary + 5_000
    ) throw new CliError("Iteration closeout archived evidence is missing, stale, or future-dated", 73);
  }
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

function closeoutClockNow(clock) {
  if (typeof clock !== "function") throw new CliError("closeout clock must be callable");
  const sampled = clock();
  const milliseconds = sampled instanceof Date ? sampled.getTime() : sampled;
  if (!Number.isFinite(milliseconds)) throw new CliError("closeout clock must produce a finite timestamp");
  return milliseconds;
}

async function observeExactArchive(observeArchivedThread, candidate, suppliedObservation, now, clock) {
  if (suppliedObservation?.archived_visible === true) {
    return { observation: suppliedObservation, reconciliation_now: now };
  }
  if (observeArchivedThread === null) return null;
  try {
    // The archive observer is asynchronous. Sample the completion boundary only
    // after its evidence arrives so reconciliation cannot predate observation.
    const observed = await observeArchivedThread({ threadId: candidate.thread_id });
    const reconciliationNow = closeoutClockNow(clock);
    const observation = closeoutTaskObservation(
      observed,
      candidate.thread_id,
      reconciliationNow,
    );
    return observation?.active_visible === false && observation.archived_visible === true
      ? { observation, reconciliation_now: reconciliationNow }
      : null;
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
  return { current, reclaimed };
}

async function markOwningHostMemberArchived({
  commonDir,
  iterationId,
  memberId,
  now,
}) {
  const completedAt = new Date(now).toISOString();
  return updateIteration(commonDir, iterationId, async (record) => ({
    ...record,
    members: record.members.map((entry) => entry.member_id === memberId ? {
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
  now = null,
  clock = null,
}) {
  if (observeArchivedThread !== null && typeof observeArchivedThread !== "function") {
    throw new CliError("closeout archive observer must be callable");
  }
  if (typeof removeWorktree !== "function") throw new CliError("closeout worktree remover must be callable");
  if (clock !== null && typeof clock !== "function") throw new CliError("closeout clock must be callable");
  // Explicit `now` is the existing deterministic test seam. Production calls
  // omit it and therefore sample the system clock again after observation.
  const automaticClock = clock ?? (now === null ? Date.now : () => now);
  const entryNow = now ?? closeoutClockNow(automaticClock);
  let completionNow = entryNow;
  let current = await iterationStatus({ commonDir, iterationId });
  if (current.state === "cancelled") return { status: "cancelled", iteration: current };
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
        updated_at: new Date(entryNow).toISOString(),
      }));
    }
    return { status: complete ? "closed" : phaseComplete ? "phase-complete" : "pending", iteration: current };
  }
  const eligibility = await assertMemberEligible(candidate, allowCoordinator);
  if (eligibility.status !== "eligible") return { status: "pending", iteration: current };
  let observation = closeoutTaskObservation(taskObservation, candidate.thread_id, entryNow);

  if (candidate.role === "executor") {
    const stateRoot = candidate.authority.state_root;
    const dispositionId = eligibility.authority.disposition.disposition_id;
    let archive = await taskArchiveForDisposition({ stateRoot, dispositionId });
    if (archive === null) {
      if (observation === null) {
        const automatic = await observeExactArchive(
          observeArchivedThread,
          candidate,
          null,
          entryNow,
          automaticClock,
        );
        observation = automatic?.observation ?? null;
        completionNow = automatic?.reconciliation_now ?? entryNow;
      }
      if (observation === null) {
        return {
          status: "observation-required",
          observation_request: { thread_id: candidate.thread_id, expected_surface: "active-or-archived" },
          iteration: current,
        };
      }
      archive = await prepareTaskArchive({
        stateRoot,
        dispositionId,
        taskObservation: observation,
        hostId: candidate.host_id,
        now: completionNow,
      });
    }
    if (candidate.archive_attempt === null) {
      const branchTip = await captureBranchTip(commonDir, candidate, eligibility.authority);
      const alreadyArchived = archive.state !== "prepared";
      current = await updateMemberArchiveAttempt({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        attempt: {
          attempt_id: archive.host_intent.attempt_id,
          state: alreadyArchived ? "accepted" : "prepared",
          started_at: archive.prepared_at,
          completed_at: alreadyArchived ? archive.updated_at : null,
          result_digest: alreadyArchived ? sha256(stableStringify(observation)) : null,
          reason: alreadyArchived ? "host-archive-observed" : "owning-host-action-prepared",
          branch_tip: branchTip,
        },
        state: alreadyArchived ? "archive-pending" : "accepted",
        now: completionNow,
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
        now: entryNow,
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
          completed_at: new Date(entryNow).toISOString(),
          result_digest: sha256(stableStringify(result)),
          reason: result.reason ?? result.error_code ?? (
            result.outcome === "ambiguous" ? "host-outcome-ambiguous" : result.outcome
          ),
        },
        state: attemptState === "accepted" ? "archive-pending" : "accepted",
        now: entryNow,
      });
      candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
      if (result.outcome === "rejected-before-send") {
        return { status: "pending", iteration: current };
      }
    } else if (hostResult !== null) {
      throw new CliError("Archive host result was already reconciled; the host action must not replay", 73);
    }
    // A persisted archive observation proves the earlier setter postcondition,
    // but it cannot authorize a later worktree deletion after a crash. Reuse it
    // only when authenticated filesystem absence leaves bookkeeping to finish.
    const worktreePresent = await pathExists(candidate.worktree_path);
    const automatic = await observeExactArchive(
      observeArchivedThread,
      candidate,
      observation ?? (worktreePresent ? null : archive.observation?.task ?? null),
      completionNow,
      automaticClock,
    );
    const archivedObservation = automatic?.observation ?? null;
    completionNow = automatic?.reconciliation_now ?? completionNow;
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
      now: completionNow,
    });
    const finish = await finishOwningHostMember({
      commonDir,
      iterationId,
      current,
      candidate,
      authority: eligibility.authority,
      observation: archivedObservation,
      removeWorktree,
      now: completionNow,
    });
    current = finish.current;
    if (finish.reclaimed) {
      archive = await reconcileTaskArchive({
        stateRoot,
        archiveId: archive.archive_id,
        attemptId: archive.host_intent.attempt_id,
        outcome: setterOutcome,
        observation: archivedObservation,
        now: completionNow,
      });
      if (archive.state !== "completed") {
        throw new CliError("Executor iteration closeout did not complete its run archive lifecycle", 73);
      }
      current = await markOwningHostMemberArchived({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        now: completionNow,
      });
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
            started_at: new Date(entryNow).toISOString(),
            completed_at: new Date(entryNow).toISOString(),
            result_digest: sha256(stableStringify(observation)),
            reason: "host-archive-observed",
            branch_tip: branchTip,
          },
          state: "archive-pending",
          now: entryNow,
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
            started_at: new Date(entryNow).toISOString(),
            completed_at: null,
            result_digest: null,
            reason: "owning-host-action-prepared",
            branch_tip: branchTip,
          },
          state: "accepted",
          now: entryNow,
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
          completed_at: new Date(entryNow).toISOString(),
          result_digest: sha256(stableStringify(result)),
          reason: result.reason ?? result.error_code ?? (
            result.outcome === "ambiguous" ? "host-outcome-ambiguous" : result.outcome
          ),
        },
        state: attemptState === "accepted" ? "archive-pending" : "accepted",
        now: entryNow,
      });
      candidate = current.members.find((entry) => entry.member_id === candidate.member_id);
      if (attemptState === "blocked") return { status: "pending", iteration: current };
    } else if (hostResult !== null) {
      throw new CliError("Coordinator archive host result was already reconciled; the host action must not replay", 73);
    }
    const automatic = await observeExactArchive(
      observeArchivedThread,
      candidate,
      observation,
      completionNow,
      automaticClock,
    );
    const archivedObservation = automatic?.observation ?? null;
    completionNow = automatic?.reconciliation_now ?? completionNow;
    if (archivedObservation === null) {
      return {
        status: "observation-required",
        observation_request: { thread_id: candidate.thread_id, expected_surface: "archived" },
        iteration: current,
      };
    }
    const finish = await finishOwningHostMember({
      commonDir,
      iterationId,
      current,
      candidate,
      authority: null,
      observation: archivedObservation,
      removeWorktree,
      now: completionNow,
    });
    current = finish.current;
    if (finish.reclaimed) {
      current = await markOwningHostMemberArchived({
        commonDir,
        iterationId,
        memberId: candidate.member_id,
        now: completionNow,
      });
    }
  }

  const disposable = current.members.filter((entry) => !entry.retained);
  const phaseMembers = allowCoordinator ? disposable : disposable.filter((entry) => entry.role === "executor");
  const phaseComplete = phaseMembers.every((entry) => entry.state === "archived");
  const complete = allowCoordinator && disposable.every((entry) => entry.state === "archived");
  if (complete) {
    current = await updateIteration(commonDir, iterationId, async (record) => ({
      ...record,
      state: "closed",
      updated_at: new Date(completionNow).toISOString(),
    }));
  }
  return { status: complete ? "closed" : phaseComplete ? "phase-complete" : "pending", iteration: current };
}
