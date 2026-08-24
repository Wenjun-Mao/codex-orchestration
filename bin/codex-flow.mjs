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
import {
  callbackStatus,
  consumeCallback,
  deliverCallback,
  expireCallback,
  expireCallbacks,
  observeCallback,
  reconcileCallback,
} from "../lib/callbacks.mjs";
import { cleanupAudit } from "../lib/cleanup.mjs";
import {
  projectConfigPath,
  ORDINARY_COMPLETION_AUTHORITIES,
  REASONING_EFFORTS,
  validateProjectConfig,
  writeProjectConfig,
} from "../lib/config.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { discoverGit, gitSnapshot } from "../lib/git.mjs";
import {
  applyInstallationPlan,
  checkRepositoryInstallation,
  createInstallationPlan,
} from "../lib/installation.mjs";
import { acquireLease, leaseStatus, releaseLease } from "../lib/leases.mjs";
import {
  synchronizeRepository,
  withRepositoryManagementLock,
} from "../lib/managed.mjs";
import { validatePlan } from "../lib/plan.mjs";
import {
  bindRecipient,
  rebindRecipient,
  recipientStatus,
  recipientStatuses,
  resolveRecipient,
} from "../lib/recipients.mjs";
import { applyTaskDefaults, renderTaskPacket, validateTaskPacket } from "../lib/task-packet.mjs";
import {
  beginTaskOperationAttempt,
  prepareTaskOperation,
  reconcileTaskOperation,
  taskOperationStatus,
} from "../lib/task-operations.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `codex-flow ${PACKAGE_VERSION}

Usage:
  codex-flow init --plan [--json] [initialization options]
  codex-flow init --apply-plan PLAN_ID [initialization options]
  codex-flow init --check
  initialization options:
                  [--force] [--project-id ID] [--max-concurrency N]
                  [--model MODEL] [--reasoning-effort EFFORT]
                  [--callback-authority journal-monitor]
                  [--agents-mode managed|external]
                  [--external-agents-path PATH] [--attest-external-agents]
  codex-flow sync [--check] [--force]
  codex-flow config show [--json]
  codex-flow config set [--model MODEL|host-default]
                        [--reasoning-effort EFFORT|host-default]
                        [--max-concurrency N] [--json]
  codex-flow doctor [--json]
  codex-flow task start --role coordinator|executor
  codex-flow task packet validate|render <packet.json> [--model MODEL]
                  [--reasoning-effort EFFORT] [--json]
  codex-flow task operation prepare --file <packet.json> [--json]
  codex-flow task operation attempt --operation-id ID [--timeout-seconds N] [--json]
  codex-flow task operation reconcile --operation-id ID --attempt-id ID
                  --outcome observed|not-created|ambiguous|failed [observation fields] [--json]
  codex-flow task operation status [--operation-id ID] [--json]
  codex-flow plan validate <plan.json> [--json]
  codex-flow recipient bind --lineage-id ID --thread-id ID [--fence-token TOKEN] [--json]
  codex-flow recipient rebind --lineage-id ID --thread-id ID --generation N
                  --fence-token TOKEN [--next-fence-token TOKEN] [--json]
  codex-flow recipient status [--lineage-id ID] [--json]
  codex-flow recipient resolve --lineage-id ID --thread-id ID --generation N [--json]
  codex-flow callback deliver [--file receipt.json] [--no-queue] [--json]
  codex-flow callback observe --callback-id ID --lineage-id ID --thread-id ID --generation N
                  --source journal-monitor|monitor-recovery|queue-turn [--json]
  codex-flow callback consume --callback-id ID --lineage-id ID --thread-id ID
                  --generation N --executor-id ID [--json]
  codex-flow callback reconcile --callback-id ID
                  --outcome queued|not-queued|deleted|started [--submission-id ID] [--json]
  codex-flow callback expire [--callback-id ID] [--at TIMESTAMP] [--json]
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

function recipientFromValues(values) {
  return {
    lineage_id: values["lineage-id"],
    thread_id: values["thread-id"],
    generation: requireInteger(Number(values.generation), "generation", { min: 1 }),
  };
}

async function commandInit(args) {
  requireCanonicalSource();
  const { values } = parse({
    plan: { type: "boolean", default: false },
    "apply-plan": { type: "string" },
    check: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "project-id": { type: "string" },
    "max-concurrency": { type: "string" },
    model: { type: "string" },
    "reasoning-effort": { type: "string" },
    "agents-mode": { type: "string" },
    "callback-authority": { type: "string" },
    "external-agents-path": { type: "string" },
    "attest-external-agents": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  }, args);
  const selectedModes = [values.plan, Boolean(values["apply-plan"]), values.check].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new CliError("init requires exactly one of --plan, --apply-plan PLAN_ID, or --check");
  }
  if (values.check && (
    values.force
    || values["project-id"] !== undefined
    || values["max-concurrency"] !== undefined
    || values.model !== undefined
    || values["reasoning-effort"] !== undefined
    || values["callback-authority"] !== undefined
    || values["agents-mode"] !== undefined
    || values["external-agents-path"] !== undefined
    || values["attest-external-agents"]
  )) throw new CliError("init --check does not accept initialization changes");
  if (values["agents-mode"] !== undefined) {
    requireEnum(values["agents-mode"], ["managed", "external"], "agents_mode");
  }
  if (values["callback-authority"] !== undefined) {
    requireEnum(values["callback-authority"], ORDINARY_COMPLETION_AUTHORITIES, "callback_authority");
  }
  const git = gitSnapshot();
  const max = values["max-concurrency"] === undefined
    ? undefined
    : requireInteger(Number(values["max-concurrency"]), "max_concurrency", { min: 1, max: 32 });
  if (values["reasoning-effort"] !== undefined) {
    const effort = values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"];
    requireEnum(effort, REASONING_EFFORTS, "reasoning_effort");
  }
  const options = {
    ...repositoryOptions(git),
    packageRoot,
    repository: {
      branch: git.branch,
      revision: git.revision,
      cleanliness: git.cleanliness,
    },
    force: values.force,
    projectId: values["project-id"],
    maxParallelExecutors: max,
    defaultModel: values.model === "host-default" ? null : values.model,
    defaultReasoningEffort: values["reasoning-effort"] === "host-default" ? null : values["reasoning-effort"],
    ordinaryCompletionAuthority: values["callback-authority"],
    agentsMode: values["agents-mode"],
    externalAgentsPath: values["external-agents-path"],
    attestExternalAgents: values["attest-external-agents"],
  };
  if (values.plan) {
    const result = await createInstallationPlan(options);
    output(result, {
      json: values.json,
      human: (item) => [
        `codex-flow installation plan: ${item.plan_id}`,
        `project: ${item.project_id}`,
        `AGENTS: ${item.agents.mode} ${item.agents.path ?? "unresolved"}`,
        `AGENTS lines: ${item.agents.before_lines ?? "missing"} -> ${item.agents.after_lines ?? "unresolved"}`,
        `planned changes: ${item.operations.length}`,
        `compatibility conflicts: ${item.conflicts.length}`,
        ...item.conflicts.map((entry) => `conflict: ${entry.message}`),
      ].join("\n"),
    });
    if (!result.applicable) process.exitCode = 1;
    return;
  }
  if (values.check) {
    const result = await checkRepositoryInstallation(options);
    output(result, {
      json: values.json,
      human: (item) => `codex-flow check passed for ${item.project_id} (unchanged)`,
    });
    return;
  }
  const result = await applyInstallationPlan(options, values["apply-plan"]);
  output(result, {
    json: values.json,
    human: (item) => `codex-flow initialization passed for ${item.project_id}${item.changed ? " (updated)" : " (unchanged)"}`,
  });
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
      `AGENTS integration: ${item.agents_contract?.mode ?? item.agents_block}`,
      `task-thread creation: ${item.thread_creation}`,
      `callbacks: ${item.callbacks.pending_count} pending, ${item.callbacks.consumed_count} consumed`,
      `task operations: ${item.task_operations.total_count} total, ${item.task_operations.ambiguous_count} ambiguous`,
      `recipient lineages: ${item.recipients.lineage_count}`,
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
  if (subcommand === "operation") {
    const [action, ...operationArgs] = rest;
    if (action === "prepare") {
      const { values } = parse(boolAndJsonOptions({ file: { type: "string" } }), operationArgs);
      const raw = await readJsonInput(values.file ? resolve(values.file) : null);
      const result = await prepareTaskOperation({
        stateRoot: git.stateRoot,
        projectId: config.project_id,
        packet: applyTaskDefaults(raw, config),
      });
      output(result, {
        json: values.json,
        human: (item) => `Task operation ${item.status}: ${item.operation_id}`,
      });
      if (result.status === "expired") process.exitCode = 74;
      return;
    }
    if (action === "attempt") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        "timeout-seconds": { type: "string", default: "60" },
      }), operationArgs);
      const result = await beginTaskOperationAttempt({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        timeoutSeconds: Number(values["timeout-seconds"]),
      });
      output(result, {
        json: values.json,
        human: (item) => [
          `Task operation ${item.status}: ${item.operation_id ?? item.operation?.operation_id}`,
          `Attempt: ${item.attempt?.attempt_id ?? "already observed"}`,
          item.request ? `Create ${item.request.execution_kind} titled: ${item.request.title}` : null,
          item.request ? `Model/reasoning: ${item.request.model ?? "host default"} / ${item.request.reasoning_effort ?? "host default"}` : null,
        ].filter(Boolean).join("\n"),
      });
      return;
    }
    if (action === "reconcile") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        "attempt-id": { type: "string" },
        outcome: { type: "string" },
        "object-id": { type: "string" },
        "actual-kind": { type: "string" },
        title: { type: "string" },
        visible: { type: "boolean", default: false },
        hidden: { type: "boolean", default: false },
      }), operationArgs);
      if (values.visible && values.hidden) throw new CliError("Choose only one of --visible or --hidden");
      const visibility = values.visible ? true : values.hidden ? false : null;
      const result = await reconcileTaskOperation({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        attemptId: values["attempt-id"],
        outcome: values.outcome,
        objectId: values["object-id"] ?? null,
        actualKind: values["actual-kind"] ?? null,
        title: values.title ?? null,
        visible: visibility,
      });
      output(result, {
        json: values.json,
        human: (item) => `Task operation ${item.status}: ${item.operation_id}`,
      });
      return;
    }
    if (action === "status") {
      const { values } = parse(boolAndJsonOptions({ "operation-id": { type: "string" } }), operationArgs);
      const result = await taskOperationStatus({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"] ?? null,
      });
      output(result, {
        json: values.json,
        human: (items) => items.length
          ? items.map((item) => `${item.operation_id}: ${item.effective_status} (${item.request.execution_kind})`).join("\n")
          : "No task operations.",
      });
      return;
    }
    throw new CliError("task operation requires prepare, attempt, reconcile, or status");
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

async function commandRecipient(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  if (subcommand === "bind") {
    const { values } = parse(boolAndJsonOptions({
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      "fence-token": { type: "string" },
    }), rest);
    const result = await bindRecipient({
      stateRoot: git.stateRoot,
      recipient: {
        lineage_id: values["lineage-id"],
        thread_id: values["thread-id"],
        generation: 1,
      },
      fenceToken: values["fence-token"],
    });
    output(result, {
      json: values.json,
      human: (item) => [
        `Recipient ${item.status}: ${item.recipient.lineage_id} generation ${item.recipient.generation} -> ${item.recipient.thread_id}`,
        item.recipient.fence_token
          ? `Rebind fence token (store privately): ${item.recipient.fence_token}`
          : "Rebind fence token is redacted; retain the token returned by the original bind.",
      ].join("\n"),
    });
    return;
  }
  if (subcommand === "rebind") {
    const { values } = parse(boolAndJsonOptions({
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
      "fence-token": { type: "string" },
      "next-fence-token": { type: "string" },
    }), rest);
    const result = await rebindRecipient({
      stateRoot: git.stateRoot,
      recipient: recipientFromValues(values),
      fenceToken: values["fence-token"],
      nextFenceToken: values["next-fence-token"],
    });
    output(result, {
      json: values.json,
      human: (item) => [
        `Recipient ${item.status}: ${item.recipient.lineage_id} generation ${item.recipient.generation} -> ${item.recipient.thread_id}`,
        `New rebind fence token (store privately): ${item.recipient.fence_token}`,
      ].join("\n"),
    });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions({ "lineage-id": { type: "string" } }), rest);
    const result = values["lineage-id"]
      ? await recipientStatus({ stateRoot: git.stateRoot, lineageId: values["lineage-id"] })
      : await recipientStatuses({ stateRoot: git.stateRoot });
    output(result, {
      json: values.json,
      human: (item) => {
        const entries = Array.isArray(item) ? item : item ? [item] : [];
        return entries.length
          ? entries.map((entry) => `${entry.lineage_id}: generation ${entry.current.generation} -> ${entry.current.thread_id} (${entry.binding_count} binding(s))`).join("\n")
          : "No recipient bindings.";
      },
    });
    return;
  }
  if (subcommand === "resolve") {
    const { values } = parse(boolAndJsonOptions({
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
    }), rest);
    const result = await resolveRecipient({
      stateRoot: git.stateRoot,
      recipient: recipientFromValues(values),
    });
    output(result, {
      json: values.json,
      human: (item) => `Recipient resolves to generation ${item.recipient.generation} -> ${item.recipient.thread_id}${item.stale ? " (input was stale)" : ""}`,
    });
    return;
  }
  throw new CliError("recipient requires bind, rebind, status, or resolve");
}

async function commandCallback(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  if (subcommand === "deliver") {
    const { values } = parse(boolAndJsonOptions({
      file: { type: "string" },
      "no-queue": { type: "boolean", default: false },
    }), rest);
    const config = await loadConfig(git.root);
    const receipt = await readJsonInput(values.file ? resolve(values.file) : null);
    const result = await deliverCallback({
      stateRoot: git.stateRoot,
      receipt,
      authority: config.ordinary_completion_authority,
      noQueue: values["no-queue"],
    });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "observe") {
    const { values } = parse(boolAndJsonOptions({
      "callback-id": { type: "string" },
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
      source: { type: "string" },
    }), rest);
    const result = await observeCallback({
      stateRoot: git.stateRoot,
      callbackId: values["callback-id"],
      recipient: recipientFromValues(values),
      source: values.source,
    });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "consume") {
    const { values } = parse(boolAndJsonOptions({
      "callback-id": { type: "string" },
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
      "executor-id": { type: "string" },
    }), rest);
    const result = await consumeCallback({
      stateRoot: git.stateRoot,
      callbackId: values["callback-id"],
      recipient: recipientFromValues(values),
      executorId: values["executor-id"],
    });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "reconcile") {
    const { values } = parse(boolAndJsonOptions({
      "callback-id": { type: "string" },
      outcome: { type: "string" },
      "submission-id": { type: "string" },
    }), rest);
    const result = await reconcileCallback({
      stateRoot: git.stateRoot,
      callbackId: values["callback-id"],
      outcome: values.outcome,
      submissionId: values["submission-id"] ?? null,
    });
    output(result, { json: values.json, human: (item) => `Terminal callback ${item.status}: ${item.callback_id}` });
    return;
  }
  if (subcommand === "expire") {
    const { values } = parse(boolAndJsonOptions({
      "callback-id": { type: "string" },
      at: { type: "string" },
    }), rest);
    const now = values.at ?? Date.now();
    const result = values["callback-id"]
      ? await expireCallback({ stateRoot: git.stateRoot, callbackId: values["callback-id"], now })
      : await expireCallbacks({ stateRoot: git.stateRoot, now });
    output(result, {
      json: values.json,
      human: (item) => Array.isArray(item)
        ? item.map((entry) => `Terminal callback ${entry.status}: ${entry.callback_id}`).join("\n") || "No terminal callbacks."
        : `Terminal callback ${item.status}: ${item.callback_id}`,
    });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions(), rest);
    const result = await callbackStatus(git.stateRoot);
    output(result, {
      json: values.json,
      human: (item) => [
        `${item.pending.length} pending callback(s); ${item.consumed_count} consumed, ${item.superseded_count} superseded, ${item.expired_count} expired journal record(s).`,
        ...item.pending.map((entry) => `${entry.callback_id} ${entry.effective_integration} ${entry.notification} ${entry.classification} (${entry.executor_id})`),
        ...(item.notification_risk_count > 0
          ? [`${item.notification_risk_count} callback notification(s) may still be live.`]
          : []),
        ...(item.legacy_notification_risk_count > 0
          ? [`${item.legacy_notification_risk_count} legacy callback notification(s) may still surface as stale queue turns.`]
          : []),
      ].join("\n"),
    });
    return;
  }
  throw new CliError("callback requires deliver, observe, consume, reconcile, expire, or status");
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
  if (subcommand !== "audit") throw new CliError("cleanup supports audit only");
  const { values } = parse(boolAndJsonOptions(), rest);
  const result = await cleanupAudit(gitSnapshot());
  output(result, {
    json: values.json,
    human: (item) => [
      `Cleanup audit only; no mutation performed. State size: ${item.state_size}.`,
      `Callbacks: ${item.callbacks.pending.length} pending, ${item.callbacks.consumed_count} consumed, ${item.callbacks.superseded_count} superseded, ${item.callbacks.expired_count} expired.`,
      `Task operations: ${item.task_operations.length}; recipient lineages: ${item.recipients.length}.`,
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
  if (command === "recipient") return commandRecipient(args);
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
