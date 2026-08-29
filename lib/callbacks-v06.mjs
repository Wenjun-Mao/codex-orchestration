import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  readJson,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { resolveRecipient, withRecipientBindingLock } from "./recipients.mjs";
import { terminalCallbackIdForV3, validateTerminalReceiptV3 } from "./task-results.mjs";

const CALLBACK_KIND = "codex-flow-v06-terminal-callback";
const CALLBACK_ID = /^terminal-v3-[0-9a-f]{64}$/;
const STATES = ["persisted", "observed", "consumed"];
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe callback state path");
  }
  return path;
}

function callbackId(value) {
  const result = requireText(value, "callback_id", { max: 128, safeId: true });
  if (!CALLBACK_ID.test(result)) throw new CliError("callback_id must be a v3 callback ID");
  return result;
}

function paths(stateRoot, id) {
  const callback = callbackId(id);
  const root = resolve(stateRoot, "callbacks");
  return {
    record: safeChild(resolve(root, "journal"), `${callback}.json`),
    lock: safeChild(resolve(root, "locks"), `${callback}.lock.json`),
  };
}

function validateRecipient(value, label) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation"],
  }, label);
  return {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 128, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1 }),
  };
}

function nullableRecipient(value, label) {
  return value === null ? null : validateRecipient(value, label);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit timestamp`);
  }
  return result;
}

function validateLifecycle(value) {
  requireExactFields(value, {
    required: ["persisted_at", "observed_at", "consumed_at"],
  }, "Callback lifecycle");
  return {
    persisted_at: timestamp(value.persisted_at, "lifecycle.persisted_at"),
    observed_at: value.observed_at === null
      ? null
      : timestamp(value.observed_at, "lifecycle.observed_at"),
    consumed_at: value.consumed_at === null
      ? null
      : timestamp(value.consumed_at, "lifecycle.consumed_at"),
  };
}

export function validateCallbackRecordV06(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "callback_id", "receipt", "delivery_recipient",
      "state", "observed_by", "consumed_by", "disposition_id", "lifecycle",
    ],
  }, "Terminal callback record");
  if (value.schema_version !== 1 || value.kind !== CALLBACK_KIND) {
    throw new CliError("Invalid v0.6 terminal callback record");
  }
  const receipt = validateTerminalReceiptV3(value.receipt);
  const id = callbackId(value.callback_id);
  if (terminalCallbackIdForV3(receipt) !== id) throw new CliError("Terminal callback identity is invalid");
  const deliveryRecipient = validateRecipient(value.delivery_recipient, "delivery_recipient");
  if (deliveryRecipient.lineage_id !== receipt.recipient.lineage_id) {
    throw new CliError("Callback delivery lineage does not match its receipt");
  }
  const state = requireText(value.state, "callback state", { max: 32, safeId: true });
  if (!STATES.includes(state)) throw new CliError("Callback state is invalid");
  const observedBy = nullableRecipient(value.observed_by, "observed_by");
  const consumedBy = nullableRecipient(value.consumed_by, "consumed_by");
  const dispositionId = value.disposition_id === null
    ? null
    : requireText(value.disposition_id, "disposition_id", { max: 128, safeId: true });
  const lifecycle = validateLifecycle(value.lifecycle);
  if ((observedBy !== null) !== ["observed", "consumed"].includes(state)) {
    throw new CliError("Callback observation state is inconsistent");
  }
  if ((consumedBy !== null) !== (state === "consumed")) {
    throw new CliError("Callback consumption state is inconsistent");
  }
  if ((dispositionId !== null) !== (state === "consumed")) {
    throw new CliError("Callback consumption requires a disposition");
  }
  if ((lifecycle.observed_at !== null) !== ["observed", "consumed"].includes(state)) {
    throw new CliError("Callback observed_at is inconsistent");
  }
  if ((lifecycle.consumed_at !== null) !== (state === "consumed")) {
    throw new CliError("Callback consumed_at is inconsistent");
  }
  return {
    schema_version: 1,
    kind: CALLBACK_KIND,
    callback_id: id,
    receipt,
    delivery_recipient: deliveryRecipient,
    state,
    observed_by: observedBy,
    consumed_by: consumedBy,
    disposition_id: dispositionId,
    lifecycle,
  };
}

async function readRecord(stateRoot, id, { allowMissing = false } = {}) {
  const location = paths(stateRoot, id);
  const value = await readJson(location.record, { allowMissing, guardRoot: guardRoot(stateRoot) });
  return value === null ? null : validateCallbackRecordV06(value);
}

async function writeRecord(stateRoot, record) {
  const validated = validateCallbackRecordV06(record);
  await atomicWriteJson(paths(stateRoot, validated.callback_id).record, validated, {
    guardRoot: guardRoot(stateRoot),
    mode: 0o600,
  });
  return validated;
}

async function withCallbackLock(stateRoot, id, operation) {
  const initial = await readRecord(stateRoot, id, { allowMissing: true });
  if (!initial) throw new CliError("Terminal callback record does not exist");
  const location = paths(stateRoot, id);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `terminal callback ${id}`,
  }, async () => {
    const record = await readRecord(stateRoot, id, { allowMissing: true });
    if (!record) throw new CliError("Terminal callback record does not exist");
    return operation(record);
  });
}

function requestedConsumer(receipt, recipient) {
  const requested = validateRecipient(recipient, "consumer recipient");
  if (requested.lineage_id !== receipt.recipient.lineage_id) {
    throw new CliError("Consumer lineage does not match the callback", 73);
  }
  return requested;
}

async function assertPersistedDispositionAuthority({ stateRoot, dispositionId, record }) {
  const dispositionPath = safeChild(
    resolve(stateRoot, "dispositions", "records"),
    `${requireText(dispositionId, "disposition_id", { max: 128, safeId: true })}.json`,
  );
  const rawDisposition = await readJson(dispositionPath, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (!rawDisposition) {
    throw new CliError("Callback consumption requires an authoritative persisted disposition", 73);
  }
  // Dispositions consume callbacks, so importing the canonical validator lazily
  // avoids a static module cycle while keeping one authority for disposition
  // identity, state, timestamps, and decision-specific proof requirements.
  const { validateDispositionRecord } = await import("./dispositions.mjs");
  const disposition = validateDispositionRecord(rawDisposition);
  if (
    disposition.schema_version !== 1
    || disposition.kind !== "codex-flow-v06-task-disposition"
    || disposition.disposition_id !== dispositionId
    || disposition.callback_id !== record.callback_id
    || disposition.receipt_digest !== sha256(stableStringify(record.receipt))
    || disposition.run_id !== record.receipt.run_id
    || disposition.runtime_context_digest !== record.receipt.runtime_context_digest
    || disposition.configuration_digest !== record.receipt.configuration_digest
    || disposition.repository_id !== record.receipt.repository_id
    || disposition.common_dir !== record.receipt.common_dir
    || stableStringify(disposition.coordinator_binding) !== stableStringify(record.receipt.recipient)
    || disposition.plan_id !== record.receipt.plan_id
    || disposition.revision_digest !== record.receipt.revision_digest
    || disposition.task_id !== record.receipt.task_id
    || disposition.task_digest !== record.receipt.task_digest
    || disposition.contract_id !== record.receipt.contract_id
    || disposition.operation_id !== record.receipt.operation_id
    || disposition.release_id !== record.receipt.release_id
    || disposition.executor_thread_id !== record.receipt.executor_thread_id
    || !["finalized", "completed"].includes(disposition.state)
    || disposition.finalized_at === null
  ) {
    throw new CliError("Persisted disposition does not authorize this callback consumption", 73);
  }
}

export async function deliverCallbackV06({ stateRoot, receipt, expectedRunId = null, now = Date.now() }) {
  const payload = validateTerminalReceiptV3(receipt);
  if (expectedRunId !== null && payload.run_id !== expectedRunId) {
    throw new CliError("Terminal callback run_id does not match the active run", 73);
  }
  const id = terminalCallbackIdForV3(payload);
  const resolved = await resolveRecipient({
    stateRoot,
    recipient: {
      lineage_id: payload.recipient.lineage_id,
      thread_id: payload.recipient.thread_id,
      generation: payload.recipient.generation,
    },
  });
  return withProcessLock({
    path: paths(stateRoot, id).lock,
    guardRoot: guardRoot(stateRoot),
    label: `terminal callback ${id}`,
  }, async () => {
    const existing = await readRecord(stateRoot, id, { allowMissing: true });
    if (existing) {
      if (stableStringify(existing.receipt) !== stableStringify(payload)) {
        throw new CliError("Changed terminal receipt collides with immutable callback identity", 73);
      }
      return {
        status: existing.state === "persisted" ? "already-persisted" : `already-${existing.state}`,
        callback_id: id,
        recipient: existing.delivery_recipient,
        authority: "journal-monitor",
      };
    }
    const timestamp = new Date(now).toISOString();
    const record = await writeRecord(stateRoot, {
      schema_version: 1,
      kind: CALLBACK_KIND,
      callback_id: id,
      receipt: payload,
      delivery_recipient: resolved.recipient,
      state: "persisted",
      observed_by: null,
      consumed_by: null,
      disposition_id: null,
      lifecycle: {
        persisted_at: timestamp,
        observed_at: null,
        consumed_at: null,
      },
    });
    return {
      status: "persisted",
      callback_id: record.callback_id,
      recipient: record.delivery_recipient,
      authority: "journal-monitor",
    };
  });
}

export async function observeCallbackV06({ stateRoot, callbackId: id, recipient, now = Date.now() }) {
  const snapshot = await withCallbackLock(stateRoot, id, async (record) => record.receipt);
  const requested = requestedConsumer(snapshot, recipient);
  return withRecipientBindingLock({ stateRoot, recipient: requested }, async (resolved) => {
    if (resolved.stale) throw new CliError("Consumer binding is stale; use the current coordinator generation", 73);
    return withCallbackLock(stateRoot, id, async (record) => {
      if (record.state === "consumed") return { status: "already-consumed", callback_id: id };
      if (record.state === "observed") return { status: "already-observed", callback_id: id };
      const next = {
        ...record,
        state: "observed",
        observed_by: resolved.recipient,
        lifecycle: { ...record.lifecycle, observed_at: new Date(now).toISOString() },
      };
      await writeRecord(stateRoot, next);
      return { status: "observed", callback_id: id, receipt: record.receipt };
    });
  });
}

export async function consumeCallbackV06({
  stateRoot,
  callbackId: id,
  recipient,
  executorThreadId,
  dispositionId,
  now = Date.now(),
}) {
  requireText(executorThreadId, "executor_thread_id", { max: 128, safeId: true });
  requireText(dispositionId, "disposition_id", { max: 128, safeId: true });
  const snapshot = await withCallbackLock(stateRoot, id, async (record) => record.receipt);
  const requested = requestedConsumer(snapshot, recipient);
  return withRecipientBindingLock({ stateRoot, recipient: requested }, async (resolved) => {
    if (resolved.stale) throw new CliError("Consumer binding is stale; use the current coordinator generation", 73);
    return withCallbackLock(stateRoot, id, async (record) => {
      if (record.receipt.executor_thread_id !== executorThreadId) {
        throw new CliError("executor_thread_id does not match the callback", 73);
      }
      if (record.state === "consumed") {
        if (record.disposition_id !== dispositionId) {
          throw new CliError("Callback was consumed by a different disposition", 73);
        }
        return { status: "already-consumed", callback_id: id };
      }
      if (record.state !== "observed") {
        throw new CliError("Terminal callback must be observed before disposition consumption", 73);
      }
      await assertPersistedDispositionAuthority({ stateRoot, dispositionId, record });
      const next = {
        ...record,
        state: "consumed",
        consumed_by: resolved.recipient,
        disposition_id: dispositionId,
        lifecycle: { ...record.lifecycle, consumed_at: new Date(now).toISOString() },
      };
      await writeRecord(stateRoot, next);
      return { status: "consumed", callback_id: id, disposition_id: dispositionId };
    });
  });
}

async function listJsonFiles(root, stateRoot) {
  const trusted = guardRoot(stateRoot);
  await assertNoSymlinkComponents(trusted, root, "Callback state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new CliError(`Callback state contains a symbolic link: ${path}`);
    if (entry.isDirectory()) result.push(...await listJsonFiles(path, stateRoot));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

export async function callbackStatusV06({ stateRoot, runId = null }) {
  const pending = [];
  let consumedCount = 0;
  for (const path of await listJsonFiles(resolve(stateRoot, "callbacks", "journal"), stateRoot)) {
    const record = validateCallbackRecordV06(await readJson(path, { guardRoot: guardRoot(stateRoot) }));
    if (runId !== null && record.receipt.run_id !== runId) continue;
    if (record.state === "consumed") consumedCount += 1;
    else {
      pending.push({
        callback_id: record.callback_id,
        run_id: record.receipt.run_id,
        task_id: record.receipt.task_id,
        executor_thread_id: record.receipt.executor_thread_id,
        classification: record.receipt.classification,
        git_outcome: record.receipt.git_outcome.kind,
        state: record.state,
        age_seconds: Math.max(0, Math.floor((Date.now() - (await stat(path)).mtimeMs) / 1000)),
      });
    }
  }
  return {
    pending: pending.sort((left, right) => right.age_seconds - left.age_seconds),
    consumed_count: consumedCount,
  };
}

export async function callbackRecordV06({ stateRoot, callbackId: id }) {
  return readRecord(stateRoot, id);
}
