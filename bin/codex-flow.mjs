#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
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
  requireExactFields,
  requireInteger,
  requireText,
  stableStringify,
} from "../lib/core.mjs";
import {
  callbackStatus,
  consumeCallback,
  deliverCallback,
  expireCallback,
  expireCallbacks,
  observeCallback,
} from "../lib/callbacks.mjs";
import { cleanupAudit } from "../lib/cleanup.mjs";
import { cleanupPlanV06 } from "../lib/cleanup-v06.mjs";
import {
  projectConfigPath,
  REASONING_EFFORTS,
  validateProjectConfig,
  writeProjectConfig,
} from "../lib/config.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { discoverGit, gitSnapshot } from "../lib/git.mjs";
import {
  applyGitCleanupPlan,
  authorizeGitBoundTaskRelease,
  bindGitOwnership,
  createGitCleanupPlan,
  GitCleanupApplyError,
  gitLifecycleAudit,
  gitLifecycleReadiness,
  recordGitIntegration,
} from "../lib/git-lifecycle.mjs";
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
import {
  applyTaskDefaults,
  renderHostWorktreeBootstrap,
  renderReleasedTaskPacket,
  renderTaskPacket,
  validateTaskPacket,
} from "../lib/task-packet.mjs";
import {
  authorizeHostWorktreeBootstrap,
  beginTaskOperationAttempt,
  prepareTaskOperation,
  recordTaskOperationHostPreflight,
  rejectTaskOperationBeforeRelease,
  reconcileTaskOperation,
  taskOperationStatus,
} from "../lib/task-operations.mjs";
import {
  consumeUrgentSignal,
  expireUrgentSignal,
  expireUrgentSignals,
  observeUrgentSignal,
  persistUrgentSignal,
  prepareUrgentAttempt,
  reconcileUrgentAttempt,
  urgentSignalRecord,
  urgentSignalStatus,
} from "../lib/urgent-signals.mjs";
import {
  consumeUrgentSignalV06,
  expireUrgentSignalV06,
  observeUrgentSignalV06,
  persistUrgentSignalV06,
  prepareUrgentAttemptV06,
  reconcileUrgentAttemptV06,
  urgentSignalRecordV06,
  urgentSignalStatusV06,
} from "../lib/urgent-signals-v06.mjs";
import {
  applyAdoptionPlan,
  applyAdoptionRetirementPlan,
  planAdoption,
  planAdoptionRetirement,
  readAdoption,
} from "../lib/adoption-v06.mjs";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
  taskArchiveStatus,
} from "../lib/archive-lifecycle.mjs";
import {
  callbackRecordV06,
  callbackStatusV06,
  deliverCallbackV06,
  observeCallbackV06,
} from "../lib/callbacks-v06.mjs";
import {
  cancelTaskBeforeExecution,
  finalizeTaskDisposition,
  prepareTaskDisposition,
  taskDispositionStatus,
} from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
  serialIntegrationStatus,
} from "../lib/integration-v06.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
  taskReleaseStatus,
} from "../lib/release-lifecycle.mjs";
import {
  abandonRun,
  admitRun,
  assertWorkflowReservationCovered,
  buildFencePlan,
  fencePlanConflicts,
  readRun,
  readRunLifecycle,
  rebindRun,
  resumeRun,
  withActiveRunMutation,
} from "../lib/run-lifecycle.mjs";
import {
  acquireRuntimeContext,
  assertNoTrackedLegacyAuthority,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
  validateRuntimeHost,
  validateRuntimeLineage,
} from "../lib/runtime-context.mjs";
import {
  beginSubagentOperationAttempt,
  completeSubagentOperation,
  prepareSubagentOperation,
  reconcileSubagentOperationAttempt,
  recordSubagentCoordinatorDisposition,
  subagentOperationStatus,
} from "../lib/subagent-operations-v06.mjs";
import {
  preflightVisibleTaskBranchReservations,
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
  validateVisibleTaskCreationRecord,
  visibleTaskCreationStatus,
} from "../lib/task-creation-v06.mjs";
import {
  runCombinedVerification,
  verificationStatus,
} from "../lib/verifications-v06.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
  reviseWorkflowJournal,
  workflowJournalStatus,
  workflowTaskContractStatus,
} from "../lib/workflow-journal-v06.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LEGACY_HELP = `codex-flow ${PACKAGE_VERSION} legacy-v05

Read-only historical verification:
  codex-flow init --check
  codex-flow sync --check
  codex-flow config show [--json]
  codex-flow doctor [--json]
  codex-flow task packet validate|render <packet.json> [--model MODEL]
                  [--reasoning-effort EFFORT] [--json]
  codex-flow task operation status [--operation-id ID] [--json]
  codex-flow plan validate <plan.json> [--json]
  codex-flow recipient status [--lineage-id ID] [--json]
  codex-flow recipient resolve --lineage-id ID --thread-id ID --generation N [--json]
  codex-flow callback status [--json]
  codex-flow urgent status [--json]
  codex-flow git status [--json]
  codex-flow lease status [--resource ID] [--json]
  codex-flow cleanup audit [--json]

Mutation through the predecessor CLI is permanently disabled. Historical
verification never creates or changes repository, Git, or Codex Flow state.
`.replaceAll("  codex-flow ", "  codex-flow legacy-v05 ");

const HELP = `codex-flow ${PACKAGE_VERSION}

Usage:
  codex-flow run activate --run-id ID --file request.json [--json]
  codex-flow run status --run-id ID [--json]
  codex-flow run resume|rebind|close|abandon --run-id ID --file request.json [--json]
  codex-flow run audit --run-id ID [--json]
  codex-flow workflow create|revise|contract --run-id ID --file request.json [--json]
  codex-flow workflow status --run-id ID --plan-id ID [--json]
  codex-flow task create prepare|attempt|reconcile --run-id ID --file request.json [--json]
  codex-flow task create status --run-id ID --operation-id ID [--json]
  codex-flow subagent prepare|attempt|reconcile|complete|dispose --run-id ID --file request.json [--json]
  codex-flow subagent status --run-id ID --operation-id ID [--json]
  codex-flow release prepare|reconcile|accept --run-id ID --file request.json [--json]
  codex-flow release status --run-id ID --release-id ID [--json]
  codex-flow callback deliver|observe --run-id ID --file request.json [--json]
  codex-flow callback status --run-id ID [--json]
  codex-flow urgent persist|attempt|reconcile|observe|consume|expire --run-id ID --file request.json [--json]
  codex-flow urgent status --run-id ID [--json]
  codex-flow disposition prepare|finalize|cancel --run-id ID --file request.json [--json]
  codex-flow disposition status --run-id ID --disposition-id ID [--json]
  codex-flow verification run --run-id ID --file request.json [--json]
  codex-flow verification status --run-id ID [--verification-id ID] [--json]
  codex-flow integration prepare|verification-request|reconcile --run-id ID --file request.json [--json]
  codex-flow integration status --run-id ID --integration-id ID [--json]
  codex-flow archive prepare|reconcile --run-id ID --file request.json [--json]
  codex-flow archive status --run-id ID --archive-id ID [--json]
  codex-flow cleanup plan --run-id ID [--json]
  codex-flow adopt plan|apply|retire-plan|retire-apply --run-id ID --file request.json [--json]
  codex-flow adopt status --run-id ID [--json]

Every run-scoped command requires an explicit --run-id. Complex mutations read
one JSON request from --file and reject a mismatched request.run_id before any
state change. Native App calls remain external: the CLI emits one exact host
request when dispatch is permitted, then journals the separately reconciled
outcome.

The predecessor CLI is quarantined under codex-flow legacy-v05 ... for
historical verification only. It is not v0.6 execution authority.
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
  const packagePath = resolve(packageRoot, "package.json");
  const pluginPath = resolve(packageRoot, ".codex-plugin", "plugin.json");
  const agentsTemplate = resolve(packageRoot, "templates", "agents-block.md");
  if (![packagePath, pluginPath, agentsTemplate].every((path) => existsSync(path))) {
    throw new CliError(
      "Run init/sync from the installed codex-orchestration plugin package, not a repository-pinned snapshot",
    );
  }

  let packageMetadata;
  let pluginMetadata;
  try {
    packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
    pluginMetadata = JSON.parse(readFileSync(pluginPath, "utf8"));
  } catch {
    throw new CliError("Installed codex-orchestration package metadata is not valid JSON");
  }
  if (
    packageMetadata.name !== "@wjmao/codex-flow"
    || packageMetadata.private !== true
    || packageMetadata.version !== PACKAGE_VERSION
    || !Array.isArray(packageMetadata.files)
    || !packageMetadata.files.includes("skills/")
    || pluginMetadata.name !== "codex-orchestration"
    || pluginMetadata.version !== PACKAGE_VERSION
    || pluginMetadata.skills !== "./skills/"
  ) {
    throw new CliError(
      `Installed codex-orchestration package metadata must exactly match version ${PACKAGE_VERSION}`,
    );
  }
}

async function loadConfig(gitRoot) {
  const manifestPath = resolve(gitRoot, ".codex", "orchestration", "version.json");
  const manifest = await readJson(manifestPath, { allowMissing: true, guardRoot: gitRoot });
  if (!manifest) {
    throw new CliError("Pinned Codex Flow runtime is missing; run the setup skill from the accepted plugin");
  }
  if (manifest.package_version !== PACKAGE_VERSION) {
    throw new CliError(
      `Installed Codex Flow ${manifest.package_version ?? "unknown"} requires explicit retirement before fresh ${PACKAGE_VERSION} installation`,
    );
  }
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
    "setup-mode": { type: "string" },
    "agents-mode": { type: "string" },
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
    || values["setup-mode"] !== undefined
    || values["agents-mode"] !== undefined
    || values["external-agents-path"] !== undefined
    || values["attest-external-agents"]
  )) throw new CliError("init --check does not accept initialization changes");
  if (values["agents-mode"] !== undefined) {
    requireEnum(values["agents-mode"], ["managed", "external"], "agents_mode");
  }
  if (values["setup-mode"] !== undefined) {
    requireEnum(values["setup-mode"], ["new", "existing"], "setup_mode");
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
    setupMode: values["setup-mode"],
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
      `urgent signals: ${item.urgent_signals.pending_count} pending, ${item.urgent_signals.consumed_count} consumed, ${item.urgent_signals.host_replay_count} host replay(s)`,
      `task operations: ${item.task_operations.total_count} total, ${item.task_operations.ambiguous_count} ambiguous, ${item.task_operations.host_session_blocked_count} session-blocked, ${item.task_operations.partial_evidence_count} partial-evidence, ${item.task_operations.rejected_before_release_count} rejected-before-release`,
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
      "Task creation capability: record a current host-session preflight; this CLI cannot infer it.",
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
      const readiness = await gitLifecycleReadiness({ git, config });
      if (readiness.blocked) throw new CliError(`${readiness.message}; reconcile cleanup before launching another task wave`, 74);
      if (readiness.warning) console.error(`codex-flow: warning: ${readiness.message}`);
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
    if (action === "bootstrap") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        file: { type: "string" },
      }), operationArgs);
      const raw = await readJsonInput(values.file ? resolve(values.file) : null);
      const authorized = await authorizeHostWorktreeBootstrap({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        packet: applyTaskDefaults(raw, config),
      });
      const prompt = renderHostWorktreeBootstrap(authorized.packet, authorized.operation_id);
      if (values.json) output({
        operation_id: authorized.operation_id,
        attempt_id: authorized.attempt_id,
        prompt,
      }, { json: true });
      else console.log(prompt);
      return;
    }
    if (action === "preflight") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        file: { type: "string" },
      }), operationArgs);
      const evidence = await readJsonInput(values.file ? resolve(values.file) : null);
      const result = await recordTaskOperationHostPreflight({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        evidence,
      });
      output(result, {
        json: values.json,
        human: (item) => {
          const active = item.host_preflights.find(
            (entry) => entry.preflight_id === item.active_host_preflight_id,
          );
          return [
            `Task operation ${item.status}: ${item.operation_id}`,
            `Host preflight: ${item.active_host_preflight_id}`,
            `Host session: ${active?.host_session_id ?? "none"}`,
          ].join("\n");
        },
      });
      if (result.status === "host-incompatible") process.exitCode = 74;
      return;
    }
    if (action === "reconcile") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        "attempt-id": { type: "string" },
        outcome: { type: "string" },
        "object-id": { type: "string" },
        "actual-kind": { type: "string" },
        evidence: { type: "string" },
        "reason-code": { type: "string" },
      }), operationArgs);
      const evidence = values.evidence ? await readJson(resolve(values.evidence)) : null;
      const result = await reconcileTaskOperation({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        attemptId: values["attempt-id"],
        outcome: values.outcome,
        objectId: values["object-id"] ?? null,
        actualKind: values["actual-kind"] ?? null,
        evidence,
        reasonCode: values["reason-code"] ?? null,
      });
      output(result, {
        json: values.json,
        human: (item) => [
          `Task operation ${item.status}: ${item.operation_id}`,
          item.observation_policy?.state === "rejected"
            ? `Host observation policy rejected: ${item.observation_policy.reason_code}`
            : null,
        ].filter(Boolean).join("\n"),
      });
      if (result.observation_policy?.state === "rejected") process.exitCode = 74;
      return;
    }
    if (action === "reject") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        "reason-code": { type: "string" },
        "host-object-state": { type: "string" },
      }), operationArgs);
      const result = await rejectTaskOperationBeforeRelease({
        stateRoot: git.stateRoot,
        operationId: values["operation-id"],
        reasonCode: values["reason-code"],
        hostObjectState: values["host-object-state"],
      });
      output(result, {
        json: values.json,
        human: (item) => `Task operation ${item.status}: ${item.operation_id}`,
      });
      return;
    }
    if (action === "release") {
      const { values } = parse(boolAndJsonOptions({
        "operation-id": { type: "string" },
        file: { type: "string" },
      }), operationArgs);
      const raw = await readJsonInput(values.file ? resolve(values.file) : null);
      const packet = applyTaskDefaults(raw, config);
      const authorization = await authorizeGitBoundTaskRelease({
        git,
        operationId: values["operation-id"],
        packet,
      });
      const prompt = renderReleasedTaskPacket(packet);
      if (values.json) output({ ...authorization, prompt }, { json: true });
      else console.log(prompt);
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
          ? items.map((item) => [
            `${item.operation_id}: ${item.effective_status} (${item.request.execution_kind})`,
            `placement ${item.request.host_placement.mode}${item.request.host_placement.target_project_id ? ` -> ${item.request.host_placement.target_project_id}` : ""}`,
            item.observation_policy ? `observation policy ${item.observation_policy.state}${item.observation_policy.reason_code ? `: ${item.observation_policy.reason_code}` : ""}` : null,
            item.resolution ? `resolution ${item.resolution.disposition}` : null,
          ].filter(Boolean).join("; ")).join("\n")
          : "No task operations.",
      });
      return;
    }
    throw new CliError("task operation requires prepare, preflight, attempt, bootstrap, reconcile, reject, release, or status");
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
  await loadConfig(git.root);
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
  await loadConfig(git.root);
  if (subcommand === "deliver") {
    const { values } = parse(boolAndJsonOptions({ file: { type: "string" } }), rest);
    const receipt = await readJsonInput(values.file ? resolve(values.file) : null);
    const result = await deliverCallback({
      stateRoot: git.stateRoot,
      receipt,
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
    }), rest);
    const result = await observeCallback({
      stateRoot: git.stateRoot,
      callbackId: values["callback-id"],
      recipient: recipientFromValues(values),
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
        ...item.pending.map((entry) => `${entry.callback_id} ${entry.effective_integration} ${entry.classification} (${entry.executor_id})`),
      ].join("\n"),
    });
    return;
  }
  throw new CliError("callback requires deliver, observe, consume, expire, or status");
}

async function commandUrgent(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  await loadConfig(git.root);
  if (subcommand === "persist") {
    const { values } = parse(boolAndJsonOptions({ file: { type: "string" } }), rest);
    const signal = await readJsonInput(values.file ? resolve(values.file) : null);
    const result = await persistUrgentSignal({ stateRoot: git.stateRoot, signal });
    output(result, {
      json: values.json,
      human: (item) => `Urgent signal ${item.status}: ${item.urgent_id}`,
    });
    return;
  }
  if (subcommand === "attempt") {
    const [action, ...actionArgs] = rest;
    if (action === "prepare") {
      const { values } = parse(boolAndJsonOptions({
        "urgent-id": { type: "string" },
        "attempt-sequence": { type: "string" },
        "retry-reason": { type: "string" },
      }), actionArgs);
      const result = await prepareUrgentAttempt({
        stateRoot: git.stateRoot,
        urgentId: values["urgent-id"],
        attemptSequence: Number(values["attempt-sequence"]),
        retryReason: values["retry-reason"] ?? null,
      });
      output(result, {
        json: values.json,
        human: (item) => [
          `Urgent delivery attempt ${item.status}: ${item.delivery_attempt_id}`,
          `Dispatch permitted: ${item.dispatch_permitted ? "yes" : "no"}`,
          `Host prompt: ${item.host_prompt}`,
        ].join("\n"),
      });
      return;
    }
    if (action === "reconcile") {
      const { values } = parse(boolAndJsonOptions({
        "urgent-id": { type: "string" },
        "delivery-attempt-id": { type: "string" },
        "host-call-result": { type: "string" },
      }), actionArgs);
      const result = await reconcileUrgentAttempt({
        stateRoot: git.stateRoot,
        urgentId: values["urgent-id"],
        deliveryAttemptId: values["delivery-attempt-id"],
        hostCallResult: values["host-call-result"],
      });
      output(result, {
        json: values.json,
        human: (item) => `Urgent delivery attempt ${item.status}: ${item.delivery_attempt_id}`,
      });
      return;
    }
    throw new CliError("urgent attempt requires prepare or reconcile");
  }
  if (subcommand === "observe") {
    const { values } = parse(boolAndJsonOptions({
      "urgent-id": { type: "string" },
      "delivery-attempt-id": { type: "string" },
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
    }), rest);
    const result = await observeUrgentSignal({
      stateRoot: git.stateRoot,
      urgentId: values["urgent-id"],
      deliveryAttemptId: values["delivery-attempt-id"],
      recipient: recipientFromValues(values),
    });
    output(result, {
      json: values.json,
      human: (item) => [
        `Urgent signal ${item.status}: ${item.urgent_id} (${item.disposition})`,
        ...(item.consume_arguments ? [
          `Next: codex-flow urgent consume --urgent-id ${item.consume_arguments.urgent_id} --lineage-id ${item.consume_arguments.lineage_id} --thread-id ${item.consume_arguments.thread_id} --generation ${item.consume_arguments.generation} --sender-executor-id ${item.consume_arguments.sender_executor_id}`,
        ] : []),
      ].join("\n"),
    });
    return;
  }
  if (subcommand === "consume") {
    const { values } = parse(boolAndJsonOptions({
      "urgent-id": { type: "string" },
      "lineage-id": { type: "string" },
      "thread-id": { type: "string" },
      generation: { type: "string" },
      "sender-executor-id": { type: "string" },
    }), rest);
    const result = await consumeUrgentSignal({
      stateRoot: git.stateRoot,
      urgentId: values["urgent-id"],
      recipient: recipientFromValues(values),
      senderExecutorId: values["sender-executor-id"],
    });
    output(result, {
      json: values.json,
      human: (item) => `Urgent signal ${item.status}: ${item.urgent_id}`,
    });
    return;
  }
  if (subcommand === "expire") {
    const { values } = parse(boolAndJsonOptions({
      "urgent-id": { type: "string" },
      at: { type: "string" },
    }), rest);
    const now = values.at ?? Date.now();
    const result = values["urgent-id"]
      ? await expireUrgentSignal({ stateRoot: git.stateRoot, urgentId: values["urgent-id"], now })
      : await expireUrgentSignals({ stateRoot: git.stateRoot, now });
    output(result, {
      json: values.json,
      human: (item) => Array.isArray(item)
        ? item.map((entry) => `Urgent signal ${entry.status}: ${entry.urgent_id}`).join("\n") || "No urgent signals."
        : `Urgent signal ${item.status}: ${item.urgent_id}`,
    });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions(), rest);
    const result = await urgentSignalStatus(git.stateRoot);
    output(result, {
      json: values.json,
      human: (item) => [
        `${item.pending.length} pending urgent signal(s); ${item.consumed_count} consumed, ${item.superseded_count} superseded, ${item.expired_count} expired.`,
        `Observed duplicates: ${item.host_replay_count} host replay(s), ${item.sender_attempt_duplicate_count} additional sender attempt(s).`,
        ...item.pending.map((entry) => `${entry.urgent_id} ${entry.effective_state} ${entry.classification} (${entry.executor_id})`),
      ].join("\n"),
    });
    return;
  }
  throw new CliError("urgent requires persist, attempt, observe, consume, expire, or status");
}

async function commandLease(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  await loadConfig(git.root);
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

async function commandGit(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  const config = await loadConfig(git.root);
  if (subcommand === "bind") {
    const { values } = parse(boolAndJsonOptions({
      "operation-id": { type: "string" },
    }), rest);
    const result = await bindGitOwnership({
      git,
      operationId: values["operation-id"],
    });
    output(result, { json: values.json, human: (item) => `Git ownership bound: ${item.branch} -> ${item.operation_id}` });
    return;
  }
  if (subcommand === "integrate") {
    const { values } = parse(boolAndJsonOptions({
      "operation-id": { type: "string" },
      "main-branch": { type: "string" },
      "superseded-by": { type: "string" },
    }), rest);
    const result = await recordGitIntegration({
      git,
      operationId: values["operation-id"],
      mainBranch: values["main-branch"],
      supersededBy: values["superseded-by"] ?? null,
    });
    output(result, { json: values.json, human: (item) => `Git integration ${item.disposition}: ${item.operation_id}` });
    return;
  }
  if (subcommand === "status") {
    const { values } = parse(boolAndJsonOptions(), rest);
    const result = await gitLifecycleAudit({ git, config });
    output(result, {
      json: values.json,
      human: (item) => [
        `${item.items.length} owned Git task(s); ${item.eligible_count} cleanup-eligible; ${item.backlog_count} require reconciliation.`,
        ...item.items.map((entry) => `${entry.operation_id} ${entry.classification} ${entry.branch}`),
      ].join("\n"),
    });
    return;
  }
  throw new CliError("git requires bind, integrate, or status");
}

async function commandCleanup(args) {
  const [subcommand, ...rest] = args;
  const git = discoverGit();
  const config = await loadConfig(git.root);
  if (subcommand === "audit") {
    const { values } = parse(boolAndJsonOptions(), rest);
    const result = await cleanupAudit(git);
    output(result, {
      json: values.json,
      human: (item) => [
        `Cleanup audit only; no mutation performed. State size: ${item.state_size}.`,
        `Callbacks: ${item.callbacks.pending.length} pending, ${item.callbacks.consumed_count} consumed, ${item.callbacks.superseded_count} superseded, ${item.callbacks.expired_count} expired.`,
        `Task operations: ${item.task_operations.length}; recipient lineages: ${item.recipients.length}.`,
        `Git tasks: ${item.git_lifecycle.items.length}; ${item.git_lifecycle.eligible_count} cleanup-eligible; ${item.git_lifecycle.backlog_count} require reconciliation.`,
        `Leases: ${item.leases.filter((lease) => lease.state === "active").length} active, ${item.leases.filter((lease) => lease.state === "expired").length} expired.`,
        ...item.recommendations.map((recommendation) => `review: ${recommendation}`),
      ].join("\n"),
    });
    return;
  }
  if (["plan", "apply"].includes(subcommand)) {
    const { values } = parse(boolAndJsonOptions({
      "operation-id": { type: "string", multiple: true },
      "main-branch": { type: "string" },
      "include-remote": { type: "boolean", default: false },
      "plan-id": { type: "string" },
    }), rest);
    const common = {
      git,
      config,
      operationIds: values["operation-id"] ?? [],
      mainBranch: values["main-branch"],
      includeRemote: values["include-remote"],
    };
    let result;
    try {
      result = subcommand === "plan"
        ? await createGitCleanupPlan(common)
        : await applyGitCleanupPlan({ ...common, expectedPlanId: values["plan-id"] });
    } catch (error) {
      if (!(error instanceof GitCleanupApplyError)) throw error;
      output(error.result, {
        json: values.json,
        human: (item) => [
          `Git cleanup ${item.status}: ${item.plan_id}`,
          ...item.completed_actions.map((action) => `  completed: ${action}`),
          `  stopped at: ${item.failed_action}`,
          `  error: ${item.error}`,
          "Run cleanup audit and create a fresh plan; do not retry this plan.",
        ].join("\n"),
      });
      process.exitCode = error.exitCode;
      return;
    }
    output(result, {
      json: values.json,
      human: (item) => subcommand === "plan"
        ? [
          `Git cleanup plan ${item.plan_id}: ${item.candidates.length} task(s)`,
          ...item.candidates.flatMap((candidate) => [
            `${candidate.operation_id} ${candidate.disposition}`,
            ...(candidate.remove_worktree ? [`  remove worktree: ${candidate.worktree_path}`] : []),
            ...(candidate.delete_local ? [`  delete local branch: ${candidate.branch}`] : []),
            ...(candidate.remote ? [`  delete remote branch: ${candidate.remote.remote}/${candidate.remote.ref}`] : []),
          ]),
        ].join("\n")
        : [
          `Git cleanup ${item.status}: ${item.plan.plan_id}`,
          ...item.completed_actions.map((action) => `  completed: ${action}`),
        ].join("\n"),
    });
    return;
  }
  throw new CliError("cleanup requires audit, plan, or apply");
}

function v06Output(value) {
  console.log(stableStringify(value, 2));
}

function parseV06Options(args, extra = {}) {
  return parse({
    "run-id": { type: "string" },
    file: { type: "string" },
    json: { type: "boolean", default: false },
    ...extra,
  }, args, false).values;
}

function explicitRunId(values) {
  return requireText(values["run-id"], "--run-id", { max: 128, safeId: true });
}

async function runScopedRequest(values, label, { required, optional = [] }) {
  const runId = explicitRunId(values);
  if (!values.file) throw new CliError(`${label} requires --file <request.json>`);
  const request = await readJsonInput(values.file);
  requireExactFields(request, { required: ["run_id", ...required], optional }, `${label} request`);
  if (request.run_id !== runId) {
    throw new CliError(`${label} request.run_id does not match --run-id`, 73);
  }
  return { runId, request };
}

function commandNow(request, field = "recorded_at") {
  if (!Object.hasOwn(request, field)) return Date.now();
  const value = requireText(request[field], field, { max: 64 });
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new CliError(`${field} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return milliseconds;
}

function v06Repository() {
  return discoverGit(process.cwd());
}

function assertRunIdentity(value, runId, label) {
  if (value?.run_id !== runId) throw new CliError(`${label} does not belong to --run-id`, 73);
  return value;
}

async function visibleTaskAuthority(git, operationId, runId) {
  const id = requireText(operationId, "operation_id", { max: 128, safeId: true });
  const record = validateVisibleTaskCreationRecord(await readJson(
    resolve(git.stateRoot, "visible-task-creations", "records", `${id}.json`),
    { guardRoot: git.commonDir },
  ));
  return assertRunIdentity(record, runId, "visible-task creation");
}

async function releaseAuthority(git, releaseId, runId) {
  const record = await taskReleaseStatus({ stateRoot: git.stateRoot, releaseId });
  return assertRunIdentity(record, runId, "task release");
}

async function subagentAuthority(git, operationId, runId) {
  const record = await subagentOperationStatus({ stateRoot: git.stateRoot, operationId });
  return assertRunIdentity(record, runId, "subagent operation");
}

async function callbackAuthority(git, callbackId, runId) {
  const record = await callbackRecordV06({ stateRoot: git.stateRoot, callbackId });
  assertRunIdentity(record.receipt, runId, "terminal callback");
  return record;
}

async function urgentAuthority(git, urgentId, runId) {
  const record = await urgentSignalRecordV06({ stateRoot: git.stateRoot, urgentId });
  assertRunIdentity(record.signal, runId, "urgent signal");
  return record;
}

async function dispositionAuthority(git, dispositionId, runId) {
  const record = await taskDispositionStatus({ stateRoot: git.stateRoot, dispositionId });
  return assertRunIdentity(record, runId, "task disposition");
}

async function integrationAuthority(git, integrationId, runId) {
  const record = await serialIntegrationStatus({ stateRoot: git.stateRoot, integrationId });
  return assertRunIdentity(record, runId, "serial integration");
}

async function archiveAuthority(git, archiveId, runId) {
  const record = await taskArchiveStatus({ stateRoot: git.stateRoot, archiveId });
  return assertRunIdentity(record, runId, "task archive");
}

async function activeRunAuthority(git, runId, planId = null) {
  const { run } = await readRun({ gitCommonDirectory: git.commonDir, runId });
  if (run.status !== "active") throw new CliError(`v0.6 run is not active: ${runId}`, 73);
  if (planId !== null && run.workflow_plan_id !== planId) {
    throw new CliError("workflow plan_id does not match the active run", 73);
  }
  const { context: runtime } = await readRuntimeContext({
    gitCommonDirectory: git.commonDir,
    runtimeId: run.runtime_id,
  });
  const binding = runtimeBindingFromContext(runtime);
  if (
    runtimeContextHash(runtime) !== run.runtime_context_hash
    || binding.runtime_context_hash !== run.binding.runtime_context_hash
    || binding.bundle_hash !== run.binding.bundle_hash
    || binding.config_hash !== run.binding.config_hash
    || binding.policy_hash !== run.binding.policy_hash
    || binding.repository_hash !== run.binding.repository_hash
    || runtime.repository.common_dir !== git.commonDir
    || runtime.repository.root !== git.root
  ) throw new CliError("active run/runtime/repository authority is inconsistent", 73);
  return { run, runtime, binding };
}

async function guardedActiveRunMutation(git, runId, operation) {
  return withActiveRunMutation({
    gitCommonDirectory: git.commonDir,
    runId,
  }, async (locked) => {
    const authority = await activeRunAuthority(git, runId);
    if (stableStringify(authority.run) !== stableStringify(locked.run)) {
      throw new CliError("active run changed while acquiring mutation authority", 75);
    }
    return operation({ ...locked, ...authority });
  });
}

function canonicalCoordinatorBinding(lineage) {
  const binding = {
    lineage_id: lineage.lineage_id,
    thread_id: lineage.thread_id,
    generation: lineage.generation,
  };
  return { ...binding, binding_digest: coordinatorBindingDigest(binding) };
}

function recipientMatchesLineage(status, lineage) {
  return status !== null
    && status.lineage_id === lineage.lineage_id
    && status.current.thread_id === lineage.thread_id
    && status.current.generation === lineage.generation;
}

async function bindRunCoordinatorRecipient({ git, run, lineage }) {
  const recipient = await bindRecipient({
    stateRoot: git.stateRoot,
    recipient: lineage,
    fenceToken: run.binding.fence_token,
  });
  return recipient.recipient;
}

async function rebindRunCoordinatorRecipient({ git, runId, resume, next, reboundAt }) {
  requireExactFields(next, { required: ["host", "lineage"] }, "next binding");
  const nextHost = validateRuntimeHost(next.host, "next binding.host");
  const nextLineage = validateRuntimeLineage(next.lineage, "next binding.lineage");
  requireText(nextLineage.thread_id, "next binding.lineage.thread_id", {
    max: 128,
    safeId: true,
  });
  const { run: current, path } = await readRun({
    gitCommonDirectory: git.commonDir,
    runId,
  });
  if (current.status !== "active") throw new CliError(`v0.6 run is not active: ${runId}`, 73);
  const latest = current.rebind_history.at(-1) ?? null;
  const resumeIsCurrent = stableStringify(current.binding) === stableStringify(resume);
  const exactReplay = !resumeIsCurrent
    && latest !== null
    && stableStringify(latest.from) === stableStringify(resume)
    && stableStringify(latest.to.host) === stableStringify(nextHost)
    && stableStringify(latest.to.lineage) === stableStringify(nextLineage);
  if (!resumeIsCurrent && !exactReplay) {
    throw new CliError("resume fence does not match the active run binding", 73);
  }
  if (
    nextLineage.lineage_id !== resume.lineage?.lineage_id
    || nextLineage.generation !== resume.lineage?.generation + 1
    || nextLineage.thread_id === resume.lineage?.thread_id
  ) {
    throw new CliError(
      "run rebind must advance the authoritative coordinator recipient by one generation",
      73,
    );
  }
  const recipient = await recipientStatus({
    stateRoot: git.stateRoot,
    lineageId: nextLineage.lineage_id,
  });
  const recipientIsCurrent = recipientMatchesLineage(recipient, resume.lineage);
  const recipientIsRebound = recipientMatchesLineage(recipient, nextLineage);
  if (!(recipientIsCurrent || (exactReplay && recipientIsRebound))) {
    throw new CliError("run rebind does not match the authoritative coordinator recipient", 73);
  }
  const result = exactReplay
    ? { run: current, path, resume: current.binding }
    : await rebindRun({
      gitCommonDirectory: git.commonDir,
      runId,
      resume,
      next: { host: nextHost, lineage: nextLineage },
      reboundAt,
    });
  const reboundRecipient = await rebindRecipient({
    stateRoot: git.stateRoot,
    recipient: nextLineage,
    fenceToken: resume.fence_token,
    nextFenceToken: result.run.binding.fence_token,
  });
  return { ...result, coordinator_recipient: reboundRecipient.recipient };
}

function activationFences(value) {
  requireExactFields(value, {
    required: ["path_fences", "resource_fences", "branch_fences"],
  }, "run activation request.fences");
  return buildFencePlan({
    pathFences: value.path_fences,
    resourceFences: value.resource_fences,
    branchFences: value.branch_fences,
  });
}

async function commandRunV06(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "activate") {
    const values = parseV06Options(rest);
    const { runId, request } = await runScopedRequest(values, "run activate", {
      required: ["activated_at", "runtime", "workflow", "fences"],
    });
    requireExactFields(request.runtime, {
      required: ["config", "policy", "host", "lineage"],
    }, "run activation request.runtime");
    const activatedAt = requireText(request.activated_at, "activated_at", { max: 64 });
    commandNow({ activated_at: activatedAt }, "activated_at");
    requireCanonicalSource();
    const git = gitSnapshot(process.cwd());
    if (git.cleanliness !== "clean") {
      throw new CliError("run activate requires a clean authenticated Git worktree", 73);
    }
    await assertNoTrackedLegacyAuthority(git.root);
    const workflow = createWorkflowPlanRevision(request.workflow);
    const fences = activationFences(request.fences);
    assertWorkflowReservationCovered(fences, workflow);
    await preflightVisibleTaskBranchReservations({
      stateRoot: git.stateRoot,
      runId,
      branchFences: fences.branch_fences,
    });
    const bundleSource = await loadRuntimeBundleSource({ packageRoot });
    const runtime = buildRuntimeContext({
      bundle: bundleSource.bundle,
      createdAt: activatedAt,
      config: request.runtime.config,
      policy: request.runtime.policy,
      repository: {
        common_dir: git.commonDir,
        root: git.root,
        branch: git.branch,
        revision: git.revision,
      },
      host: request.runtime.host,
      lineage: request.runtime.lineage,
    });
    const lifecycle = await readRunLifecycle({ gitCommonDirectory: git.commonDir });
    const active = lifecycle.state.active_run_id === null
      ? null
      : lifecycle.state.runs[lifecycle.state.active_run_id];
    const existing = lifecycle.state.runs[runId] ?? null;
    if (active !== null && active.run_id !== runId) {
      throw new CliError(`A different v0.6 run is already active: ${active.run_id}`, 75);
    }
    if (existing !== null && (
      existing.status !== "active"
      || existing.runtime_id !== runtime.runtime_id
      || existing.workflow_plan_id !== workflow.plan_id
      || existing.workflow_revision_digest !== workflow.revision_digest
      || stableStringify(existing.plan) !== stableStringify(fences)
    )) {
      throw new CliError(`v0.6 run activation does not match its immutable authority: ${runId}`, 73);
    }
    if (runtime.lineage.generation !== 1) {
      throw new CliError("fresh run activation coordinator lineage must start at generation 1", 73);
    }
    requireText(runtime.lineage.thread_id, "run activation coordinator thread_id", {
      max: 128,
      safeId: true,
    });
    const currentRecipient = await recipientStatus({
      stateRoot: git.stateRoot,
      lineageId: runtime.lineage.lineage_id,
    });
    if (existing === null && currentRecipient !== null) {
      throw new CliError(
        `Fresh run coordinator lineage is already bound: ${runtime.lineage.lineage_id}`,
        73,
      );
    }
    if (currentRecipient !== null && !recipientMatchesLineage(currentRecipient, runtime.lineage)) {
      throw new CliError("run activation does not match the authoritative coordinator recipient", 73);
    }
    for (const retained of Object.values(lifecycle.state.runs).filter((item) => item.status === "abandoned")) {
      if (fencePlanConflicts(retained.terminal.unresolved_fences, fences).length > 0) {
        throw new CliError(`Run plan conflicts with retained fences from ${retained.run_id}`, 75);
      }
    }
    const acquired = await acquireRuntimeContext({
      gitCommonDirectory: git.commonDir,
      context: runtime,
      bundleSource,
    });
    const journal = await createWorkflowJournal({
      stateRoot: git.stateRoot,
      runId,
      planId: workflow.plan_id,
      planRevision: workflow,
      now: Date.parse(activatedAt),
    });
    const admitted = await admitRun({
      gitCommonDirectory: git.commonDir,
      runId,
      runtimeId: runtime.runtime_id,
      workflowPlanId: workflow.plan_id,
      workflowRevisionDigest: workflow.revision_digest,
      plan: fences,
      admittedAt: activatedAt,
    });
    const coordinatorRecipient = await bindRunCoordinatorRecipient({
      git,
      run: admitted.run,
      lineage: runtime.lineage,
    });
    const binding = runtimeBindingFromContext(runtime);
    const coordinatorBinding = canonicalCoordinatorBinding(runtime.lineage);
    v06Output({
      status: admitted.status,
      package_authority: {
        package: "@wjmao/codex-flow",
        package_version: PACKAGE_VERSION,
        source_root: packageRoot,
        bundle_sha256: runtime.bundle.bundle_sha256,
      },
      state_authority: {
        namespace: "v0.6.0",
        state_root: git.stateRoot,
        git_common_dir: git.commonDir,
      },
      repository_authority: {
        repository_id: binding.repository_hash,
        root: git.root,
        branch: git.branch,
        revision: git.revision,
        cleanliness: git.cleanliness,
      },
      runtime_authority: {
        runtime_id: runtime.runtime_id,
        runtime_context_digest: runtimeContextHash(runtime),
        configuration_digest: binding.config_hash,
        policy_digest: binding.policy_hash,
        bundle_root: acquired.bundle_root,
        acquisition_status: acquired.status,
        host: runtime.host,
        coordinator_binding: coordinatorBinding,
        coordinator_recipient: coordinatorRecipient,
      },
      workflow_authority: {
        run_id: runId,
        plan_id: workflow.plan_id,
        revision_digest: workflow.revision_digest,
        journal_digest: journal.journal.journal_digest,
        fences,
      },
      model_routing: workflow.tasks.map((task) => ({
        task_id: task.task_id,
        execution_kind: task.execution_kind,
        model: task.model,
        reasoning_effort: task.reasoning_effort,
        fork_turns: task.fork_turns,
        evidence: "configured",
      })),
      host_call_performed: false,
      run: admitted.run,
    });
    return;
  }

  if (subcommand === "status") {
    const values = parseV06Options(rest);
    const runId = explicitRunId(values);
    const git = v06Repository();
    const result = await readRun({ gitCommonDirectory: git.commonDir, runId });
    const runtime = await readRuntimeContext({
      gitCommonDirectory: git.commonDir,
      runtimeId: result.run.runtime_id,
    });
    const workflow = await workflowJournalStatus({
      stateRoot: git.stateRoot,
      runId,
      planId: result.run.workflow_plan_id,
    });
    v06Output({ ...result, runtime: runtime.context, workflow });
    return;
  }

  if (subcommand === "audit") {
    const values = parseV06Options(rest);
    const runId = explicitRunId(values);
    const git = v06Repository();
    const { auditRunClosure } = await import("../lib/run-audit-v06.mjs");
    v06Output(await auditRunClosure({ stateRoot: git.stateRoot, runId }));
    return;
  }

  if (["resume", "rebind", "close", "abandon"].includes(subcommand)) {
    const values = parseV06Options(rest);
    const shapes = {
      resume: { required: ["resume"] },
      rebind: { required: ["resume", "next"], optional: ["rebound_at"] },
      close: { required: ["resume", "audit_id"], optional: ["closed_at"] },
      abandon: {
        required: ["resume", "reason"],
        optional: ["abandoned_at"],
      },
    };
    const { runId, request } = await runScopedRequest(values, `run ${subcommand}`, shapes[subcommand]);
    const git = v06Repository();
    let result;
    if (subcommand === "resume") {
      result = await resumeRun({ gitCommonDirectory: git.commonDir, runId, resume: request.resume });
    } else if (subcommand === "rebind") {
      result = await guardedActiveRunMutation(git, runId, () => (
        rebindRunCoordinatorRecipient({
          git,
          runId,
          resume: request.resume,
          next: request.next,
          reboundAt: request.rebound_at ?? new Date().toISOString(),
        })
      ));
    } else if (subcommand === "abandon") {
      result = await guardedActiveRunMutation(git, runId, () => abandonRun({
        gitCommonDirectory: git.commonDir,
        runId,
        resume: request.resume,
        reason: request.reason,
        abandonedAt: request.abandoned_at ?? new Date().toISOString(),
      }));
    } else {
      const { closeRunFromAudit } = await import("../lib/run-audit-v06.mjs");
      result = await closeRunFromAudit({
        gitCommonDirectory: git.commonDir,
        stateRoot: git.stateRoot,
        runId,
        auditId: request.audit_id,
        resume: request.resume,
        closedAt: request.closed_at ?? new Date().toISOString(),
      });
    }
    v06Output(result);
    return;
  }
  throw new CliError("run requires activate, status, resume, rebind, audit, close, or abandon");
}

async function commandWorkflowV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "plan-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const planId = requireText(values["plan-id"], "--plan-id", { max: 128, safeId: true });
    const { run } = await readRun({ gitCommonDirectory: git.commonDir, runId });
    if (run.workflow_plan_id !== planId) {
      throw new CliError("workflow plan_id does not match --run-id", 73);
    }
    v06Output(await workflowJournalStatus({ stateRoot: git.stateRoot, runId, planId }));
    return;
  }
  const shapes = {
    create: { required: ["plan_id", "plan_revision"], optional: ["created_at"] },
    revise: { required: ["plan_id", "draft"], optional: ["revised_at"] },
    contract: {
      required: ["plan_id", "task_id", "dependency_authorities"],
      optional: ["created_at"],
    },
  };
  if (!shapes[subcommand]) throw new CliError("workflow requires create, revise, status, or contract");
  const { runId, request } = await runScopedRequest(values, `workflow ${subcommand}`, shapes[subcommand]);
  await activeRunAuthority(git, runId, request.plan_id);
  let result;
  if (subcommand === "create") {
    result = await createWorkflowJournal({
      stateRoot: git.stateRoot,
      runId,
      planId: request.plan_id,
      planRevision: request.plan_revision,
      now: commandNow(request, "created_at"),
    });
  } else if (subcommand === "revise") {
    result = await reviseWorkflowJournal({
      stateRoot: git.stateRoot,
      runId,
      planId: request.plan_id,
      draft: request.draft,
      now: commandNow(request, "revised_at"),
    });
  } else {
    const snapshot = gitSnapshot(git.root);
    if (snapshot.commonDir !== git.commonDir || snapshot.cleanliness !== "clean") {
      throw new CliError("workflow contract requires the active repository to be clean", 73);
    }
    result = await persistWorkflowTaskContract({
      stateRoot: git.stateRoot,
      runId,
      planId: request.plan_id,
      taskId: request.task_id,
      currentBaseline: { revision: snapshot.revision },
      dependencyAuthorities: request.dependency_authorities,
      now: commandNow(request, "created_at"),
    });
  }
  v06Output(result);
}

function taskAttemptView(result) {
  const base = {
    run_id: result.run_id,
    operation_id: result.operation_id,
    attempt_id: result.attempt?.attempt_id ?? null,
    reconcile_by: result.attempt?.reconcile_by ?? null,
    dispatch_permitted: result.dispatch_permitted === true,
  };
  return result.dispatch_permitted === true
    ? { ...base, host_request: result.host_request }
    : base;
}

async function commandTaskCreateV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "operation-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const operationId = requireText(values["operation-id"], "--operation-id", {
      max: 128,
      safeId: true,
    });
    await visibleTaskAuthority(git, operationId, runId);
    const result = await visibleTaskCreationStatus({ stateRoot: git.stateRoot, operationId });
    v06Output(assertRunIdentity(result, runId, "visible-task creation"));
    return;
  }
  const shapes = {
    prepare: { required: ["task_contract", "requested_selectors"], optional: ["prepared_at"] },
    attempt: {
      required: ["operation_id", "host_session_id"],
      optional: ["timeout_seconds", "attempted_at"],
    },
    reconcile: {
      required: ["operation_id", "outcome"],
      optional: [
        "provisional_client_thread_id", "ready_thread_id", "initial_turn",
        "selector_evidence", "reason_code", "reconciled_at",
      ],
    },
  };
  if (!shapes[subcommand]) throw new CliError("task create requires prepare, attempt, reconcile, or status");
  const { runId, request } = await runScopedRequest(values, `task create ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
    if (request.task_contract.run_id !== runId) {
      throw new CliError("task contract run_id does not match --run-id", 73);
    }
    result = await prepareVisibleTaskCreation({
      stateRoot: git.stateRoot,
      taskContract: request.task_contract,
      requestedSelectors: request.requested_selectors,
      now: commandNow(request, "prepared_at"),
    });
  } else if (subcommand === "attempt") {
    await visibleTaskAuthority(git, request.operation_id, runId);
    result = await recordVisibleTaskCreationAttempt({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      hostSessionId: request.host_session_id,
      timeoutSeconds: request.timeout_seconds ?? 300,
      now: commandNow(request, "attempted_at"),
    });
  } else {
    await visibleTaskAuthority(git, request.operation_id, runId);
    result = await reconcileVisibleTaskCreation({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id ?? null,
      readyThreadId: request.ready_thread_id ?? null,
      initialTurn: request.initial_turn ?? null,
      selectorEvidence: request.selector_evidence ?? null,
      reasonCode: request.reason_code ?? null,
      now: commandNow(request, "reconciled_at"),
    });
  }
  assertRunIdentity(result, runId, "visible-task creation");
  v06Output(subcommand === "attempt" ? taskAttemptView(result) : result);
}

async function commandTaskV06(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "create") {
    throw new CliError("v0.5 task packet/operation commands are not v0.6 authority; use workflow and task create");
  }
  return commandTaskCreateV06(rest);
}

async function commandSubagentV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "operation-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const operationId = requireText(values["operation-id"], "--operation-id", { max: 128, safeId: true });
    const result = await subagentAuthority(git, operationId, runId);
    v06Output(assertRunIdentity(result, runId, "subagent operation"));
    return;
  }
  const shapes = {
    prepare: {
      required: [
        "task_contract", "model", "reasoning_effort", "fork_turns", "mode",
        "prompt_digest", "worktree_path",
      ],
      optional: ["prepared_at"],
    },
    attempt: {
      required: ["operation_id", "prompt"],
      optional: ["timeout_seconds", "attempted_at"],
    },
    reconcile: {
      required: ["operation_id", "outcome"],
      optional: ["agent_id", "reconciled_at"],
    },
    complete: {
      required: ["operation_id", "classification", "summary", "evidence_digests"],
      optional: ["completed_at"],
    },
    dispose: { required: ["operation_id", "disposition"], optional: ["disposed_at"] },
  };
  if (!shapes[subcommand]) {
    throw new CliError("subagent requires prepare, attempt, reconcile, complete, dispose, or status");
  }
  const { runId, request } = await runScopedRequest(values, `subagent ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
    if (request.task_contract.run_id !== runId) throw new CliError("task contract run_id does not match --run-id", 73);
    result = await prepareSubagentOperation({
      stateRoot: git.stateRoot,
      task_contract: request.task_contract,
      model: request.model,
      reasoning_effort: request.reasoning_effort,
      fork_turns: request.fork_turns,
      mode: request.mode,
      prompt_digest: request.prompt_digest,
      worktree_path: request.worktree_path,
      now: commandNow(request, "prepared_at"),
    });
  } else if (subcommand === "attempt") {
    await subagentAuthority(git, request.operation_id, runId);
    result = await beginSubagentOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      prompt: request.prompt,
      timeoutSeconds: request.timeout_seconds ?? 300,
      now: commandNow(request, "attempted_at"),
    });
  } else if (subcommand === "reconcile") {
    await subagentAuthority(git, request.operation_id, runId);
    result = await reconcileSubagentOperationAttempt({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      agent_id: request.agent_id ?? null,
      now: commandNow(request, "reconciled_at"),
    });
  } else if (subcommand === "complete") {
    await subagentAuthority(git, request.operation_id, runId);
    result = await completeSubagentOperation({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      classification: request.classification,
      summary: request.summary,
      evidence_digests: request.evidence_digests,
      now: commandNow(request, "completed_at"),
    });
  } else {
    await subagentAuthority(git, request.operation_id, runId);
    result = await recordSubagentCoordinatorDisposition({
      stateRoot: git.stateRoot,
      operationId: request.operation_id,
      disposition: request.disposition,
      now: commandNow(request, "disposed_at"),
    });
  }
  const output = assertRunIdentity(result, runId, "subagent operation");
  if (subcommand === "attempt" && output.dispatch_permitted !== true) {
    const { host_request: ignored, ...withoutHostRequest } = output;
    v06Output(withoutHostRequest);
  } else {
    v06Output(output);
  }
}

function releasePrepareView(result) {
  const base = {
    run_id: result.run_id,
    release_id: result.release_id,
    operation_id: result.operation_id,
    ready_thread_id: result.ready_thread_id,
    status: result.status,
    dispatch_permitted: result.dispatch_permitted === true,
    prompt_digest: result.prompt_digest,
  };
  return result.dispatch_permitted === true
    ? {
      ...base,
      host_request: {
        kind: "send-message-to-task",
        thread_id: result.ready_thread_id,
        prompt: result.prompt,
      },
    }
    : base;
}

async function commandReleaseV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "release-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const releaseId = requireText(values["release-id"], "--release-id", { max: 128, safeId: true });
    const result = await releaseAuthority(git, releaseId, runId);
    v06Output(assertRunIdentity(result, runId, "task release"));
    return;
  }
  const shapes = {
    prepare: { required: ["task_contract", "operation_id"], optional: ["prepared_at"] },
    reconcile: { required: ["release_id", "outcome"], optional: ["reconciled_at"] },
    accept: {
      required: [
        "release_id", "ready_thread_id", "contract_id",
        "runtime_context_digest", "common_dir",
      ],
      optional: ["accepted_at"],
    },
  };
  if (!shapes[subcommand]) throw new CliError("release requires prepare, reconcile, accept, or status");
  const { runId, request } = await runScopedRequest(values, `release ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
    if (request.task_contract.run_id !== runId) throw new CliError("task contract run_id does not match --run-id", 73);
    result = await prepareTaskRelease({
      stateRoot: git.stateRoot,
      taskContract: request.task_contract,
      operationId: request.operation_id,
      now: commandNow(request, "prepared_at"),
    });
  } else if (subcommand === "reconcile") {
    await releaseAuthority(git, request.release_id, runId);
    result = await reconcileTaskRelease({
      stateRoot: git.stateRoot,
      releaseId: request.release_id,
      outcome: request.outcome,
      now: commandNow(request, "reconciled_at"),
    });
  } else {
    await releaseAuthority(git, request.release_id, runId);
    result = await acceptTaskRelease({
      stateRoot: git.stateRoot,
      releaseId: request.release_id,
      readyThreadId: request.ready_thread_id,
      contractId: request.contract_id,
      runtimeContextDigest: request.runtime_context_digest,
      commonDir: request.common_dir,
      now: commandNow(request, "accepted_at"),
    });
  }
  assertRunIdentity(result, runId, "task release");
  v06Output(subcommand === "prepare" ? releasePrepareView(result) : result);
}

async function commandCallbackV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest);
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    v06Output(await callbackStatusV06({ stateRoot: git.stateRoot, runId }));
    return;
  }
  if (subcommand === "consume") {
    throw new CliError("callback consume is internal to finalized disposition; no public bare consume exists", 64);
  }
  const shapes = {
    deliver: { required: ["receipt"], optional: ["delivered_at"] },
    observe: { required: ["callback_id", "recipient"], optional: ["observed_at"] },
  };
  if (!shapes[subcommand]) throw new CliError("callback requires deliver, observe, or status");
  const { runId, request } = await runScopedRequest(values, `callback ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "deliver") {
    if (request.receipt.run_id !== runId) throw new CliError("receipt.run_id does not match --run-id", 73);
    result = await deliverCallbackV06({
      stateRoot: git.stateRoot,
      receipt: request.receipt,
      expectedRunId: runId,
      now: commandNow(request, "delivered_at"),
    });
  } else {
    await callbackAuthority(git, request.callback_id, runId);
    result = await observeCallbackV06({
      stateRoot: git.stateRoot,
      callbackId: request.callback_id,
      recipient: request.recipient,
      now: commandNow(request, "observed_at"),
    });
    if (result.receipt) assertRunIdentity(result.receipt, runId, "terminal callback");
  }
  v06Output(result);
}

function urgentAttemptView(result) {
  const base = {
    status: result.status,
    urgent_id: result.urgent_id,
    delivery_attempt_id: result.delivery_attempt_id,
    dispatch_permitted: result.dispatch_permitted === true,
  };
  return result.dispatch_permitted === true
    ? { ...base, host_prompt: result.host_prompt }
    : base;
}

async function commandUrgentV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest);
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    await readRun({ gitCommonDirectory: git.commonDir, runId });
    v06Output(await urgentSignalStatusV06(git.stateRoot, { runId }));
    return;
  }
  const shapes = {
    persist: {
      required: ["release_id", "signal"],
      optional: ["persisted_at"],
    },
    attempt: {
      required: ["urgent_id"],
      optional: ["prepared_at"],
    },
    reconcile: {
      required: ["urgent_id", "delivery_attempt_id", "host_call_result"],
      optional: ["reconciled_at"],
    },
    observe: {
      required: ["urgent_id", "delivery_attempt_id", "recipient"],
      optional: ["observed_at"],
    },
    consume: {
      required: ["urgent_id", "recipient", "sender_executor_id"],
      optional: ["consumed_at"],
    },
    expire: {
      required: ["urgent_id"],
      optional: ["expired_at"],
    },
  };
  if (!shapes[subcommand]) {
    throw new CliError("urgent requires persist, attempt, reconcile, observe, consume, expire, or status");
  }
  const { runId, request } = await runScopedRequest(
    values,
    `urgent ${subcommand}`,
    shapes[subcommand],
  );
  let result;
  if (subcommand === "persist") {
    const release = await releaseAuthority(git, request.release_id, runId);
    if (
      release.status !== "accepted"
      || request.signal.run_id !== runId
      || request.signal.executor_id !== release.ready_thread_id
      || request.signal.recipient?.lineage_id !== release.coordinator_binding.lineage_id
    ) {
      throw new CliError(
        "Urgent signal requires the exact accepted release executor and coordinator lineage",
        73,
      );
    }
    result = await persistUrgentSignalV06({
      stateRoot: git.stateRoot,
      signal: request.signal,
      now: commandNow(request, "persisted_at"),
    });
  } else {
    await urgentAuthority(git, request.urgent_id, runId);
    if (subcommand === "attempt") {
      result = urgentAttemptView(await prepareUrgentAttemptV06({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        attemptSequence: 1,
        now: commandNow(request, "prepared_at"),
      }));
    } else if (subcommand === "reconcile") {
      result = await reconcileUrgentAttemptV06({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        deliveryAttemptId: request.delivery_attempt_id,
        hostCallResult: request.host_call_result,
        now: commandNow(request, "reconciled_at"),
      });
    } else if (subcommand === "observe") {
      result = await observeUrgentSignalV06({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        deliveryAttemptId: request.delivery_attempt_id,
        recipient: request.recipient,
        now: commandNow(request, "observed_at"),
      });
    } else if (subcommand === "consume") {
      result = await consumeUrgentSignalV06({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        recipient: request.recipient,
        senderExecutorId: request.sender_executor_id,
        now: commandNow(request, "consumed_at"),
      });
    } else {
      result = await expireUrgentSignalV06({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        now: commandNow(request, "expired_at"),
      });
    }
  }
  v06Output(result);
}

async function commandDispositionV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "disposition-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const dispositionId = requireText(values["disposition-id"], "--disposition-id", { max: 128, safeId: true });
    const result = await dispositionAuthority(git, dispositionId, runId);
    v06Output(assertRunIdentity(result, runId, "task disposition"));
    return;
  }
  const shapes = {
    prepare: { required: ["callback_id", "decision", "reason"], optional: ["prepared_at"] },
    finalize: {
      required: ["disposition_id", "recipient", "executor_thread_id"],
      optional: ["integration_id", "verification_id", "finalized_at"],
    },
    cancel: {
      required: ["release_id", "reason"],
      optional: ["cancelled_at"],
    },
  };
  if (!shapes[subcommand]) throw new CliError("disposition requires prepare, finalize, cancel, or status");
  const { runId, request } = await runScopedRequest(values, `disposition ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "cancel") {
    await releaseAuthority(git, request.release_id, runId);
    result = await cancelTaskBeforeExecution({
      stateRoot: git.stateRoot,
      releaseId: request.release_id,
      reason: request.reason,
      now: commandNow(request, "cancelled_at"),
    });
  } else if (subcommand === "prepare") {
    await callbackAuthority(git, request.callback_id, runId);
    result = await prepareTaskDisposition({
      stateRoot: git.stateRoot,
      callbackId: request.callback_id,
      decision: request.decision,
      reason: request.reason,
      now: commandNow(request, "prepared_at"),
    });
  } else {
    await dispositionAuthority(git, request.disposition_id, runId);
    result = await finalizeTaskDisposition({
      stateRoot: git.stateRoot,
      dispositionId: request.disposition_id,
      recipient: request.recipient,
      executorThreadId: request.executor_thread_id,
      integrationId: request.integration_id ?? null,
      verificationId: request.verification_id ?? null,
      now: commandNow(request, "finalized_at"),
    });
  }
  v06Output(assertRunIdentity(result, runId, "task disposition"));
}

async function commandVerificationV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "verification-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    v06Output(await verificationStatus({
      stateRoot: git.stateRoot,
      verificationId: values["verification-id"] ?? null,
      runId,
    }));
    return;
  }
  if (subcommand !== "run") throw new CliError("verification requires run or status");
  const { runId, request } = await runScopedRequest(values, "verification run", {
    required: ["receipt", "checks"],
    optional: ["integration_scope", "verified_at"],
  });
  if (request.receipt.run_id !== runId) throw new CliError("receipt.run_id does not match --run-id", 73);
  const result = await runCombinedVerification({
    stateRoot: git.stateRoot,
    repositoryPath: git.root,
    receipt: request.receipt,
    integrationScope: request.integration_scope ?? null,
    checks: request.checks,
    now: commandNow(request, "verified_at"),
  });
  assertRunIdentity(result.identity, runId, "combined verification");
  v06Output(result);
}

async function commandIntegrationV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "integration-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const integrationId = requireText(values["integration-id"], "--integration-id", { max: 128, safeId: true });
    const result = await integrationAuthority(git, integrationId, runId);
    v06Output(assertRunIdentity(result, runId, "serial integration"));
    return;
  }
  const shapes = {
    prepare: {
      required: ["disposition_id", "main_branch"],
      optional: ["prepared_at"],
    },
    "verification-request": { required: ["integration_id"] },
    reconcile: {
      required: ["integration_id"],
      optional: ["verification_id", "reconciled_at"],
    },
  };
  if (!shapes[subcommand]) {
    throw new CliError("integration requires prepare, verification-request, reconcile, or status");
  }
  const { runId, request } = await runScopedRequest(values, `integration ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
    await dispositionAuthority(git, request.disposition_id, runId);
    result = await prepareSerialIntegration({
      stateRoot: git.stateRoot,
      repositoryPath: git.root,
      dispositionId: request.disposition_id,
      mainBranch: request.main_branch,
      now: commandNow(request, "prepared_at"),
    });
    assertRunIdentity(result, runId, "serial integration");
  } else if (subcommand === "verification-request") {
    await integrationAuthority(git, request.integration_id, runId);
    result = await integrationVerificationRequest({
      stateRoot: git.stateRoot,
      repositoryPath: git.root,
      integrationId: request.integration_id,
    });
    assertRunIdentity(result.receipt, runId, "integration verification request");
  } else {
    await integrationAuthority(git, request.integration_id, runId);
    result = await reconcileSerialIntegration({
      stateRoot: git.stateRoot,
      repositoryPath: git.root,
      integrationId: request.integration_id,
      verificationId: request.verification_id ?? null,
      now: commandNow(request, "reconciled_at"),
    });
    assertRunIdentity(result, runId, "serial integration");
  }
  v06Output(result);
}

function archivePrepareView(result) {
  const base = {
    run_id: result.run_id,
    archive_id: result.archive_id,
    state: result.state,
    call_required: result.call_required,
    keep_visible: result.keep_visible,
  };
  return result.call_required === true
    ? { ...base, host_request: result.host_intent }
    : base;
}

async function commandArchiveV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest, { "archive-id": { type: "string" } });
  const git = v06Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const archiveId = requireText(values["archive-id"], "--archive-id", { max: 128, safeId: true });
    const result = await archiveAuthority(git, archiveId, runId);
    v06Output(assertRunIdentity(result, runId, "task archive"));
    return;
  }
  const shapes = {
    prepare: {
      required: ["disposition_id", "task_observation"],
      optional: ["host_id", "prepared_at"],
    },
    reconcile: {
      required: ["archive_id", "attempt_id", "outcome"],
      optional: ["observation", "reconciled_at"],
    },
  };
  if (!shapes[subcommand]) throw new CliError("archive requires prepare, reconcile, or status");
  const { runId, request } = await runScopedRequest(values, `archive ${subcommand}`, shapes[subcommand]);
  const result = subcommand === "prepare"
    ? await (async () => {
      await dispositionAuthority(git, request.disposition_id, runId);
      return prepareTaskArchive({
      stateRoot: git.stateRoot,
      dispositionId: request.disposition_id,
      taskObservation: request.task_observation,
      hostId: request.host_id ?? null,
      now: commandNow(request, "prepared_at"),
      });
    })()
    : await (async () => {
      await archiveAuthority(git, request.archive_id, runId);
      return reconcileTaskArchive({
      stateRoot: git.stateRoot,
      archiveId: request.archive_id,
      attemptId: request.attempt_id,
      outcome: request.outcome,
      observation: request.observation ?? null,
      now: commandNow(request, "reconciled_at"),
      });
    })();
  assertRunIdentity(result, runId, "task archive");
  v06Output(subcommand === "prepare" ? archivePrepareView(result) : result);
}

async function commandCleanupV06(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "plan") {
    throw new CliError("v0.6 cleanup exposes read-only plan only; cleanup apply is unavailable");
  }
  const values = parseV06Options(rest);
  const runId = explicitRunId(values);
  const git = v06Repository();
  await readRun({ gitCommonDirectory: git.commonDir, runId });
  const first = await cleanupPlanV06({ stateRoot: git.stateRoot, runId });
  const confirmed = await cleanupPlanV06({ stateRoot: git.stateRoot, runId });
  if (stableStringify(first) !== stableStringify(confirmed)) {
    throw new CliError("Cleanup state changed while deriving the read-only plan; inspect and retry", 75);
  }
  v06Output(confirmed);
}

async function assertAdoptionRun(git, runId) {
  return (await readRun({ gitCommonDirectory: git.commonDir, runId })).run;
}

async function commandAdoptV06(args) {
  const [subcommand, ...rest] = args;
  const values = parseV06Options(rest);
  const runId = explicitRunId(values);
  const git = v06Repository();
  if (subcommand === "status") {
    await assertAdoptionRun(git, runId);
    v06Output({ run_id: runId, adoption: await readAdoption({ repositoryRoot: git.root }) });
    return;
  }
  const shapes = {
    plan: {
      required: ["reviewed_instructions", "adopted_at"],
      optional: ["config", "policy"],
    },
    apply: { required: ["plan"] },
    "retire-plan": { required: ["reason", "retired_at"] },
    "retire-apply": { required: ["plan"] },
  };
  if (!shapes[subcommand]) throw new CliError("adopt requires plan, apply, status, retire-plan, or retire-apply");
  const scoped = await runScopedRequest(values, `adopt ${subcommand}`, shapes[subcommand]);
  const request = scoped.request;
  const run = await assertAdoptionRun(git, runId);
  let result;
  if (subcommand === "plan") {
    result = await planAdoption({
      repositoryRoot: git.root,
      gitCommonDirectory: git.commonDir,
      runtimeId: run.runtime_id,
      config: request.config,
      policy: request.policy,
      reviewedInstructions: request.reviewed_instructions,
      adoptedAt: request.adopted_at,
    });
  } else if (subcommand === "apply") {
    if (request.plan?.source_runtime?.runtime_id !== run.runtime_id) {
      throw new CliError("adoption plan runtime does not match --run-id", 73);
    }
    result = await applyAdoptionPlan({ repositoryRoot: git.root, plan: request.plan });
  } else if (subcommand === "retire-plan") {
    result = await planAdoptionRetirement({
      repositoryRoot: git.root,
      retiredAt: request.retired_at,
      reason: request.reason,
    });
  } else {
    result = await applyAdoptionRetirementPlan({ repositoryRoot: git.root, plan: request.plan });
  }
  v06Output({ run_id: runId, result });
}

async function mainLegacyV05(argv) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(LEGACY_HELP);
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(PACKAGE_VERSION);
    return;
  }
  const exactFlags = (allowed) => args.every((argument) => allowed.includes(argument));
  const readOnly = (
    (command === "init" && args.includes("--check") && exactFlags(["--check", "--json"]))
    || (command === "sync" && args.includes("--check") && exactFlags(["--check"]))
    || (command === "config" && args[0] === "show")
    || command === "doctor"
    || (
      command === "task"
      && (
        (args[0] === "packet" && ["validate", "render"].includes(args[1]))
        || (args[0] === "operation" && args[1] === "status")
      )
    )
    || (command === "plan" && args[0] === "validate")
    || (command === "recipient" && ["status", "resolve"].includes(args[0]))
    || (command === "callback" && args[0] === "status")
    || (command === "urgent" && args[0] === "status")
    || (command === "git" && args[0] === "status")
    || (command === "lease" && args[0] === "status")
    || (command === "cleanup" && args[0] === "audit")
  );
  if (!readOnly) {
    throw new CliError(
      `legacy-v05 is read-only historical verification; ${command} mutation is disabled`,
      64,
    );
  }
  if (command === "init") return commandInit(args);
  if (command === "sync") return commandSync(args);
  if (command === "config") return commandConfig(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "task") return commandTask(args);
  if (command === "plan") return commandPlan(args);
  if (command === "recipient") return commandRecipient(args);
  if (command === "callback") return commandCallback(args);
  if (command === "urgent") return commandUrgent(args);
  if (command === "git") return commandGit(args);
  if (command === "lease") return commandLease(args);
  if (command === "cleanup") return commandCleanup(args);
  throw new CliError(`Unknown legacy-v05 command: ${command}\n\n${LEGACY_HELP}`);
}

function migratedV05Command(command) {
  return [
    "init", "sync", "config", "doctor", "plan", "recipient", "urgent",
    "git", "lease",
  ].includes(command);
}

function isV06RunBoundMutation(command, args) {
  const subcommand = args[0];
  if (command === "workflow") return ["create", "revise", "contract"].includes(subcommand);
  if (command === "task") {
    return subcommand === "create" && ["prepare", "attempt", "reconcile"].includes(args[1]);
  }
  if (command === "subagent") {
    return ["prepare", "attempt", "reconcile", "complete", "dispose"].includes(subcommand);
  }
  if (command === "release") return ["prepare", "reconcile", "accept"].includes(subcommand);
  if (command === "callback") return ["deliver", "observe"].includes(subcommand);
  if (command === "urgent") return [
    "persist", "attempt", "reconcile", "observe", "consume", "expire",
  ].includes(subcommand);
  if (command === "disposition") return ["prepare", "finalize", "cancel"].includes(subcommand);
  if (command === "verification") return subcommand === "run";
  if (command === "integration") return ["prepare", "reconcile"].includes(subcommand);
  if (command === "archive") return ["prepare", "reconcile"].includes(subcommand);
  if (command === "adopt") return ["apply", "retire-apply"].includes(subcommand);
  return false;
}

async function dispatchV06Command(command, args, handler) {
  if (!isV06RunBoundMutation(command, args)) return handler(args);
  const runIds = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--run-id") {
      if (args[index + 1] !== undefined) runIds.push(args[index + 1]);
      index += 1;
    } else if (args[index].startsWith("--run-id=")) {
      runIds.push(args[index].slice("--run-id=".length));
    }
  }
  if (runIds.length === 0) return handler(args);
  if (runIds.length !== 1) throw new CliError("v0.6 mutations require exactly one --run-id", 64);
  const runId = requireText(runIds[0], "--run-id", { max: 128, safeId: true });
  const git = v06Repository();
  return guardedActiveRunMutation(git, runId, () => handler(args));
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
  if (command === "legacy-v05") return mainLegacyV05(args);
  if (command === "run") return commandRunV06(args);
  if (command === "workflow") return dispatchV06Command(command, args, commandWorkflowV06);
  if (command === "task") return dispatchV06Command(command, args, commandTaskV06);
  if (command === "subagent") return dispatchV06Command(command, args, commandSubagentV06);
  if (command === "release") return dispatchV06Command(command, args, commandReleaseV06);
  if (command === "callback") return dispatchV06Command(command, args, commandCallbackV06);
  if (command === "urgent") return dispatchV06Command(command, args, commandUrgentV06);
  if (command === "disposition") return dispatchV06Command(command, args, commandDispositionV06);
  if (command === "verification") return dispatchV06Command(command, args, commandVerificationV06);
  if (command === "integration") return dispatchV06Command(command, args, commandIntegrationV06);
  if (command === "archive") return dispatchV06Command(command, args, commandArchiveV06);
  if (command === "cleanup") return commandCleanupV06(args);
  if (command === "adopt") return dispatchV06Command(command, args, commandAdoptV06);
  if (migratedV05Command(command)) {
    throw new CliError(
      `${command} is a quarantined v0.5 command; v0.6 does not retain dual authority. `
      + `Use a v0.6 command or explicit legacy-v05 ${command} only for historical verification.`,
      64,
    );
  }
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
