import { spawnSync } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { callbackRecordV06 } from "./callbacks-v06.mjs";
import { taskDispositionStatus } from "./dispositions.mjs";
import {
  discoverGit,
  gitCommonDirectoryForState,
  gitSnapshot,
  validateGitBranchName,
} from "./git.mjs";
import { taskReleaseStatus } from "./release-lifecycle.mjs";
import {
  readVerificationRecord,
  verificationRecordDigest,
} from "./verifications-v06.mjs";

const INTEGRATION_KIND = "codex-flow-v06-serial-integration";
const INTEGRATION_ID = /^integration-v1-[0-9a-f]{64}$/;
const VERIFICATION_ID = /^verification-v1-[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const OUTCOMES = ["ancestor", "patch-equivalent", "unmerged"];
const SAFE_OUTCOMES = new Set(["ancestor", "patch-equivalent"]);
const GIT_TIMEOUT_MS = 30_000;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe integration lifecycle state path");
  }
  return path;
}

function integrationId(value) {
  const result = requireText(value, "integration_id", { max: 128, safeId: true });
  if (!INTEGRATION_ID.test(result)) throw new CliError("integration_id must be a v1 integration ID");
  return result;
}

function paths(stateRoot, id = null) {
  const root = resolve(stateRoot, "integration-lifecycle");
  return {
    records: resolve(root, "records"),
    record: id === null
      ? null
      : safeChild(resolve(root, "records"), `${integrationId(id)}.json`),
    mutationLock: resolve(root, "mutation.lock.json"),
  };
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function commit(value, label) {
  const result = requireText(value, label, { min: 40, max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a full Git commit`);
  return result;
}

function nullableCommit(value, label) {
  return value === null ? null : commit(value, label);
}

function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function nullableVerificationId(value, label = "verification_id") {
  if (value === null) return null;
  const result = requireText(value, label, { max: 128, safeId: true });
  if (!VERIFICATION_ID.test(result)) throw new CliError(`${label} must be a v1 verification ID`);
  return result;
}

function nullableTimestamp(value, label) {
  return value === null ? null : requireText(value, label, { max: 64 });
}

function nullableOutcome(value) {
  return value === null ? null : requireEnum(value, OUTCOMES, "integration outcome");
}

function authority(record) {
  return Object.fromEntries([
    "run_id", "plan_id", "revision_id", "task_id", "task_contract_digest",
    "operation_id", "release_id", "release_record_digest", "callback_id",
    "receipt_digest", "disposition_id", "disposition_record_digest",
    "runtime_digest", "config_digest", "repository_id", "common_dir",
    "main_branch", "executor_branch", "prepared_main_tip", "executor_tip",
  ].map((key) => [key, record[key]]));
}

function expectedIntegrationId(record) {
  return `integration-v1-${sha256(stableStringify(authority(record)))}`;
}

export function integrationRecordDigest(value) {
  const record = validateIntegrationRecordV06(value);
  return sha256(stableStringify(authority(record)));
}

function reconciliationEvidence(record) {
  return {
    integration_id: record.integration_id,
    outcome: record.outcome,
    reconciled_main_tip: record.reconciled_main_tip,
    executor_tip: record.executor_tip,
    verification_id: record.verification_id,
    combined_verification_digest: record.combined_verification_digest,
  };
}

function expectedReconciliationDigest(record) {
  return sha256(stableStringify(reconciliationEvidence(record)));
}

export function validateIntegrationRecordV06(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "integration_id", "run_id", "plan_id",
      "revision_id", "task_id", "task_contract_digest", "operation_id",
      "release_id", "release_record_digest", "callback_id", "receipt_digest",
      "disposition_id", "disposition_record_digest", "runtime_digest",
      "config_digest", "repository_id", "common_dir", "main_branch",
      "executor_branch", "prepared_main_tip", "executor_tip",
      "state", "outcome",
      "reconciled_main_tip", "verification_id", "combined_verification_digest",
      "reconciliation_digest", "prepared_at", "reconciled_at",
    ],
  }, "Serial integration record");
  if (value.schema_version !== 1 || value.kind !== INTEGRATION_KIND) {
    throw new CliError("Invalid v0.6 serial integration record");
  }
  const state = requireEnum(value.state, ["prepared", "reconciled"], "integration state");
  const record = {
    schema_version: 1,
    kind: INTEGRATION_KIND,
    integration_id: integrationId(value.integration_id),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_id: requireText(value.revision_id, "revision_id", { max: 128, safeId: true }),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_contract_digest: digest(value.task_contract_digest, "task_contract_digest"),
    operation_id: requireText(value.operation_id, "operation_id", { max: 128, safeId: true }),
    release_id: requireText(value.release_id, "release_id", { max: 128, safeId: true }),
    release_record_digest: digest(value.release_record_digest, "release_record_digest"),
    callback_id: requireText(value.callback_id, "callback_id", { max: 128, safeId: true }),
    receipt_digest: digest(value.receipt_digest, "receipt_digest"),
    disposition_id: requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true }),
    disposition_record_digest: digest(
      value.disposition_record_digest,
      "disposition_record_digest",
    ),
    runtime_digest: digest(value.runtime_digest, "runtime_digest"),
    config_digest: digest(value.config_digest, "config_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: requireText(value.common_dir, "common_dir", { max: 1024 }),
    main_branch: requireText(value.main_branch, "main_branch", { max: 256 }),
    executor_branch: requireText(value.executor_branch, "executor_branch", { max: 256 }),
    prepared_main_tip: commit(value.prepared_main_tip, "prepared_main_tip"),
    executor_tip: commit(value.executor_tip, "executor_tip"),
    state,
    outcome: nullableOutcome(value.outcome),
    reconciled_main_tip: nullableCommit(value.reconciled_main_tip, "reconciled_main_tip"),
    verification_id: nullableVerificationId(value.verification_id),
    combined_verification_digest: nullableDigest(
      value.combined_verification_digest,
      "combined_verification_digest",
    ),
    reconciliation_digest: nullableDigest(value.reconciliation_digest, "reconciliation_digest"),
    prepared_at: requireText(value.prepared_at, "prepared_at", { max: 64 }),
    reconciled_at: nullableTimestamp(value.reconciled_at, "reconciled_at"),
  };
  if (expectedIntegrationId(record) !== record.integration_id) {
    throw new CliError("Serial integration content identity is invalid");
  }
  const reconciliationFields = [
    record.outcome,
    record.reconciled_main_tip,
    record.verification_id,
    record.combined_verification_digest,
    record.reconciliation_digest,
    record.reconciled_at,
  ];
  if (state === "prepared" && reconciliationFields.some((entry) => entry !== null)) {
    throw new CliError("Prepared integration cannot contain reconciliation evidence");
  }
  if (state === "reconciled") {
    const required = [record.outcome, record.reconciled_main_tip, record.reconciliation_digest, record.reconciled_at];
    if (required.some((entry) => entry === null)) {
      throw new CliError("Reconciled integration requires complete reconciliation evidence");
    }
    const safe = SAFE_OUTCOMES.has(record.outcome);
    if (safe !== (record.verification_id !== null && record.combined_verification_digest !== null)) {
      throw new CliError("Safe integration reconciliation requires authoritative verification evidence");
    }
    if (!safe && (record.verification_id !== null || record.combined_verification_digest !== null)) {
      throw new CliError("Unsafe integration reconciliation cannot claim verification evidence");
    }
  }
  if (
    state === "reconciled"
    && expectedReconciliationDigest(record) !== record.reconciliation_digest
  ) throw new CliError("Serial integration reconciliation digest is invalid");
  return record;
}

function runGit(cwd, args, label, { allowStatus = [] } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (result.status !== 0 && !allowStatus.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return result;
}

function branchTip(cwd, branch, label) {
  const name = validateGitBranchName(cwd, branch, label);
  const result = runGit(
    cwd,
    ["rev-parse", "--verify", `refs/heads/${name}^{commit}`],
    `${label} tip inspection`,
  );
  return commit(result.stdout.trim(), `${label} tip`);
}

function isAncestor(cwd, ancestor, descendant) {
  const result = runGit(
    cwd,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    "Git ancestry inspection",
    { allowStatus: [1] },
  );
  return result.status === 0;
}

function classify(cwd, record, mainTip) {
  if (isAncestor(cwd, record.executor_tip, mainTip)) return "ancestor";
  const executorMerges = runGit(
    cwd,
    ["rev-list", "--merges", `${mainTip}..${record.executor_tip}`],
    "Executor merge inspection",
  ).stdout.trim();
  if (executorMerges !== "") return "unmerged";
  const cherry = runGit(
    cwd,
    ["cherry", mainTip, record.executor_tip],
    "Patch-equivalence inspection",
  ).stdout.trim().split("\n").filter(Boolean);
  return cherry.length > 0 && cherry.every((line) => line.startsWith("- "))
    ? "patch-equivalent"
    : "unmerged";
}

async function canonicalContext(stateRoot, repositoryPath, mainBranch) {
  const repository = discoverGit(repositoryPath);
  const canonicalRoot = await realpath(repository.root);
  const canonicalCommonDir = await realpath(repository.commonDir);
  const canonicalJournalCommonDir = await realpath(guardRoot(stateRoot));
  if (canonicalCommonDir !== canonicalJournalCommonDir) {
    throw new CliError("Integration repository does not match the journal Git common directory");
  }
  const branch = validateGitBranchName(canonicalRoot, mainBranch, "main_branch");
  const snapshot = gitSnapshot(canonicalRoot);
  if (snapshot.branch !== branch || snapshot.cleanliness !== "clean") {
    throw new CliError("Serial integration requires a clean checkout of the exact main branch");
  }
  return { root: canonicalRoot, commonDir: canonicalCommonDir, mainBranch: branch };
}

function identityMatches(left, right, keys) {
  return keys.every((key) => left[key] === right[key]);
}

function releaseRecordDigest(release) {
  const { status: ignored, ...record } = release;
  return sha256(stableStringify(record));
}

function dispositionRecordDigest(disposition) {
  const { unblocks_dependencies: ignored, ...record } = disposition;
  return sha256(stableStringify(record));
}

function assertVerificationIdentity(verification, current, bindings) {
  const identity = verification.identity;
  const receipt = bindings.receipt;
  const expected = {
    callback_id: current.callback_id,
    receipt_digest: current.receipt_digest,
    recipient_binding_digest: receipt.recipient.binding_digest,
    executor_id: receipt.executor_id,
    run_id: current.run_id,
    runtime_digest: current.runtime_digest,
    config_digest: current.config_digest,
    plan_id: current.plan_id,
    revision_id: current.revision_id,
    task_id: current.task_id,
    task_contract_digest: current.task_contract_digest,
    operation_id: current.operation_id,
    release_id: current.release_id,
  };
  if (!identityMatches(identity, expected, Object.keys(expected))) {
    throw new CliError("Combined verification does not match the integration callback authority", 73);
  }
}

function assertIntegrationVerification({ verification, current, bindings, context, mainTip, outcome }) {
  if (verification.classification !== "PASS" || verification.integration_scope === null) {
    throw new CliError("Safe integration requires a PASS integration-scoped verification", 73);
  }
  assertVerificationIdentity(verification, current, bindings);
  const scope = verification.integration_scope;
  const expectedScope = {
    integration_id: current.integration_id,
    integration_record_digest: integrationRecordDigest(current),
    run_id: current.run_id,
    runtime_digest: current.runtime_digest,
    config_digest: current.config_digest,
    plan_id: current.plan_id,
    revision_id: current.revision_id,
    task_id: current.task_id,
    task_contract_digest: current.task_contract_digest,
    main_branch: current.main_branch,
    reconciled_main_tip: mainTip,
    outcome,
  };
  if (!identityMatches(scope, expectedScope, Object.keys(expectedScope))) {
    throw new CliError("Combined verification scope does not match the independently reconciled integration", 73);
  }
  if (
    verification.repository.root !== context.root
    || verification.repository.common_dir !== context.commonDir
    || verification.repository.requested_revision !== mainTip
    || verification.repository.requested_branch !== current.main_branch
    || verification.repository.completed_revision !== mainTip
    || verification.repository.completed_branch !== current.main_branch
    || verification.repository.completed_cleanliness !== "clean"
  ) throw new CliError("Combined verification repository evidence does not match integration state", 73);
}

async function boundAuthority({ stateRoot, dispositionId, commonDir }) {
  const disposition = await taskDispositionStatus({ stateRoot, dispositionId });
  if (disposition.decision !== "accepted-for-integration" || disposition.state !== "prepared") {
    throw new CliError("Serial integration requires a prepared accepted-for-integration disposition", 73);
  }
  const callback = await callbackRecordV06({ stateRoot, callbackId: disposition.callback_id });
  if (!callback || callback.state !== "observed") {
    throw new CliError("Serial integration requires the disposition callback to remain observed", 73);
  }
  const receipt = callback.receipt;
  if (
    !identityMatches(disposition, receipt, [
      "run_id", "plan_id", "revision_id", "task_id", "task_contract_digest",
    ])
    || disposition.callback_id !== callback.callback_id
    || disposition.receipt_digest !== sha256(stableStringify(receipt))
  ) throw new CliError("Integration disposition does not match its terminal callback", 73);
  if (receipt.classification !== "PASS" || receipt.git_outcome.kind !== "clean-commit") {
    throw new CliError("Accepted integration requires a PASS clean-commit receipt", 73);
  }
  const release = await taskReleaseStatus({ stateRoot, releaseId: receipt.release_id });
  if (release.status !== "accepted") {
    throw new CliError("Serial integration requires an accepted task release", 73);
  }
  if (
    !identityMatches(release, receipt, [
      "run_id", "plan_id", "revision_id", "task_id", "task_contract_digest",
      "operation_id", "release_id", "runtime_digest", "config_digest",
    ])
    || release.release_id !== receipt.release_id
    || release.common_dir !== commonDir
  ) throw new CliError("Accepted release does not match the integration receipt", 73);
  return { disposition, callback, receipt, release };
}

async function readRecord(stateRoot, id) {
  const location = paths(stateRoot, id);
  const value = await readJson(location.record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (!value) throw new CliError("Serial integration record does not exist");
  return validateIntegrationRecordV06(value);
}

async function integrationRecords(stateRoot) {
  const location = paths(stateRoot);
  await assertNoSymlinkComponents(
    guardRoot(stateRoot),
    location.records,
    "Integration lifecycle state path",
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
      throw new CliError(`Integration lifecycle journal contains an unsupported entry: ${entry.name}`);
    }
    records.push(validateIntegrationRecordV06(await readJson(
      resolve(location.records, entry.name),
      { guardRoot: guardRoot(stateRoot) },
    )));
  }
  return records;
}

function view(record) {
  return {
    ...record,
    safe_to_finalize: record.state === "reconciled" && SAFE_OUTCOMES.has(record.outcome),
  };
}

export async function prepareSerialIntegration({
  stateRoot,
  repositoryPath,
  dispositionId,
  mainBranch,
  now = Date.now(),
}) {
  const context = await canonicalContext(stateRoot, repositoryPath, mainBranch);
  const bindings = await boundAuthority({
    stateRoot,
    dispositionId,
    commonDir: context.commonDir,
  });
  const executorBranch = validateGitBranchName(
    context.root,
    bindings.receipt.git_outcome.branch,
    "executor_branch",
  );
  const preparedMainTip = branchTip(context.root, context.mainBranch, "main branch");
  const executorTip = branchTip(context.root, executorBranch, "executor branch");
  if (executorTip !== bindings.receipt.git_outcome.commit) {
    throw new CliError("Executor branch tip does not match the terminal receipt", 73);
  }
  if (!isAncestor(context.root, bindings.receipt.git_outcome.baseline_revision, executorTip)) {
    throw new CliError("Executor result no longer descends from its authenticated baseline", 73);
  }
  const timestamp = new Date(now).toISOString();
  const base = {
    schema_version: 1,
    kind: INTEGRATION_KIND,
    integration_id: "pending",
    run_id: bindings.receipt.run_id,
    plan_id: bindings.receipt.plan_id,
    revision_id: bindings.receipt.revision_id,
    task_id: bindings.receipt.task_id,
    task_contract_digest: bindings.receipt.task_contract_digest,
    operation_id: bindings.receipt.operation_id,
    release_id: bindings.receipt.release_id,
    release_record_digest: releaseRecordDigest(bindings.release),
    callback_id: bindings.callback.callback_id,
    receipt_digest: sha256(stableStringify(bindings.receipt)),
    disposition_id: bindings.disposition.disposition_id,
    disposition_record_digest: dispositionRecordDigest(bindings.disposition),
    runtime_digest: bindings.receipt.runtime_digest,
    config_digest: bindings.receipt.config_digest,
    repository_id: bindings.release.repository_id,
    common_dir: context.commonDir,
    main_branch: context.mainBranch,
    executor_branch: executorBranch,
    prepared_main_tip: preparedMainTip,
    executor_tip: executorTip,
    state: "prepared",
    outcome: null,
    reconciled_main_tip: null,
    verification_id: null,
    combined_verification_digest: null,
    reconciliation_digest: null,
    prepared_at: timestamp,
    reconciled_at: null,
  };
  const record = validateIntegrationRecordV06({
    ...base,
    integration_id: expectedIntegrationId(base),
  });
  const location = paths(stateRoot, record.integration_id);
  return withProcessLock({
    path: paths(stateRoot).mutationLock,
    guardRoot: guardRoot(stateRoot),
    label: "serial integration preparation",
  }, async () => {
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing) {
      const validated = validateIntegrationRecordV06(existing);
      if (stableStringify(authority(validated)) !== stableStringify(authority(record))) {
        throw new CliError("Integration identity collides with different prepared authority", 73);
      }
      return view(validated);
    }
    const active = (await integrationRecords(stateRoot)).find((item) => item.state === "prepared");
    if (active) {
      throw new CliError(`Serial integration is already prepared: ${active.integration_id}`, 75);
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    return view(record);
  });
}

export async function integrationVerificationRequest({
  stateRoot,
  repositoryPath,
  integrationId: id,
}) {
  const current = await readRecord(stateRoot, id);
  if (current.state !== "prepared") {
    throw new CliError("Integration verification request requires a prepared integration", 73);
  }
  const context = await canonicalContext(stateRoot, repositoryPath, current.main_branch);
  if (context.commonDir !== current.common_dir) {
    throw new CliError("Integration repository changed from prepared authority", 73);
  }
  const executorTip = branchTip(context.root, current.executor_branch, "executor branch");
  if (executorTip !== current.executor_tip) {
    throw new CliError("Executor branch tip drifted after integration preparation", 73);
  }
  const mainTip = branchTip(context.root, current.main_branch, "main branch");
  if (!isAncestor(context.root, current.prepared_main_tip, mainTip)) {
    throw new CliError("Main branch history drifted from the prepared integration tip", 73);
  }
  const outcome = classify(context.root, current, mainTip);
  if (!SAFE_OUTCOMES.has(outcome)) {
    throw new CliError("Integration is not yet ancestor or patch-equivalent", 73);
  }
  const bindings = await boundAuthority({
    stateRoot,
    dispositionId: current.disposition_id,
    commonDir: context.commonDir,
  });
  return {
    receipt: bindings.receipt,
    integration_scope: {
      integration_id: current.integration_id,
      integration_record_digest: integrationRecordDigest(current),
      run_id: current.run_id,
      runtime_digest: current.runtime_digest,
      config_digest: current.config_digest,
      plan_id: current.plan_id,
      revision_id: current.revision_id,
      task_id: current.task_id,
      task_contract_digest: current.task_contract_digest,
      main_branch: current.main_branch,
      reconciled_main_tip: mainTip,
      outcome,
    },
  };
}

export async function reconcileSerialIntegration({
  stateRoot,
  repositoryPath,
  integrationId: id,
  verificationId = null,
  now = Date.now(),
}) {
  const requestedVerificationId = nullableVerificationId(verificationId);
  return withProcessLock({
    path: paths(stateRoot).mutationLock,
    guardRoot: guardRoot(stateRoot),
    label: "serial integration reconciliation",
  }, async () => {
    const current = await readRecord(stateRoot, id);
    const context = await canonicalContext(stateRoot, repositoryPath, current.main_branch);
    if (context.commonDir !== current.common_dir) {
      throw new CliError("Integration repository changed from prepared authority", 73);
    }
    const executorTip = branchTip(context.root, current.executor_branch, "executor branch");
    if (executorTip !== current.executor_tip) {
      throw new CliError("Executor branch tip drifted after integration preparation", 73);
    }
    const mainTip = branchTip(context.root, current.main_branch, "main branch");
    if (!isAncestor(context.root, current.prepared_main_tip, mainTip)) {
      throw new CliError("Main branch history drifted from the prepared integration tip", 73);
    }
    const outcome = classify(context.root, current, mainTip);
    if (SAFE_OUTCOMES.has(outcome) && requestedVerificationId === null) {
      throw new CliError("Safe integration reconciliation requires a verification_id", 73);
    }
    if (!SAFE_OUTCOMES.has(outcome) && requestedVerificationId !== null) {
      throw new CliError("Unmerged integration cannot claim combined verification", 73);
    }
    if (current.state === "reconciled") {
      if (
        current.reconciled_main_tip !== mainTip
        || current.outcome !== outcome
        || current.verification_id !== requestedVerificationId
      ) throw new CliError("Reconciled integration evidence drifted", 73);
      return view(current);
    }
    const bindings = await boundAuthority({
      stateRoot,
      dispositionId: current.disposition_id,
      commonDir: context.commonDir,
    });
    if (
      bindings.callback.callback_id !== current.callback_id
      || sha256(stableStringify(bindings.receipt)) !== current.receipt_digest
      || releaseRecordDigest(bindings.release) !== current.release_record_digest
      || dispositionRecordDigest(bindings.disposition) !== current.disposition_record_digest
    ) throw new CliError("Integration authority changed after preparation", 73);
    let verificationDigest = null;
    if (requestedVerificationId !== null) {
      const verification = await readVerificationRecord({
        stateRoot,
        verificationId: requestedVerificationId,
      });
      assertIntegrationVerification({
        verification,
        current,
        bindings,
        context,
        mainTip,
        outcome,
      });
      verificationDigest = verificationRecordDigest(verification);
    }
    const reconciled = {
      ...current,
      state: "reconciled",
      outcome,
      reconciled_main_tip: mainTip,
      verification_id: requestedVerificationId,
      combined_verification_digest: verificationDigest,
      reconciliation_digest: "0".repeat(64),
      reconciled_at: new Date(now).toISOString(),
    };
    reconciled.reconciliation_digest = expectedReconciliationDigest(reconciled);
    const validated = validateIntegrationRecordV06(reconciled);
    await atomicWriteJson(paths(stateRoot, id).record, validated, {
      guardRoot: guardRoot(stateRoot),
    });
    return view(validated);
  });
}

export async function serialIntegrationStatus({ stateRoot, integrationId: id }) {
  return view(await readRecord(stateRoot, id));
}
