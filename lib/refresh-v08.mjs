import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  ensureExactJson,
  PACKAGE_VERSION,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import {
  captureRefreshGitAuthority,
  deleteRefreshExecutorBranch,
  refreshGitPresence,
  removeRefreshExecutorWorktree,
  validateRefreshGitAuthority,
} from "./refresh-discard-git-v08.mjs";
import {
  assertOtherRefreshSourceRunsSafe,
  assertRefreshNamespaceRemovalSafe,
  loadRefreshSourceAuthority,
  refreshNamespaceCandidates,
  refreshNamespaceTreeDigest,
  refreshSourceSummary,
  refreshTaskSemanticBrief,
} from "./refresh-source-v08.mjs";
import { gitSnapshot } from "./git.mjs";
import {
  fencePlanIsEmpty,
  validateFencePlan,
  validateRunBinding,
  validateRunLifecycleState,
} from "./run-lifecycle.mjs";
import {
  observeCodexAppPrivateArchive,
  PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
  validatePrivateArchiveObservation,
} from "./codex-app-private-archive-v07.mjs";
import { loadRuntimeBundleSource } from "./runtime-context.mjs";
import { createWorkflowPlanRevision } from "./workflow-plan.mjs";

export const REFRESH_SCHEMA_VERSION = 1;
export const REFRESH_HANDOFF_KIND = "codex-flow-refresh-v1-handoff";
export const REFRESH_INSPECTION_KIND = "codex-flow-refresh-v1-inspection";
export const REFRESH_ORIGIN_KIND = "codex-flow-refresh-v1-origin";
export const REFRESH_ROOT_NAME = "refresh-v1";
export const REFRESH_PRIVATE_ARCHIVE_OBSERVATION_KIND = "codex-flow-refresh-v1-private-archive-observation";

const STATES = ["prepared", "archive-observed", "source-retired", "consumed"];
const ROUTES = ["fresh", "resume-source", "refresh-ready", "blocked"];
const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function requireDigest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function requireTimestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
}

function timestampMilliseconds(value, label) {
  return Date.parse(requireTimestamp(value, label));
}

function releaseVersion(value, label) {
  const text = requireText(value, label, { max: 128 });
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(dev|rc)\.(\d+))?$/.exec(text);
  if (match === null) throw new CliError(`${label} is not a supported release version`, 73);
  return {
    text,
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    stage: match[4] === "dev" ? 0 : match[4] === "rc" ? 1 : 2,
    iteration: match[5] === undefined ? 0 : Number(match[5]),
  };
}

function compareReleaseVersions(leftValue, rightValue) {
  const left = releaseVersion(leftValue, "source package version");
  const right = releaseVersion(rightValue, "target package version");
  for (let index = 0; index < left.numbers.length; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) return right.numbers[index] - left.numbers[index];
  }
  if (left.stage !== right.stage) return right.stage - left.stage;
  return right.iteration - left.iteration;
}

function nullableTimestamp(value, label) {
  return value === null ? null : requireTimestamp(value, label);
}

function absolutePath(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function refreshRoot(commonDir) {
  return resolve(commonDir, "codex-flow", REFRESH_ROOT_NAME);
}

function handoffPath(commonDir) {
  return resolve(refreshRoot(commonDir), "handoff.json");
}

function repositoryLockPath(commonDir) {
  return resolve(commonDir, "codex-flow", "foreign-active-run.lock");
}

function originPath(stateRoot, runId) {
  return resolve(
    stateRoot,
    "runs",
    "refresh-origins",
    `${requireText(runId, "run_id", { max: 128, safeId: true })}.json`,
  );
}

function handoffSeed(value) {
  const { handoff_digest: ignored, ...seed } = value;
  return seed;
}

function intentId(intent) {
  return `refresh-v1-${sha256(stableStringify(intent))}`;
}

function validateTree(value, label) {
  requireExactFields(value, {
    required: ["file_count", "byte_count", "tree_digest"],
  }, label);
  return {
    file_count: requireInteger(value.file_count, `${label}.file_count`, { max: 8192 }),
    byte_count: requireInteger(value.byte_count, `${label}.byte_count`, { max: 128 * 1024 * 1024 }),
    tree_digest: requireDigest(value.tree_digest, `${label}.tree_digest`),
  };
}

function validateBaseline(value, label) {
  requireExactFields(value, {
    required: ["root", "common_dir", "branch", "revision", "cleanliness"],
  }, label);
  return {
    root: absolutePath(value.root, `${label}.root`),
    common_dir: absolutePath(value.common_dir, `${label}.common_dir`),
    branch: requireText(value.branch, `${label}.branch`, { max: 256 }),
    revision: requireText(value.revision, `${label}.revision`, { max: 64 }),
    cleanliness: requireEnum(value.cleanliness, ["clean", "dirty"], `${label}.cleanliness`),
  };
}

function validateSourceIdentity(value) {
  requireExactFields(value, {
    required: [
      "namespace", "package_version", "adapter", "run_id", "run_status",
      "runtime_id", "runtime_context_digest", "bundle_sha256", "source_digest",
      "workflow_plan_id", "workflow_revision_digest", "coordinator", "baseline", "tree",
    ],
  }, "refresh source identity");
  requireExactFields(value.coordinator, {
    required: ["lineage_id", "thread_id", "generation"],
  }, "refresh source coordinator");
  return {
    namespace: requireText(value.namespace, "source.namespace", { max: 128, safeId: true }),
    package_version: requireText(value.package_version, "source.package_version", { max: 128 }),
    adapter: requireEnum(value.adapter, ["exact-v0.7.8-adapter", "v0.8-source-export"], "source.adapter"),
    run_id: requireText(value.run_id, "source.run_id", { max: 128, safeId: true }),
    run_status: requireEnum(value.run_status, ["active", "closed", "abandoned"], "source.run_status"),
    runtime_id: requireDigest(value.runtime_id, "source.runtime_id"),
    runtime_context_digest: requireDigest(value.runtime_context_digest, "source.runtime_context_digest"),
    bundle_sha256: requireDigest(value.bundle_sha256, "source.bundle_sha256"),
    source_digest: requireDigest(value.source_digest, "source.source_digest"),
    workflow_plan_id: requireText(value.workflow_plan_id, "source.workflow_plan_id", { max: 128, safeId: true }),
    workflow_revision_digest: requireDigest(value.workflow_revision_digest, "source.workflow_revision_digest"),
    coordinator: {
      lineage_id: requireText(value.coordinator.lineage_id, "source.coordinator.lineage_id", { max: 128, safeId: true }),
      thread_id: requireText(value.coordinator.thread_id, "source.coordinator.thread_id", { max: 256, safeId: true }),
      generation: requireInteger(value.coordinator.generation, "source.coordinator.generation", { min: 1 }),
    },
    baseline: validateBaseline(value.baseline, "source.baseline"),
    tree: validateTree(value.tree, "source.tree"),
  };
}

function validateTargetIdentity(value) {
  requireExactFields(value, {
    required: [
      "mode", "package_version", "plugin_version", "package_root", "bundle_sha256",
      "refresh_skill_sha256", "coordinator_thread_id", "workflow_plan_id",
      "workflow_revision_digest", "fences_digest", "baseline",
    ],
  }, "refresh target identity");
  const target = {
    mode: requireEnum(value.mode, ["replacement-run", "no-replacements"], "target.mode"),
    package_version: requireText(value.package_version, "target.package_version", { max: 128 }),
    plugin_version: requireText(value.plugin_version, "target.plugin_version", { max: 128 }),
    package_root: absolutePath(value.package_root, "target.package_root"),
    bundle_sha256: requireDigest(value.bundle_sha256, "target.bundle_sha256"),
    refresh_skill_sha256: requireDigest(value.refresh_skill_sha256, "target.refresh_skill_sha256"),
    coordinator_thread_id: requireText(value.coordinator_thread_id, "target.coordinator_thread_id", { max: 256, safeId: true }),
    workflow_plan_id: value.workflow_plan_id === null
      ? null
      : requireText(value.workflow_plan_id, "target.workflow_plan_id", { max: 128, safeId: true }),
    workflow_revision_digest: value.workflow_revision_digest === null
      ? null
      : requireDigest(value.workflow_revision_digest, "target.workflow_revision_digest"),
    fences_digest: requireDigest(value.fences_digest, "target.fences_digest"),
    baseline: validateBaseline(value.baseline, "target.baseline"),
  };
  if (target.package_version !== target.plugin_version) {
    throw new CliError("Refresh target package and plugin versions must agree", 73);
  }
  if ((target.workflow_plan_id === null) !== (target.workflow_revision_digest === null)) {
    throw new CliError("Refresh target workflow identity must be wholly present or absent", 73);
  }
  if ((target.mode === "no-replacements") !== (target.workflow_plan_id === null)) {
    throw new CliError("Refresh target mode does not match its workflow identity", 73);
  }
  return target;
}

function validateDecision(value, index) {
  const label = `intent.decisions[${index}]`;
  requireExactFields(value, {
    required: ["source_task_id", "disposition", "rationale"],
  }, label);
  return {
    source_task_id: requireText(value.source_task_id, `${label}.source_task_id`, { max: 128, safeId: true }),
    disposition: requireEnum(value.disposition, ["wait", "discard"], `${label}.disposition`),
    rationale: requireText(value.rationale, `${label}.rationale`, { max: 512 }),
  };
}

function validateBrief(value, label) {
  requireExactFields(value, {
    required: [
      "title", "execution_kind", "mode", "fork_surface", "read_paths", "write_paths",
      "shared_resources", "primary_outcome", "causal_question", "cheapest_safe_direct_attempt",
      "instrument_role", "supporting_authorization", "supporting_follow_up", "brief_digest",
    ],
  }, label);
  const withoutDigest = { ...value };
  delete withoutDigest.brief_digest;
  const brief = clone(value);
  requireDigest(value.brief_digest, `${label}.brief_digest`);
  if (sha256(stableStringify(withoutDigest)) !== value.brief_digest) {
    throw new CliError(`${label}.brief_digest does not match its semantic brief`);
  }
  return brief;
}

function validateReplacement(value, index) {
  const label = `intent.replacements[${index}]`;
  requireExactFields(value, {
    required: [
      "source_task_id", "source_task_digest", "source_contract_id", "source_operation_id",
      "target_task_id", "dependency_source_task_digests", "brief",
    ],
  }, label);
  return {
    source_task_id: requireText(value.source_task_id, `${label}.source_task_id`, { max: 128, safeId: true }),
    source_task_digest: requireDigest(value.source_task_digest, `${label}.source_task_digest`),
    source_contract_id: value.source_contract_id === null
      ? null
      : requireDigest(value.source_contract_id, `${label}.source_contract_id`),
    source_operation_id: value.source_operation_id === null
      ? null
      : requireText(value.source_operation_id, `${label}.source_operation_id`, { max: 128, safeId: true }),
    target_task_id: requireText(value.target_task_id, `${label}.target_task_id`, { max: 128, safeId: true }),
    dependency_source_task_digests: Array.isArray(value.dependency_source_task_digests)
      ? value.dependency_source_task_digests.map((entry, dependencyIndex) => requireDigest(
        entry,
        `${label}.dependency_source_task_digests[${dependencyIndex}]`,
      )).sort()
      : (() => { throw new CliError(`${label}.dependency_source_task_digests must be an array`); })(),
    brief: validateBrief(value.brief, `${label}.brief`),
  };
}

function validateArchiveEvidence(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "refresh_id", "handoff_digest", "archive_intent_id", "thread_id",
      "host_id", "source", "private_observation", "proof_digest",
    ],
  }, label);
  if (
    value.schema_version !== 1
    || value.kind !== REFRESH_PRIVATE_ARCHIVE_OBSERVATION_KIND
    || value.source !== PRIVATE_ARCHIVE_OBSERVATION_SOURCE
  ) throw new CliError(`${label} has unsupported archive authority`, 73);
  const result = {
    schema_version: 1,
    kind: REFRESH_PRIVATE_ARCHIVE_OBSERVATION_KIND,
    refresh_id: requireText(value.refresh_id, `${label}.refresh_id`, { max: 128, safeId: true }),
    handoff_digest: requireDigest(value.handoff_digest, `${label}.handoff_digest`),
    archive_intent_id: requireText(value.archive_intent_id, `${label}.archive_intent_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    source: PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
    private_observation: validatePrivateArchiveObservation(
      value.private_observation,
      `${label}.private_observation`,
    ),
    proof_digest: requireDigest(value.proof_digest, `${label}.proof_digest`),
  };
  if (result.private_observation.thread_id !== result.thread_id) {
    throw new CliError(`${label} private archive observation does not match the exact task`, 73);
  }
  if (result.proof_digest !== refreshArchiveEvidenceDigest(result)) {
    throw new CliError(`${label}.proof_digest is invalid`, 73);
  }
  return result;
}

export function refreshArchiveEvidenceDigest(value) {
  const { proof_digest: ignored, ...seed } = value;
  return sha256(stableStringify(seed));
}

export function refreshArchiveAuthorityDigest(handoff) {
  return sha256(stableStringify({
    refresh_id: handoff.refresh_id,
    intent: handoff.intent,
    cleanup: handoff.cleanup.map((item) => ({
      source_task_id: item.source_task_id,
      creation_operation_id: item.creation_operation_id,
      archive_intent_id: item.archive_intent_id,
      thread_id: item.thread_id,
      host_id: item.host_id,
      git_authority: item.git_authority,
    })),
  }));
}

function archiveEvidenceForHandoff({ handoff, item, privateObservation }) {
  const evidence = {
    schema_version: 1,
    kind: REFRESH_PRIVATE_ARCHIVE_OBSERVATION_KIND,
    refresh_id: handoff.refresh_id,
    handoff_digest: refreshArchiveAuthorityDigest(handoff),
    archive_intent_id: item.archive_intent_id,
    thread_id: item.thread_id,
    host_id: item.host_id,
    source: PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
    private_observation: validatePrivateArchiveObservation(
      privateObservation,
      "refresh private archive observation",
    ),
    proof_digest: "",
  };
  evidence.proof_digest = refreshArchiveEvidenceDigest(evidence);
  return validateArchiveEvidence(evidence, "refresh private archive evidence");
}

function validateCleanup(value, index) {
  const label = `handoff.cleanup[${index}]`;
  requireExactFields(value, {
    required: [
      "source_task_id", "creation_operation_id", "archive_intent_id", "thread_id", "host_id",
      "git_authority", "archive_evidence",
      "worktree_removed_at", "branch_deleted_at",
    ],
  }, label);
  return {
    source_task_id: requireText(value.source_task_id, `${label}.source_task_id`, { max: 128, safeId: true }),
    creation_operation_id: requireText(value.creation_operation_id, `${label}.creation_operation_id`, { max: 128, safeId: true }),
    archive_intent_id: requireText(value.archive_intent_id, `${label}.archive_intent_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    git_authority: value.git_authority === null
      ? null
      : validateRefreshGitAuthority(value.git_authority, `${label}.git_authority`),
    archive_evidence: validateArchiveEvidence(value.archive_evidence, `${label}.archive_evidence`),
    worktree_removed_at: nullableTimestamp(value.worktree_removed_at, `${label}.worktree_removed_at`),
    branch_deleted_at: nullableTimestamp(value.branch_deleted_at, `${label}.branch_deleted_at`),
  };
}

function validateRetirement(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["retired_at", "method", "terminal_status", "final_source_tree"],
  }, "source_retirement");
  return {
    retired_at: requireTimestamp(value.retired_at, "source_retirement.retired_at"),
    method: requireEnum(value.method, ["snapshot-abandon", "already-terminal"], "source_retirement.method"),
    terminal_status: requireEnum(value.terminal_status, ["closed", "abandoned"], "source_retirement.terminal_status"),
    final_source_tree: validateTree(value.final_source_tree, "source_retirement.final_source_tree"),
  };
}

function validateConsumption(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["mode", "target_run_id", "target_runtime_id", "origin_digest", "consumed_at"],
  }, "target_consumption");
  const mode = requireEnum(value.mode, ["run-activation", "clean-start"], "target_consumption.mode");
  const consumption = {
    mode,
    target_run_id: value.target_run_id === null
      ? null
      : requireText(value.target_run_id, "target_consumption.target_run_id", { max: 128, safeId: true }),
    target_runtime_id: value.target_runtime_id === null
      ? null
      : requireDigest(value.target_runtime_id, "target_consumption.target_runtime_id"),
    origin_digest: value.origin_digest === null
      ? null
      : requireDigest(value.origin_digest, "target_consumption.origin_digest"),
    consumed_at: requireTimestamp(value.consumed_at, "target_consumption.consumed_at"),
  };
  const identifiers = [consumption.target_run_id, consumption.target_runtime_id, consumption.origin_digest];
  if (mode === "run-activation" && identifiers.some((entry) => entry === null)) {
    throw new CliError("Run-activation refresh consumption requires complete target identity", 73);
  }
  if (mode === "clean-start" && identifiers.some((entry) => entry !== null)) {
    throw new CliError("Clean-start refresh consumption cannot claim a target run", 73);
  }
  return consumption;
}

function validateIntent(value) {
  requireExactFields(value, {
    required: [
      "source", "source_resume", "target", "decisions", "replacements",
      "replacement_digest", "prepared_at",
    ],
  }, "refresh intent");
  const source = validateSourceIdentity(value.source);
  const target = validateTargetIdentity(value.target);
  if (source.coordinator.thread_id !== target.coordinator_thread_id) {
    throw new CliError("Refresh target must remain in the same coordinator task", 73);
  }
  if (compareReleaseVersions(source.package_version, target.package_version) <= 0) {
    throw new CliError("Refresh target package must be newer than the source snapshot", 73);
  }
  const decisions = Array.isArray(value.decisions)
    ? value.decisions.map(validateDecision).sort((left, right) => left.source_task_id.localeCompare(right.source_task_id))
    : (() => { throw new CliError("refresh intent.decisions must be an array"); })();
  const replacements = Array.isArray(value.replacements)
    ? value.replacements.map(validateReplacement).sort((left, right) => left.source_task_id.localeCompare(right.source_task_id))
    : (() => { throw new CliError("refresh intent.replacements must be an array"); })();
  if (new Set(decisions.map((entry) => entry.source_task_id)).size !== decisions.length) {
    throw new CliError("Refresh decisions contain duplicate source tasks");
  }
  if (
    new Set(replacements.map((entry) => entry.source_task_id)).size !== replacements.length
    || new Set(replacements.map((entry) => entry.target_task_id)).size !== replacements.length
  ) throw new CliError("Refresh replacements must map source and target tasks exactly once");
  if ((replacements.length === 0) !== (target.mode === "no-replacements")) {
    throw new CliError("Refresh target workflow exists exactly when replacement work exists", 73);
  }
  const replacementDigest = sha256(stableStringify(replacements));
  if (value.replacement_digest !== replacementDigest) {
    throw new CliError("refresh intent.replacement_digest is invalid");
  }
  return {
    source,
    source_resume: validateRunBinding(value.source_resume, "intent.source_resume"),
    target,
    decisions,
    replacements,
    replacement_digest: replacementDigest,
    prepared_at: requireTimestamp(value.prepared_at, "intent.prepared_at"),
  };
}

export function validateRefreshHandoff(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "refresh_id", "state", "intent", "cleanup",
      "source_retirement", "target_consumption", "updated_at", "handoff_digest",
    ],
  }, "refresh handoff");
  if (value.schema_version !== REFRESH_SCHEMA_VERSION || value.kind !== REFRESH_HANDOFF_KIND) {
    throw new CliError("Unsupported refresh handoff");
  }
  const intent = validateIntent(value.intent);
  const handoff = {
    schema_version: REFRESH_SCHEMA_VERSION,
    kind: REFRESH_HANDOFF_KIND,
    refresh_id: requireText(value.refresh_id, "refresh_id", { max: 128, safeId: true }),
    state: requireEnum(value.state, STATES, "refresh state"),
    intent,
    cleanup: Array.isArray(value.cleanup)
      ? value.cleanup.map(validateCleanup).sort((left, right) => left.source_task_id.localeCompare(right.source_task_id))
      : (() => { throw new CliError("refresh handoff.cleanup must be an array"); })(),
    source_retirement: validateRetirement(value.source_retirement),
    target_consumption: validateConsumption(value.target_consumption),
    updated_at: requireTimestamp(value.updated_at, "handoff.updated_at"),
  };
  if (handoff.refresh_id !== intentId(intent)) throw new CliError("refresh_id is not content-addressed to its immutable intent");
  if (new Set(handoff.cleanup.map((entry) => entry.source_task_id)).size !== handoff.cleanup.length) {
    throw new CliError("Refresh cleanup contains duplicate source tasks");
  }
  if (handoff.cleanup.some((entry) => !intent.decisions.some((decision) => (
    decision.source_task_id === entry.source_task_id && decision.disposition === "discard"
  )))) throw new CliError("Refresh cleanup is not covered by an exact discard decision");
  for (const item of handoff.cleanup) {
    const expectedArchiveIntentId = `refresh-archive-v1-${sha256(stableStringify({
      source_digest: intent.source.source_digest,
      source_task_id: item.source_task_id,
      creation_operation_id: item.creation_operation_id,
      thread_id: item.thread_id,
      host_id: item.host_id,
    }))}`;
    if (item.archive_intent_id !== expectedArchiveIntentId) {
      throw new CliError("Refresh archive intent is not content-addressed to its exact task authority", 73);
    }
    if (item.archive_evidence !== null && (
      item.archive_evidence.archive_intent_id !== item.archive_intent_id
      || item.archive_evidence.thread_id !== item.thread_id
      || item.archive_evidence.host_id !== item.host_id
      || item.archive_evidence.refresh_id !== handoff.refresh_id
      || item.archive_evidence.handoff_digest !== refreshArchiveAuthorityDigest(handoff)
    )) throw new CliError("Refresh archive observation does not match its exact archive intent", 73);
  }
  if (handoff.state === "prepared" && (
    handoff.cleanup.some((entry) => entry.archive_evidence !== null || entry.worktree_removed_at !== null || entry.branch_deleted_at !== null)
    || handoff.source_retirement !== null
    || handoff.target_consumption !== null
  )) throw new CliError("Prepared refresh handoff cannot contain applied evidence");
  if (["archive-observed", "source-retired", "consumed"].includes(handoff.state)) {
    if (handoff.cleanup.some((entry) => entry.archive_evidence === null)) {
      throw new CliError("Archive-observed refresh handoff requires every exact archive observation");
    }
  }
  if (["source-retired", "consumed"].includes(handoff.state)) {
    if (
      handoff.cleanup.some((entry) => entry.git_authority !== null
        && (entry.worktree_removed_at === null || entry.branch_deleted_at === null))
      || handoff.source_retirement === null
    ) throw new CliError("Source-retired refresh handoff requires completed discard and retirement evidence");
  }
  if (handoff.cleanup.some((entry) => entry.git_authority === null
    && (entry.worktree_removed_at !== null || entry.branch_deleted_at !== null))) {
    throw new CliError("A local executor discard cannot claim worktree or branch deletion", 73);
  }
  if ((handoff.state === "consumed") !== (handoff.target_consumption !== null)) {
    throw new CliError("Refresh target consumption must exist exactly in consumed state");
  }
  const preparedAt = timestampMilliseconds(handoff.intent.prepared_at, "intent.prepared_at");
  const updatedAt = timestampMilliseconds(handoff.updated_at, "handoff.updated_at");
  if (updatedAt < preparedAt) throw new CliError("Refresh handoff updated_at precedes preparation", 73);
  for (const item of handoff.cleanup) {
    const observedAt = item.archive_evidence === null
      ? null
      : timestampMilliseconds(item.archive_evidence.private_observation.observed_at, "archive_evidence.private_observation.observed_at");
    const worktreeRemovedAt = item.worktree_removed_at === null
      ? null
      : timestampMilliseconds(item.worktree_removed_at, "worktree_removed_at");
    const branchDeletedAt = item.branch_deleted_at === null
      ? null
      : timestampMilliseconds(item.branch_deleted_at, "branch_deleted_at");
    if (observedAt !== null && (observedAt < preparedAt || observedAt > updatedAt)) {
      throw new CliError("Refresh archive observation is outside the handoff chronology", 73);
    }
    if (worktreeRemovedAt !== null && (observedAt === null || worktreeRemovedAt < observedAt || worktreeRemovedAt > updatedAt)) {
      throw new CliError("Refresh worktree removal is outside the handoff chronology", 73);
    }
    if (branchDeletedAt !== null && (worktreeRemovedAt === null || branchDeletedAt < worktreeRemovedAt || branchDeletedAt > updatedAt)) {
      throw new CliError("Refresh branch deletion is outside the handoff chronology", 73);
    }
  }
  if (handoff.source_retirement !== null) {
    const retiredAt = timestampMilliseconds(handoff.source_retirement.retired_at, "source_retirement.retired_at");
    const cleanupTimes = handoff.cleanup.flatMap((item) => [
      item.archive_evidence?.private_observation.observed_at,
      item.worktree_removed_at,
      item.branch_deleted_at,
    ]).filter((entry) => entry !== null).map((entry) => Date.parse(entry));
    if (retiredAt < Math.max(preparedAt, ...cleanupTimes) || retiredAt > updatedAt) {
      throw new CliError("Refresh source retirement is outside the handoff chronology", 73);
    }
  }
  if (handoff.target_consumption !== null) {
    const consumedAt = timestampMilliseconds(handoff.target_consumption.consumed_at, "target_consumption.consumed_at");
    const retiredAt = timestampMilliseconds(handoff.source_retirement.retired_at, "source_retirement.retired_at");
    if (consumedAt < retiredAt || consumedAt > updatedAt) {
      throw new CliError("Refresh target consumption is outside the handoff chronology", 73);
    }
  }
  const expectedDigest = sha256(stableStringify(handoffSeed(handoff)));
  if (value.handoff_digest !== expectedDigest) throw new CliError("refresh handoff digest is invalid");
  return { ...handoff, handoff_digest: expectedDigest };
}

function withHandoffDigest(value) {
  const seed = handoffSeed(value);
  return validateRefreshHandoff({
    ...seed,
    handoff_digest: sha256(stableStringify(seed)),
  });
}

async function readHandoff(commonDir, { allowMissing = false } = {}) {
  const raw = await readJson(handoffPath(commonDir), {
    allowMissing,
    guardRoot: resolve(commonDir),
  });
  return raw === null ? null : validateRefreshHandoff(raw);
}

async function persistHandoff(commonDir, handoff) {
  const validated = validateRefreshHandoff(handoff);
  await atomicWriteJson(handoffPath(commonDir), validated, {
    guardRoot: resolve(commonDir),
    mode: 0o600,
  });
  return validated;
}

function inspection(route, authority, reason = null) {
  return {
    schema_version: REFRESH_SCHEMA_VERSION,
    kind: REFRESH_INSPECTION_KIND,
    route: requireEnum(route, ROUTES, "refresh route"),
    mutation_performed: false,
    authority,
    reason,
  };
}

export async function authenticateRefreshSkill({ packageRoot, invokingSkillPath }) {
  const root = await realpath(absolutePath(packageRoot, "packageRoot")).catch(() => null);
  if (root === null) throw new CliError("Loaded Codex Orchestration package root is unavailable; reload the App", 73);
  const expectedSkill = resolve(root, "skills", "refresh", "SKILL.md");
  const observedSkill = await realpath(absolutePath(invokingSkillPath, "invokingSkillPath")).catch(() => null);
  if (observedSkill !== expectedSkill) {
    throw new CliError(
      `Loaded skill and CLI package disagree; reload the Codex App before refresh (expected ${expectedSkill})`,
      73,
    );
  }
  const [packageJson, pluginJson, skillBytes, bundle] = await Promise.all([
    readJson(resolve(root, "package.json")),
    readJson(resolve(root, ".codex-plugin", "plugin.json")),
    readFile(expectedSkill),
    loadRuntimeBundleSource({ packageRoot: root }),
  ]);
  if (
    packageJson.name !== "@wjmao/codex-flow"
    || packageJson.version !== PACKAGE_VERSION
    || pluginJson.name !== "codex-orchestration"
    || pluginJson.version !== PACKAGE_VERSION
  ) throw new CliError("Loaded skill, package, and CLI versions disagree; reload the Codex App", 73);
  const skillDigest = sha256(skillBytes);
  if (bundle.bundle.files["skills/refresh/SKILL.md"] !== skillDigest) {
    throw new CliError("Loaded refresh skill is not authenticated by the executing package bundle", 73);
  }
  return {
    package_version: PACKAGE_VERSION,
    plugin_version: pluginJson.version,
    package_root: root,
    bundle_sha256: bundle.bundle.bundle_sha256,
    refresh_skill_sha256: skillDigest,
  };
}

async function currentNamespaceLifecycle(commonDir, currentNamespace) {
  const common = resolve(commonDir);
  const namespaceRoot = resolve(common, "codex-flow", currentNamespace);
  const info = await lstat(namespaceRoot).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) return null;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CliError("Current Codex Flow namespace is not a real directory", 73);
  }
  const path = resolve(namespaceRoot, "runs", "lifecycle.json");
  const raw = await readJson(path, { allowMissing: true, guardRoot: common });
  if (raw === null) {
    throw new CliError("Current Codex Flow namespace exists without lifecycle authority", 73);
  }
  return validateRunLifecycleState(raw);
}

function sourceCutoverBlocker(source) {
  for (const state of source.task_states) {
    if (state.task.execution_kind !== "task-thread" || state.creation === null) continue;
    if (["attempting", "provisional", "ambiguous"].includes(state.creation.status)) {
      return `Visible executor identity must be reconciled under the source snapshot before refresh: ${state.task.task_id}`;
    }
    if (state.integrations.some((entry) => entry.state !== "reconciled")) {
      return `Visible executor integration must be reconciled under the source snapshot before refresh: ${state.task.task_id}`;
    }
    if (
      state.creation.status === "ready-unreleased"
      && state.creation.selector_evidence.requested.worktree.mode === "host-worktree"
      && state.creation.worktree_binding?.state !== "completed"
    ) return `Visible executor worktree must be bound under the source snapshot before refresh: ${state.task.task_id}`;
  }
  return null;
}

export async function inspectRefresh({
  commonDir,
  currentNamespace,
  packageRoot,
  invokingSkillPath,
}) {
  const common = resolve(commonDir);
  let target;
  try {
    target = await authenticateRefreshSkill({ packageRoot, invokingSkillPath });
  } catch (error) {
    return inspection("blocked", { package_version: PACKAGE_VERSION }, error.message);
  }
  try {
    const handoff = await readHandoff(common, { allowMissing: true });
    if (handoff !== null) {
      if (
        handoff.intent.target.package_version !== target.package_version
        || handoff.intent.target.bundle_sha256 !== target.bundle_sha256
        || handoff.intent.target.refresh_skill_sha256 !== target.refresh_skill_sha256
      ) return inspection("blocked", { target, refresh: handoff }, "A refresh handoff is bound to a different loaded package; reload its exact App skill authority");
      return inspection("refresh-ready", { target, refresh: handoff }, null);
    }
    const current = await currentNamespaceLifecycle(common, currentNamespace);
    if (current?.active_run_id) {
      const source = await loadRefreshSourceAuthority({
        commonDir: common,
        namespace: currentNamespace,
        runId: current.active_run_id,
      });
      return inspection("resume-source", { target, source: refreshSourceSummary(source) }, null);
    }
    const candidates = await refreshNamespaceCandidates({
      commonDir: common,
      currentNamespace,
    });
    if (candidates.length === 0) return inspection("fresh", { target }, null);
    if (candidates.length !== 1) {
      return inspection("blocked", { target, namespaces: candidates.map((entry) => entry.namespace) }, "Refresh requires exactly one supported predecessor namespace");
    }
    const candidate = candidates[0];
    const selectedRunId = candidate.lifecycle.active_run_id
      ?? Object.values(candidate.lifecycle.runs).sort((left, right) => (
        Date.parse(right.updated_at) - Date.parse(left.updated_at)
      ))[0]?.run_id;
    if (!selectedRunId) return inspection("blocked", { target, namespace: candidate.namespace }, "Predecessor namespace has no run authority");
    const source = await loadRefreshSourceAuthority({
      commonDir: common,
      namespace: candidate.namespace,
      runId: selectedRunId,
    });
    await assertOtherRefreshSourceRunsSafe(source);
    const cutoverBlocker = sourceCutoverBlocker(source);
    if (cutoverBlocker !== null) {
      return inspection("blocked", { target, source: refreshSourceSummary(source) }, cutoverBlocker);
    }
    return inspection("refresh-ready", { target, source: refreshSourceSummary(source) }, null);
  } catch (error) {
    return inspection("blocked", { target }, error.message);
  }
}

function normalizeDecisionRequest(value, source) {
  if (!Array.isArray(value)) throw new CliError("refresh prepare decisions must be an array");
  const decisions = value.map((entry, index) => {
    requireExactFields(entry, {
      required: ["source_task_id", "disposition", "rationale"],
    }, `decisions[${index}]`);
    return validateDecision(entry, index);
  }).sort((left, right) => left.source_task_id.localeCompare(right.source_task_id));
  const taskIds = source.task_states
    .filter((entry) => entry.task.execution_kind === "task-thread")
    .map((entry) => entry.task.task_id)
    .sort();
  if (stableStringify(decisions.map((entry) => entry.source_task_id)) !== stableStringify(taskIds)) {
    throw new CliError("Refresh decisions must cover every visible executor task exactly once", 73);
  }
  for (const decision of decisions) {
    const state = source.task_states.find((entry) => entry.task.task_id === decision.source_task_id);
    if (decision.disposition === "wait") {
      if (!(state.embodied || state.completed_no_change) || !state.archived) {
        throw new CliError(`Wait task is not yet durably settled under the source snapshot: ${decision.source_task_id}`, 73);
      }
    }
    if (decision.disposition === "discard" && state.integrations.length > 0) {
      throw new CliError(`A task with any integration record can no longer be discarded: ${decision.source_task_id}`, 73);
    }
  }
  return decisions;
}

function requiredReplacementTasks(source, decisions) {
  const byId = new Map(source.task_states.map((entry) => [entry.task.task_id, entry]));
  const required = new Set(decisions
    .filter((entry) => entry.disposition === "discard")
    .map((entry) => entry.source_task_id));
  function addDependencies(taskId) {
    const task = byId.get(taskId).task;
    const linkedTaskIds = [...task.dependencies];
    if (task.supporting_follow_up?.kind === "direct-attempt") {
      linkedTaskIds.push(task.supporting_follow_up.task_id);
    }
    for (const dependencyId of linkedTaskIds) {
      const dependency = byId.get(dependencyId);
      if (dependency.embodied) continue;
      if (!required.has(dependencyId)) {
        required.add(dependencyId);
        addDependencies(dependencyId);
      }
    }
  }
  for (const taskId of [...required]) addDependencies(taskId);
  return [...required].sort();
}

function normalizeReplacementMap(value, requiredSourceIds, allSourceIds, targetWorkflow) {
  if (!Array.isArray(value)) throw new CliError("refresh prepare replacements must be an array");
  const mappings = value.map((entry, index) => {
    requireExactFields(entry, {
      required: ["source_task_id", "target_task_id"],
    }, `replacements[${index}]`);
    return {
      source_task_id: requireText(entry.source_task_id, `replacements[${index}].source_task_id`, { max: 128, safeId: true }),
      target_task_id: requireText(entry.target_task_id, `replacements[${index}].target_task_id`, { max: 128, safeId: true }),
    };
  }).sort((left, right) => left.source_task_id.localeCompare(right.source_task_id));
  if (stableStringify(mappings.map((entry) => entry.source_task_id)) !== stableStringify(requiredSourceIds)) {
    throw new CliError("Refresh replacements must cover the exact discarded/non-embodied dependency closure", 73);
  }
  if (new Set(mappings.map((entry) => entry.target_task_id)).size !== mappings.length) {
    throw new CliError("Refresh replacements must use fresh target task IDs exactly once", 73);
  }
  const sourceIds = new Set(allSourceIds);
  if (mappings.some((entry) => sourceIds.has(entry.target_task_id))) {
    throw new CliError("Refresh replacement task IDs must be fresh", 73);
  }
  const targetIds = (targetWorkflow?.tasks ?? []).map((task) => task.task_id).sort();
  if (stableStringify(targetIds) !== stableStringify(mappings.map((entry) => entry.target_task_id).sort())) {
    throw new CliError("Target workflow may contain only exact refresh replacements", 73);
  }
  return mappings;
}

function buildReplacementEvidence(source, targetWorkflow, mappings) {
  const sourceById = new Map(source.task_states.map((entry) => [entry.task.task_id, entry]));
  const sourceTasks = new Map(source.task_states.map((entry) => [entry.task.task_id, entry.task]));
  const targetById = new Map((targetWorkflow?.tasks ?? []).map((entry) => [entry.task_id, entry]));
  const targetTasks = new Map((targetWorkflow?.tasks ?? []).map((entry) => [entry.task_id, entry]));
  const sourceToTarget = new Map(mappings.map((entry) => [entry.source_task_id, entry.target_task_id]));
  const evidence = [];
  for (const mapping of mappings) {
    const sourceState = sourceById.get(mapping.source_task_id);
    const targetTask = targetById.get(mapping.target_task_id);
    const sourceBrief = refreshTaskSemanticBrief(sourceState.task, sourceTasks);
    const targetBrief = refreshTaskSemanticBrief(targetTask, targetTasks);
    if (stableStringify(sourceBrief) !== stableStringify(targetBrief)) {
      throw new CliError(`Replacement semantic brief drifted: ${mapping.source_task_id}`, 73);
    }
    const expectedDependencies = sourceState.task.dependencies
      .filter((dependency) => sourceToTarget.has(dependency))
      .map((dependency) => sourceToTarget.get(dependency)).sort();
    if (stableStringify(targetTask.dependencies) !== stableStringify(expectedDependencies)) {
      throw new CliError(`Replacement dependency topology drifted: ${mapping.source_task_id}`, 73);
    }
    evidence.push({
      source_task_id: sourceState.task.task_id,
      source_task_digest: sourceState.contract?.task_digest
        ?? sha256(stableStringify(sourceState.task)),
      source_contract_id: sourceState.contract?.contract_id ?? null,
      source_operation_id: sourceState.creation?.operation_id ?? sourceState.subagent?.operation_id ?? null,
      target_task_id: targetTask.task_id,
      dependency_source_task_digests: sourceState.task.dependencies
        .filter((dependency) => sourceToTarget.has(dependency))
        .map((dependency) => {
          const dependencyState = sourceById.get(dependency);
          return dependencyState.contract?.task_digest ?? sha256(stableStringify(dependencyState.task));
        }).sort(),
      brief: sourceBrief,
    });
  }
  return evidence.sort((left, right) => left.source_task_id.localeCompare(right.source_task_id));
}

async function buildCleanupEvidence(source, decisions) {
  const result = [];
  for (const decision of decisions.filter((entry) => entry.disposition === "discard")) {
    const task = source.task_states.find((entry) => entry.task.task_id === decision.source_task_id);
    if (task.creation === null) continue;
    if (["prepared", "not-created", "session-blocked"].includes(task.creation.status)) {
      if (
        task.creation.provisional !== null
        || task.creation.ready !== null
        || task.creation.worktree_binding !== null
      ) throw new CliError(`No-object discard contains contradictory task identity: ${task.task.task_id}`, 73);
      continue;
    }
    if (
      task.task.execution_kind !== "task-thread"
      || task.creation.status !== "ready-unreleased"
      || task.creation.ready === null
    ) throw new CliError(`Discard requires exact ready task authority: ${task.task.task_id}`, 73);
    const requested = task.creation.selector_evidence.requested.worktree;
    const observed = task.creation.selector_evidence.observed?.worktree;
    let gitAuthority = null;
    if (requested.mode === "host-worktree") {
      if (
        observed?.mode !== "host-worktree"
        || observed.path === null
        || requested.executor_branch === null
        || task.creation.worktree_binding?.state !== "completed"
      ) throw new CliError(`Discard requires an exact host-worktree executor: ${task.task.task_id}`, 73);
      gitAuthority = await captureRefreshGitAuthority({
        commonDir: source.baseline.common_dir,
        worktreePath: observed.path,
        branch: requested.executor_branch,
        expectedHead: null,
        forbiddenRoots: [source.runtime.context.repository.root, source.baseline.root],
        protectedBranches: [
          source.runtime.context.repository.branch,
          source.baseline.branch,
          requested.starting_branch,
          "main",
          "master",
        ].filter(Boolean),
      });
    } else if (
      requested.mode !== "local"
      || observed?.mode !== "local"
      || task.creation.worktree_binding !== null
      || task.task.mode !== "read"
    ) {
      throw new CliError(`Discard executor placement is contradictory: ${task.task.task_id}`, 73);
    }
    result.push({
      source_task_id: task.task.task_id,
      creation_operation_id: task.creation.operation_id,
      archive_intent_id: `refresh-archive-v1-${sha256(stableStringify({
        source_digest: source.source_digest,
        source_task_id: task.task.task_id,
        creation_operation_id: task.creation.operation_id,
        thread_id: task.creation.ready.thread_id,
        host_id: source.runtime.context.host.host_id,
      }))}`,
      thread_id: task.creation.ready.thread_id,
      host_id: source.runtime.context.host.host_id,
      git_authority: gitAuthority,
      archive_evidence: null,
      worktree_removed_at: null,
      branch_deleted_at: null,
    });
  }
  return result;
}

function snapshotBaseline(cwd) {
  const git = gitSnapshot(cwd);
  return {
    root: git.root,
    common_dir: git.commonDir,
    branch: git.branch,
    revision: git.revision,
    cleanliness: git.cleanliness,
  };
}

export async function prepareRefresh({
  commonDir,
  sourceNamespace,
  sourceRunId,
  sourceResume,
  decisions: decisionRequest,
  replacements: replacementRequest,
  targetWorkflow: workflowDraft,
  targetFences,
  targetCoordinatorThreadId,
  targetAuthority,
  preparedAt,
  cwd,
}) {
  const common = resolve(commonDir);
  return withProcessLock({
    path: repositoryLockPath(common),
    guardRoot: common,
    label: "Codex Flow repository refresh",
  }, async () => {
    const existing = await readHandoff(common, { allowMissing: true });
    const source = await loadRefreshSourceAuthority({
      commonDir: common,
      namespace: sourceNamespace,
      runId: sourceRunId,
    });
    await assertOtherRefreshSourceRunsSafe(source);
    if (source.run.status === "active" && stableStringify(source.run.binding) !== stableStringify(sourceResume)) {
      throw new CliError("Refresh source resume fence does not match the active run", 73);
    }
    if (source.baseline.cleanliness !== "clean") {
      throw new CliError("Refresh requires a clean coordinator baseline; executor worktrees may be dirty", 73);
    }
    const callerBaseline = snapshotBaseline(cwd);
    if (
      callerBaseline.common_dir !== common
      || callerBaseline.root !== source.baseline.root
      || callerBaseline.revision !== source.baseline.revision
      || callerBaseline.branch !== source.baseline.branch
      || callerBaseline.cleanliness !== "clean"
    ) throw new CliError("Refresh caller does not match the clean source coordinator baseline", 73);
    const decisions = normalizeDecisionRequest(decisionRequest, source);
    const requiredSourceIds = requiredReplacementTasks(source, decisions);
    const hasReplacementWork = requiredSourceIds.length > 0;
    if (hasReplacementWork !== (workflowDraft !== null)) {
      throw new CliError(
        "Refresh target workflow must exist exactly when replacement work is required",
        73,
      );
    }
    const targetWorkflow = hasReplacementWork ? createWorkflowPlanRevision(workflowDraft) : null;
    const normalizedTargetFences = validateFencePlan(targetFences, "refresh target fences");
    if (!hasReplacementWork && !fencePlanIsEmpty(normalizedTargetFences)) {
      throw new CliError("A no-replacement refresh must not reserve target fences", 73);
    }
    const sourceBranches = new Set(source.run.plan.branch_fences);
    const reusedBranch = normalizedTargetFences.branch_fences.find((branch) => sourceBranches.has(branch));
    if (reusedBranch !== undefined) {
      throw new CliError(`Refresh replacement branch identity must be fresh: ${reusedBranch}`, 73);
    }
    const mappings = normalizeReplacementMap(
      replacementRequest,
      requiredSourceIds,
      source.task_states.map((entry) => entry.task.task_id),
      targetWorkflow,
    );
    const replacementEvidence = buildReplacementEvidence(source, targetWorkflow, mappings);
    const cleanup = await buildCleanupEvidence(source, decisions);
    const target = {
      ...targetAuthority,
      mode: hasReplacementWork ? "replacement-run" : "no-replacements",
      coordinator_thread_id: requireText(targetCoordinatorThreadId, "target_coordinator_thread_id", { max: 256, safeId: true }),
      workflow_plan_id: targetWorkflow?.plan_id ?? null,
      workflow_revision_digest: targetWorkflow?.revision_digest ?? null,
      fences_digest: sha256(stableStringify(normalizedTargetFences)),
      baseline: callerBaseline,
    };
    const { executor_tasks: _executorTasks, ...sourceSummary } = refreshSourceSummary(source);
    const sourceIdentity = validateSourceIdentity(sourceSummary);
    if (
      sourceIdentity.package_version === target.package_version
      && sourceIdentity.bundle_sha256 === target.bundle_sha256
    ) throw new CliError("Source run already uses the loaded plugin authority; resume its immutable snapshot", 73);
    const intent = validateIntent({
      source: sourceIdentity,
      source_resume: sourceResume,
      target,
      decisions,
      replacements: replacementEvidence,
      replacement_digest: sha256(stableStringify(replacementEvidence)),
      prepared_at: requireTimestamp(preparedAt, "prepared_at"),
    });
    const prepared = withHandoffDigest({
      schema_version: REFRESH_SCHEMA_VERSION,
      kind: REFRESH_HANDOFF_KIND,
      refresh_id: intentId(intent),
      state: "prepared",
      intent,
      cleanup,
      source_retirement: null,
      target_consumption: null,
      updated_at: intent.prepared_at,
    });
    if (existing !== null) {
      if (stableStringify(existing) !== stableStringify(prepared)) {
        throw new CliError("Only one exact refresh handoff may exist", 73);
      }
      return { status: "existing", handoff: existing, mutation_performed: false };
    }
    await ensureExactJson(handoffPath(common), prepared, { guardRoot: common, mode: 0o600 });
    return { status: "prepared", handoff: prepared, mutation_performed: true };
  });
}

async function normalizeArchiveRequest({
  value,
  cleanup,
  handoff,
  observePrivateArchive,
}) {
  if (!Array.isArray(value)) throw new CliError("refresh apply archive_evidence must be an array");
  const evidence = value.map((entry, index) => validateArchiveEvidence(entry, `archive_evidence[${index}]`))
    .sort((left, right) => left.archive_intent_id.localeCompare(right.archive_intent_id));
  const expected = cleanup.map((entry) => entry.archive_intent_id).sort();
  if (stableStringify(evidence.map((entry) => entry.archive_intent_id)) !== stableStringify(expected)) {
    throw new CliError("Refresh archive evidence must cover every discarded executor task exactly once", 73);
  }
  for (const item of cleanup) {
    const observed = evidence.find((entry) => entry.archive_intent_id === item.archive_intent_id);
    if (
      observed.refresh_id !== handoff.refresh_id
      || observed.handoff_digest !== refreshArchiveAuthorityDigest(handoff)
      || observed.thread_id !== item.thread_id
      || observed.host_id !== item.host_id
    ) {
      throw new CliError("Refresh archive evidence task or host identity drifted", 73);
    }
    if (timestampMilliseconds(observed.private_observation.observed_at, "refresh private archive evidence observed_at")
      < timestampMilliseconds(handoff.intent.prepared_at, "refresh handoff prepared_at")) {
      throw new CliError("Refresh archive evidence predates the prepared handoff", 73);
    }
    const live = await observePrivateArchive({
      threadId: item.thread_id,
      handoff,
      cleanup: item,
    });
    const liveEvidence = archiveEvidenceForHandoff({
      handoff,
      item,
      privateObservation: live,
    });
    // The observer's binding digest intentionally includes its observation time, so
    // a second observation cannot have the same binding. The immutable session
    // digest is the stable host artifact whose continued placement is rechecked.
    if (liveEvidence.private_observation.session_digest !== observed.private_observation.session_digest) {
      throw new CliError("Refresh archive evidence is stale or no longer matches the host archive", 73);
    }
  }
  return evidence;
}

export async function observeRefreshPrivateArchives({
  commonDir,
  refreshId,
  codexHome,
  now = Date.now(),
}) {
  const common = resolve(commonDir);
  const handoff = await readHandoff(common);
  if (handoff.refresh_id !== refreshId) throw new CliError("refresh_id does not match the pending handoff", 73);
  if (!["prepared", "archive-observed"].includes(handoff.state)) {
    throw new CliError("Refresh private archive observation requires a prepared or archive-observed handoff", 73);
  }
  const archiveEvidence = [];
  for (const item of handoff.cleanup) {
    const privateObservation = await observeCodexAppPrivateArchive({
      threadId: item.thread_id,
      codexHome,
      now,
    });
    if (handoff.state === "archive-observed") {
      if (privateObservation.session_digest !== item.archive_evidence.private_observation.session_digest) {
        throw new CliError("Refresh archive evidence is stale or no longer matches the host archive", 73);
      }
      archiveEvidence.push(item.archive_evidence);
    } else {
      archiveEvidence.push(archiveEvidenceForHandoff({ handoff, item, privateObservation }));
    }
  }
  return {
    schema_version: 1,
    kind: "codex-flow-refresh-v1-private-archive-observation-result",
    refresh_id: handoff.refresh_id,
    handoff_digest: refreshArchiveAuthorityDigest(handoff),
    mutation_performed: false,
    archive_evidence: archiveEvidence.sort((left, right) => left.archive_intent_id.localeCompare(right.archive_intent_id)),
  };
}

async function writeTransition(commonDir, current, patch, timestamp) {
  const next = withHandoffDigest({
    ...current,
    ...patch,
    updated_at: requireTimestamp(timestamp, "transition timestamp"),
  });
  return persistHandoff(commonDir, next);
}

async function runSnapshotAbandon(source, intent, retiredAt) {
  const temporary = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-retire-"));
  return (async () => {
    try {
      const requestPath = resolve(temporary, "request.json");
      await atomicWriteJson(requestPath, {
        run_id: intent.source.run_id,
        resume: intent.source_resume,
        reason: `Superseded by bounded refresh ${intentId(intent)}`,
        abandoned_at: requireTimestamp(retiredAt, "retired_at"),
      }, { guardRoot: temporary, mode: 0o600 });
      const result = spawnSync(process.execPath, [
        source.runtime.cli_path,
        "run",
        "abandon",
        "--run-id",
        intent.source.run_id,
        "--file",
        requestPath,
        "--json",
      ], {
        cwd: source.runtime.context.repository.root,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.status !== 0) {
        throw new CliError(String(result.stderr || result.stdout).trim() || "Source snapshot retirement failed", 73);
      }
      return JSON.parse(result.stdout);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  })();
}

async function assertPreparedSourceUnchanged(commonDir, handoff) {
  const current = await refreshNamespaceTreeDigest({
    commonDir,
    namespace: handoff.intent.source.namespace,
  });
  if (stableStringify(current) !== stableStringify(handoff.intent.source.tree)) {
    throw new CliError("Refresh source state changed after handoff preparation; late or stale evidence fails closed", 73);
  }
}

async function finishCleanStartConsumption(commonDir, handoff, timestamp, hooks) {
  if (
    handoff.intent.replacements.length !== 0
    || handoff.intent.target.workflow_plan_id !== null
    || handoff.intent.target.workflow_revision_digest !== null
  ) throw new CliError("Clean-start refresh consumption cannot discard target work", 73);
  if (handoff.state === "source-retired") {
    handoff = await writeTransition(commonDir, handoff, {
      state: "consumed",
      target_consumption: {
        mode: "clean-start",
        target_run_id: null,
        target_runtime_id: null,
        origin_digest: null,
        consumed_at: timestamp,
      },
    }, timestamp);
    await hooks.afterConsumedWrite?.(clone(handoff));
  } else if (
    handoff.state !== "consumed"
    || handoff.target_consumption?.mode !== "clean-start"
  ) {
    throw new CliError("Refresh handoff is not eligible for clean-start consumption", 73);
  }

  const sourceRoot = resolve(commonDir, "codex-flow", handoff.intent.source.namespace);
  const sourceExists = await lstat(sourceRoot).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  if (sourceExists) {
    const source = await loadRefreshSourceAuthority({
      commonDir,
      namespace: handoff.intent.source.namespace,
      runId: handoff.intent.source.run_id,
    });
    await assertRefreshNamespaceRemovalSafe({ source, handoff });
    const tree = await refreshNamespaceTreeDigest({
      commonDir,
      namespace: handoff.intent.source.namespace,
    });
    if (stableStringify(tree) !== stableStringify(handoff.source_retirement.final_source_tree)) {
      throw new CliError("Retired source namespace changed before clean-start consumption", 73);
    }
    await assertNoSymlinkComponents(commonDir, sourceRoot, "Retired refresh source namespace");
    await rm(sourceRoot, { recursive: true, force: false });
    await hooks.afterSourceNamespaceRemoval?.({ namespace: handoff.intent.source.namespace });
  }
  await rm(refreshRoot(commonDir), { recursive: true, force: false });
  return {
    status: "consumed-clean-start",
    handoff,
    mutation_performed: true,
    next_action: "begin a fresh run only when new work exists",
  };
}

export async function applyRefresh({
  commonDir,
  refreshId,
  expectedHandoffDigest,
  archiveEvidence,
  appliedAt,
  codexHome,
  privateArchiveObserver = null,
  hooks = {},
}) {
  const common = resolve(commonDir);
  return withProcessLock({
    path: repositoryLockPath(common),
    guardRoot: common,
    label: "Codex Flow repository refresh",
  }, async () => {
    const observePrivateArchive = privateArchiveObserver ?? (async ({ threadId }) => await observeCodexAppPrivateArchive({
      threadId,
      codexHome,
    }));
    let handoff = await readHandoff(common);
    if (handoff.refresh_id !== refreshId) throw new CliError("refresh_id does not match the pending handoff", 73);
    if (handoff.handoff_digest !== expectedHandoffDigest) {
      throw new CliError("Refresh handoff changed; inspect status and use its exact current digest", 73);
    }
    const timestamp = requireTimestamp(appliedAt, "applied_at");
    if (Date.parse(timestamp) < Date.parse(handoff.updated_at)) {
      throw new CliError("Refresh apply timestamp precedes the durable handoff state", 73);
    }
    if (handoff.state === "consumed") {
      if (handoff.target_consumption.mode !== "clean-start") {
        return { status: "consumed", handoff, mutation_performed: false };
      }
      await normalizeArchiveRequest({
        value: archiveEvidence,
        cleanup: handoff.cleanup,
        handoff,
        observePrivateArchive,
      });
      return finishCleanStartConsumption(common, handoff, timestamp, hooks);
    }
    if (handoff.state === "prepared") {
      await assertPreparedSourceUnchanged(common, handoff);
      const observations = await normalizeArchiveRequest({
        value: archiveEvidence,
        cleanup: handoff.cleanup,
        handoff,
        observePrivateArchive,
      });
      handoff = await writeTransition(common, handoff, {
        state: "archive-observed",
        cleanup: handoff.cleanup.map((entry) => ({
          ...entry,
          archive_evidence: observations.find((item) => item.archive_intent_id === entry.archive_intent_id),
        })),
      }, timestamp);
      await hooks.afterArchiveObserved?.(clone(handoff));
    } else {
      const observations = await normalizeArchiveRequest({
        value: archiveEvidence,
        cleanup: handoff.cleanup,
        handoff,
        observePrivateArchive,
      });
      for (const entry of handoff.cleanup) {
        if (stableStringify(entry.archive_evidence) !== stableStringify(
          observations.find((item) => item.archive_intent_id === entry.archive_intent_id),
        )) throw new CliError("Refresh archive evidence replay does not match the handoff", 73);
      }
    }
    if (handoff.state === "archive-observed") {
      for (let index = 0; index < handoff.cleanup.length; index += 1) {
        let item = handoff.cleanup[index];
        if (item.git_authority === null) continue;
        let presence = await refreshGitPresence(item.git_authority);
        if (item.worktree_removed_at === null) {
          if (presence.worktree_present) {
            await removeRefreshExecutorWorktree(item.git_authority);
            await hooks.afterWorktreeRemoval?.({ source_task_id: item.source_task_id });
          } else if (presence.branch_tip !== item.git_authority.head) {
            throw new CliError("Refresh worktree disappeared with branch drift", 73);
          }
          const cleanup = clone(handoff.cleanup);
          cleanup[index] = { ...item, worktree_removed_at: timestamp };
          handoff = await writeTransition(common, handoff, { cleanup }, timestamp);
          item = handoff.cleanup[index];
        }
        presence = await refreshGitPresence(item.git_authority);
        if (item.branch_deleted_at === null) {
          if (presence.branch_tip !== null) {
            await deleteRefreshExecutorBranch(item.git_authority);
            await hooks.afterBranchDeletion?.({ source_task_id: item.source_task_id });
          } else if (presence.worktree_present) {
            throw new CliError("Refresh branch disappeared while its worktree remains attached", 73);
          }
          const cleanup = clone(handoff.cleanup);
          cleanup[index] = { ...item, branch_deleted_at: timestamp };
          handoff = await writeTransition(common, handoff, { cleanup }, timestamp);
        }
      }
      let source = await loadRefreshSourceAuthority({
        commonDir: common,
        namespace: handoff.intent.source.namespace,
        runId: handoff.intent.source.run_id,
      });
      await assertRefreshNamespaceRemovalSafe({ source, handoff });
      if (source.run.status === "active") {
        await assertPreparedSourceUnchanged(common, handoff);
        await runSnapshotAbandon(source, handoff.intent, timestamp);
        await hooks.afterSourceRetirement?.({ source_run_id: source.run.run_id });
        source = await loadRefreshSourceAuthority({
          commonDir: common,
          namespace: handoff.intent.source.namespace,
          runId: handoff.intent.source.run_id,
        });
      }
      if (!["closed", "abandoned"].includes(source.run.status)) {
        throw new CliError("Refresh source did not reach a terminal run state", 73);
      }
      if (source.run.status === "abandoned") {
        const expectedReason = `Superseded by bounded refresh ${handoff.refresh_id}`;
        if (
          source.run.terminal.reason !== expectedReason
        ) throw new CliError("Refresh source has contradictory terminal evidence", 73);
      }
      const finalTree = await refreshNamespaceTreeDigest({
        commonDir: common,
        namespace: handoff.intent.source.namespace,
      });
      handoff = await writeTransition(common, handoff, {
        state: "source-retired",
        source_retirement: {
          retired_at: source.run.status === "abandoned"
            ? source.run.terminal.abandoned_at
            : timestamp,
          method: source.run.status === "abandoned" ? "snapshot-abandon" : "already-terminal",
          terminal_status: source.run.status,
          final_source_tree: finalTree,
        },
      }, timestamp);
    }
    if (handoff.state === "source-retired" && handoff.intent.replacements.length === 0) {
      return finishCleanStartConsumption(common, handoff, timestamp, hooks);
    }
    return {
      status: handoff.state,
      handoff,
      mutation_performed: true,
      next_action: handoff.state === "source-retired"
        ? `run activate --refresh-id ${handoff.refresh_id}`
        : "refresh apply",
    };
  });
}

export async function refreshStatus({ commonDir, refreshId = null }) {
  const handoff = await readHandoff(commonDir, { allowMissing: true });
  if (handoff === null) return { status: "absent", mutation_performed: false };
  if (refreshId !== null && handoff.refresh_id !== refreshId) {
    throw new CliError("refresh status ID does not match the pending handoff", 73);
  }
  const noReplacement = handoff.intent.replacements.length === 0;
  const next = {
    prepared: "archive exact discarded executor tasks, then refresh apply",
    "archive-observed": "resume refresh apply cleanup and source retirement",
    "source-retired": noReplacement
      ? "resume refresh apply to record clean-start consumption and remove residue"
      : `activate the target run with refresh_id ${handoff.refresh_id}`,
    consumed: handoff.target_consumption?.mode === "clean-start"
      ? "resume refresh apply to finish clean-start residue removal"
      : "resume exact target activation to finish residue removal",
  }[handoff.state];
  return {
    status: handoff.state,
    refresh_id: handoff.refresh_id,
    handoff_digest: handoff.handoff_digest,
    source: handoff.intent.source,
    target: handoff.intent.target,
    cleanup: handoff.cleanup,
    next_action: next,
    mutation_performed: false,
  };
}

function validateOrigin(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "refresh_id", "source_digest", "replacement_digest",
      "target_run_id", "target_runtime_id", "recorded_at", "origin_digest",
    ],
  }, "refresh origin");
  const seed = {
    schema_version: REFRESH_SCHEMA_VERSION,
    kind: REFRESH_ORIGIN_KIND,
    refresh_id: requireText(value.refresh_id, "origin.refresh_id", { max: 128, safeId: true }),
    source_digest: requireDigest(value.source_digest, "origin.source_digest"),
    replacement_digest: requireDigest(value.replacement_digest, "origin.replacement_digest"),
    target_run_id: requireText(value.target_run_id, "origin.target_run_id", { max: 128, safeId: true }),
    target_runtime_id: requireDigest(value.target_runtime_id, "origin.target_runtime_id"),
    recorded_at: requireTimestamp(value.recorded_at, "origin.recorded_at"),
  };
  const digest = sha256(stableStringify(seed));
  if (value.origin_digest !== digest) throw new CliError("refresh origin digest is invalid");
  return { ...seed, origin_digest: digest };
}

function buildOrigin(handoff, runId, runtimeId, recordedAt) {
  const seed = {
    schema_version: REFRESH_SCHEMA_VERSION,
    kind: REFRESH_ORIGIN_KIND,
    refresh_id: handoff.refresh_id,
    source_digest: handoff.intent.source.source_digest,
    replacement_digest: handoff.intent.replacement_digest,
    target_run_id: runId,
    target_runtime_id: runtimeId,
    recorded_at: recordedAt,
  };
  return validateOrigin({ ...seed, origin_digest: sha256(stableStringify(seed)) });
}

function assertOriginAuthority(origin, handoff, runId, runtimeId) {
  if (
    origin.refresh_id !== handoff.refresh_id
    || origin.source_digest !== handoff.intent.source.source_digest
    || origin.replacement_digest !== handoff.intent.replacement_digest
    || origin.target_run_id !== runId
    || origin.target_runtime_id !== runtimeId
    || Date.parse(origin.recorded_at) < Date.parse(handoff.source_retirement.retired_at)
  ) throw new CliError("Existing refresh origin does not match the exact target activation", 73);
  return origin;
}

export async function consumeRefreshActivation({
  commonDir,
  stateRoot,
  refreshId,
  runId,
  runtime,
  workflow,
  fences,
  activatedAt,
  prepare,
  readExisting,
  existingRun,
  admit,
  hooks = {},
}) {
  const common = resolve(commonDir);
  if (typeof prepare !== "function" || typeof readExisting !== "function" || typeof admit !== "function") {
    throw new CliError("Refresh activation requires exact target preparation and admission callbacks", 73);
  }
  return withProcessLock({
    path: repositoryLockPath(common),
    guardRoot: common,
    label: "Codex Flow repository refresh",
  }, async (repositoryLockToken) => {
    let handoff = await readHandoff(common, { allowMissing: true });
    const existingOriginRaw = await readJson(originPath(stateRoot, runId), {
      allowMissing: true,
      guardRoot: common,
    });
    const existingOrigin = existingOriginRaw === null ? null : validateOrigin(existingOriginRaw);
    const reuseExistingTarget = async () => {
      if (
        existingRun === null
        || existingRun === undefined
        || existingRun.status !== "active"
        || existingRun.run_id !== runId
        || existingRun.runtime_id !== runtime.runtime_id
        || existingRun.workflow_plan_id !== workflow.plan_id
        || existingRun.workflow_revision_digest !== workflow.revision_digest
        || stableStringify(existingRun.plan) !== stableStringify(fences)
      ) throw new CliError("Consumed refresh origin has no exact existing target run", 73);
      const prepared = await readExisting();
      if (
        stableStringify(prepared.acquired.context) !== stableStringify(runtime)
        || prepared.journal.journal.run_id !== runId
        || prepared.journal.journal.plan_id !== workflow.plan_id
        || prepared.journal.journal.current_revision_digest !== workflow.revision_digest
      ) throw new CliError("Consumed refresh target runtime or workflow evidence is incomplete", 73);
      return {
        admitted: { status: "existing", run: clone(existingRun) },
        prepared,
      };
    };
    if (handoff === null) {
      if (existingOrigin?.refresh_id !== refreshId) {
        throw new CliError("Refresh handoff is absent and no exact consumed origin exists", 73);
      }
      assertOriginAuthority(existingOrigin, {
        refresh_id: existingOrigin.refresh_id,
        intent: {
          source: { source_digest: existingOrigin.source_digest },
          replacement_digest: existingOrigin.replacement_digest,
        },
        source_retirement: { retired_at: existingOrigin.recorded_at },
      }, runId, runtime.runtime_id);
      const reused = await reuseExistingTarget();
      return { ...reused, origin: existingOrigin, refresh_status: "already-consumed" };
    }
    if (handoff.refresh_id !== refreshId) throw new CliError("run activation refresh_id does not match the handoff", 73);
    if (!["source-retired", "consumed"].includes(handoff.state)) {
      throw new CliError("Target activation requires a source-retired refresh handoff", 73);
    }
    if (
      handoff.intent.target.workflow_plan_id === null
      || handoff.intent.target.workflow_revision_digest === null
      || handoff.target_consumption?.mode === "clean-start"
    ) {
      throw new CliError("A no-replacement refresh is consumed with refresh apply, not run activation", 73);
    }
    const activationTimestamp = requireTimestamp(activatedAt, "activated_at");
    if (Date.parse(activationTimestamp) < Date.parse(handoff.source_retirement.retired_at)) {
      throw new CliError("Target activation timestamp precedes source retirement", 73);
    }
    if (
      handoff.intent.target.package_version !== PACKAGE_VERSION
      || handoff.intent.target.bundle_sha256 !== runtime.bundle.bundle_sha256
      || handoff.intent.target.workflow_plan_id !== workflow.plan_id
      || handoff.intent.target.workflow_revision_digest !== workflow.revision_digest
      || handoff.intent.target.fences_digest !== sha256(stableStringify(fences))
      || handoff.intent.target.coordinator_thread_id !== runtime.lineage.thread_id
      || runtime.lineage.generation !== 1
      || runtime.lineage.lineage_id === handoff.intent.source.coordinator.lineage_id
      || runId === handoff.intent.source.run_id
    ) throw new CliError("Target activation does not match the exact refresh authority", 73);
    if (existingOrigin !== null) {
      assertOriginAuthority(existingOrigin, handoff, runId, runtime.runtime_id);
    }
    const baseline = snapshotBaseline(runtime.repository.root);
    if (
      baseline.common_dir !== common
      || baseline.root !== handoff.intent.target.baseline.root
      || baseline.revision !== handoff.intent.target.baseline.revision
      || baseline.branch !== handoff.intent.target.baseline.branch
      || baseline.cleanliness !== "clean"
    ) throw new CliError("Target activation baseline drifted after refresh preparation", 73);
    const sourceRoot = resolve(common, "codex-flow", handoff.intent.source.namespace);
    const sourceExists = await lstat(sourceRoot).then(() => true).catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
    if (sourceExists) {
      const source = await loadRefreshSourceAuthority({
        commonDir: common,
        namespace: handoff.intent.source.namespace,
        runId: handoff.intent.source.run_id,
      });
      await assertRefreshNamespaceRemovalSafe({ source, handoff });
      const tree = await refreshNamespaceTreeDigest({
        commonDir: common,
        namespace: handoff.intent.source.namespace,
      });
      if (stableStringify(tree) !== stableStringify(handoff.source_retirement.final_source_tree)) {
        throw new CliError("Retired source namespace changed before target activation", 73);
      }
    } else if (handoff.state !== "consumed" || existingOrigin === null) {
      throw new CliError("Retired source namespace disappeared before durable target consumption", 73);
    }
    const reused = existingOrigin === null ? null : await reuseExistingTarget();
    const prepared = reused?.prepared ?? await prepare();
    const admitted = reused?.admitted ?? await admit(repositoryLockToken);
    if (reused === null) await hooks.afterTargetAdmission?.({ run_id: runId });
    const origin = existingOrigin ?? buildOrigin(
      handoff,
      runId,
      runtime.runtime_id,
      activationTimestamp,
    );
    if (existingOrigin === null) {
      await ensureExactJson(originPath(stateRoot, runId), origin, { guardRoot: common, mode: 0o600 });
      await hooks.afterOriginWrite?.(clone(origin));
    }
    if (handoff.state !== "consumed") {
      handoff = await writeTransition(common, handoff, {
        state: "consumed",
        target_consumption: {
          mode: "run-activation",
          target_run_id: runId,
          target_runtime_id: runtime.runtime_id,
          origin_digest: origin.origin_digest,
          consumed_at: origin.recorded_at,
        },
      }, origin.recorded_at);
      await hooks.afterConsumedWrite?.(clone(handoff));
    } else if (
      handoff.target_consumption.mode !== "run-activation"
      || handoff.target_consumption.target_run_id !== runId
      || handoff.target_consumption.target_runtime_id !== runtime.runtime_id
      || handoff.target_consumption.origin_digest !== origin.origin_digest
    ) throw new CliError("Consumed refresh handoff belongs to a different target run", 73);
    if (sourceExists) {
      await assertNoSymlinkComponents(common, sourceRoot, "Retired refresh source namespace");
      await rm(sourceRoot, { recursive: true, force: false });
      await hooks.afterSourceNamespaceRemoval?.({ namespace: handoff.intent.source.namespace });
    }
    await rm(refreshRoot(common), { recursive: true, force: false });
    return { admitted, prepared, origin, refresh_status: "consumed" };
  });
}
