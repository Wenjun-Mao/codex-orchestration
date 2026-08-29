import { spawnSync } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  CliError,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { validateArchiveOperation } from "./archive-lifecycle.mjs";
import { validateCallbackRecordV06 } from "./callbacks-v06.mjs";
import { validateDispositionRecord } from "./dispositions.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { validateIntegrationRecordV06 } from "./integration-v06.mjs";
import { validateReleaseRecord } from "./release-lifecycle.mjs";
import {
  runLifecyclePath,
  validateRunLifecycleState,
} from "./run-lifecycle.mjs";
import {
  runtimeBindingFromContext,
  runtimeContextHash,
  runtimeContextPath,
  v06RuntimeRoot,
  validateRuntimeContext,
} from "./runtime-context.mjs";
import { validateVisibleTaskCreationRecord } from "./task-creation-v06.mjs";

const CLEANUP_KIND = "codex-flow-v06-cleanup-plan";
const PLAN_ID = /^cleanup-plan-v1-[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const CLASSIFICATIONS = [
  "authority-conflict",
  "in-flight",
  "retained-visible",
  "awaiting-archive",
  "cleanup-blocked",
  "cleanup-ready",
  "clean",
];
const ORIGINAL_PATH_STATES = ["not-recorded", "present", "absent"];
const UPSTREAM_STATES = [
  "not-declared",
  "local-ref-absent",
  "configured-mismatch",
  "remote-ref-missing",
  "tip-mismatch",
  "exact",
];
const REASON_CODES = [
  "archive-missing",
  "archive-not-completed",
  "archive-worktree-not-absent",
  "authority-conflict",
  "branch-attached-worktree",
  "branch-missing-with-live-upstream",
  "branch-tip-mismatch",
  "callback-missing",
  "callback-not-consumed",
  "cleanup-complete",
  "cleanup-ready",
  "creation-not-ready",
  "disposition-missing",
  "disposition-not-cleanup-eligible",
  "disposition-not-completed",
  "integration-missing",
  "integration-not-reconciled",
  "original-worktree-present",
  "release-missing",
  "release-not-accepted",
  "upstream-configured-mismatch",
  "upstream-ref-missing",
  "upstream-tip-mismatch",
];
const UNBOUND_FENCE_REASONS = ["unbound-branch-fence-live", "unbound-branch-fence-resolved"];

function nullableText(value, label, { max = 256, safeId = false } = {}) {
  return value === null ? null : requireText(value, label, { max, safeId });
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function nullableRevision(value, label) {
  if (value === null) return null;
  const result = requireText(value, label, { min: 40, max: 64 });
  if (!REVISION.test(result)) throw new CliError(`${label} must be a full Git revision`);
  return result;
}

function absolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function nullableAbsolutePath(value, label) {
  return value === null ? null : absolutePath(value, label);
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new CliError(`${label} must be a boolean`);
  return value;
}

function safeChild(directory, filename, label) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label} state path`);
  }
  return path;
}

function runGit(cwd, args, label, { allowedStatuses = [0] } = {}) {
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
  if (!allowedStatuses.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return { status: result.status, stdout: result.stdout };
}

async function listRecords(stateRoot, relativeDirectory, validator, label) {
  const directory = resolve(stateRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const unexpected = entries.find((entry) => !entry.isFile() || !entry.name.endsWith(".json"));
  if (unexpected) throw new CliError(`${label} contains an unexpected state entry: ${unexpected.name}`);
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = safeChild(directory, entry.name, label);
    records.push(validator(await readJson(path, { guardRoot: gitCommonDirectoryForState(stateRoot) })));
  }
  return records;
}

function parseWorktreeInventory(output) {
  return output.split("\0\0").filter(Boolean).map((block) => {
    const fields = block.split("\0").filter(Boolean);
    const worktreeField = fields.find((field) => field.startsWith("worktree "));
    const headField = fields.find((field) => field.startsWith("HEAD "));
    if (!worktreeField || !headField) throw new CliError("Git worktree inventory is incomplete");
    const branchField = fields.find((field) => field.startsWith("branch "));
    const lockedField = fields.find((field) => field === "locked" || field.startsWith("locked "));
    const prunableField = fields.find((field) => field === "prunable" || field.startsWith("prunable "));
    return {
      path: absolutePath(worktreeField.slice("worktree ".length), "worktree inventory path"),
      head: nullableRevision(headField.slice("HEAD ".length), "worktree inventory head"),
      branch_ref: branchField ? requireText(branchField.slice("branch ".length), "worktree branch ref", { max: 512 }) : null,
      detached: fields.includes("detached"),
      bare: fields.includes("bare"),
      locked: lockedField !== undefined,
      prunable: prunableField !== undefined,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function liveWorktrees(repositoryRoot) {
  return parseWorktreeInventory(runGit(
    repositoryRoot,
    ["worktree", "list", "--porcelain", "-z"],
    "Git worktree inventory",
  ).stdout);
}

function localRef(repositoryRoot, ref) {
  const result = runGit(
    repositoryRoot,
    ["for-each-ref", "--format=%(objectname)", ref],
    `Git ref inspection for ${ref}`,
  );
  const tip = result.stdout.trim();
  return tip === ""
    ? { exists: false, tip: null }
    : { exists: true, tip: nullableRevision(tip, `${ref} tip`) };
}

function configuredUpstream(repositoryRoot, localBranchRef, localExists) {
  if (!localExists) return null;
  const value = runGit(
    repositoryRoot,
    ["for-each-ref", "--format=%(upstream:short)", localBranchRef],
    `Configured upstream inspection for ${localBranchRef}`,
  ).stdout.trim();
  return value === "" ? null : requireText(value, "configured upstream", { max: 256 });
}

function remoteRefFor(repositoryRoot, expectedUpstream) {
  if (expectedUpstream === null) return { ref: null, live: { exists: false, tip: null } };
  const ref = `refs/remotes/${expectedUpstream}`;
  const checked = runGit(
    repositoryRoot,
    ["check-ref-format", ref],
    "Expected upstream ref validation",
    { allowedStatuses: [0, 1] },
  );
  if (checked.status !== 0) throw new CliError("Terminal receipt upstream is not a valid remote-tracking ref");
  return { ref, live: localRef(repositoryRoot, ref) };
}

function upstreamEvidence({ repositoryRoot, localBranchRef, local, expected, expectedTip }) {
  const configured = configuredUpstream(repositoryRoot, localBranchRef, local.exists);
  const remote = remoteRefFor(repositoryRoot, expected);
  let state;
  if (expected === null && configured !== null) state = "configured-mismatch";
  else if (expected === null) state = "not-declared";
  else if (!local.exists) state = "local-ref-absent";
  else if (configured !== expected) state = "configured-mismatch";
  else if (!remote.live.exists) state = "remote-ref-missing";
  else if (expectedTip === null || remote.live.tip !== expectedTip) state = "tip-mismatch";
  else state = "exact";
  return {
    expected,
    configured,
    remote_ref: remote.ref,
    remote_exists: remote.live.exists,
    remote_tip: remote.live.tip,
    state,
  };
}

async function pathState(path) {
  if (path === null) return "not-recorded";
  try {
    await lstat(path);
    return "present";
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw error;
  }
}

function one(records, predicate) {
  const matches = records.filter(predicate);
  return { record: matches.length === 1 ? matches[0] : null, conflict: matches.length > 1 };
}

function sameIdentity(left, right) {
  return [
    "run_id", "repository_id", "common_dir", "plan_id", "revision_digest",
    "task_id", "task_digest", "contract_id", "operation_id",
  ].every((key) => stableStringify(left?.[key]) === stableStringify(right?.[key]));
}

function expectedTipFor(callback) {
  if (!callback) return null;
  const outcome = callback.receipt.git_outcome;
  return outcome.kind === "unchanged" ? outcome.final_revision : outcome.commit;
}

function originalWorktreePath(creation, archive) {
  if (archive?.worktree?.management === "host-managed") return archive.worktree.path;
  const observed = creation.selector_evidence.observed?.worktree;
  return observed?.mode === "host-worktree" ? observed.path : null;
}

function lifecycleAuthority({ creation, releases, callbacks, dispositions, integrations, archives }) {
  const releaseMatch = one(releases, (record) => record.operation_id === creation.operation_id);
  const release = releaseMatch.record;
  const callbackMatch = one(callbacks, (record) => (
    record.receipt.operation_id === creation.operation_id
    && (release === null || record.receipt.release_id === release.release_id)
  ));
  const callback = callbackMatch.record;
  const dispositionMatch = one(dispositions, (record) => (
    record.operation_id === creation.operation_id
    && (callback === null || record.callback_id === callback.callback_id)
  ));
  const disposition = dispositionMatch.record;
  const integrationMatch = disposition?.integration_id === null || disposition?.integration_id === undefined
    ? { record: null, conflict: false }
    : one(integrations, (record) => record.integration_id === disposition.integration_id);
  const archiveMatch = disposition === null
    ? { record: null, conflict: false }
    : one(archives, (record) => record.disposition_id === disposition.disposition_id);
  const authorityConflict = [
    releaseMatch, callbackMatch, dispositionMatch, integrationMatch, archiveMatch,
  ].some((entry) => entry.conflict) || [release, callback?.receipt, disposition, integrationMatch.record, archiveMatch.record]
    .filter(Boolean)
    .some((record) => !sameIdentity(creation, record));
  return {
    release,
    callback,
    disposition,
    integration: integrationMatch.record,
    archive: archiveMatch.record,
    authorityConflict,
  };
}

function lifecycleReasonCodes(authority, creation) {
  const reasons = [];
  if (authority.authorityConflict) reasons.push("authority-conflict");
  if (creation.status !== "ready-unreleased") reasons.push("creation-not-ready");
  if (authority.release === null) reasons.push("release-missing");
  else if (authority.release.acceptance === null) reasons.push("release-not-accepted");
  if (authority.callback === null) reasons.push("callback-missing");
  else if (authority.callback.state !== "consumed") reasons.push("callback-not-consumed");
  if (authority.disposition === null) reasons.push("disposition-missing");
  else {
    if (authority.disposition.state !== "completed") reasons.push("disposition-not-completed");
    if (!["accepted-no-change", "accepted-for-integration"].includes(authority.disposition.decision)) {
      reasons.push("disposition-not-cleanup-eligible");
    }
    if (authority.disposition.decision === "accepted-for-integration") {
      if (authority.integration === null) reasons.push("integration-missing");
      else if (authority.integration.state !== "reconciled") reasons.push("integration-not-reconciled");
    }
  }
  if (authority.archive === null) reasons.push("archive-missing");
  else {
    if (authority.archive.state !== "completed") reasons.push("archive-not-completed");
    if (
      authority.archive.worktree.management !== "host-managed"
      || authority.archive.observation?.worktree_state !== "absent"
    ) reasons.push("archive-worktree-not-absent");
  }
  return reasons;
}

function classify({ authority, lifecycleReasons, gitReasons, cleanupRequired }) {
  if (authority.authorityConflict) return "authority-conflict";
  if (authority.disposition && !["accepted-no-change", "accepted-for-integration"].includes(
    authority.disposition.decision,
  )) return "retained-visible";
  if (lifecycleReasons.some((reason) => [
    "creation-not-ready", "release-missing", "release-not-accepted",
    "callback-missing", "callback-not-consumed", "disposition-missing",
    "disposition-not-completed", "integration-missing", "integration-not-reconciled",
  ].includes(reason))) return "in-flight";
  if (lifecycleReasons.length > 0) return "awaiting-archive";
  if (!cleanupRequired) return "clean";
  if (gitReasons.length > 0) return "cleanup-blocked";
  return "cleanup-ready";
}

async function cleanupItem({ creation, authority, repositoryRoot, inventory }) {
  const branch = creation.selector_evidence.requested.worktree.executor_branch;
  const ref = `refs/heads/${branch}`;
  const local = localRef(repositoryRoot, ref);
  const expectedTip = expectedTipFor(authority.callback);
  const terminalBranch = authority.callback?.receipt.git_outcome.branch ?? null;
  if (authority.callback !== null && terminalBranch !== branch) authority.authorityConflict = true;
  const attachments = inventory.filter((entry) => entry.branch_ref === ref);
  const originalPath = originalWorktreePath(creation, authority.archive);
  const originalPathState = await pathState(originalPath);
  const expectedUpstream = authority.callback?.receipt.git_outcome.upstream ?? null;
  const upstream = upstreamEvidence({
    repositoryRoot,
    localBranchRef: ref,
    local,
    expected: expectedUpstream,
    expectedTip,
  });
  const remoteCleanupRequired = expectedUpstream !== null || upstream.remote_exists;
  const cleanupRequired = local.exists || attachments.length > 0 || remoteCleanupRequired;
  const lifecycleReasons = lifecycleReasonCodes(authority, creation);
  const gitReasons = [];
  if (originalPathState === "present") gitReasons.push("original-worktree-present");
  if (attachments.length > 0) gitReasons.push("branch-attached-worktree");
  if (local.exists && expectedTip !== null && local.tip !== expectedTip) gitReasons.push("branch-tip-mismatch");
  if (!local.exists && remoteCleanupRequired) gitReasons.push("branch-missing-with-live-upstream");
  if (upstream.state === "configured-mismatch") gitReasons.push("upstream-configured-mismatch");
  if (upstream.state === "remote-ref-missing") gitReasons.push("upstream-ref-missing");
  if (upstream.state === "local-ref-absent" && !upstream.remote_exists) gitReasons.push("upstream-ref-missing");
  if (upstream.state === "tip-mismatch") gitReasons.push("upstream-tip-mismatch");
  const classification = classify({ authority, lifecycleReasons, gitReasons, cleanupRequired });
  const reasons = [...new Set([...lifecycleReasons, ...gitReasons])].sort();
  if (classification === "cleanup-ready") reasons.push("cleanup-ready");
  if (classification === "clean") reasons.push("cleanup-complete");
  const candidate = classification === "cleanup-ready";
  return validateCleanupItem({
    run_id: creation.run_id,
    task_id: creation.task_id,
    operation_id: creation.operation_id,
    release_id: authority.release?.release_id ?? null,
    callback_id: authority.callback?.callback_id ?? null,
    disposition_id: authority.disposition?.disposition_id ?? null,
    integration_id: authority.integration?.integration_id ?? null,
    archive_id: authority.archive?.archive_id ?? null,
    executor_thread_id: authority.callback?.receipt.executor_thread_id
      ?? authority.release?.ready_thread_id
      ?? creation.ready?.thread_id
      ?? null,
    branch,
    ref,
    expected_tip: expectedTip,
    local_ref: local,
    worktree: {
      original_path: originalPath,
      original_path_state: originalPathState,
      attachments,
    },
    upstream,
    disposition: authority.disposition === null ? null : {
      decision: authority.disposition.decision,
      state: authority.disposition.state,
    },
    archive: authority.archive === null ? null : {
      state: authority.archive.state,
      worktree_state: authority.archive.observation?.worktree_state ?? null,
    },
    classification,
    cleanup_required: cleanupRequired,
    close_blocked: classification !== "clean",
    candidate,
    reason_codes: reasons,
  });
}

function validateAttachment(value, label) {
  requireExactFields(value, {
    required: ["path", "head", "branch_ref", "detached", "bare", "locked", "prunable"],
  }, label);
  return {
    path: absolutePath(value.path, `${label}.path`),
    head: nullableRevision(value.head, `${label}.head`),
    branch_ref: nullableText(value.branch_ref, `${label}.branch_ref`, { max: 512 }),
    detached: boolean(value.detached, `${label}.detached`),
    bare: boolean(value.bare, `${label}.bare`),
    locked: boolean(value.locked, `${label}.locked`),
    prunable: boolean(value.prunable, `${label}.prunable`),
  };
}

function validateCleanupItem(value, label = "cleanup item") {
  requireExactFields(value, {
    required: [
      "run_id", "task_id", "operation_id", "release_id", "callback_id",
      "disposition_id", "integration_id", "archive_id", "executor_thread_id",
      "branch", "ref", "expected_tip", "local_ref", "worktree", "upstream",
      "disposition", "archive", "classification", "cleanup_required",
      "close_blocked", "candidate", "reason_codes",
    ],
  }, label);
  requireExactFields(value.local_ref, { required: ["exists", "tip"] }, `${label}.local_ref`);
  const localRef = {
    exists: boolean(value.local_ref.exists, `${label}.local_ref.exists`),
    tip: nullableRevision(value.local_ref.tip, `${label}.local_ref.tip`),
  };
  if (localRef.exists !== (localRef.tip !== null)) throw new CliError(`${label}.local_ref is inconsistent`);
  requireExactFields(value.worktree, {
    required: ["original_path", "original_path_state", "attachments"],
  }, `${label}.worktree`);
  if (!Array.isArray(value.worktree.attachments) || value.worktree.attachments.length > 128) {
    throw new CliError(`${label}.worktree.attachments must be a bounded array`);
  }
  const worktree = {
    original_path: nullableAbsolutePath(value.worktree.original_path, `${label}.worktree.original_path`),
    original_path_state: requireEnum(
      value.worktree.original_path_state,
      ORIGINAL_PATH_STATES,
      `${label}.worktree.original_path_state`,
    ),
    attachments: value.worktree.attachments.map((entry, index) => validateAttachment(
      entry,
      `${label}.worktree.attachments[${index}]`,
    )).sort((left, right) => left.path.localeCompare(right.path)),
  };
  requireExactFields(value.upstream, {
    required: ["expected", "configured", "remote_ref", "remote_exists", "remote_tip", "state"],
  }, `${label}.upstream`);
  const upstream = {
    expected: nullableText(value.upstream.expected, `${label}.upstream.expected`),
    configured: nullableText(value.upstream.configured, `${label}.upstream.configured`),
    remote_ref: nullableText(value.upstream.remote_ref, `${label}.upstream.remote_ref`, { max: 512 }),
    remote_exists: boolean(value.upstream.remote_exists, `${label}.upstream.remote_exists`),
    remote_tip: nullableRevision(value.upstream.remote_tip, `${label}.upstream.remote_tip`),
    state: requireEnum(value.upstream.state, UPSTREAM_STATES, `${label}.upstream.state`),
  };
  if (upstream.remote_exists !== (upstream.remote_tip !== null)) {
    throw new CliError(`${label}.upstream remote ref state is inconsistent`);
  }
  const disposition = value.disposition === null ? null : (() => {
    requireExactFields(value.disposition, { required: ["decision", "state"] }, `${label}.disposition`);
    return {
      decision: requireEnum(value.disposition.decision, [
        "accepted-for-integration", "accepted-no-change", "rejected", "retained-blocked", "cancelled",
      ], `${label}.disposition.decision`),
      state: requireEnum(value.disposition.state, ["prepared", "finalized", "completed"], `${label}.disposition.state`),
    };
  })();
  const archive = value.archive === null ? null : (() => {
    requireExactFields(value.archive, { required: ["state", "worktree_state"] }, `${label}.archive`);
    return {
      state: requireEnum(value.archive.state, [
        "prepared", "accepted-awaiting-observation", "completed", "rejected-before-send", "ambiguous",
      ], `${label}.archive.state`),
      worktree_state: value.archive.worktree_state === null
        ? null
        : requireEnum(value.archive.worktree_state, ["not-applicable", "absent"], `${label}.archive.worktree_state`),
    };
  })();
  const reasons = requireStringArray(value.reason_codes, `${label}.reason_codes`, {
    maxItems: REASON_CODES.length,
    maxText: 64,
    allowEmpty: false,
    safeIds: true,
  }).map((reason) => requireEnum(reason, REASON_CODES, `${label}.reason_codes`));
  if (new Set(reasons).size !== reasons.length) throw new CliError(`${label}.reason_codes contains duplicates`);
  return {
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    operation_id: requireText(value.operation_id, `${label}.operation_id`, { max: 128, safeId: true }),
    release_id: nullableText(value.release_id, `${label}.release_id`, { max: 128, safeId: true }),
    callback_id: nullableText(value.callback_id, `${label}.callback_id`, { max: 128, safeId: true }),
    disposition_id: nullableText(value.disposition_id, `${label}.disposition_id`, { max: 128, safeId: true }),
    integration_id: nullableText(value.integration_id, `${label}.integration_id`, { max: 128, safeId: true }),
    archive_id: nullableText(value.archive_id, `${label}.archive_id`, { max: 128, safeId: true }),
    executor_thread_id: nullableText(value.executor_thread_id, `${label}.executor_thread_id`, { max: 256, safeId: true }),
    branch: requireText(value.branch, `${label}.branch`, { max: 256 }),
    ref: requireText(value.ref, `${label}.ref`, { max: 512 }),
    expected_tip: nullableRevision(value.expected_tip, `${label}.expected_tip`),
    local_ref: localRef,
    worktree,
    upstream,
    disposition,
    archive,
    classification: requireEnum(value.classification, CLASSIFICATIONS, `${label}.classification`),
    cleanup_required: boolean(value.cleanup_required, `${label}.cleanup_required`),
    close_blocked: boolean(value.close_blocked, `${label}.close_blocked`),
    candidate: boolean(value.candidate, `${label}.candidate`),
    reason_codes: [...reasons].sort(),
  };
}

function cleanupPlanSeed(value) {
  const { plan_id: ignored, ...seed } = value;
  return seed;
}

function validateUnboundBranchFence(value, label = "unbound branch fence") {
  requireExactFields(value, {
    required: [
      "branch", "ref", "local_ref", "worktree_attachments", "cleanup_required",
      "close_blocked", "reason_codes",
    ],
  }, label);
  requireExactFields(value.local_ref, { required: ["exists", "tip"] }, `${label}.local_ref`);
  const localRef = {
    exists: boolean(value.local_ref.exists, `${label}.local_ref.exists`),
    tip: nullableRevision(value.local_ref.tip, `${label}.local_ref.tip`),
  };
  if (localRef.exists !== (localRef.tip !== null)) throw new CliError(`${label}.local_ref is inconsistent`);
  if (!Array.isArray(value.worktree_attachments) || value.worktree_attachments.length > 128) {
    throw new CliError(`${label}.worktree_attachments must be a bounded array`);
  }
  const attachments = value.worktree_attachments.map((entry, index) => validateAttachment(
    entry,
    `${label}.worktree_attachments[${index}]`,
  )).sort((left, right) => left.path.localeCompare(right.path));
  const cleanupRequired = boolean(value.cleanup_required, `${label}.cleanup_required`);
  const closeBlocked = boolean(value.close_blocked, `${label}.close_blocked`);
  if (cleanupRequired !== closeBlocked || closeBlocked !== (localRef.exists || attachments.length > 0)) {
    throw new CliError(`${label} cleanup and closure state is inconsistent`);
  }
  const reasons = requireStringArray(value.reason_codes, `${label}.reason_codes`, {
    maxItems: 1,
    maxText: 64,
    safeIds: true,
    allowEmpty: false,
  }).map((reason) => requireEnum(reason, UNBOUND_FENCE_REASONS, `${label}.reason_codes`));
  const expectedReason = closeBlocked ? "unbound-branch-fence-live" : "unbound-branch-fence-resolved";
  if (reasons[0] !== expectedReason) throw new CliError(`${label}.reason_codes is inconsistent`);
  return {
    branch: requireText(value.branch, `${label}.branch`, { max: 256 }),
    ref: requireText(value.ref, `${label}.ref`, { max: 512 }),
    local_ref: localRef,
    worktree_attachments: attachments,
    cleanup_required: cleanupRequired,
    close_blocked: closeBlocked,
    reason_codes: reasons,
  };
}

export function cleanupPlanDigestV06(value) {
  return sha256(stableStringify(cleanupPlanSeed(validateCleanupPlanV06(value))));
}

export function validateCleanupPlanV06(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "plan_id", "run_id", "run_status",
      "repository", "branch_fences", "items", "candidate_operation_ids",
      "blocking_operation_ids", "unbound_branch_fences", "blocking_branch_fences",
      "counts", "mutation_performed",
    ],
  }, "v0.6 cleanup plan");
  if (value.schema_version !== 1 || value.kind !== CLEANUP_KIND) {
    throw new CliError("Invalid v0.6 cleanup plan");
  }
  requireExactFields(value.repository, {
    required: ["repository_id", "common_dir", "controller_root", "branch", "head"],
  }, "cleanup plan repository");
  const repository = {
    repository_id: digest(value.repository.repository_id, "cleanup plan repository.repository_id"),
    common_dir: absolutePath(value.repository.common_dir, "cleanup plan repository.common_dir"),
    controller_root: absolutePath(value.repository.controller_root, "cleanup plan repository.controller_root"),
    branch: requireText(value.repository.branch, "cleanup plan repository.branch", { max: 256 }),
    head: nullableRevision(value.repository.head, "cleanup plan repository.head"),
  };
  if (!Array.isArray(value.items) || value.items.length > 128) {
    throw new CliError("cleanup plan items must be a bounded array");
  }
  const items = value.items.map((entry, index) => validateCleanupItem(entry, `cleanup plan items[${index}]`))
    .sort((left, right) => left.operation_id.localeCompare(right.operation_id));
  const stringList = (list, label) => {
    const values = requireStringArray(list, label, {
      maxItems: 128,
      maxText: 512,
      allowEmpty: true,
    }).sort();
    if (new Set(values).size !== values.length) throw new CliError(`${label} contains duplicates`);
    return values;
  };
  const branchFences = stringList(value.branch_fences, "cleanup plan branch_fences");
  const candidateIds = stringList(value.candidate_operation_ids, "cleanup plan candidate_operation_ids");
  const blockingIds = stringList(value.blocking_operation_ids, "cleanup plan blocking_operation_ids");
  if (!Array.isArray(value.unbound_branch_fences) || value.unbound_branch_fences.length > 128) {
    throw new CliError("cleanup plan unbound_branch_fences must be a bounded array");
  }
  const unboundBranchFences = value.unbound_branch_fences.map((entry, index) => validateUnboundBranchFence(
    entry,
    `cleanup plan unbound_branch_fences[${index}]`,
  )).sort((left, right) => left.branch.localeCompare(right.branch));
  const blockingBranchFences = stringList(
    value.blocking_branch_fences,
    "cleanup plan blocking_branch_fences",
  );
  requireExactFields(value.counts, {
    required: [
      "host_worktree_tasks", "unbound_branch_fences", "cleanup_required",
      "cleanup_candidates", "close_blocked",
    ],
  }, "cleanup plan counts");
  const counts = Object.fromEntries(Object.entries(value.counts).map(([key, count]) => [
    key,
    requireInteger(count, `cleanup plan counts.${key}`, { min: 0, max: 128 }),
  ]));
  const plan = {
    schema_version: 1,
    kind: CLEANUP_KIND,
    plan_id: requireText(value.plan_id, "cleanup plan plan_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "cleanup plan run_id", { max: 128, safeId: true }),
    run_status: requireEnum(value.run_status, ["active", "closed", "abandoned"], "cleanup plan run_status"),
    repository,
    branch_fences: branchFences,
    items,
    candidate_operation_ids: candidateIds,
    blocking_operation_ids: blockingIds,
    unbound_branch_fences: unboundBranchFences,
    blocking_branch_fences: blockingBranchFences,
    counts,
    mutation_performed: boolean(value.mutation_performed, "cleanup plan mutation_performed"),
  };
  if (plan.mutation_performed !== false) throw new CliError("v0.6 cleanup plan must be read-only");
  if (!PLAN_ID.test(plan.plan_id)) throw new CliError("cleanup plan plan_id must be a v1 cleanup plan ID");
  if (plan.items.some((item) => item.run_id !== plan.run_id)) {
    throw new CliError("cleanup plan contains an item from another run");
  }
  const expectedCandidateIds = plan.items.filter((item) => item.candidate).map((item) => item.operation_id).sort();
  const expectedBlockingIds = plan.items.filter((item) => item.close_blocked).map((item) => item.operation_id).sort();
  const expectedBlockingBranches = plan.unbound_branch_fences
    .filter((fence) => fence.close_blocked)
    .map((fence) => fence.branch)
    .sort();
  const expectedCounts = {
    host_worktree_tasks: plan.items.length,
    unbound_branch_fences: plan.unbound_branch_fences.length,
    cleanup_required: plan.items.filter((item) => item.cleanup_required).length
      + plan.unbound_branch_fences.filter((fence) => fence.cleanup_required).length,
    cleanup_candidates: expectedCandidateIds.length,
    close_blocked: expectedBlockingIds.length + expectedBlockingBranches.length,
  };
  if (
    stableStringify(expectedCandidateIds) !== stableStringify(plan.candidate_operation_ids)
    || stableStringify(expectedBlockingIds) !== stableStringify(plan.blocking_operation_ids)
    || stableStringify(expectedBlockingBranches) !== stableStringify(plan.blocking_branch_fences)
    || stableStringify(expectedCounts) !== stableStringify(plan.counts)
  ) throw new CliError("cleanup plan summaries do not match its items");
  const expectedPlanId = `cleanup-plan-v1-${sha256(stableStringify(cleanupPlanSeed(plan)))}`;
  if (plan.plan_id !== expectedPlanId) throw new CliError("cleanup plan plan_id is invalid");
  return plan;
}

export async function cleanupPlanV06({ stateRoot, runId }) {
  const requestedStateRoot = resolve(requireText(stateRoot, "stateRoot", { max: 2048 }));
  const commonDir = await realpath(gitCommonDirectoryForState(requestedStateRoot));
  if (requestedStateRoot !== v06RuntimeRoot(commonDir)) {
    throw new CliError("v0.6 cleanup plan requires the exact v0.6 state root");
  }
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const lifecycle = validateRunLifecycleState(await readJson(runLifecyclePath(commonDir), {
    guardRoot: commonDir,
  }));
  const run = lifecycle.runs[safeRunId];
  if (!run) throw new CliError(`Unknown v0.6 run: ${safeRunId}`);
  const runtime = validateRuntimeContext(await readJson(runtimeContextPath(commonDir, run.runtime_id), {
    guardRoot: commonDir,
  }));
  const runtimeBinding = runtimeBindingFromContext(runtime);
  if (
    runtime.runtime_id !== run.runtime_id
    || runtimeContextHash(runtime) !== run.runtime_context_hash
    || runtimeBinding.repository_hash !== run.binding.repository_hash
    || runtime.repository.common_dir !== commonDir
  ) throw new CliError("Cleanup run and runtime repository authority do not match");
  const liveCommonDir = await realpath(runGit(
    runtime.repository.root,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Cleanup repository common-directory authentication",
  ).stdout.trim());
  if (liveCommonDir !== commonDir) throw new CliError("Cleanup repository belongs to a different Git common directory");

  const [creations, releases, callbacks, dispositions, integrations, archives] = await Promise.all([
    listRecords(requestedStateRoot, "visible-task-creations/records", validateVisibleTaskCreationRecord, "visible task creation records"),
    listRecords(requestedStateRoot, "releases/records", validateReleaseRecord, "release records"),
    listRecords(requestedStateRoot, "callbacks/journal", validateCallbackRecordV06, "callback records"),
    listRecords(requestedStateRoot, "dispositions/records", validateDispositionRecord, "disposition records"),
    listRecords(requestedStateRoot, "integration-lifecycle/records", validateIntegrationRecordV06, "integration records"),
    listRecords(requestedStateRoot, "archives/records", validateArchiveOperation, "archive records"),
  ]);
  const runRecords = (records) => records.filter((record) => record.run_id === safeRunId);
  const runCreations = runRecords(creations).filter(
    (record) => record.selector_evidence.requested.worktree.mode === "host-worktree",
  );
  const repositoryId = run.binding.repository_hash;
  const foreignAuthority = runCreations.find((record) => (
    record.repository_id !== repositoryId || record.common_dir !== commonDir
  ));
  if (foreignAuthority) throw new CliError("Cleanup run contains host-worktree authority for another repository");
  const inventory = liveWorktrees(runtime.repository.root);
  const items = [];
  for (const creation of runCreations) {
    items.push(await cleanupItem({
      creation,
      authority: lifecycleAuthority({
        creation,
        releases: runRecords(releases),
        callbacks: callbacks.filter((record) => record.receipt.run_id === safeRunId),
        dispositions: runRecords(dispositions),
        integrations: runRecords(integrations),
        archives: runRecords(archives),
      }),
      repositoryRoot: runtime.repository.root,
      inventory,
    }));
  }
  items.sort((left, right) => left.operation_id.localeCompare(right.operation_id));
  const boundBranches = new Set(items.map((item) => item.branch));
  const unboundBranchFences = run.plan.branch_fences
    .filter((branch) => !boundBranches.has(branch))
    .map((branch) => {
      const ref = `refs/heads/${branch}`;
      const local = localRef(runtime.repository.root, ref);
      const attachments = inventory.filter((entry) => entry.branch_ref === ref);
      const blocked = local.exists || attachments.length > 0;
      return validateUnboundBranchFence({
        branch,
        ref,
        local_ref: local,
        worktree_attachments: attachments,
        cleanup_required: blocked,
        close_blocked: blocked,
        reason_codes: [blocked ? "unbound-branch-fence-live" : "unbound-branch-fence-resolved"],
      });
    })
    .sort((left, right) => left.branch.localeCompare(right.branch));
  const headResult = runGit(
    runtime.repository.root,
    ["rev-parse", "--verify", "HEAD"],
    "Cleanup controller HEAD inspection",
    { allowedStatuses: [0, 128] },
  );
  const branchResult = runGit(
    runtime.repository.root,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "Cleanup controller branch inspection",
    { allowedStatuses: [0, 1] },
  );
  const draft = {
    schema_version: 1,
    kind: CLEANUP_KIND,
    plan_id: "cleanup-plan-v1-pending",
    run_id: safeRunId,
    run_status: run.status,
    repository: {
      repository_id: repositoryId,
      common_dir: commonDir,
      controller_root: runtime.repository.root,
      branch: branchResult.status === 0 ? branchResult.stdout.trim() : "detached",
      head: headResult.status === 0 ? headResult.stdout.trim() : null,
    },
    branch_fences: [...run.plan.branch_fences].sort(),
    items,
    candidate_operation_ids: items.filter((item) => item.candidate).map((item) => item.operation_id).sort(),
    blocking_operation_ids: items.filter((item) => item.close_blocked).map((item) => item.operation_id).sort(),
    unbound_branch_fences: unboundBranchFences,
    blocking_branch_fences: unboundBranchFences
      .filter((fence) => fence.close_blocked)
      .map((fence) => fence.branch),
    counts: {
      host_worktree_tasks: items.length,
      unbound_branch_fences: unboundBranchFences.length,
      cleanup_required: items.filter((item) => item.cleanup_required).length
        + unboundBranchFences.filter((fence) => fence.cleanup_required).length,
      cleanup_candidates: items.filter((item) => item.candidate).length,
      close_blocked: items.filter((item) => item.close_blocked).length
        + unboundBranchFences.filter((fence) => fence.close_blocked).length,
    },
    mutation_performed: false,
  };
  return validateCleanupPlanV06({
    ...draft,
    plan_id: `cleanup-plan-v1-${sha256(stableStringify(cleanupPlanSeed(draft)))}`,
  });
}
