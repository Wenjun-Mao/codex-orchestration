import { spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { callbackRecordV07 } from "./callbacks-v07.mjs";
import { taskDispositionStatus } from "./dispositions.mjs";
import { gitCommonDirectoryForState, gitSnapshot } from "./git.mjs";
import { serialIntegrationStatus } from "./integration-v07.mjs";
import { taskReleaseStatus } from "./release-lifecycle.mjs";
import { visibleTaskCreationStatus } from "./task-creation-v07.mjs";
import { coordinatorBindingDigest } from "./workflow-plan.mjs";

const ARCHIVE_KIND = "codex-flow-v07-task-archive-operation";
const SETTER_OUTCOMES = ["accepted", "rejected-before-send", "ambiguous"];
const STATES = [
  "prepared",
  "accepted-awaiting-observation",
  "completed",
  "rejected-before-send",
  "ambiguous",
];
const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const VERIFICATION_ID = /^verification-v1-[0-9a-f]{64}$/;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe archive state path");
  }
  return path;
}

function paths(stateRoot, archiveId) {
  requireText(archiveId, "archive_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "archives");
  return {
    record: safeChild(resolve(root, "records"), `${archiveId}.json`),
    lock: safeChild(resolve(root, "locks"), `${archiveId}.lock.json`),
  };
}

function claimPaths(stateRoot, dispositionId) {
  const disposition = requireText(dispositionId, "disposition_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "archives");
  return {
    claim: safeChild(resolve(root, "disposition-claims"), `${disposition}.json`),
    lock: safeChild(resolve(root, "disposition-locks"), `${disposition}.lock.json`),
  };
}

function validateDispositionClaim(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "disposition_id", "archive_id"],
  }, "Archive disposition claim");
  if (value.schema_version !== 1 || value.kind !== "codex-flow-v07-archive-disposition-claim") {
    throw new CliError("Invalid archive disposition claim");
  }
  return {
    schema_version: 1,
    kind: "codex-flow-v07-archive-disposition-claim",
    disposition_id: requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true }),
    archive_id: requireText(value.archive_id, "archive_id", { max: 128, safeId: true }),
  };
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
}

function nowIso(now) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Archive clock must be a finite timestamp");
  return new Date(milliseconds).toISOString();
}

function absolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function validateCoordinatorBinding(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, "coordinator_binding");
  const binding = {
    lineage_id: requireText(value.lineage_id, "coordinator_binding.lineage_id", {
      max: 128,
      safeId: true,
    }),
    thread_id: requireText(value.thread_id, "coordinator_binding.thread_id", {
      max: 256,
      safeId: true,
    }),
    generation: requireInteger(value.generation, "coordinator_binding.generation", {
      min: 1,
      max: 2147483647,
    }),
    binding_digest: digest(value.binding_digest, "coordinator_binding.binding_digest"),
  };
  if (binding.binding_digest !== coordinatorBindingDigest(binding)) {
    throw new CliError("coordinator_binding.binding_digest is invalid");
  }
  return binding;
}

function identityMatches(left, right, keys) {
  return keys.every((key) => stableStringify(left[key]) === stableStringify(right[key]));
}

const CANONICAL_IDENTITY_KEYS = [
  "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
  "common_dir", "coordinator_binding", "plan_id", "revision_digest", "task_id",
  "task_digest", "contract_id", "operation_id", "release_id", "executor_thread_id",
];

function nullableText(value, label, { max = 256 } = {}) {
  return value === null ? null : requireText(value, label, { max });
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new CliError(`${label} must be a boolean`);
  return value;
}

function validateTaskObservation(value, label) {
  requireExactFields(value, {
    required: [
      "execution_kind", "thread_id", "source", "active_visible", "archived_visible",
    ],
  }, label);
  const result = {
    execution_kind: requireEnum(value.execution_kind, ["task-thread"], `${label}.execution_kind`),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    source: requireEnum(value.source, ["host-observed"], `${label}.source`),
    active_visible: boolean(value.active_visible, `${label}.active_visible`),
    archived_visible: boolean(value.archived_visible, `${label}.archived_visible`),
  };
  if (result.active_visible === result.archived_visible) {
    throw new CliError(`${label} must identify exactly one active or archived visibility surface`);
  }
  return result;
}

function validateHostIntent(value) {
  requireExactFields(value, {
    required: ["action", "attempt_id", "thread_id", "host_id", "archived"],
  }, "Archive host intent");
  if (value.action !== "set-thread-archived" || value.archived !== true) {
    throw new CliError("Archive host intent must set one task thread to archived");
  }
  return {
    action: "set-thread-archived",
    attempt_id: requireText(value.attempt_id, "host_intent.attempt_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "host_intent.thread_id", { max: 256, safeId: true }),
    host_id: nullableText(value.host_id, "host_intent.host_id"),
    archived: true,
  };
}

function validateGitResolution(value) {
  requireExactFields(value, {
    required: ["kind", "integration_id", "verification_id", "verification_digest"],
  }, "Archive Git resolution");
  const kind = requireEnum(value.kind, ["unchanged", "integrated"], "git_resolution.kind");
  const integrationId = value.integration_id === null
    ? null
    : requireText(value.integration_id, "git_resolution.integration_id", { max: 128, safeId: true });
  if ((kind === "integrated") !== (integrationId !== null)) {
    throw new CliError("Archive Git resolution integration evidence is inconsistent");
  }
  const verificationId = requireText(value.verification_id, "git_resolution.verification_id", {
    max: 128,
    safeId: true,
  });
  if (!VERIFICATION_ID.test(verificationId)) {
    throw new CliError("git_resolution.verification_id must be a v1 verification ID");
  }
  return {
    kind,
    integration_id: integrationId,
    verification_id: verificationId,
    verification_digest: digest(value.verification_digest, "git_resolution.verification_digest"),
  };
}

function validateWorktree(value) {
  requireExactFields(value, {
    required: ["management", "path", "prepared_state"],
  }, "Archive worktree");
  const management = requireEnum(value.management, ["none", "host-managed"], "worktree.management");
  const path = nullableText(value.path, "worktree.path", { max: 2048 });
  const preparedState = requireEnum(
    value.prepared_state,
    ["not-applicable", "absent", "present-clean"],
    "worktree.prepared_state",
  );
  if (management === "none" && (path !== null || preparedState !== "not-applicable")) {
    throw new CliError("Unmanaged task archive cannot bind a worktree path");
  }
  if (management === "host-managed" && (path === null || preparedState === "not-applicable")) {
    throw new CliError("Host-managed task archive requires its exact worktree path and state");
  }
  return { management, path, prepared_state: preparedState };
}

function validateSetter(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["outcome", "reconciled_at"],
  }, "Archive setter reconciliation");
  return {
    outcome: requireEnum(value.outcome, SETTER_OUTCOMES, "archive setter outcome"),
    reconciled_at: timestamp(value.reconciled_at, "setter.reconciled_at"),
  };
}

function validateArchiveObservation(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["task", "worktree_state", "observed_at"],
  }, "Archive observation");
  return {
    task: validateTaskObservation(value.task, "archive observation.task"),
    worktree_state: requireEnum(
      value.worktree_state,
      ["not-applicable", "absent"],
      "archive observation.worktree_state",
    ),
    observed_at: timestamp(value.observed_at, "archive observation.observed_at"),
  };
}

export function validateArchiveOperation(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "archive_id", "run_id", "runtime_context_digest",
      "configuration_digest", "repository_id", "common_dir", "coordinator_binding",
      "plan_id", "revision_digest", "task_id", "task_digest", "contract_id",
      "operation_id", "release_id", "executor_thread_id", "callback_id", "disposition_id",
      "decision", "task", "host_intent", "git_resolution", "worktree", "setter",
      "observation", "state", "prepared_at", "updated_at",
    ],
  }, "Task archive operation");
  if (value.schema_version !== 1 || value.kind !== ARCHIVE_KIND) {
    throw new CliError("Invalid v0.7 task archive operation schema");
  }
  const record = {
    schema_version: 1,
    kind: ARCHIVE_KIND,
    archive_id: requireText(value.archive_id, "archive_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, "runtime_context_digest"),
    configuration_digest: digest(value.configuration_digest, "configuration_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: absolutePath(value.common_dir, "common_dir"),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, "task_digest"),
    contract_id: digest(value.contract_id, "contract_id"),
    operation_id: requireText(value.operation_id, "operation_id", { max: 128, safeId: true }),
    release_id: requireText(value.release_id, "release_id", { max: 128, safeId: true }),
    executor_thread_id: requireText(value.executor_thread_id, "executor_thread_id", {
      max: 256,
      safeId: true,
    }),
    callback_id: requireText(value.callback_id, "callback_id", { max: 128, safeId: true }),
    disposition_id: requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true }),
    decision: requireEnum(
      value.decision,
      ["accepted-no-change", "accepted-for-integration"],
      "archive decision",
    ),
    task: validateTaskObservation(value.task, "archive task"),
    host_intent: validateHostIntent(value.host_intent),
    git_resolution: validateGitResolution(value.git_resolution),
    worktree: validateWorktree(value.worktree),
    setter: validateSetter(value.setter),
    observation: validateArchiveObservation(value.observation),
    state: requireEnum(value.state, STATES, "archive state"),
    prepared_at: timestamp(value.prepared_at, "prepared_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  };
  if (record.task.thread_id !== record.host_intent.thread_id) {
    throw new CliError("Archive task identity does not match its host intent");
  }
  if (Date.parse(record.updated_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Archive updated_at predates prepared_at");
  }
  if (record.setter && (
    Date.parse(record.setter.reconciled_at) < Date.parse(record.prepared_at)
    || Date.parse(record.setter.reconciled_at) > Date.parse(record.updated_at)
  )) throw new CliError("Archive setter timestamp is outside the archive lifecycle");
  if (record.observation && (
    Date.parse(record.observation.observed_at) < Date.parse(record.prepared_at)
    || Date.parse(record.observation.observed_at) > Date.parse(record.updated_at)
  )) throw new CliError("Archive observation timestamp is outside the archive lifecycle");
  if (archiveIdFor(record) !== record.archive_id) {
    throw new CliError("Task archive content identity is invalid");
  }
  if (attemptIdFor(record.archive_id) !== record.host_intent.attempt_id) {
    throw new CliError("Task archive host attempt identity is invalid");
  }
  if (record.task.active_visible !== true || record.task.archived_visible !== false) {
    throw new CliError("Archive preparation requires an independently observed visible task thread");
  }
  if (record.decision === "accepted-no-change" && record.git_resolution.kind !== "unchanged") {
    throw new CliError("Accepted no-change archive requires unchanged Git resolution");
  }
  if (record.decision === "accepted-for-integration" && record.git_resolution.kind !== "integrated") {
    throw new CliError("Accepted integration archive requires completed integration resolution");
  }
  if ((record.setter === null) !== (record.state === "prepared")) {
    throw new CliError("Archive setter reconciliation is inconsistent with state");
  }
  if ((record.observation !== null) !== (record.state === "completed")) {
    throw new CliError("Archive observation is inconsistent with state");
  }
  if (record.state === "completed") {
    if (!["accepted", "ambiguous"].includes(record.setter?.outcome)) {
      throw new CliError("Completed archive requires accepted delivery or an exact postcondition after ambiguity");
    }
    if (
      record.observation.task.thread_id !== record.task.thread_id
      || record.observation.task.active_visible !== false
      || record.observation.task.archived_visible !== true
    ) throw new CliError("Completed archive requires independent archived visibility");
    const expectedWorktreeState = record.worktree.management === "host-managed"
      ? "absent"
      : "not-applicable";
    if (record.observation.worktree_state !== expectedWorktreeState) {
      throw new CliError("Completed archive worktree observation is inconsistent");
    }
  }
  if (
    record.setter?.outcome === "accepted"
    && !["accepted-awaiting-observation", "completed"].includes(record.state)
  ) throw new CliError("Accepted archive setter has an invalid state");
  if (
    record.setter?.outcome === "rejected-before-send"
    && record.state !== "rejected-before-send"
  ) throw new CliError("Rejected archive setter outcome must remain visible");
  if (
    record.setter?.outcome === "ambiguous"
    && !["ambiguous", "completed"].includes(record.state)
  ) throw new CliError("Ambiguous archive setter requires an exact observed postcondition to complete");
  return record;
}

function archiveIdentity(value) {
  return {
    ...Object.fromEntries(CANONICAL_IDENTITY_KEYS.map((key) => [key, value[key]])),
    callback_id: value.callback_id,
    disposition_id: value.disposition_id,
    decision: value.decision,
    task: value.task,
    git_resolution: value.git_resolution,
    worktree: {
      management: value.worktree.management,
      path: value.worktree.path,
    },
    host_id: value.host_intent.host_id,
  };
}

export function archiveIdFor(value) {
  return `archive-v1-${sha256(stableStringify(archiveIdentity(value)))}`;
}

function attemptIdFor(archiveId) {
  return `archive-attempt-v1-${sha256(archiveId)}`;
}

function view(record, { dispatchPermitted = false } = {}) {
  return {
    ...record,
    call_required: dispatchPermitted,
    keep_visible: record.state !== "completed",
  };
}

async function readRecord(stateRoot, archiveId) {
  const location = paths(stateRoot, archiveId);
  const raw = await readJson(location.record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (!raw) throw new CliError("Task archive operation does not exist");
  return { location, record: validateArchiveOperation(raw) };
}

function runGit(cwd, args, label) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return result.stdout;
}

async function pathPresent(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function inspectWorktree(stateRoot, authority, gitOutcome) {
  requireExactFields(authority, {
    required: ["management", "path"],
  }, "Persisted archive worktree authority");
  const management = requireEnum(
    authority.management,
    ["none", "host-managed"],
    "worktree.management",
  );
  if (management === "none") {
    if (authority.path !== null) throw new CliError("Unmanaged archive worktree path must be null");
    return { management, path: null, prepared_state: "not-applicable" };
  }
  const observedPath = absolutePath(authority.path, "worktree.path");
  const canonical = await realpath(observedPath).catch(() => null);
  if (canonical === null) {
    if (await pathPresent(observedPath)) throw new CliError("Host-managed worktree cannot be resolved");
    return { management, path: observedPath, prepared_state: "absent" };
  }
  if (canonical !== observedPath) {
    throw new CliError("Observed host-managed worktree path must identify its canonical Git root");
  }
  const snapshot = gitSnapshot(canonical);
  if (await realpath(snapshot.root) !== canonical) {
    throw new CliError("Host-managed worktree path must identify the exact Git worktree root");
  }
  if (await realpath(snapshot.commonDir) !== await realpath(guardRoot(stateRoot))) {
    throw new CliError("Host-managed worktree belongs to a different Git repository");
  }
  const status = runGit(canonical, [
    "-c", "status.showUntrackedFiles=all",
    "status", "--porcelain=v1", "--untracked-files=all",
  ], "Archive worktree cleanliness check");
  if (status !== "") throw new CliError("Dirty worktree must remain visible and cannot be archived", 73);
  const expectedRevision = gitOutcome.kind === "unchanged"
    ? gitOutcome.final_revision
    : gitOutcome.commit;
  if (snapshot.revision !== expectedRevision) {
    throw new CliError("Archive worktree revision does not match the terminal Git outcome", 73);
  }
  if (gitOutcome.branch !== null && snapshot.branch !== gitOutcome.branch) {
    throw new CliError("Archive worktree branch does not match the terminal Git outcome", 73);
  }
  return { management, path: canonical, prepared_state: "present-clean" };
}

function archiveWorktreeAuthority(creation) {
  const requested = creation.selector_evidence.requested.worktree;
  if (requested.mode === "local") {
    return { management: "none", path: null };
  }
  const binding = creation.worktree_binding;
  if (binding?.state !== "completed") {
    throw new CliError(
      "Host-worktree task archive requires completed worktree binding authority",
      73,
    );
  }
  return { management: "host-managed", path: binding.worktree_path };
}

async function resolvedAuthority(stateRoot, dispositionId) {
  const disposition = await taskDispositionStatus({ stateRoot, dispositionId });
  if (disposition.state !== "completed") {
    throw new CliError("Task archive requires a finalized disposition and consumed callback", 73);
  }
  if (!["accepted-no-change", "accepted-for-integration"].includes(disposition.decision)) {
    throw new CliError("Blocked, rejected, or cancelled tasks must remain visible", 73);
  }
  const callback = await callbackRecordV07({ stateRoot, callbackId: disposition.callback_id });
  if (
    callback.state !== "consumed"
    || callback.disposition_id !== disposition.disposition_id
    || !identityMatches(disposition, callback.receipt, CANONICAL_IDENTITY_KEYS.filter(
      (key) => key !== "coordinator_binding",
    ))
    || !identityMatches(disposition.coordinator_binding, callback.receipt.recipient, [
      "lineage_id", "thread_id", "generation", "binding_digest",
    ])
  ) throw new CliError("Task archive requires the exact preserved and consumed callback", 73);
  if (callback.receipt.git_outcome.kind === "dirty-blocked") {
    throw new CliError("Dirty task outcome must remain visible", 73);
  }
  const release = await taskReleaseStatus({ stateRoot, releaseId: callback.receipt.release_id });
  if (
    release.status !== "accepted"
    || !identityMatches(release, callback.receipt, CANONICAL_IDENTITY_KEYS.filter(
      (key) => !["coordinator_binding", "executor_thread_id"].includes(key),
    ))
    || !identityMatches(release.coordinator_binding, callback.receipt.recipient, [
      "lineage_id", "thread_id", "generation", "binding_digest",
    ])
    || release.ready_thread_id !== callback.receipt.executor_thread_id
    || release.ready_thread_id !== release.acceptance.ready_thread_id
  ) throw new CliError("Task archive requires the exact accepted visible-task release", 73);
  const creation = await visibleTaskCreationStatus({
    stateRoot,
    operationId: release.operation_id,
  });
  const creationIdentityKeys = CANONICAL_IDENTITY_KEYS.filter(
    (key) => !["release_id", "executor_thread_id"].includes(key),
  );
  if (
    creation.status !== "ready-unreleased"
    || creation.operation_id !== release.operation_id
    || creation.ready?.thread_id !== release.ready_thread_id
    || !identityMatches(creation, release, creationIdentityKeys)
  ) throw new CliError("Task archive requires the exact ready visible-task creation authority", 73);
  const worktreeAuthority = archiveWorktreeAuthority(creation);

  if (disposition.decision === "accepted-no-change") {
    if (
      callback.receipt.git_outcome.kind !== "unchanged"
      || disposition.integration_id !== null
      || disposition.verification_id === null
      || disposition.verification_digest === null
    ) throw new CliError("Accepted no-change archive lacks resolved Git evidence", 73);
    return {
      disposition,
      callback,
      release,
      creation,
      worktreeAuthority,
      gitResolution: {
        kind: "unchanged",
        integration_id: null,
        verification_id: disposition.verification_id,
        verification_digest: disposition.verification_digest,
      },
    };
  }

  if (
    callback.receipt.git_outcome.kind !== "clean-commit"
    || disposition.integration_id === null
    || disposition.verification_id === null
    || disposition.verification_digest === null
  ) throw new CliError("Accepted integration archive lacks resolved Git evidence", 73);
  const integration = await serialIntegrationStatus({
    stateRoot,
    integrationId: disposition.integration_id,
  });
  if (
    integration.state !== "reconciled"
    || integration.safe_to_finalize !== true
    || integration.disposition_id !== disposition.disposition_id
    || integration.callback_id !== callback.callback_id
    || !identityMatches(integration, disposition, CANONICAL_IDENTITY_KEYS)
    || integration.verification_id !== disposition.verification_id
    || integration.combined_verification_digest !== disposition.verification_digest
  ) throw new CliError("Task archive requires exact completed integration evidence", 73);
  return {
    disposition,
    callback,
    release,
    creation,
    worktreeAuthority,
    gitResolution: {
      kind: "integrated",
      integration_id: integration.integration_id,
      verification_id: integration.verification_id,
      verification_digest: integration.combined_verification_digest,
    },
  };
}

export async function prepareTaskArchive(options) {
  requireExactFields(options, {
    required: ["stateRoot", "dispositionId", "taskObservation"],
    optional: ["hostId", "now"],
  }, "Archive preparation request");
  const {
    stateRoot,
    dispositionId,
    taskObservation,
    hostId = null,
    now = Date.now(),
  } = options;
  const authority = await resolvedAuthority(stateRoot, dispositionId);
  const task = validateTaskObservation(taskObservation, "task observation");
  if (task.active_visible !== true || task.archived_visible !== false) {
    throw new CliError("Task archive preparation requires current active visibility", 73);
  }
  if (task.thread_id !== authority.release.ready_thread_id) {
    throw new CliError("Observed task thread does not match the accepted release", 73);
  }
  const archiveWorktree = await inspectWorktree(
    stateRoot,
    authority.worktreeAuthority,
    authority.callback.receipt.git_outcome,
  );
  const causal = {
    run_id: authority.disposition.run_id,
    runtime_context_digest: authority.disposition.runtime_context_digest,
    configuration_digest: authority.disposition.configuration_digest,
    repository_id: authority.disposition.repository_id,
    common_dir: authority.disposition.common_dir,
    coordinator_binding: authority.disposition.coordinator_binding,
    plan_id: authority.disposition.plan_id,
    revision_digest: authority.disposition.revision_digest,
    task_id: authority.disposition.task_id,
    task_digest: authority.disposition.task_digest,
    contract_id: authority.disposition.contract_id,
    operation_id: authority.disposition.operation_id,
    release_id: authority.release.release_id,
    executor_thread_id: authority.disposition.executor_thread_id,
    callback_id: authority.callback.callback_id,
    disposition_id: authority.disposition.disposition_id,
    decision: authority.disposition.decision,
    task,
    host_intent: {
      action: "set-thread-archived",
      attempt_id: "pending",
      thread_id: task.thread_id,
      host_id: nullableText(hostId, "host_id"),
      archived: true,
    },
    git_resolution: authority.gitResolution,
    worktree: archiveWorktree,
  };
  const archiveId = archiveIdFor(causal);
  causal.host_intent.attempt_id = attemptIdFor(archiveId);
  const preparedAt = nowIso(now);
  const record = validateArchiveOperation({
    schema_version: 1,
    kind: ARCHIVE_KIND,
    archive_id: archiveId,
    ...causal,
    setter: null,
    observation: null,
    state: "prepared",
    prepared_at: preparedAt,
    updated_at: preparedAt,
  });
  const location = paths(stateRoot, archiveId);
  const claimLocation = claimPaths(stateRoot, authority.disposition.disposition_id);
  return withProcessLock({
    path: claimLocation.lock,
    guardRoot: guardRoot(stateRoot),
    label: `task archive disposition ${authority.disposition.disposition_id}`,
  }, async () => {
    const existingClaimRaw = await readJson(claimLocation.claim, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existingClaimRaw) {
      const existingClaim = validateDispositionClaim(existingClaimRaw);
      if (
        existingClaim.disposition_id !== authority.disposition.disposition_id
        || existingClaim.archive_id !== archiveId
      ) throw new CliError("Disposition already has a different exact archive intent", 73);
    }
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing) {
      const validated = validateArchiveOperation(existing);
      if (stableStringify(archiveIdentity(validated)) !== stableStringify(archiveIdentity(record))) {
        throw new CliError("Existing task archive does not match prepared authority", 73);
      }
      await ensureExactJson(claimLocation.claim, {
        schema_version: 1,
        kind: "codex-flow-v07-archive-disposition-claim",
        disposition_id: authority.disposition.disposition_id,
        archive_id: archiveId,
      }, { guardRoot: guardRoot(stateRoot) });
      return view(validated);
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    await ensureExactJson(claimLocation.claim, {
      schema_version: 1,
      kind: "codex-flow-v07-archive-disposition-claim",
      disposition_id: authority.disposition.disposition_id,
      archive_id: archiveId,
    }, { guardRoot: guardRoot(stateRoot) });
    return view(record, { dispatchPermitted: true });
  });
}

function validateReconcileObservation(value, expectedThreadId) {
  if (value === null) return null;
  const task = validateTaskObservation(value, "archive reconciliation observation");
  if (
    task.thread_id !== expectedThreadId
    || task.active_visible !== false
    || task.archived_visible !== true
  ) throw new CliError("Archive reconciliation has not independently observed archived visibility", 73);
  return task;
}

async function reconciledWorktreeState(worktree) {
  if (worktree.management === "none") return "not-applicable";
  if (await pathPresent(worktree.path)) {
    throw new CliError("Host-managed worktree still exists; task must remain visible", 73);
  }
  return "absent";
}

export async function reconcileTaskArchive({
  stateRoot,
  archiveId,
  attemptId,
  outcome,
  observation = null,
  now = Date.now(),
}) {
  requireEnum(outcome, SETTER_OUTCOMES, "archive setter outcome");
  const location = paths(stateRoot, archiveId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `task archive ${archiveId}`,
  }, async () => {
    const current = (await readRecord(stateRoot, archiveId)).record;
    const requestedAttempt = requireText(attemptId, "attempt_id", { max: 128, safeId: true });
    if (requestedAttempt !== current.host_intent.attempt_id) {
      throw new CliError("Archive reconciliation attempt does not match the prepared host intent", 73);
    }
    if (current.setter && current.setter.outcome !== outcome) {
      throw new CliError("Archive setter is already reconciled differently", 73);
    }
    const taskObservation = validateReconcileObservation(observation, current.task.thread_id);
    if (outcome === "rejected-before-send" && taskObservation !== null) {
      throw new CliError("Rejected archive setter cannot accept completion observation", 73);
    }
    if (current.state === "completed") {
      if (taskObservation === null) {
        throw new CliError("Completed archive replay requires its exact independent observation", 73);
      }
      await reconciledWorktreeState(current.worktree);
      return view(current);
    }
    if (current.state === "rejected-before-send") {
      return view(current);
    }
    if (current.state === "ambiguous" && taskObservation === null) return view(current);
    if (current.state === "accepted-awaiting-observation" && taskObservation === null) {
      return view(current);
    }

    const reconciledAt = nowIso(now);
    const setter = current.setter ?? { outcome, reconciled_at: reconciledAt };
    if (outcome === "rejected-before-send" || (outcome === "ambiguous" && taskObservation === null)) {
      const next = validateArchiveOperation({
        ...current,
        setter,
        state: outcome,
        updated_at: reconciledAt,
      });
      await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
      return view(next);
    }
    if (taskObservation === null) {
      const next = validateArchiveOperation({
        ...current,
        setter,
        state: "accepted-awaiting-observation",
        updated_at: reconciledAt,
      });
      await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
      return view(next);
    }
    const worktreeState = await reconciledWorktreeState(current.worktree);
    const next = validateArchiveOperation({
      ...current,
      setter,
      observation: {
        task: taskObservation,
        worktree_state: worktreeState,
        observed_at: reconciledAt,
      },
      state: "completed",
      updated_at: reconciledAt,
    });
    await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
    return view(next);
  });
}

export async function taskArchiveStatus({ stateRoot, archiveId }) {
  return view((await readRecord(stateRoot, archiveId)).record);
}
