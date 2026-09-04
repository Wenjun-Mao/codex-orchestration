import { isAbsolute, resolve } from "node:path";
import {
  CliError,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireNullableText,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { REASONING_EFFORTS, validateSelectorRationale } from "./selector-contract.mjs";
import { normalizeOwnedPath } from "./repository-paths.mjs";

export const WORKFLOW_PLAN_SCHEMA_VERSION = 1;
export const GENERATED_TASK_CONTRACT_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CONCRETE_REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const INSTRUMENT_ROLES = ["none", "supporting", "primary-deliverable"];
const SUBAGENT_STATES = ["prepared", "created", "completed", "accepted", "rejected"];
const ACCEPTED_DISPOSITIONS = ["accepted-no-change", "accepted-for-integration"];

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireConcreteRevision(value, label) {
  if (typeof value !== "string" || !CONCRETE_REVISION_PATTERN.test(value)) {
    throw new CliError(`${label} must be a concrete lowercase Git revision`);
  }
  return value;
}

function requireTimestamp(value, label) {
  const timestamp = requireText(value, label, { max: 64 });
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return timestamp;
}

function requireAbsolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

export function coordinatorBindingDigest(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation"],
    optional: ["binding_digest"],
  }, "coordinator_binding");
  const binding = {
    lineage_id: requireText(value.lineage_id, "coordinator_binding.lineage_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "coordinator_binding.thread_id", { max: 256, safeId: true }),
    generation: requireInteger(value.generation, "coordinator_binding.generation", {
      min: 1,
      max: 2147483647,
    }),
  };
  return sha256(stableStringify(binding));
}

function validateCoordinatorBinding(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, "coordinator_binding");
  const binding = {
    lineage_id: requireText(value.lineage_id, "coordinator_binding.lineage_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "coordinator_binding.thread_id", { max: 256, safeId: true }),
    generation: requireInteger(value.generation, "coordinator_binding.generation", {
      min: 1,
      max: 2147483647,
    }),
    binding_digest: requireDigest(value.binding_digest, "coordinator_binding.binding_digest"),
  };
  const expected = coordinatorBindingDigest(binding);
  if (binding.binding_digest !== expected) {
    throw new CliError("coordinator_binding.binding_digest does not match the coordinator identity");
  }
  return binding;
}

function validateContractAuthority(value) {
  requireExactFields(value, {
    required: [
      "run_id", "runtime_context_digest", "configuration_digest",
      "repository_id", "common_dir", "coordinator_binding",
    ],
  }, "task contract authority");
  return {
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_context_digest: requireDigest(value.runtime_context_digest, "runtime_context_digest"),
    configuration_digest: requireDigest(value.configuration_digest, "configuration_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: requireAbsolutePath(value.common_dir, "common_dir"),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
  };
}

function normalizePaths(value, label, { allowEmpty = true } = {}) {
  const paths = requireStringArray(value, label, { maxItems: 128, maxText: 512, allowEmpty })
    .map((path, index) => normalizeOwnedPath(path, `${label}[${index}]`))
    .sort();
  if (new Set(paths).size !== paths.length) throw new CliError(`${label} contains equivalent duplicate paths`);
  return paths;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateForkTurns(value, label) {
  if (value === "none" || (typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value))) {
    return value;
  }
  throw new CliError(`${label} must explicitly be none or a positive integer string`);
}

function validateSupportingFollowUp(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["kind"],
    optional: ["task_id", "reason"],
  }, label);
  if (value.kind === "direct-attempt") {
    if (Object.hasOwn(value, "reason")) throw new CliError(`${label}.direct-attempt does not allow reason`);
    return {
      kind: "direct-attempt",
      task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    };
  }
  if (value.kind === "pause-replan") {
    if (Object.hasOwn(value, "task_id")) throw new CliError(`${label}.pause-replan does not allow task_id`);
    return {
      kind: "pause-replan",
      reason: requireText(value.reason, `${label}.reason`, { max: 512 }),
    };
  }
  throw new CliError(`${label}.kind must be direct-attempt or pause-replan`);
}

function validateSupportingAuthorization(value, label) {
  if (value === null) return null;
  requireExactFields(value, { required: ["authorized_revision", "reason"] }, label);
  return {
    authorized_revision: requireInteger(value.authorized_revision, `${label}.authorized_revision`, {
      min: 2,
      max: 2147483647,
    }),
    reason: requireText(value.reason, `${label}.reason`, { max: 512 }),
  };
}

function validateWorkflowTask(value, index) {
  const label = `tasks[${index}]`;
  requireExactFields(value, {
    required: [
      "task_id",
      "title",
      "execution_kind",
      "mode",
      "model",
      "reasoning_effort",
      "selector_rationale",
      "fork_turns",
      "dependencies",
      "read_paths",
      "write_paths",
      "shared_resources",
      "primary_outcome",
      "causal_question",
      "cheapest_safe_direct_attempt",
      "instrument_role",
      "supporting_follow_up",
      "supporting_authorization",
    ],
  }, label);

  const executionKind = requireEnum(value.execution_kind, ["task-thread", "subagent"], `${label}.execution_kind`);
  const mode = requireEnum(value.mode, ["read", "write"], `${label}.mode`);
  const forkTurns = value.fork_turns === null ? null : validateForkTurns(value.fork_turns, `${label}.fork_turns`);
  if (executionKind === "task-thread" && forkTurns !== null) {
    throw new CliError(`${label}.fork_turns must be null for a task-thread`);
  }
  if (executionKind === "subagent" && mode !== "read") {
    throw new CliError(`${label}.mode must be read for a native subagent`);
  }
  if (executionKind === "subagent" && forkTurns === null) {
    throw new CliError(`${label}.fork_turns is required for a native subagent`);
  }
  const reasoningEffort = requireEnum(value.reasoning_effort, REASONING_EFFORTS.filter((item) => item !== null), `${label}.reasoning_effort`);
  if (executionKind === "subagent" && reasoningEffort === "ultra") {
    throw new CliError(`${label}.reasoning_effort ultra is forbidden for a native subagent`);
  }

  const readPaths = normalizePaths(value.read_paths, `${label}.read_paths`);
  const writePaths = normalizePaths(value.write_paths, `${label}.write_paths`);
  const sharedResources = requireStringArray(value.shared_resources, `${label}.shared_resources`, {
    maxItems: 128,
    maxText: 128,
    safeIds: true,
  }).sort();
  if (new Set(sharedResources).size !== sharedResources.length) {
    throw new CliError(`${label}.shared_resources contains duplicates`);
  }
  if (mode === "read" && writePaths.length !== 0) throw new CliError(`${label} is read-only but declares write paths`);
  if (mode === "write" && writePaths.length === 0) throw new CliError(`${label} must declare write paths`);
  for (let left = 0; left < writePaths.length; left += 1) {
    for (let right = left + 1; right < writePaths.length; right += 1) {
      if (pathsOverlap(writePaths[left], writePaths[right])) {
        throw new CliError(`${label}.write_paths contains overlapping paths`);
      }
    }
  }

  return {
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    title: requireText(value.title, `${label}.title`, { max: 160 }),
    execution_kind: executionKind,
    mode,
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: reasoningEffort,
    selector_rationale: validateSelectorRationale(
      value.selector_rationale,
      `${label}.selector_rationale`,
    ),
    fork_turns: forkTurns,
    dependencies: requireStringArray(value.dependencies, `${label}.dependencies`, {
      maxItems: 128,
      maxText: 128,
      safeIds: true,
    }).sort(),
    read_paths: readPaths,
    write_paths: writePaths,
    shared_resources: sharedResources,
    primary_outcome: requireText(value.primary_outcome, `${label}.primary_outcome`, { max: 2000 }),
    causal_question: requireNullableText(value.causal_question, `${label}.causal_question`, { max: 2000 }),
    cheapest_safe_direct_attempt: requireText(
      value.cheapest_safe_direct_attempt,
      `${label}.cheapest_safe_direct_attempt`,
      { max: 2000 },
    ),
    instrument_role: requireEnum(value.instrument_role, INSTRUMENT_ROLES, `${label}.instrument_role`),
    supporting_follow_up: validateSupportingFollowUp(value.supporting_follow_up, `${label}.supporting_follow_up`),
    supporting_authorization: validateSupportingAuthorization(
      value.supporting_authorization,
      `${label}.supporting_authorization`,
    ),
  };
}

function assertNoCycle(tasksById, taskId, visiting = new Set(), complete = new Set()) {
  if (complete.has(taskId)) return;
  if (visiting.has(taskId)) throw new CliError(`Workflow plan dependency cycle includes ${taskId}`);
  visiting.add(taskId);
  for (const dependency of tasksById.get(taskId).dependencies) {
    assertNoCycle(tasksById, dependency, visiting, complete);
  }
  visiting.delete(taskId);
  complete.add(taskId);
}

function validateTaskRelationships(tasks, revision) {
  const tasksById = new Map();
  for (const task of tasks) {
    if (tasksById.has(task.task_id)) throw new CliError(`Duplicate workflow task id: ${task.task_id}`);
    tasksById.set(task.task_id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!tasksById.has(dependency)) throw new CliError(`Task ${task.task_id} has an unknown dependency: ${dependency}`);
      if (dependency === task.task_id) throw new CliError(`Task ${task.task_id} cannot depend on itself`);
    }
  }
  for (const task of tasks) assertNoCycle(tasksById, task.task_id);

  const dependencyClosure = new Map();
  function dependenciesOf(taskId) {
    if (dependencyClosure.has(taskId)) return dependencyClosure.get(taskId);
    const dependencies = new Set();
    for (const dependency of tasksById.get(taskId).dependencies) {
      dependencies.add(dependency);
      for (const transitive of dependenciesOf(dependency)) dependencies.add(transitive);
    }
    dependencyClosure.set(taskId, dependencies);
    return dependencies;
  }
  for (const task of tasks) dependenciesOf(task.task_id);

  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const first = tasks[left];
      const second = tasks[right];
      if (
        dependencyClosure.get(first.task_id).has(second.task_id)
        || dependencyClosure.get(second.task_id).has(first.task_id)
      ) continue;
      const conflicts = [
        ...first.write_paths.flatMap((path) => second.write_paths.map((other) => ["write/write", path, other])),
        ...first.write_paths.flatMap((path) => second.read_paths.map((other) => ["write/read", path, other])),
        ...second.write_paths.flatMap((path) => first.read_paths.map((other) => ["write/read", path, other])),
      ];
      const conflict = conflicts.find(([, path, other]) => pathsOverlap(path, other));
      if (conflict) {
        throw new CliError(
          `Unordered tasks ${first.task_id} and ${second.task_id} have overlapping ${conflict[0]} paths`,
        );
      }
      const sharedResources = first.shared_resources.filter(
        (resource) => second.shared_resources.includes(resource),
      );
      if (sharedResources.length > 0) {
        throw new CliError(
          `Unordered tasks ${first.task_id} and ${second.task_id} share exclusive resources: ${sharedResources.join(", ")}`,
        );
      }
    }
  }

  const supportingByFollowUp = new Map();
  for (const task of tasks) {
    if (task.instrument_role !== "supporting") {
      if (task.supporting_follow_up !== null || task.supporting_authorization !== null) {
        throw new CliError(`Task ${task.task_id} is not supporting instrumentation`);
      }
      continue;
    }
    if (task.supporting_follow_up === null) {
      throw new CliError(`Supporting task ${task.task_id} requires a direct follow-up or pause/replan`);
    }
    if (task.supporting_follow_up.kind !== "direct-attempt") continue;
    const target = tasksById.get(task.supporting_follow_up.task_id);
    if (!target) throw new CliError(`Supporting task ${task.task_id} has an unknown direct follow-up`);
    if (target.instrument_role === "supporting") {
      throw new CliError(`Supporting task ${task.task_id} must point to a direct attempt, not instrumentation`);
    }
    if (!target.dependencies.includes(task.task_id)) {
      throw new CliError(`Supporting task ${task.task_id} must be an immediate dependency of its direct attempt`);
    }
    const supporters = supportingByFollowUp.get(target.task_id) ?? [];
    supporters.push(task);
    supportingByFollowUp.set(target.task_id, supporters);
  }

  for (const [targetId, supporters] of supportingByFollowUp) {
    const unapproved = supporters.filter((task) => task.supporting_authorization === null);
    if (unapproved.length > 1) {
      throw new CliError(
        `Additional supporting instrumentation for ${targetId} requires explicit authorization in this later revision`,
      );
    }
    for (const additional of supporters.filter((task) => task.supporting_authorization !== null)) {
      const authorization = additional.supporting_authorization;
      if (
        revision === 1
        || authorization.authorized_revision !== revision
      ) {
        throw new CliError(
          `Additional supporting instrumentation for ${targetId} requires explicit authorization in this later revision`,
        );
      }
    }
  }
  return tasksById;
}

function revisionSeed(revision) {
  return {
    schema_version: revision.schema_version,
    plan_id: revision.plan_id,
    revision: revision.revision,
    parent_revision_digest: revision.parent_revision_digest,
    tasks: revision.tasks,
  };
}

function normalizeWorkflowPlan(value, { requireRevisionDigest }) {
  requireExactFields(value, {
    required: ["schema_version", "plan_id", "revision", "parent_revision_digest", "tasks"],
    optional: requireRevisionDigest ? ["revision_digest"] : ["revision_digest"],
  }, "Workflow plan revision");
  if (value.schema_version !== WORKFLOW_PLAN_SCHEMA_VERSION) {
    throw new CliError("Unsupported workflow plan schema_version");
  }
  const revision = requireInteger(value.revision, "revision", { min: 1, max: 2147483647 });
  const parentRevisionDigest = value.parent_revision_digest === null
    ? null
    : requireDigest(value.parent_revision_digest, "parent_revision_digest");
  if ((revision === 1) !== (parentRevisionDigest === null)) {
    throw new CliError("Revision one must have no parent revision digest; later revisions require one");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > 256) {
    throw new CliError("Workflow plan tasks must be a nonempty array with at most 256 entries");
  }
  const tasks = value.tasks.map(validateWorkflowTask).sort((left, right) => left.task_id.localeCompare(right.task_id));
  const normalized = {
    schema_version: WORKFLOW_PLAN_SCHEMA_VERSION,
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision,
    parent_revision_digest: parentRevisionDigest,
    tasks,
  };
  validateTaskRelationships(tasks, revision);
  const revisionDigest = sha256(stableStringify(revisionSeed(normalized)));
  if (Object.hasOwn(value, "revision_digest") && value.revision_digest !== revisionDigest) {
    throw new CliError("revision_digest does not match the canonical workflow plan revision");
  }
  if (requireRevisionDigest && !Object.hasOwn(value, "revision_digest")) {
    throw new CliError("Workflow plan revision requires revision_digest");
  }
  return { ...normalized, revision_digest: revisionDigest };
}

export function createWorkflowPlanRevision(draft) {
  const revision = normalizeWorkflowPlan(draft, { requireRevisionDigest: false });
  if (revision.revision !== 1) {
    throw new CliError("Use createNextWorkflowPlanRevision for a later workflow plan revision");
  }
  return revision;
}

export function validateWorkflowPlanRevision(value) {
  return normalizeWorkflowPlan(value, { requireRevisionDigest: true });
}

export function workflowReservationClaims(value) {
  const revision = validateWorkflowPlanRevision(value);
  return {
    path_fences: [...new Set(revision.tasks.flatMap((task) => task.write_paths))]
      .sort((left, right) => left.localeCompare(right)),
    resource_fences: [...new Set(revision.tasks.flatMap((task) => task.shared_resources))]
      .sort((left, right) => left.localeCompare(right)),
  };
}

function validateStartedTaskContracts(value, previous) {
  if (!Array.isArray(value)) {
    throw new CliError("started_task_contracts must be an array of persisted generated task contracts");
  }
  const tasksById = new Map(previous.tasks.map((task) => [task.task_id, task]));
  const started = new Map();
  for (const [index, input] of value.entries()) {
    const contract = validateGeneratedTaskContract(input);
    if (contract.plan_id !== previous.plan_id || contract.revision_digest !== previous.revision_digest) {
      throw new CliError(`started_task_contracts[${index}] belongs to a different workflow revision`);
    }
    const task = tasksById.get(contract.task_id);
    if (!task || stableStringify(task) !== stableStringify(contract.task)) {
      throw new CliError(`started_task_contracts[${index}] does not bind a previous workflow task`);
    }
    if (started.has(contract.task_id)) {
      throw new CliError("started_task_contracts contains duplicate task IDs");
    }
    started.set(contract.task_id, contract);
  }
  return started;
}

export function createNextWorkflowPlanRevision({ previous_revision, draft, started_task_contracts }) {
  requireExactFields(
    { previous_revision, draft, started_task_contracts },
    { required: ["previous_revision", "draft", "started_task_contracts"] },
    "Workflow plan revision update",
  );
  const previous = validateWorkflowPlanRevision(previous_revision);
  const started = validateStartedTaskContracts(started_task_contracts, previous);
  const next = normalizeWorkflowPlan(draft, { requireRevisionDigest: false });
  if (next.plan_id !== previous.plan_id) throw new CliError("Workflow plan revisions must retain plan_id");
  if (next.revision !== previous.revision + 1) throw new CliError("Workflow plan revision must increment by one");
  if (next.parent_revision_digest !== previous.revision_digest) {
    throw new CliError("Workflow plan revision must name the exact previous revision digest");
  }
  const nextTasks = new Map(next.tasks.map((task) => [task.task_id, task]));
  for (const previousTask of previous.tasks) {
    if (!started.has(previousTask.task_id)) continue;
    const nextTask = nextTasks.get(previousTask.task_id);
    if (!nextTask || stableStringify(nextTask) !== stableStringify(previousTask)) {
      throw new CliError(`Started task ${previousTask.task_id} and its dependency edges are immutable`);
    }
  }
  const existingSupporters = new Map();
  for (const task of previous.tasks) {
    if (task.instrument_role !== "supporting" || task.supporting_follow_up?.kind !== "direct-attempt") continue;
    const supporters = existingSupporters.get(task.supporting_follow_up.task_id) ?? new Set();
    supporters.add(task.task_id);
    existingSupporters.set(task.supporting_follow_up.task_id, supporters);
  }
  for (const task of next.tasks) {
    if (task.instrument_role !== "supporting" || task.supporting_follow_up?.kind !== "direct-attempt") continue;
    const existing = existingSupporters.get(task.supporting_follow_up.task_id) ?? new Set();
    if (!existing.has(task.task_id) && existing.size > 0) {
      const authorization = task.supporting_authorization;
      if (authorization === null || authorization.authorized_revision !== next.revision) {
        throw new CliError(
          `Further supporting instrumentation for ${task.supporting_follow_up.task_id} requires explicit authorization in this later revision`,
        );
      }
    }
  }
  return next;
}

export function taskDigestFor(planRevision, taskId) {
  const revision = validateWorkflowPlanRevision(planRevision);
  const task = revision.tasks.find((entry) => entry.task_id === taskId);
  if (!task) throw new CliError(`Unknown workflow task: ${taskId}`);
  return sha256(stableStringify({
    plan_id: revision.plan_id,
    revision_digest: revision.revision_digest,
    task,
  }));
}

function validateCurrentBaseline(value) {
  requireExactFields(value, { required: ["revision"] }, "current_baseline");
  return { revision: requireConcreteRevision(value.revision, "current_baseline.revision") };
}

function acceptedDispositionAuthority(value, label) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "disposition_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "contract_id", "launch_id", "executor_thread_id", "callback_id",
      "receipt_digest", "decision", "reason", "integration_id",
      "verification_id", "verification_digest", "state", "prepared_at", "finalized_at",
      "callback_consumed_at",
    ],
  }, label);
  if (value.schema_version !== 1 || value.kind !== "codex-flow-v09-task-disposition") {
    throw new CliError(`${label} is not a durable v0.9 task disposition`);
  }
  const decision = requireEnum(value.decision, [
    ...ACCEPTED_DISPOSITIONS,
    "rejected",
    "retained-blocked",
  ], `${label}.decision`);
  const state = requireEnum(value.state, ["prepared", "finalized", "completed"], `${label}.state`);
  if (state !== "completed" || !ACCEPTED_DISPOSITIONS.includes(decision)) {
    throw new CliError(`${label} must be a completed accepted task disposition`);
  }
  const record = {
    schema_version: 1,
    kind: "codex-flow-v09-task-disposition",
    disposition_id: requireText(value.disposition_id, `${label}.disposition_id`, { max: 128, safeId: true }),
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: requireDigest(
      value.runtime_context_digest,
      `${label}.runtime_context_digest`,
    ),
    configuration_digest: requireDigest(
      value.configuration_digest,
      `${label}.configuration_digest`,
    ),
    repository_id: requireText(value.repository_id, `${label}.repository_id`, {
      max: 128,
      safeId: true,
    }),
    common_dir: requireAbsolutePath(value.common_dir, `${label}.common_dir`),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, `${label}.revision_digest`),
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, `${label}.task_digest`),
    contract_id: requireDigest(value.contract_id, `${label}.contract_id`),
    launch_id: requireText(value.launch_id, `${label}.launch_id`, { max: 128, safeId: true }),
    executor_thread_id: requireText(value.executor_thread_id, `${label}.executor_thread_id`, {
      max: 256,
      safeId: true,
    }),
    callback_id: requireText(value.callback_id, `${label}.callback_id`, { max: 128, safeId: true }),
    receipt_digest: requireDigest(value.receipt_digest, `${label}.receipt_digest`),
    decision,
    reason: requireText(value.reason, `${label}.reason`, { max: 512 }),
    integration_id: value.integration_id === null
      ? null
      : requireText(value.integration_id, `${label}.integration_id`, { max: 128, safeId: true }),
    verification_id: requireText(value.verification_id, `${label}.verification_id`, { max: 128, safeId: true }),
    verification_digest: requireDigest(value.verification_digest, `${label}.verification_digest`),
    state,
    prepared_at: requireText(value.prepared_at, `${label}.prepared_at`, { max: 64 }),
    finalized_at: requireText(value.finalized_at, `${label}.finalized_at`, { max: 64 }),
    callback_consumed_at: requireText(value.callback_consumed_at, `${label}.callback_consumed_at`, { max: 64 }),
  };
  if (!/^verification-v1-[a-f0-9]{64}$/.test(record.verification_id)) {
    throw new CliError(`${label}.verification_id must be a v1 verification ID`);
  }
  if (decision === "accepted-no-change" && record.integration_id !== null) {
    throw new CliError(`${label} accepted-no-change disposition cannot name an integration`);
  }
  if (decision === "accepted-for-integration" && record.integration_id === null) {
    throw new CliError(`${label} accepted-for-integration disposition requires an integration`);
  }
  return {
    task_id: record.task_id,
    run_id: record.run_id,
    plan_id: record.plan_id,
    revision_digest: record.revision_digest,
    authority_kind: "task-disposition",
    authority_id: record.disposition_id,
    authority_digest: sha256(stableStringify(record)),
    result_digest: record.receipt_digest,
  };
}

function validateSubagentGitProof(value, label) {
  requireExactFields(value, {
    required: [
      "root", "common_dir", "head", "branch", "head_ref",
      "head_ref_revision", "status_digest", "cleanliness",
    ],
  }, label);
  const headRef = value.head_ref === null
    ? null
    : requireText(value.head_ref, `${label}.head_ref`, { max: 512 });
  const headRefRevision = value.head_ref_revision === null
    ? null
    : requireConcreteRevision(value.head_ref_revision, `${label}.head_ref_revision`);
  if ((headRef === null) !== (headRefRevision === null)) {
    throw new CliError(`${label} head ref and revision must be present together`);
  }
  const proof = {
    root: requireAbsolutePath(value.root, `${label}.root`),
    common_dir: requireAbsolutePath(value.common_dir, `${label}.common_dir`),
    head: requireConcreteRevision(value.head, `${label}.head`),
    branch: value.branch === null
      ? null
      : requireText(value.branch, `${label}.branch`, { max: 256 }),
    head_ref: headRef,
    head_ref_revision: headRefRevision,
    status_digest: requireDigest(value.status_digest, `${label}.status_digest`),
    cleanliness: requireEnum(value.cleanliness, ["clean", "dirty"], `${label}.cleanliness`),
  };
  if (proof.head_ref_revision !== null && proof.head_ref_revision !== proof.head) {
    throw new CliError(`${label} symbolic ref must resolve to the observed HEAD`);
  }
  return proof;
}

function acceptedSubagentAuthority(value, label) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "contract_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "mode", "model", "reasoning_effort", "selector_rationale", "fork_turns", "prompt_digest",
      "initial_git_proof", "state", "attempt", "agent_id", "result", "coordinator_disposition",
      "prepared_at", "created_at", "completed_at", "disposed_at",
    ],
  }, label);
  if (value.schema_version !== 1 || value.kind !== "codex-flow-native-subagent-operation") {
    throw new CliError(`${label} is not a durable native-subagent operation`);
  }
  if (requireEnum(value.state, SUBAGENT_STATES, `${label}.state`) !== "accepted") {
    throw new CliError(`${label} must be an accepted native-subagent operation`);
  }
  if (value.coordinator_disposition !== "accepted" || value.result?.classification !== "PASS") {
    throw new CliError(`${label} must contain a PASS result accepted by the coordinator`);
  }
  requireExactFields(value.attempt, {
    required: [
      "attempt_id", "started_at", "reconcile_by", "outcome",
      "ambiguity_reason", "reconciled_at",
    ],
  }, `${label}.attempt`);
  if (
    value.attempt.outcome !== "accepted"
    || value.attempt.ambiguity_reason !== null
    || value.attempt.reconciled_at === null
  ) {
    throw new CliError(`${label} must contain one accepted native-subagent dispatch attempt`);
  }
  const expectedAttemptId = `subagent-attempt-v1-${sha256(`${value.operation_id}:1`)}`;
  if (value.attempt.attempt_id !== expectedAttemptId) {
    throw new CliError(`${label}.attempt.attempt_id does not match its one-shot operation`);
  }
  const attemptStartedAt = requireTimestamp(
    value.attempt.started_at,
    `${label}.attempt.started_at`,
  );
  const attemptReconcileBy = requireTimestamp(
    value.attempt.reconcile_by,
    `${label}.attempt.reconcile_by`,
  );
  const attemptReconciledAt = requireTimestamp(
    value.attempt.reconciled_at,
    `${label}.attempt.reconciled_at`,
  );
  if (
    Date.parse(attemptReconcileBy) <= Date.parse(attemptStartedAt)
    || Date.parse(attemptReconciledAt) < Date.parse(attemptStartedAt)
    || Date.parse(attemptReconciledAt) > Date.parse(attemptReconcileBy)
  ) {
    throw new CliError(`${label}.attempt must be reconciled inside its bounded window`);
  }
  requireText(value.agent_id, `${label}.agent_id`, { max: 256, safeId: true });
  const preparedAt = requireTimestamp(value.prepared_at, `${label}.prepared_at`);
  const createdAt = requireTimestamp(value.created_at, `${label}.created_at`);
  const completedAt = requireTimestamp(value.completed_at, `${label}.completed_at`);
  const disposedAt = requireTimestamp(value.disposed_at, `${label}.disposed_at`);
  if (
    createdAt !== attemptReconciledAt
    || Date.parse(attemptStartedAt) < Date.parse(preparedAt)
    || Date.parse(completedAt) < Date.parse(createdAt)
    || Date.parse(disposedAt) < Date.parse(completedAt)
  ) {
    throw new CliError(`${label} contains an invalid native-subagent lifecycle order`);
  }
  const authority = validateContractAuthority({
    run_id: value.run_id,
    runtime_context_digest: value.runtime_context_digest,
    configuration_digest: value.configuration_digest,
    repository_id: value.repository_id,
    common_dir: value.common_dir,
    coordinator_binding: value.coordinator_binding,
  });
  const taskId = requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true });
  const initialGitProof = validateSubagentGitProof(value.initial_git_proof, `${label}.initial_git_proof`);
  const selection = {
    mode: requireEnum(value.mode, ["read"], `${label}.mode`),
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: requireEnum(
      value.reasoning_effort,
      REASONING_EFFORTS.filter((item) => item !== null && item !== "ultra"),
      `${label}.reasoning_effort`,
    ),
    selector_rationale: validateSelectorRationale(
      value.selector_rationale,
      `${label}.selector_rationale`,
    ),
    fork_turns: validateForkTurns(value.fork_turns, `${label}.fork_turns`),
  };
  const operation = {
    schema_version: 1,
    kind: "codex-flow-native-subagent-operation",
    contract_id: requireDigest(value.contract_id, `${label}.contract_id`),
    ...authority,
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, `${label}.revision_digest`),
    task_id: taskId,
    task_digest: requireDigest(value.task_digest, `${label}.task_digest`),
    ...selection,
    prompt_digest: requireDigest(value.prompt_digest, `${label}.prompt_digest`),
    initial_git_proof: initialGitProof,
  };
  const expectedOperationId = `subagent-operation-v1-${sha256(stableStringify(operation))}`;
  if (value.operation_id !== expectedOperationId) {
    throw new CliError(`${label}.operation_id does not match the native-subagent request`);
  }
  requireExactFields(value.result, {
    required: ["classification", "summary", "evidence_digests", "final_git_proof", "result_digest"],
  }, `${label}.result`);
  const finalGitProof = validateSubagentGitProof(value.result.final_git_proof, `${label}.result.final_git_proof`);
  if (stableStringify(finalGitProof) !== stableStringify(initialGitProof)) {
    throw new CliError(`${label} does not prove unchanged Git HEAD, ref, and status`);
  }
  const evidenceDigests = requireStringArray(value.result.evidence_digests, `${label}.result.evidence_digests`, {
    maxItems: 128,
    maxText: 64,
  }).map((digest, index) => requireDigest(digest, `${label}.result.evidence_digests[${index}]`)).sort();
  if (new Set(evidenceDigests).size !== evidenceDigests.length) {
    throw new CliError(`${label}.result.evidence_digests contains duplicates`);
  }
  const result = {
    classification: "PASS",
    summary: requireText(value.result.summary, `${label}.result.summary`, { max: 4000 }),
    evidence_digests: evidenceDigests,
    final_git_proof: finalGitProof,
  };
  const resultDigest = requireDigest(value.result.result_digest, `${label}.result.result_digest`);
  const expectedResultDigest = sha256(stableStringify({ operation_id: expectedOperationId, ...result }));
  if (resultDigest !== expectedResultDigest) {
    throw new CliError(`${label}.result.result_digest does not match the subagent evidence`);
  }
  return {
    task_id: taskId,
    run_id: authority.run_id,
    plan_id: operation.plan_id,
    revision_digest: operation.revision_digest,
    authority_kind: "subagent-operation",
    authority_id: expectedOperationId,
    authority_digest: sha256(stableStringify(value)),
    result_digest: resultDigest,
  };
}

function validateDependencyAuthorities(value, task, plan, authority) {
  if (!Array.isArray(value) || value.length !== task.dependencies.length) {
    throw new CliError("dependency_records must cover exactly the task dependencies");
  }
  const seen = new Set();
  const dependencies = value.map((entry, index) => {
    const label = `dependency_records[${index}]`;
    const dependency = entry?.kind === "codex-flow-v09-task-disposition"
      ? acceptedDispositionAuthority(entry, label)
      : entry?.kind === "codex-flow-native-subagent-operation"
        ? acceptedSubagentAuthority(entry, label)
        : (() => { throw new CliError(`${label} must be a durable task disposition or subagent operation`); })();
    if (seen.has(dependency.task_id)) throw new CliError("dependency_records contains duplicate task IDs");
    seen.add(dependency.task_id);
    if (dependency.run_id !== authority.run_id || dependency.plan_id !== plan.plan_id) {
      throw new CliError(`${label} belongs to a different run or workflow plan`);
    }
    return dependency;
  }).sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (stableStringify(dependencies.map((entry) => entry.task_id)) !== stableStringify([...task.dependencies].sort())) {
    throw new CliError("dependency_records must cover exactly the task dependencies");
  }
  return dependencies;
}

function contractSeed(contract) {
  return {
    schema_version: contract.schema_version,
    kind: contract.kind,
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: contract.coordinator_binding,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    current_baseline: contract.current_baseline,
    accepted_dependencies: contract.accepted_dependencies,
    task: contract.task,
  };
}

export function generateTaskContract({
  plan_revision,
  task_id,
  current_baseline,
  dependency_records,
  authority: authorityInput,
}) {
  const plan = validateWorkflowPlanRevision(plan_revision);
  const task = plan.tasks.find((entry) => entry.task_id === task_id);
  if (!task) throw new CliError(`Unknown workflow task: ${task_id}`);
  const baseline = validateCurrentBaseline(current_baseline);
  const authority = validateContractAuthority(authorityInput);
  const dependencies = validateDependencyAuthorities(dependency_records, task, plan, authority);
  const contract = {
    schema_version: GENERATED_TASK_CONTRACT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-contract",
    ...authority,
    plan_id: plan.plan_id,
    revision_digest: plan.revision_digest,
    task_id: task.task_id,
    task_digest: taskDigestFor(plan, task.task_id),
    current_baseline: baseline,
    accepted_dependencies: dependencies.map((dependency) => ({
      task_id: dependency.task_id,
      authority_kind: dependency.authority_kind,
      authority_id: dependency.authority_id,
      authority_digest: dependency.authority_digest,
      result_digest: dependency.result_digest,
    })),
    task,
  };
  return { ...contract, contract_id: sha256(stableStringify(contractSeed(contract))) };
}

export const generateTaskPacket = generateTaskContract;

export function validateGeneratedTaskContract(value) {
  requireExactFields(value, {
    required: [
      "schema_version",
      "kind",
      "contract_id",
      "run_id",
      "runtime_context_digest",
      "configuration_digest",
      "repository_id",
      "common_dir",
      "coordinator_binding",
      "plan_id",
      "revision_digest",
      "task_id",
      "task_digest",
      "current_baseline",
      "accepted_dependencies",
      "task",
    ],
  }, "Generated task contract");
  if (value.schema_version !== GENERATED_TASK_CONTRACT_SCHEMA_VERSION || value.kind !== "codex-flow-generated-task-contract") {
    throw new CliError("Unsupported generated task contract");
  }
  const task = validateWorkflowTask(value.task, 0);
  const authority = validateContractAuthority({
    run_id: value.run_id,
    runtime_context_digest: value.runtime_context_digest,
    configuration_digest: value.configuration_digest,
    repository_id: value.repository_id,
    common_dir: value.common_dir,
    coordinator_binding: value.coordinator_binding,
  });
  const contract = {
    schema_version: GENERATED_TASK_CONTRACT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-contract",
    ...authority,
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task_digest"),
    current_baseline: validateCurrentBaseline(value.current_baseline),
    accepted_dependencies: (() => {
      if (!Array.isArray(value.accepted_dependencies)) throw new CliError("accepted_dependencies must be an array");
      const dependencies = value.accepted_dependencies.map((entry, index) => {
        requireExactFields(entry, {
          required: ["task_id", "authority_kind", "authority_id", "authority_digest", "result_digest"],
        }, `accepted_dependencies[${index}]`);
        return {
          task_id: requireText(entry.task_id, `accepted_dependencies[${index}].task_id`, { max: 128, safeId: true }),
          authority_kind: requireEnum(
            entry.authority_kind,
            ["task-disposition", "subagent-operation"],
            `accepted_dependencies[${index}].authority_kind`,
          ),
          authority_id: requireText(
            entry.authority_id,
            `accepted_dependencies[${index}].authority_id`,
            { max: 128, safeId: true },
          ),
          authority_digest: requireDigest(
            entry.authority_digest,
            `accepted_dependencies[${index}].authority_digest`,
          ),
          result_digest: requireDigest(entry.result_digest, `accepted_dependencies[${index}].result_digest`),
        };
      }).sort((left, right) => left.task_id.localeCompare(right.task_id));
      if (new Set(dependencies.map((entry) => entry.task_id)).size !== dependencies.length) {
        throw new CliError("accepted_dependencies contains duplicate task IDs");
      }
      if (stableStringify(dependencies.map((entry) => entry.task_id)) !== stableStringify(task.dependencies)) {
        throw new CliError("accepted_dependencies must match task dependencies");
      }
      return dependencies;
    })(),
    task,
  };
  if (contract.task_id !== task.task_id) throw new CliError("Generated task contract task_id must match task.task_id");
  const expectedTaskDigest = sha256(stableStringify({
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task,
  }));
  if (contract.task_digest !== expectedTaskDigest) throw new CliError("task_digest does not match the generated task contract");
  const expectedContractId = sha256(stableStringify(contractSeed(contract)));
  if (value.contract_id !== expectedContractId) throw new CliError("contract_id does not match the generated task contract");
  return { ...contract, contract_id: expectedContractId };
}
