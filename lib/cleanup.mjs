import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { callbackStatus } from "./callbacks.mjs";
import { assertNoSymlinkComponents, CliError, directorySize, formatBytes } from "./core.mjs";
import { leaseStatus } from "./leases.mjs";
import { inspectInstalledRuntime } from "./managed.mjs";
import { recipientStatuses } from "./recipients.mjs";
import { taskOperationStatus } from "./task-operations.mjs";

async function countJsonFiles(root, guardRoot) {
  await assertNoSymlinkComponents(guardRoot, root, "Legacy callback state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let count = 0;
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new CliError(`Legacy callback state contains a symbolic link: ${path}`);
    if (entry.isDirectory()) count += await countJsonFiles(path, guardRoot);
    else if (entry.isFile() && entry.name.endsWith(".json")) count += 1;
  }
  return count;
}

async function legacyCallbackState(stateRoot) {
  const guardRoot = dirname(resolve(stateRoot));
  return {
    source_records: await countJsonFiles(resolve(stateRoot, "callbacks", "sources"), guardRoot),
    consumed_tombstones: await countJsonFiles(resolve(stateRoot, "callbacks", "consumed"), guardRoot),
  };
}

export async function cleanupAudit(git) {
  const callbacks = await callbackStatus(git.stateRoot);
  const leases = await leaseStatus({ stateRoot: git.stateRoot });
  const operations = await taskOperationStatus({ stateRoot: git.stateRoot });
  const recipients = await recipientStatuses({ stateRoot: git.stateRoot });
  const legacyCallbacks = await legacyCallbackState(git.stateRoot);
  const runtime = await inspectInstalledRuntime(git.root);
  const bytes = await directorySize(git.stateRoot);
  const recommendations = [];
  const oldPending = callbacks.pending.filter((item) => item.age_seconds > 24 * 60 * 60);
  if (oldPending.length) recommendations.push(`${oldPending.length} callback record(s) have been pending for more than 24 hours`);
  const ambiguousCallbacks = callbacks.pending.filter((item) => item.delivery === "enqueue-attempted");
  if (ambiguousCallbacks.length) recommendations.push(`${ambiguousCallbacks.length} callback enqueue(s) require inspect-before-retry reconciliation`);
  const callbacksDueForExpiry = callbacks.pending.filter((item) => item.effective_delivery === "expired-due");
  if (callbacksDueForExpiry.length) recommendations.push(`${callbacksDueForExpiry.length} callback record(s) have reached their explicit expiry and may be marked expired`);
  const ambiguousOperations = operations.filter((operation) => ["ambiguous", "ambiguous-due", "dispatching"].includes(operation.effective_status));
  if (ambiguousOperations.length) recommendations.push(`${ambiguousOperations.length} task creation operation(s) require host inspection or bounded-wait review`);
  const expired = leases.filter((lease) => lease.state === "expired");
  if (expired.length) recommendations.push(`${expired.length} exclusive-resource lease(s) are expired and require owner review`);
  if (runtime.drift.length) recommendations.push("Pinned runtime has managed-file drift; review before sync");
  if (runtime.unexpected?.length) recommendations.push("Pinned runtime contains files not owned by codex-flow; review before sync");
  if (legacyCallbacks.source_records || legacyCallbacks.consumed_tombstones) {
    recommendations.push("Legacy v0.1 callback state exists; preserve it until an explicit migration or retention decision");
  }
  if (callbacks.superseded_count || callbacks.expired_count) {
    recommendations.push("Terminal callback journal contains superseded or expired records; v0.2 reports but does not delete them");
  }
  return {
    mutation_performed: false,
    state_root: git.stateRoot,
    state_bytes: bytes,
    state_size: formatBytes(bytes),
    callbacks,
    legacy_callbacks: legacyCallbacks,
    task_operations: operations,
    recipients,
    leases,
    runtime: {
      installed: runtime.installed,
      package_version: runtime.manifest?.package_version ?? null,
      drift: runtime.drift,
      unexpected: runtime.unexpected ?? [],
    },
    recommendations,
  };
}
