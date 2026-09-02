import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
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
} from "./core.mjs";

export const PRIVATE_ARCHIVE_OBSERVATION_KIND = "codex-flow-v07-private-archive-observation";
export const PRIVATE_ARCHIVE_OBSERVATION_SOURCE = "codex-app-private-archive-session-v1";

const MAX_SESSION_BYTES = 32 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 50_000;
const MAX_SESSION_LINES = 20_000;
const DIGEST = /^[0-9a-f]{64}$/;

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

async function stableFile(root, path, label) {
  await assertNoSymlinkComponents(root, path, label);
  const before = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") throw new CliError(`${label} is unavailable`);
    throw error;
  });
  if (!before.isFile() || before.size < 1 || before.size > MAX_SESSION_BYTES) {
    throw new CliError(`${label} must be a bounded regular file`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    !after.isFile()
    || before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || bytes.length !== after.size
  ) throw new CliError(`${label} changed while it was being read`, 75);
  return { bytes, digest: sha256(bytes) };
}

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

function sessionMetadata(bytes, threadId) {
  const lines = bytes.toString("utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0 || lines.length > MAX_SESSION_LINES) {
    throw new CliError("Codex App archived task session has an unsupported line count");
  }
  const rows = lines.map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (!isPlainObject(value)) throw new Error("not an object");
      return value;
    } catch {
      throw new CliError(`Codex App archived task session contains invalid JSON on line ${index + 1}`);
    }
  });
  const metadata = rows.filter((row) => row.type === "session_meta" && isPlainObject(row.payload));
  if (metadata.length !== 1) {
    throw new CliError("Codex App archived task session must contain one session_meta record");
  }
  const payload = metadata[0].payload;
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
}) {
  const home = codexHomePath(codexHome);
  const task = requireText(threadId, "thread_id", { max: 256, safeId: true });
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
  const session = await stableFile(home, sessionPath, "Codex App private archived task session");
  const metadata = sessionMetadata(session.bytes, task);
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
    host_cli_version: metadata.host_cli_version,
    observed_at: nowIso(now),
  };
  observation.binding_digest = privateArchiveObservationDigest(observation);
  return validatePrivateArchiveObservation(observation);
}
