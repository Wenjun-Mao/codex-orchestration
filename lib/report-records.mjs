import { readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  readJson,
  requireEnum,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { reportRoute, REPORT_ROUTE_ID_PREFIX, withActiveReportRouteLock } from "./report-routes.mjs";

export const REPORT_ENVELOPE_SCHEMA_VERSION = 1;
export const REPORT_ENVELOPE_KIND = "codex-flow-v093-report-envelope";
export const REPORT_DELIVERY_SCHEMA_VERSION = 1;
export const REPORT_DELIVERY_KIND = "codex-flow-v093-report-delivery";
export const REPORT_RECORD_ID_PREFIX = "report-record-v1-";
export const REPORT_ATTEMPT_ID_PREFIX = "report-attempt-v1-";
export const MAX_REPORT_BYTES = 24 * 1024;

const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const RECORD_STATES = ["captured", "submitting", "accepted", "ambiguous", "conflict", "manual-required"];
const DIAGNOSTIC_CODES = [
  "queue-rejected",
  "queue-ambiguous",
  "queue-timeout",
  "queue-protocol-error",
  "post-acceptance-diagnostic",
];
const MANUAL_REASONS = ["oversize-final", "conflicting-final"];
const MAX_INPUT_CHARS = MAX_REPORT_BYTES * 4;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit timestamp`);
  }
  return result;
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function routeId(value) {
  const result = requireText(value, "route_id", { max: 128, safeId: true });
  if (!new RegExp(`^${REPORT_ROUTE_ID_PREFIX}[0-9a-f]{64}$`).test(result)) {
    throw new CliError("route_id must be a report-route-v1 ID");
  }
  return result;
}

function recordId(value) {
  const result = requireText(value, "report_id", { max: 128, safeId: true });
  if (!new RegExp(`^${REPORT_RECORD_ID_PREFIX}[0-9a-f]{64}$`).test(result)) {
    throw new CliError("report_id must be a report-record-v1 ID");
  }
  return result;
}

function safeChild(directory, filename, label = "report delivery") {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label} state path`);
  }
  return path;
}

function source(value, label = "report source") {
  requireExactFields(value, { required: ["host_id", "thread_id", "turn_id", "output_kind"] }, label);
  return {
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    turn_id: requireText(value.turn_id, `${label}.turn_id`, { max: 256, safeId: true }),
    output_kind: requireEnum(value.output_kind, ["final-assistant-output"], `${label}.output_kind`),
  };
}

function envelope(value, label = "report envelope") {
  requireExactFields(value, {
    required: ["schema_version", "kind", "classification", "text", "text_digest", "byte_length"],
  }, label);
  if (value.schema_version !== REPORT_ENVELOPE_SCHEMA_VERSION || value.kind !== REPORT_ENVELOPE_KIND) {
    throw new CliError("Unsupported report envelope authority");
  }
  const text = requireText(value.text, `${label}.text`, { max: MAX_INPUT_CHARS });
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_REPORT_BYTES) throw new CliError(`report envelope exceeds ${MAX_REPORT_BYTES} bytes`);
  const normalized = {
    schema_version: REPORT_ENVELOPE_SCHEMA_VERSION,
    kind: REPORT_ENVELOPE_KIND,
    classification: requireEnum(value.classification, ["untrusted-report-data"], `${label}.classification`),
    text,
    text_digest: digest(value.text_digest, `${label}.text_digest`),
    byte_length: value.byte_length,
  };
  if (!Number.isInteger(normalized.byte_length) || normalized.byte_length < 1 || normalized.byte_length > MAX_REPORT_BYTES) {
    throw new CliError(`${label}.byte_length must be a positive bounded integer`);
  }
  if (normalized.byte_length !== byteLength || normalized.text_digest !== sha256(text)) {
    throw new CliError("Report envelope text evidence does not match its content");
  }
  return normalized;
}

export function validateReportEnvelope(value) {
  return envelope(value);
}

function attempt(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["attempt_id", "started_at"] }, "report delivery attempt");
  const normalized = {
    attempt_id: requireText(value.attempt_id, "report delivery attempt_id", { max: 128, safeId: true }),
    started_at: timestamp(value.started_at, "report delivery attempt.started_at"),
  };
  if (!new RegExp(`^${REPORT_ATTEMPT_ID_PREFIX}[0-9a-f]{64}$`).test(normalized.attempt_id)) {
    throw new CliError("report delivery attempt_id must be a report-attempt-v1 ID");
  }
  return normalized;
}

function queueAcceptance(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["client_message_id", "accepted_at"] }, "report queue acceptance");
  return {
    client_message_id: requireText(value.client_message_id, "report queue client_message_id", { max: 256 }),
    accepted_at: timestamp(value.accepted_at, "report queue accepted_at"),
  };
}

function diagnostic(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["code", "detail_digest", "observed_at"] }, "report diagnostic");
  return {
    code: requireEnum(value.code, DIAGNOSTIC_CODES, "report diagnostic.code"),
    detail_digest: digest(value.detail_digest, "report diagnostic.detail_digest"),
    observed_at: timestamp(value.observed_at, "report diagnostic.observed_at"),
  };
}

function conflict(value) {
  if (value === null) return null;
  requireExactFields(value, { required: ["text_digest", "byte_length", "observed_at"] }, "report conflict");
  const normalized = {
    text_digest: digest(value.text_digest, "report conflict.text_digest"),
    byte_length: value.byte_length,
    observed_at: timestamp(value.observed_at, "report conflict.observed_at"),
  };
  if (!Number.isInteger(normalized.byte_length) || normalized.byte_length < 1) {
    throw new CliError("report conflict.byte_length must be a positive integer");
  }
  return normalized;
}

function reportIdentity(value) {
  return { route_id: value.route_id, source: value.source };
}

export function reportRecordIdFor(value) {
  const identity = {
    route_id: routeId(value.route_id),
    source: source(value.source),
  };
  return `${REPORT_RECORD_ID_PREFIX}${sha256(stableStringify(identity))}`;
}

export function validateReportDelivery(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "report_id", "route_id", "source", "source_text_digest",
      "source_byte_length", "envelope", "state", "attempt", "queue_acceptance", "diagnostic",
      "conflict", "manual_reason", "captured_at", "updated_at",
    ],
  }, "Report delivery record");
  if (value.schema_version !== REPORT_DELIVERY_SCHEMA_VERSION || value.kind !== REPORT_DELIVERY_KIND) {
    throw new CliError("Unsupported report delivery authority");
  }
  const normalized = {
    schema_version: REPORT_DELIVERY_SCHEMA_VERSION,
    kind: REPORT_DELIVERY_KIND,
    report_id: recordId(value.report_id),
    route_id: routeId(value.route_id),
    source: source(value.source),
    source_text_digest: digest(value.source_text_digest, "report source_text_digest"),
    source_byte_length: value.source_byte_length,
    envelope: value.envelope === null ? null : envelope(value.envelope),
    state: requireEnum(value.state, RECORD_STATES, "report delivery state"),
    attempt: attempt(value.attempt),
    queue_acceptance: queueAcceptance(value.queue_acceptance),
    diagnostic: diagnostic(value.diagnostic),
    conflict: conflict(value.conflict),
    manual_reason: value.manual_reason === null
      ? null
      : requireEnum(value.manual_reason, MANUAL_REASONS, "report manual_reason"),
    captured_at: timestamp(value.captured_at, "report captured_at"),
    updated_at: timestamp(value.updated_at, "report updated_at"),
  };
  if (!Number.isInteger(normalized.source_byte_length) || normalized.source_byte_length < 1) {
    throw new CliError("report source_byte_length must be a positive integer");
  }
  if (normalized.report_id !== reportRecordIdFor(normalized)) {
    throw new CliError("report_id does not match its source route and turn");
  }
  if (normalized.envelope !== null && (
    normalized.envelope.text_digest !== normalized.source_text_digest
    || normalized.envelope.byte_length !== normalized.source_byte_length
  )) throw new CliError("Report envelope does not match its source final");
  const hasAttempt = normalized.attempt !== null;
  const hasAcceptance = normalized.queue_acceptance !== null;
  const hasConflict = normalized.conflict !== null;
  const manual = normalized.manual_reason !== null;
  if (normalized.state === "captured" && (hasAttempt || hasAcceptance || normalized.diagnostic !== null || hasConflict || manual || normalized.envelope === null)) {
    throw new CliError("Captured report state has invalid delivery evidence");
  }
  if (normalized.state === "submitting" && (!hasAttempt || hasAcceptance || normalized.diagnostic !== null || hasConflict || manual || normalized.envelope === null)) {
    throw new CliError("Submitting report state has invalid delivery evidence");
  }
  if (normalized.state === "accepted" && (!hasAttempt || !hasAcceptance || hasConflict || manual || normalized.envelope === null)) {
    throw new CliError("Accepted report state has invalid delivery evidence");
  }
  if (normalized.state === "ambiguous" && (!hasAttempt || hasAcceptance || normalized.diagnostic === null || hasConflict || manual || normalized.envelope === null)) {
    throw new CliError("Ambiguous report state has invalid delivery evidence");
  }
  if (normalized.state === "conflict" && (!hasConflict || normalized.manual_reason !== "conflicting-final" || hasAcceptance)) {
    throw new CliError("Conflicting report state has invalid conflict evidence");
  }
  if (normalized.state === "manual-required" && (
    normalized.manual_reason !== "oversize-final" || normalized.envelope !== null || hasAttempt || hasAcceptance || normalized.diagnostic !== null || hasConflict
  )) throw new CliError("Manual-required report state must preserve an oversize failure");
  if (Date.parse(normalized.updated_at) < Date.parse(normalized.captured_at)) {
    throw new CliError("Report update precedes capture");
  }
  return normalized;
}

function paths(stateRoot, id) {
  const report = recordId(id);
  const root = resolve(stateRoot, "reports", "deliveries");
  return {
    record: safeChild(resolve(root, "records"), `${report}.json`),
    lock: safeChild(resolve(root, "locks"), `${report}.lock.json`),
  };
}

async function readRecord(stateRoot, id, { allowMissing = false } = {}) {
  const value = await readJson(paths(stateRoot, id).record, {
    allowMissing,
    guardRoot: guardRoot(stateRoot),
  });
  return value === null ? null : validateReportDelivery(value);
}

async function writeRecord(stateRoot, record) {
  const validated = validateReportDelivery(record);
  await atomicWriteJson(paths(stateRoot, validated.report_id).record, validated, {
    guardRoot: guardRoot(stateRoot),
    mode: 0o600,
  });
  return validated;
}

async function withRecordLock(stateRoot, id, operation, { allowMissing = false } = {}) {
  return withProcessLock({
    path: paths(stateRoot, id).lock,
    guardRoot: guardRoot(stateRoot),
    label: `report delivery ${id}`,
  }, async () => {
    const record = await readRecord(stateRoot, id, { allowMissing });
    return operation(record);
  });
}

function assertSourceMatchesRoute(sourceEvidence, route) {
  if (
    sourceEvidence.host_id !== route.sender.host_id
    || sourceEvidence.thread_id !== route.sender.thread_id
  ) throw new CliError("Report source does not match its authenticated route sender", 73);
}

function finalEvidence(finalText) {
  if (typeof finalText !== "string" || finalText.length === 0 || finalText.length > MAX_INPUT_CHARS) {
    throw new CliError(`final_text must be a non-empty string of at most ${MAX_INPUT_CHARS} characters`);
  }
  return { digest: sha256(finalText), byte_length: Buffer.byteLength(finalText, "utf8") };
}

function captureRecord({ routeId, source, finalText, now }) {
  const evidence = finalEvidence(finalText);
  const capturedAt = new Date(now).toISOString();
  const common = {
    schema_version: REPORT_DELIVERY_SCHEMA_VERSION,
    kind: REPORT_DELIVERY_KIND,
    report_id: reportRecordIdFor({ route_id: routeId, source }),
    route_id: routeId,
    source,
    source_text_digest: evidence.digest,
    source_byte_length: evidence.byte_length,
    attempt: null,
    queue_acceptance: null,
    diagnostic: null,
    conflict: null,
    captured_at: capturedAt,
    updated_at: capturedAt,
  };
  if (evidence.byte_length > MAX_REPORT_BYTES) {
    return validateReportDelivery({
      ...common,
      envelope: null,
      state: "manual-required",
      manual_reason: "oversize-final",
    });
  }
  return validateReportDelivery({
    ...common,
    envelope: {
      schema_version: REPORT_ENVELOPE_SCHEMA_VERSION,
      kind: REPORT_ENVELOPE_KIND,
      classification: "untrusted-report-data",
      text: finalText,
      text_digest: evidence.digest,
      byte_length: evidence.byte_length,
    },
    state: "captured",
    manual_reason: null,
  });
}

/** Captures the exact final once. Callers must submit only after this returns captured. */
export async function captureReport({ stateRoot, routeId: id, source: sourceInput, finalText, now = Date.now() }) {
  return withActiveReportRouteLock({ stateRoot, routeId: id }, async (route) => {
    const sourceEvidence = source(sourceInput);
    assertSourceMatchesRoute(sourceEvidence, route);
    const candidate = captureRecord({ routeId: route.route_id, source: sourceEvidence, finalText, now });
    return withRecordLock(stateRoot, candidate.report_id, async (existing) => {
      if (existing === null) {
        await writeRecord(stateRoot, candidate);
        return { status: candidate.state === "captured" ? "captured" : "manual-required", report: candidate };
      }
      if (existing.source_text_digest === candidate.source_text_digest && existing.source_byte_length === candidate.source_byte_length) {
        return { status: `already-${existing.state}`, report: existing };
      }
      if (existing.state === "accepted") {
        throw new CliError("Conflicting final cannot replace an accepted report", 73);
      }
      const next = validateReportDelivery({
        ...existing,
        state: "conflict",
        attempt: existing.attempt,
        queue_acceptance: null,
        diagnostic: existing.diagnostic,
        conflict: {
          text_digest: candidate.source_text_digest,
          byte_length: candidate.source_byte_length,
          observed_at: new Date(now).toISOString(),
        },
        manual_reason: "conflicting-final",
        updated_at: new Date(now).toISOString(),
      });
      await writeRecord(stateRoot, next);
      return { status: "conflict", report: next };
    }, { allowMissing: true });
  });
}

export async function beginReportSubmission({ stateRoot, reportId: id, now = Date.now() }) {
  const snapshot = await readRecord(stateRoot, id);
  return withActiveReportRouteLock({ stateRoot, routeId: snapshot.route_id }, async () => {
    return withRecordLock(stateRoot, id, async (record) => {
      if (record.state !== "captured") return { status: `already-${record.state}`, report: record };
      const next = validateReportDelivery({
        ...record,
        state: "submitting",
        attempt: {
          attempt_id: `${REPORT_ATTEMPT_ID_PREFIX}${sha256(stableStringify({ report_id: record.report_id, route_id: record.route_id }))}`,
          started_at: new Date(now).toISOString(),
        },
        updated_at: new Date(now).toISOString(),
      });
      await writeRecord(stateRoot, next);
      return { status: "submission-prepared", report: next };
    });
  });
}

export async function acceptReportSubmission({ stateRoot, reportId: id, clientMessageId, now = Date.now() }) {
  const clientId = requireText(clientMessageId, "client_message_id", { max: 256 });
  return withRecordLock(stateRoot, id, async (record) => {
    if (record.state === "accepted") {
      if (record.queue_acceptance.client_message_id !== clientId) {
        throw new CliError("Report was accepted with a different native queue ID", 73);
      }
      return { status: "already-accepted", report: record };
    }
    if (record.state !== "submitting") throw new CliError("Report submission was not prepared", 73);
    const next = validateReportDelivery({
      ...record,
      state: "accepted",
      queue_acceptance: { client_message_id: clientId, accepted_at: new Date(now).toISOString() },
      updated_at: new Date(now).toISOString(),
    });
    await writeRecord(stateRoot, next);
    return { status: "accepted", report: next };
  });
}

export async function markReportSubmissionAmbiguous({
  stateRoot,
  reportId: id,
  code = "queue-ambiguous",
  detail,
  now = Date.now(),
}) {
  const diagnosticCode = requireEnum(code, DIAGNOSTIC_CODES, "report diagnostic code");
  const detailDigest = sha256(requireText(detail, "report diagnostic detail", { max: 8192 }));
  return withRecordLock(stateRoot, id, async (record) => {
    if (record.state === "accepted") {
      // Acceptance is durable evidence. A later client-side diagnostic must not
      // rewrite it into ambiguity or trigger an automatic retry.
      if (record.diagnostic !== null) return { status: "already-accepted", report: record };
      const next = validateReportDelivery({
        ...record,
        diagnostic: {
          code: "post-acceptance-diagnostic",
          detail_digest: detailDigest,
          observed_at: new Date(now).toISOString(),
        },
        updated_at: new Date(now).toISOString(),
      });
      await writeRecord(stateRoot, next);
      return { status: "accepted-with-diagnostic", report: next };
    }
    if (record.state === "ambiguous") return { status: "already-ambiguous", report: record };
    if (record.state !== "submitting") throw new CliError("Report submission was not prepared", 73);
    const next = validateReportDelivery({
      ...record,
      state: "ambiguous",
      diagnostic: {
        code: diagnosticCode,
        detail_digest: detailDigest,
        observed_at: new Date(now).toISOString(),
      },
      updated_at: new Date(now).toISOString(),
    });
    await writeRecord(stateRoot, next);
    return { status: "ambiguous", report: next };
  });
}

export async function reportDelivery({ stateRoot, reportId: id }) {
  return readRecord(stateRoot, id);
}

export async function reportDeliveries({ stateRoot, routeId: routeFilter = null }) {
  if (routeFilter !== null) routeId(routeFilter);
  const root = resolve(stateRoot, "reports", "deliveries", "records");
  await assertNoSymlinkComponents(guardRoot(stateRoot), root, "Report delivery state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new CliError(`Report delivery state contains a symbolic link: ${entry.name}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateReportDelivery(await readJson(safeChild(root, entry.name, "report delivery"), {
      guardRoot: guardRoot(stateRoot),
    }));
    if (routeFilter === null || record.route_id === routeFilter) result.push(record);
  }
  return result;
}

/**
 * Cleanup callers can use this read-only status instead of deleting reports:
 * captured, in-flight, ambiguous, conflict, and manual records remain visible
 * and require an explicit human disposition outside this primitive.
 */
export async function reportCleanupStatus({ stateRoot, routeId: id }) {
  const route = await reportRoute({ stateRoot, routeId: id });
  const records = await reportDeliveries({ stateRoot, routeId: route.route_id });
  const blocking = records.filter((record) => !["accepted"].includes(record.state));
  return {
    route_id: route.route_id,
    route_state: route.state,
    cleanup_eligible: route.state === "closed" && blocking.length === 0,
    blocking_reports: blocking.map((record) => ({ report_id: record.report_id, state: record.state })),
    accepted_reports: records.filter((record) => record.state === "accepted").map((record) => record.report_id),
  };
}
