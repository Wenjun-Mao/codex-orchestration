#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliError,
  PACKAGE_VERSION,
  readJson,
  readJsonInput,
  requireEnum,
  requireInteger,
  stableStringify,
} from "../lib/core.mjs";
import { callbackStatus, consumeCallback, deliverCallback } from "../lib/callbacks.mjs";
import { cleanupAudit } from "../lib/cleanup.mjs";
import {
  projectConfigPath,
  REASONING_EFFORTS,
  validateProjectConfig,
  writeProjectConfig,
} from "../lib/config.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { discoverGit, gitSnapshot } from "../lib/git.mjs";
import { acquireLease, leaseStatus, releaseLease } from "../lib/leases.mjs";
import {
  initializeRepository,
  synchronizeRepository,
  withRepositoryManagementLock,
} from "../lib/managed.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { applyTaskDefaults, renderTaskPacket, validateTaskPacket } from "../lib/task-packet.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `codex-flow ${PACKAGE_VERSION}

Usage:
  codex-flow init [--check] [--force] [--project-id ID] [--max-concurrency N]
                  [--model MODEL] [--reasoning-effort EFFORT]
  codex-flow sync [--check] [--force]
  codex-flow config show [--json]
  codex-flow config set [--model MODEL|host-default]
                        [--reasoning-effort EFFORT|host-default]
                        [--max-concurrency N] [--json]
  codex-flow doctor [--json]
  codex-flow task start --role coordinator|executor
  codex-flow task packet validate|render <packet.json> [--model MODEL]
                  [--reasoning-effort EFFORT] [--json]
  codex-flow plan validate <plan.json> [--json]
  codex-flow callback deliver [--file receipt.json] [--no-queue] [--json]
  codex-flow callback consume --callback-id ID --source-thread-id ID --executor-id ID [--json]
  codex-flow callback status [--json]
  codex-flow lease acquire --resource ID --owner ID [--ttl-seconds N] [--break-expired] [--json]
  codex-flow lease release --resource ID --owner ID --token TOKEN [--json]
  codex-flow lease status [--resource ID] [--json]
  codex-flow cleanup audit [--json]
`;

function parse(options, args = process.argv.slice(2), allowPositionals = true) {
  return parseArgs({ args, options, allowPositionals, strict: true });
}

function boolAndJsonOptions(extra = {}) {
  return { json: { type: "boolean", default: false }, ...extra };
}

function output(value, { json = false, human } = {}) {
  if (json || !human) console.log(stableStringify(value, 2));
  else console.log(human(value));
}

function requireCanonicalSource() {
  if (
    existsSync(resolve(packageRoot, "package.json"))
    && existsSync(resolve(packageRoot, "templates", "agents-block.md"))
  ) return;
  throw new CliError("Run init/sync from the canonical codex-orchestration package, not a repository-pinned snapshot");
}

async function loadConfig(gitRoot) {
  const raw = await readJson(projectConfigPath(gitRoot), { allowMissing: true, guardRoot: gitRoot });
  if (!raw) throw new CliError("Project is not initialized; run codex-flow init from the canonical package");
  return validateProjectConfig(raw);
}

function withTaskOverrides(packet, values) {
  const result = structuredClone(packet);
  if (values.model !== undefined) result.model = values.model === "host-default" ? null : values.model;
  if (values["reasoning-effort"] !== undefined) {
    const effort = values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"];
    requireEnum(effort, REASONING_EFFORTS, "reasoning_effort");
    result.reasoning_effort = effort;
  }
  return result;
}

function repositoryOptions(git) {
  return {
    gitRoot: git.root,
    stateRoot: git.stateRoot,
    stateGuardRoot: git.commonDir,
  };
}

async function commandInit(args) {
  requireCanonicalSource();
  const { values } = parse({
    check: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "project-id": { type: "string" },
    "max-concurrency": { type: "string" },
    model: { type: "string" },
    "reasoning-effort": { type: "string" },
  }, args);
  const git = discoverGit();
  const max = values["max-concurrency"] === undefined
    ? undefined
    : requireInteger(Number(values["max-concurrency"]), "max_concurrency", { min: 1, max: 32 });
  if (values["reasoning-effort"] !== undefined) {
    const effort = values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"];
    requireEnum(effort, REASONING_EFFORTS, "reasoning_effort");
  }
  const result = await initializeRepository({
    ...repositoryOptions(git),
    packageRoot,
    check: values.check,
    force: values.force,
    projectId: values["project-id"],
    maxParallelExecutors: max,
    defaultModel: values.model === "host-default" ? null : values.model,
    defaultReasoningEffort: values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"],
  });
  output(result, { human: (item) => `codex-flow ${values.check ? "check" : "initialization"} passed for ${item.project_id}${item.changed ? " (updated)" : " (unchanged)"}` });
}

async function commandSync(args) {
  requireCanonicalSource();
  const { values } = parse({
    check: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  }, args);
  const git = discoverGit();
  const result = await synchronizeRepository({
    ...repositoryOptions(git),
    packageRoot,
    check: values.check,
    force: values.force,
  });
  output(result, {
    human: (item) => `codex-flow sync ${values.check ? "check passed" : item.changed ? "updated managed files" : "was already current"}`,
  });
}

async function commandConfig(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  const config = await loadConfig(git.root);
  if (subcommand === "show") {
    const { values } = parse(boolAndJsonOptions(), rest);
    output(config, {
      json: values.json,
      human: (item) => [
        `Project: ${item.project_id}`,
        `Default model: ${item.default_model ?? "host default"}`,
        `Default reasoning effort: ${item.default_reasoning_effort ?? "host default"}`,
        `Maximum parallel executors: ${item.max_parallel_executors}`,
      ].join("\n"),
    });
    return;
  }
  if (subcommand === "set") {
    const { values } = parse(boolAndJsonOptions({
      model: { type: "string" },
      "reasoning-effort": { type: "string" },
      "max-concurrency": { type: "string" },
    }), rest);
    if (
      values.model === undefined
      && values["reasoning-effort"] === undefined
      && values["max-concurrency"] === undefined
    ) throw new CliError("config set requires at least one setting");
    const written = await withRepositoryManagementLock(repositoryOptions(git), async () => {
      const next = { ...await loadConfig(git.root) };
      if (values.model !== undefined) next.default_model = values.model === "host-default" ? null : values.model;
      if (values["reasoning-effort"] !== undefined) {
        const effort = values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"];
        requireEnum(effort, REASONING_EFFORTS, "default_reasoning_effort");
        next.default_reasoning_effort = effort;
      }
      if (values["max-concurrency"] !== undefined) {
        next.max_parallel_executors = requireInteger(Number(values["max-concurrency"]), "max_parallel_executors", {
          min: 1,
          max: 32,
        });
      }
      return writeProjectConfig(git.root, next);
    });
    output(written, {
      json: values.json,
      human: (item) => `Project defaults updated: ${item.default_model ?? "host default"} / ${item.default_reasoning_effort ?? "host default"}; max ${item.max_parallel_executors}`,
    });
    return;
  }
  throw new CliError("config requires show or set");
}

async function commandDoctor(args) {
  const { values } = parse(boolAndJsonOptions(), args);
  const result = await runDoctor(gitSnapshot());
  output(result, {
    json: values.json,
    human: (item) => [
      `codex-flow doctor: ${item.ok ? "PASS" : "FAIL"}`,
      `project: ${item.project?.project_id ?? "unconfigured"}`,
      `git: ${item.git.branch} ${item.git.revision.slice(0, 12)} (${item.git.cleanliness})`,
      `runtime: ${item.runtime?.package_version ?? "missing"}${item.runtime?.drift?.length ? `, ${item.runtime.drift.length} drift item(s)` : ""}`,
      `task-thread creation: ${item.thread_creation}`,
      `callbacks: ${item.callbacks.pending_count} pending, ${item.callbacks.consumed_count} consumed`,
      ...item.warnings.map((warning) => `warning: ${warning}`),
      ...item.errors.map((error) => `error: ${error}`),
    ].join("\n"),
  });
  if (!result.ok) process.exitCode = 1;
}

async function commandTask(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  const config = await loadConfig(git.root);
  if (subcommand === "start") {
    const { values } = parse({ role: { type: "string" } }, rest);
    requireEnum(values.role, ["coordinator", "executor"], "role");
    const rolePath = resolve(git.root, ".codex", "orchestration", "roles", `${values.role}.md`);
    const role = await readFile(rolePath, "utf8").catch(() => {
      throw new CliError(`Pinned role entrypoint is missing: ${rolePath}`);
    });
    console.log([
      `Project: ${config.project_id}`,
      `Default task model: ${config.default_model ?? "host default"}`,
      `Default reasoning effort: ${config.default_reasoning_effort ?? "host default"}`,
      `Maximum parallel executors: ${config.max_parallel_executors}`,
      "Task-thread creation capability: probe the current host; this CLI cannot infer it.",
      "",
      role.trim(),
      "",
    ].join("\n"));
    return;
  }
  if (subcommand === "packet") {
    const [action, ...packetArgs] = rest;
    if (!["validate", "render"].includes(action)) throw new CliError("task packet requires validate or render");
    const { values, positionals } = parse(boolAndJsonOptions({
      model: { type: "string" },
      "reasoning-effort": { type: "string" },
    }), packetArgs);
    if (positionals.length !== 1) throw new CliError("task packet requires exactly one JSON file");
    const raw = await readJson(resolve(positionals[0]));
    const packet = validateTaskPacket(withTaskOverrides(applyTaskDefaults(raw, config), values));
    if (action === "render") {
      if (values.json) output(packet, { json: true });
      else console.log(renderTaskPacket(packet));
    }
    else output(packet, {
      json: values.json,
      human: (item) => `Task packet ${item.task_id} is valid: ${item.model ?? "host default"} / ${item.reasoning_effort ?? "host default"}`,
    });
    return;
  }
  throw new CliError("task requires start or packet");
}

async function commandPlan(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "validate") throw new CliError("plan requires validate");
  const { values, positionals } = parse(boolAndJsonOptions(), rest);
  if (positionals.length !== 1) throw new CliError("plan validate requires exactly one JSON file");
  const git = discoverGit();
  const config = await loadConfig(git.root);
  const result = validatePlan(await readJson(resolve(positionals[0])), {
    projectMaxConcurrency: config.max_parallel_executors,
  });
  output(result, {
    json: values.json,
    human: (item) => [
      `Plan ${item.plan_id} is valid with ${item.tasks.length} task(s).`,
      ...item.waves.map((wave, index) => `wave ${index + 1}: ${wave.join(", ")}`),
    ].join("\n"),
  });
}

async function commandCallback(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  if (subcommand === "deliver") {
    const { values } = parse(boolAndJsonOptions({
      file: { type: "string" },
      "no-queue": { type: "boolean", default: false },
    }), rest);
    const receipt = await readJsonInput(values.file ? resolve(values.file) : null);
    const result = await deliverCallback({ stateRoot: git.stateRoot, receipt, noQueue: values["no-queue"] });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "consume") {
    const { values } = parse(boolAndJsonOptions({
      "callback-id": { type: "string" },
      "source-thread-id": { type: "string" },
      "executor-id": { type: "string" },
    }), rest);
    const result = await consumeCallback({
      stateRoot: git.stateRoot,
      callbackId: values["callback-id"],
      sourceThreadId: values["source-thread-id"],
      executorId: values["executor-id"],
    });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions(), rest);
    const result = await callbackStatus(git.stateRoot);
    output(result, {
      json: values.json,
      human: (item) => [
        `${item.pending.length} pending callback(s); ${item.consumed_count} consumed tombstone(s).`,
        ...item.pending.map((entry) => `${entry.callback_id} ${entry.delivery} ${entry.classification} (${entry.executor_id})`),
      ].join("\n"),
    });
    return;
  }
  throw new CliError("callback requires deliver, consume, or status");
}

async function commandLease(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  if (subcommand === "acquire") {
    const { values } = parse(boolAndJsonOptions({
      resource: { type: "string" },
      owner: { type: "string" },
      "ttl-seconds": { type: "string", default: "7200" },
      "break-expired": { type: "boolean", default: false },
    }), rest);
    const result = await acquireLease({
      stateRoot: git.stateRoot,
      resource: values.resource,
      owner: values.owner,
      ttlSeconds: Number(values["ttl-seconds"]),
      breakExpired: values["break-expired"],
    });
    output(result, {
      json: values.json,
      human: (item) => [
        `Lease ${item.status}: ${item.lease.resource} owned by ${item.lease.owner} until ${item.lease.expires_at}`,
        `Release token: ${item.lease.token}`,
      ].join("\n"),
    });
    return;
  }
  if (subcommand === "release") {
    const { values } = parse(boolAndJsonOptions({
      resource: { type: "string" },
      owner: { type: "string" },
      token: { type: "string" },
    }), rest);
    const result = await releaseLease({ stateRoot: git.stateRoot, resource: values.resource, owner: values.owner, token: values.token ?? null });
    output(result, { json: values.json, human: (item) => `Lease ${item.status}: ${item.resource}` });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions({ resource: { type: "string" } }), rest);
    const result = await leaseStatus({ stateRoot: git.stateRoot, resource: values.resource ?? null });
    output(result, {
      json: values.json,
      human: (items) => items.length ? items.map((item) => `${item.resource}: ${item.state}, owner ${item.owner}, expires ${item.expires_at}`).join("\n") : "No leases.",
    });
    return;
  }
  throw new CliError("lease requires acquire, release, or status");
}

async function commandCleanup(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "audit") throw new CliError("cleanup v0.1 supports audit only");
  const { values } = parse(boolAndJsonOptions(), rest);
  const result = await cleanupAudit(gitSnapshot());
  output(result, {
    json: values.json,
    human: (item) => [
      `Cleanup audit only; no mutation performed. State size: ${item.state_size}.`,
      `Callbacks: ${item.callbacks.pending.length} pending, ${item.consumed_tombstones.length} consumed.`,
      `Leases: ${item.leases.filter((lease) => lease.state === "active").length} active, ${item.leases.filter((lease) => lease.state === "expired").length} expired.`,
      ...item.recommendations.map((recommendation) => `review: ${recommendation}`),
    ].join("\n"),
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(PACKAGE_VERSION);
    return;
  }
  if (command === "init") return commandInit(args);
  if (command === "sync") return commandSync(args);
  if (command === "config") return commandConfig(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "task") return commandTask(args);
  if (command === "plan") return commandPlan(args);
  if (command === "callback") return commandCallback(args);
  if (command === "lease") return commandLease(args);
  if (command === "cleanup") return commandCleanup(args);
  throw new CliError(`Unknown command: ${command}\n\n${HELP}`);
}

try {
  await main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`codex-flow: ${error.message}`);
    process.exitCode = error.exitCode;
  } else {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
