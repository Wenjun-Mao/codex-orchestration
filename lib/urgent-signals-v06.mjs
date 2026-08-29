import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  readJson,
  requireExactFields,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import {
  consumeUrgentSignal as consumeLegacyUrgentSignal,
  expireUrgentSignal as expireLegacyUrgentSignal,
  observeUrgentSignal as observeLegacyUrgentSignal,
  persistUrgentSignal as persistLegacyUrgentSignal,
  prepareUrgentAttempt as prepareLegacyUrgentAttempt,
  reconcileUrgentAttempt as reconcileLegacyUrgentAttempt,
  urgentAttemptIdFor,
  urgentIdFor,
  urgentSignalPaths,
  urgentSignalRecord as legacyUrgentSignalRecord,
  urgentSignalStatus as legacyUrgentSignalStatus,
  validateUrgentSignal,
  validateUrgentSignalRecord as validateLegacyUrgentSignalRecord,
} from "./urgent-signals.mjs";

const ONE_SHOT_ERROR = "v0.6 urgent delivery permits exactly one direct attempt";

export function validateUrgentSignalV06(value) {
  return validateUrgentSignal(value);
}

export function validateUrgentSignalRecordV06(value) {
  const record = validateLegacyUrgentSignalRecord(value);
  if (record.attempts.length > 1) {
    throw new CliError(ONE_SHOT_ERROR, 73);
  }
  if (record.attempts.some((attempt) => attempt.retry_reason !== null)) {
    throw new CliError("v0.6 urgent delivery does not accept retry_reason", 73);
  }
  if (record.attempts.some((attempt) => attempt.attempt_sequence !== 1)) {
    throw new CliError(ONE_SHOT_ERROR, 73);
  }
  return record;
}

export function urgentIdForV06(value) {
  return urgentIdFor(validateUrgentSignalV06(value));
}

export function urgentAttemptIdForV06(urgentId, recipient) {
  return urgentAttemptIdFor(urgentId, 1, recipient);
}

export function urgentSignalPathsV06(stateRoot, signal) {
  return urgentSignalPaths(stateRoot, validateUrgentSignalV06(signal));
}

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

async function validateStoredSignalIfPresent(stateRoot, signal) {
  const root = guardRoot(stateRoot);
  const raw = await readJson(urgentSignalPathsV06(stateRoot, signal).record, {
    allowMissing: true,
    guardRoot: root,
  });
  return raw === null ? null : validateUrgentSignalRecordV06(raw);
}

export async function urgentSignalRecordV06({ stateRoot, urgentId }) {
  return validateUrgentSignalRecordV06(await legacyUrgentSignalRecord({
    stateRoot,
    urgentId,
  }));
}

async function operateOnOneShotRecord({ stateRoot, urgentId }, operation) {
  await urgentSignalRecordV06({ stateRoot, urgentId });
  try {
    return await operation();
  } finally {
    // Validate after failures as well: an underlying partial transition must
    // never turn a v0.6 journal into retry-capable authority.
    await urgentSignalRecordV06({ stateRoot, urgentId });
  }
}

export async function persistUrgentSignalV06(options) {
  requireExactFields(options, {
    required: ["stateRoot", "signal"],
    optional: ["now"],
  }, "v0.6 urgent persistence request");
  const signal = validateUrgentSignalV06(options.signal);
  await validateStoredSignalIfPresent(options.stateRoot, signal);
  for (const predecessorId of signal.supersedes_urgent_ids) {
    await urgentSignalRecordV06({
      stateRoot: options.stateRoot,
      urgentId: predecessorId,
    });
  }
  const result = await persistLegacyUrgentSignal({
    stateRoot: options.stateRoot,
    signal,
    ...(Object.hasOwn(options, "now") ? { now: options.now } : {}),
  });
  await urgentSignalRecordV06({
    stateRoot: options.stateRoot,
    urgentId: result.urgent_id,
  });
  return result;
}

export async function prepareUrgentAttemptV06(options) {
  requireExactFields(options, {
    required: ["stateRoot", "urgentId"],
    optional: ["attemptSequence", "retryReason", "now"],
  }, "v0.6 urgent attempt request");
  const attemptSequence = options.attemptSequence ?? 1;
  const retryReason = options.retryReason ?? null;
  if (attemptSequence !== 1) throw new CliError(ONE_SHOT_ERROR, 73);
  if (retryReason !== null) {
    throw new CliError("v0.6 urgent delivery does not accept retry_reason", 73);
  }
  return operateOnOneShotRecord(options, () => prepareLegacyUrgentAttempt({
    stateRoot: options.stateRoot,
    urgentId: options.urgentId,
    attemptSequence: 1,
    retryReason: null,
    ...(Object.hasOwn(options, "now") ? { now: options.now } : {}),
  }));
}

export async function reconcileUrgentAttemptV06(options) {
  return operateOnOneShotRecord(options, () => reconcileLegacyUrgentAttempt(options));
}

export async function observeUrgentSignalV06(options) {
  return operateOnOneShotRecord(options, () => observeLegacyUrgentSignal(options));
}

export async function consumeUrgentSignalV06(options) {
  return operateOnOneShotRecord(options, () => consumeLegacyUrgentSignal(options));
}

export async function expireUrgentSignalV06(options) {
  return operateOnOneShotRecord(options, () => expireLegacyUrgentSignal(options));
}

async function validateJournalDirectory(stateRoot, directory, runId) {
  const root = guardRoot(stateRoot);
  await assertNoSymlinkComponents(root, directory, "v0.6 urgent-signal journal");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new CliError(`v0.6 urgent-signal journal contains a symbolic link: ${path}`, 73);
    }
    if (entry.isDirectory()) {
      await validateJournalDirectory(stateRoot, path, runId);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const raw = await readJson(path, { guardRoot: root });
      if (runId === null || raw?.signal?.run_id === runId) {
        validateUrgentSignalRecordV06(raw);
      }
    }
  }
}

async function validateJournalV06(stateRoot, runId) {
  await validateJournalDirectory(
    stateRoot,
    resolve(stateRoot, "urgent-signals", "journal"),
    runId,
  );
}

export async function urgentSignalStatusV06(stateRoot, options = {}) {
  const runId = options.runId ?? null;
  await validateJournalV06(stateRoot, runId);
  const result = await legacyUrgentSignalStatus(stateRoot, options);
  await validateJournalV06(stateRoot, runId);
  if (result.sender_attempt_duplicate_count !== 0) {
    throw new CliError("v0.6 urgent status found retry-capable delivery evidence", 73);
  }
  return result;
}
