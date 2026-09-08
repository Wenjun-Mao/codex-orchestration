import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
  basename,
  isAbsolute,
  resolve,
} from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  isPlainObject,
  requireText,
  sha256,
  stableStringify,
} from "../../core.mjs";
import { classifyCodexAppArchiveObservation } from "./archive-observation.mjs";

export const PRIVATE_ARCHIVE_OBSERVATION_KIND = "codex-flow-codex-app-private-archive-observation-v1";
export const PRIVATE_ARCHIVE_OBSERVATION_SOURCE = "codex-app-private-archive-session-v1";

const SESSION_CHUNK_BYTES = 64 * 1024;
const MAX_SESSION_STREAM_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 50_000;
const MAX_SESSION_LINES = 1_000_000;
const MAX_SESSION_RECORD_BYTES = 32 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const EMPTY_BUFFER = Buffer.alloc(0);

function absolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (Number.isNaN(Date.parse(result))) throw new CliError(`${label} must be an ISO-8601 timestamp`);
  return result;
}

function nowIso(now) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Private archive observation clock must be finite");
  return new Date(milliseconds).toISOString();
}

function codexHomePath(value) {
  const configured = value ?? process.env.CODEX_HOME;
  return absolutePath(
    configured && configured.trim() !== "" ? configured : resolve(homedir(), ".codex"),
    "Codex home",
  );
}

function boundedLimit(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new CliError(`${label} must be a positive integer no greater than its configured maximum`);
  }
  return value;
}

function observerLimits(overrides) {
  if (overrides === undefined) {
    return {
      chunkBytes: SESSION_CHUNK_BYTES,
      maxSessionBytes: MAX_SESSION_STREAM_BYTES,
      maxSessionLines: MAX_SESSION_LINES,
      maxSessionRecordBytes: MAX_SESSION_RECORD_BYTES,
    };
  }
  if (!isPlainObject(overrides)) throw new CliError("Private archive observer resource limits must be an object");
  const keys = Object.keys(overrides).sort();
  const expected = [
    "chunkBytes",
    "maxSessionBytes",
    "maxSessionLines",
    "maxSessionRecordBytes",
  ].sort();
  if (stableStringify(keys) !== stableStringify(expected)) {
    throw new CliError("Private archive observer resource limits must specify every bounded limit");
  }
  const limits = {
    chunkBytes: boundedLimit(overrides.chunkBytes, SESSION_CHUNK_BYTES, "Private archive observer chunk limit"),
    maxSessionBytes: boundedLimit(overrides.maxSessionBytes, MAX_SESSION_STREAM_BYTES, "Private archive observer byte limit"),
    maxSessionLines: boundedLimit(overrides.maxSessionLines, MAX_SESSION_LINES, "Private archive observer line limit"),
    maxSessionRecordBytes: boundedLimit(
      overrides.maxSessionRecordBytes,
      MAX_SESSION_RECORD_BYTES,
      "Private archive observer record limit",
    ),
  };
  if (limits.chunkBytes > limits.maxSessionRecordBytes) {
    throw new CliError("Private archive observer chunk limit exceeds its record limit");
  }
  return limits;
}

function sameFileIdentity(before, after) {
  return (
    after.isFile()
    && before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs
  );
}

function parseSessionLine(line, lineNumber, metadata) {
  const text = line.toString("utf8");
  if (text.trim() === "") return;
  metadata.lineCount += 1;
  if (metadata.lineCount > metadata.limits.maxSessionLines) {
    throw new CliError("Codex App archived task session exceeds the configured non-empty line limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    metadata.failure ??= new CliError(`Codex App archived task session contains invalid JSON on line ${lineNumber}`);
    return;
  }
  if (!isPlainObject(value)) {
    metadata.failure ??= new CliError(`Codex App archived task session contains invalid JSON on line ${lineNumber}`);
    return;
  }
  if (value.type === "session_meta" && isPlainObject(value.payload)) {
    metadata.count += 1;
    if (metadata.count === 1) metadata.payload = value.payload;
  }
}

function appendPartialSegment(segments, partialBytes, segment, limits) {
  if (partialBytes + segment.length > limits.maxSessionRecordBytes) {
    throw new CliError("Codex App archived task session contains a record exceeding the configured byte limit");
  }
  if (segment.length > 0) segments.push(Buffer.from(segment));
  return partialBytes + segment.length;
}

function takeCompleteRecord(segments, partialBytes, terminalSegment, limits) {
  const recordLength = partialBytes + terminalSegment.length;
  if (recordLength > limits.maxSessionRecordBytes) {
    throw new CliError("Codex App archived task session contains a record exceeding the configured byte limit");
  }
  if (segments.length === 0) return terminalSegment;
  if (terminalSegment.length === 0 && segments.length === 1) return segments[0];
  return Buffer.concat([...segments, terminalSegment], recordLength);
}

function sessionMetadata(metadata, threadId) {
  if (metadata.lineCount === 0) {
    throw new CliError("Codex App archived task session has an unsupported line count");
  }
  if (metadata.count !== 1) {
    throw new CliError("Codex App archived task session must contain one session_meta record");
  }
  const payload = metadata.payload;
  if (payload.id !== threadId || payload.thread_source !== "agent_created_thread") {
    throw new CliError("Codex App archived task session metadata does not match the exact task");
  }
  absolutePath(payload.cwd, "Codex App archived task session cwd");
  return {
    host_cli_version: payload.cli_version === undefined
      ? null
      : requireText(payload.cli_version, "private archive host CLI version", { max: 64 }),
  };
}

/**
 * Construct the lower-level session reader used by the archive observer.
 *
 * The optional hook is dependency injection for deterministic adapter tests;
 * the public archive-observation API never accepts or invokes caller code
 * while a private session descriptor is open.
 */
export function createPrivateArchiveSessionReader({ onReadChunk, openFile = open } = {}) {
  if (onReadChunk !== undefined && typeof onReadChunk !== "function") {
    throw new CliError("Private archive session reader hook must be a function");
  }
  if (typeof openFile !== "function") throw new CliError("Private archive session reader opener must be a function");
  return async function stableSession(root, path, label, threadId, limits) {
    await assertNoSymlinkComponents(root, path, label);
    const before = await lstat(path).catch((error) => {
      if (error?.code === "ENOENT") throw new CliError(`${label} is unavailable`);
      throw error;
    });
    if (!before.isFile() || before.size < 1) {
      throw new CliError(`${label} must be a regular non-empty file`);
    }
    if (before.size > limits.maxSessionBytes) {
      throw new CliError(`${label} exceeds the configured streaming byte limit`);
    }
    const handle = await openFile(path, "r");
    const digest = createHash("sha256");
    const metadata = { count: 0, payload: null, lineCount: 0, limits, failure: null };
    let partialSegments = [];
    let partialBytes = 0;
    let recordNumber = 1;
    let bytesRead = 0;
    let opened;
    let descriptorAfter;
    try {
      opened = await handle.stat();
      if (!sameFileIdentity(before, opened)) {
        throw new CliError(`${label} changed while it was being read`, 75);
      }
      const chunk = Buffer.allocUnsafe(limits.chunkBytes);
      for (;;) {
        const result = await handle.read(chunk, 0, chunk.length, null);
        if (result.bytesRead === 0) break;
        const bytes = chunk.subarray(0, result.bytesRead);
        bytesRead += bytes.length;
        if (bytesRead > limits.maxSessionBytes) {
          throw new CliError(`${label} exceeds the configured streaming byte limit`);
        }
        digest.update(bytes);
        let offset = 0;
        for (let index = 0; index < bytes.length; index += 1) {
          if (bytes[index] !== 0x0a) continue;
          const segment = bytes.subarray(offset, index);
          const record = takeCompleteRecord(partialSegments, partialBytes, segment, limits);
          partialSegments = [];
          partialBytes = 0;
          parseSessionLine(record, recordNumber, metadata);
          recordNumber += 1;
          offset = index + 1;
        }
        if (offset < bytes.length) {
          partialBytes = appendPartialSegment(
            partialSegments,
            partialBytes,
            bytes.subarray(offset),
            limits,
          );
        }
        await onReadChunk?.({ bytesRead });
      }
      if (partialBytes > 0) {
        const record = takeCompleteRecord(partialSegments, partialBytes, EMPTY_BUFFER, limits);
        partialSegments = [];
        partialBytes = 0;
        parseSessionLine(record, recordNumber, metadata);
      }
      descriptorAfter = await handle.stat();
    } finally {
      await handle.close();
    }
    await assertNoSymlinkComponents(root, path, label);
    const after = await lstat(path);
    if (
      !sameFileIdentity(before, opened)
      || !sameFileIdentity(before, descriptorAfter)
      || !sameFileIdentity(before, after)
      || bytesRead !== descriptorAfter.size
    ) {
      throw new CliError(`${label} changed while it was being read`, 75);
    }
    if (metadata.failure !== null) throw metadata.failure;
    return {
      digest: digest.digest("hex"),
      metadata: sessionMetadata(metadata, threadId),
    };
  };
}

const stableSession = createPrivateArchiveSessionReader();

async function matchingSessions(codexHome, directoryName, threadId, maxDepth) {
  const root = resolve(codexHome, directoryName);
  await assertNoSymlinkComponents(codexHome, root, `Codex App ${directoryName} root`);
  const suffix = `-${threadId}.jsonl`;
  const pending = [{ path: root, depth: 0 }];
  const candidates = [];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      visited += 1;
      if (visited > MAX_SESSION_ENTRIES) {
        throw new CliError(`Codex App ${directoryName} inventory exceeds the bounded observer limit`);
      }
      const path = resolve(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.endsWith(suffix)) {
          throw new CliError(`Codex App ${directoryName} task candidate is a symbolic link`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) pending.push({ path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        candidates.push(path);
      }
    }
  }
  return candidates.sort();
}

export function privateArchiveObservationDigest(value) {
  return sha256(stableStringify({
    schema_version: 1,
    kind: PRIVATE_ARCHIVE_OBSERVATION_KIND,
    source: PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
    thread_id: value.thread_id,
    session_digest: value.session_digest,
    active_session_absent: value.active_session_absent,
    app_version: value.app_version,
    host_cli_version: value.host_cli_version,
    observed_at: value.observed_at,
  }));
}

export function validatePrivateArchiveObservation(value, label = "private archive observation") {
  if (!isPlainObject(value)) throw new CliError(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [
    "active_session_absent", "app_version", "binding_digest", "host_cli_version",
    "kind", "observed_at", "schema_version", "session_digest", "source", "thread_id",
  ].sort();
  if (stableStringify(keys) !== stableStringify(expected)) {
    throw new CliError(`${label} has unexpected or missing fields`);
  }
  if (
    value.schema_version !== 1
    || value.kind !== PRIVATE_ARCHIVE_OBSERVATION_KIND
    || value.source !== PRIVATE_ARCHIVE_OBSERVATION_SOURCE
    || value.active_session_absent !== true
    || value.app_version !== null
  ) throw new CliError(`${label} has unsupported authority`);
  const result = {
    schema_version: 1,
    kind: PRIVATE_ARCHIVE_OBSERVATION_KIND,
    source: PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    binding_digest: requireText(value.binding_digest, `${label}.binding_digest`, { max: 64 }),
    session_digest: requireText(value.session_digest, `${label}.session_digest`, { max: 64 }),
    active_session_absent: true,
    app_version: null,
    host_cli_version: value.host_cli_version === null
      ? null
      : requireText(value.host_cli_version, `${label}.host_cli_version`, { max: 64 }),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
  };
  if (!DIGEST.test(result.binding_digest) || !DIGEST.test(result.session_digest)) {
    throw new CliError(`${label} digests must be lowercase SHA-256 values`);
  }
  if (result.binding_digest !== privateArchiveObservationDigest(result)) {
    throw new CliError(`${label}.binding_digest is invalid`);
  }
  return result;
}

export async function observeCodexAppPrivateArchive({
  threadId,
  codexHome,
  now = Date.now(),
  resourceLimits,
}) {
  const home = codexHomePath(codexHome);
  const task = requireText(threadId, "thread_id", { max: 256, safeId: true });
  const limits = observerLimits(resourceLimits);
  const activeBefore = await matchingSessions(home, "sessions", task, 4);
  if (activeBefore.length !== 0) {
    throw new CliError("Codex App still retains the exact task in active sessions");
  }
  const archivedBefore = await matchingSessions(home, "archived_sessions", task, 1);
  if (archivedBefore.length !== 1) {
    throw new CliError("Codex App private archived task session is missing or ambiguous");
  }
  const sessionPath = archivedBefore[0];
  if (!basename(sessionPath).endsWith(`-${task}.jsonl`)) {
    throw new CliError("Codex App archived task session filename is not canonical");
  }
  const session = await stableSession(
    home,
    sessionPath,
    "Codex App private archived task session",
    task,
    limits,
  );
  const [activeAfter, archivedAfter] = await Promise.all([
    matchingSessions(home, "sessions", task, 4),
    matchingSessions(home, "archived_sessions", task, 1),
  ]);
  if (activeAfter.length !== 0 || stableStringify(archivedAfter) !== stableStringify(archivedBefore)) {
    throw new CliError("Codex App task archive placement changed while it was being observed", 75);
  }
  const observation = {
    schema_version: 1,
    kind: PRIVATE_ARCHIVE_OBSERVATION_KIND,
    source: PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
    thread_id: task,
    binding_digest: "",
    session_digest: session.digest,
    active_session_absent: true,
    app_version: null,
    host_cli_version: session.metadata.host_cli_version,
    observed_at: nowIso(now),
  };
  observation.binding_digest = privateArchiveObservationDigest(observation);
  return validatePrivateArchiveObservation(observation);
}

export async function observeCodexAppArchiveEvidence(options) {
  const observation = await observeCodexAppPrivateArchive(options);
  return classifyCodexAppArchiveObservation({
    threadId: observation.thread_id,
    activeSessionCount: 0,
    archivedSessionDigests: [observation.session_digest],
    observedAt: observation.observed_at,
    source: "codex-app-private",
    sourceVersion: observation.host_cli_version,
  });
}
