import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { callbackStatus } from "./callbacks.mjs";
import { assertNoSymlinkComponents, CliError, directorySize, formatBytes } from "./core.mjs";
import { leaseStatus } from "./leases.mjs";
import { inspectInstalledRuntime } from "./managed.mjs";

async function consumedTombstones(stateRoot) {
  const root = resolve(stateRoot, "callbacks", "consumed");
  const guardRoot = dirname(resolve(stateRoot));
  await assertNoSymlinkComponents(guardRoot, root, "Consumed callback state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new CliError(`Consumed callback state contains a symbolic link: ${resolve(root, entry.name)}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const info = await stat(resolve(root, entry.name));
    result.push({
      callback_id: entry.name.slice(0, -5),
      age_seconds: Math.max(0, Math.floor((Date.now() - info.mtimeMs) / 1000)),
      bytes: info.size,
    });
  }
  return result.sort((a, b) => b.age_seconds - a.age_seconds);
}

export async function cleanupAudit(git) {
  const callbacks = await callbackStatus(git.stateRoot);
  const leases = await leaseStatus({ stateRoot: git.stateRoot });
  const tombstones = await consumedTombstones(git.stateRoot);
  const runtime = await inspectInstalledRuntime(git.root);
  const bytes = await directorySize(git.stateRoot);
  const recommendations = [];
  const oldPending = callbacks.pending.filter((item) => item.age_seconds > 24 * 60 * 60);
  if (oldPending.length) recommendations.push(`${oldPending.length} callback receipt(s) have been pending for more than 24 hours`);
  const expired = leases.filter((lease) => lease.state === "expired");
  if (expired.length) recommendations.push(`${expired.length} exclusive-resource lease(s) are expired and require owner review`);
  if (runtime.drift.length) recommendations.push("Pinned runtime has managed-file drift; review before sync");
  if (runtime.unexpected?.length) recommendations.push("Pinned runtime contains files not owned by codex-flow; review before sync");
  if (tombstones.some((item) => item.age_seconds > 30 * 24 * 60 * 60)) {
    recommendations.push("Consumed callback tombstones older than 30 days exist; v0.1 reports but does not delete them");
  }
  return {
    mutation_performed: false,
    state_root: git.stateRoot,
    state_bytes: bytes,
    state_size: formatBytes(bytes),
    callbacks,
    consumed_tombstones: tombstones,
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
