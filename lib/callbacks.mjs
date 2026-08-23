import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  ensureExactJson,
  pathExists,
  readJson,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";

export const ACCOUNTING_FIELDS = [
  "PRODUCT",
  "CROSS_CUTTING_PRODUCT_FIX",
  "ENVIRONMENT",
  "PROOF_HARNESS",
];

const RECEIPT_FIELDS = [
  "source_thread_id",
  "executor_id",
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
  source_thread_id: 128,
  executor_id: 128,
  classification: 96,
  branch: 256,
  commit: 128,
  upstream: 256,
  cleanliness: 32,
  result_or_blocker: 512,
  next_decision: 512,
};

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:client_secret|access_token|password)\s*[:=]\s*\S{8,}/i,
];

function assertNoSecretLikeText(payload) {
  for (const field of Object.keys(TEXT_LIMITS)) {
    const value = payload[field];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) throw new CliError(`Terminal receipt ${field} contains secret-like material`);
    }
  }
}

export function validateTerminalReceipt(value) {
  requireExactFields(value, { required: RECEIPT_FIELDS }, "Terminal receipt");
  const payload = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    payload[field] = requireText(value[field], field, {
      max,
      safeId: field === "source_thread_id" || field === "executor_id",
    });
  }
  requireExactFields(value.accounting, { required: ACCOUNTING_FIELDS }, "Terminal receipt accounting");
  const accounting = {};
  for (const field of ACCOUNTING_FIELDS) {
    const amount = value.accounting[field];
    if (!Number.isFinite(amount) || amount < 0) throw new CliError(`Invalid accounting bucket: ${field}`);
    accounting[field] = amount;
  }
  const normalized = {
    schema_version: 1,
    kind: "terminal-callback-fallback",
    ...payload,
    accounting,
  };
  assertNoSecretLikeText(normalized);
  if (Buffer.byteLength(stableStringify(normalized), "utf8") > 8192) {
    throw new CliError("Terminal receipt exceeds the 8 KiB serialized limit");
  }
  return normalized;
}

export function callbackIdFor(payload) {
  return `terminal-v1-${sha256(stableStringify(payload))}`;
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) throw new CliError("Unsafe callback state path");
  return path;
}

export function callbackPaths(stateRoot, payload) {
  const callbacksRoot = resolve(stateRoot, "callbacks");
  const sourceRoot = resolve(callbacksRoot, "sources", payload.source_thread_id);
  const receiptDirectory = resolve(sourceRoot, "terminal");
  const deliveryDirectory = resolve(sourceRoot, "delivery");
  const lockDirectory = resolve(sourceRoot, "locks");
  const consumedDirectory = resolve(callbacksRoot, "consumed");
  const callbackId = callbackIdFor(payload);
  return {
    callbacksRoot,
    callbackId,
    receipt: safeChild(receiptDirectory, `${payload.executor_id}.json`),
    delivery: safeChild(deliveryDirectory, `${payload.executor_id}.json`),
    lock: safeChild(lockDirectory, `${payload.executor_id}.lock.json`),
    consumed: safeChild(consumedDirectory, `${callbackId}.json`),
  };
}

function callbackGuardRoot(stateRoot) {
  return dirname(resolve(stateRoot));
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

function callbackMessage(callbackId, payload) {
  return [
    "Queued terminal callback. Integrate this callback at most once by callback_id.",
    stableStringify({
      schema_version: 1,
      kind: "queued-terminal-callback",
      callback_id: callbackId,
      receipt: payload,
    }, 2),
  ].join("\n");
}

function runQueue(threadId, message) {
  let lastReason = "codex-not-found";
  for (const binary of codexBinaryCandidates()) {
    const result = spawnSync(binary, ["queue", "--thread", threadId, "--message", message], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 30_000,
    });
    if (result.error?.code === "ENOENT") continue;
    if (result.error || result.status !== 0) {
      lastReason = result.error?.code ?? `exit-${result.status ?? "unknown"}`;
      return { accepted: false, reason: lastReason };
    }
    return { accepted: true };
  }
  return { accepted: false, reason: lastReason };
}

async function validateConsumed(paths, payload, guardRoot) {
  const consumed = await readJson(paths.consumed, {
    allowMissing: true,
    guardRoot,
  });
  if (!consumed) return false;
  if (
    consumed.callback_id !== paths.callbackId
    || consumed.source_thread_id !== payload.source_thread_id
    || consumed.executor_id !== payload.executor_id
  ) {
    throw new CliError("Consumed callback tombstone does not match the terminal receipt");
  }
  return true;
}

export async function deliverCallback({ stateRoot, receipt, noQueue = false }) {
  const payload = validateTerminalReceipt(receipt);
  const paths = callbackPaths(stateRoot, payload);
  const guardRoot = callbackGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `terminal callback ${payload.executor_id}`,
  }, async () => {
    if (await validateConsumed(paths, payload, guardRoot)) return { status: "already-consumed", callback_id: paths.callbackId };
    await ensureExactJson(paths.receipt, payload, { guardRoot });
    const existingDelivery = await readJson(paths.delivery, { allowMissing: true, guardRoot });
    if (existingDelivery) {
      if (existingDelivery.callback_id !== paths.callbackId || existingDelivery.status !== "accepted") {
        throw new CliError("Existing terminal callback delivery state is invalid");
      }
      return { status: "already-accepted", callback_id: paths.callbackId };
    }
    if (noQueue) return { status: "persisted", callback_id: paths.callbackId };
    const result = runQueue(payload.source_thread_id, callbackMessage(paths.callbackId, payload));
    if (!result.accepted) {
      throw new CliError(`Terminal callback queue unavailable (${result.reason}); receipt retained`, 75);
    }
    await ensureExactJson(paths.delivery, {
      schema_version: 1,
      kind: "terminal-callback-delivery",
      callback_id: paths.callbackId,
      source_thread_id: payload.source_thread_id,
      executor_id: payload.executor_id,
      transport: "codex-thread-queue",
      status: "accepted",
    }, { guardRoot });
    return { status: "accepted", callback_id: paths.callbackId };
  });
}

export async function consumeCallback({ stateRoot, sourceThreadId, executorId, callbackId }) {
  requireText(sourceThreadId, "source_thread_id", { max: 128, safeId: true });
  requireText(executorId, "executor_id", { max: 128, safeId: true });
  requireText(callbackId, "callback_id", { max: 96, safeId: true });
  const receiptDirectory = resolve(stateRoot, "callbacks", "sources", sourceThreadId, "terminal");
  const receiptPath = safeChild(receiptDirectory, `${executorId}.json`);
  const lockPath = safeChild(
    resolve(stateRoot, "callbacks", "sources", sourceThreadId, "locks"),
    `${executorId}.lock.json`,
  );
  const guardRoot = callbackGuardRoot(stateRoot);
  return withProcessLock({
    path: lockPath,
    guardRoot,
    label: `terminal callback ${executorId}`,
  }, async () => {
    const receipt = await readJson(receiptPath, { allowMissing: true, guardRoot });
    if (!receipt) {
      const tombstonePath = safeChild(resolve(stateRoot, "callbacks", "consumed"), `${callbackId}.json`);
      const tombstone = await readJson(tombstonePath, { allowMissing: true, guardRoot });
      if (
        tombstone?.callback_id === callbackId
        && tombstone?.source_thread_id === sourceThreadId
        && tombstone?.executor_id === executorId
      ) return { status: "already-consumed", callback_id: callbackId };
      throw new CliError("Terminal callback receipt does not exist");
    }
    const input = Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, receipt[field]]));
    const payload = validateTerminalReceipt(input);
    const paths = callbackPaths(stateRoot, payload);
    if (callbackId !== paths.callbackId) throw new CliError("callback_id does not match the persisted receipt");
    await ensureExactJson(paths.consumed, {
      schema_version: 1,
      kind: "terminal-callback-consumed",
      callback_id: paths.callbackId,
      source_thread_id: payload.source_thread_id,
      executor_id: payload.executor_id,
    }, { guardRoot });
    await Promise.all([
      rm(paths.receipt, { force: true }),
      rm(paths.delivery, { force: true }),
    ]);
    return { status: "consumed", callback_id: paths.callbackId };
  });
}

async function listJsonFiles(root, guardRoot) {
  const result = [];
  await assertNoSymlinkComponents(guardRoot, root, "Callback state path");
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
    if (entry.isDirectory()) result.push(...await listJsonFiles(path, guardRoot));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

export async function callbackStatus(stateRoot) {
  const guardRoot = callbackGuardRoot(stateRoot);
  const root = resolve(stateRoot, "callbacks");
  const sources = resolve(root, "sources");
  const consumedRoot = resolve(root, "consumed");
  const pending = [];
  for (const path of await listJsonFiles(sources, guardRoot)) {
    if (!path.split(/[\\/]/).includes("terminal")) continue;
    const receipt = await readJson(path, { guardRoot });
    const payload = validateTerminalReceipt(Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, receipt[field]])));
    const paths = callbackPaths(stateRoot, payload);
    pending.push({
      callback_id: paths.callbackId,
      source_thread_id: payload.source_thread_id,
      executor_id: payload.executor_id,
      classification: payload.classification,
      delivery: await pathExists(paths.delivery) ? "accepted" : "pending",
      age_seconds: Math.max(0, Math.floor((Date.now() - (await stat(path)).mtimeMs) / 1000)),
    });
  }
  return {
    pending: pending.sort((a, b) => b.age_seconds - a.age_seconds),
    consumed_count: (await listJsonFiles(consumedRoot, guardRoot)).length,
  };
}
