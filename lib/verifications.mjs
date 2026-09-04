import { spawnSync } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
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
import {
  discoverGit,
  gitCommonDirectoryForState,
  gitSnapshot,
  validateGitBranchName,
} from "./git.mjs";
import {
  terminalCallbackIdForV4,
  validateTerminalReceiptV4,
} from "./task-results.mjs";
import { resolveTaskLaunchExecutorWorktree } from "./core/task-launch.mjs";

const VERIFICATION_KIND = "codex-flow-v09-combined-verification";
const INDEX_KIND = "codex-flow-v09-verification-request-index";
const VERIFICATION_ID = /^verification-v1-[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SAFE_INTEGRATION_OUTCOMES = ["ancestor", "patch-equivalent"];
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_CHECKS = 32;
const MAX_ARGV = 128;
const MAX_ARGUMENT_LENGTH = 16_384;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename, label = "Verification state path") {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label.toLowerCase()}`);
  }
  return path;
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

function nullableBranch(value, label) {
  return value === null ? null : requireText(value, label, { max: 256 });
}

function absolutePath(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit timestamp`);
  }
  return result;
}

function timestampFromClock(now, label) {
  const value = typeof now === "function" ? now() : now;
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) {
    throw new CliError(`${label} clock must produce a finite timestamp`);
  }
  return timestamp(new Date(milliseconds).toISOString(), label);
}

function verificationId(value) {
  const result = requireText(value, "verification_id", { max: 128, safeId: true });
  if (!VERIFICATION_ID.test(result)) throw new CliError("verification_id must be a v1 verification ID");
  return result;
}

function paths(stateRoot, { id = null, requestDigest = null } = {}) {
  const root = resolve(stateRoot, "verifications");
  const records = resolve(root, "records");
  const indexes = resolve(root, "requests");
  const locks = resolve(root, "locks");
  return {
    records,
    record: id === null
      ? null
      : safeChild(records, `${verificationId(id)}.json`),
    indexes,
    index: requestDigest === null
      ? null
      : safeChild(indexes, `${digest(requestDigest, "request_digest")}.json`),
    lock: requestDigest === null
      ? null
      : safeChild(locks, `${digest(requestDigest, "request_digest")}.lock.json`),
  };
}

function validateArgv(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARGV) {
    throw new CliError(`${label} must contain from 1 to ${MAX_ARGV} arguments`);
  }
  return value.map((entry, index) => {
    if (
      typeof entry !== "string"
      || entry.length > MAX_ARGUMENT_LENGTH
      || entry.includes("\0")
      || (index === 0 && entry.length === 0)
    ) {
      throw new CliError(`${label}[${index}] is not a valid process argument`);
    }
    return entry;
  });
}

function validateCheckDefinition(value, index) {
  requireExactFields(value, {
    required: ["check_id", "argv"],
    optional: ["timeout_ms"],
  }, `Verification check[${index}]`);
  return {
    check_id: requireText(value.check_id, `checks[${index}].check_id`, {
      max: 128,
      safeId: true,
    }),
    argv: validateArgv(value.argv, `checks[${index}].argv`),
    timeout_ms: value.timeout_ms === undefined
      ? DEFAULT_TIMEOUT_MS
      : requireInteger(value.timeout_ms, `checks[${index}].timeout_ms`, {
        min: 1,
        max: MAX_TIMEOUT_MS,
      }),
  };
}

function validateCheckDefinitions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHECKS) {
    throw new CliError(`checks must contain from 1 to ${MAX_CHECKS} explicit argv checks`);
  }
  const checks = value.map(validateCheckDefinition);
  if (new Set(checks.map((check) => check.check_id)).size !== checks.length) {
    throw new CliError("checks contains duplicate check_id values");
  }
  return checks;
}

function validateCheckEvidence(value, index) {
  requireExactFields(value, {
    required: [
      "check_id", "argv", "timeout_ms", "exit_code", "stdout_digest", "stderr_digest",
    ],
  }, `Verification evidence[${index}]`);
  const definition = validateCheckDefinition({
    check_id: value.check_id,
    argv: value.argv,
    timeout_ms: value.timeout_ms,
  }, index);
  return {
    ...definition,
    exit_code: requireInteger(value.exit_code, `checks[${index}].exit_code`, {
      min: 0,
      max: 255,
    }),
    stdout_digest: digest(value.stdout_digest, `checks[${index}].stdout_digest`),
    stderr_digest: digest(value.stderr_digest, `checks[${index}].stderr_digest`),
  };
}

function validateIdentity(value) {
  requireExactFields(value, {
    required: [
      "callback_id", "receipt_digest", "recipient_binding_digest", "executor_thread_id",
      "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
      "common_dir", "plan_id", "revision_digest", "task_id", "task_digest",
      "contract_id", "launch_id",
    ],
  }, "Verification callback identity");
  return {
    callback_id: requireText(value.callback_id, "identity.callback_id", { max: 128, safeId: true }),
    receipt_digest: digest(value.receipt_digest, "identity.receipt_digest"),
    recipient_binding_digest: digest(
      value.recipient_binding_digest,
      "identity.recipient_binding_digest",
    ),
    executor_thread_id: requireText(value.executor_thread_id, "identity.executor_thread_id", {
      max: 128,
      safeId: true,
    }),
    run_id: requireText(value.run_id, "identity.run_id", { max: 128, safeId: true }),
    runtime_context_digest: digest(
      value.runtime_context_digest,
      "identity.runtime_context_digest",
    ),
    configuration_digest: digest(
      value.configuration_digest,
      "identity.configuration_digest",
    ),
    repository_id: requireText(value.repository_id, "identity.repository_id", {
      max: 128,
      safeId: true,
    }),
    common_dir: absolutePath(value.common_dir, "identity.common_dir"),
    plan_id: requireText(value.plan_id, "identity.plan_id", { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, "identity.revision_digest"),
    task_id: requireText(value.task_id, "identity.task_id", { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, "identity.task_digest"),
    contract_id: digest(value.contract_id, "identity.contract_id"),
    launch_id: requireText(value.launch_id, "identity.launch_id", { max: 128, safeId: true }),
  };
}

function validateIntegrationScope(value, identity = null) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "integration_id", "integration_record_digest", "callback_id", "receipt_digest",
      "recipient_binding_digest", "executor_thread_id", "run_id", "runtime_context_digest",
      "configuration_digest", "repository_id", "common_dir", "plan_id",
      "revision_digest", "task_id", "task_digest", "contract_id", "launch_id",
      "main_branch", "reconciled_main_tip", "outcome",
    ],
  }, "Verification integration scope");
  const scope = {
    integration_id: requireText(value.integration_id, "integration_scope.integration_id", {
      max: 128,
      safeId: true,
    }),
    integration_record_digest: digest(
      value.integration_record_digest,
      "integration_scope.integration_record_digest",
    ),
    callback_id: requireText(value.callback_id, "integration_scope.callback_id", {
      max: 128,
      safeId: true,
    }),
    receipt_digest: digest(value.receipt_digest, "integration_scope.receipt_digest"),
    recipient_binding_digest: digest(
      value.recipient_binding_digest,
      "integration_scope.recipient_binding_digest",
    ),
    executor_thread_id: requireText(
      value.executor_thread_id,
      "integration_scope.executor_thread_id",
      { max: 128, safeId: true },
    ),
    run_id: requireText(value.run_id, "integration_scope.run_id", { max: 128, safeId: true }),
    runtime_context_digest: digest(
      value.runtime_context_digest,
      "integration_scope.runtime_context_digest",
    ),
    configuration_digest: digest(
      value.configuration_digest,
      "integration_scope.configuration_digest",
    ),
    repository_id: requireText(value.repository_id, "integration_scope.repository_id", {
      max: 128,
      safeId: true,
    }),
    common_dir: absolutePath(value.common_dir, "integration_scope.common_dir"),
    plan_id: requireText(value.plan_id, "integration_scope.plan_id", { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, "integration_scope.revision_digest"),
    task_id: requireText(value.task_id, "integration_scope.task_id", { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, "integration_scope.task_digest"),
    contract_id: digest(value.contract_id, "integration_scope.contract_id"),
    launch_id: requireText(value.launch_id, "integration_scope.launch_id", {
      max: 128,
      safeId: true,
    }),
    main_branch: requireText(value.main_branch, "integration_scope.main_branch", { max: 256 }),
    reconciled_main_tip: commit(
      value.reconciled_main_tip,
      "integration_scope.reconciled_main_tip",
    ),
    outcome: requireEnum(
      value.outcome,
      SAFE_INTEGRATION_OUTCOMES,
      "integration_scope.outcome",
    ),
  };
  if (identity !== null) {
    for (const key of Object.keys(identity)) {
      if (scope[key] !== identity[key]) {
        throw new CliError(`Integration scope ${key} does not match the callback identity`, 73);
      }
    }
  }
  return scope;
}

function validateRepositoryEvidence(value) {
  requireExactFields(value, {
    required: [
      "root", "common_dir", "requested_revision", "requested_branch",
      "started_revision", "started_branch", "started_cleanliness",
      "completed_revision", "completed_branch", "completed_cleanliness",
    ],
  }, "Verification repository evidence");
  return {
    root: requireText(value.root, "repository.root", { max: 4096 }),
    common_dir: requireText(value.common_dir, "repository.common_dir", { max: 4096 }),
    requested_revision: commit(value.requested_revision, "repository.requested_revision"),
    requested_branch: nullableBranch(value.requested_branch, "repository.requested_branch"),
    started_revision: commit(value.started_revision, "repository.started_revision"),
    started_branch: nullableBranch(value.started_branch, "repository.started_branch"),
    started_cleanliness: requireEnum(
      value.started_cleanliness,
      ["clean", "dirty"],
      "repository.started_cleanliness",
    ),
    completed_revision: commit(value.completed_revision, "repository.completed_revision"),
    completed_branch: nullableBranch(value.completed_branch, "repository.completed_branch"),
    completed_cleanliness: requireEnum(
      value.completed_cleanliness,
      ["clean", "dirty"],
      "repository.completed_cleanliness",
    ),
  };
}

function requestMaterial(record) {
  return {
    identity: record.identity,
    integration_scope: record.integration_scope,
    repository: {
      root: record.repository.root,
      common_dir: record.repository.common_dir,
      requested_revision: record.repository.requested_revision,
      requested_branch: record.repository.requested_branch,
    },
    checks: record.checks.map(({ check_id, argv, timeout_ms }) => ({
      check_id,
      argv,
      timeout_ms,
    })),
  };
}

function recordContent(record) {
  const { verification_id: ignored, ...content } = record;
  return content;
}

function expectedVerificationId(record) {
  return `verification-v1-${sha256(stableStringify(recordContent(record)))}`;
}

function repositoryIsExact(repository, prefix) {
  return (
    repository[`${prefix}_revision`] === repository.requested_revision
    && repository[`${prefix}_branch`] === repository.requested_branch
    && repository[`${prefix}_cleanliness`] === "clean"
  );
}

export function validateVerificationRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "verification_id", "request_digest", "identity",
      "integration_scope", "repository", "classification", "checks", "started_at",
      "completed_at",
    ],
  }, "Combined verification record");
  if (value.schema_version !== 1 || value.kind !== VERIFICATION_KIND) {
    throw new CliError("Invalid v0.9 combined verification record");
  }
  const identity = validateIdentity(value.identity);
  const integrationScope = validateIntegrationScope(value.integration_scope, identity);
  const repository = validateRepositoryEvidence(value.repository);
  if (repository.common_dir !== identity.common_dir) {
    throw new CliError("Verification repository evidence does not match the callback common directory", 73);
  }
  if (!Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > MAX_CHECKS) {
    throw new CliError(`checks must contain from 1 to ${MAX_CHECKS} check evidence records`);
  }
  const checks = value.checks.map(validateCheckEvidence);
  if (new Set(checks.map((check) => check.check_id)).size !== checks.length) {
    throw new CliError("checks contains duplicate check_id values");
  }
  const startedAt = timestamp(value.started_at, "started_at");
  const completedAt = timestamp(value.completed_at, "completed_at");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new CliError("completed_at cannot precede started_at");
  }
  if (!repositoryIsExact(repository, "started")) {
    throw new CliError("Verification did not start from the exact clean requested Git state");
  }
  const expectedClassification = checks.every((check) => check.exit_code === 0)
    && repositoryIsExact(repository, "completed")
    ? "PASS"
    : "FAIL";
  const record = {
    schema_version: 1,
    kind: VERIFICATION_KIND,
    verification_id: verificationId(value.verification_id),
    request_digest: digest(value.request_digest, "request_digest"),
    identity,
    integration_scope: integrationScope,
    repository,
    classification: requireEnum(value.classification, ["PASS", "FAIL"], "classification"),
    checks,
    started_at: startedAt,
    completed_at: completedAt,
  };
  if (record.request_digest !== sha256(stableStringify(requestMaterial(record)))) {
    throw new CliError("Combined verification request digest is invalid");
  }
  if (record.classification !== expectedClassification) {
    throw new CliError("Combined verification classification contradicts its evidence");
  }
  if (record.verification_id !== expectedVerificationId(record)) {
    throw new CliError("Combined verification content identity is invalid");
  }
  return record;
}

export function verificationRecordDigest(value) {
  const record = validateVerificationRecord(value);
  return sha256(stableStringify(recordContent(record)));
}

function identityFromReceipt(receipt) {
  return {
    callback_id: terminalCallbackIdForV4(receipt),
    receipt_digest: sha256(stableStringify(receipt)),
    recipient_binding_digest: receipt.recipient.binding_digest,
    executor_thread_id: receipt.executor_thread_id,
    run_id: receipt.run_id,
    runtime_context_digest: receipt.runtime_context_digest,
    configuration_digest: receipt.configuration_digest,
    repository_id: receipt.repository_id,
    common_dir: receipt.common_dir,
    plan_id: receipt.plan_id,
    revision_digest: receipt.revision_digest,
    task_id: receipt.task_id,
    task_digest: receipt.task_digest,
    contract_id: receipt.contract_id,
    launch_id: receipt.launch_id,
  };
}

function requestedTarget(receipt, integrationScope) {
  if (receipt.classification !== "PASS") {
    throw new CliError("Combined verification requires a PASS terminal receipt", 73);
  }
  if (integrationScope !== null) {
    if (receipt.git_outcome.kind !== "clean-commit") {
      throw new CliError("Integration-scoped verification requires a clean-commit receipt", 73);
    }
    return {
      revision: integrationScope.reconciled_main_tip,
      branch: integrationScope.main_branch,
    };
  }
  if (receipt.git_outcome.kind !== "unchanged") {
    throw new CliError("A committed executor result requires reconciled integration scope", 73);
  }
  return {
    revision: receipt.git_outcome.final_revision,
    branch: receipt.git_outcome.branch,
  };
}

function normalizeSnapshot(snapshot) {
  return {
    revision: commit(snapshot.revision, "Git revision"),
    branch: snapshot.branch === "detached" ? null : snapshot.branch,
    cleanliness: requireEnum(snapshot.cleanliness, ["clean", "dirty"], "Git cleanliness"),
  };
}

async function canonicalRepositoryContext({ stateRoot, repositoryPath, target, identity }) {
  const discovered = discoverGit(repositoryPath);
  const root = await realpath(discovered.root);
  const commonDir = await realpath(discovered.commonDir);
  const journalCommonDir = await realpath(guardRoot(stateRoot));
  const receiptCommonDir = await realpath(identity.common_dir);
  if (commonDir !== journalCommonDir) {
    throw new CliError("Verification repository does not match the journal Git common directory", 73);
  }
  if (commonDir !== receiptCommonDir) {
    throw new CliError("Verification repository does not match the terminal receipt common directory", 73);
  }
  await assertNoSymlinkComponents(
    guardRoot(stateRoot),
    resolve(stateRoot),
    "Verification state root",
  );
  const requestedBranch = target.branch === null
    ? null
    : validateGitBranchName(root, target.branch, "requested verification branch");
  const snapshot = normalizeSnapshot(gitSnapshot(root));
  if (
    snapshot.revision !== target.revision
    || snapshot.branch !== requestedBranch
    || snapshot.cleanliness !== "clean"
  ) {
    throw new CliError("Verification requires the exact clean requested revision and branch", 73);
  }
  return {
    root,
    commonDir,
    requestedRevision: target.revision,
    requestedBranch,
    started: snapshot,
  };
}

export async function resolveNoChangeVerificationSubject({ stateRoot, receipt }) {
  const terminalReceipt = validateTerminalReceiptV4(receipt);
  const identity = identityFromReceipt(terminalReceipt);
  const target = requestedTarget(terminalReceipt, null);
  const { assertTerminalReceiptAuthority } = await import("./dispositions.mjs");
  await assertTerminalReceiptAuthority({ stateRoot, receipt: terminalReceipt });
  const executor = await resolveTaskLaunchExecutorWorktree({
    stateRoot,
    launchId: terminalReceipt.launch_id,
  });
  const context = await canonicalRepositoryContext({
    stateRoot,
    repositoryPath: executor.repository.root,
    target,
    identity,
  });
  return {
    launch_id: terminalReceipt.launch_id,
    executor_thread_id: terminalReceipt.executor_thread_id,
    repository_path: context.root,
    worktree: executor.worktree,
  };
}

function runCheck(root, check) {
  const result = spawnSync(check.argv[0], check.argv.slice(1), {
    cwd: root,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: null,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: check.timeout_ms,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  let exitCode = result.status;
  let stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  if (!Number.isInteger(exitCode)) {
    if (result.error?.code === "ETIMEDOUT") exitCode = 124;
    else if (result.signal) exitCode = 128;
    else exitCode = 127;
    const errorDetail = result.error?.message ? Buffer.from(`\n${result.error.message}`) : Buffer.alloc(0);
    stderr = Buffer.concat([stderr, errorDetail]);
  }
  return {
    ...check,
    exit_code: Math.max(0, Math.min(255, exitCode)),
    stdout_digest: sha256(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "")),
    stderr_digest: sha256(stderr),
  };
}

function validateIndex(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "request_digest", "verification_id"],
  }, "Verification request index");
  if (value.schema_version !== 1 || value.kind !== INDEX_KIND) {
    throw new CliError("Invalid verification request index");
  }
  return {
    schema_version: 1,
    kind: INDEX_KIND,
    request_digest: digest(value.request_digest, "request_digest"),
    verification_id: verificationId(value.verification_id),
  };
}

async function readIndex(stateRoot, requestDigest) {
  const location = paths(stateRoot, { requestDigest });
  const value = await readJson(location.index, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  return value === null ? null : validateIndex(value);
}

async function listVerificationRecords(stateRoot) {
  const location = paths(stateRoot);
  await assertNoSymlinkComponents(
    guardRoot(stateRoot),
    location.records,
    "Verification records path",
  );
  let entries;
  try {
    entries = await readdir(location.records, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".json")) {
      throw new CliError(`Verification journal contains an unsupported entry: ${entry.name}`);
    }
    const id = entry.name.slice(0, -5);
    verificationId(id);
    const record = validateVerificationRecord(await readJson(
      safeChild(location.records, entry.name),
      { guardRoot: guardRoot(stateRoot) },
    ));
    if (record.verification_id !== id) {
      throw new CliError("Verification record filename does not match its content identity");
    }
    records.push(record);
  }
  return records;
}

async function existingForRequest(stateRoot, requestDigest) {
  const index = await readIndex(stateRoot, requestDigest);
  if (index !== null) {
    const record = await readVerificationRecord({
      stateRoot,
      verificationId: index.verification_id,
    });
    if (record.request_digest !== requestDigest) {
      throw new CliError("Verification request index points to different authority", 73);
    }
    return record;
  }
  const matches = (await listVerificationRecords(stateRoot)).filter(
    (record) => record.request_digest === requestDigest,
  );
  if (matches.length > 1) {
    throw new CliError("Verification request has multiple authoritative records", 73);
  }
  if (matches.length === 1) {
    await ensureExactJson(paths(stateRoot, { requestDigest }).index, validateIndex({
      schema_version: 1,
      kind: INDEX_KIND,
      request_digest: requestDigest,
      verification_id: matches[0].verification_id,
    }), { guardRoot: guardRoot(stateRoot) });
    return matches[0];
  }
  return null;
}

export async function runCombinedVerification({
  stateRoot,
  repositoryPath,
  receipt,
  integrationScope = null,
  checks,
  now = Date.now,
}) {
  const terminalReceipt = validateTerminalReceiptV4(receipt);
  const identity = identityFromReceipt(terminalReceipt);
  const scope = validateIntegrationScope(integrationScope, identity);
  const target = requestedTarget(terminalReceipt, scope);
  const definitions = validateCheckDefinitions(checks);
  const context = await canonicalRepositoryContext({
    stateRoot,
    repositoryPath,
    target,
    identity,
  });
  const request = {
    identity,
    integration_scope: scope,
    repository: {
      root: context.root,
      common_dir: context.commonDir,
      requested_revision: context.requestedRevision,
      requested_branch: context.requestedBranch,
    },
    checks: definitions,
  };
  const requestDigest = sha256(stableStringify(request));
  const location = paths(stateRoot, { requestDigest });
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `combined verification ${requestDigest}`,
  }, async () => {
    const existing = await existingForRequest(stateRoot, requestDigest);
    if (existing !== null) return existing;
    const startedAt = timestampFromClock(now, "started_at");
    const evidence = definitions.map((check) => runCheck(context.root, check));
    const completed = normalizeSnapshot(gitSnapshot(context.root));
    const completedAt = timestampFromClock(now, "completed_at");
    const repository = {
      root: context.root,
      common_dir: context.commonDir,
      requested_revision: context.requestedRevision,
      requested_branch: context.requestedBranch,
      started_revision: context.started.revision,
      started_branch: context.started.branch,
      started_cleanliness: context.started.cleanliness,
      completed_revision: completed.revision,
      completed_branch: completed.branch,
      completed_cleanliness: completed.cleanliness,
    };
    const classification = evidence.every((check) => check.exit_code === 0)
      && repositoryIsExact(repository, "completed")
      ? "PASS"
      : "FAIL";
    const base = {
      schema_version: 1,
      kind: VERIFICATION_KIND,
      verification_id: "verification-v1-" + "0".repeat(64),
      request_digest: requestDigest,
      identity,
      integration_scope: scope,
      repository,
      classification,
      checks: evidence,
      started_at: startedAt,
      completed_at: completedAt,
    };
    const record = validateVerificationRecord({
      ...base,
      verification_id: expectedVerificationId(base),
    });
    await ensureExactJson(paths(stateRoot, { id: record.verification_id }).record, record, {
      guardRoot: guardRoot(stateRoot),
      mode: 0o600,
    });
    await ensureExactJson(location.index, validateIndex({
      schema_version: 1,
      kind: INDEX_KIND,
      request_digest: requestDigest,
      verification_id: record.verification_id,
    }), {
      guardRoot: guardRoot(stateRoot),
      mode: 0o600,
    });
    return record;
  });
}

export async function readVerificationRecord({ stateRoot, verificationId: id }) {
  const location = paths(stateRoot, { id });
  const value = await readJson(location.record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (value === null) throw new CliError("Combined verification record does not exist");
  const record = validateVerificationRecord(value);
  if (record.verification_id !== id) {
    throw new CliError("Verification record filename does not match its content identity");
  }
  return record;
}

export async function verificationStatus({
  stateRoot,
  verificationId: id = null,
  runId = null,
} = {}) {
  if (id !== null) {
    const record = await readVerificationRecord({ stateRoot, verificationId: id });
    if (runId !== null && record.identity.run_id !== runId) {
      throw new CliError("Combined verification does not belong to the requested run", 73);
    }
    return {
      total: 1,
      pass: record.classification === "PASS" ? 1 : 0,
      fail: record.classification === "FAIL" ? 1 : 0,
      records: [record],
    };
  }
  const requestedRun = runId === null
    ? null
    : requireText(runId, "run_id", { max: 128, safeId: true });
  const records = (await listVerificationRecords(stateRoot)).filter(
    (record) => requestedRun === null || record.identity.run_id === requestedRun,
  );
  return {
    total: records.length,
    pass: records.filter((record) => record.classification === "PASS").length,
    fail: records.filter((record) => record.classification === "FAIL").length,
    records,
  };
}
