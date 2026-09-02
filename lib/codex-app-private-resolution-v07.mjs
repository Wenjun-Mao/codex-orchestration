import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
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
  requireEnum,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";

export const PRIVATE_TASK_RESOLUTION_KIND = "codex-flow-v07-private-task-resolution";
export const PRIVATE_TASK_RESOLUTION_SOURCE = "codex-app-private-state-v1";
export const PRIVATE_DELEGATION_SOURCE = "codex-app-private-delegation-v1";

const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_SESSION_BYTES = 256 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 50_000;
const MAX_SESSION_LINES = 20_000;
const MAX_SOURCE_SESSION_LINES = 100_000;
const MAX_SOURCE_SESSION_LINE_BYTES = 4 * 1024 * 1024;
const FORWARD_BINDING_PREFIX = "thread-client-id-v1:";
const REVERSE_BINDING_KEY = "client-thread-bindings-v1";

function requireAbsolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function requireTimestamp(value, label) {
  const timestamp = requireText(value, label, { max: 64 });
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp`);
  }
  return timestamp;
}

function nowIso(now) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Private resolution clock must be finite");
  return new Date(milliseconds).toISOString();
}

function defaultCodexHome() {
  const configured = process.env.CODEX_HOME;
  return resolve(configured && configured.trim() !== "" ? configured : resolve(homedir(), ".codex"));
}

async function readStableFile(root, path, { label, maxBytes }) {
  await assertNoSymlinkComponents(root, path, label);
  const before = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") throw new CliError(`${label} is unavailable`);
    throw error;
  });
  if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
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

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

function privateBinding(atom, provisionalClientThreadId) {
  const reverse = atom[REVERSE_BINDING_KEY];
  if (!isPlainObject(reverse)) {
    throw new CliError(`Codex App private state is missing ${REVERSE_BINDING_KEY}`);
  }
  if (!Object.hasOwn(reverse, provisionalClientThreadId)) {
    throw new CliError("Codex App private task binding is not ready");
  }
  const readyThreadId = requireText(
    reverse[provisionalClientThreadId],
    "private ready task ID",
    { max: 256, safeId: true },
  );
  if (readyThreadId === provisionalClientThreadId) {
    throw new CliError("Private task binding cannot reuse the provisional clientThreadId");
  }

  const matches = Object.entries(atom).filter(([key, value]) => (
    key.startsWith(FORWARD_BINDING_PREFIX) && value === provisionalClientThreadId
  ));
  if (matches.length !== 1) {
    throw new CliError("Codex App private forward task binding is missing or ambiguous");
  }
  const [bindingKey] = matches[0];
  let decoded;
  try {
    decoded = decodeURIComponent(bindingKey.slice(FORWARD_BINDING_PREFIX.length));
  } catch {
    throw new CliError("Codex App private forward task binding is malformed");
  }
  if (decoded !== `local:${readyThreadId}`) {
    throw new CliError("Codex App private forward and reverse task bindings disagree");
  }
  const expectedKey = `${FORWARD_BINDING_PREFIX}${encodeURIComponent(`local:${readyThreadId}`)}`;
  if (bindingKey !== expectedKey) {
    throw new CliError("Codex App private forward task binding is not canonical");
  }
  return { bindingKey, readyThreadId };
}

async function findSessionFile(codexHome, threadId, label = "Codex App private task session") {
  const sessionsRoot = resolve(codexHome, "sessions");
  const sessionsRootStat = await lstat(sessionsRoot).catch((error) => {
    if (error?.code === "ENOENT") throw new CliError("Codex App sessions root is unavailable");
    throw error;
  });
  if (!sessionsRootStat.isDirectory()) throw new CliError("Codex App sessions root must be a directory");
  await assertNoSymlinkComponents(codexHome, sessionsRoot, "Codex App sessions root");
  const suffix = `-${threadId}.jsonl`;
  const candidates = [];
  const pending = [{ path: sessionsRoot, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") throw new CliError("Codex App sessions root is unavailable");
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      visited += 1;
      if (visited > MAX_SESSION_ENTRIES) {
        throw new CliError("Codex App session inventory exceeds the bounded resolver limit");
      }
      const path = resolve(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.endsWith(suffix)) {
          throw new CliError(`${label} candidate is a symbolic link`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth >= 4) continue;
        pending.push({ path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        candidates.push(path);
      }
    }
  }
  if (candidates.length !== 1) {
    throw new CliError(`${label} is missing or ambiguous`);
  }
  return candidates[0];
}

function parseSession(bytes, label) {
  const lines = bytes.toString("utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0 || lines.length > MAX_SESSION_LINES) {
    throw new CliError(`${label} has an unsupported line count`);
  }
  return lines.map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (!isPlainObject(value)) throw new Error("not an object");
      return value;
    } catch {
      throw new CliError(`${label} contains invalid JSON on line ${index + 1}`);
    }
  });
}

function requireWithinWindow(timestamp, startedAt, reconcileBy, label) {
  const observed = Date.parse(requireTimestamp(timestamp, label));
  if (observed < Date.parse(startedAt) || observed >= Date.parse(reconcileBy)) {
    throw new CliError(`${label} falls outside the open reconciliation window`);
  }
  return timestamp;
}

function expectedDelegationOutput(sourceThreadId, bootstrap) {
  return [
    "<codex_delegation>",
    `  <source_thread_id>${sourceThreadId}</source_thread_id>`,
    `  <input>${bootstrap}</input>`,
    "</codex_delegation>",
  ].join("\n");
}

function createThreadClientId(value) {
  if (!isPlainObject(value) || !Array.isArray(value.content) || value.isError !== false) {
    throw new CliError("Codex App source create_thread completion has an unsupported result");
  }
  const text = value.content.filter((item) => (
    isPlainObject(item) && item.type === "text" && typeof item.text === "string"
  ));
  if (text.length !== 1) {
    throw new CliError("Codex App source create_thread completion has an ambiguous clientThreadId result");
  }
  let result;
  try {
    result = JSON.parse(text[0].text);
  } catch {
    throw new CliError("Codex App source create_thread completion has malformed JSON");
  }
  if (
    !isPlainObject(result)
    || stableStringify(Object.keys(result).sort()) !== stableStringify(["clientThreadId", "hostId"])
  ) {
    throw new CliError("Codex App source create_thread completion has unexpected result fields");
  }
  return {
    host_id: requireText(result.hostId, "private source hostId", { max: 256, safeId: true }),
    provisional_client_thread_id: requireText(
      result.clientThreadId,
      "private source clientThreadId",
      { max: 256 },
    ),
  };
}

function sourceCreateCompletion(row) {
  const payload = row.payload;
  if (row.type !== "event_msg" || !isPlainObject(payload)) return null;
  // Current Codex App sessions record a completed McpToolCall in item_completed.
  if (payload.type === "item_completed" && isPlainObject(payload.item)) {
    const item = payload.item;
    if (item.type !== "McpToolCall" || item.status !== "completed") return null;
    return {
      thread_id: payload.thread_id,
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
      result: item.result,
    };
  }
  return null;
}

async function scanStableSourceSession(root, path, label, bootstrap) {
  await assertNoSymlinkComponents(root, path, label);
  const before = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") throw new CliError(`${label} is unavailable`);
    throw error;
  });
  if (!before.isFile() || before.size < 1 || before.size > MAX_SOURCE_SESSION_BYTES) {
    throw new CliError(`${label} must be a bounded regular file`);
  }
  const metadata = [];
  const completions = [];
  const hash = createHash("sha256");
  const decoder = new StringDecoder("utf8");
  let remainder = "";
  let lineCount = 0;
  let byteCount = 0;
  const consume = (line) => {
    if (line === "") return;
    if (Buffer.byteLength(line, "utf8") > MAX_SOURCE_SESSION_LINE_BYTES) {
      throw new CliError(`${label} contains an oversized JSON line`);
    }
    lineCount += 1;
    if (lineCount > MAX_SOURCE_SESSION_LINES) {
      throw new CliError(`${label} exceeds the bounded line count`);
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new CliError(`${label} contains invalid JSON on line ${lineCount}`);
    }
    if (!isPlainObject(row)) throw new CliError(`${label} contains a non-object JSON row`);
    if (row.type === "session_meta" && isPlainObject(row.payload)) metadata.push(row);
    const completion = sourceCreateCompletion(row);
    if (
      completion !== null
      && completion.server === "codex_app"
      && completion.tool === "create_thread"
      && completion.arguments?.prompt === bootstrap
    ) completions.push(row);
  };
  const stream = createReadStream(path);
  try {
    for await (const chunk of stream) {
      byteCount += chunk.length;
      if (byteCount > before.size || byteCount > MAX_SOURCE_SESSION_BYTES) {
        throw new CliError(`${label} changed while it was being read`, 75);
      }
      hash.update(chunk);
      remainder += decoder.write(chunk);
      if (Buffer.byteLength(remainder, "utf8") > MAX_SOURCE_SESSION_LINE_BYTES) {
        throw new CliError(`${label} contains an oversized JSON line`);
      }
      let boundary;
      while ((boundary = remainder.indexOf("\n")) >= 0) {
        const line = remainder.slice(0, boundary).replace(/\r$/, "");
        remainder = remainder.slice(boundary + 1);
        consume(line);
      }
    }
    remainder += decoder.end();
    consume(remainder.replace(/\r$/, ""));
  } catch (error) {
    stream.destroy();
    throw error;
  }
  if (lineCount === 0) throw new CliError(`${label} has an unsupported line count`);
  const after = await lstat(path);
  if (
    !after.isFile()
    || before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || byteCount !== before.size
  ) throw new CliError(`${label} changed while it was being read`, 75);
  return { metadata, completions, digest: hash.digest("hex") };
}

function expectedSourceTarget(requestedSelectors) {
  return {
    type: "project",
    projectId: requestedSelectors.project_id,
    environment: requestedSelectors.worktree.mode === "host-worktree"
      ? {
        type: "worktree",
        startingState: {
          type: "branch",
          branchName: requestedSelectors.worktree.starting_branch,
        },
      }
      : { type: "local" },
  };
}

function sourceCreateEvidence({
  metadata,
  completions,
  sourceThreadId,
  bootstrap,
  taskTitle,
  requestedSelectors,
  startedAt,
  reconcileBy,
  expectedProvisionalClientThreadId,
}) {
  if (metadata.length !== 1 || metadata[0].payload.id !== sourceThreadId) {
    throw new CliError("Codex App source session metadata does not match the coordinator task");
  }
  const matches = completions.filter((row) => (
    sourceCreateCompletion(row).server === "codex_app"
    && sourceCreateCompletion(row).tool === "create_thread"
    && sourceCreateCompletion(row).arguments?.prompt === bootstrap
  ));
  if (matches.length !== 1) {
    throw new CliError("Codex App source session has no exact create_thread completion for this operation");
  }
  const completion = matches[0];
  const call = sourceCreateCompletion(completion);
  const expectedArguments = {
    prompt: bootstrap,
    title: taskTitle,
    model: requestedSelectors.model,
    thinking: requestedSelectors.reasoning_effort,
    target: expectedSourceTarget(requestedSelectors),
  };
  if (
    call.thread_id !== sourceThreadId
    || stableStringify(call.arguments) !== stableStringify(expectedArguments)
  ) throw new CliError("Codex App source create_thread completion does not match exact selectors and placement");
  const hostResult = createThreadClientId(call.result);
  if (hostResult.host_id !== "local") {
    throw new CliError("Codex App source create_thread completion has an unsupported host identity");
  }
  if (
    expectedProvisionalClientThreadId !== null
    && hostResult.provisional_client_thread_id !== expectedProvisionalClientThreadId
  ) throw new CliError("Codex App source create_thread completion does not match the recorded provisional identity");
  return {
    provisional_client_thread_id: hostResult.provisional_client_thread_id,
    host_id: hostResult.host_id,
    provisional_observed_at: requireWithinWindow(
      completion.timestamp,
      startedAt,
      reconcileBy,
      "Private provisional creation observation",
    ),
    accepted_selectors: {
      project_id: requestedSelectors.project_id,
      model: requestedSelectors.model,
      reasoning_effort: requestedSelectors.reasoning_effort,
      worktree: requestedSelectors.worktree,
      accepted_at: completion.timestamp,
    },
  };
}

function sessionEvidence({
  rows,
  readyThreadId,
  sourceThreadId,
  bootstrap,
  requestedSelectors,
  startedAt,
  reconcileBy,
}) {
  const metaRows = rows.filter((row) => row.type === "session_meta");
  if (metaRows.length !== 1 || !isPlainObject(metaRows[0].payload)) {
    throw new CliError("Codex App task session must contain one session_meta record");
  }
  const meta = metaRows[0];
  if (meta.payload.id !== readyThreadId || meta.payload.thread_source !== "agent_created_thread") {
    throw new CliError("Codex App task session metadata does not match the recovered task");
  }
  const cwd = requireAbsolutePath(meta.payload.cwd, "private task session cwd");
  const requestedWorktree = requestedSelectors.worktree;
  if (requestedWorktree.mode === "local" && cwd !== requestedWorktree.path) {
    throw new CliError("Private task session cwd does not match the requested local placement");
  }
  if (
    !isPlainObject(meta.payload.git)
    || meta.payload.git.commit_hash !== requestedWorktree.starting_revision
  ) throw new CliError("Private task session revision does not match the requested baseline");

  const firstStartIndex = rows.findIndex((row) => (
    row.type === "event_msg" && row.payload?.type === "task_started"
  ));
  if (firstStartIndex < 0) throw new CliError("Codex App task session has no initial task turn");
  const firstTurnId = requireText(
    rows[firstStartIndex].payload.turn_id,
    "private task first turn ID",
    { max: 256, safeId: true },
  );
  const firstCompleteOffset = rows.slice(firstStartIndex + 1).findIndex((row) => (
    row.type === "event_msg"
    && row.payload?.type === "task_complete"
    && row.payload?.turn_id === firstTurnId
  ));
  const firstCompleteIndex = firstCompleteOffset < 0
    ? rows.length
    : firstStartIndex + 1 + firstCompleteOffset;
  const firstTurnRows = rows.slice(firstStartIndex, firstCompleteIndex + 1);

  const contexts = firstTurnRows.filter((row) => (
    row.type === "turn_context" && row.payload?.turn_id === firstTurnId
  ));
  if (contexts.length !== 1) {
    throw new CliError("Codex App task session has ambiguous initial selector context");
  }
  const context = contexts[0];
  const model = requireText(context.payload.model, "private task observed model", { max: 128 });
  const effort = requireEnum(
    context.payload.effort,
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
    "private task observed reasoning effort",
  );
  if (model !== requestedSelectors.model || effort !== requestedSelectors.reasoning_effort) {
    throw new CliError("Private task session selectors do not match the requested selectors");
  }

  const expectedOutput = expectedDelegationOutput(sourceThreadId, bootstrap);
  const deliveries = firstTurnRows.filter((row) => (
    row.type === "response_item"
    && row.payload?.type === "function_call_output"
    && row.payload?.namespace === "codex_app"
    && row.payload?.name === "create_thread"
    && row.payload?.output === expectedOutput
  ));
  if (deliveries.length !== 1) {
    throw new CliError("Codex App task session does not contain the exact private delegation bootstrap");
  }
  const delivery = deliveries[0];
  const observedAt = requireWithinWindow(
    delivery.timestamp,
    startedAt,
    reconcileBy,
    "Private delegation observation",
  );
  const contextObservedAt = requireWithinWindow(
    context.timestamp,
    startedAt,
    reconcileBy,
    "Private selector observation",
  );
  return {
    initial_turn: {
      source: PRIVATE_DELEGATION_SOURCE,
      thread_id: readyThreadId,
      turn_id: firstTurnId,
      turn_index: 1,
      role: "delegation",
      content: bootstrap,
      observed_at: observedAt,
    },
    observed_selectors: {
      project_id: null,
      model,
      reasoning_effort: effort,
      worktree: requestedWorktree.mode === "host-worktree"
        ? { ...requestedWorktree, path: cwd }
        : { ...requestedWorktree },
      observed_at: contextObservedAt,
    },
    host_cli_version: meta.payload.cli_version === undefined
      ? null
      : requireText(meta.payload.cli_version, "private task host CLI version", { max: 64 }),
  };
}

export function privateAcceptedSelectorDigest(value) {
  return sha256(stableStringify({
    project_id: value.project_id,
    model: value.model,
    reasoning_effort: value.reasoning_effort,
    worktree: value.worktree,
  }));
}

export function privateTaskResolutionBindingDigest(value) {
  return sha256(stableStringify({
    schema_version: 1,
    kind: PRIVATE_TASK_RESOLUTION_KIND,
    source: PRIVATE_TASK_RESOLUTION_SOURCE,
    provisional_client_thread_id: value.provisional_client_thread_id,
    provisional_observed_at: value.provisional_observed_at,
    host_id: value.host_id,
    ready_thread_id: value.ready_thread_id,
    state_digest: value.state_digest,
    source_session_digest: value.source_session_digest,
    accepted_selector_digest: value.accepted_selector_digest,
    session_digest: value.session_digest,
    app_version: value.app_version,
    app_release_family: value.app_release_family,
    host_cli_version: value.host_cli_version,
    resolved_at: value.resolved_at,
  }));
}

export async function resolveCodexAppPrivateTask({
  provisionalClientThreadId = null,
  sourceThreadId,
  bootstrap,
  taskTitle,
  requestedSelectors,
  attemptStartedAt,
  reconcileBy,
  codexHome = defaultCodexHome(),
  now = Date.now(),
}) {
  const home = requireAbsolutePath(codexHome, "Codex home");
  const provisional = provisionalClientThreadId === null
    ? null
    : requireText(provisionalClientThreadId, "provisional_client_thread_id", { max: 256 });
  const sourceThread = requireText(sourceThreadId, "source_thread_id", { max: 256, safeId: true });
  const canonicalBootstrap = requireText(bootstrap, "private task bootstrap", { max: 64 * 1024 });
  const canonicalTitle = requireText(taskTitle, "private task title", { max: 160 });
  const startedAt = requireTimestamp(attemptStartedAt, "attempt_started_at");
  const deadline = requireTimestamp(reconcileBy, "reconcile_by");
  const resolvedAt = nowIso(now);

  const sourceSessionPath = await findSessionFile(
    home,
    sourceThread,
    "Codex App private coordinator session",
  );
  if (!basename(sourceSessionPath).endsWith(`-${sourceThread}.jsonl`)) {
    throw new CliError("Codex App private coordinator session filename is not canonical");
  }
  const sourceSessionFile = await scanStableSourceSession(
    home,
    sourceSessionPath,
    "Codex App private coordinator session",
    canonicalBootstrap,
  );
  const source = sourceCreateEvidence({
    metadata: sourceSessionFile.metadata,
    completions: sourceSessionFile.completions,
    sourceThreadId: sourceThread,
    bootstrap: canonicalBootstrap,
    taskTitle: canonicalTitle,
    requestedSelectors,
    startedAt,
    reconcileBy: deadline,
    expectedProvisionalClientThreadId: provisional,
  });

  const statePath = resolve(home, ".codex-global-state.json");
  const stateFile = await readStableFile(home, statePath, {
    label: "Codex App private state",
    maxBytes: MAX_STATE_BYTES,
  });
  const state = parseJson(stateFile.bytes, "Codex App private state");
  if (!isPlainObject(state) || !isPlainObject(state["electron-persisted-atom-state"])) {
    throw new CliError("Codex App private state has an unsupported structure");
  }
  const atom = state["electron-persisted-atom-state"];
  const binding = privateBinding(atom, source.provisional_client_thread_id);

  const sessionPath = await findSessionFile(home, binding.readyThreadId);
  if (!basename(sessionPath).endsWith(`-${binding.readyThreadId}.jsonl`)) {
    throw new CliError("Codex App private task session filename is not canonical");
  }
  const sessionFile = await readStableFile(home, sessionPath, {
    label: "Codex App private task session",
    maxBytes: MAX_SESSION_BYTES,
  });
  const session = sessionEvidence({
    rows: parseSession(sessionFile.bytes, "Codex App private task session"),
    readyThreadId: binding.readyThreadId,
    sourceThreadId: sourceThread,
    bootstrap: canonicalBootstrap,
    requestedSelectors,
    startedAt,
    reconcileBy: deadline,
  });

  const appReleaseFamily = atom["electron:last-seen-changelog-release-family"] === undefined
    ? null
    : requireText(
      atom["electron:last-seen-changelog-release-family"],
      "Codex App release family",
      { max: 64 },
    );
  const resolution = {
    schema_version: 1,
    kind: PRIVATE_TASK_RESOLUTION_KIND,
    source: PRIVATE_TASK_RESOLUTION_SOURCE,
    provisional_client_thread_id: source.provisional_client_thread_id,
    provisional_observed_at: source.provisional_observed_at,
    host_id: source.host_id,
    ready_thread_id: binding.readyThreadId,
    binding_digest: "",
    state_digest: stateFile.digest,
    source_session_digest: sourceSessionFile.digest,
    accepted_selector_digest: privateAcceptedSelectorDigest(source.accepted_selectors),
    session_digest: sessionFile.digest,
    app_version: null,
    app_release_family: appReleaseFamily,
    host_cli_version: session.host_cli_version,
    resolved_at: resolvedAt,
  };
  resolution.binding_digest = privateTaskResolutionBindingDigest(resolution);
  return {
    resolution,
    initial_turn: session.initial_turn,
    accepted_selectors: source.accepted_selectors,
    observed_selectors: session.observed_selectors,
  };
}
