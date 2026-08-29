import { basename, dirname, resolve } from "node:path";
import {
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
import { assertSafeContent } from "./content-safety.mjs";
import { callbackRecordV06, consumeCallbackV06 } from "./callbacks-v06.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";

const DISPOSITION_KIND = "codex-flow-v06-task-disposition";
const DECISIONS = [
  "accepted-no-change",
  "accepted-for-integration",
  "rejected",
  "retained-blocked",
  "cancelled",
];
const DIGEST = /^[0-9a-f]{64}$/;

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

export function dispositionIdForCallback(callbackId) {
  const callback = requireText(callbackId, "callback_id", { max: 128, safeId: true });
  return `disposition-v1-${sha256(callback)}`;
}

export function validateDispositionRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "disposition_id", "run_id", "plan_id",
      "revision_id", "task_id", "task_contract_digest", "callback_id",
      "receipt_digest", "decision", "reason", "integration_id",
      "verification_digest", "state", "prepared_at", "finalized_at",
      "callback_consumed_at",
    ],
  }, "Task disposition");
  if (value.schema_version !== 1 || value.kind !== DISPOSITION_KIND) {
    throw new CliError("Invalid v0.6 task disposition schema");
  }
  const reason = requireText(value.reason, "disposition reason", { max: 512 });
  assertSafeContent("Task disposition", "reason", reason);
  const record = {
    schema_version: 1,
    kind: DISPOSITION_KIND,
    disposition_id: requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_id: requireText(value.revision_id, "revision_id", { max: 128, safeId: true }),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_contract_digest: digest(value.task_contract_digest, "task_contract_digest"),
    callback_id: nullableSafeId(value.callback_id, "callback_id"),
    receipt_digest: nullableDigest(value.receipt_digest, "receipt_digest"),
    decision: requireEnum(value.decision, DECISIONS, "disposition decision"),
    reason,
    integration_id: nullableSafeId(value.integration_id, "integration_id"),
    verification_digest: nullableDigest(value.verification_digest, "verification_digest"),
    state: requireEnum(value.state, ["prepared", "finalized", "completed"], "disposition state"),
    prepared_at: requireText(value.prepared_at, "prepared_at", { max: 64 }),
    finalized_at: value.finalized_at === null
      ? null
      : requireText(value.finalized_at, "finalized_at", { max: 64 }),
    callback_consumed_at: value.callback_consumed_at === null
      ? null
      : requireText(value.callback_consumed_at, "callback_consumed_at", { max: 64 }),
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
  if ((record.finalized_at !== null) !== ["finalized", "completed"].includes(record.state)) {
    throw new CliError("Disposition finalized_at is inconsistent");
  }
  if ((record.callback_consumed_at !== null) !== (record.state === "completed")) {
    throw new CliError("Disposition callback consumption is inconsistent");
  }
  if (record.state === "prepared" && (record.integration_id || record.verification_digest)) {
    throw new CliError("Prepared disposition cannot contain final evidence");
  }
  if (record.decision === "accepted-for-integration" && ["finalized", "completed"].includes(record.state)) {
    if (record.integration_id === null || record.verification_digest === null) {
      throw new CliError("Accepted integration disposition requires integration and verification evidence");
    }
  }
  if (record.decision === "accepted-no-change" && ["finalized", "completed"].includes(record.state)) {
    if (record.integration_id !== null || record.verification_digest === null) {
      throw new CliError("Accepted no-change disposition requires verification without integration");
    }
  }
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
    "disposition_id", "run_id", "plan_id", "revision_id", "task_id",
    "task_contract_digest", "callback_id", "receipt_digest", "decision", "reason",
  ].map((key) => [key, record[key]]));
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
  const callback = await callbackRecordV06({ stateRoot, callbackId });
  if (callback.state !== "observed") {
    throw new CliError("Task disposition requires an observed callback", 73);
  }
  assertDecisionMatchesReceipt(decision, callback.receipt);
  const dispositionId = dispositionIdForCallback(callback.callback_id);
  const timestamp = new Date(now).toISOString();
  const record = validateDispositionRecord({
    schema_version: 1,
    kind: DISPOSITION_KIND,
    disposition_id: dispositionId,
    run_id: callback.receipt.run_id,
    plan_id: callback.receipt.plan_id,
    revision_id: callback.receipt.revision_id,
    task_id: callback.receipt.task_id,
    task_contract_digest: callback.receipt.task_contract_digest,
    callback_id: callback.callback_id,
    receipt_digest: sha256(stableStringify(callback.receipt)),
    decision,
    reason,
    integration_id: null,
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

export async function finalizeTaskDisposition({
  stateRoot,
  dispositionId,
  recipient,
  executorId,
  integrationId = null,
  verificationDigest = null,
  now = Date.now(),
}) {
  const location = paths(stateRoot, dispositionId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `disposition ${dispositionId}`,
  }, async () => {
    let current = (await readDisposition(stateRoot, dispositionId)).record;
    if (current.state === "prepared") {
      const timestamp = new Date(now).toISOString();
      current = validateDispositionRecord({
        ...current,
        integration_id: integrationId,
        verification_digest: verificationDigest,
        state: "finalized",
        finalized_at: timestamp,
      });
      await atomicWriteJson(location.record, current, { guardRoot: guardRoot(stateRoot) });
    } else if (
      current.integration_id !== integrationId
      || current.verification_digest !== verificationDigest
    ) {
      throw new CliError("Disposition was finalized with different evidence", 73);
    }
    if (current.state === "completed") return current;
    await consumeCallbackV06({
      stateRoot,
      callbackId: current.callback_id,
      recipient,
      executorId,
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
