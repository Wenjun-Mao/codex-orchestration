import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  readJson,
  requireExactFields,
  requireInteger,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { resolveRecipient } from "./recipients.mjs";

export const ACCOUNTING_FIELDS = [
  "PRODUCT",
  "CROSS_CUTTING_PRODUCT_FIX",
  "ENVIRONMENT",
  "PROOF_HARNESS",
];

const RECEIPT_FIELDS = [
  "schema_version",
  "recipient",
  "executor_id",
  "run_id",
  "source_revision",
  "sequence",
  "supersedes_callback_ids",
  "expires_at",
  "classification",
  "branch",
  "commit",
  "upstream",
  "cleanliness",
  "result_or_blocker",
  "next_decision",
  "accounting",
];

const TEXT_LIMITS = {
  source_revision: 128,
  classification: 96,
  branch: 256,
  commit: 128,
  upstream: 256,
  cleanliness: 32,
  result_or_blocker: 512,
  next_decision: 512,
};

const CALLBACK_ID_PATTERN = /^terminal-v2-[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[0-9a-fA-F]{7,128}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TERMINAL_CLASSIFICATIONS = ["PASS", "BLOCKED", "FAIL"];
const CLEANLINESS_VALUES = ["clean", "dirty", "unknown"];
const CALLBACK_STATES = [
  "persisted",
  "enqueue-attempted",
  "enqueued",
  "observed",
  "consumed",
  "superseded",
  "expired",
];
const TERMINAL_STATES = new Set(["consumed", "superseded", "expired"]);
const LIFECYCLE_FIELDS = [
  "persisted_at",
  "enqueue_attempted_at",
  "enqueued_at",
  "observed_at",
  "consumed_at",
  "superseded_at",
  "expired_at",
];

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:client_secret|access_token|password)\s*[:=]\s*\S{8,}/i,
];
const RAW_CONTENT_PREFIX = /^\s*(?:```|\$\s|(?:stdout|stderr|console|transcript|traceback|stack\s*trace)\s*[:>])/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3}[ .-]\d{4}\b/;

function guardRoot(stateRoot) {
  return dirname(resolve(stateRoot));
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) throw new CliError("Unsafe callback state path");
  return path;
}

function requireTimestamp(value, label) {
  const text = requireText(value, label, { max: 64 });
  if (!Number.isFinite(Date.parse(text))) throw new CliError(`${label} must be an ISO timestamp`);
  return text;
}

function requireOptionalTimestamp(value, label) {
  if (value === null) return null;
  return requireTimestamp(value, label);
}

function validateRecipient(value, label = "recipient") {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation"],
  }, label);
  return {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 128, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1 }),
  };
}

function assertSafeText(field, value) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) throw new CliError(`Terminal receipt ${field} contains secret-like material`);
  }
  if (RAW_CONTENT_PREFIX.test(value)) {
    throw new CliError(`Terminal receipt ${field} contains raw log or transcript content`);
  }
  if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value)) {
    throw new CliError(`Terminal receipt ${field} contains user identity-like content`);
  }
}

function callbackIdentity(value) {
  const recipient = validateRecipient(value.recipient);
  return {
    lineage_id: recipient.lineage_id,
    executor_id: requireText(value.executor_id, "executor_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    sequence: requireInteger(value.sequence, "sequence", { min: 1 }),
  };
}

export function validateTerminalReceipt(value) {
  requireExactFields(value, { required: RECEIPT_FIELDS }, "Terminal receipt");
  if (value.schema_version !== 2) {
    throw new CliError("Unsupported terminal receipt schema_version; expected 2");
  }
  const recipient = validateRecipient(value.recipient);
  const executorId = requireText(value.executor_id, "executor_id", { max: 128, safeId: true });
  const runId = requireText(value.run_id, "run_id", { max: 128, safeId: true });
  const sourceRevision = requireText(value.source_revision, "source_revision", { max: TEXT_LIMITS.source_revision });
  if (!COMMIT_PATTERN.test(sourceRevision)) throw new CliError("source_revision must be a commit hash");
  const sequence = requireInteger(value.sequence, "sequence", { min: 1 });
  const supersedes = requireStringArray(value.supersedes_callback_ids, "supersedes_callback_ids", {
    maxItems: 64,
    maxText: 128,
    safeIds: true,
  });
  for (const id of supersedes) {
    if (!CALLBACK_ID_PATTERN.test(id)) throw new CliError("supersedes_callback_ids must contain v2 callback IDs");
  }
  const expiresAt = requireTimestamp(value.expires_at, "expires_at");
  const classification = requireText(value.classification, "classification", { max: TEXT_LIMITS.classification });
  if (!TERMINAL_CLASSIFICATIONS.includes(classification)) {
    throw new CliError(`classification must be one of: ${TERMINAL_CLASSIFICATIONS.join(", ")}`);
  }
  const branch = requireText(value.branch, "branch", { max: TEXT_LIMITS.branch });
  const commit = requireText(value.commit, "commit", { max: TEXT_LIMITS.commit });
  const upstream = requireText(value.upstream, "upstream", { max: TEXT_LIMITS.upstream });
  const cleanliness = requireText(value.cleanliness, "cleanliness", { max: TEXT_LIMITS.cleanliness });
  if (!CLEANLINESS_VALUES.includes(cleanliness)) {
    throw new CliError(`cleanliness must be one of: ${CLEANLINESS_VALUES.join(", ")}`);
  }
  const resultOrBlocker = requireText(value.result_or_blocker, "result_or_blocker", { max: TEXT_LIMITS.result_or_blocker });
  const nextDecision = requireText(value.next_decision, "next_decision", { max: TEXT_LIMITS.next_decision });
  if (!REF_PATTERN.test(branch)) throw new CliError("branch must be a bounded Git reference");
  if (!COMMIT_PATTERN.test(commit)) throw new CliError("commit must be a commit hash");
  if (!REF_PATTERN.test(upstream)) throw new CliError("upstream must be a bounded Git reference");
  for (const [field, text] of Object.entries({
    classification,
    branch,
    upstream,
    result_or_blocker: resultOrBlocker,
    next_decision: nextDecision,
  })) assertSafeText(field, text);

  requireExactFields(value.accounting, { required: ACCOUNTING_FIELDS }, "Terminal receipt accounting");
  const accounting = {};
  for (const field of ACCOUNTING_FIELDS) {
    const amount = value.accounting[field];
    if (!Number.isFinite(amount) || amount < 0) throw new CliError(`Invalid accounting bucket: ${field}`);
    accounting[field] = amount;
  }
  const normalized = {
    schema_version: 2,
    recipient,
    executor_id: executorId,
    run_id: runId,
    source_revision: sourceRevision,
    sequence,
    supersedes_callback_ids: supersedes,
    expires_at: expiresAt,
    classification,
    branch,
    commit,
    upstream,
    cleanliness,
    result_or_blocker: resultOrBlocker,
    next_decision: nextDecision,
    accounting,
  };
  if (Buffer.byteLength(stableStringify(normalized), "utf8") > 8192) {
    throw new CliError("Terminal receipt exceeds the 8 KiB serialized limit");
  }
  return normalized;
}

export function callbackIdFor(value) {
  const identity = callbackIdentity(value);
  return `terminal-v2-${sha256(stableStringify(identity))}`;
}

function callbackId(value) {
  const result = requireText(value, "callback_id", { max: 128, safeId: true });
  if (!CALLBACK_ID_PATTERN.test(result)) throw new CliError("callback_id must be a v2 callback ID");
  return result;
}

function identityLockName(payload) {
  const identity = callbackIdentity(payload);
  return `${sha256(stableStringify({
    lineage_id: identity.lineage_id,
    executor_id: identity.executor_id,
    run_id: identity.run_id,
  }))}.lock.json`;
}

export function callbackPaths(stateRoot, payload) {
  const callbacksRoot = resolve(stateRoot, "callbacks");
  const journalRoot = resolve(callbacksRoot, "journal");
  const lockRoot = resolve(callbacksRoot, "locks");
  const id = callbackIdFor(payload);
  return {
    callbacksRoot,
    callbackId: id,
    record: safeChild(journalRoot, `${id}.json`),
    lock: safeChild(lockRoot, identityLockName(payload)),
  };
}

function callbackPathById(stateRoot, value) {
  const id = callbackId(value);
  const journalRoot = resolve(stateRoot, "callbacks", "journal");
  return {
    callbackId: id,
    record: safeChild(journalRoot, `${id}.json`),
  };
}

function codexBinaryCandidates() {
  const configured = process.env.CODEX_FLOW_CODEX_BIN?.trim();
  if (configured) return [configured];
  const result = ["codex"];
  if (process.platform === "darwin") {
    for (const path of [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    ]) {
      if (existsSync(path)) result.push(path);
    }
  }
  return result;
}

export function findCodexBinary() {
  for (const binary of codexBinaryCandidates()) {
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (!result.error && result.status === 0) return { binary, version: result.stdout.trim() || result.stderr.trim() };
    if (result.error?.code !== "ENOENT") return { binary, error: result.error?.code ?? `exit-${result.status}` };
  }
  return null;
}

function callbackMessage(id, recipient, receipt) {
  return [
    "Queued terminal callback. Integrate this callback at most once by callback_id.",
    stableStringify({
      schema_version: 2,
      kind: "queued-terminal-callback",
      callback_id: id,
      recipient,
      receipt,
    }, 2),
  ].join("\n");
}

function runQueue(threadId, message) {
  for (const binary of codexBinaryCandidates()) {
    const result = spawnSync(binary, ["queue", "--thread", threadId, "--message", message], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 30_000,
    });
    if (result.error?.code === "ENOENT") continue;
    if (result.error) {
      if (result.error.code === "ETIMEDOUT") return { outcome: "ambiguous", reason: result.error.code };
      return { outcome: "unavailable", reason: result.error.code ?? "spawn-error" };
    }
    if (result.signal || result.status !== 0) {
      return { outcome: "ambiguous", reason: result.signal ?? `exit-${result.status ?? "unknown"}` };
    }
    return { outcome: "enqueued", reason: null };
  }
  return { outcome: "unavailable", reason: "codex-not-found" };
}

function validateLifecycle(value) {
  requireExactFields(value, { required: LIFECYCLE_FIELDS }, "Terminal callback lifecycle");
  return Object.fromEntries(LIFECYCLE_FIELDS.map((field) => [
    field,
    requireOptionalTimestamp(value[field], `Terminal callback lifecycle.${field}`),
  ]));
}

function validateAttempt(value, index) {
  requireExactFields(value, {
    required: ["attempted_at", "recipient", "outcome", "reason"],
  }, `Terminal callback enqueue attempt ${index}`);
  const outcome = requireText(value.outcome, `Terminal callback enqueue attempt ${index}.outcome`, { max: 32, safeId: true });
  if (!["started", "enqueued", "ambiguous", "unavailable"].includes(outcome)) {
    throw new CliError("Terminal callback enqueue attempt has an invalid outcome");
  }
  const reason = value.reason === null ? null : requireText(value.reason, `Terminal callback enqueue attempt ${index}.reason`, {
    max: 96,
    safeId: true,
  });
  return {
    attempted_at: requireTimestamp(value.attempted_at, `Terminal callback enqueue attempt ${index}.attempted_at`),
    recipient: validateRecipient(value.recipient, `Terminal callback enqueue attempt ${index}.recipient`),
    outcome,
    reason,
  };
}

function validateCallbackRecord(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "callback_id", "receipt", "delivery", "lifecycle"],
  }, "Terminal callback record");
  if (value.schema_version !== 2 || value.kind !== "terminal-callback-record") {
    throw new CliError("Invalid terminal callback record schema");
  }
  const receipt = validateTerminalReceipt(value.receipt);
  const id = callbackId(value.callback_id);
  if (callbackIdFor(receipt) !== id) throw new CliError("Terminal callback record has an invalid callback_id");
  requireExactFields(value.delivery, {
    required: ["state", "recipient", "transport", "enqueue_attempts", "superseded_by_callback_id"],
  }, "Terminal callback delivery");
  const state = requireText(value.delivery.state, "Terminal callback delivery state", { max: 32, safeId: true });
  if (!CALLBACK_STATES.includes(state)) throw new CliError("Terminal callback delivery state is invalid");
  const transport = requireText(value.delivery.transport, "Terminal callback transport", { max: 64, safeId: true });
  if (transport !== "codex-thread-queue") throw new CliError("Terminal callback transport is invalid");
  if (!Array.isArray(value.delivery.enqueue_attempts) || value.delivery.enqueue_attempts.length > 64) {
    throw new CliError("Terminal callback enqueue attempts must contain at most 64 entries");
  }
  const attempts = value.delivery.enqueue_attempts.map(validateAttempt);
  const supersededBy = value.delivery.superseded_by_callback_id === null
    ? null
    : callbackId(value.delivery.superseded_by_callback_id);
  const lifecycle = validateLifecycle(value.lifecycle);
  if (lifecycle.persisted_at === null) throw new CliError("Terminal callback record is missing persisted_at");
  const requiredTimestamp = {
    "enqueue-attempted": "enqueue_attempted_at",
    enqueued: "enqueued_at",
    observed: "observed_at",
    consumed: "consumed_at",
    superseded: "superseded_at",
    expired: "expired_at",
  }[state];
  if (requiredTimestamp && lifecycle[requiredTimestamp] === null) {
    throw new CliError(`Terminal callback ${state} record is missing ${requiredTimestamp}`);
  }
  if (state === "superseded" && supersededBy === null) {
    throw new CliError("Superseded terminal callback record is missing superseded_by_callback_id");
  }
  return {
    schema_version: 2,
    kind: "terminal-callback-record",
    callback_id: id,
    receipt,
    delivery: {
      state,
      recipient: validateRecipient(value.delivery.recipient, "Terminal callback delivery recipient"),
      transport,
      enqueue_attempts: attempts,
      superseded_by_callback_id: supersededBy,
    },
    lifecycle,
  };
}

function newCallbackRecord(receipt, id, recipient) {
  const persistedAt = new Date().toISOString();
  return {
    schema_version: 2,
    kind: "terminal-callback-record",
    callback_id: id,
    receipt,
    delivery: {
      state: "persisted",
      recipient,
      transport: "codex-thread-queue",
      enqueue_attempts: [],
      superseded_by_callback_id: null,
    },
    lifecycle: {
      persisted_at: persistedAt,
      enqueue_attempted_at: null,
      enqueued_at: null,
      observed_at: null,
      consumed_at: null,
      superseded_at: null,
      expired_at: null,
    },
  };
}

async function readRecord(path, root, { allowMissing = false } = {}) {
  const stored = await readJson(path, { allowMissing, guardRoot: root });
  return stored ? validateCallbackRecord(stored) : null;
}

async function writeRecord(path, record, root) {
  await atomicWriteJson(path, validateCallbackRecord(record), { guardRoot: root, mode: 0o600 });
}

function recordExpired(record, now = Date.now()) {
  return Date.parse(record.receipt.expires_at) <= now;
}

async function markExpired(record, path, root, now = Date.now()) {
  if (!recordExpired(record, now) || TERMINAL_STATES.has(record.delivery.state)) return false;
  record.delivery.state = "expired";
  record.lifecycle.expired_at = new Date(now).toISOString();
  await writeRecord(path, record, root);
  return true;
}

async function withCallbackLock({ stateRoot, callbackId: id }, operation) {
  const root = guardRoot(stateRoot);
  const unguarded = callbackPathById(stateRoot, id);
  const initial = await readRecord(unguarded.record, root, { allowMissing: true });
  if (!initial) throw new CliError("Terminal callback record does not exist");
  const paths = callbackPaths(stateRoot, initial.receipt);
  return withProcessLock({
    path: paths.lock,
    guardRoot: root,
    label: `terminal callback ${initial.callback_id}`,
  }, async () => {
    const record = await readRecord(paths.record, root, { allowMissing: true });
    if (!record) throw new CliError("Terminal callback record does not exist");
    return operation({ record, paths, root });
  });
}

function assertReceiptUnchanged(record, receipt) {
  if (stableStringify(record.receipt) !== stableStringify(receipt)) {
    throw new CliError("Changed terminal receipt collides with immutable callback identity", 73);
  }
}

async function loadSupersededRecords({ stateRoot, receipt, callbackId: id, root }) {
  const references = [];
  for (const supersededId of receipt.supersedes_callback_ids) {
    const path = callbackPathById(stateRoot, supersededId).record;
    const record = await readRecord(path, root, { allowMissing: true });
    if (!record) throw new CliError(`Superseded terminal callback does not exist: ${supersededId}`, 73);
    const prior = callbackIdentity(record.receipt);
    const current = callbackIdentity(receipt);
    if (
      prior.lineage_id !== current.lineage_id
      || prior.executor_id !== current.executor_id
      || prior.run_id !== current.run_id
      || prior.sequence >= current.sequence
    ) throw new CliError("Supersession must reference lower-sequence callbacks for the same lineage, executor, and run", 73);
    if (record.delivery.state === "consumed") {
      throw new CliError("A consumed terminal callback cannot be superseded", 73);
    }
    if (record.delivery.state === "superseded" && record.delivery.superseded_by_callback_id !== id) {
      throw new CliError("Terminal callback was already superseded by a different callback", 73);
    }
    references.push({ record, path });
  }
  return references;
}

async function applySupersession({ references, callbackId: id, root }) {
  const now = new Date().toISOString();
  for (const { record, path } of references) {
    if (record.delivery.state === "superseded") continue;
    record.delivery.state = "superseded";
    record.delivery.superseded_by_callback_id = id;
    record.lifecycle.superseded_at = now;
    await writeRecord(path, record, root);
  }
}

export async function deliverCallback({ stateRoot, receipt, noQueue = false }) {
  const payload = validateTerminalReceipt(receipt);
  const paths = callbackPaths(stateRoot, payload);
  const root = guardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot: root,
    label: `terminal callback ${paths.callbackId}`,
  }, async () => {
    const resolved = await resolveRecipient({ stateRoot, recipient: payload.recipient });
    let record = await readRecord(paths.record, root, { allowMissing: true });
    if (record) assertReceiptUnchanged(record, payload);
    else {
      const references = await loadSupersededRecords({
        stateRoot,
        receipt: payload,
        callbackId: paths.callbackId,
        root,
      });
      record = newCallbackRecord(payload, paths.callbackId, resolved.recipient);
      await writeRecord(paths.record, record, root);
      await applySupersession({ references, callbackId: paths.callbackId, root });
    }
    if (await markExpired(record, paths.record, root)) {
      throw new CliError("Terminal callback expired before delivery", 73);
    }
    if (record.delivery.state === "consumed") return { status: "already-consumed", callback_id: paths.callbackId };
    if (record.delivery.state === "superseded") {
      throw new CliError("Superseded terminal callback cannot be delivered", 73);
    }
    if (record.delivery.state === "expired") {
      throw new CliError("Expired terminal callback cannot be delivered", 73);
    }
    if (record.delivery.state === "enqueue-attempted") {
      throw new CliError("Terminal callback enqueue outcome is ambiguous; reconcile before retrying", 75);
    }
    if (["enqueued", "observed"].includes(record.delivery.state)) {
      return { status: `already-${record.delivery.state}`, callback_id: paths.callbackId };
    }
    if (noQueue) return { status: "persisted", callback_id: paths.callbackId };

    const attemptedAt = new Date().toISOString();
    const attempt = {
      attempted_at: attemptedAt,
      recipient: resolved.recipient,
      outcome: "started",
      reason: null,
    };
    record.delivery.recipient = resolved.recipient;
    record.delivery.state = "enqueue-attempted";
    record.delivery.enqueue_attempts.push(attempt);
    record.lifecycle.enqueue_attempted_at ??= attemptedAt;
    await writeRecord(paths.record, record, root);

    const queued = runQueue(resolved.recipient.thread_id, callbackMessage(paths.callbackId, resolved.recipient, payload));
    attempt.outcome = queued.outcome;
    attempt.reason = queued.reason;
    if (queued.outcome === "enqueued") {
      record.delivery.state = "enqueued";
      record.lifecycle.enqueued_at = new Date().toISOString();
      await writeRecord(paths.record, record, root);
      return { status: "enqueued", callback_id: paths.callbackId, recipient: resolved.recipient };
    }
    if (queued.outcome === "unavailable") {
      record.delivery.state = "persisted";
      await writeRecord(paths.record, record, root);
      throw new CliError(`Terminal callback queue unavailable (${queued.reason}); receipt retained`, 75);
    }
    await writeRecord(paths.record, record, root);
    throw new CliError(`Terminal callback queue outcome is ambiguous (${queued.reason}); reconcile before retrying`, 75);
  });
}

export async function observeCallback({ stateRoot, callbackId: id }) {
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (await markExpired(record, paths.record, root)) {
      throw new CliError("Expired terminal callback cannot be observed", 73);
    }
    if (record.delivery.state === "superseded" || record.delivery.state === "expired") {
      throw new CliError(`${record.delivery.state} terminal callback cannot be observed`, 73);
    }
    if (record.delivery.state === "observed") return { status: "already-observed", callback_id: record.callback_id };
    if (record.delivery.state === "consumed") return { status: "already-consumed", callback_id: record.callback_id };
    if (record.delivery.state !== "enqueued") {
      throw new CliError("Terminal callback must be enqueued before it can be observed", 73);
    }
    record.delivery.state = "observed";
    record.lifecycle.observed_at = new Date().toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "observed", callback_id: record.callback_id };
  });
}

export async function consumeCallback({ stateRoot, callbackId: id, sourceThreadId = undefined, executorId = undefined }) {
  if (sourceThreadId !== undefined) requireText(sourceThreadId, "source_thread_id", { max: 128, safeId: true });
  if (executorId !== undefined) requireText(executorId, "executor_id", { max: 128, safeId: true });
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (executorId !== undefined && executorId !== record.receipt.executor_id) {
      throw new CliError("executor_id does not match the persisted receipt", 73);
    }
    if (
      sourceThreadId !== undefined
      && sourceThreadId !== record.receipt.recipient.thread_id
      && sourceThreadId !== record.delivery.recipient.thread_id
    ) throw new CliError("source_thread_id does not match the persisted recipient", 73);
    if (await markExpired(record, paths.record, root)) {
      throw new CliError("Expired terminal callback cannot be consumed", 73);
    }
    if (record.delivery.state === "superseded" || record.delivery.state === "expired") {
      throw new CliError(`${record.delivery.state} terminal callback cannot be consumed`, 73);
    }
    if (record.delivery.state === "consumed") return { status: "already-consumed", callback_id: record.callback_id };
    if (!["enqueued", "observed"].includes(record.delivery.state)) {
      throw new CliError("Terminal callback must be enqueued before it can be consumed", 73);
    }
    record.delivery.state = "consumed";
    record.lifecycle.consumed_at = new Date().toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "consumed", callback_id: record.callback_id };
  });
}

export async function reconcileCallback({ stateRoot, callbackId: id, outcome, result = undefined }) {
  const decision = outcome ?? result;
  if (!["enqueued", "not-enqueued"].includes(decision)) {
    throw new CliError("Callback reconciliation outcome must be enqueued or not-enqueued");
  }
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (await markExpired(record, paths.record, root)) {
      throw new CliError("Expired terminal callback cannot be reconciled", 73);
    }
    if (record.delivery.state !== "enqueue-attempted") {
      throw new CliError("Only an ambiguous enqueue-attempted callback can be reconciled", 73);
    }
    const lastAttempt = record.delivery.enqueue_attempts.at(-1);
    if (!lastAttempt || !["started", "ambiguous"].includes(lastAttempt.outcome)) {
      throw new CliError("Terminal callback does not have an ambiguous enqueue attempt", 73);
    }
    if (decision === "enqueued") {
      lastAttempt.outcome = "enqueued";
      lastAttempt.reason = "reconciled";
      record.delivery.state = "enqueued";
      record.lifecycle.enqueued_at ??= new Date().toISOString();
    } else {
      lastAttempt.outcome = "unavailable";
      lastAttempt.reason = "reconciled-not-enqueued";
      record.delivery.state = "persisted";
    }
    await writeRecord(paths.record, record, root);
    return { status: record.delivery.state, callback_id: record.callback_id };
  });
}

export async function expireCallback({ stateRoot, callbackId: id, now = Date.now() }) {
  const nowMs = now instanceof Date
    ? now.getTime()
    : typeof now === "string"
      ? Date.parse(now)
      : Number(now);
  if (!Number.isFinite(nowMs)) throw new CliError("expire now must be a valid timestamp");
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (record.delivery.state === "expired") return { status: "already-expired", callback_id: record.callback_id };
    if (record.delivery.state === "consumed" || record.delivery.state === "superseded") {
      return { status: `already-${record.delivery.state}`, callback_id: record.callback_id };
    }
    if (!recordExpired(record, nowMs)) return { status: "not-expired", callback_id: record.callback_id };
    await markExpired(record, paths.record, root, nowMs);
    return { status: "expired", callback_id: record.callback_id };
  });
}

async function listJsonFiles(root, stateRoot) {
  const trustedRoot = guardRoot(stateRoot);
  const result = [];
  await assertNoSymlinkComponents(trustedRoot, root, "Callback state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new CliError(`Callback state contains a symbolic link: ${path}`);
    if (entry.isDirectory()) result.push(...await listJsonFiles(path, stateRoot));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

export async function expireCallbacks({ stateRoot, now = Date.now() }) {
  const journalRoot = resolve(stateRoot, "callbacks", "journal");
  const results = [];
  for (const path of await listJsonFiles(journalRoot, stateRoot)) {
    results.push(await expireCallback({ stateRoot, callbackId: basename(path, ".json"), now }));
  }
  return results;
}

export async function callbackStatus(stateRoot) {
  const root = guardRoot(stateRoot);
  const journalRoot = resolve(stateRoot, "callbacks", "journal");
  const pending = [];
  let consumedCount = 0;
  const terminal = { superseded: 0, expired: 0 };
  for (const path of await listJsonFiles(journalRoot, stateRoot)) {
    const record = await readRecord(path, root);
    const age = Math.max(0, Math.floor((Date.now() - (await stat(path)).mtimeMs) / 1000));
    if (record.delivery.state === "consumed") {
      consumedCount += 1;
      continue;
    }
    if (record.delivery.state === "superseded" || record.delivery.state === "expired") {
      terminal[record.delivery.state] += 1;
      continue;
    }
    pending.push({
      callback_id: record.callback_id,
      lineage_id: record.receipt.recipient.lineage_id,
      executor_id: record.receipt.executor_id,
      run_id: record.receipt.run_id,
      sequence: record.receipt.sequence,
      classification: record.receipt.classification,
      delivery: record.delivery.state,
      age_seconds: age,
    });
  }
  return {
    pending: pending.sort((a, b) => b.age_seconds - a.age_seconds),
    consumed_count: consumedCount,
    superseded_count: terminal.superseded,
    expired_count: terminal.expired,
  };
}
