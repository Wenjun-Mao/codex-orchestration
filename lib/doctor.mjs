import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { callbackStatus, findCodexBinary } from "./callbacks.mjs";
import { readJson } from "./core.mjs";
import { projectConfigPath, validateProjectConfig } from "./config.mjs";
import { inspectInstalledRuntime } from "./managed.mjs";

export async function runDoctor(git) {
  const errors = [];
  const warnings = [];
  let config = null;
  try {
    const raw = await readJson(projectConfigPath(git.root), { allowMissing: true });
    if (!raw) errors.push("Project configuration is missing");
    else config = validateProjectConfig(raw);
  } catch (error) {
    errors.push(error.message);
  }

  let runtime = null;
  try {
    runtime = await inspectInstalledRuntime(git.root);
    if (!runtime.installed) errors.push("Pinned codex-flow runtime is not installed");
    else if (runtime.drift.length > 0) errors.push("Pinned codex-flow runtime has managed-file drift");
    if (runtime?.unexpected?.length > 0) errors.push("Pinned codex-flow runtime contains unowned files");
  } catch (error) {
    errors.push(error.message);
  }

  const agentsPath = resolve(git.root, "AGENTS.md");
  let agentsBlock = "missing";
  try {
    const agents = await readFile(agentsPath, "utf8");
    const starts = (agents.match(/<!-- codex-flow:start v[^\s]+ -->/g) ?? []).length;
    const ends = (agents.match(/<!-- codex-flow:end -->/g) ?? []).length;
    if (starts === 1 && ends === 1) agentsBlock = "present";
    else if (starts !== 0 || ends !== 0) {
      agentsBlock = "malformed";
      errors.push("AGENTS.md codex-flow managed block is malformed");
    } else warnings.push("AGENTS.md codex-flow managed block is absent");
  } catch (error) {
    if (error?.code === "ENOENT") warnings.push("AGENTS.md is absent");
    else errors.push(error.message);
  }

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 11)) {
    errors.push(`Node ${process.versions.node} is unsupported; require >=20.11`);
  }
  const codex = findCodexBinary();
  if (!codex) warnings.push("Codex CLI was not found; callback receipts can persist but queue delivery will be unavailable");
  else if (codex.error) warnings.push(`Codex CLI probe failed: ${codex.error}`);

  let callbacks = { pending: [], consumed_count: 0 };
  try {
    callbacks = await callbackStatus(git.stateRoot);
  } catch (error) {
    errors.push(`Callback state is invalid: ${error.message}`);
  }

  return {
    ok: errors.length === 0,
    project: config,
    git: {
      root: git.root,
      common_dir: git.commonDir,
      branch: git.branch,
      revision: git.revision,
      upstream: git.upstream,
      cleanliness: git.cleanliness,
    },
    runtime: runtime ? {
      installed: runtime.installed,
      package_version: runtime.manifest?.package_version ?? null,
      drift: runtime.drift,
      unexpected: runtime.unexpected ?? [],
    } : null,
    agents_block: agentsBlock,
    node_version: process.versions.node,
    codex_cli: codex,
    thread_creation: "runtime-probe-required",
    callbacks: {
      pending_count: callbacks.pending.length,
      consumed_count: callbacks.consumed_count,
    },
    errors,
    warnings,
  };
}
