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
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const COMMIT_PATTERN = /^[0-9a-fA-F]{7,128}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TERMINAL_CLASSIFICATIONS = ["PASS", "BLOCKED", "FAIL"];
const CLEANLINESS_VALUES = ["clean", "dirty", "unknown"];
const LEGACY_CALLBACK_STATES = [
  "persisted",
  "enqueue-attempted",
  "enqueued",
  "observed",
  "consumed",
  "superseded",
  "expired",
];
const INTEGRATION_STATES = ["persisted", "observed", "consumed", "superseded", "expired"];
const TERMINAL_INTEGRATION_STATES = new Set(["consumed", "superseded", "expired"]);
const NOTIFICATION_AUTHORITIES = ["journal-monitor", "retractable-thread-queue", "legacy-mixed"];
const NOTIFICATION_TRANSPORTS = ["none", "capability-probed-thread-queue", "legacy-codex-queue"];
const NOTIFICATION_STATES = [
  "disabled",
  "not-requested",
  "add-pending",
  "queued",
  "started",
  "retract-pending",
  "retracted",
  "unavailable",
  "ambiguous",
  "legacy-identity-unknown",
];
const OBSERVATION_SOURCES = ["journal-monitor", "monitor-recovery", "queue-turn", "legacy-unknown"];
const LEGACY_LIFECYCLE_FIELDS = [
  "persisted_at",
  "enqueue_attempted_at",
  "enqueued_at",
  "observed_at",
  "consumed_at",
  "superseded_at",
  "expired_at",
];
const LIFECYCLE_FIELDS = ["persisted_at", "observed_at", "consumed_at", "superseded_at", "expired_at"];

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
const APPLICATION_IDENTIFIER_PATTERN = /\b(?:app(?:lication)?[_ -]?id|client[_ -]?(?:id|key)|account[_ -]?id|game[_ -]?id)\s*[:=]\s*\S+/i;

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
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new CliError(`${label} must be an ISO timestamp with an explicit UTC offset`);
  }
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
  if (APPLICATION_IDENTIFIER_PATTERN.test(value)) {
    throw new CliError(`Terminal receipt ${field} contains an application or account identifier`);
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
  if (sequence === 1 && supersedes.length > 0) {
    throw new CliError("Initial terminal callback sequence cannot supersede another callback");
  }
  if (sequence > 1 && supersedes.length === 0) {
    throw new CliError("Terminal callback sequence greater than 1 requires explicit supersession");
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
  const identity = callbackIdentity(validateTerminalReceipt(value));
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

export function callbackPointerMessage(id, recipient) {
  callbackId(id);
  const target = validateRecipient(recipient, "callback pointer recipient");
  return [
    "Queued terminal callback pointer. Resolve the trusted receipt from the codex-flow journal and integrate it at most once.",
    stableStringify({
      schema_version: 1,
      kind: "queued-terminal-callback-pointer",
      callback_id: id,
      recipient: target,
    }, 2),
  ].join("\n");
}

function callbackClientMessageId(id) {
  return `callback-${sha256(id)}`;
}

function notificationOperationId(id, action, sequence) {
  return `queue-operation-v1-${sha256(`${id}:${action}:${sequence}`)}`;
}

async function probeQueueAdapter(adapter) {
  if (!adapter || typeof adapter.probe !== "function") {
    throw new CliError("Retractable thread-queue authority requires a capability-probed queue adapter", 75);
  }
  const capabilities = await adapter.probe();
  requireExactFields(capabilities, {
    required: ["stable_identity", "add", "list", "delete"],
  }, "Queue adapter capabilities");
  for (const field of ["stable_identity", "add", "list", "delete"]) {
    if (capabilities[field] !== true) {
      throw new CliError(`Queue adapter capability is unavailable: ${field}`, 75);
    }
  }
  if (
    typeof adapter.add !== "function"
    || typeof adapter.list !== "function"
    || typeof adapter.delete !== "function"
  ) {
    throw new CliError("Queue adapter is missing add, list, or delete behavior", 75);
  }
  return adapter;
}

function normalizeAdapterReason(value) {
  if (value === null || value === undefined) return null;
  return requireText(value, "queue adapter reason", { max: 96, safeId: true });
}

async function callQueueAdd(adapter, request) {
  try {
    await probeQueueAdapter(adapter);
    const result = await adapter.add(request);
    requireExactFields(result, {
      required: ["outcome", "submission_id", "reason"],
    }, "Queue adapter add result");
    const outcome = requireText(result.outcome, "queue adapter add outcome", { max: 32, safeId: true });
    if (!["queued", "unavailable", "ambiguous"].includes(outcome)) {
      throw new CliError("Queue adapter add outcome is invalid");
    }
    const submissionId = result.submission_id === null
      ? null
      : requireText(result.submission_id, "queue submission id", { max: 256, safeId: true });
    if (outcome === "queued" && submissionId === null) {
      throw new CliError("Queued adapter result is missing a stable submission id");
    }
    if (outcome !== "queued" && submissionId !== null) {
      throw new CliError("Nonqueued adapter result cannot include a submission id");
    }
    return { outcome, submission_id: submissionId, reason: normalizeAdapterReason(result.reason) };
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 75) {
      return { outcome: "unavailable", submission_id: null, reason: "capability-unavailable" };
    }
    return { outcome: "ambiguous", submission_id: null, reason: "adapter-error" };
  }
}

async function callQueueDelete(adapter, request) {
  try {
    await probeQueueAdapter(adapter);
    const result = await adapter.delete(request);
    requireExactFields(result, { required: ["outcome", "reason"] }, "Queue adapter delete result");
    const outcome = requireText(result.outcome, "queue adapter delete outcome", { max: 32, safeId: true });
    if (!["deleted", "absent", "started", "unavailable", "ambiguous"].includes(outcome)) {
      throw new CliError("Queue adapter delete outcome is invalid");
    }
    return { outcome, reason: normalizeAdapterReason(result.reason) };
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 75) {
      return { outcome: "unavailable", reason: "capability-unavailable" };
    }
    return { outcome: "ambiguous", reason: "adapter-error" };
  }
}

async function callQueueList(adapter, request) {
  try {
    await probeQueueAdapter(adapter);
    const result = await adapter.list(request);
    requireExactFields(result, {
      required: ["outcome", "submission_id", "reason"],
    }, "Queue adapter list result");
    const outcome = requireText(result.outcome, "queue adapter list outcome", { max: 32, safeId: true });
    if (!["found", "absent", "started", "unavailable", "ambiguous"].includes(outcome)) {
      throw new CliError("Queue adapter list outcome is invalid");
    }
    const submissionId = result.submission_id === null
      ? null
      : requireText(result.submission_id, "queue submission id", { max: 256, safeId: true });
    if (outcome === "found" && submissionId === null) {
      throw new CliError("Found adapter result is missing a stable submission id");
    }
    if (!["found", "started"].includes(outcome) && submissionId !== null) {
      throw new CliError("Queue list result cannot include a submission id for this outcome");
    }
    return { outcome, submission_id: submissionId, reason: normalizeAdapterReason(result.reason) };
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 75) {
      return { outcome: "unavailable", submission_id: null, reason: "capability-unavailable" };
    }
    return { outcome: "ambiguous", submission_id: null, reason: "adapter-error" };
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new CliError(`${label} must be a boolean`);
  return value;
}

function validateLifecycle(value, fields = LIFECYCLE_FIELDS, label = "Terminal callback lifecycle") {
  requireExactFields(value, { required: fields }, label);
  return Object.fromEntries(fields.map((field) => [
    field,
    requireOptionalTimestamp(value[field], `${label}.${field}`),
  ]));
}

function validateNotificationAttempt(value, index) {
  const label = `Terminal callback notification attempt ${index}`;
  requireExactFields(value, {
    required: ["operation_id", "action", "attempted_at", "completed_at", "outcome", "reason"],
  }, label);
  const action = requireText(value.action, `${label}.action`, { max: 16, safeId: true });
  if (!["add", "list", "delete"].includes(action)) throw new CliError(`${label}.action is invalid`);
  const outcome = requireText(value.outcome, `${label}.outcome`, { max: 32, safeId: true });
  if (!["pending", "queued", "found", "deleted", "absent", "started", "unavailable", "ambiguous"].includes(outcome)) {
    throw new CliError(`${label}.outcome is invalid`);
  }
  const completedAt = requireOptionalTimestamp(value.completed_at, `${label}.completed_at`);
  if ((outcome === "pending") !== (completedAt === null)) {
    throw new CliError(`${label} pending/completed state is inconsistent`);
  }
  return {
    operation_id: requireText(value.operation_id, `${label}.operation_id`, { max: 128, safeId: true }),
    action,
    attempted_at: requireTimestamp(value.attempted_at, `${label}.attempted_at`),
    completed_at: completedAt,
    outcome,
    reason: value.reason === null
      ? null
      : requireText(value.reason, `${label}.reason`, { max: 96, safeId: true }),
  };
}

function validateIntegration(value) {
  requireExactFields(value, {
    required: [
      "state", "observed_by_recipient", "consumed_by_recipient",
      "observation_source", "superseded_by_callback_id",
    ],
  }, "Terminal callback integration");
  const state = requireText(value.state, "Terminal callback integration.state", { max: 32, safeId: true });
  if (!INTEGRATION_STATES.includes(state)) throw new CliError("Terminal callback integration state is invalid");
  const observedBy = value.observed_by_recipient === null
    ? null
    : validateRecipient(value.observed_by_recipient, "Terminal callback observed-by recipient");
  const consumedBy = value.consumed_by_recipient === null
    ? null
    : validateRecipient(value.consumed_by_recipient, "Terminal callback consumed-by recipient");
  const source = value.observation_source === null
    ? null
    : requireText(value.observation_source, "Terminal callback observation source", { max: 32, safeId: true });
  if (source !== null && !OBSERVATION_SOURCES.includes(source)) {
    throw new CliError("Terminal callback observation source is invalid");
  }
  const supersededBy = value.superseded_by_callback_id === null
    ? null
    : callbackId(value.superseded_by_callback_id);
  if (["observed", "consumed"].includes(state) && observedBy === null) {
    throw new CliError(`Terminal callback ${state} record is missing observed_by_recipient`);
  }
  if ((observedBy === null) !== (source === null)) {
    throw new CliError("Terminal callback observation identity and source must be recorded together");
  }
  if (state === "consumed" && consumedBy === null) {
    throw new CliError("Consumed terminal callback record is missing consumed_by_recipient");
  }
  if (state !== "consumed" && consumedBy !== null) {
    throw new CliError(`Terminal callback ${state} record cannot contain consumed_by_recipient`);
  }
  if ((state === "superseded") !== (supersededBy !== null)) {
    throw new CliError("Terminal callback supersession state and identity are inconsistent");
  }
  return {
    state,
    observed_by_recipient: observedBy,
    consumed_by_recipient: consumedBy,
    observation_source: source,
    superseded_by_callback_id: supersededBy,
  };
}

function validateNotification(value) {
  requireExactFields(value, {
    required: [
      "authority", "transport", "state", "recipient", "queue_submission_id",
      "client_user_message_id", "potentially_live", "attempts",
    ],
  }, "Terminal callback notification");
  const authority = requireText(value.authority, "Terminal callback notification.authority", { max: 48, safeId: true });
  if (!NOTIFICATION_AUTHORITIES.includes(authority)) throw new CliError("Terminal callback notification authority is invalid");
  const transport = requireText(value.transport, "Terminal callback notification.transport", { max: 48, safeId: true });
  if (!NOTIFICATION_TRANSPORTS.includes(transport)) throw new CliError("Terminal callback notification transport is invalid");
  const state = requireText(value.state, "Terminal callback notification.state", { max: 48, safeId: true });
  if (!NOTIFICATION_STATES.includes(state)) throw new CliError("Terminal callback notification state is invalid");
  const submissionId = value.queue_submission_id === null
    ? null
    : requireText(value.queue_submission_id, "Terminal callback queue submission id", { max: 256, safeId: true });
  const clientMessageId = value.client_user_message_id === null
    ? null
    : requireText(value.client_user_message_id, "Terminal callback client message id", { max: 128, safeId: true });
  const potentiallyLive = requireBoolean(value.potentially_live, "Terminal callback notification.potentially_live");
  if (!Array.isArray(value.attempts) || value.attempts.length > 64) {
    throw new CliError("Terminal callback notification attempts must contain at most 64 entries");
  }
  const attempts = value.attempts.map(validateNotificationAttempt);
  if (authority === "journal-monitor" && (
    transport !== "none"
    || state !== "disabled"
    || submissionId !== null
    || clientMessageId !== null
    || potentiallyLive
    || attempts.length > 0
  )) throw new CliError("Journal-monitor callbacks cannot carry a queue notification lifecycle");
  if (authority === "retractable-thread-queue" && (
    transport !== "capability-probed-thread-queue" || clientMessageId === null
  )) throw new CliError("Retractable queue callbacks require capability-probed transport and stable client identity");
  if (authority === "legacy-mixed" && (transport !== "legacy-codex-queue" || clientMessageId !== null)) {
    throw new CliError("Legacy callback notification contract is invalid");
  }
  const liveStates = new Set(["add-pending", "queued", "retract-pending", "ambiguous", "legacy-identity-unknown"]);
  if (potentiallyLive !== liveStates.has(state)) {
    throw new CliError("Terminal callback notification state and live-risk flag are inconsistent");
  }
  if (state === "queued" && submissionId === null) {
    throw new CliError("Queued terminal callback notification is missing its submission identity");
  }
  return {
    authority,
    transport,
    state,
    recipient: validateRecipient(value.recipient, "Terminal callback notification recipient"),
    queue_submission_id: submissionId,
    client_user_message_id: clientMessageId,
    potentially_live: potentiallyLive,
    attempts,
  };
}

function validateCurrentRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "callback_id", "receipt", "integration",
      "notification", "lifecycle", "legacy_source_schema_version",
    ],
  }, "Terminal callback record");
  if (value.schema_version !== 3 || value.kind !== "terminal-callback-record") {
    throw new CliError("Invalid terminal callback record schema");
  }
  const receipt = validateTerminalReceipt(value.receipt);
  const id = callbackId(value.callback_id);
  if (callbackIdFor(receipt) !== id) throw new CliError("Terminal callback record has an invalid callback_id");
  const integration = validateIntegration(value.integration);
  const notification = validateNotification(value.notification);
  const lifecycle = validateLifecycle(value.lifecycle);
  if (lifecycle.persisted_at === null) throw new CliError("Terminal callback record is missing persisted_at");
  if (integration.observed_by_recipient !== null && lifecycle.observed_at === null) {
    throw new CliError("Observed terminal callback record is missing observed_at");
  }
  if (integration.state === "consumed" && lifecycle.consumed_at === null) {
    throw new CliError("Consumed terminal callback record is missing consumed_at");
  }
  if (integration.state === "superseded" && lifecycle.superseded_at === null) {
    throw new CliError("Superseded terminal callback record is missing superseded_at");
  }
  if (integration.state === "expired" && lifecycle.expired_at === null) {
    throw new CliError("Expired terminal callback record is missing expired_at");
  }
  const legacySource = value.legacy_source_schema_version === null
    ? null
    : requireInteger(value.legacy_source_schema_version, "legacy_source_schema_version", { min: 2, max: 2 });
  if ((notification.authority === "legacy-mixed") !== (legacySource === 2)) {
    throw new CliError("Legacy callback authority and source schema are inconsistent");
  }
  return {
    schema_version: 3,
    kind: "terminal-callback-record",
    callback_id: id,
    receipt,
    integration,
    notification,
    lifecycle,
    legacy_source_schema_version: legacySource,
  };
}

function validateLegacyAttempt(value, index) {
  const label = `Legacy terminal callback enqueue attempt ${index}`;
  requireExactFields(value, { required: ["attempted_at", "recipient", "outcome", "reason"] }, label);
  const outcome = requireText(value.outcome, `${label}.outcome`, { max: 32, safeId: true });
  if (!["started", "enqueued", "ambiguous", "unavailable"].includes(outcome)) {
    throw new CliError(`${label}.outcome is invalid`);
  }
  return {
    attempted_at: requireTimestamp(value.attempted_at, `${label}.attempted_at`),
    recipient: validateRecipient(value.recipient, `${label}.recipient`),
    outcome,
    reason: value.reason === null ? null : requireText(value.reason, `${label}.reason`, { max: 96, safeId: true }),
  };
}

function migrateLegacyRecord(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "callback_id", "receipt", "delivery", "lifecycle"],
  }, "Legacy terminal callback record");
  if (value.schema_version !== 2 || value.kind !== "terminal-callback-record") {
    throw new CliError("Invalid legacy terminal callback record schema");
  }
  const receipt = validateTerminalReceipt(value.receipt);
  const id = callbackId(value.callback_id);
  if (callbackIdFor(receipt) !== id) throw new CliError("Legacy terminal callback record has an invalid callback_id");
  requireExactFields(value.delivery, {
    required: [
      "state", "recipient", "observed_by_recipient", "consumed_by_recipient",
      "transport", "enqueue_attempts", "superseded_by_callback_id",
    ],
  }, "Legacy terminal callback delivery");
  const state = requireText(value.delivery.state, "Legacy terminal callback delivery state", { max: 32, safeId: true });
  if (!LEGACY_CALLBACK_STATES.includes(state)) throw new CliError("Legacy terminal callback delivery state is invalid");
  if (value.delivery.transport !== "codex-thread-queue") throw new CliError("Legacy terminal callback transport is invalid");
  if (!Array.isArray(value.delivery.enqueue_attempts) || value.delivery.enqueue_attempts.length > 64) {
    throw new CliError("Legacy terminal callback enqueue attempts must contain at most 64 entries");
  }
  const legacyAttempts = value.delivery.enqueue_attempts.map(validateLegacyAttempt);
  const lifecycle = validateLifecycle(value.lifecycle, LEGACY_LIFECYCLE_FIELDS, "Legacy terminal callback lifecycle");
  if (lifecycle.persisted_at === null) throw new CliError("Legacy terminal callback is missing persisted_at");
  const observedBy = value.delivery.observed_by_recipient === null
    ? null
    : validateRecipient(value.delivery.observed_by_recipient, "Legacy terminal callback observed-by recipient");
  const consumedBy = value.delivery.consumed_by_recipient === null
    ? null
    : validateRecipient(value.delivery.consumed_by_recipient, "Legacy terminal callback consumed-by recipient");
  const supersededBy = value.delivery.superseded_by_callback_id === null
    ? null
    : callbackId(value.delivery.superseded_by_callback_id);
  const integrationState = ["enqueue-attempted", "enqueued"].includes(state) ? "persisted" : state;
  const potentiallyLive = legacyAttempts.some((attempt) => ["started", "enqueued", "ambiguous"].includes(attempt.outcome))
    || ["enqueue-attempted", "enqueued", "observed", "consumed"].includes(state);
  const notificationState = potentiallyLive
    ? "legacy-identity-unknown"
    : legacyAttempts.length > 0 ? "unavailable" : "disabled";
  const attempts = legacyAttempts.map((attempt, index) => ({
    operation_id: notificationOperationId(id, "add", index + 1),
    action: "add",
    attempted_at: attempt.attempted_at,
    completed_at: attempt.outcome === "started" ? null : attempt.attempted_at,
    outcome: { started: "pending", enqueued: "queued" }[attempt.outcome] ?? attempt.outcome,
    reason: attempt.reason,
  }));
  return validateCurrentRecord({
    schema_version: 3,
    kind: "terminal-callback-record",
    callback_id: id,
    receipt,
    integration: {
      state: integrationState,
      observed_by_recipient: observedBy,
      consumed_by_recipient: consumedBy,
      observation_source: observedBy === null ? null : "legacy-unknown",
      superseded_by_callback_id: supersededBy,
    },
    notification: {
      authority: "legacy-mixed",
      transport: "legacy-codex-queue",
      state: notificationState,
      recipient: validateRecipient(value.delivery.recipient, "Legacy terminal callback delivery recipient"),
      queue_submission_id: null,
      client_user_message_id: null,
      potentially_live: potentiallyLive,
      attempts,
    },
    lifecycle: {
      persisted_at: lifecycle.persisted_at,
      observed_at: lifecycle.observed_at,
      consumed_at: lifecycle.consumed_at,
      superseded_at: lifecycle.superseded_at,
      expired_at: lifecycle.expired_at,
    },
    legacy_source_schema_version: 2,
  });
}

function validateCallbackRecord(value) {
  if (value?.schema_version === 2) return migrateLegacyRecord(value);
  return validateCurrentRecord(value);
}

function newCallbackRecord(receipt, id, recipient, authority) {
  const journalMonitor = authority === "journal-monitor";
  return validateCurrentRecord({
    schema_version: 3,
    kind: "terminal-callback-record",
    callback_id: id,
    receipt,
    integration: {
      state: "persisted",
      observed_by_recipient: null,
      consumed_by_recipient: null,
      observation_source: null,
      superseded_by_callback_id: null,
    },
    notification: {
      authority,
      transport: journalMonitor ? "none" : "capability-probed-thread-queue",
      state: journalMonitor ? "disabled" : "not-requested",
      recipient,
      queue_submission_id: null,
      client_user_message_id: journalMonitor ? null : callbackClientMessageId(id),
      potentially_live: false,
      attempts: [],
    },
    lifecycle: {
      persisted_at: new Date().toISOString(),
      observed_at: null,
      consumed_at: null,
      superseded_at: null,
      expired_at: null,
    },
    legacy_source_schema_version: null,
  });
}

async function readRecord(path, root, { allowMissing = false } = {}) {
  const stored = await readJson(path, { allowMissing, guardRoot: root });
  return stored ? validateCallbackRecord(stored) : null;
}

async function writeRecord(path, record, root) {
  await atomicWriteJson(path, validateCurrentRecord(record), { guardRoot: root, mode: 0o600 });
}

function recordExpired(record, now = Date.now()) {
  return Date.parse(record.receipt.expires_at) <= now;
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

function closePendingAttemptForRecovery(record) {
  const pending = record.notification.attempts.at(-1);
  if (pending?.outcome !== "pending") return;
  pending.outcome = "ambiguous";
  pending.completed_at = new Date().toISOString();
  pending.reason = "inspect-before-retry";
}

function beginNotificationOperation(record, action, target) {
  closePendingAttemptForRecovery(record);
  const attemptedAt = new Date().toISOString();
  const attempt = {
    operation_id: notificationOperationId(record.callback_id, action, record.notification.attempts.length + 1),
    action,
    attempted_at: attemptedAt,
    completed_at: null,
    outcome: "pending",
    reason: null,
  };
  record.notification.attempts.push(attempt);
  record.notification.state = target === "add" ? "add-pending" : "retract-pending";
  record.notification.potentially_live = true;
  return attempt;
}

function finishNotificationAttempt(record, operationId, result) {
  const attempt = record.notification.attempts.find((candidate) => candidate.operation_id === operationId);
  if (!attempt) throw new CliError("Queue operation no longer belongs to this callback", 75);
  if (attempt.outcome !== "pending") return false;
  attempt.completed_at = new Date().toISOString();
  attempt.outcome = result.outcome;
  attempt.reason = result.reason;
  return true;
}

async function performQueueOperation(adapter, staged) {
  if (staged.action === "add") return callQueueAdd(adapter, staged.request);
  if (staged.action === "list") return callQueueList(adapter, staged.request);
  return callQueueDelete(adapter, staged.request);
}

async function ensureNotificationQueued({ stateRoot, callbackId: id, queueAdapter }) {
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const staged = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
      if (record.notification.authority !== "retractable-thread-queue") {
        throw new CliError("Callback does not use retractable queue authority", 73);
      }
      if (record.integration.state !== "persisted") {
        return { done: true, status: `already-${record.integration.state}` };
      }
      if (record.notification.state === "queued") return { done: true, status: "already-queued" };
      if (record.notification.state === "started") return { done: true, status: "already-started" };
      if (["retracted", "retract-pending"].includes(record.notification.state)) {
        throw new CliError("Retracted callback notification cannot be delivered again", 73);
      }
      const lastAction = record.notification.attempts.at(-1)?.action ?? null;
      if (record.notification.state === "ambiguous" && record.notification.queue_submission_id !== null && lastAction !== "add") {
        throw new CliError("Ambiguous queue retraction must be reconciled before delivery", 75);
      }
      const action = ["add-pending", "ambiguous"].includes(record.notification.state)
        ? "list"
        : "add";
      const attempt = beginNotificationOperation(record, action, "add");
      await writeRecord(paths.record, record, root);
      return {
        done: false,
        action,
        operationId: attempt.operation_id,
        request: {
          operation_id: attempt.operation_id,
          thread_id: record.notification.recipient.thread_id,
          submission_id: record.notification.queue_submission_id,
          client_user_message_id: record.notification.client_user_message_id,
          message: action === "add"
            ? callbackPointerMessage(record.callback_id, record.notification.recipient)
            : null,
        },
      };
    });
    if (staged.done) return { status: staged.status, callback_id: id };

    // Queue RPCs are deliberately outside the journal filesystem lock.
    const outcome = await performQueueOperation(queueAdapter, staged);
    const reconciled = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
      if (!finishNotificationAttempt(record, staged.operationId, outcome)) {
        return { state: record.notification.state, integration: record.integration.state };
      }
      if (staged.action === "add") {
        if (outcome.outcome === "queued") {
          record.notification.state = "queued";
          record.notification.queue_submission_id = outcome.submission_id;
          record.notification.potentially_live = true;
        } else if (outcome.outcome === "unavailable") {
          record.notification.state = "unavailable";
          record.notification.potentially_live = false;
        } else {
          record.notification.state = "ambiguous";
          record.notification.potentially_live = true;
        }
      } else if (outcome.outcome === "found") {
        record.notification.state = "queued";
        record.notification.queue_submission_id = outcome.submission_id;
        record.notification.potentially_live = true;
      } else if (outcome.outcome === "absent") {
        record.notification.state = "not-requested";
        record.notification.queue_submission_id = null;
        record.notification.potentially_live = false;
      } else if (outcome.outcome === "started") {
        record.notification.state = "started";
        record.notification.queue_submission_id = outcome.submission_id;
        record.notification.potentially_live = false;
      } else {
        record.notification.state = "ambiguous";
        record.notification.potentially_live = true;
      }
      await writeRecord(paths.record, record, root);
      return { state: record.notification.state, integration: record.integration.state };
    });
    if (TERMINAL_INTEGRATION_STATES.has(reconciled.integration) && reconciled.state === "queued") {
      await ensureNotificationRetracted({ stateRoot, callbackId: id, queueAdapter });
      return { status: `already-${reconciled.integration}`, callback_id: id };
    }
    if (reconciled.state === "queued") return { status: "queued", callback_id: id };
    if (reconciled.state === "not-requested") continue;
    if (reconciled.state === "started") return { status: "already-started", callback_id: id };
    throw new CliError(`Terminal callback queue ${reconciled.state}; inspect before retrying`, 75);
  }
  throw new CliError("Terminal callback queue reconciliation exceeded its bounded retry limit", 75);
}

async function ensureNotificationRetracted({ stateRoot, callbackId: id, queueAdapter }) {
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const staged = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
      if (record.notification.state === "started") {
        throw new CliError("Queue notification already started and cannot be retracted", 75);
      }
      if (!record.notification.potentially_live) return { done: true, status: record.notification.state };
      if (record.notification.authority === "legacy-mixed") {
        throw new CliError("Legacy queue notification may still be live but has no retractable identity", 75);
      }
      if (record.notification.authority !== "retractable-thread-queue") {
        throw new CliError("Live callback notification has no retractable authority", 75);
      }
      const action = record.notification.queue_submission_id === null ? "list" : "delete";
      const attempt = beginNotificationOperation(record, action, "retract");
      await writeRecord(paths.record, record, root);
      return {
        done: false,
        action,
        operationId: attempt.operation_id,
        request: {
          operation_id: attempt.operation_id,
          thread_id: record.notification.recipient.thread_id,
          submission_id: record.notification.queue_submission_id,
          client_user_message_id: record.notification.client_user_message_id,
        },
      };
    });
    if (staged.done) return { status: staged.status, callback_id: id };

    // Queue RPCs are deliberately outside the journal filesystem lock.
    const outcome = await performQueueOperation(queueAdapter, staged);
    const state = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
      if (!finishNotificationAttempt(record, staged.operationId, outcome)) return record.notification.state;
      if (staged.action === "list" && outcome.outcome === "found") {
        record.notification.state = "queued";
        record.notification.queue_submission_id = outcome.submission_id;
        record.notification.potentially_live = true;
      } else if (
        (staged.action === "list" && outcome.outcome === "absent")
        || (staged.action === "delete" && ["deleted", "absent"].includes(outcome.outcome))
      ) {
        record.notification.state = "retracted";
        record.notification.potentially_live = false;
      } else if (outcome.outcome === "started") {
        record.notification.state = "started";
        record.notification.queue_submission_id = outcome.submission_id ?? record.notification.queue_submission_id;
        record.notification.potentially_live = false;
      } else {
        record.notification.state = "ambiguous";
        record.notification.potentially_live = true;
      }
      await writeRecord(paths.record, record, root);
      return record.notification.state;
    });
    if (state === "queued") continue;
    if (state === "retracted") return { status: "retracted", callback_id: id };
    if (state === "started") throw new CliError("Queue notification started before retraction", 75);
    throw new CliError("Queue notification retraction is ambiguous or unavailable", 75);
  }
  throw new CliError("Queue notification retraction exceeded its bounded retry limit", 75);
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
    if (record.integration.state === "consumed") throw new CliError("A consumed terminal callback cannot be superseded", 73);
    if (
      record.integration.state === "superseded"
      && record.integration.superseded_by_callback_id !== id
    ) throw new CliError("Terminal callback was already superseded by a different callback", 73);
    references.push(record.callback_id);
  }
  return references;
}

async function supersedeCallback({ stateRoot, callbackId: id, successorId, queueAdapter }) {
  const initial = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record }) => ({
    state: record.integration.state,
    supersededBy: record.integration.superseded_by_callback_id,
    potentiallyLive: record.notification.potentially_live,
  }));
  if (initial.state === "consumed") throw new CliError("A consumed terminal callback cannot be superseded", 73);
  if (initial.state === "superseded") {
    if (initial.supersededBy !== successorId) throw new CliError("Callback was superseded by a different callback", 73);
    return { status: "already-superseded", callback_id: id };
  }
  if (initial.state === "expired") return { status: "already-expired", callback_id: id };
  if (initial.potentiallyLive) await ensureNotificationRetracted({ stateRoot, callbackId: id, queueAdapter });
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (record.notification.state === "started" || record.notification.potentially_live) {
      throw new CliError("Callback notification is not safely retractable for supersession", 75);
    }
    if (record.integration.state === "consumed") throw new CliError("A consumed terminal callback cannot be superseded", 73);
    if (record.integration.state === "superseded") {
      if (record.integration.superseded_by_callback_id !== successorId) {
        throw new CliError("Callback was superseded by a different callback", 73);
      }
      return { status: "already-superseded", callback_id: id };
    }
    if (record.integration.state === "expired") return { status: "already-expired", callback_id: id };
    record.integration.state = "superseded";
    record.integration.superseded_by_callback_id = successorId;
    record.lifecycle.superseded_at = new Date().toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "superseded", callback_id: id };
  });
}

function validateAuthority(value) {
  const authority = requireText(value, "ordinary completion authority", { max: 48, safeId: true });
  if (!["journal-monitor", "retractable-thread-queue"].includes(authority)) {
    throw new CliError("Ordinary completion must have exactly one supported authority");
  }
  return authority;
}

export async function deliverCallback({
  stateRoot,
  receipt,
  authority = "journal-monitor",
  queueAdapter = null,
  noQueue = false,
}) {
  const selectedAuthority = validateAuthority(authority);
  if (noQueue && selectedAuthority !== "journal-monitor") {
    throw new CliError("--no-queue conflicts with retractable queue authority");
  }
  const payload = validateTerminalReceipt(receipt);
  const paths = callbackPaths(stateRoot, payload);
  const root = guardRoot(stateRoot);
  const resolved = await resolveRecipient({ stateRoot, recipient: payload.recipient });
  const prepared = await withProcessLock({
    path: paths.lock,
    guardRoot: root,
    label: `terminal callback ${paths.callbackId}`,
  }, async () => {
    let record = await readRecord(paths.record, root, { allowMissing: true });
    let created = false;
    if (record) assertReceiptUnchanged(record, payload);
    else {
      record = newCallbackRecord(payload, paths.callbackId, resolved.recipient, selectedAuthority);
      await writeRecord(paths.record, record, root);
      created = true;
    }
    const supersededIds = await loadSupersededRecords({
      stateRoot,
      receipt: payload,
      callbackId: paths.callbackId,
      root,
    });
    if (TERMINAL_INTEGRATION_STATES.has(record.integration.state)) {
      return { terminal: record.integration.state, supersededIds, created };
    }
    if (record.notification.authority === "legacy-mixed") {
      throw new CliError("Legacy mixed callback authority requires queue-turn reconciliation before reuse", 75);
    }
    if (record.notification.authority !== selectedAuthority) {
      throw new CliError("Callback authority differs from its immutable persisted authority", 73);
    }
    return { terminal: null, supersededIds, created };
  });
  if (prepared.terminal !== null) {
    return { status: `already-${prepared.terminal}`, callback_id: paths.callbackId };
  }
  if (Date.parse(payload.expires_at) <= Date.now()) {
    await expireCallback({ stateRoot, callbackId: paths.callbackId, queueAdapter });
    throw new CliError("Terminal callback expired before delivery", 73);
  }
  for (const supersededId of prepared.supersededIds) {
    await supersedeCallback({
      stateRoot,
      callbackId: supersededId,
      successorId: paths.callbackId,
      queueAdapter,
    });
  }
  if (selectedAuthority === "journal-monitor") {
    return {
      status: prepared.created ? "persisted" : "already-persisted",
      callback_id: paths.callbackId,
      recipient: resolved.recipient,
      authority: selectedAuthority,
    };
  }
  const queued = await ensureNotificationQueued({ stateRoot, callbackId: paths.callbackId, queueAdapter });
  return { ...queued, recipient: resolved.recipient, authority: selectedAuthority };
}

async function authoritativeConsumer({ stateRoot, receiptRecipient, recipient }) {
  const requested = validateRecipient(recipient, "consumer recipient");
  if (requested.lineage_id !== receiptRecipient.lineage_id) {
    throw new CliError("Consumer recipient lineage does not match the terminal callback", 73);
  }
  const resolved = await resolveRecipient({ stateRoot, recipient: requested });
  if (resolved.stale) throw new CliError("Consumer recipient binding is stale; use the current coordinator generation", 73);
  return resolved.recipient;
}

export async function observeCallback({ stateRoot, callbackId: id, recipient, source, queueAdapter = null }) {
  const observationSource = requireText(source, "observation source", { max: 32, safeId: true });
  if (!["journal-monitor", "monitor-recovery", "queue-turn"].includes(observationSource)) {
    throw new CliError("Observation source must be journal-monitor, monitor-recovery, or queue-turn");
  }
  const snapshot = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record }) => ({
    receiptRecipient: record.receipt.recipient,
    authority: record.notification.authority,
    potentiallyLive: record.notification.potentially_live,
  }));
  const consumer = await authoritativeConsumer({ stateRoot, receiptRecipient: snapshot.receiptRecipient, recipient });
  if (observationSource === "journal-monitor" && snapshot.authority !== "journal-monitor") {
    throw new CliError("Journal-monitor observation cannot consume queue-authoritative completion", 73);
  }
  if (observationSource === "monitor-recovery") {
    if (snapshot.authority === "journal-monitor") {
      throw new CliError("Monitor recovery is not the declared journal-monitor authority", 73);
    }
    if (snapshot.potentiallyLive) await ensureNotificationRetracted({ stateRoot, callbackId: id, queueAdapter });
  }
  if (observationSource === "queue-turn" && snapshot.authority === "journal-monitor") {
    throw new CliError("Queue-turn observation conflicts with journal-monitor authority", 73);
  }
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (observationSource === "queue-turn") {
      const pending = record.notification.attempts.at(-1);
      if (pending?.outcome === "pending") {
        pending.outcome = "started";
        pending.completed_at = new Date().toISOString();
        pending.reason = "queue-turn-observed";
      }
      record.notification.state = "started";
      record.notification.potentially_live = false;
    } else if (record.notification.potentially_live || record.notification.state === "started") {
      throw new CliError("Monitor observation cannot race a live or started queue notification", 75);
    }
    if (record.integration.state === "consumed") {
      await writeRecord(paths.record, record, root);
      return { status: "already-consumed", callback_id: record.callback_id };
    }
    if (["superseded", "expired"].includes(record.integration.state)) {
      await writeRecord(paths.record, record, root);
      throw new CliError(`${record.integration.state} terminal callback cannot be observed`, 73);
    }
    if (recordExpired(record)) {
      record.integration.state = "expired";
      record.lifecycle.expired_at = new Date().toISOString();
      await writeRecord(paths.record, record, root);
      throw new CliError("Expired terminal callback cannot be observed", 73);
    }
    if (record.integration.state === "observed") {
      await writeRecord(paths.record, record, root);
      return { status: "already-observed", callback_id: record.callback_id };
    }
    record.integration.state = "observed";
    record.integration.observed_by_recipient = consumer;
    record.integration.observation_source = observationSource;
    record.lifecycle.observed_at = new Date().toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "observed", callback_id: record.callback_id };
  });
}

export async function consumeCallback({ stateRoot, callbackId: id, recipient, executorId }) {
  requireText(executorId, "executor_id", { max: 128, safeId: true });
  const snapshot = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record }) => ({
    receiptRecipient: record.receipt.recipient,
  }));
  const consumer = await authoritativeConsumer({ stateRoot, receiptRecipient: snapshot.receiptRecipient, recipient });
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (executorId !== record.receipt.executor_id) throw new CliError("executor_id does not match the persisted receipt", 73);
    if (record.integration.state === "consumed") return { status: "already-consumed", callback_id: record.callback_id };
    if (["superseded", "expired"].includes(record.integration.state)) {
      throw new CliError(`${record.integration.state} terminal callback cannot be consumed`, 73);
    }
    if (recordExpired(record)) {
      if (record.notification.potentially_live) {
        throw new CliError("Expired callback still has a potentially live notification", 75);
      }
      record.integration.state = "expired";
      record.lifecycle.expired_at = new Date().toISOString();
      await writeRecord(paths.record, record, root);
      throw new CliError("Expired terminal callback cannot be consumed", 73);
    }
    if (record.integration.state !== "observed") {
      throw new CliError("Terminal callback must be observed before it can be consumed", 73);
    }
    record.integration.state = "consumed";
    record.integration.consumed_by_recipient = consumer;
    record.lifecycle.consumed_at = new Date().toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "consumed", callback_id: record.callback_id };
  });
}

export async function reconcileCallback({
  stateRoot,
  callbackId: id,
  outcome,
  result = undefined,
  submissionId = null,
}) {
  const aliases = { enqueued: "queued", "not-enqueued": "not-queued" };
  const decision = aliases[outcome ?? result] ?? (outcome ?? result);
  if (!["queued", "not-queued", "deleted", "started"].includes(decision)) {
    throw new CliError("Callback reconciliation outcome must be queued, not-queued, deleted, or started");
  }
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (record.notification.authority !== "retractable-thread-queue") {
      throw new CliError("Only capability-probed queue notifications can be reconciled", 73);
    }
    const attempt = [...record.notification.attempts].reverse().find((item) => ["pending", "ambiguous"].includes(item.outcome));
    if (!attempt) throw new CliError("Terminal callback has no ambiguous notification attempt", 73);
    const now = new Date().toISOString();
    attempt.completed_at = now;
    attempt.reason = "manual-reconciliation";
    if (decision === "queued") {
      const stableId = submissionId ?? record.notification.queue_submission_id;
      if (stableId === null) throw new CliError("Queued reconciliation requires a stable submission id");
      record.notification.queue_submission_id = requireText(stableId, "queue submission id", { max: 256, safeId: true });
      record.notification.state = "queued";
      record.notification.potentially_live = true;
      attempt.outcome = "queued";
    } else if (decision === "not-queued") {
      record.notification.state = "unavailable";
      record.notification.potentially_live = false;
      attempt.outcome = "absent";
    } else if (decision === "deleted") {
      record.notification.state = "retracted";
      record.notification.potentially_live = false;
      attempt.outcome = "deleted";
    } else {
      record.notification.state = "started";
      record.notification.potentially_live = false;
      attempt.outcome = "started";
    }
    await writeRecord(paths.record, record, root);
    return { status: record.notification.state, callback_id: record.callback_id };
  });
}

export async function expireCallback({ stateRoot, callbackId: id, now = Date.now(), queueAdapter = null }) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "string" ? Date.parse(now) : Number(now);
  if (!Number.isFinite(nowMs)) throw new CliError("expire now must be a valid timestamp");
  const snapshot = await withCallbackLock({ stateRoot, callbackId: id }, async ({ record }) => ({
    state: record.integration.state,
    due: recordExpired(record, nowMs),
    potentiallyLive: record.notification.potentially_live,
  }));
  if (snapshot.state === "expired") return { status: "already-expired", callback_id: id };
  if (["consumed", "superseded"].includes(snapshot.state)) return { status: `already-${snapshot.state}`, callback_id: id };
  if (!snapshot.due) return { status: "not-expired", callback_id: id };
  if (snapshot.potentiallyLive) await ensureNotificationRetracted({ stateRoot, callbackId: id, queueAdapter });
  return withCallbackLock({ stateRoot, callbackId: id }, async ({ record, paths, root }) => {
    if (record.integration.state === "expired") return { status: "already-expired", callback_id: id };
    if (["consumed", "superseded"].includes(record.integration.state)) {
      return { status: `already-${record.integration.state}`, callback_id: id };
    }
    if (!recordExpired(record, nowMs)) return { status: "not-expired", callback_id: id };
    if (record.notification.potentially_live) throw new CliError("Callback notification remains live after retraction", 75);
    record.integration.state = "expired";
    record.lifecycle.expired_at = new Date(nowMs).toISOString();
    await writeRecord(paths.record, record, root);
    return { status: "expired", callback_id: id };
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

export async function expireCallbacks({ stateRoot, now = Date.now(), queueAdapter = null }) {
  const journalRoot = resolve(stateRoot, "callbacks", "journal");
  const results = [];
  for (const path of await listJsonFiles(journalRoot, stateRoot)) {
    results.push(await expireCallback({ stateRoot, callbackId: basename(path, ".json"), now, queueAdapter }));
  }
  return results;
}

export async function callbackStatus(stateRoot) {
  const root = guardRoot(stateRoot);
  const journalRoot = resolve(stateRoot, "callbacks", "journal");
  const pending = [];
  let consumedCount = 0;
  const terminal = { superseded: 0, expired: 0 };
  const notificationRisks = [];
  const legacyNotificationRisks = [];
  for (const path of await listJsonFiles(journalRoot, stateRoot)) {
    const record = await readRecord(path, root);
    const age = Math.max(0, Math.floor((Date.now() - (await stat(path)).mtimeMs) / 1000));
    if (record.notification.potentially_live) {
      const risk = {
        callback_id: record.callback_id,
        integration: record.integration.state,
        authority: record.notification.authority,
        notification: record.notification.state,
      };
      notificationRisks.push(risk);
      if (record.notification.authority === "legacy-mixed") legacyNotificationRisks.push(risk);
    }
    if (record.integration.state === "consumed") {
      consumedCount += 1;
      continue;
    }
    if (record.integration.state === "superseded" || record.integration.state === "expired") {
      terminal[record.integration.state] += 1;
      continue;
    }
    pending.push({
      callback_id: record.callback_id,
      lineage_id: record.receipt.recipient.lineage_id,
      recipient_generation: record.notification.recipient.generation,
      executor_id: record.receipt.executor_id,
      run_id: record.receipt.run_id,
      sequence: record.receipt.sequence,
      classification: record.receipt.classification,
      integration: record.integration.state,
      notification_authority: record.notification.authority,
      notification: record.notification.state,
      potentially_live_notification: record.notification.potentially_live,
      effective_integration: recordExpired(record) ? "expired-due" : record.integration.state,
      age_seconds: age,
    });
  }
  return {
    pending: pending.sort((a, b) => b.age_seconds - a.age_seconds),
    consumed_count: consumedCount,
    superseded_count: terminal.superseded,
    expired_count: terminal.expired,
    notification_risk_count: notificationRisks.length,
    notification_risks: notificationRisks,
    legacy_notification_risk_count: legacyNotificationRisks.length,
    legacy_notification_risks: legacyNotificationRisks,
  };
}
