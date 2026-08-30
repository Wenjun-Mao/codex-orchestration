import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  ensureExactJson,
  readJson,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import {
  discoverGit,
  gitCommonDirectoryForState,
  gitSnapshot,
} from "./git.mjs";
import { validateArchiveOperation } from "./archive-lifecycle.mjs";
import { validateCallbackRecordV06 } from "./callbacks-v06.mjs";
import { cleanupPlanV06 } from "./cleanup-v06.mjs";
import { validateDispositionRecord } from "./dispositions.mjs";
import {
  integrationRecordDigest,
  validateIntegrationRecordV06,
} from "./integration-v06.mjs";
import { validateReleaseRecord } from "./release-lifecycle.mjs";
import { recipientPaths, validateRecipientRegistry } from "./recipients.mjs";
import {
  closeRun,
  readRun,
  withActiveRunMutation,
} from "./run-lifecycle.mjs";
import {
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
  v06RuntimeRoot,
} from "./runtime-context.mjs";
import { validateSubagentOperation } from "./subagent-operations-v06.mjs";
import { validateVisibleTaskCreationRecord } from "./task-creation-v06.mjs";
import { validateUrgentSignalRecordV06 } from "./urgent-signals-v06.mjs";
import {
  validateGeneratedTaskContract,
  validateWorkflowPlanRevision,
} from "./workflow-plan.mjs";
import {
  validateWorkflowJournal,
  workflowJournalStatus,
} from "./workflow-journal-v06.mjs";
import {
  validateVerificationRecordV06,
  verificationRecordDigest,
} from "./verifications-v06.mjs";

export const RUN_CLOSURE_AUDIT_SCHEMA_VERSION = 1;
export const RUN_CLOSURE_AUDIT_KIND = "codex-flow-v06-run-closure-audit";

const AUDIT_ID = /^run-closure-audit-v1-[0-9a-f]{64}$/;
const VERIFICATION_ID = /^verification-v1-[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SAFE_INTEGRATION_OUTCOMES = new Set(["ancestor", "patch-equivalent"]);

const SOURCE_KINDS = [
  "run-activation",
  "runtime-context",
  "workflow-journal",
  "workflow-revision",
  "generated-task-contract",
  "visible-task-creation",
  "subagent-operation",
  "release",
  "callback",
  "disposition",
  "integration",
  "verification",
  "archive",
  "urgent-signal",
  "recipient-binding",
];

const BLOCKER_CODES = [
  "workflow-journal-missing",
  "workflow-task-unclaimed",
  "current-unstarted-claim",
  "native-operation-missing",
  "visible-creation-in-flight",
  "visible-creation-ambiguous",
  "visible-creation-session-blocked",
  "subagent-incomplete",
  "release-missing",
  "release-unaccepted",
  "callback-missing",
  "callback-unconsumed",
  "disposition-missing",
  "disposition-unfinalized",
  "integration-missing",
  "integration-unreconciled",
  "integration-unsafe",
  "verification-missing",
  "verification-not-pass",
  "archive-missing",
  "archive-incomplete",
  "retained-visible-task",
  "cleanup-unresolved",
  "urgent-unresolved",
  "recipient-binding-drift",
  "worktree-retained",
  "repository-dirty",
  "repository-drift",
  "orphaned-authority",
  "conflicting-authority",
];

const AUTHORITY_KINDS = [
  "run",
  "workflow",
  "claim",
  "visible-task-creation",
  "subagent-operation",
  "release",
  "callback",
  "disposition",
  "integration",
  "verification",
  "archive",
  "cleanup-plan",
  "urgent-signal",
  "recipient-binding",
];

const COUNT_KEYS = [
  "workflow_tasks",
  "workflow_claims",
  "visible_task_creations",
  "subagent_operations",
  "releases",
  "callbacks",
  "dispositions",
  "integrations",
  "verifications",
  "archives",
  "urgent_signals",
  "recipient_bindings",
];

const CANONICAL_KEYS = [
  "run_id",
  "runtime_context_digest",
  "configuration_digest",
  "repository_id",
  "common_dir",
  "coordinator_binding",
  "plan_id",
  "revision_digest",
  "task_id",
  "task_digest",
  "contract_id",
];

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function commit(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a full Git commit`);
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
  const value = typeof now === "function" ? now() : now;
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(milliseconds)) throw new CliError("Run-closure audit clock must be finite");
  return new Date(milliseconds).toISOString();
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new CliError(`${label} must be a boolean`);
  return value;
}

function absolutePath(value, label) {
  const path = requireText(value, label, { max: 4096 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new CliError(`${label} is invalid`);
  return value;
}

function nullableSafeId(value, label) {
  return value === null ? null : requireText(value, label, { max: 256, safeId: true });
}

function validateAuthority(value) {
  requireExactFields(value, {
    required: [
      "run_id", "common_dir", "state_root", "runtime_id",
      "runtime_context_digest", "bundle_digest", "configuration_digest",
      "policy_digest", "repository_id", "repository_digest", "workflow_plan_id",
      "activated_revision_digest", "current_revision_digest",
      "workflow_journal_digest", "run_binding_generation",
      "run_binding_digest", "run_activation_digest",
    ],
  }, "Run-closure audit authority");
  return {
    run_id: requireText(value.run_id, "authority.run_id", { max: 128, safeId: true }),
    common_dir: absolutePath(value.common_dir, "authority.common_dir"),
    state_root: absolutePath(value.state_root, "authority.state_root"),
    runtime_id: digest(value.runtime_id, "authority.runtime_id"),
    runtime_context_digest: digest(
      value.runtime_context_digest,
      "authority.runtime_context_digest",
    ),
    bundle_digest: digest(value.bundle_digest, "authority.bundle_digest"),
    configuration_digest: digest(
      value.configuration_digest,
      "authority.configuration_digest",
    ),
    policy_digest: digest(value.policy_digest, "authority.policy_digest"),
    repository_id: requireText(value.repository_id, "authority.repository_id", {
      max: 128,
      safeId: true,
    }),
    repository_digest: digest(value.repository_digest, "authority.repository_digest"),
    workflow_plan_id: requireText(value.workflow_plan_id, "authority.workflow_plan_id", {
      max: 128,
      safeId: true,
    }),
    activated_revision_digest: digest(
      value.activated_revision_digest,
      "authority.activated_revision_digest",
    ),
    current_revision_digest: digest(
      value.current_revision_digest,
      "authority.current_revision_digest",
    ),
    workflow_journal_digest: digest(
      value.workflow_journal_digest,
      "authority.workflow_journal_digest",
    ),
    run_binding_generation: requireInteger(
      value.run_binding_generation,
      "authority.run_binding_generation",
      { min: 1, max: 2147483647 },
    ),
    run_binding_digest: digest(value.run_binding_digest, "authority.run_binding_digest"),
    run_activation_digest: digest(
      value.run_activation_digest,
      "authority.run_activation_digest",
    ),
  };
}

function nullableText(value, label, { max = 4096 } = {}) {
  return value === null ? null : requireText(value, label, { max });
}

function validateRepositoryEvidence(value) {
  requireExactFields(value, {
    required: [
      "root", "common_dir", "head_revision", "branch", "cleanliness",
      "expected_source", "expected_verification_id", "expected_root",
      "expected_common_dir", "expected_head_revision", "expected_branch",
    ],
  }, "Run-closure audit repository evidence");
  const cleanliness = oneOf(
    value.cleanliness,
    ["clean", "dirty"],
    "repository.cleanliness",
  );
  const expectedSource = oneOf(
    value.expected_source,
    ["activation-baseline", "combined-verification"],
    "repository.expected_source",
  );
  const expectedVerificationId = nullableText(
    value.expected_verification_id,
    "repository.expected_verification_id",
    { max: 128 },
  );
  if (expectedVerificationId !== null && !VERIFICATION_ID.test(expectedVerificationId)) {
    throw new CliError("repository.expected_verification_id must be a v1 verification ID");
  }
  if ((expectedSource === "combined-verification") !== (expectedVerificationId !== null)) {
    throw new CliError("Repository evidence verification authority is inconsistent");
  }
  return {
    root: absolutePath(value.root, "repository.root"),
    common_dir: absolutePath(value.common_dir, "repository.common_dir"),
    head_revision: commit(value.head_revision, "repository.head_revision"),
    branch: nullableText(value.branch, "repository.branch", { max: 256 }),
    cleanliness,
    expected_source: expectedSource,
    expected_verification_id: expectedVerificationId,
    expected_root: absolutePath(value.expected_root, "repository.expected_root"),
    expected_common_dir: absolutePath(
      value.expected_common_dir,
      "repository.expected_common_dir",
    ),
    expected_head_revision: commit(
      value.expected_head_revision,
      "repository.expected_head_revision",
    ),
    expected_branch: nullableText(value.expected_branch, "repository.expected_branch", {
      max: 256,
    }),
  };
}

function validateSourceRecord(value, index) {
  const label = `source_records[${index}]`;
  requireExactFields(value, {
    required: ["record_kind", "record_id", "source_locator", "record_digest"],
  }, label);
  return {
    record_kind: oneOf(value.record_kind, SOURCE_KINDS, `${label}.record_kind`),
    record_id: requireText(value.record_id, `${label}.record_id`, { max: 256 }),
    source_locator: requireText(value.source_locator, `${label}.source_locator`, { max: 4096 }),
    record_digest: digest(value.record_digest, `${label}.record_digest`),
  };
}

function sourceSort(left, right) {
  return `${left.record_kind}:${left.record_id}:${left.source_locator}`.localeCompare(
    `${right.record_kind}:${right.record_id}:${right.source_locator}`,
  );
}

function validateBlocker(value, index) {
  const label = `blockers[${index}]`;
  requireExactFields(value, {
    required: ["code", "authority_kind", "authority_id", "task_id", "detail"],
  }, label);
  return {
    code: oneOf(value.code, BLOCKER_CODES, `${label}.code`),
    authority_kind: oneOf(value.authority_kind, AUTHORITY_KINDS, `${label}.authority_kind`),
    authority_id: requireText(value.authority_id, `${label}.authority_id`, { max: 256 }),
    task_id: nullableSafeId(value.task_id, `${label}.task_id`),
    detail: requireText(value.detail, `${label}.detail`, { max: 512 }),
  };
}

function blockerSort(left, right) {
  return `${left.code}:${left.authority_kind}:${left.authority_id}:${left.task_id ?? ""}:${left.detail}`
    .localeCompare(
      `${right.code}:${right.authority_kind}:${right.authority_id}:${right.task_id ?? ""}:${right.detail}`,
    );
}

function validateCounts(value) {
  requireExactFields(value, { required: COUNT_KEYS }, "Run-closure audit counts");
  return Object.fromEntries(COUNT_KEYS.map((key) => [
    key,
    requireInteger(value[key], `counts.${key}`, { min: 0, max: 1000000 }),
  ]));
}

function validateCleanupEvidence(value) {
  requireExactFields(value, {
    required: ["plan_id", "mutation_performed", "counts"],
  }, "Run-closure cleanup evidence");
  const planId = requireText(value.plan_id, "cleanup.plan_id", { max: 128, safeId: true });
  if (!/^cleanup-plan-v1-[0-9a-f]{64}$/.test(planId)) {
    throw new CliError("cleanup.plan_id must be a v1 cleanup plan ID");
  }
  if (value.mutation_performed !== false) {
    throw new CliError("Run-closure cleanup evidence must be read-only");
  }
  requireExactFields(value.counts, {
    required: [
      "host_worktree_tasks", "cleanup_required", "cleanup_candidates", "close_blocked",
    ],
  }, "cleanup.counts");
  return {
    plan_id: planId,
    mutation_performed: false,
    counts: Object.fromEntries([
      "host_worktree_tasks", "cleanup_required", "cleanup_candidates", "close_blocked",
    ].map((key) => [
      key,
      requireInteger(value.counts[key], `cleanup.counts.${key}`, { min: 0, max: 1000000 }),
    ])),
  };
}

function evidenceMaterial(value) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    authority: value.authority,
    repository: value.repository,
    cleanup: value.cleanup,
    source_records: value.source_records,
    blockers: value.blockers,
    counts: value.counts,
    terminal_ready: value.terminal_ready,
  };
}

function recordMaterial(value) {
  const { record_digest: ignored, ...material } = value;
  return material;
}

export function validateRunClosureAudit(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "audit_id", "evidence_digest", "authority",
      "repository", "cleanup", "source_records", "blockers", "counts", "terminal_ready", "audited_at",
      "record_digest",
    ],
  }, "Run-closure audit");
  if (
    value.schema_version !== RUN_CLOSURE_AUDIT_SCHEMA_VERSION
    || value.kind !== RUN_CLOSURE_AUDIT_KIND
  ) throw new CliError("Invalid v0.6 run-closure audit schema");
  const auditId = requireText(value.audit_id, "audit_id", { max: 128, safeId: true });
  if (!AUDIT_ID.test(auditId)) throw new CliError("audit_id must be a v1 run-closure audit ID");
  if (!Array.isArray(value.source_records) || value.source_records.length > 100000) {
    throw new CliError("source_records must contain at most 100000 records");
  }
  if (!Array.isArray(value.blockers) || value.blockers.length > 100000) {
    throw new CliError("blockers must contain at most 100000 records");
  }
  const sourceRecords = value.source_records.map(validateSourceRecord).sort(sourceSort);
  if (new Set(sourceRecords.map((entry) => entry.source_locator)).size !== sourceRecords.length) {
    throw new CliError("Run-closure audit source locators must be unique");
  }
  const blockers = value.blockers.map(validateBlocker).sort(blockerSort);
  const blockerKeys = blockers.map((entry) => stableStringify(entry));
  if (new Set(blockerKeys).size !== blockerKeys.length) {
    throw new CliError("Run-closure audit blockers must be unique");
  }
  const audit = {
    schema_version: RUN_CLOSURE_AUDIT_SCHEMA_VERSION,
    kind: RUN_CLOSURE_AUDIT_KIND,
    audit_id: auditId,
    evidence_digest: digest(value.evidence_digest, "evidence_digest"),
    authority: validateAuthority(value.authority),
    repository: validateRepositoryEvidence(value.repository),
    cleanup: validateCleanupEvidence(value.cleanup),
    source_records: sourceRecords,
    blockers,
    counts: validateCounts(value.counts),
    terminal_ready: boolean(value.terminal_ready, "terminal_ready"),
    audited_at: timestamp(value.audited_at, "audited_at"),
    record_digest: digest(value.record_digest, "record_digest"),
  };
  if (audit.authority.repository_id !== audit.authority.repository_digest) {
    throw new CliError("Run-closure audit repository ID must match runtime repository authority");
  }
  if (
    audit.repository.common_dir !== audit.authority.common_dir
    || audit.repository.expected_common_dir !== audit.authority.common_dir
  ) {
    throw new CliError("Run-closure audit repository evidence changed Git-common authority");
  }
  if (audit.terminal_ready !== (audit.blockers.length === 0)) {
    throw new CliError("terminal_ready must exactly reflect whether blockers are empty");
  }
  const expectedEvidenceDigest = sha256(stableStringify(evidenceMaterial(audit)));
  if (
    audit.evidence_digest !== expectedEvidenceDigest
    || audit.audit_id !== `run-closure-audit-v1-${expectedEvidenceDigest}`
  ) throw new CliError("Run-closure audit evidence identity is invalid");
  if (audit.record_digest !== sha256(stableStringify(recordMaterial(audit)))) {
    throw new CliError("Run-closure audit record digest is invalid");
  }
  return audit;
}

function safeChild(directory, filename, label) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label} path`);
  }
  return path;
}

function auditId(value) {
  const id = requireText(value, "auditId", { max: 128, safeId: true });
  if (!AUDIT_ID.test(id)) throw new CliError("auditId must be a v1 run-closure audit ID");
  return id;
}

function auditPaths(stateRoot, { runId = null, id = null } = {}) {
  const root = resolve(stateRoot, "run-closure-audits");
  return {
    record: id === null
      ? null
      : safeChild(resolve(root, "records"), `${auditId(id)}.json`, "run-closure audit record"),
    lock: runId === null
      ? null
      : safeChild(
        resolve(root, "locks"),
        `${requireText(runId, "runId", { max: 128, safeId: true })}.lock.json`,
        "run-closure audit lock",
      ),
  };
}

async function resolveRoots({ gitCommonDirectory = null, stateRoot = null }) {
  if (gitCommonDirectory === null && stateRoot === null) {
    throw new CliError("Run-closure audit requires gitCommonDirectory or stateRoot");
  }
  if (gitCommonDirectory !== null && !isAbsolute(gitCommonDirectory)) {
    throw new CliError("gitCommonDirectory must be an absolute path");
  }
  if (stateRoot !== null && !isAbsolute(stateRoot)) {
    throw new CliError("stateRoot must be an absolute path");
  }
  const requestedStateRoot = stateRoot === null ? null : resolve(stateRoot);
  const commonCandidate = gitCommonDirectory === null
    ? gitCommonDirectoryForState(requestedStateRoot)
    : resolve(gitCommonDirectory);
  const commonDir = await realpath(commonCandidate).catch(() => null);
  if (commonDir === null) throw new CliError("Run-closure audit Git common directory does not exist");
  const expectedStateRoot = v06RuntimeRoot(commonDir);
  if (requestedStateRoot !== null && requestedStateRoot !== expectedStateRoot) {
    throw new CliError("stateRoot is not the exact v0.6 Git-common runtime namespace");
  }
  if (
    gitCommonDirectory !== null
    && requestedStateRoot !== null
    && gitCommonDirectoryForState(requestedStateRoot) !== resolve(gitCommonDirectory)
  ) throw new CliError("gitCommonDirectory and stateRoot identify different authority roots");
  await assertNoSymlinkComponents(commonDir, expectedStateRoot, "Run-closure audit state root");
  return { commonDir, stateRoot: expectedStateRoot };
}

function relativeLocator(stateRoot, path) {
  const location = relative(stateRoot, path);
  if (location === "" || location === ".." || location.startsWith(`..${sep}`)) {
    throw new CliError("Run-closure audit source escapes the v0.6 state root");
  }
  return location.split(sep).join("/");
}

function sourceEntry(stateRoot, recordKind, recordId, path, record, fragment = null) {
  const locator = `${relativeLocator(stateRoot, path)}${fragment === null ? "" : `#${fragment}`}`;
  return {
    record_kind: recordKind,
    record_id: String(recordId),
    source_locator: locator,
    record_digest: sha256(stableStringify(record)),
  };
}

async function directoryEntries(commonDir, directory, label) {
  await assertNoSymlinkComponents(commonDir, directory, label);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new CliError(`${label} contains a symbolic link: ${entry.name}`);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function scanJsonRecords({
  commonDir,
  stateRoot,
  directory,
  recordKind,
  runId,
  selectRunId,
  validate,
  selectId,
}) {
  const records = [];
  const sources = [];
  for (const entry of await directoryEntries(commonDir, directory, `${recordKind} records`)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new CliError(`${recordKind} records contain an unsupported entry: ${entry.name}`);
    }
    const path = safeChild(directory, entry.name, `${recordKind} record`);
    const raw = await readJson(path, { guardRoot: commonDir });
    if (selectRunId(raw) !== runId) continue;
    const record = validate(raw);
    const id = selectId(record);
    if (entry.name !== `${id}.json`) {
      throw new CliError(`${recordKind} filename does not match its content identity`);
    }
    records.push(record);
    sources.push(sourceEntry(stateRoot, recordKind, id, path, record));
  }
  return { records, sources };
}

function groupBy(records, selectKey) {
  const grouped = new Map();
  for (const record of records) {
    const key = selectKey(record);
    const values = grouped.get(key) ?? [];
    values.push(record);
    grouped.set(key, values);
  }
  return grouped;
}

function canonicalFromClaim(claim) {
  return Object.fromEntries(CANONICAL_KEYS.map((key) => [key, claim[key]]));
}

function canonicalFromRecord(record) {
  return {
    run_id: record.run_id,
    runtime_context_digest: record.runtime_context_digest,
    configuration_digest: record.configuration_digest,
    repository_id: record.repository_id,
    common_dir: record.common_dir,
    coordinator_binding: record.coordinator_binding,
    plan_id: record.plan_id,
    revision_digest: record.revision_digest,
    task_id: record.task_id,
    task_digest: record.task_digest,
    contract_id: record.contract_id,
  };
}

function canonicalFromReceipt(receipt) {
  return {
    ...Object.fromEntries(CANONICAL_KEYS.filter((key) => key !== "coordinator_binding")
      .map((key) => [key, receipt[key]])),
    coordinator_binding: receipt.recipient,
  };
}

function assertCanonicalMatch(actual, claim, label) {
  if (stableStringify(actual) !== stableStringify(canonicalFromClaim(claim))) {
    throw new CliError(`${label} does not match its persisted workflow contract claim`, 73);
  }
}

function addBlocker(blockers, input) {
  const blocker = validateBlocker(input, 0);
  blockers.set(stableStringify(blocker), blocker);
}

function only(records, blockers, {
  code = "conflicting-authority",
  authorityKind,
  authorityId,
  taskId,
  detail,
}) {
  if (records.length <= 1) return records[0] ?? null;
  addBlocker(blockers, {
    code,
    authority_kind: authorityKind,
    authority_id: authorityId,
    task_id: taskId,
    detail,
  });
  return records[0];
}

function exactRunAuthority(run, context, commonDir) {
  const binding = runtimeBindingFromContext(context);
  if (
    runtimeContextHash(context) !== run.runtime_context_hash
    || binding.runtime_context_hash !== run.binding.runtime_context_hash
    || binding.bundle_hash !== run.binding.bundle_hash
    || binding.config_hash !== run.binding.config_hash
    || binding.policy_hash !== run.binding.policy_hash
    || binding.repository_hash !== run.binding.repository_hash
    || context.repository.common_dir !== commonDir
  ) throw new CliError("Active run no longer matches its immutable runtime authority", 73);
  return binding;
}

function lifecycleCoordinatorBindings(run) {
  const bindings = [run.binding, ...run.rebind_history.flatMap((entry) => [entry.from, entry.to])];
  return new Set(bindings.map((binding) => stableStringify(binding.lineage)));
}

function assertClaimRunAuthority(claim, run, commonDir, coordinatorBindings) {
  const coordinator = {
    lineage_id: claim.coordinator_binding.lineage_id,
    thread_id: claim.coordinator_binding.thread_id,
    generation: claim.coordinator_binding.generation,
  };
  if (
    claim.runtime_context_digest !== run.runtime_context_hash
    || claim.configuration_digest !== run.binding.config_hash
    || claim.repository_id !== run.binding.repository_hash
    || claim.common_dir !== commonDir
    || claim.plan_id !== run.workflow_plan_id
    || !coordinatorBindings.has(stableStringify(coordinator))
  ) throw new CliError("Workflow contract claim does not match active run authority", 73);
}

function normalizedBranch(value) {
  return value === "detached" ? null : value;
}

function verificationOrder(left, right) {
  const completed = Date.parse(left.completed_at) - Date.parse(right.completed_at);
  return completed || left.verification_id.localeCompare(right.verification_id);
}

async function deriveRepositoryEvidence({ context, commonDir, authoritativePassVerifications }) {
  const discovered = discoverGit(context.repository.root);
  const root = await realpath(discovered.root).catch(() => null);
  const liveCommonDir = await realpath(discovered.commonDir).catch(() => null);
  if (root === null || liveCommonDir === null) {
    throw new CliError("Active run repository authority cannot be resolved", 73);
  }
  if (liveCommonDir !== commonDir) {
    throw new CliError("Active run repository moved outside its Git-common authority", 73);
  }
  const snapshot = gitSnapshot(root);
  const finalVerification = [...authoritativePassVerifications.values()]
    .sort(verificationOrder)
    .at(-1) ?? null;
  const expected = finalVerification === null
    ? {
      source: "activation-baseline",
      verificationId: null,
      root: context.repository.root,
      commonDir: context.repository.common_dir,
      revision: context.repository.revision,
      branch: normalizedBranch(context.repository.branch),
    }
    : {
      source: "combined-verification",
      verificationId: finalVerification.verification_id,
      root: finalVerification.repository.root,
      commonDir: finalVerification.repository.common_dir,
      revision: finalVerification.repository.completed_revision,
      branch: finalVerification.repository.completed_branch,
    };
  expected.root = await realpath(expected.root).catch(() => expected.root);
  expected.commonDir = await realpath(expected.commonDir).catch(() => expected.commonDir);
  return validateRepositoryEvidence({
    root,
    common_dir: liveCommonDir,
    head_revision: snapshot.revision,
    branch: normalizedBranch(snapshot.branch),
    cleanliness: snapshot.cleanliness,
    expected_source: expected.source,
    expected_verification_id: expected.verificationId,
    expected_root: expected.root,
    expected_common_dir: expected.commonDir,
    expected_head_revision: expected.revision,
    expected_branch: expected.branch,
  });
}

function inspectLiveRepository(repository, blockers, runId) {
  if (repository.cleanliness !== "clean") {
    addBlocker(blockers, {
      code: "repository-dirty",
      authority_kind: "run",
      authority_id: runId,
      task_id: null,
      detail: "The live coordinator repository is dirty after terminal proof.",
    });
  }
  if (
    repository.root !== repository.expected_root
    || repository.common_dir !== repository.expected_common_dir
    || repository.head_revision !== repository.expected_head_revision
    || repository.branch !== repository.expected_branch
  ) {
    addBlocker(blockers, {
      code: "repository-drift",
      authority_kind: "run",
      authority_id: runId,
      task_id: null,
      detail: `The live coordinator Git state drifted from ${repository.expected_source}.`,
    });
  }
}

function releaseStatus(record) {
  if (record.acceptance !== null) return "accepted";
  return record.delivery?.outcome ?? "prepared";
}

function verificationMatchesDisposition(verification, disposition) {
  const expected = {
    callback_id: disposition.callback_id,
    receipt_digest: disposition.receipt_digest,
    recipient_binding_digest: disposition.coordinator_binding.binding_digest,
    executor_thread_id: disposition.executor_thread_id,
    run_id: disposition.run_id,
    runtime_context_digest: disposition.runtime_context_digest,
    configuration_digest: disposition.configuration_digest,
    repository_id: disposition.repository_id,
    common_dir: disposition.common_dir,
    plan_id: disposition.plan_id,
    revision_digest: disposition.revision_digest,
    task_id: disposition.task_id,
    task_digest: disposition.task_digest,
    contract_id: disposition.contract_id,
    operation_id: disposition.operation_id,
    release_id: disposition.release_id,
  };
  return Object.entries(expected).every(([key, value]) => (
    stableStringify(verification.identity[key]) === stableStringify(value)
  ));
}

async function deriveClosureEvidence({ commonDir, stateRoot, runId }) {
  const blockers = new Map();
  const sourceRecords = [];
  const { run, path: lifecyclePath } = await readRun({ gitCommonDirectory: commonDir, runId });
  if (run.status !== "active") throw new CliError(`v0.6 run is not active: ${runId}`);
  sourceRecords.push(sourceEntry(
    stateRoot,
    "run-activation",
    run.run_id,
    lifecyclePath,
    run,
    run.run_id,
  ));
  const runtime = await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: run.runtime_id,
  });
  const runtimeBinding = exactRunAuthority(run, runtime.context, commonDir);
  sourceRecords.push(sourceEntry(
    stateRoot,
    "runtime-context",
    runtime.context.runtime_id,
    runtime.path,
    runtime.context,
  ));
  const recipientPath = recipientPaths(
    stateRoot,
    run.binding.lineage.lineage_id,
  ).registry;
  const rawRecipient = await readJson(recipientPath, {
    allowMissing: true,
    guardRoot: commonDir,
  });
  let recipientBindingCount = 0;
  if (rawRecipient === null) {
    addBlocker(blockers, {
      code: "recipient-binding-drift",
      authority_kind: "recipient-binding",
      authority_id: run.binding.lineage.lineage_id,
      task_id: null,
      detail: "The active coordinator has no persisted recipient binding.",
    });
  } else {
    const registry = validateRecipientRegistry(rawRecipient);
    recipientBindingCount = 1;
    sourceRecords.push(sourceEntry(
      stateRoot,
      "recipient-binding",
      registry.lineage_id,
      recipientPath,
      registry,
    ));
    if (
      registry.lineage_id !== run.binding.lineage.lineage_id
      || registry.current.thread_id !== run.binding.lineage.thread_id
      || registry.current.generation !== run.binding.lineage.generation
      || registry.current.fence_token !== run.binding.fence_token
    ) {
      addBlocker(blockers, {
        code: "recipient-binding-drift",
        authority_kind: "recipient-binding",
        authority_id: registry.lineage_id,
        task_id: null,
        detail: "The coordinator recipient registry does not match the active run binding fence.",
      });
    }
  }

  const workflowRoot = resolve(stateRoot, "workflows", run.run_id, run.workflow_plan_id);
  const workflowJournalPath = resolve(workflowRoot, "journal.json");
  const rawWorkflowJournal = await readJson(workflowJournalPath, {
    allowMissing: true,
    guardRoot: commonDir,
  });
  let workflow = null;
  let currentRevision = null;
  let claimEntries = [];
  for (const entry of await directoryEntries(
    commonDir,
    resolve(stateRoot, "workflows", run.run_id),
    "Run workflow journals",
  )) {
    if (!entry.isDirectory()) {
      throw new CliError(`Run workflow journals contain an unsupported entry: ${entry.name}`);
    }
    if (entry.name !== run.workflow_plan_id) {
      addBlocker(blockers, {
        code: "orphaned-authority",
        authority_kind: "workflow",
        authority_id: entry.name,
        task_id: null,
        detail: "The run contains a workflow journal outside its activated plan identity.",
      });
    }
  }
  if (rawWorkflowJournal === null) {
    addBlocker(blockers, {
      code: "workflow-journal-missing",
      authority_kind: "workflow",
      authority_id: run.workflow_plan_id,
      task_id: null,
      detail: "The active run has no persisted workflow journal.",
    });
  } else {
    const journal = validateWorkflowJournal(rawWorkflowJournal);
    if (journal.run_id !== run.run_id || journal.plan_id !== run.workflow_plan_id) {
      throw new CliError("Workflow journal path does not match active run identity", 73);
    }
    if (!journal.revisions.some((entry) => entry.revision_digest === run.workflow_revision_digest)) {
      throw new CliError("Active run revision is not admitted by its workflow journal", 73);
    }
    sourceRecords.push(sourceEntry(
      stateRoot,
      "workflow-journal",
      journal.journal_digest,
      workflowJournalPath,
      journal,
    ));
    const expectedRevisionFiles = new Set();
    for (const entry of journal.revisions) {
      const path = resolve(workflowRoot, "revisions", `${entry.revision_digest}.json`);
      const revision = validateWorkflowPlanRevision(await readJson(path, { guardRoot: commonDir }));
      if (
        revision.plan_id !== journal.plan_id
        || revision.revision !== entry.revision
        || revision.revision_digest !== entry.revision_digest
      ) throw new CliError("Workflow revision does not match its journal entry", 73);
      expectedRevisionFiles.add(`${entry.revision_digest}.json`);
      sourceRecords.push(sourceEntry(
        stateRoot,
        "workflow-revision",
        revision.revision_digest,
        path,
        revision,
      ));
    }
    for (const entry of await directoryEntries(
      commonDir,
      resolve(workflowRoot, "revisions"),
      "Workflow revisions",
    )) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new CliError(`Workflow revisions contain an unsupported entry: ${entry.name}`);
      }
      if (!expectedRevisionFiles.has(entry.name)) {
        const path = safeChild(
          resolve(workflowRoot, "revisions"),
          entry.name,
          "workflow revision",
        );
        const revision = validateWorkflowPlanRevision(await readJson(path, { guardRoot: commonDir }));
        sourceRecords.push(sourceEntry(
          stateRoot,
          "workflow-revision",
          revision.revision_digest,
          path,
          revision,
        ));
        addBlocker(blockers, {
          code: "orphaned-authority",
          authority_kind: "workflow",
          authority_id: entry.name,
          task_id: null,
          detail: "A workflow revision exists outside the admitted revision chain.",
        });
      }
    }
    const expectedContractFiles = new Set();
    for (const claim of journal.contract_claims) {
      const path = resolve(workflowRoot, "contracts", `${claim.contract_id}.json`);
      const contract = validateGeneratedTaskContract(await readJson(path, { guardRoot: commonDir }));
      if (contract.contract_id !== claim.contract_id) {
        throw new CliError("Generated task contract does not match its workflow claim", 73);
      }
      expectedContractFiles.add(`${claim.contract_id}.json`);
      sourceRecords.push(sourceEntry(
        stateRoot,
        "generated-task-contract",
        contract.contract_id,
        path,
        contract,
      ));
    }
    for (const entry of await directoryEntries(
      commonDir,
      resolve(workflowRoot, "contracts"),
      "Generated task contracts",
    )) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new CliError(`Generated task contracts contain an unsupported entry: ${entry.name}`);
      }
      if (!expectedContractFiles.has(entry.name)) {
        const path = safeChild(
          resolve(workflowRoot, "contracts"),
          entry.name,
          "generated task contract",
        );
        const contract = validateGeneratedTaskContract(await readJson(path, { guardRoot: commonDir }));
        sourceRecords.push(sourceEntry(
          stateRoot,
          "generated-task-contract",
          contract.contract_id,
          path,
          contract,
        ));
        addBlocker(blockers, {
          code: "orphaned-authority",
          authority_kind: "claim",
          authority_id: entry.name,
          task_id: null,
          detail: "A generated task contract exists without an admitted workflow claim.",
        });
      }
    }
    workflow = await workflowJournalStatus({
      stateRoot,
      runId: run.run_id,
      planId: run.workflow_plan_id,
    });
    currentRevision = workflow.current_revision;
    claimEntries = workflow.contracts;
    const coordinatorBindings = lifecycleCoordinatorBindings(run);
    for (const entry of claimEntries) {
      assertClaimRunAuthority(entry.claim, run, commonDir, coordinatorBindings);
      if (entry.claim.state === "current") {
        addBlocker(blockers, {
          code: "current-unstarted-claim",
          authority_kind: "claim",
          authority_id: entry.claim.claim_id,
          task_id: entry.claim.task_id,
          detail: "The current workflow contract claim has not started a native operation.",
        });
      }
    }
    for (const task of currentRevision.tasks) {
      const covered = claimEntries.some((entry) => (
        entry.claim.task_id === task.task_id
        && ["current", "started", "terminal-no-object"].includes(entry.claim.state)
      ));
      if (!covered) {
        addBlocker(blockers, {
          code: "workflow-task-unclaimed",
          authority_kind: "workflow",
          authority_id: currentRevision.revision_digest,
          task_id: task.task_id,
          detail: "The current workflow task has no live or terminal contract claim.",
        });
      }
    }
  }

  const scan = async (options) => {
    const { records, sources } = await scanJsonRecords({ commonDir, stateRoot, runId, ...options });
    sourceRecords.push(...sources);
    return records;
  };
  const visible = await scan({
    directory: resolve(stateRoot, "visible-task-creations", "records"),
    recordKind: "visible-task-creation",
    selectRunId: (raw) => raw?.run_id,
    validate: validateVisibleTaskCreationRecord,
    selectId: (record) => record.operation_id,
  });
  const subagents = await scan({
    directory: resolve(stateRoot, "subagents", "records"),
    recordKind: "subagent-operation",
    selectRunId: (raw) => raw?.run_id,
    validate: validateSubagentOperation,
    selectId: (record) => record.operation_id,
  });
  const releases = await scan({
    directory: resolve(stateRoot, "releases", "records"),
    recordKind: "release",
    selectRunId: (raw) => raw?.run_id,
    validate: validateReleaseRecord,
    selectId: (record) => record.release_id,
  });
  const callbacks = await scan({
    directory: resolve(stateRoot, "callbacks", "journal"),
    recordKind: "callback",
    selectRunId: (raw) => raw?.receipt?.run_id,
    validate: validateCallbackRecordV06,
    selectId: (record) => record.callback_id,
  });
  const dispositions = await scan({
    directory: resolve(stateRoot, "dispositions", "records"),
    recordKind: "disposition",
    selectRunId: (raw) => raw?.run_id,
    validate: validateDispositionRecord,
    selectId: (record) => record.disposition_id,
  });
  const integrations = await scan({
    directory: resolve(stateRoot, "integration-lifecycle", "records"),
    recordKind: "integration",
    selectRunId: (raw) => raw?.run_id,
    validate: validateIntegrationRecordV06,
    selectId: (record) => record.integration_id,
  });
  const verifications = await scan({
    directory: resolve(stateRoot, "verifications", "records"),
    recordKind: "verification",
    selectRunId: (raw) => raw?.identity?.run_id,
    validate: validateVerificationRecordV06,
    selectId: (record) => record.verification_id,
  });
  const archives = await scan({
    directory: resolve(stateRoot, "archives", "records"),
    recordKind: "archive",
    selectRunId: (raw) => raw?.run_id,
    validate: validateArchiveOperation,
    selectId: (record) => record.archive_id,
  });
  const urgentSignals = await scan({
    directory: resolve(stateRoot, "urgent-signals", "journal"),
    recordKind: "urgent-signal",
    selectRunId: (raw) => raw?.signal?.run_id,
    validate: validateUrgentSignalRecordV06,
    selectId: (record) => record.urgent_id,
  });

  const claimByContract = new Map(claimEntries.map((entry) => [entry.claim.contract_id, entry]));
  const assertRecordAuthority = (record, label, canonical = canonicalFromRecord(record)) => {
    const contractId = canonical.contract_id;
    const entry = claimByContract.get(contractId);
    if (!entry) {
      addBlocker(blockers, {
        code: "orphaned-authority",
        authority_kind: label,
        authority_id: record.operation_id ?? record.release_id ?? record.callback_id
          ?? record.disposition_id ?? record.integration_id ?? record.verification_id
          ?? record.archive_id,
        task_id: record.task_id ?? record.receipt?.task_id ?? record.identity?.task_id ?? null,
        detail: "The record has no persisted workflow contract claim in this run.",
      });
      return null;
    }
    assertCanonicalMatch(canonical, entry.claim, `${label} record`);
    return entry;
  };
  for (const record of visible) assertRecordAuthority(record, "visible-task-creation");
  for (const record of subagents) assertRecordAuthority(record, "subagent-operation");
  for (const record of releases) assertRecordAuthority(record, "release");
  for (const record of callbacks) {
    assertRecordAuthority(record.receipt, "callback", canonicalFromReceipt(record.receipt));
  }
  for (const record of dispositions) assertRecordAuthority(record, "disposition");
  for (const record of integrations) assertRecordAuthority(record, "integration");
  for (const record of verifications) {
    const entry = claimByContract.get(record.identity.contract_id);
    if (!entry) {
      addBlocker(blockers, {
        code: "orphaned-authority",
        authority_kind: "verification",
        authority_id: record.verification_id,
        task_id: record.identity.task_id,
        detail: "The verification has no persisted workflow contract claim in this run.",
      });
    } else {
      const expected = canonicalFromClaim(entry.claim);
      for (const key of CANONICAL_KEYS.filter((candidate) => candidate !== "coordinator_binding")) {
        if (stableStringify(record.identity[key]) !== stableStringify(expected[key])) {
          throw new CliError("Verification record does not match its workflow contract claim", 73);
        }
      }
      if (record.identity.recipient_binding_digest !== expected.coordinator_binding.binding_digest) {
        throw new CliError("Verification recipient binding does not match its workflow contract claim", 73);
      }
    }
  }
  for (const record of archives) assertRecordAuthority(record, "archive");
  for (const record of urgentSignals) {
    const matchingReleases = releases.filter((release) => (
      releaseStatus(release) === "accepted"
      && release.ready_thread_id === record.signal.executor_id
      && release.coordinator_binding.lineage_id === record.signal.recipient.lineage_id
    ));
    if (matchingReleases.length !== 1) {
      addBlocker(blockers, {
        code: matchingReleases.length === 0 ? "orphaned-authority" : "conflicting-authority",
        authority_kind: "urgent-signal",
        authority_id: record.urgent_id,
        task_id: null,
        detail: matchingReleases.length === 0
          ? "The urgent signal has no exact accepted visible-task release executor authority."
          : "The urgent signal executor matches multiple accepted visible-task releases.",
      });
    }
    if (!["consumed", "superseded", "expired"].includes(record.state)) {
      addBlocker(blockers, {
        code: "urgent-unresolved",
        authority_kind: "urgent-signal",
        authority_id: record.urgent_id,
        task_id: matchingReleases[0]?.task_id ?? null,
        detail: `The urgent signal remains ${record.state} and requires coordinator disposition.`,
      });
    }
  }

  const visibleById = new Map(visible.map((record) => [record.operation_id, record]));
  const subagentById = new Map(subagents.map((record) => [record.operation_id, record]));
  const releasesByOperation = groupBy(releases, (record) => record.operation_id);
  const callbacksByRelease = groupBy(callbacks, (record) => record.receipt.release_id);
  const releaseById = new Map(releases.map((record) => [record.release_id, record]));
  const callbackById = new Map(callbacks.map((record) => [record.callback_id, record]));
  const dispositionsByOperation = groupBy(dispositions, (record) => record.operation_id);
  const dispositionsByCallback = groupBy(
    dispositions.filter((record) => record.callback_id !== null),
    (record) => record.callback_id,
  );
  const integrationsByDisposition = groupBy(integrations, (record) => record.disposition_id);
  const verificationsByCallback = groupBy(verifications, (record) => record.identity.callback_id);
  const integrationById = new Map(integrations.map((record) => [record.integration_id, record]));
  const verificationById = new Map(verifications.map((record) => [record.verification_id, record]));
  const archivesByDisposition = groupBy(archives, (record) => record.disposition_id);
  const seen = {
    visible: new Set(),
    subagent: new Set(),
    release: new Set(),
    callback: new Set(),
    disposition: new Set(),
    integration: new Set(),
    archive: new Set(),
  };
  const authoritativePassVerifications = new Map();

  const inspectVerification = (disposition) => {
    let verification = null;
    if (disposition.verification_id === null) {
      verification = only(verificationsByCallback.get(disposition.callback_id) ?? [], blockers, {
        authorityKind: "verification",
        authorityId: disposition.callback_id,
        taskId: disposition.task_id,
        detail: "The accepted callback has multiple candidate verification records.",
      });
    } else {
      verification = verificationById.get(disposition.verification_id) ?? null;
    }
    if (verification === null) {
      addBlocker(blockers, {
        code: "verification-missing",
        authority_kind: "disposition",
        authority_id: disposition.disposition_id,
        task_id: disposition.task_id,
        detail: "The accepted outcome has no authoritative combined verification record.",
      });
      return null;
    }
    if (
      disposition.verification_id !== null
      && verification.verification_id !== disposition.verification_id
    ) {
      addBlocker(blockers, {
        code: "verification-missing",
        authority_kind: "verification",
        authority_id: disposition.verification_id,
        task_id: disposition.task_id,
        detail: "The disposition names a missing combined verification record.",
      });
      return null;
    }
    if (!verificationMatchesDisposition(verification, disposition)) {
      throw new CliError("Combined verification does not match accepted disposition authority", 73);
    }
    if (
      disposition.verification_digest !== null
      && disposition.verification_digest !== verificationRecordDigest(verification)
    ) throw new CliError("Disposition verification digest does not match its proof record", 73);
    if (verification.classification !== "PASS") {
      addBlocker(blockers, {
        code: "verification-not-pass",
        authority_kind: "verification",
        authority_id: verification.verification_id,
        task_id: disposition.task_id,
        detail: "The accepted outcome is not backed by PASS combined verification.",
      });
    } else {
      authoritativePassVerifications.set(verification.verification_id, verification);
    }
    return verification;
  };

  const inspectDisposition = (disposition, callback = null) => {
    seen.disposition.add(disposition.disposition_id);
    if (callback !== null) {
      if (
        disposition.callback_id !== callback.callback_id
        || disposition.receipt_digest !== sha256(stableStringify(callback.receipt))
      ) throw new CliError("Disposition does not match its terminal callback", 73);
    }
    if (disposition.state !== "completed") {
      addBlocker(blockers, {
        code: "disposition-unfinalized",
        authority_kind: "disposition",
        authority_id: disposition.disposition_id,
        task_id: disposition.task_id,
        detail: `The coordinator disposition remains ${disposition.state}.`,
      });
    }
    const accepted = ["accepted-no-change", "accepted-for-integration"].includes(
      disposition.decision,
    );
    if (!accepted) {
      if (disposition.state === "completed") {
        addBlocker(blockers, {
          code: "retained-visible-task",
          authority_kind: "disposition",
          authority_id: disposition.disposition_id,
          task_id: disposition.task_id,
          detail: `The ${disposition.decision} visible task must remain visible and fenced.`,
        });
      }
      return;
    }
    const verification = inspectVerification(disposition);
    if (disposition.decision === "accepted-for-integration") {
      let integration = null;
      if (disposition.integration_id === null) {
        integration = only(integrationsByDisposition.get(disposition.disposition_id) ?? [], blockers, {
          authorityKind: "integration",
          authorityId: disposition.disposition_id,
          taskId: disposition.task_id,
          detail: "The accepted disposition has multiple candidate integration records.",
        });
      } else {
        integration = integrationById.get(disposition.integration_id) ?? null;
      }
      if (integration === null) {
        addBlocker(blockers, {
          code: "integration-missing",
          authority_kind: "disposition",
          authority_id: disposition.integration_id ?? disposition.disposition_id,
          task_id: disposition.task_id,
          detail: "The accepted committed outcome has no serial integration record.",
        });
      } else {
          seen.integration.add(integration.integration_id);
          if (
            integration.disposition_id !== disposition.disposition_id
            || integration.callback_id !== disposition.callback_id
          ) throw new CliError("Serial integration does not match its disposition authority", 73);
          if (integration.state !== "reconciled") {
            addBlocker(blockers, {
              code: "integration-unreconciled",
              authority_kind: "integration",
              authority_id: integration.integration_id,
              task_id: disposition.task_id,
              detail: "The serial integration has not been reconciled against the main branch.",
            });
          } else if (!SAFE_INTEGRATION_OUTCOMES.has(integration.outcome)) {
            addBlocker(blockers, {
              code: "integration-unsafe",
              authority_kind: "integration",
              authority_id: integration.integration_id,
              task_id: disposition.task_id,
              detail: `The reconciled integration outcome ${integration.outcome} is not safe to finalize.`,
            });
          }
          const safeToFinalize = integration.state === "reconciled"
            && SAFE_INTEGRATION_OUTCOMES.has(integration.outcome);
          if (safeToFinalize && verification !== null) {
            if (
              integration.verification_id !== verification.verification_id
              || integration.combined_verification_digest !== verificationRecordDigest(verification)
              || (disposition.verification_digest !== null
                && integration.combined_verification_digest !== disposition.verification_digest)
              || verification.integration_scope?.integration_id !== integration.integration_id
              || verification.integration_scope?.integration_record_digest
                !== integrationRecordDigest(integration)
            ) {
              throw new CliError(
                "Safe integration does not match its exact combined verification authority",
                73,
              );
            }
          }
      }
    } else if (verification !== null && verification.integration_scope !== null) {
      throw new CliError("Accepted no-change disposition cannot use integration-scoped verification", 73);
    }
    if (disposition.state === "completed") {
      const archive = only(archivesByDisposition.get(disposition.disposition_id) ?? [], blockers, {
        authorityKind: "archive",
        authorityId: disposition.disposition_id,
        taskId: disposition.task_id,
        detail: "The accepted disposition has multiple archive operations.",
      });
      if (archive === null) {
        addBlocker(blockers, {
          code: "archive-missing",
          authority_kind: "archive",
          authority_id: disposition.disposition_id,
          task_id: disposition.task_id,
          detail: "The accepted visible task has no completed archive operation.",
        });
      } else {
        seen.archive.add(archive.archive_id);
        const archivedOperation = visibleById.get(disposition.operation_id) ?? null;
        const archivedRelease = releaseById.get(disposition.release_id) ?? null;
        const archivedCallback = callbackById.get(disposition.callback_id) ?? null;
        const archiveChain = {
          operation: archivedOperation !== null
            && archivedOperation.ready?.thread_id === disposition.executor_thread_id
            && archive.operation_id === disposition.operation_id,
          release: archivedRelease !== null
            && releaseStatus(archivedRelease) === "accepted"
            && archivedRelease.operation_id === disposition.operation_id
            && archivedRelease.ready_thread_id === disposition.executor_thread_id
            && archive.release_id === disposition.release_id,
          executor: archive.executor_thread_id === disposition.executor_thread_id
            && archive.task.thread_id === disposition.executor_thread_id
            && archive.host_intent.thread_id === disposition.executor_thread_id,
          callback: archivedCallback !== null
            && archivedCallback.receipt.operation_id === disposition.operation_id
            && archivedCallback.receipt.release_id === disposition.release_id
            && archivedCallback.receipt.executor_thread_id === disposition.executor_thread_id
            && archive.callback_id === disposition.callback_id,
          disposition: archive.disposition_id === disposition.disposition_id
            && archive.decision === disposition.decision,
          verification: archive.git_resolution.verification_id === disposition.verification_id
            && archive.git_resolution.verification_digest === disposition.verification_digest,
          git_resolution: disposition.decision === "accepted-for-integration"
            ? archive.git_resolution.integration_id === disposition.integration_id
            : archive.git_resolution.integration_id === null,
        };
        const brokenArchiveLink = Object.entries(archiveChain)
          .find(([, matches]) => !matches)?.[0] ?? null;
        if (brokenArchiveLink !== null) {
          throw new CliError(
            `Task archive does not match its exact ${brokenArchiveLink} authority`,
            73,
          );
        }
        if (archive.state !== "completed") {
          addBlocker(blockers, {
            code: "archive-incomplete",
            authority_kind: "archive",
            authority_id: archive.archive_id,
            task_id: disposition.task_id,
            detail: `The visible task archive remains ${archive.state}.`,
          });
        }
      }
    }
  };

  for (const entry of claimEntries.filter((candidate) => (
    ["started", "terminal-no-object"].includes(candidate.claim.state)
  ))) {
    const claim = entry.claim;
    if (claim.operation_id === null) {
      throw new CliError("Started workflow claim lacks its native operation identity", 73);
    }
    if (claim.execution_kind === "subagent") {
      const operation = subagentById.get(claim.operation_id);
      if (!operation) {
        addBlocker(blockers, {
          code: "native-operation-missing",
          authority_kind: "claim",
          authority_id: claim.claim_id,
          task_id: claim.task_id,
          detail: "The started subagent claim has no persisted native operation.",
        });
        continue;
      }
      seen.subagent.add(operation.operation_id);
      if (!entry.operation_record_present || !["accepted", "rejected"].includes(operation.state)) {
        addBlocker(blockers, {
          code: "subagent-incomplete",
          authority_kind: "subagent-operation",
          authority_id: operation.operation_id,
          task_id: operation.task_id,
          detail: `The native subagent remains ${operation.state}.`,
        });
      }
      continue;
    }

    const operation = visibleById.get(claim.operation_id);
    if (!operation) {
      addBlocker(blockers, {
        code: "native-operation-missing",
        authority_kind: "claim",
        authority_id: claim.claim_id,
        task_id: claim.task_id,
        detail: "The started visible-task claim has no persisted creation operation.",
      });
      continue;
    }
    seen.visible.add(operation.operation_id);
    const operationDispositions = dispositionsByOperation.get(operation.operation_id) ?? [];
    const completedCancellation = operationDispositions.filter((candidate) => (
      candidate.decision === "cancelled" && candidate.state === "completed"
    ));
    if (completedCancellation.length > 1) {
      addBlocker(blockers, {
        code: "conflicting-authority",
        authority_kind: "disposition",
        authority_id: operation.operation_id,
        task_id: operation.task_id,
        detail: "The visible-task operation has multiple completed cancellation dispositions.",
      });
    }

    if (["prepared", "attempting", "provisional"].includes(operation.status)) {
      addBlocker(blockers, {
        code: "visible-creation-in-flight",
        authority_kind: "visible-task-creation",
        authority_id: operation.operation_id,
        task_id: operation.task_id,
        detail: `The visible-task creation remains ${operation.status}.`,
      });
      continue;
    }
    if (operation.status === "ambiguous") {
      addBlocker(blockers, {
        code: "visible-creation-ambiguous",
        authority_kind: "visible-task-creation",
        authority_id: operation.operation_id,
        task_id: operation.task_id,
        detail: "The visible-task creation has unresolved host identity ambiguity.",
      });
      continue;
    }
    if (operation.status === "session-blocked") {
      addBlocker(blockers, {
        code: "visible-creation-session-blocked",
        authority_kind: "visible-task-creation",
        authority_id: operation.operation_id,
        task_id: operation.task_id,
        detail: "The visible-task creation is blocked by its host session and is not terminal.",
      });
      continue;
    }
    if (operation.status === "not-created") continue;

    const cancellation = completedCancellation[0] ?? null;
    const release = only(releasesByOperation.get(operation.operation_id) ?? [], blockers, {
      authorityKind: "release",
      authorityId: operation.operation_id,
      taskId: operation.task_id,
      detail: "The visible-task operation has multiple release records.",
    });
    if (release === null) {
      if (cancellation !== null) inspectDisposition(cancellation);
      else {
        addBlocker(blockers, {
          code: "release-missing",
          authority_kind: "release",
          authority_id: operation.operation_id,
          task_id: operation.task_id,
          detail: "The ready visible task has no persisted task release.",
        });
      }
      continue;
    }
    seen.release.add(release.release_id);
    if (release.operation_id !== operation.operation_id) {
      throw new CliError("Release operation identity changed", 73);
    }
    if (releaseStatus(release) !== "accepted") {
      if (cancellation !== null) inspectDisposition(cancellation);
      else {
        addBlocker(blockers, {
          code: "release-unaccepted",
          authority_kind: "release",
          authority_id: release.release_id,
          task_id: release.task_id,
          detail: `The task release remains ${releaseStatus(release)}.`,
        });
      }
      continue;
    }

    const callback = only(callbacksByRelease.get(release.release_id) ?? [], blockers, {
      authorityKind: "callback",
      authorityId: release.release_id,
      taskId: release.task_id,
      detail: "The accepted release has multiple terminal callback records.",
    });
    if (callback === null) {
      if (cancellation !== null) inspectDisposition(cancellation);
      else {
        addBlocker(blockers, {
          code: "callback-missing",
          authority_kind: "callback",
          authority_id: release.release_id,
          task_id: release.task_id,
          detail: "The accepted task release has no terminal callback.",
        });
      }
      continue;
    }
    seen.callback.add(callback.callback_id);
    if (
      callback.receipt.operation_id !== operation.operation_id
      || callback.receipt.executor_thread_id !== release.ready_thread_id
    ) throw new CliError("Terminal callback does not match its accepted release", 73);
    if (["persisted", "observed"].includes(callback.state)) {
      addBlocker(blockers, {
        code: "callback-unconsumed",
        authority_kind: "callback",
        authority_id: callback.callback_id,
        task_id: callback.receipt.task_id,
        detail: `The terminal callback remains ${callback.state}.`,
      });
    }
    const dispositionCandidates = callback.disposition_id === null
      ? dispositionsByCallback.get(callback.callback_id) ?? []
      : dispositions.filter((candidate) => candidate.disposition_id === callback.disposition_id);
    const disposition = only(dispositionCandidates, blockers, {
      authorityKind: "disposition",
      authorityId: callback.callback_id,
      taskId: callback.receipt.task_id,
      detail: "The terminal callback has multiple coordinator dispositions.",
    });
    if (disposition === null) {
      addBlocker(blockers, {
        code: "disposition-missing",
        authority_kind: "disposition",
        authority_id: callback.callback_id,
        task_id: callback.receipt.task_id,
        detail: "The terminal callback has no durable coordinator disposition.",
      });
    } else {
      inspectDisposition(disposition, callback);
      if (callback.state === "consumed" && disposition.state !== "completed") {
        throw new CliError("Consumed callback does not have a completed disposition", 73);
      }
    }
  }

  const orphan = (record, kind, id, taskId) => addBlocker(blockers, {
    code: "orphaned-authority",
    authority_kind: kind,
    authority_id: id,
    task_id: taskId,
    detail: "The persisted record is not reachable from a started or terminal workflow contract claim.",
  });
  for (const record of visible) {
    if (!seen.visible.has(record.operation_id)) {
      orphan(record, "visible-task-creation", record.operation_id, record.task_id);
    }
  }
  for (const record of subagents) {
    if (!seen.subagent.has(record.operation_id)) {
      orphan(record, "subagent-operation", record.operation_id, record.task_id);
    }
  }
  for (const record of releases) {
    if (!seen.release.has(record.release_id)) orphan(record, "release", record.release_id, record.task_id);
  }
  for (const record of callbacks) {
    if (!seen.callback.has(record.callback_id)) {
      orphan(record, "callback", record.callback_id, record.receipt.task_id);
    }
  }
  for (const record of dispositions) {
    if (!seen.disposition.has(record.disposition_id)) {
      orphan(record, "disposition", record.disposition_id, record.task_id);
    }
  }
  for (const record of integrations) {
    if (!seen.integration.has(record.integration_id)) {
      if (record.state !== "reconciled") {
        addBlocker(blockers, {
          code: "integration-unreconciled",
          authority_kind: "integration",
          authority_id: record.integration_id,
          task_id: record.task_id,
          detail: "An unreferenced serial integration remains unreconciled.",
        });
      } else if (!SAFE_INTEGRATION_OUTCOMES.has(record.outcome)) {
        addBlocker(blockers, {
          code: "integration-unsafe",
          authority_kind: "integration",
          authority_id: record.integration_id,
          task_id: record.task_id,
          detail: `An unreferenced integration outcome ${record.outcome} is unsafe.`,
        });
      }
      orphan(record, "integration", record.integration_id, record.task_id);
    }
  }
  for (const record of archives) {
    if (!seen.archive.has(record.archive_id)) {
      if (record.state !== "completed") {
        addBlocker(blockers, {
          code: "archive-incomplete",
          authority_kind: "archive",
          authority_id: record.archive_id,
          task_id: record.task_id,
          detail: `An unreferenced task archive remains ${record.state}.`,
        });
      }
      orphan(record, "archive", record.archive_id, record.task_id);
    }
    if (record.state === "completed" && record.worktree.management === "host-managed") {
      const worktreePresent = await lstat(record.worktree.path).then(
        () => true,
        (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        },
      );
      if (worktreePresent) {
        addBlocker(blockers, {
          code: "worktree-retained",
          authority_kind: "archive",
          authority_id: record.archive_id,
          task_id: record.task_id,
          detail: "The archived task's host-managed worktree path exists again.",
        });
      }
    }
  }

  const cleanupPlan = await cleanupPlanV06({ stateRoot, runId: run.run_id });
  for (const item of cleanupPlan.items.filter((entry) => entry.close_blocked)) {
    addBlocker(blockers, {
      code: "cleanup-unresolved",
      authority_kind: "cleanup-plan",
      authority_id: cleanupPlan.plan_id,
      task_id: item.task_id,
      detail: `Executor branch ${item.branch} remains unresolved: ${item.reason_codes.join(", ")}.`.slice(0, 512),
    });
  }
  for (const fence of cleanupPlan.unbound_branch_fences.filter((entry) => entry.close_blocked)) {
    addBlocker(blockers, {
      code: "cleanup-unresolved",
      authority_kind: "cleanup-plan",
      authority_id: cleanupPlan.plan_id,
      task_id: null,
      detail: `Unbound branch fence ${fence.branch} remains unresolved: ${fence.reason_codes.join(", ")}.`.slice(0, 512),
    });
  }
  const cleanup = validateCleanupEvidence({
    plan_id: cleanupPlan.plan_id,
    mutation_performed: cleanupPlan.mutation_performed,
    counts: {
      host_worktree_tasks: cleanupPlan.counts.host_worktree_tasks,
      cleanup_required: cleanupPlan.counts.cleanup_required,
      cleanup_candidates: cleanupPlan.counts.cleanup_candidates,
      close_blocked: cleanupPlan.counts.close_blocked,
    },
  });

  const counts = {
    workflow_tasks: currentRevision?.tasks.length ?? 0,
    workflow_claims: claimEntries.length,
    visible_task_creations: visible.length,
    subagent_operations: subagents.length,
    releases: releases.length,
    callbacks: callbacks.length,
    dispositions: dispositions.length,
    integrations: integrations.length,
    verifications: verifications.length,
    archives: archives.length,
    urgent_signals: urgentSignals.length,
    recipient_bindings: recipientBindingCount,
  };
  const repository = await deriveRepositoryEvidence({
    context: runtime.context,
    commonDir,
    authoritativePassVerifications,
  });
  inspectLiveRepository(repository, blockers, run.run_id);
  const sortedBlockers = [...blockers.values()].sort(blockerSort);
  const workflowJournalDigest = workflow?.journal.journal_digest ?? "0".repeat(64);
  const currentRevisionDigest = currentRevision?.revision_digest
    ?? run.workflow_revision_digest;
  return {
    schema_version: RUN_CLOSURE_AUDIT_SCHEMA_VERSION,
    kind: RUN_CLOSURE_AUDIT_KIND,
    authority: {
      run_id: run.run_id,
      common_dir: commonDir,
      state_root: stateRoot,
      runtime_id: run.runtime_id,
      runtime_context_digest: run.runtime_context_hash,
      bundle_digest: runtimeBinding.bundle_hash,
      configuration_digest: runtimeBinding.config_hash,
      policy_digest: runtimeBinding.policy_hash,
      repository_id: runtimeBinding.repository_hash,
      repository_digest: runtimeBinding.repository_hash,
      workflow_plan_id: run.workflow_plan_id,
      activated_revision_digest: run.workflow_revision_digest,
      current_revision_digest: currentRevisionDigest,
      workflow_journal_digest: workflowJournalDigest,
      run_binding_generation: run.binding.generation,
      run_binding_digest: sha256(stableStringify(run.binding)),
      run_activation_digest: sha256(stableStringify(run)),
    },
    repository,
    cleanup,
    source_records: sourceRecords.sort(sourceSort),
    blockers: sortedBlockers,
    counts,
    terminal_ready: sortedBlockers.length === 0,
  };
}

function evidenceDigest(evidence) {
  return sha256(stableStringify(evidenceMaterial(evidence)));
}

function recordForEvidence(evidence, auditedAt) {
  const proofDigest = evidenceDigest(evidence);
  const draft = {
    ...clone(evidence),
    audit_id: `run-closure-audit-v1-${proofDigest}`,
    evidence_digest: proofDigest,
    audited_at: auditedAt,
    record_digest: "0".repeat(64),
  };
  draft.record_digest = sha256(stableStringify(recordMaterial(draft)));
  return validateRunClosureAudit(draft);
}

async function readAuditRecord({ commonDir, stateRoot, id, allowMissing = false }) {
  const path = auditPaths(stateRoot, { id }).record;
  const raw = await readJson(path, { allowMissing, guardRoot: commonDir });
  if (raw === null) return { audit: null, path };
  const audit = validateRunClosureAudit(raw);
  if (audit.audit_id !== id) throw new CliError("Run-closure audit path does not match its content identity");
  return { audit, path };
}

export async function auditRunClosure({
  gitCommonDirectory = null,
  stateRoot = null,
  runId,
  now = Date.now(),
}) {
  const run = requireText(runId, "runId", { max: 128, safeId: true });
  const roots = await resolveRoots({ gitCommonDirectory, stateRoot });
  return withActiveRunMutation({
    gitCommonDirectory: roots.commonDir,
    runId: run,
  }, () => withProcessLock({
    path: auditPaths(roots.stateRoot, { runId: run }).lock,
    guardRoot: roots.commonDir,
    label: `run-closure audit ${run}`,
  }, async () => {
      const first = await deriveClosureEvidence({ ...roots, runId: run });
      const second = await deriveClosureEvidence({ ...roots, runId: run });
      if (evidenceDigest(first) !== evidenceDigest(second)) {
        throw new CliError("Run authority changed while deriving its closure audit; retry the explicit run", 75);
      }
      const id = `run-closure-audit-v1-${evidenceDigest(first)}`;
      const existing = await readAuditRecord({ ...roots, id, allowMissing: true });
      if (existing.audit !== null) {
        return { status: "existing", audit: clone(existing.audit), path: existing.path };
      }
      const audit = recordForEvidence(first, nowIso(now));
      const path = auditPaths(roots.stateRoot, { id: audit.audit_id }).record;
      await ensureExactJson(path, audit, { guardRoot: roots.commonDir, mode: 0o600 });
      return { status: "created", audit: clone(audit), path };
    }));
}

export async function readRunClosureAudit({
  gitCommonDirectory = null,
  stateRoot = null,
  runId,
  auditId: requestedAuditId,
}) {
  const run = requireText(runId, "runId", { max: 128, safeId: true });
  const id = auditId(requestedAuditId);
  const roots = await resolveRoots({ gitCommonDirectory, stateRoot });
  const result = await readAuditRecord({ ...roots, id });
  if (result.audit.authority.run_id !== run) {
    throw new CliError("Run-closure audit does not belong to the explicit runId", 73);
  }
  return { audit: clone(result.audit), path: result.path };
}

export async function runClosureAuditStatus({
  gitCommonDirectory = null,
  stateRoot = null,
  runId,
  auditId: requestedAuditId,
}) {
  const run = requireText(runId, "runId", { max: 128, safeId: true });
  const roots = await resolveRoots({ gitCommonDirectory, stateRoot });
  const persisted = await readRunClosureAudit({
    ...roots,
    runId: run,
    auditId: requestedAuditId,
  });
  const currentEvidence = await deriveClosureEvidence({ ...roots, runId: run });
  const currentAuditId = `run-closure-audit-v1-${evidenceDigest(currentEvidence)}`;
  const current = currentAuditId === persisted.audit.audit_id;
  return {
    audit_id: persisted.audit.audit_id,
    run_id: run,
    terminal_ready: persisted.audit.terminal_ready,
    current,
    current_audit_id: currentAuditId,
    current_terminal_ready: currentEvidence.terminal_ready,
    close_permitted: persisted.audit.terminal_ready && current,
    blockers: clone(currentEvidence.blockers),
    counts: clone(currentEvidence.counts),
    audited_at: persisted.audit.audited_at,
    path: persisted.path,
  };
}

export async function closeRunFromAudit({
  gitCommonDirectory = null,
  stateRoot = null,
  runId,
  resume,
  auditId: requestedAuditId,
  closedAt,
}) {
  const run = requireText(runId, "runId", { max: 128, safeId: true });
  const roots = await resolveRoots({ gitCommonDirectory, stateRoot });
  return withActiveRunMutation({
    gitCommonDirectory: roots.commonDir,
    runId: run,
  }, async () => {
    const persisted = await readRunClosureAudit({
      ...roots,
      runId: run,
      auditId: requestedAuditId,
    });
    const currentEvidence = await deriveClosureEvidence({ ...roots, runId: run });
    const currentAuditId = `run-closure-audit-v1-${evidenceDigest(currentEvidence)}`;
    if (
      persisted.audit.terminal_ready !== true
      || currentEvidence.terminal_ready !== true
      || currentAuditId !== persisted.audit.audit_id
    ) {
      throw new CliError(
        "Run closure requires a current terminal-ready run-closure audit",
        73,
      );
    }
    return closeRun({
      gitCommonDirectory: roots.commonDir,
      runId: run,
      resume,
      closedAt,
    });
  });
}
