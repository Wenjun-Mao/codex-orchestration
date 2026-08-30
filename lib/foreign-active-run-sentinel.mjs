import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertNoSymlinkComponents, CliError, SAFE_ID } from "./core.mjs";

export const MAX_FOREIGN_RUN_NAMESPACES = 32;
export const MAX_FOREIGN_LIFECYCLE_BYTES = 64 * 1024;

function foreignLifecyclePath(commonDir, namespace) {
  return join(commonDir, "codex-flow", namespace, "runs", "lifecycle.json");
}

function malformed(namespace, detail) {
  throw new CliError(`Foreign active-run sentinel rejected ${namespace}: ${detail}`, 73);
}

async function lifecycleActiveRun({ commonDir, namespace }) {
  const path = foreignLifecyclePath(commonDir, namespace);
  await assertNoSymlinkComponents(commonDir, path, "Foreign active-run lifecycle");
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile()) malformed(namespace, "lifecycle is not a regular file");
  if (info.size > MAX_FOREIGN_LIFECYCLE_BYTES) {
    malformed(namespace, `lifecycle exceeds ${MAX_FOREIGN_LIFECYCLE_BYTES} bytes`);
  }
  let lifecycle;
  try {
    lifecycle = JSON.parse(await readFile(path, "utf8"));
  } catch {
    malformed(namespace, "lifecycle is not valid JSON");
  }
  if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)) {
    malformed(namespace, "lifecycle is not an object");
  }
  if (!("active_run_id" in lifecycle)) malformed(namespace, "lifecycle has no active_run_id");
  if (lifecycle.active_run_id === null) return null;
  if (typeof lifecycle.active_run_id !== "string" || !SAFE_ID.test(lifecycle.active_run_id)) {
    malformed(namespace, "active_run_id is invalid");
  }
  return lifecycle.active_run_id;
}

export async function foreignActiveRunCollisions({ gitCommonDirectory, currentNamespace }) {
  const commonDir = resolve(gitCommonDirectory);
  if (typeof currentNamespace !== "string" || !SAFE_ID.test(currentNamespace)) {
    throw new CliError("currentNamespace must be a safe namespace");
  }
  await assertNoSymlinkComponents(commonDir, commonDir, "Git common directory");
  const stateRoot = join(commonDir, "codex-flow");
  await assertNoSymlinkComponents(commonDir, stateRoot, "Foreign active-run state root");
  let entries;
  try {
    entries = await readdir(stateRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const symlink = entries.find((entry) => entry.isSymbolicLink() && entry.name !== currentNamespace);
  if (symlink) malformed(symlink.name, "namespace is a symbolic link");
  const namespaces = entries
    .filter((entry) => entry.isDirectory() && entry.name !== currentNamespace)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (namespaces.length > MAX_FOREIGN_RUN_NAMESPACES) {
    throw new CliError(
      `Foreign active-run sentinel exceeds ${MAX_FOREIGN_RUN_NAMESPACES} namespaces`,
      73,
    );
  }
  const collisions = [];
  for (const namespace of namespaces) {
    const runId = await lifecycleActiveRun({ commonDir, namespace });
    if (runId !== null) collisions.push({ namespace, run_id: runId });
  }
  return collisions;
}

export async function assertNoForeignActiveRunCollision(options) {
  const collisions = await foreignActiveRunCollisions(options);
  if (collisions.length > 0) {
    const { namespace, run_id: runId } = collisions[0];
    throw new CliError(`Foreign active Codex Flow run blocks admission: ${namespace}/${runId}`, 73);
  }
}
