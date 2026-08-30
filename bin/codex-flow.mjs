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
  stableStringify,
} from "../lib/core.mjs";
import { cleanupPlanV06 } from "../lib/cleanup-v06.mjs";
import { discoverGit, gitSnapshot } from "../lib/git.mjs";
import {
  LEGACY_V05_PACKAGE_VERSION,
  createLegacyV05ReadonlyContext,
  readLegacyV05ReadonlySummary,
} from "../lib/legacy-v05-readonly.mjs";
import {
  applyLegacyRetirementPlan,
  planLegacyRetirement,
} from "../lib/legacy-retirement-v06.mjs";
import {
  bindRecipient,
  rebindRecipient,
  recipientStatus,
} from "../lib/recipients.mjs";
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
  authenticateTaskReleaseExecutorWorktree,
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
  resolveNoChangeVerificationSubject,
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

const LEGACY_HELP = `codex-flow ${LEGACY_V05_PACKAGE_VERSION} legacy-v05

Read-only historical verification:
  codex-flow legacy-v05 status [--json]
  codex-flow legacy-v05 verify [--json]

The exact v0.5.1 verifier is isolated and read-only. Predecessor installation,
sync, doctor, task, callback, Git, lease, and cleanup commands are not packaged.
`;

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
  codex-flow adopt legacy-retire-plan|legacy-retire-apply --file request.json [--json]

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

function v06Output(value) {
  console.log(stableStringify(value, 2));
}

function shellArgument(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function assertRunBoundRuntimeExecution({ git, runId, requestFile, runtime }) {
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
  const requestPath = resolve(process.cwd(), requestFile);
  const recovery = [
    process.execPath,
    boundCli,
    "release",
    "accept",
    "--run-id",
    runId,
    "--file",
    requestPath,
    "--json",
  ].map(shellArgument).join(" ");
  throw new CliError([
    "Release acceptance must use the exact run-bound runtime.",
    `executing_bundle_sha256=${executing.bundle.bundle_sha256}`,
    `run_bound_bundle_sha256=${runBoundDigest}`,
    `runtime_context_digest=${runtimeContextHash(runtime)}`,
    `recovery_command=${recovery}`,
  ].join("\n"), 73);
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

async function activeRunAuthority(git, runId, planId = null, { allowLinkedWorktree = false } = {}) {
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
  ) throw new CliError("active run/runtime/repository authority is inconsistent", 73);
  if (!allowLinkedWorktree && runtime.repository.root !== git.root) {
    throw new CliError(
      "v0.6 mutation requires coordinator-only mutation authority from the exact coordinator checkout",
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
        namespace: "v0.6.3",
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

async function commandReleaseV06(args, mutationAuthority = null) {
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
    if (mutationAuthority === null) {
      throw new CliError("Release acceptance requires active mutation authority", 73);
    }
    await assertRunBoundRuntimeExecution({
      git,
      runId,
      requestFile: values.file,
      runtime: mutationAuthority.runtime,
    });
    const executor = await authenticateTaskReleaseExecutorWorktree({
      stateRoot: git.stateRoot,
      releaseId: request.release_id,
      repositoryPath: git.root,
    });
    if (
      executor.worktree.mode === "host-worktree"
      && !mutationAuthority.run.plan.branch_fences.includes(executor.worktree.executor_branch)
    ) {
      throw new CliError("Release acceptance executor branch is outside the active run reservation", 73);
    }
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
  const git = v06Repository();
  if (["legacy-retire-plan", "legacy-retire-apply"].includes(subcommand)) {
    if (values["run-id"] !== undefined) {
      throw new CliError(`adopt ${subcommand} is repository-scoped and does not accept --run-id`);
    }
    if (!values.file) throw new CliError(`adopt ${subcommand} requires --file <request.json>`);
    const request = await readJsonInput(values.file);
    if (subcommand === "legacy-retire-plan") {
      requireExactFields(request, { required: ["reason", "planned_at"] }, "adopt legacy-retire-plan request");
      v06Output({
        result: await planLegacyRetirement({
          repositoryRoot: git.root,
          reason: request.reason,
          plannedAt: request.planned_at,
        }),
      });
    } else {
      requireExactFields(request, { required: ["plan"] }, "adopt legacy-retire-apply request");
      v06Output({ result: await applyLegacyRetirementPlan({ repositoryRoot: git.root, plan: request.plan }) });
    }
    return;
  }
  const runId = explicitRunId(values);
  if (subcommand === "status") {
    await assertAdoptionRun(git, runId);
    v06Output({ run_id: runId, adoption: await readAdoption({ repositoryRoot: git.root }) });
    return;
  }
  const shapes = {
    plan: {
      required: ["adopted_at"],
      optional: ["config", "policy"],
    },
    apply: { required: ["plan"] },
    "retire-plan": { required: ["reason", "retired_at"] },
    "retire-apply": { required: ["plan"] },
  };
  if (!shapes[subcommand]) {
    throw new CliError(
      "adopt requires plan, apply, status, retire-plan, retire-apply, legacy-retire-plan, or legacy-retire-apply",
    );
  }
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

async function legacyReadonlyAuthority() {
  const context = createLegacyV05ReadonlyContext({ git: gitSnapshot() });
  const summary = await readLegacyV05ReadonlySummary(context);
  return { context, summary };
}

async function mainLegacyV05(argv) {
  const requestedAction = argv.find((argument) => !argument.startsWith("-"));
  if (requestedAction !== undefined && !["status", "verify"].includes(requestedAction)) {
    throw new CliError(
      `legacy-v05 is read-only historical verification; predecessor mutation and workflow commands are unavailable\n\n${LEGACY_HELP}`,
      64,
    );
  }
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    if (positionals.length > 0) throw new CliError("legacy-v05 --help does not accept an action", 64);
    console.log(LEGACY_HELP);
    return;
  }
  const action = positionals[0] ?? "status";
  if (positionals.length > 1 || !["status", "verify"].includes(action)) {
    throw new CliError(
      `legacy-v05 is read-only historical verification; predecessor mutation and workflow commands are unavailable\n\n${LEGACY_HELP}`,
      64,
    );
  }
  const { summary } = await legacyReadonlyAuthority();
  v06Output(summary);
  if (action === "verify" && !summary.ok) process.exitCode = 1;
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
  const allowLinkedWorktree = (
    (command === "release" && args[0] === "accept")
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
