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
import { REASONING_EFFORTS } from "./config.mjs";
import { normalizeOwnedPath } from "./task-packet.mjs";

export const WORKFLOW_PLAN_SCHEMA_VERSION = 1;
export const GENERATED_TASK_CONTRACT_SCHEMA_VERSION = 1;
export const GENERATED_TASK_RESULT_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CONCRETE_REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const INSTRUMENT_ROLES = ["none", "supporting", "primary-deliverable"];
const TASK_STATES = ["unstarted", "started", "completed", "accepted", "rejected"];

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
  if (value === "none" || value === "all" || (typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value))) {
    return value;
  }
  throw new CliError(`${label} must explicitly be none, all, or a positive integer string`);
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
      "fork_turns",
      "dependencies",
      "read_paths",
      "write_paths",
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
    fork_turns: forkTurns,
    dependencies: requireStringArray(value.dependencies, `${label}.dependencies`, {
      maxItems: 128,
      maxText: 128,
      safeIds: true,
    }).sort(),
    read_paths: readPaths,
    write_paths: writePaths,
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

  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const first = tasks[left];
      const second = tasks[right];
      if (first.dependencies.includes(second.task_id) || second.dependencies.includes(first.task_id)) continue;
      for (const firstPath of first.write_paths) {
        for (const secondPath of second.write_paths) {
          if (pathsOverlap(firstPath, secondPath)) {
            throw new CliError(`Unordered tasks ${first.task_id} and ${second.task_id} have overlapping write paths`);
          }
        }
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

function validateTaskStates(value, previous) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("task_states must be an object keyed by every previous task ID");
  }
  const taskIds = previous.tasks.map((task) => task.task_id);
  const actual = Object.keys(value).sort();
  if (stableStringify(actual) !== stableStringify([...taskIds].sort())) {
    throw new CliError("task_states must cover exactly the previous workflow tasks");
  }
  return Object.fromEntries(taskIds.map((taskId) => [
    taskId,
    requireEnum(value[taskId], TASK_STATES, `task_states.${taskId}`),
  ]));
}

export function createNextWorkflowPlanRevision({ previous_revision, draft, task_states }) {
  requireExactFields(
    { previous_revision, draft, task_states },
    { required: ["previous_revision", "draft", "task_states"] },
    "Workflow plan revision update",
  );
  const previous = validateWorkflowPlanRevision(previous_revision);
  const states = validateTaskStates(task_states, previous);
  const next = normalizeWorkflowPlan(draft, { requireRevisionDigest: false });
  if (next.plan_id !== previous.plan_id) throw new CliError("Workflow plan revisions must retain plan_id");
  if (next.revision !== previous.revision + 1) throw new CliError("Workflow plan revision must increment by one");
  if (next.parent_revision_digest !== previous.revision_digest) {
    throw new CliError("Workflow plan revision must name the exact previous revision digest");
  }
  const nextTasks = new Map(next.tasks.map((task) => [task.task_id, task]));
  for (const previousTask of previous.tasks) {
    if (states[previousTask.task_id] === "unstarted") continue;
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

function validateDependencyDispositions(value, task) {
  if (!Array.isArray(value) || value.length !== task.dependencies.length) {
    throw new CliError("dependency_dispositions must cover exactly the task dependencies");
  }
  const seen = new Set();
  const dispositions = value.map((entry, index) => {
    const label = `dependency_dispositions[${index}]`;
    requireExactFields(entry, { required: ["task_id", "disposition", "result_digest"] }, label);
    const taskId = requireText(entry.task_id, `${label}.task_id`, { max: 128, safeId: true });
    if (seen.has(taskId)) throw new CliError("dependency_dispositions contains duplicate task IDs");
    seen.add(taskId);
    const disposition = requireEnum(entry.disposition, ["pending", "accepted", "rejected"], `${label}.disposition`);
    const resultDigest = entry.result_digest === null ? null : requireDigest(entry.result_digest, `${label}.result_digest`);
    if ((disposition === "accepted") !== (resultDigest !== null)) {
      throw new CliError(`${label}.accepted dependencies require a result digest and other dispositions must not have one`);
    }
    return { task_id: taskId, disposition, result_digest: resultDigest };
  }).sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (stableStringify(dispositions.map((entry) => entry.task_id)) !== stableStringify([...task.dependencies].sort())) {
    throw new CliError("dependency_dispositions must cover exactly the task dependencies");
  }
  return dispositions;
}

function contractSeed(contract) {
  return {
    schema_version: contract.schema_version,
    kind: contract.kind,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    current_baseline: contract.current_baseline,
    accepted_dependencies: contract.accepted_dependencies,
    task: contract.task,
  };
}

export function generateTaskContract({ plan_revision, task_id, current_baseline, dependency_dispositions }) {
  const plan = validateWorkflowPlanRevision(plan_revision);
  const task = plan.tasks.find((entry) => entry.task_id === task_id);
  if (!task) throw new CliError(`Unknown workflow task: ${task_id}`);
  const baseline = validateCurrentBaseline(current_baseline);
  const dispositions = validateDependencyDispositions(dependency_dispositions, task);
  const unresolved = dispositions.find((entry) => entry.disposition !== "accepted");
  if (unresolved) {
    throw new CliError(`Task ${task.task_id} remains blocked until dependency ${unresolved.task_id} is accepted`);
  }
  const contract = {
    schema_version: GENERATED_TASK_CONTRACT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-contract",
    plan_id: plan.plan_id,
    revision_digest: plan.revision_digest,
    task_id: task.task_id,
    task_digest: taskDigestFor(plan, task.task_id),
    current_baseline: baseline,
    accepted_dependencies: dispositions.map(({ task_id: dependencyTaskId, result_digest }) => ({
      task_id: dependencyTaskId,
      result_digest,
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
  const contract = {
    schema_version: GENERATED_TASK_CONTRACT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-contract",
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task_digest"),
    current_baseline: validateCurrentBaseline(value.current_baseline),
    accepted_dependencies: (() => {
      if (!Array.isArray(value.accepted_dependencies)) throw new CliError("accepted_dependencies must be an array");
      const dependencies = value.accepted_dependencies.map((entry, index) => {
        requireExactFields(entry, { required: ["task_id", "result_digest"] }, `accepted_dependencies[${index}]`);
        return {
          task_id: requireText(entry.task_id, `accepted_dependencies[${index}].task_id`, { max: 128, safeId: true }),
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

function resultSeed(result) {
  return {
    schema_version: result.schema_version,
    kind: result.kind,
    contract_id: result.contract_id,
    task_id: result.task_id,
    outcome: result.outcome,
    evidence_digests: result.evidence_digests,
  };
}

export function createGeneratedTaskResult({ task_contract, outcome, evidence_digests }) {
  const contract = validateGeneratedTaskContract(task_contract);
  const result = {
    schema_version: GENERATED_TASK_RESULT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-result",
    contract_id: contract.contract_id,
    task_id: contract.task_id,
    outcome: requireText(outcome, "outcome", { max: 4000 }),
    evidence_digests: requireStringArray(evidence_digests, "evidence_digests", {
      maxItems: 128,
      maxText: 64,
    }).map((digest, index) => requireDigest(digest, `evidence_digests[${index}]`)).sort(),
  };
  return { ...result, result_digest: sha256(stableStringify(resultSeed(result))) };
}

export function validateGeneratedTaskResult(value) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "contract_id", "task_id", "outcome", "evidence_digests", "result_digest"],
  }, "Generated task result");
  if (value.schema_version !== GENERATED_TASK_RESULT_SCHEMA_VERSION || value.kind !== "codex-flow-generated-task-result") {
    throw new CliError("Unsupported generated task result");
  }
  const result = {
    schema_version: GENERATED_TASK_RESULT_SCHEMA_VERSION,
    kind: "codex-flow-generated-task-result",
    contract_id: requireDigest(value.contract_id, "contract_id"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    outcome: requireText(value.outcome, "outcome", { max: 4000 }),
    evidence_digests: requireStringArray(value.evidence_digests, "evidence_digests", {
      maxItems: 128,
      maxText: 64,
    }).map((digest, index) => requireDigest(digest, `evidence_digests[${index}]`)).sort(),
  };
  if (new Set(result.evidence_digests).size !== result.evidence_digests.length) {
    throw new CliError("evidence_digests contains duplicates");
  }
  const expected = sha256(stableStringify(resultSeed(result)));
  if (value.result_digest !== expected) throw new CliError("result_digest does not match the generated task result");
  return { ...result, result_digest: expected };
}
