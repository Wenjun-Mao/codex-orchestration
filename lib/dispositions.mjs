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
import { assertSafeContent } from "./content-safety.mjs";
import { callbackRecordV07, consumeCallbackV07 } from "./callbacks-v07.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { visibleTaskCreationStatus } from "./task-creation-v07.mjs";
import {
  readVerificationRecord,
  verificationRecordDigest,
} from "./verifications-v07.mjs";
import { taskReleaseStatus } from "./release-lifecycle.mjs";
import { coordinatorBindingDigest } from "./workflow-plan.mjs";

const DISPOSITION_KIND = "codex-flow-v07-task-disposition";
const DECISIONS = [
  "accepted-no-change",
  "accepted-for-integration",
  "rejected",
  "retained-blocked",
  "cancelled",
];
const DIGEST = /^[0-9a-f]{64}$/;
const VERIFICATION_ID = /^verification-v1-[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const CANONICAL_IDENTITY_KEYS = [
  "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
  "common_dir", "coordinator_binding", "plan_id", "revision_digest", "task_id",
  "task_digest", "contract_id", "operation_id", "release_id", "executor_thread_id",
];

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe disposition state path");
  }
  return path;
}

function paths(stateRoot, dispositionId) {
  requireText(dispositionId, "disposition_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "dispositions");
  return {
    record: safeChild(resolve(root, "records"), `${dispositionId}.json`),
    lock: safeChild(resolve(root, "locks"), `${dispositionId}.lock.json`),
  };
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function nullableSafeId(value, label) {
  return value === null ? null : requireText(value, label, { max: 128, safeId: true });
}

function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function absolutePath(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!isAbsolute(result)) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
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

function nullableVerificationId(value, label = "verification_id") {
  if (value === null) return null;
  const result = requireText(value, label, { max: 128, safeId: true });
  if (!VERIFICATION_ID.test(result)) throw new CliError(`${label} must be a v1 verification ID`);
  return result;
}

export function dispositionIdForCallback(callbackId) {
  const callback = requireText(callbackId, "callback_id", { max: 128, safeId: true });
  return `disposition-v1-${sha256(callback)}`;
}

export function cancellationDispositionIdForRelease(releaseId) {
  const release = requireText(releaseId, "release_id", { max: 128, safeId: true });
  return `disposition-cancel-v1-${sha256(release)}`;
}

export function validateDispositionRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "disposition_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "contract_id", "operation_id", "release_id", "executor_thread_id",
      "callback_id", "receipt_digest", "decision", "reason", "integration_id",
      "verification_id", "verification_digest", "state", "prepared_at", "finalized_at",
      "callback_consumed_at",
    ],
  }, "Task disposition");
  if (value.schema_version !== 1 || value.kind !== DISPOSITION_KIND) {
    throw new CliError("Invalid v0.7 task disposition schema");
  }
  const reason = requireText(value.reason, "disposition reason", { max: 512 });
  assertSafeContent("Task disposition", "reason", reason);
  const record = {
    schema_version: 1,
    kind: DISPOSITION_KIND,
    disposition_id: requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true }),
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
    callback_id: nullableSafeId(value.callback_id, "callback_id"),
    receipt_digest: nullableDigest(value.receipt_digest, "receipt_digest"),
    decision: requireEnum(value.decision, DECISIONS, "disposition decision"),
    reason,
    integration_id: nullableSafeId(value.integration_id, "integration_id"),
    verification_id: nullableVerificationId(value.verification_id),
    verification_digest: nullableDigest(value.verification_digest, "verification_digest"),
    state: requireEnum(value.state, ["prepared", "finalized", "completed"], "disposition state"),
    prepared_at: timestamp(value.prepared_at, "prepared_at"),
    finalized_at: value.finalized_at === null
      ? null
      : timestamp(value.finalized_at, "finalized_at"),
    callback_consumed_at: value.callback_consumed_at === null
      ? null
      : timestamp(value.callback_consumed_at, "callback_consumed_at"),
  };
  if ((record.callback_id === null) !== (record.receipt_digest === null)) {
    throw new CliError("Disposition callback and receipt digest must be present together");
  }
  if (record.decision === "cancelled" && record.callback_id !== null) {
    throw new CliError("Cancelled disposition cannot bind a terminal callback");
  }
  if (record.decision !== "cancelled" && record.callback_id === null) {
    throw new CliError("Terminal disposition requires a callback");
  }
  const expectedDispositionId = record.decision === "cancelled"
    ? cancellationDispositionIdForRelease(record.release_id)
    : dispositionIdForCallback(record.callback_id);
  if (record.disposition_id !== expectedDispositionId) {
    throw new CliError("disposition_id does not match its terminal authority");
  }
  if ((record.finalized_at !== null) !== ["finalized", "completed"].includes(record.state)) {
    throw new CliError("Disposition finalized_at is inconsistent");
  }
  if (record.decision === "cancelled") {
    if (record.state !== "completed" || record.finalized_at === null || record.callback_consumed_at !== null) {
      throw new CliError("Cancelled disposition must complete without callback consumption");
    }
  } else if ((record.callback_consumed_at !== null) !== (record.state === "completed")) {
    throw new CliError("Disposition callback consumption is inconsistent");
  }
  if (
    record.finalized_at !== null
    && Date.parse(record.finalized_at) < Date.parse(record.prepared_at)
  ) throw new CliError("Disposition finalization predates preparation");
  if (
    record.callback_consumed_at !== null
    && Date.parse(record.callback_consumed_at) < Date.parse(record.finalized_at)
  ) throw new CliError("Disposition callback consumption predates finalization");
  if (record.state === "prepared" && (
    record.integration_id || record.verification_id || record.verification_digest
  )) {
    throw new CliError("Prepared disposition cannot contain final evidence");
  }
  if (record.decision === "accepted-for-integration" && ["finalized", "completed"].includes(record.state)) {
    if (
      record.integration_id === null
      || record.verification_id === null
      || record.verification_digest === null
    ) {
      throw new CliError("Accepted integration disposition requires integration and verification evidence");
    }
  }
  if (record.decision === "accepted-no-change" && ["finalized", "completed"].includes(record.state)) {
    if (
      record.integration_id !== null
      || record.verification_id === null
      || record.verification_digest === null
    ) {
      throw new CliError("Accepted no-change disposition requires verification without integration");
    }
  }
  if (
    !["accepted-no-change", "accepted-for-integration"].includes(record.decision)
    && (record.integration_id !== null || record.verification_id !== null || record.verification_digest !== null)
  ) throw new CliError("Nonaccepted disposition cannot claim integration or verification evidence");
  return record;
}

function assertDecisionMatchesReceipt(decision, receipt) {
  const kind = receipt.git_outcome.kind;
  if (decision === "accepted-no-change" && !(receipt.classification === "PASS" && kind === "unchanged")) {
    throw new CliError("accepted-no-change requires a PASS unchanged receipt");
  }
  if (decision === "accepted-for-integration" && !(receipt.classification === "PASS" && kind === "clean-commit")) {
    throw new CliError("accepted-for-integration requires a PASS clean-commit receipt");
  }
  if (decision === "retained-blocked" && receipt.classification === "PASS" && kind !== "dirty-blocked") {
    throw new CliError("retained-blocked requires blocked, failed, or dirty evidence");
  }
}

function immutable(record) {
  return Object.fromEntries([
    "disposition_id", ...CANONICAL_IDENTITY_KEYS,
    "callback_id", "receipt_digest", "decision", "reason",
  ].map((key) => [key, record[key]]));
}

function modelSelector(value) {
  return {
    model: value.model,
    reasoning_effort: value.reasoning_effort,
  };
}

function observedModelSelector(value) {
  if (value === null) return null;
  if (value.model === null && value.reasoning_effort === null) return null;
  if (value.model === null || value.reasoning_effort === null) {
    throw new CliError("Partial host-observed model evidence cannot be represented by a terminal receipt", 73);
  }
  return modelSelector(value);
}

function canonicalIdentityFromReceipt(receipt) {
  return {
    run_id: receipt.run_id,
    runtime_context_digest: receipt.runtime_context_digest,
    configuration_digest: receipt.configuration_digest,
    repository_id: receipt.repository_id,
    common_dir: receipt.common_dir,
    coordinator_binding: receipt.recipient,
    plan_id: receipt.plan_id,
    revision_digest: receipt.revision_digest,
    task_id: receipt.task_id,
    task_digest: receipt.task_digest,
    contract_id: receipt.contract_id,
    operation_id: receipt.operation_id,
    release_id: receipt.release_id,
    executor_thread_id: receipt.executor_thread_id,
  };
}

function assertCanonicalIdentityMatches(value, expected, label) {
  for (const key of CANONICAL_IDENTITY_KEYS) {
    if (stableStringify(value[key]) !== stableStringify(expected[key])) {
      throw new CliError(`${label} ${key} does not match the terminal receipt`, 73);
    }
  }
}

export async function assertTerminalReceiptAuthority({ stateRoot, receipt }) {
  const release = await taskReleaseStatus({ stateRoot, releaseId: receipt.release_id });
  if (release.status !== "accepted" || release.acceptance === null) {
    throw new CliError("Terminal receipt requires an accepted canonical release", 73);
  }
  const expected = canonicalIdentityFromReceipt(receipt);
  assertCanonicalIdentityMatches({
    run_id: release.run_id,
    runtime_context_digest: release.runtime_context_digest,
    configuration_digest: release.configuration_digest,
    repository_id: release.repository_id,
    common_dir: release.common_dir,
    coordinator_binding: release.coordinator_binding,
    plan_id: release.plan_id,
    revision_digest: release.revision_digest,
    task_id: release.task_id,
    task_digest: release.task_digest,
    contract_id: release.contract_id,
    operation_id: release.operation_id,
    release_id: release.release_id,
    executor_thread_id: release.ready_thread_id,
  }, expected, "Accepted release");
  if (
    release.acceptance.ready_thread_id !== receipt.executor_thread_id
    || release.acceptance.contract_id !== receipt.contract_id
    || release.acceptance.runtime_context_digest !== receipt.runtime_context_digest
    || release.acceptance.common_dir !== receipt.common_dir
  ) throw new CliError("Accepted release echo does not match the terminal receipt", 73);

  const creation = await visibleTaskCreationStatus({
    stateRoot,
    operationId: receipt.operation_id,
  });
  if (
    creation.status !== "ready-unreleased"
    || creation.ready === null
    || creation.ready.thread_id !== receipt.executor_thread_id
  ) throw new CliError("Terminal receipt requires the exact ready visible-task operation", 73);
  assertCanonicalIdentityMatches({
    run_id: creation.run_id,
    runtime_context_digest: creation.runtime_context_digest,
    configuration_digest: creation.configuration_digest,
    repository_id: creation.repository_id,
    common_dir: creation.common_dir,
    coordinator_binding: creation.coordinator_binding,
    plan_id: creation.plan_id,
    revision_digest: creation.revision_digest,
    task_id: creation.task_id,
    task_digest: creation.task_digest,
    contract_id: creation.contract_id,
    operation_id: creation.operation_id,
    release_id: receipt.release_id,
    executor_thread_id: creation.ready.thread_id,
  }, expected, "Ready task creation");

  const baseline = release.task_contract.current_baseline.revision;
  if (
    creation.selector_evidence.requested.worktree.starting_revision !== baseline
    || receipt.git_outcome.baseline_revision !== baseline
  ) throw new CliError("Terminal Git baseline does not match the ready task starting revision", 73);
  const requestedWorktree = creation.selector_evidence.requested.worktree;
  if (
    requestedWorktree.mode === "host-worktree"
    && receipt.git_outcome.branch !== requestedWorktree.executor_branch
  ) {
    throw new CliError("Terminal Git branch does not match the ready task executor branch", 73);
  }

  const expectedModelEvidence = {
    configured: modelSelector(release.task_contract.task),
    requested: modelSelector(creation.selector_evidence.requested),
    accepted: modelSelector(creation.selector_evidence.accepted),
    observed: observedModelSelector(creation.selector_evidence.observed),
  };
  if (stableStringify(receipt.model_evidence) !== stableStringify(expectedModelEvidence)) {
    throw new CliError("Terminal model evidence does not match the visible-task selector evidence", 73);
  }
  return { release, creation, identity: expected };
}

async function readDisposition(stateRoot, dispositionId) {
  const location = paths(stateRoot, dispositionId);
  const raw = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (!raw) throw new CliError("Task disposition does not exist");
  return { location, record: validateDispositionRecord(raw) };
}

export async function prepareTaskDisposition({
  stateRoot,
  callbackId,
  decision,
  reason,
  now = Date.now(),
}) {
  requireEnum(decision, DECISIONS.filter((entry) => entry !== "cancelled"), "disposition decision");
  const callback = await callbackRecordV07({ stateRoot, callbackId });
  if (callback.state !== "observed") {
    throw new CliError("Task disposition requires an observed callback", 73);
  }
  const authority = await assertTerminalReceiptAuthority({ stateRoot, receipt: callback.receipt });
  assertDecisionMatchesReceipt(decision, callback.receipt);
  const dispositionId = dispositionIdForCallback(callback.callback_id);
  const timestamp = new Date(now).toISOString();
  const record = validateDispositionRecord({
    schema_version: 1,
    kind: DISPOSITION_KIND,
    disposition_id: dispositionId,
    ...authority.identity,
    callback_id: callback.callback_id,
    receipt_digest: sha256(stableStringify(callback.receipt)),
    decision,
    reason,
    integration_id: null,
    verification_id: null,
    verification_digest: null,
    state: "prepared",
    prepared_at: timestamp,
    finalized_at: null,
    callback_consumed_at: null,
  });
  const location = paths(stateRoot, dispositionId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `disposition ${dispositionId}`,
  }, async () => {
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing) {
      const validated = validateDispositionRecord(existing);
      if (stableStringify(immutable(validated)) !== stableStringify(immutable(record))) {
        throw new CliError("Callback already has a different coordinator disposition", 73);
      }
      return validated;
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    return record;
  });
}

export async function cancelTaskBeforeExecution({
  stateRoot,
  releaseId,
  reason,
  now = Date.now(),
}) {
  const release = await taskReleaseStatus({ stateRoot, releaseId });
  if (
    release.acceptance !== null
    || release.delivery?.outcome !== "rejected-before-send"
  ) {
    throw new CliError(
      "Cancellation requires a release durably rejected before any objective send",
      73,
    );
  }
  const creation = await visibleTaskCreationStatus({
    stateRoot,
    operationId: release.operation_id,
  });
  if (
    creation.status !== "ready-unreleased"
    || creation.ready?.thread_id !== release.ready_thread_id
    || creation.contract_id !== release.contract_id
  ) throw new CliError("Cancellation requires the exact retained ready task", 73);
  const timestamp = new Date(now).toISOString();
  const dispositionId = cancellationDispositionIdForRelease(release.release_id);
  const record = validateDispositionRecord({
    schema_version: 1,
    kind: DISPOSITION_KIND,
    disposition_id: dispositionId,
    run_id: release.run_id,
    runtime_context_digest: release.runtime_context_digest,
    configuration_digest: release.configuration_digest,
    repository_id: release.repository_id,
    common_dir: release.common_dir,
    coordinator_binding: release.coordinator_binding,
    plan_id: release.plan_id,
    revision_digest: release.revision_digest,
    task_id: release.task_id,
    task_digest: release.task_digest,
    contract_id: release.contract_id,
    operation_id: release.operation_id,
    release_id: release.release_id,
    executor_thread_id: release.ready_thread_id,
    callback_id: null,
    receipt_digest: null,
    decision: "cancelled",
    reason,
    integration_id: null,
    verification_id: null,
    verification_digest: null,
    state: "completed",
    prepared_at: timestamp,
    finalized_at: timestamp,
    callback_consumed_at: null,
  });
  const location = paths(stateRoot, dispositionId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `disposition ${dispositionId}`,
  }, async () => {
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing) {
      const current = validateDispositionRecord(existing);
      if (stableStringify(immutable(current)) !== stableStringify(immutable(record))) {
        throw new CliError("Release already has a different cancellation disposition", 73);
      }
      return current;
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    return record;
  });
}

function assertVerificationIdentity(verification, callback) {
  const receipt = callback.receipt;
  const expected = {
    callback_id: callback.callback_id,
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
    operation_id: receipt.operation_id,
    release_id: receipt.release_id,
  };
  if (Object.keys(expected).some((key) => verification.identity[key] !== expected[key])) {
    throw new CliError("Combined verification does not match the disposition callback", 73);
  }
}

async function authoritativeFinalEvidence({
  stateRoot,
  current,
  integrationId,
  verificationId,
}) {
  const accepted = ["accepted-no-change", "accepted-for-integration"].includes(current.decision);
  let callback = null;
  if (current.callback_id !== null) {
    callback = await callbackRecordV07({ stateRoot, callbackId: current.callback_id });
    if (!callback || !["observed", "consumed"].includes(callback.state)) {
      throw new CliError("Disposition proof requires its authoritative callback", 73);
    }
    if (
      callback.callback_id !== current.callback_id
      || sha256(stableStringify(callback.receipt)) !== current.receipt_digest
    ) throw new CliError("Disposition callback authority changed", 73);
    assertCanonicalIdentityMatches(
      current,
      canonicalIdentityFromReceipt(callback.receipt),
      "Disposition",
    );
    await assertTerminalReceiptAuthority({ stateRoot, receipt: callback.receipt });
  }
  if (!accepted) {
    if (integrationId !== null || verificationId !== null) {
      throw new CliError("Nonaccepted disposition cannot claim proof records", 73);
    }
    return { integrationId: null, verificationId: null, verificationDigest: null };
  }
  const requestedVerificationId = nullableVerificationId(verificationId);
  if (requestedVerificationId === null) {
    throw new CliError("Accepted disposition requires a verification_id", 73);
  }
  const verification = await readVerificationRecord({
    stateRoot,
    verificationId: requestedVerificationId,
  });
  if (verification.classification !== "PASS") {
    throw new CliError("Accepted disposition requires PASS combined verification", 73);
  }
  assertVerificationIdentity(verification, callback);
  const receipt = callback.receipt;
  if (receipt.common_dir !== verification.repository.common_dir) {
    throw new CliError("Disposition proof does not match the terminal repository authority", 73);
  }
  const resolvedVerificationDigest = verificationRecordDigest(verification);

  if (current.decision === "accepted-no-change") {
    if (integrationId !== null || verification.integration_scope !== null) {
      throw new CliError("Accepted no-change disposition cannot use integration-scoped proof", 73);
    }
    const outcome = callback.receipt.git_outcome;
    if (
      outcome.kind !== "unchanged"
      || verification.repository.requested_revision !== outcome.final_revision
      || verification.repository.requested_branch !== outcome.branch
      || verification.repository.completed_revision !== outcome.final_revision
      || verification.repository.completed_branch !== outcome.branch
      || verification.repository.completed_cleanliness !== "clean"
    ) throw new CliError("No-change verification does not prove the terminal Git outcome", 73);
    return {
      integrationId: null,
      verificationId: requestedVerificationId,
      verificationDigest: resolvedVerificationDigest,
    };
  }

  const requestedIntegrationId = nullableSafeId(integrationId, "integration_id");
  if (requestedIntegrationId === null) {
    throw new CliError("Accepted integration disposition requires an integration_id", 73);
  }
  const { serialIntegrationStatus } = await import("./integration-v07.mjs");
  const integration = await serialIntegrationStatus({
    stateRoot,
    integrationId: requestedIntegrationId,
  });
  assertCanonicalIdentityMatches(integration, current, "Integration");
  if (
    integration.state !== "reconciled"
    || integration.safe_to_finalize !== true
    || integration.disposition_id !== current.disposition_id
    || integration.callback_id !== current.callback_id
    || integration.receipt_digest !== current.receipt_digest
    || integration.verification_id !== requestedVerificationId
    || integration.combined_verification_digest !== resolvedVerificationDigest
  ) throw new CliError("Disposition requires exact safe reconciled integration evidence", 73);
  return {
    integrationId: requestedIntegrationId,
    verificationId: requestedVerificationId,
    verificationDigest: resolvedVerificationDigest,
  };
}

export async function finalizeTaskDisposition({
  stateRoot,
  dispositionId,
  recipient,
  executorThreadId,
  integrationId = null,
  verificationId = null,
  now = Date.now(),
}) {
  const location = paths(stateRoot, dispositionId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `disposition ${dispositionId}`,
  }, async () => {
    let current = (await readDisposition(stateRoot, dispositionId)).record;
    const evidence = await authoritativeFinalEvidence({
      stateRoot,
      current,
      integrationId,
      verificationId,
    });
    if (current.state === "prepared") {
      const timestamp = new Date(now).toISOString();
      current = validateDispositionRecord({
        ...current,
        integration_id: evidence.integrationId,
        verification_id: evidence.verificationId,
        verification_digest: evidence.verificationDigest,
        state: "finalized",
        finalized_at: timestamp,
      });
      await atomicWriteJson(location.record, current, { guardRoot: guardRoot(stateRoot) });
    } else if (
      current.integration_id !== evidence.integrationId
      || current.verification_id !== evidence.verificationId
      || current.verification_digest !== evidence.verificationDigest
    ) {
      throw new CliError("Disposition was finalized with different evidence", 73);
    }
    if (current.state === "completed") return current;
    await consumeCallbackV07({
      stateRoot,
      callbackId: current.callback_id,
      recipient,
      executorThreadId,
      dispositionId: current.disposition_id,
      now,
    });
    current = validateDispositionRecord({
      ...current,
      state: "completed",
      callback_consumed_at: new Date(now).toISOString(),
    });
    await atomicWriteJson(location.record, current, { guardRoot: guardRoot(stateRoot) });
    return current;
  });
}

export async function taskDispositionStatus({ stateRoot, dispositionId }) {
  const record = (await readDisposition(stateRoot, dispositionId)).record;
  return {
    ...record,
    unblocks_dependencies: record.state === "completed"
      && ["accepted-no-change", "accepted-for-integration"].includes(record.decision),
  };
}
