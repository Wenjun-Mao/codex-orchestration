import { spawn as spawnProcess } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  CliError,
  PACKAGE_VERSION,
  requireExactFields,
  requireText,
  sha256,
} from "./core.mjs";

// This adapter is the only package layer allowed to know the App-server wire
// protocol.  Callers give it an authenticated route and untrusted report text;
// they never get an RPC client or an escape hatch for steering a thread.
export const CODEX_APP_BINARY_PATH = "/Applications/ChatGPT.app/Contents/Resources/codex";
export const CODEX_APP_CLI_VERSION = "codex-cli 0.153.4";
export const NATIVE_QUEUE_LIMITS = Object.freeze({
  hook_timeout_ms: 3_000,
  process_budget_ms: 2_500,
  cleanup_reserve_ms: 400,
  poll_ms: 50,
  max_stdout_bytes: 32 * 1024,
  max_stderr_bytes: 8 * 1024,
  max_version_bytes: 4 * 1024,
  max_request_bytes: 64 * 1024,
});

const DIGEST = /^[0-9a-f]{64}$/;
const DIAGNOSTIC_MARKERS = Object.freeze([
  ["migration", /migration/i],
  ["backfill", /backfill/i],
  ["recovery", /recovery/i],
  ["corruption", /corrupt/i],
  ["error", /error/i],
]);

export class NativeQueueError extends Error {
  constructor(code) {
    super(code);
    this.name = "NativeQueueError";
    this.code = code;
  }
}

function deadlineAfter(milliseconds) {
  return Date.now() + milliseconds;
}

function remaining(deadline) {
  return deadline - Date.now();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, milliseconds)));
}

function boundedText(value, label, { max = 512, safeId = false } = {}) {
  return requireText(value, label, { max, safeId });
}

function digest(value, label) {
  const result = boundedText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a SHA-256 digest`);
  return result;
}

function absolutePath(value, label) {
  const result = boundedText(value, label, { max: 2048 });
  if (!result.startsWith("/")) throw new CliError(`${label} must be an absolute path`);
  return resolve(result);
}

function exactNativeHome() {
  return resolve(homedir(), ".codex");
}

export function validateNativeQueueConfiguration(value) {
  requireExactFields(value, {
    required: ["binary_path", "expected_version", "sqlite_home"],
  }, "Native queue configuration");
  const binaryPath = absolutePath(value.binary_path, "native queue binary_path");
  const sqliteHome = absolutePath(value.sqlite_home, "native queue sqlite_home");
  const expectedVersion = boundedText(value.expected_version, "native queue expected_version", { max: 128 });
  if (binaryPath !== CODEX_APP_BINARY_PATH) {
    throw new CliError("Native queue binary_path is not the supported Codex App binary", 73);
  }
  if (sqliteHome !== exactNativeHome()) {
    throw new CliError("Native queue sqlite_home is not the current user's supported Codex data root", 73);
  }
  // This is deliberately an equality check instead of a range.  A new App
  // release must receive fresh compatibility evidence before it can queue a
  // report for an existing Flow route.
  if (expectedVersion !== CODEX_APP_CLI_VERSION) {
    throw new CliError("Native queue expected_version lacks current App compatibility evidence", 73);
  }
  return {
    binary_path: binaryPath,
    expected_version: expectedVersion,
    sqlite_home: sqliteHome,
  };
}

export function nativeQueueDiagnostics(stderr, { childClosed = false } = {}) {
  const bytes = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? "");
  const text = bytes.toString("utf8");
  return {
    stderr_bytes: bytes.length,
    stderr_sha256: sha256(bytes),
    categories: DIAGNOSTIC_MARKERS
      .filter(([, marker]) => marker.test(text))
      .map(([name]) => name),
    child_closed: childClosed,
  };
}

function commandArguments(configuration) {
  // The Codex data root is authenticated before this string is built and is
  // passed as one argv element, never through a shell.
  return [
    "-c",
    `sqlite_home=${JSON.stringify(configuration.sqlite_home)}`,
    "app-server",
    "--listen",
    "stdio://",
  ];
}

function requireQueueInput({ recipientThreadId, deliveryKey, queueText }) {
  const recipient = boundedText(recipientThreadId, "recipient_thread_id", { max: 256, safeId: true });
  const key = digest(deliveryKey, "delivery_key");
  const text = boundedText(queueText, "queue_text", { max: NATIVE_QUEUE_LIMITS.max_request_bytes });
  if (Buffer.byteLength(text, "utf8") > NATIVE_QUEUE_LIMITS.max_request_bytes) {
    throw new CliError("queue_text exceeds the native queue request limit", 73);
  }
  return { recipient, key, text };
}

function requestBytes(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > NATIVE_QUEUE_LIMITS.max_request_bytes) {
    throw new NativeQueueError("request-size-limit");
  }
  return bytes;
}

class JsonLineTransport {
  constructor(child, {
    maxStdoutBytes = NATIVE_QUEUE_LIMITS.max_stdout_bytes,
    maxStderrBytes = NATIVE_QUEUE_LIMITS.max_stderr_bytes,
  } = {}) {
    if (!child?.stdin || !child?.stdout || !child?.stderr) throw new NativeQueueError("child-pipes-unavailable");
    this.child = child;
    this.maxStdoutBytes = maxStdoutBytes;
    this.maxStderrBytes = maxStderrBytes;
    this.stdout = Buffer.alloc(0);
    this.stderr = Buffer.alloc(0);
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    this.messages = [];
    this.failure = null;
    this.closed = false;
    this.waiters = [];

    child.stdout.on("data", (chunk) => this.#acceptStdout(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => this.#acceptStderr(Buffer.from(chunk)));
    child.on("error", () => this.#fail("child-error"));
    child.on("close", () => {
      this.closed = true;
      if (this.stdout.length > 0 && this.failure === null) this.#fail("stdout-partial-line");
      this.#wake();
    });
  }

  #fail(code) {
    if (this.failure === null) this.failure = new NativeQueueError(code);
    this.#wake();
  }

  #wake() {
    const waiters = this.waiters.splice(0);
    for (const wake of waiters) wake();
  }

  #acceptStdout(chunk) {
    this.stdoutBytes += chunk.length;
    if (this.stdoutBytes > this.maxStdoutBytes) return this.#fail("stdout-size-limit");
    this.stdout = Buffer.concat([this.stdout, chunk]);
    while (true) {
      const newline = this.stdout.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.stdout.subarray(0, newline);
      this.stdout = this.stdout.subarray(newline + 1);
      if (line.length === 0) return this.#fail("stdout-empty-line");
      let message;
      try {
        message = JSON.parse(line.toString("utf8"));
      } catch {
        return this.#fail("stdout-malformed-json");
      }
      if (message === null || typeof message !== "object" || Array.isArray(message)) {
        return this.#fail("stdout-non-object");
      }
      this.messages.push(message);
    }
    this.#wake();
  }

  #acceptStderr(chunk) {
    this.stderrBytes += chunk.length;
    if (this.stderrBytes > this.maxStderrBytes) return this.#fail("stderr-size-limit");
    this.stderr = Buffer.concat([this.stderr, chunk]);
    this.#wake();
  }

  async #wait(deadline) {
    if (this.failure || this.closed || this.messages.length > 0) return;
    const waitForEvent = new Promise((resolveWait) => this.waiters.push(resolveWait));
    const left = remaining(deadline);
    if (left <= 0) throw new NativeQueueError("rpc-timeout");
    await Promise.race([waitForEvent, delay(left)]);
  }

  async write(value, deadline) {
    if (this.failure) throw this.failure;
    if (this.closed) throw new NativeQueueError("stdin-closed");
    const bytes = requestBytes(value);
    const left = remaining(deadline);
    if (left <= 0) throw new NativeQueueError("stdin-timeout");
    await new Promise((resolveWrite, rejectWrite) => {
      let settled = false;
      const finish = (callback, valueToReturn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.child.stdin.off("error", onError);
        this.child.stdin.off("drain", onDrain);
        callback(valueToReturn);
      };
      const onError = () => finish(rejectWrite, new NativeQueueError("stdin-closed"));
      const onDrain = () => finish(resolveWrite);
      const timeout = setTimeout(() => finish(rejectWrite, new NativeQueueError("stdin-timeout")), left);
      this.child.stdin.once("error", onError);
      const writable = this.child.stdin.write(bytes);
      if (writable) finish(resolveWrite);
      else this.child.stdin.once("drain", onDrain);
    });
    if (this.failure) throw this.failure;
  }

  async response(requestId, deadline) {
    while (true) {
      if (this.failure) throw this.failure;
      while (this.messages.length > 0) {
        const message = this.messages.shift();
        if (message.id !== requestId) continue;
        if (Object.hasOwn(message, "error")) throw new NativeQueueError("rpc-error");
        if (message.result === null || typeof message.result !== "object" || Array.isArray(message.result)) {
          throw new NativeQueueError("rpc-result-malformed");
        }
        return message.result;
      }
      if (this.closed) throw new NativeQueueError("stdout-eof");
      await this.#wait(deadline);
      if (remaining(deadline) <= 0 && this.messages.length === 0) throw new NativeQueueError("rpc-timeout");
    }
  }

  async settle() {
    // Let coalesced stderr/stdout from a just-completed response arrive before
    // deciding that startup is clean.  This never extends the global deadline.
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    if (this.failure) throw this.failure;
  }
}

async function waitForChildClose(child, milliseconds) {
  if (child.exitCode !== null || child.killed) return true;
  return new Promise((resolveWait) => {
    const timeout = setTimeout(() => {
      child.off("close", onClose);
      resolveWait(false);
    }, Math.max(0, milliseconds));
    const onClose = () => {
      clearTimeout(timeout);
      resolveWait(true);
    };
    child.once("close", onClose);
  });
}

export async function closeNativeQueueProcess(child, cleanupDeadline) {
  if (!child) return true;
  try {
    child.stdin?.end();
  } catch {
    // Cleanup preserves the primary transport evidence.
  }
  const budget = Math.max(0, remaining(cleanupDeadline));
  if (await waitForChildClose(child, Math.floor(budget / 3))) return true;
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may have exited between the checks.
  }
  if (await waitForChildClose(child, Math.floor(Math.max(0, remaining(cleanupDeadline)) / 2))) return true;
  try {
    child.kill("SIGKILL");
  } catch {
    // The process may have exited between the checks.
  }
  return waitForChildClose(child, Math.max(0, remaining(cleanupDeadline)));
}

async function collectVersion({ configuration, spawnFactory, workDeadline, cleanupDeadline }) {
  let child;
  try {
    child = spawnFactory(configuration.binary_path, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new NativeQueueError("version-spawn-failed");
  }
  if (!child?.stdout || !child?.stderr) throw new NativeQueueError("version-pipes-unavailable");
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let overflow = false;
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > NATIVE_QUEUE_LIMITS.max_version_bytes) overflow = true;
    else stdout.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > NATIVE_QUEUE_LIMITS.max_version_bytes) overflow = true;
    else stderr.push(Buffer.from(chunk));
  });
  const closed = await waitForChildClose(child, Math.max(0, remaining(workDeadline)));
  if (!closed) {
    await closeNativeQueueProcess(child, cleanupDeadline);
    throw new NativeQueueError("version-timeout");
  }
  if (overflow) throw new NativeQueueError("version-output-size-limit");
  return {
    exit_code: child.exitCode ?? 1,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function blocked(reason, { childClosed = true, stderr = Buffer.alloc(0) } = {}) {
  return {
    outcome: "blocked",
    reason,
    queue_attempted: false,
    diagnostics: nativeQueueDiagnostics(stderr, { childClosed }),
  };
}

function ambiguous(reason, queueAttempted, { childClosed = true, stderr = Buffer.alloc(0) } = {}) {
  return {
    outcome: "ambiguous",
    reason,
    queue_attempted: queueAttempted,
    diagnostics: nativeQueueDiagnostics(stderr, { childClosed }),
  };
}

/**
 * Submit one already-captured report.  The caller persists its one-shot
 * attempt before calling this function; this method intentionally has no
 * retry loop and exposes no generic RPC surface.
 */
export async function submitNativeQueuedReport({
  configuration,
  recipientThreadId,
  deliveryKey,
  queueText,
  spawnFactory = spawnProcess,
  versionReader = collectVersion,
  now = Date.now,
}) {
  const native = validateNativeQueueConfiguration(configuration);
  const input = requireQueueInput({ recipientThreadId, deliveryKey, queueText });
  const started = now();
  const workDeadline = started + NATIVE_QUEUE_LIMITS.process_budget_ms - NATIVE_QUEUE_LIMITS.cleanup_reserve_ms;
  const cleanupDeadline = started + NATIVE_QUEUE_LIMITS.process_budget_ms;
  let child = null;
  let transport = null;
  let queueAttempted = false;
  let result = null;
  let primaryFailure = null;
  let directOutcome = null;

  try {
    const version = await versionReader({
      configuration: native,
      spawnFactory,
      workDeadline,
      cleanupDeadline,
    });
    if (version.exit_code !== 0 || version.stdout.trim() !== native.expected_version) {
      directOutcome = blocked("binary-version-drift");
    } else {
      if (remaining(workDeadline) <= 0) throw new NativeQueueError("startup-timeout");
      child = spawnFactory(native.binary_path, commandArguments(native), {
        stdio: ["pipe", "pipe", "pipe"],
      });
      transport = new JsonLineTransport(child);
      await transport.write({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "codex-flow-report-hook", version: PACKAGE_VERSION },
          capabilities: { experimentalApi: true },
        },
      }, workDeadline);
      await transport.response(1, workDeadline);
      await transport.settle();
      if (nativeQueueDiagnostics(transport.stderr).categories.length > 0) {
        directOutcome = ambiguous("diagnostic-before-add", false, { stderr: transport.stderr });
      } else {
        await transport.write({ method: "initialized", params: {} }, workDeadline);
        await transport.settle();
        if (nativeQueueDiagnostics(transport.stderr).categories.length > 0) {
          directOutcome = ambiguous("diagnostic-before-add", false, { stderr: transport.stderr });
        }
      }
    }
    if (directOutcome === null) {
      queueAttempted = true;
      await transport.write({
        method: "thread/queue/add",
        id: 2,
        params: {
          threadId: input.recipient,
          clientUserMessageId: input.key,
          input: [{ type: "text", text: input.text }],
        },
      }, workDeadline);
      result = await transport.response(2, workDeadline);
    }
  } catch (error) {
    primaryFailure = error instanceof NativeQueueError
      ? error.code
      : "native-queue-error";
  } finally {
    const childClosed = await closeNativeQueueProcess(child, cleanupDeadline);
    const stderr = transport?.stderr ?? Buffer.alloc(0);
    if (primaryFailure !== null) {
      return ambiguous(primaryFailure, queueAttempted, { childClosed, stderr });
    }
    if (directOutcome !== null) {
      return {
        ...directOutcome,
        diagnostics: nativeQueueDiagnostics(stderr, { childClosed }),
      };
    }
    const queued = result?.queuedSubmission;
    const queueId = queued?.id;
    if (typeof queueId !== "string" || queueId === "") {
      return ambiguous("missing-ack", true, { childClosed, stderr });
    }
    const diagnostics = nativeQueueDiagnostics(stderr, { childClosed });
    if (diagnostics.categories.length > 0 || !childClosed) {
      return {
        outcome: "accepted-with-anomaly",
        queued_submission_id: queueId,
        reason: diagnostics.categories.length > 0 ? "diagnostic" : "shutdown-timeout",
        queue_attempted: true,
        diagnostics,
      };
    }
    return {
      outcome: "accepted",
      queued_submission_id: queueId,
      queue_attempted: true,
      diagnostics,
    };
  }
}

/**
 * Archive one exact idle thread through the same pinned App-server boundary.
 * The caller persists its batch attempt before entering this function. An
 * ambiguous response is never retried automatically.
 */
export async function submitNativeThreadArchive({
  configuration,
  threadId,
  spawnFactory = spawnProcess,
  versionReader = collectVersion,
  now = Date.now,
}) {
  const native = validateNativeQueueConfiguration(configuration);
  const thread = boundedText(threadId, "thread_id", { max: 256, safeId: true });
  const started = now();
  const workDeadline = started + NATIVE_QUEUE_LIMITS.process_budget_ms - NATIVE_QUEUE_LIMITS.cleanup_reserve_ms;
  const cleanupDeadline = started + NATIVE_QUEUE_LIMITS.process_budget_ms;
  let child = null;
  let transport = null;
  let archiveAttempted = false;
  let primaryFailure = null;
  let directOutcome = null;
  try {
    const version = await versionReader({ configuration: native, spawnFactory, workDeadline, cleanupDeadline });
    if (version.exit_code !== 0 || version.stdout.trim() !== native.expected_version) {
      directOutcome = { outcome: "blocked", reason: "binary-version-drift", archive_attempted: false };
    } else {
      child = spawnFactory(native.binary_path, commandArguments(native), { stdio: ["pipe", "pipe", "pipe"] });
      transport = new JsonLineTransport(child);
      await transport.write({
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "codex-flow-closeout", version: PACKAGE_VERSION }, capabilities: { experimentalApi: true } },
      }, workDeadline);
      await transport.response(1, workDeadline);
      await transport.write({ method: "initialized", params: {} }, workDeadline);
      await transport.write({ method: "thread/read", id: 2, params: { threadId: thread, includeTurns: false } }, workDeadline);
      const read = await transport.response(2, workDeadline);
      if (read?.thread?.id !== thread || typeof read?.thread?.status?.type !== "string") {
        directOutcome = { outcome: "blocked", reason: "thread-read-mismatch", archive_attempted: false };
      } else if (read.thread.status.type === "active") {
        directOutcome = { outcome: "blocked", reason: "thread-active", archive_attempted: false };
      } else if (!new Set(["idle", "notLoaded"]).has(read.thread.status.type)) {
        directOutcome = { outcome: "blocked", reason: "thread-status-unsafe", archive_attempted: false };
      }
    }
    if (directOutcome === null) {
      archiveAttempted = true;
      await transport.write({ method: "thread/archive", id: 3, params: { threadId: thread } }, workDeadline);
      await transport.response(3, workDeadline);
    }
  } catch (error) {
    primaryFailure = error instanceof NativeQueueError ? error.code : "native-archive-error";
  } finally {
    const childClosed = await closeNativeQueueProcess(child, cleanupDeadline);
    const stderr = transport?.stderr ?? Buffer.alloc(0);
    if (primaryFailure !== null) {
      return { outcome: "ambiguous", reason: primaryFailure, archive_attempted: archiveAttempted, diagnostics: nativeQueueDiagnostics(stderr, { childClosed }) };
    }
    const diagnostics = nativeQueueDiagnostics(stderr, { childClosed });
    if (directOutcome !== null) return { ...directOutcome, diagnostics };
    if (diagnostics.categories.length > 0 || !childClosed) {
      return { outcome: "accepted-with-anomaly", reason: diagnostics.categories.length > 0 ? "diagnostic" : "shutdown-timeout", archive_attempted: true, diagnostics };
    }
    return { outcome: "accepted", archive_attempted: true, diagnostics };
  }
}
