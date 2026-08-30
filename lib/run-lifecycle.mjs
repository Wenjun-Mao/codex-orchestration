import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWriteJson,
  CliError,
  ensureDirectory,
  readJson,
  requireExactFields,
  requireInteger,
  requireObject,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { validateRepositoryRelativePath } from "./repository-paths-v06.mjs";
import {
  assertNoTrackedLegacyAuthority,
  readRuntimeContext,
  runtimeBindingFromContext,
  v06RuntimeRoot,
  validateRuntimeHost,
  validateRuntimeLineage,
} from "./runtime-context.mjs";
import {
  validateWorkflowPlanRevision,
  workflowReservationClaims,
} from "./workflow-plan.mjs";

export const V06_RUN_LIFECYCLE_SCHEMA_VERSION = 1;
export const V06_RUN_LIFECYCLE_KIND = "codex-flow-v06-run-lifecycle";
export const V06_RUN_ACTIVATION_KIND = "codex-flow-v06-run-activation";
export const V06_RUN_FENCE_SCHEMA_VERSION = 1;
export const V06_RUN_FENCE_KIND = "codex-flow-v06-run-fence";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const DIGEST = /^[0-9a-f]{64}$/;

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function validateTimestamp(value, label) {
  requireText(value, label, { max: 64 });
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return value;
}

function validateDigest(value, label) {
  requireText(value, label, { max: 64 });
  if (!DIGEST.test(value)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function sortedStrings(value) {
  return [...value].sort((left, right) => left.localeCompare(right));
}

function validateBranchFence(value, label) {
  requireText(value, label, { max: 256 });
  if (
    value.includes("\\")
    || /\s/.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new CliError(`${label} must be a normalized branch fence`);
  }
  return value;
}

export function validateFencePlan(value, label = "run fence") {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "path_fences", "resource_fences",
      "branch_fences",
    ],
  }, label);
  if (value.schema_version !== V06_RUN_FENCE_SCHEMA_VERSION) {
    throw new CliError(`${label}.schema_version must be ${V06_RUN_FENCE_SCHEMA_VERSION}`);
  }
  if (value.kind !== V06_RUN_FENCE_KIND) {
    throw new CliError(`${label}.kind must be ${V06_RUN_FENCE_KIND}`);
  }
  const paths = requireStringArray(value.path_fences, `${label}.path_fences`, {
    maxItems: 128,
    maxText: 512,
  }).map((path, index) => validateRepositoryRelativePath(path, `${label}.path_fences[${index}]`));
  const resources = requireStringArray(value.resource_fences, `${label}.resource_fences`, {
    maxItems: 128,
    maxText: 128,
    safeIds: true,
  });
  const branches = requireStringArray(value.branch_fences, `${label}.branch_fences`, {
    maxItems: 128,
    maxText: 256,
  }).map((branch, index) => validateBranchFence(branch, `${label}.branch_fences[${index}]`));
  return {
    schema_version: V06_RUN_FENCE_SCHEMA_VERSION,
    kind: V06_RUN_FENCE_KIND,
    path_fences: sortedStrings(paths),
    resource_fences: sortedStrings(resources),
    branch_fences: sortedStrings(branches),
  };
}

export function buildFencePlan({
  pathFences = [],
  resourceFences = [],
  branchFences = [],
} = {}) {
  return validateFencePlan({
    schema_version: V06_RUN_FENCE_SCHEMA_VERSION,
    kind: V06_RUN_FENCE_KIND,
    path_fences: pathFences,
    resource_fences: resourceFences,
    branch_fences: branchFences,
  });
}

export function emptyFencePlan() {
  return buildFencePlan();
}

export function fencePlanIsEmpty(value) {
  const plan = validateFencePlan(value);
  return (
    plan.path_fences.length === 0
    && plan.resource_fences.length === 0
    && plan.branch_fences.length === 0
  );
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function exactFenceConflicts(type, left, right) {
  return left.flatMap((entry) => right
    .filter((candidate) => candidate === entry)
    .map((candidate) => ({ type, left: entry, right: candidate })));
}

export function fencePlanConflicts(left, right) {
  const expected = validateFencePlan(left, "left run fence");
  const candidate = validateFencePlan(right, "right run fence");
  return [
    ...expected.path_fences.flatMap((path) => candidate.path_fences
      .filter((other) => pathsOverlap(path, other))
      .map((other) => ({ type: "path", left: path, right: other }))),
    ...exactFenceConflicts("resource", expected.resource_fences, candidate.resource_fences),
    ...exactFenceConflicts("branch", expected.branch_fences, candidate.branch_fences),
  ];
}

export function fencePlansAreDisjoint(left, right) {
  return fencePlanConflicts(left, right).length === 0;
}

export function assertWorkflowReservationCovered(planned, workflowRevision) {
  const source = validateFencePlan(planned, "admitted run fence");
  const claims = workflowReservationClaims(workflowRevision);
  const uncoveredPath = claims.path_fences.find((path) => !source.path_fences.some(
    (plannedPath) => path === plannedPath || path.startsWith(`${plannedPath}/`),
  ));
  if (uncoveredPath !== undefined) {
    throw new CliError(`Workflow write path is outside the admitted run fence envelope: ${uncoveredPath}`);
  }
  const uncoveredResource = claims.resource_fences.find(
    (resource) => !source.resource_fences.includes(resource),
  );
  if (uncoveredResource !== undefined) {
    throw new CliError(`Workflow shared resource is outside the admitted run fence envelope: ${uncoveredResource}`);
  }
  return claims;
}

function validateRunBinding(value, label = "run binding") {
  requireExactFields(value, {
    required: [
      "runtime_context_hash", "bundle_hash", "config_hash", "policy_hash",
      "repository_hash", "host", "lineage", "generation", "fence_token",
    ],
  }, label);
  return {
    runtime_context_hash: validateDigest(value.runtime_context_hash, `${label}.runtime_context_hash`),
    bundle_hash: validateDigest(value.bundle_hash, `${label}.bundle_hash`),
    config_hash: validateDigest(value.config_hash, `${label}.config_hash`),
    policy_hash: validateDigest(value.policy_hash, `${label}.policy_hash`),
    repository_hash: validateDigest(value.repository_hash, `${label}.repository_hash`),
    host: validateRuntimeHost(value.host, `${label}.host`),
    lineage: validateRuntimeLineage(value.lineage, `${label}.lineage`),
    generation: requireInteger(value.generation, `${label}.generation`, {
      min: 1,
      max: 2147483647,
    }),
    fence_token: validateDigest(value.fence_token, `${label}.fence_token`),
  };
}

function fenceTokenFor({ runId, runtimeId, binding }) {
  const withoutToken = {
    runtime_context_hash: binding.runtime_context_hash,
    bundle_hash: binding.bundle_hash,
    config_hash: binding.config_hash,
    policy_hash: binding.policy_hash,
    repository_hash: binding.repository_hash,
    host: binding.host,
    lineage: binding.lineage,
    generation: binding.generation,
  };
  return sha256(stableStringify({
    run_id: runId,
    runtime_id: runtimeId,
    binding: withoutToken,
  }));
}

function validateTerminal(value, status, label) {
  if (status === "active") {
    if (value !== null) throw new CliError(`${label} must be null for an active run`);
    return null;
  }
  requireObject(value, label);
  if (status === "closed") {
    requireExactFields(value, {
      required: ["kind", "closed_at", "unresolved_fences"],
    }, label);
    if (value.kind !== "closed") throw new CliError(`${label}.kind must be closed`);
    const unresolved = validateFencePlan(value.unresolved_fences, `${label}.unresolved_fences`);
    if (!fencePlanIsEmpty(unresolved)) {
      throw new CliError("closed runs cannot retain unresolved fences");
    }
    return {
      kind: "closed",
      closed_at: validateTimestamp(value.closed_at, `${label}.closed_at`),
      unresolved_fences: unresolved,
    };
  }
  requireExactFields(value, {
    required: ["kind", "abandoned_at", "reason", "unresolved_fences"],
  }, label);
  if (value.kind !== "abandoned") throw new CliError(`${label}.kind must be abandoned`);
  const unresolved = validateFencePlan(value.unresolved_fences, `${label}.unresolved_fences`);
  return {
    kind: "abandoned",
    abandoned_at: validateTimestamp(value.abandoned_at, `${label}.abandoned_at`),
    reason: requireText(value.reason, `${label}.reason`, { max: 512 }),
    unresolved_fences: unresolved,
  };
}

function validateRebindHistory(value, label) {
  if (!Array.isArray(value) || value.length > 128) {
    throw new CliError(`${label} must contain at most 128 rebind records`);
  }
  return value.map((entry, index) => {
    requireExactFields(entry, {
      required: ["from", "to", "rebound_at"],
    }, `${label}[${index}]`);
    return {
      from: validateRunBinding(entry.from, `${label}[${index}].from`),
      to: validateRunBinding(entry.to, `${label}[${index}].to`),
      rebound_at: validateTimestamp(entry.rebound_at, `${label}[${index}].rebound_at`),
    };
  });
}

export function validateRunActivation(value, label = "run activation") {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "run_id", "runtime_id", "runtime_context_hash",
      "workflow_plan_id", "workflow_revision_digest", "status", "plan", "binding",
      "rebind_history", "admitted_at", "updated_at", "terminal",
    ],
  }, label);
  if (value.schema_version !== V06_RUN_LIFECYCLE_SCHEMA_VERSION) {
    throw new CliError(`${label}.schema_version must be ${V06_RUN_LIFECYCLE_SCHEMA_VERSION}`);
  }
  if (value.kind !== V06_RUN_ACTIVATION_KIND) {
    throw new CliError(`${label}.kind must be ${V06_RUN_ACTIVATION_KIND}`);
  }
  const status = value.status;
  if (!["active", "closed", "abandoned"].includes(status)) {
    throw new CliError(`${label}.status must be active, closed, or abandoned`);
  }
  const activation = {
    schema_version: V06_RUN_LIFECYCLE_SCHEMA_VERSION,
    kind: V06_RUN_ACTIVATION_KIND,
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_id: validateDigest(value.runtime_id, `${label}.runtime_id`),
    runtime_context_hash: validateDigest(value.runtime_context_hash, `${label}.runtime_context_hash`),
    workflow_plan_id: requireText(value.workflow_plan_id, `${label}.workflow_plan_id`, {
      max: 128,
      safeId: true,
    }),
    workflow_revision_digest: validateDigest(
      value.workflow_revision_digest,
      `${label}.workflow_revision_digest`,
    ),
    status,
    plan: validateFencePlan(value.plan, `${label}.plan`),
    binding: validateRunBinding(value.binding, `${label}.binding`),
    rebind_history: validateRebindHistory(value.rebind_history, `${label}.rebind_history`),
    admitted_at: validateTimestamp(value.admitted_at, `${label}.admitted_at`),
    updated_at: validateTimestamp(value.updated_at, `${label}.updated_at`),
    terminal: validateTerminal(value.terminal, status, `${label}.terminal`),
  };
  if (activation.binding.runtime_context_hash !== activation.runtime_context_hash) {
    throw new CliError(`${label}.binding.runtime_context_hash must match runtime_context_hash`);
  }
  if (activation.binding.fence_token !== fenceTokenFor({
    runId: activation.run_id,
    runtimeId: activation.runtime_id,
    binding: activation.binding,
  })) {
    throw new CliError(`${label}.binding.fence_token does not match the current run binding`);
  }
  if (activation.binding.generation !== activation.rebind_history.length + 1) {
    throw new CliError(`${label}.binding.generation must follow rebind_history`);
  }
  for (const [index, rebind] of activation.rebind_history.entries()) {
    if (
      rebind.from.generation !== index + 1
      || rebind.to.generation !== index + 2
      || rebind.from.runtime_context_hash !== activation.runtime_context_hash
      || rebind.to.runtime_context_hash !== activation.runtime_context_hash
    ) {
      throw new CliError(`${label}.rebind_history must be an ordered binding fence chain`);
    }
    if (rebind.from.fence_token !== fenceTokenFor({
      runId: activation.run_id,
      runtimeId: activation.runtime_id,
      binding: rebind.from,
    }) || rebind.to.fence_token !== fenceTokenFor({
      runId: activation.run_id,
      runtimeId: activation.runtime_id,
      binding: rebind.to,
    })) {
      throw new CliError(`${label}.rebind_history contains an invalid binding fence token`);
    }
    if (
      index > 0
      && stableStringify(activation.rebind_history[index - 1].to) !== stableStringify(rebind.from)
    ) {
      throw new CliError(`${label}.rebind_history is not contiguous`);
    }
  }
  if (activation.rebind_history.length > 0) {
    const latest = activation.rebind_history.at(-1).to;
    if (stableStringify(latest) !== stableStringify(activation.binding)) {
      throw new CliError(`${label}.binding must match the latest rebind target`);
    }
  }
  return activation;
}

function emptyLifecycleState() {
  return {
    schema_version: V06_RUN_LIFECYCLE_SCHEMA_VERSION,
    kind: V06_RUN_LIFECYCLE_KIND,
    active_run_id: null,
    runs: {},
  };
}

export function validateRunLifecycleState(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "active_run_id", "runs"],
  }, "run lifecycle state");
  if (value.schema_version !== V06_RUN_LIFECYCLE_SCHEMA_VERSION) {
    throw new CliError(`run lifecycle state.schema_version must be ${V06_RUN_LIFECYCLE_SCHEMA_VERSION}`);
  }
  if (value.kind !== V06_RUN_LIFECYCLE_KIND) {
    throw new CliError(`run lifecycle state.kind must be ${V06_RUN_LIFECYCLE_KIND}`);
  }
  if (value.active_run_id !== null) {
    requireText(value.active_run_id, "run lifecycle state.active_run_id", { max: 128, safeId: true });
  }
  requireObject(value.runs, "run lifecycle state.runs");
  const entries = Object.entries(value.runs);
  if (entries.length > 128) throw new CliError("run lifecycle state contains too many runs");
  const runs = Object.fromEntries(entries.map(([runId, activation]) => {
    requireText(runId, "run lifecycle state run id", { max: 128, safeId: true });
    const validated = validateRunActivation(activation, `run lifecycle state.runs.${runId}`);
    if (validated.run_id !== runId) {
      throw new CliError("run lifecycle state record key must match run_id");
    }
    return [runId, validated];
  }));
  const active = Object.values(runs).filter((run) => run.status === "active");
  if (value.active_run_id === null && active.length !== 0) {
    throw new CliError("run lifecycle state must point at its active run");
  }
  if (value.active_run_id !== null) {
    if (active.length !== 1 || active[0].run_id !== value.active_run_id) {
      throw new CliError("run lifecycle state active_run_id must identify its only active run");
    }
  }
  return {
    schema_version: V06_RUN_LIFECYCLE_SCHEMA_VERSION,
    kind: V06_RUN_LIFECYCLE_KIND,
    active_run_id: value.active_run_id,
    runs,
  };
}

export function runLifecyclePath(gitCommonDirectory) {
  return join(v06RuntimeRoot(gitCommonDirectory), "runs", "lifecycle.json");
}

function lifecycleLockPath(gitCommonDirectory) {
  return join(v06RuntimeRoot(gitCommonDirectory), "locks", "run-lifecycle.lock");
}

function activeRunMutationLockPath(gitCommonDirectory, runId) {
  return join(
    v06RuntimeRoot(gitCommonDirectory),
    "locks",
    "active-run-mutations",
    `${runId}.lock.json`,
  );
}

async function prepareLifecycleRoot(gitCommonDirectory) {
  const commonDir = resolve(gitCommonDirectory);
  await assertNoSymlinkComponents(commonDir, commonDir, "Git common directory");
  await ensureDirectory(v06RuntimeRoot(commonDir), {
    guardRoot: commonDir,
    mode: 0o700,
  });
  return commonDir;
}

async function loadLifecycleState(commonDir) {
  const raw = await readJson(runLifecyclePath(commonDir), {
    allowMissing: true,
    guardRoot: commonDir,
  });
  return raw === null ? emptyLifecycleState() : validateRunLifecycleState(raw);
}

async function updateLifecycleState(gitCommonDirectory, operation) {
  const commonDir = await prepareLifecycleRoot(gitCommonDirectory);
  return withProcessLock({
    path: lifecycleLockPath(commonDir),
    guardRoot: commonDir,
    label: "v0.6 run lifecycle",
  }, async () => {
    const state = await loadLifecycleState(commonDir);
    const result = await operation(state, commonDir);
    if (result?.state) {
      const next = validateRunLifecycleState(result.state);
      await atomicWriteJson(runLifecyclePath(commonDir), next, {
        guardRoot: commonDir,
        mode: 0o600,
      });
      return result.value;
    }
    return result;
  });
}

function runBindingFor(runId, runtimeId, context) {
  const base = runtimeBindingFromContext(context);
  const binding = {
    ...base,
    generation: 1,
    fence_token: "",
  };
  return {
    ...binding,
    fence_token: fenceTokenFor({ runId, runtimeId, binding }),
  };
}

function assertActiveRun(state, runId) {
  const run = state.runs[runId];
  if (!run) throw new CliError(`Unknown v0.6 run: ${runId}`);
  if (state.active_run_id !== runId || run.status !== "active") {
    throw new CliError(`v0.6 run is not active: ${runId}`);
  }
  return run;
}

// Public run-bound commands use this lock to serialize their durable mutations
// with audited closure. The active assertion happens after lock acquisition, so
// a command that waited behind closure cannot mutate a run that is now terminal.
export async function withActiveRunMutation({ gitCommonDirectory, runId }, operation) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  if (typeof operation !== "function") {
    throw new CliError("withActiveRunMutation requires an operation callback");
  }
  const commonDir = await prepareLifecycleRoot(gitCommonDirectory);
  return withProcessLock({
    path: activeRunMutationLockPath(commonDir, safeRunId),
    guardRoot: commonDir,
    label: `v0.6 active run mutation ${safeRunId}`,
  }, async () => {
    const state = await loadLifecycleState(commonDir);
    const run = assertActiveRun(state, safeRunId);
    return operation({
      run: clone(run),
      commonDir,
      path: runLifecyclePath(commonDir),
    });
  });
}

function assertResume(run, resume) {
  const expected = validateRunBinding(resume, "resume fence");
  if (stableStringify(expected) !== stableStringify(run.binding)) {
    throw new CliError("resume fence does not match the active run binding");
  }
  return expected;
}

function exactActivationMatches(run, {
  runtimeId,
  runtimeContextHash,
  workflowPlanId,
  workflowRevisionDigest,
  plan,
}) {
  return (
    run.runtime_id === runtimeId
    && run.runtime_context_hash === runtimeContextHash
    && run.workflow_plan_id === workflowPlanId
    && run.workflow_revision_digest === workflowRevisionDigest
    && stableStringify(run.plan) === stableStringify(plan)
  );
}

function retainedFenceConflicts(state, plan) {
  return Object.values(state.runs).flatMap((run) => {
    if (run.status !== "abandoned") return [];
    return fencePlanConflicts(run.terminal.unresolved_fences, plan)
      .map((conflict) => ({ run_id: run.run_id, ...conflict }));
  });
}

async function persistedActivationWorkflow({ commonDir, runId, planId, revisionDigest }) {
  const path = join(
    v06RuntimeRoot(commonDir),
    "workflows",
    runId,
    planId,
    "revisions",
    `${revisionDigest}.json`,
  );
  const raw = await readJson(path, { allowMissing: true, guardRoot: commonDir });
  if (raw === null) return null;
  const revision = validateWorkflowPlanRevision(raw);
  if (revision.plan_id !== planId || revision.revision_digest !== revisionDigest) {
    throw new CliError("Persisted activation workflow does not match its run authority");
  }
  return revision;
}

export async function admitRun({
  gitCommonDirectory,
  runId,
  runtimeId,
  workflowPlanId,
  workflowRevisionDigest,
  plan,
  admittedAt,
}) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const safeRuntimeId = requireText(runtimeId, "runtimeId", { max: 128, safeId: true });
  const safeWorkflowPlanId = requireText(workflowPlanId, "workflowPlanId", {
    max: 128,
    safeId: true,
  });
  const workflowRevision = validateDigest(workflowRevisionDigest, "workflowRevisionDigest");
  const normalizedPlan = validateFencePlan(plan);
  const timestamp = validateTimestamp(admittedAt, "admittedAt");
  const { context } = await readRuntimeContext({
    gitCommonDirectory,
    runtimeId: safeRuntimeId,
  });
  await assertNoTrackedLegacyAuthority(context.repository.root);
  const binding = runBindingFor(safeRunId, safeRuntimeId, context);
  const persistedWorkflow = await persistedActivationWorkflow({
    commonDir: resolve(gitCommonDirectory),
    runId: safeRunId,
    planId: safeWorkflowPlanId,
    revisionDigest: workflowRevision,
  });
  if (persistedWorkflow !== null) {
    assertWorkflowReservationCovered(normalizedPlan, persistedWorkflow);
  }
  return updateLifecycleState(gitCommonDirectory, async (state, commonDir) => {
    if (state.active_run_id !== null) {
      const active = state.runs[state.active_run_id];
      if (
        active.run_id === safeRunId
        && exactActivationMatches(active, {
          runtimeId: safeRuntimeId,
          runtimeContextHash: binding.runtime_context_hash,
          workflowPlanId: safeWorkflowPlanId,
          workflowRevisionDigest: workflowRevision,
          plan: normalizedPlan,
        })
      ) {
        return {
          status: "already-active",
          run: clone(active),
          path: runLifecyclePath(commonDir),
        };
      }
      if (active.run_id === safeRunId) {
        throw new CliError(`v0.6 run admission does not match its immutable activation: ${safeRunId}`);
      }
      throw new CliError(`A different v0.6 run is already active: ${state.active_run_id}`);
    }
    if (state.runs[safeRunId]) {
      throw new CliError(`v0.6 run id has already been used: ${safeRunId}`);
    }
    const conflicts = retainedFenceConflicts(state, normalizedPlan);
    if (conflicts.length > 0) {
      throw new CliError(`Run plan conflicts with retained fences from ${conflicts[0].run_id}`);
    }
    const run = validateRunActivation({
      schema_version: V06_RUN_LIFECYCLE_SCHEMA_VERSION,
      kind: V06_RUN_ACTIVATION_KIND,
      run_id: safeRunId,
      runtime_id: safeRuntimeId,
      runtime_context_hash: binding.runtime_context_hash,
      workflow_plan_id: safeWorkflowPlanId,
      workflow_revision_digest: workflowRevision,
      status: "active",
      plan: normalizedPlan,
      binding,
      rebind_history: [],
      admitted_at: timestamp,
      updated_at: timestamp,
      terminal: null,
    });
    return {
      state: {
        ...state,
        active_run_id: safeRunId,
        runs: { ...state.runs, [safeRunId]: run },
      },
      value: {
        status: "admitted",
        run: clone(run),
        path: runLifecyclePath(commonDir),
      },
    };
  });
}

export async function readRunLifecycle({ gitCommonDirectory }) {
  const commonDir = await prepareLifecycleRoot(gitCommonDirectory);
  const state = await loadLifecycleState(commonDir);
  return {
    state: clone(state),
    path: runLifecyclePath(commonDir),
  };
}

export async function readRun({ gitCommonDirectory, runId }) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const { state, path } = await readRunLifecycle({ gitCommonDirectory });
  const run = state.runs[safeRunId];
  if (!run) throw new CliError(`Unknown v0.6 run: ${safeRunId}`);
  return { run: clone(run), path };
}

export async function resumeRun({ gitCommonDirectory, runId, resume }) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const { run, path } = await readRun({ gitCommonDirectory, runId: safeRunId });
  if (run.status !== "active") throw new CliError(`v0.6 run is not active: ${safeRunId}`);
  assertResume(run, resume);
  return {
    run,
    path,
    resume: clone(run.binding),
  };
}

export async function rebindRun({
  gitCommonDirectory,
  runId,
  resume,
  next,
  reboundAt,
}) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  requireExactFields(next, { required: ["host", "lineage"] }, "next binding");
  const nextHost = validateRuntimeHost(next.host, "next binding.host");
  const nextLineage = validateRuntimeLineage(next.lineage, "next binding.lineage");
  const timestamp = validateTimestamp(reboundAt, "reboundAt");
  return updateLifecycleState(gitCommonDirectory, async (state, commonDir) => {
    const current = assertActiveRun(state, safeRunId);
    assertResume(current, resume);
    if (
      stableStringify(current.binding.host) === stableStringify(nextHost)
      && stableStringify(current.binding.lineage) === stableStringify(nextLineage)
    ) {
      throw new CliError("next binding must change the host or lineage");
    }
    const nextBinding = {
      ...current.binding,
      host: nextHost,
      lineage: nextLineage,
      generation: current.binding.generation + 1,
      fence_token: "",
    };
    nextBinding.fence_token = fenceTokenFor({
      runId: current.run_id,
      runtimeId: current.runtime_id,
      binding: nextBinding,
    });
    const run = validateRunActivation({
      ...current,
      binding: nextBinding,
      rebind_history: [
        ...current.rebind_history,
        {
          from: current.binding,
          to: nextBinding,
          rebound_at: timestamp,
        },
      ],
      updated_at: timestamp,
    });
    return {
      state: {
        ...state,
        runs: { ...state.runs, [safeRunId]: run },
      },
      value: {
        run: clone(run),
        path: runLifecyclePath(commonDir),
        resume: clone(run.binding),
      },
    };
  });
}

// Low-level persistence primitive. A caller must first derive a repository-wide
// terminal audit from authoritative workflow, callback, disposition,
// integration, and archive records. The public CLI must not expose this
// function as an unaudited close operation.
export async function closeRun({
  gitCommonDirectory,
  runId,
  resume,
  closedAt,
}) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const timestamp = validateTimestamp(closedAt, "closedAt");
  return updateLifecycleState(gitCommonDirectory, async (state, commonDir) => {
    const current = assertActiveRun(state, safeRunId);
    assertResume(current, resume);
    const run = validateRunActivation({
      ...current,
      status: "closed",
      updated_at: timestamp,
      terminal: {
        kind: "closed",
        closed_at: timestamp,
        unresolved_fences: emptyFencePlan(),
      },
    });
    return {
      state: {
        ...state,
        active_run_id: null,
        runs: { ...state.runs, [safeRunId]: run },
      },
      value: {
        run: clone(run),
        path: runLifecyclePath(commonDir),
      },
    };
  });
}

export async function abandonRun({
  gitCommonDirectory,
  runId,
  resume,
  reason,
  abandonedAt,
}) {
  const safeRunId = requireText(runId, "runId", { max: 128, safeId: true });
  const timestamp = validateTimestamp(abandonedAt, "abandonedAt");
  const abandonmentReason = requireText(reason, "reason", { max: 512 });
  return updateLifecycleState(gitCommonDirectory, async (state, commonDir) => {
    const current = assertActiveRun(state, safeRunId);
    assertResume(current, resume);
    const run = validateRunActivation({
      ...current,
      status: "abandoned",
      updated_at: timestamp,
      terminal: {
        kind: "abandoned",
        abandoned_at: timestamp,
        reason: abandonmentReason,
        unresolved_fences: current.plan,
      },
    });
    return {
      state: {
        ...state,
        active_run_id: null,
        runs: { ...state.runs, [safeRunId]: run },
      },
      value: {
        run: clone(run),
        path: runLifecyclePath(commonDir),
      },
    };
  });
}

export async function retainedRunFences({ gitCommonDirectory }) {
  const { state } = await readRunLifecycle({ gitCommonDirectory });
  return Object.values(state.runs)
    .filter((run) => run.status === "abandoned")
    .map((run) => ({
      run_id: run.run_id,
      unresolved_fences: clone(run.terminal.unresolved_fences),
    }))
    .sort((left, right) => left.run_id.localeCompare(right.run_id));
}

export async function listRunLifecycleFiles({ gitCommonDirectory }) {
  const commonDir = await prepareLifecycleRoot(gitCommonDirectory);
  const root = join(v06RuntimeRoot(commonDir), "runs");
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}
