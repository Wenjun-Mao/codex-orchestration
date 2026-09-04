#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliError,
  PACKAGE_VERSION,
  readJson,
  readJsonInput,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "../lib/core.mjs";
import { cleanupPlan } from "../lib/cleanup.mjs";
import { discoverGit, gitSnapshot } from "../lib/git.mjs";
import {
  assertNoForeignActiveRunCollision,
  assertNoIncompatibleFlowNamespace,
} from "../lib/foreign-active-run-sentinel.mjs";
import {
  assertNoUnplugInProgress,
  observePrivateUnplug,
  unplugApply,
  unplugPlan,
} from "../lib/compat/unplug.mjs";
import {
  bindRecipient,
  rebindRecipient,
  recipientStatus,
} from "../lib/recipients.mjs";
import {
  consumeUrgentSignal,
  expireUrgentSignal,
  observeUrgentSignal,
  persistUrgentSignal,
  prepareUrgentAttempt,
  reconcileUrgentAttempt,
  urgentSignalRecord,
  urgentSignalStatus,
} from "../lib/urgent-signals.mjs";
import {
  prepareTaskArchive,
  reconcileTaskArchive,
  taskArchiveStatus,
} from "../lib/archive-lifecycle.mjs";
import { observeCodexAppArchiveEvidence } from "../lib/adapters/codex-app/private-archive-observer.mjs";
import { codexAppArchiveToNativeObservation } from "../lib/adapters/codex-app/archive-observation.mjs";
import {
  callbackRecord,
  callbackStatus,
  deliverCallback,
  observeCallback,
} from "../lib/callbacks.mjs";
import {
  finalizeTaskDisposition,
  prepareTaskDisposition,
  taskDispositionStatus,
} from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
  serialIntegrationStatus,
} from "../lib/integration.mjs";
import {
  abandonRun,
  admitRun,
  admitRunWithRepositoryLockHeld,
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
  applyRefresh,
  authenticateRefreshSkill,
  consumeRefreshActivation,
  inspectRefresh,
  observeRefreshPrivateArchives,
  prepareRefresh,
  refreshStatus,
} from "../lib/compat/refresh.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
  RUNTIME_DIRECTORY,
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
} from "../lib/subagent-operations.mjs";
import {
  prepareTaskLaunch,
  reconcileTaskLaunch,
  recordTaskLaunchAttempt,
  startTaskLaunch,
  taskLaunchStatus,
} from "../lib/core/task-launch.mjs";
import {
  classifyCodexAppCreation,
  codexAppCreationToNativeEvidence,
} from "../lib/adapters/codex-app/host-evidence.mjs";
import {
  resolveNoChangeVerificationSubject,
  runCombinedVerification,
  verificationStatus,
} from "../lib/verifications.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
  reviseWorkflowJournal,
  workflowJournalStatus,
  workflowTaskContractStatus,
} from "../lib/workflow-journal.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `codex-flow ${PACKAGE_VERSION}

Usage:
  codex-flow run activate --run-id ID --file request.json [--json]
  codex-flow run status --run-id ID [--json]
  codex-flow run resume|rebind|close|abandon --run-id ID --file request.json [--json]
  codex-flow run audit --run-id ID [--json]
  codex-flow workflow create|revise|contract --run-id ID --file request.json [--json]
  codex-flow workflow status --run-id ID --plan-id ID [--json]
  codex-flow task launch prepare|attempt|reconcile --run-id ID --file request.json [--json]
  codex-flow task launch start --run-id ID --launch-id ID --nonce HEX [--json]
  codex-flow task launch status --run-id ID --launch-id ID [--json]
  codex-flow subagent prepare|attempt|reconcile|complete|dispose --run-id ID --file request.json [--json]
  codex-flow subagent status --run-id ID --operation-id ID [--json]
  codex-flow callback deliver|observe --run-id ID --file request.json [--json]
  codex-flow callback status --run-id ID [--json]
  codex-flow urgent persist|attempt|reconcile|observe|consume|expire --run-id ID --file request.json [--json]
  codex-flow urgent status --run-id ID [--json]
  codex-flow disposition prepare|finalize --run-id ID --file request.json [--json]
  codex-flow disposition status --run-id ID --disposition-id ID [--json]
  codex-flow verification run --run-id ID --file request.json [--json]
  codex-flow verification status --run-id ID [--verification-id ID] [--json]
  codex-flow integration prepare|verification-request|reconcile --run-id ID --file request.json [--json]
  codex-flow integration status --run-id ID --integration-id ID [--json]
  codex-flow archive prepare|reconcile|observe-private --run-id ID --file request.json [--json]
  codex-flow archive status --run-id ID --archive-id ID [--json]
  codex-flow cleanup plan --run-id ID [--json]
  codex-flow unplug plan [--file request.json] [--json]
  codex-flow unplug observe-private --file request.json [--json]
  codex-flow unplug apply --file request.json [--json]
  codex-flow refresh inspect --invoking-skill PATH [--json]
  codex-flow refresh observe-private --invoking-skill PATH --refresh-id ID [--json]
  codex-flow refresh prepare|apply --invoking-skill PATH --file request.json [--json]
  codex-flow refresh status --invoking-skill PATH [--refresh-id ID] [--json]

Every run-scoped command requires an explicit --run-id. Complex mutations read
one JSON request from --file and reject a mismatched request.run_id before any
state change. Native App calls remain external: the CLI emits one exact host
request when dispatch is permitted, while the executor claims identity and
activates its worktree from the full first-turn assignment.
`;

function helpFor(command, args) {
  return HELP;
}

function parse(options, args = process.argv.slice(2), allowPositionals = true) {
  return parseArgs({ args, options, allowPositionals, strict: true });
}

function requireCanonicalSource() {
  const packagePath = resolve(packageRoot, "package.json");
  const pluginPath = resolve(packageRoot, ".codex-plugin", "plugin.json");
  if (![packagePath, pluginPath].every((path) => existsSync(path))) {
    throw new CliError(
      "Run Codex Flow from the installed codex-orchestration plugin package, not a repository snapshot",
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

function v09Output(value) {
  console.log(stableStringify(value, 2));
}

function shellArgument(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function assertRunBoundRuntimeExecution({
  git,
  runId,
  requestFile,
  runtime,
  command,
  label,
}) {
  const runBoundDigest = runtime.bundle.bundle_sha256;
  const boundBundleRoot = resolve(
    git.stateRoot,
    "runtimes",
    runBoundDigest,
    "files",
  );
  const executingRoot = await realpath(packageRoot).catch(() => null);
  const canonicalBoundRoot = await realpath(boundBundleRoot).catch(() => null);
  if (executingRoot !== null && executingRoot === canonicalBoundRoot) return;
  const executing = await loadRuntimeBundleSource({ packageRoot });
  if (executing.bundle.bundle_sha256 === runBoundDigest) return;
  const boundCli = resolve(boundBundleRoot, "bin", "codex-flow.mjs");
  const recovery = [
    process.execPath,
    boundCli,
    ...command,
    "--run-id",
    runId,
    ...(requestFile === null || requestFile === undefined
      ? []
      : ["--file", resolve(process.cwd(), requestFile)]),
    "--json",
  ].map(shellArgument).join(" ");
  throw new CliError([
    `${label} must use the exact run-bound runtime.`,
    `executing_bundle_sha256=${executing.bundle.bundle_sha256}`,
    `run_bound_bundle_sha256=${runBoundDigest}`,
    `runtime_context_digest=${runtimeContextHash(runtime)}`,
    `recovery_command=${recovery}`,
  ].join("\n"), 73);
}

function parseV09Options(args, extra = {}) {
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

function v09Repository() {
  return discoverGit(process.cwd());
}

function assertRunIdentity(value, runId, label) {
  if (value?.run_id !== runId) throw new CliError(`${label} does not belong to --run-id`, 73);
  return value;
}

async function taskLaunchAuthority(git, launchId, runId) {
  const id = requireText(launchId, "launch_id", { max: 128, safeId: true });
  const record = await taskLaunchStatus({ stateRoot: git.stateRoot, launchId: id });
  return assertRunIdentity(record, runId, "task launch");
}

async function subagentAuthority(git, operationId, runId) {
  const record = await subagentOperationStatus({ stateRoot: git.stateRoot, operationId });
  return assertRunIdentity(record, runId, "subagent operation");
}

async function callbackAuthority(git, callbackId, runId) {
  const record = await callbackRecord({ stateRoot: git.stateRoot, callbackId });
  assertRunIdentity(record.receipt, runId, "terminal callback");
  return record;
}

async function urgentAuthority(git, urgentId, runId) {
  const record = await urgentSignalRecord({ stateRoot: git.stateRoot, urgentId });
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

async function activeRunAuthority(git, runId, planId = null, { allowLinkedWorktree = false } = {}) {
  const { run } = await readRun({ gitCommonDirectory: git.commonDir, runId });
  if (run.status !== "active") throw new CliError(`v0.9 run is not active: ${runId}`, 73);
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
  ) throw new CliError("active run/runtime/repository authority is inconsistent", 73);
  if (!allowLinkedWorktree && runtime.repository.root !== git.root) {
    throw new CliError(
      "v0.9 mutation requires coordinator-only mutation authority from the exact coordinator checkout",
      73,
    );
  }
  return {
    run,
    runtime,
    binding,
    caller_repository_mode: runtime.repository.root === git.root
      ? "coordinator-checkout"
      : "linked-worktree",
  };
}

async function guardedActiveRunMutation(git, runId, operation, { allowLinkedWorktree = false } = {}) {
  return withActiveRunMutation({
    gitCommonDirectory: git.commonDir,
    runId,
  }, async (locked) => {
    const authority = await activeRunAuthority(git, runId, null, { allowLinkedWorktree });
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

function assertCurrentCoordinatorTask(lineage, operation) {
  const currentTaskId = requireText(
    process.env.CODEX_THREAD_ID ?? "",
    `${operation} host-exposed current task identity`,
    { max: 128, safeId: true },
  );
  if (currentTaskId !== lineage.thread_id) {
    throw new CliError(`${operation} must run from the host's current coordinator task`, 73);
  }
  return {
    invoking_thread_id: currentTaskId,
    source: "codex-environment",
    matched: true,
  };
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
  if (current.status !== "active") throw new CliError(`v0.9 run is not active: ${runId}`, 73);
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
  const coordinatorIdentity = assertCurrentCoordinatorTask({
    thread_id: requireText(resume.lineage?.thread_id, "run rebind resume coordinator thread_id", {
      max: 128,
      safeId: true,
    }),
  }, "run rebind");
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
  return {
    ...result,
    coordinator_identity: coordinatorIdentity,
    coordinator_recipient: reboundRecipient.recipient,
  };
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

async function commandRunV09(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "activate") {
    const values = parseV09Options(rest, { "refresh-id": { type: "string" } });
    const { runId, request } = await runScopedRequest(values, "run activate", {
      required: ["activated_at", "runtime", "workflow", "fences"],
      optional: ["refresh_id"],
    });
    const optionRefreshId = values["refresh-id"] ?? null;
    const requestRefreshId = request.refresh_id ?? null;
    if (optionRefreshId !== null && requestRefreshId !== null && optionRefreshId !== requestRefreshId) {
      throw new CliError("run activate --refresh-id does not match request.refresh_id", 73);
    }
    const refreshId = optionRefreshId ?? requestRefreshId;
    if (refreshId !== null) requireText(refreshId, "refresh_id", { max: 128, safeId: true });
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
    await assertNoUnplugInProgress({ gitCommonDirectory: git.commonDir });
    if (refreshId === null) {
      await assertNoForeignActiveRunCollision({
        gitCommonDirectory: git.commonDir,
        currentNamespace: RUNTIME_DIRECTORY,
      });
      await assertNoIncompatibleFlowNamespace({
        gitCommonDirectory: git.commonDir,
        currentNamespace: RUNTIME_DIRECTORY,
      });
    }
    const workflow = createWorkflowPlanRevision(request.workflow);
    const fences = activationFences(request.fences);
    assertWorkflowReservationCovered(fences, workflow);
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
    const coordinatorIdentity = assertCurrentCoordinatorTask(runtime.lineage, "run activate");
    const lifecycle = await readRunLifecycle({ gitCommonDirectory: git.commonDir });
    const active = lifecycle.state.active_run_id === null
      ? null
      : lifecycle.state.runs[lifecycle.state.active_run_id];
    const existing = lifecycle.state.runs[runId] ?? null;
    if (active !== null && active.run_id !== runId) {
      throw new CliError(`A different v0.9 run is already active: ${active.run_id}`, 75);
    }
    if (existing !== null && (
      existing.status !== "active"
      || existing.runtime_id !== runtime.runtime_id
      || existing.workflow_plan_id !== workflow.plan_id
      || existing.workflow_revision_digest !== workflow.revision_digest
      || stableStringify(existing.plan) !== stableStringify(fences)
    )) {
      throw new CliError(`v0.9 run activation does not match its immutable authority: ${runId}`, 73);
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
    const prepareTargetState = async () => ({
      acquired: await acquireRuntimeContext({
        gitCommonDirectory: git.commonDir,
        context: runtime,
        bundleSource,
      }),
      journal: await createWorkflowJournal({
        stateRoot: git.stateRoot,
        runId,
        planId: workflow.plan_id,
        planRevision: workflow,
        now: Date.parse(activatedAt),
      }),
    });
    const readExistingTargetState = async () => {
      const acquired = await readRuntimeContext({
        gitCommonDirectory: git.commonDir,
        runtimeId: runtime.runtime_id,
      });
      return {
        acquired: { ...acquired, status: "existing" },
        journal: await workflowJournalStatus({
          stateRoot: git.stateRoot,
          runId,
          planId: workflow.plan_id,
        }),
      };
    };
    const admissionRequest = {
      gitCommonDirectory: git.commonDir,
      runId,
      runtimeId: runtime.runtime_id,
      workflowPlanId: workflow.plan_id,
      workflowRevisionDigest: workflow.revision_digest,
      plan: fences,
      admittedAt: activatedAt,
    };
    const refresh = refreshId === null
      ? null
      : await consumeRefreshActivation({
        commonDir: git.commonDir,
        stateRoot: git.stateRoot,
        refreshId,
        runId,
        runtime,
        workflow,
        fences,
        activatedAt,
        prepare: prepareTargetState,
        readExisting: readExistingTargetState,
        existingRun: existing,
        admit: (repositoryLockToken) => admitRunWithRepositoryLockHeld({
          ...admissionRequest,
          repositoryLockToken,
        }),
      });
    const preparedTarget = refresh === null
      ? await prepareTargetState()
      : refresh.prepared;
    const { acquired, journal } = preparedTarget;
    const admitted = refresh === null ? await admitRun(admissionRequest) : refresh.admitted;
    const coordinatorRecipient = await bindRunCoordinatorRecipient({
      git,
      run: admitted.run,
      lineage: runtime.lineage,
    });
    const binding = runtimeBindingFromContext(runtime);
    const coordinatorBinding = canonicalCoordinatorBinding(runtime.lineage);
    v09Output({
      status: admitted.status,
      package_authority: {
        package: "@wjmao/codex-flow",
        package_version: PACKAGE_VERSION,
        source_root: packageRoot,
        bundle_sha256: runtime.bundle.bundle_sha256,
      },
      state_authority: {
        namespace: RUNTIME_DIRECTORY,
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
      coordinator_identity: coordinatorIdentity,
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
      refresh_origin: refresh?.origin ?? null,
      run: admitted.run,
    });
    return;
  }

  if (subcommand === "status") {
    const values = parseV09Options(rest);
    const runId = explicitRunId(values);
    const git = v09Repository();
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
    v09Output({ ...result, runtime: runtime.context, workflow });
    return;
  }

  if (subcommand === "audit") {
    const values = parseV09Options(rest);
    const runId = explicitRunId(values);
    const git = v09Repository();
    const { auditRunClosure } = await import("../lib/run-audit.mjs");
    v09Output(await auditRunClosure({ stateRoot: git.stateRoot, runId }));
    return;
  }

  if (["resume", "rebind", "close", "abandon"].includes(subcommand)) {
    const values = parseV09Options(rest);
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
    const git = v09Repository();
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
      const { closeRunFromAudit } = await import("../lib/run-audit.mjs");
      result = await closeRunFromAudit({
        gitCommonDirectory: git.commonDir,
        stateRoot: git.stateRoot,
        runId,
        auditId: request.audit_id,
        resume: request.resume,
        closedAt: request.closed_at ?? new Date().toISOString(),
      });
    }
    v09Output(result);
    return;
  }
  throw new CliError("run requires activate, status, resume, rebind, audit, close, or abandon");
}

async function commandWorkflowV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "plan-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const planId = requireText(values["plan-id"], "--plan-id", { max: 128, safeId: true });
    const { run } = await readRun({ gitCommonDirectory: git.commonDir, runId });
    if (run.workflow_plan_id !== planId) {
      throw new CliError("workflow plan_id does not match --run-id", 73);
    }
    v09Output(await workflowJournalStatus({ stateRoot: git.stateRoot, runId, planId }));
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
  v09Output(result);
}

function taskLaunchAttemptView(result) {
  const base = {
    run_id: result.run_id,
    launch_id: result.launch_id,
    attempt_id: result.attempt?.attempt_id ?? null,
    reconcile_by: result.attempt?.reconcile_by ?? null,
    dispatch_permitted: result.dispatch_permitted === true,
  };
  return result.dispatch_permitted === true
    ? { ...base, host_request: result.host_request }
    : base;
}

async function commandTaskLaunchV09(args, mutationAuthority = null) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, {
    "launch-id": { type: "string" },
    nonce: { type: "string" },
  });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const launchId = requireText(values["launch-id"], "--launch-id", { max: 128, safeId: true });
    const result = await taskLaunchAuthority(git, launchId, runId);
    v09Output(result);
    return;
  }
  if (subcommand === "start") {
    const runId = explicitRunId(values);
    if (values.file !== undefined) throw new CliError("task launch start does not accept --file", 64);
    const launchId = requireText(values["launch-id"], "--launch-id", { max: 128, safeId: true });
    const nonce = requireText(values.nonce, "--nonce", { max: 64 });
    const executorThreadId = requireText(process.env.CODEX_THREAD_ID, "CODEX_THREAD_ID", {
      max: 256,
      safeId: true,
    });
    if (mutationAuthority === null || mutationAuthority.caller_repository_mode !== "linked-worktree") {
      throw new CliError("task launch start requires run-bound linked-worktree authority", 73);
    }
    await assertRunBoundRuntimeExecution({
      git,
      runId,
      requestFile: null,
      runtime: mutationAuthority.runtime,
      command: ["task", "launch", "start"],
      label: "Task launch start",
    });
    await taskLaunchAuthority(git, launchId, runId);
    const result = await startTaskLaunch({
      stateRoot: git.stateRoot,
      launchId,
      launchNonce: nonce,
      executorThreadId,
      repositoryPath: git.root,
      now: Date.now(),
    });
    v09Output(assertRunIdentity(result, runId, "task launch"));
    return;
  }
  const shapes = {
    prepare: { required: ["task_contract", "requested_selectors"] },
    attempt: {
      required: ["launch_id", "host_session_id"],
      optional: ["timeout_seconds"],
    },
    reconcile: {
      required: ["launch_id", "outcome"],
      optional: [
        "host_id", "provisional_client_thread_id", "ready_thread_id", "opaque_result",
        "observed_selectors", "reason_code",
      ],
    },
  };
  if (!shapes[subcommand]) {
    throw new CliError("task launch requires prepare, attempt, reconcile, start, or status");
  }
  const { runId, request } = await runScopedRequest(values, `task launch ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
    if (request.task_contract.run_id !== runId) {
      throw new CliError("task contract run_id does not match --run-id", 73);
    }
    result = await prepareTaskLaunch({
      stateRoot: git.stateRoot,
      taskContract: request.task_contract,
      requestedSelectors: request.requested_selectors,
      now: Date.now(),
    });
  } else if (subcommand === "attempt") {
    await taskLaunchAuthority(git, request.launch_id, runId);
    result = await recordTaskLaunchAttempt({
      stateRoot: git.stateRoot,
      launchId: request.launch_id,
      hostSessionId: request.host_session_id,
      timeoutSeconds: request.timeout_seconds ?? 1800,
      now: Date.now(),
    });
  } else {
    const current = await taskLaunchAuthority(git, request.launch_id, runId);
    let nativeEvidence = null;
    if (["ready", "provisional", "opaque"].includes(request.outcome)) {
      const adapterEvidence = classifyCodexAppCreation({
        requestDigest: sha256(stableStringify({ launch_id: request.launch_id })),
        hostId: request.host_id ?? "local",
        reportedThreadId: request.outcome === "ready" ? request.ready_thread_id ?? null : null,
        provisionalClientThreadId: request.outcome === "provisional"
          ? request.provisional_client_thread_id ?? null
          : null,
        opaqueResult: request.outcome === "opaque" ? request.opaque_result ?? null : null,
        observedAt: new Date().toISOString(),
      });
      nativeEvidence = codexAppCreationToNativeEvidence(adapterEvidence);
      if (nativeEvidence.classification !== request.outcome) {
        throw new CliError("Codex App result shape does not match the requested launch outcome", 73);
      }
    }
    const acceptedAt = nativeEvidence?.observed_at ?? new Date().toISOString();
    const observed = request.observed_selectors === undefined
      ? null
      : {
          project_id: request.observed_selectors.project_id ?? null,
          model: request.observed_selectors.model ?? null,
          reasoning_effort: request.observed_selectors.reasoning_effort ?? null,
          observed_at: acceptedAt,
        };
    result = await reconcileTaskLaunch({
      stateRoot: git.stateRoot,
      launchId: request.launch_id,
      outcome: request.outcome,
      hostId: nativeEvidence?.host_id ?? request.host_id ?? "local",
      readyThreadId: nativeEvidence?.ready_thread_id ?? null,
      provisionalId: nativeEvidence?.provisional_id ?? null,
      opaqueEvidence: nativeEvidence?.opaque_digest === undefined || nativeEvidence?.opaque_digest === null
        ? null
        : { digest: nativeEvidence.opaque_digest, length: nativeEvidence.opaque_length },
      selectorEvidence: nativeEvidence === null
        ? null
        : {
            accepted: {
              project_id: current.selector_evidence.requested.project_id,
              model: current.selector_evidence.requested.model,
              reasoning_effort: current.selector_evidence.requested.reasoning_effort,
              observed_at: acceptedAt,
            },
            observed,
          },
      reasonCode: request.reason_code ?? null,
      observedAt: nativeEvidence?.observed_at ?? null,
      now: Date.now(),
    });
  }
  assertRunIdentity(result, runId, "task launch");
  v09Output(subcommand === "attempt" ? taskLaunchAttemptView(result) : result);
}

async function commandTaskV09(args, mutationAuthority = null) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "launch") {
    throw new CliError("task requires the v0.9 launch lifecycle");
  }
  return commandTaskLaunchV09(rest, mutationAuthority);
}

async function commandSubagentV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "operation-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const operationId = requireText(values["operation-id"], "--operation-id", { max: 128, safeId: true });
    const result = await subagentAuthority(git, operationId, runId);
    v09Output(assertRunIdentity(result, runId, "subagent operation"));
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
    v09Output(withoutHostRequest);
  } else {
    v09Output(output);
  }
}

async function commandCallbackV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest);
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    v09Output(await callbackStatus({ stateRoot: git.stateRoot, runId }));
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
    result = await deliverCallback({
      stateRoot: git.stateRoot,
      receipt: request.receipt,
      expectedRunId: runId,
      now: commandNow(request, "delivered_at"),
    });
  } else {
    await callbackAuthority(git, request.callback_id, runId);
    result = await observeCallback({
      stateRoot: git.stateRoot,
      callbackId: request.callback_id,
      recipient: request.recipient,
      now: commandNow(request, "observed_at"),
    });
    if (result.receipt) assertRunIdentity(result.receipt, runId, "terminal callback");
  }
  v09Output(result);
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

async function commandUrgentV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest);
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    await readRun({ gitCommonDirectory: git.commonDir, runId });
    v09Output(await urgentSignalStatus(git.stateRoot, { runId }));
    return;
  }
  const shapes = {
    persist: {
      required: ["launch_id", "signal"],
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
    const launch = await taskLaunchAuthority(git, request.launch_id, runId);
    if (
      launch.status !== "active"
      || request.signal.run_id !== runId
      || request.signal.executor_id !== launch.start_claim?.executor_thread_id
      || request.signal.recipient?.lineage_id !== launch.coordinator_binding.lineage_id
    ) {
      throw new CliError(
        "Urgent signal requires the exact active launch executor and coordinator lineage",
        73,
      );
    }
    result = await persistUrgentSignal({
      stateRoot: git.stateRoot,
      signal: request.signal,
      now: commandNow(request, "persisted_at"),
    });
  } else {
    await urgentAuthority(git, request.urgent_id, runId);
    if (subcommand === "attempt") {
      result = urgentAttemptView(await prepareUrgentAttempt({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        attemptSequence: 1,
        now: commandNow(request, "prepared_at"),
      }));
    } else if (subcommand === "reconcile") {
      result = await reconcileUrgentAttempt({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        deliveryAttemptId: request.delivery_attempt_id,
        hostCallResult: request.host_call_result,
        now: commandNow(request, "reconciled_at"),
      });
    } else if (subcommand === "observe") {
      result = await observeUrgentSignal({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        deliveryAttemptId: request.delivery_attempt_id,
        recipient: request.recipient,
        now: commandNow(request, "observed_at"),
      });
    } else if (subcommand === "consume") {
      result = await consumeUrgentSignal({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        recipient: request.recipient,
        senderExecutorId: request.sender_executor_id,
        now: commandNow(request, "consumed_at"),
      });
    } else {
      result = await expireUrgentSignal({
        stateRoot: git.stateRoot,
        urgentId: request.urgent_id,
        now: commandNow(request, "expired_at"),
      });
    }
  }
  v09Output(result);
}

async function commandDispositionV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "disposition-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const dispositionId = requireText(values["disposition-id"], "--disposition-id", { max: 128, safeId: true });
    const result = await dispositionAuthority(git, dispositionId, runId);
    v09Output(assertRunIdentity(result, runId, "task disposition"));
    return;
  }
  const shapes = {
    prepare: { required: ["callback_id", "decision", "reason"], optional: ["prepared_at"] },
    finalize: {
      required: ["disposition_id", "recipient", "executor_thread_id"],
      optional: ["integration_id", "verification_id", "finalized_at"],
    },
  };
  if (!shapes[subcommand]) throw new CliError("disposition requires prepare, finalize, or status");
  const { runId, request } = await runScopedRequest(values, `disposition ${subcommand}`, shapes[subcommand]);
  let result;
  if (subcommand === "prepare") {
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
  v09Output(assertRunIdentity(result, runId, "task disposition"));
}

async function commandVerificationV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "verification-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    v09Output(await verificationStatus({
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
  const integrationScope = request.integration_scope ?? null;
  const verificationSubject = integrationScope === null
    ? await resolveNoChangeVerificationSubject({
      stateRoot: git.stateRoot,
      receipt: request.receipt,
    })
    : null;
  const result = await runCombinedVerification({
    stateRoot: git.stateRoot,
    repositoryPath: verificationSubject?.repository_path ?? git.root,
    receipt: request.receipt,
    integrationScope,
    checks: request.checks,
    now: commandNow(request, "verified_at"),
  });
  assertRunIdentity(result.identity, runId, "combined verification");
  v09Output(result);
}

async function commandIntegrationV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "integration-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const integrationId = requireText(values["integration-id"], "--integration-id", { max: 128, safeId: true });
    const result = await integrationAuthority(git, integrationId, runId);
    v09Output(assertRunIdentity(result, runId, "serial integration"));
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
  v09Output(result);
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

async function commandArchiveV09(args) {
  const [subcommand, ...rest] = args;
  const values = parseV09Options(rest, { "archive-id": { type: "string" } });
  const git = v09Repository();
  if (subcommand === "status") {
    const runId = explicitRunId(values);
    const archiveId = requireText(values["archive-id"], "--archive-id", { max: 128, safeId: true });
    const result = await archiveAuthority(git, archiveId, runId);
    v09Output(assertRunIdentity(result, runId, "task archive"));
    return;
  }
  if (subcommand === "observe-private") {
    if (!values.file) throw new CliError("archive observe-private requires --file <request.json>");
    const runId = explicitRunId(values);
    const request = await readJsonInput(values.file);
    requireExactFields(request, { required: ["archive_id"] }, "archive observe-private request");
    const archive = await archiveAuthority(git, request.archive_id, runId);
    const evidence = await observeCodexAppArchiveEvidence({
      threadId: archive.executor_thread_id,
    });
    v09Output({
      schema_version: 1,
      kind: "codex-flow-v09-task-archive-host-observation",
      run_id: runId,
      archive_id: archive.archive_id,
      attempt_id: archive.host_intent.attempt_id,
      evidence,
      observation: codexAppArchiveToNativeObservation(evidence),
    });
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
  if (!shapes[subcommand]) throw new CliError("archive requires prepare, reconcile, observe-private, or status");
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
  v09Output(subcommand === "prepare" ? archivePrepareView(result) : result);
}

async function commandCleanupV09(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "plan") {
    throw new CliError("v0.9 cleanup exposes read-only plan only; cleanup apply is unavailable");
  }
  const values = parseV09Options(rest);
  const runId = explicitRunId(values);
  const git = v09Repository();
  await readRun({ gitCommonDirectory: git.commonDir, runId });
  const first = await cleanupPlan({ stateRoot: git.stateRoot, runId });
  const confirmed = await cleanupPlan({ stateRoot: git.stateRoot, runId });
  if (stableStringify(first) !== stableStringify(confirmed)) {
    throw new CliError("Cleanup state changed while deriving the read-only plan; inspect and retry", 75);
  }
  v09Output(confirmed);
}

async function commandUnplugV09(args) {
  const [subcommand, ...rest] = args;
  if (!["plan", "observe-private", "apply"].includes(subcommand)) {
    throw new CliError("unplug requires plan, observe-private, or apply");
  }
  const values = parseV09Options(rest);
  if (values["run-id"] !== undefined) {
    throw new CliError("unplug is repository-scoped and does not accept --run-id", 64);
  }
  requireCanonicalSource();
  if (subcommand === "plan") {
    const request = values.file === undefined ? { resources: [] } : await readJsonInput(values.file);
    requireExactFields(request, { required: ["resources"] }, "unplug plan request");
    v09Output(await unplugPlan({
      repositoryPath: process.cwd(),
      resources: request.resources,
    }));
    return;
  }
  if (subcommand === "observe-private") {
    if (!values.file) throw new CliError("unplug observe-private requires --file <request.json>");
    const request = await readJsonInput(values.file);
    requireExactFields(request, { required: ["plan"] }, "unplug observe-private request");
    v09Output(await observePrivateUnplug({ plan: request.plan }));
    return;
  }
  if (!values.file) throw new CliError("unplug apply requires --file <request.json>");
  const request = await readJsonInput(values.file);
  requireExactFields(request, {
    required: ["approved", "plan", "archive_evidence"],
    optional: ["applied_at"],
  }, "unplug apply request");
  if (request.approved !== true) {
    throw new CliError("unplug apply requires explicit approved=true for the exact plan", 73);
  }
  v09Output(await unplugApply({
    repositoryPath: process.cwd(),
    plan: request.plan,
    archiveEvidence: request.archive_evidence,
    now: commandNow(request, "applied_at"),
  }));
}

async function commandRefreshV09(args) {
  const [subcommand, ...rest] = args;
  if (!["inspect", "prepare", "observe-private", "apply", "status"].includes(subcommand)) {
    throw new CliError("refresh requires inspect, prepare, observe-private, apply, or status");
  }
  const values = parseV09Options(rest, {
    "invoking-skill": { type: "string" },
    "refresh-id": { type: "string" },
  });
  if (values["run-id"] !== undefined) {
    throw new CliError("refresh is repository-scoped and does not accept --run-id", 64);
  }
  const invokingSkillPath = requireText(
    values["invoking-skill"],
    "--invoking-skill",
    { max: 2048 },
  );
  requireCanonicalSource();
  const git = v09Repository();
  if (subcommand === "inspect") {
    if (values.file !== undefined || values["refresh-id"] !== undefined) {
      throw new CliError("refresh inspect accepts only --invoking-skill and --json", 64);
    }
    v09Output(await inspectRefresh({
      commonDir: git.commonDir,
      currentNamespace: RUNTIME_DIRECTORY,
      packageRoot,
      invokingSkillPath,
    }));
    return;
  }
  const targetAuthority = await authenticateRefreshSkill({ packageRoot, invokingSkillPath });
  if (subcommand === "status") {
    if (values.file !== undefined) throw new CliError("refresh status does not accept --file", 64);
    v09Output(await refreshStatus({
      commonDir: git.commonDir,
      refreshId: values["refresh-id"] ?? null,
    }));
    return;
  }
  if (subcommand === "observe-private") {
    if (values.file !== undefined || values["refresh-id"] === undefined) {
      throw new CliError("refresh observe-private requires --refresh-id and accepts no --file", 64);
    }
    v09Output(await observeRefreshPrivateArchives({
      commonDir: git.commonDir,
      refreshId: requireText(values["refresh-id"], "--refresh-id", { max: 128, safeId: true }),
    }));
    return;
  }
  if (!values.file) throw new CliError(`refresh ${subcommand} requires --file <request.json>`);
  const request = await readJsonInput(values.file);
  if (subcommand === "prepare") {
    requireExactFields(request, {
      required: [
        "source_namespace", "source_run_id", "source_resume", "decisions", "replacements",
        "target_workflow", "target_fences", "target_coordinator_thread_id",
      ],
      optional: [],
    }, "refresh prepare request");
    const preparedAt = new Date().toISOString();
    const fences = activationFences(request.target_fences);
    v09Output(await prepareRefresh({
      commonDir: git.commonDir,
      sourceNamespace: request.source_namespace,
      sourceRunId: request.source_run_id,
      sourceResume: request.source_resume,
      decisions: request.decisions,
      replacements: request.replacements,
      targetWorkflow: request.target_workflow,
      targetFences: fences,
      targetCoordinatorThreadId: request.target_coordinator_thread_id,
      targetAuthority,
      preparedAt,
      cwd: process.cwd(),
    }));
    return;
  }
  requireExactFields(request, {
    required: ["refresh_id", "expected_handoff_digest", "archive_evidence"],
    optional: [],
  }, "refresh apply request");
  if (values["refresh-id"] !== undefined && values["refresh-id"] !== request.refresh_id) {
    throw new CliError("refresh apply --refresh-id does not match request.refresh_id", 73);
  }
  v09Output(await applyRefresh({
    commonDir: git.commonDir,
    refreshId: request.refresh_id,
    expectedHandoffDigest: request.expected_handoff_digest,
    archiveEvidence: request.archive_evidence,
    appliedAt: new Date().toISOString(),
  }));
}

function isV09RunBoundMutation(command, args) {
  const subcommand = args[0];
  if (command === "workflow") return ["create", "revise", "contract"].includes(subcommand);
  if (command === "task") {
    return subcommand === "launch" && ["prepare", "attempt", "reconcile", "start"].includes(args[1]);
  }
  if (command === "subagent") {
    return ["prepare", "attempt", "reconcile", "complete", "dispose"].includes(subcommand);
  }
  if (command === "callback") return ["deliver", "observe"].includes(subcommand);
  if (command === "urgent") return [
    "persist", "attempt", "reconcile", "observe", "consume", "expire",
  ].includes(subcommand);
  if (command === "disposition") return ["prepare", "finalize", "cancel"].includes(subcommand);
  if (command === "verification") return subcommand === "run";
  if (command === "integration") return ["prepare", "reconcile"].includes(subcommand);
  if (command === "archive") return ["prepare", "reconcile"].includes(subcommand);
  return false;
}

async function dispatchV09Command(command, args, handler) {
  if (!isV09RunBoundMutation(command, args)) return handler(args);
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
  if (runIds.length !== 1) throw new CliError("v0.9 mutations require exactly one --run-id", 64);
  const runId = requireText(runIds[0], "--run-id", { max: 128, safeId: true });
  const git = v09Repository();
  const allowLinkedWorktree = (
    (command === "task" && args[0] === "launch" && args[1] === "start")
    || (command === "callback" && args[0] === "deliver")
  );
  return guardedActiveRunMutation(
    git,
    runId,
    (authority) => handler(args, authority),
    { allowLinkedWorktree },
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    console.log(helpFor(command, args));
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(PACKAGE_VERSION);
    return;
  }
  if (command === "run") return commandRunV09(args);
  if (command === "workflow") return dispatchV09Command(command, args, commandWorkflowV09);
  if (command === "task") return dispatchV09Command(command, args, commandTaskV09);
  if (command === "subagent") return dispatchV09Command(command, args, commandSubagentV09);
  if (command === "callback") return dispatchV09Command(command, args, commandCallbackV09);
  if (command === "urgent") return dispatchV09Command(command, args, commandUrgentV09);
  if (command === "disposition") return dispatchV09Command(command, args, commandDispositionV09);
  if (command === "verification") return dispatchV09Command(command, args, commandVerificationV09);
  if (command === "integration") return dispatchV09Command(command, args, commandIntegrationV09);
  if (command === "archive") return dispatchV09Command(command, args, commandArchiveV09);
  if (command === "cleanup") return commandCleanupV09(args);
  if (command === "unplug") return commandUnplugV09(args);
  if (command === "refresh") return commandRefreshV09(args);
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
