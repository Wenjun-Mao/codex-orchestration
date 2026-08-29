import {
  CliError,
  requireEnum,
  requireExactFields,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { REASONING_EFFORTS } from "./config.mjs";
import { validateGeneratedTaskContract } from "./workflow-plan.mjs";

export const SUBAGENT_OPERATION_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const STATES = ["prepared", "created", "completed", "accepted", "rejected"];

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validateForkTurns(value, label) {
  if (value === "none" || value === "all" || (typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value))) {
    return value;
  }
  throw new CliError(`${label} must explicitly be none, all, or a positive integer string`);
}

function validateSelection({ model, reasoning_effort, fork_turns, mode }, label) {
  const exactModel = requireText(model, `${label}.model`, { max: 128 });
  const reasoningEffort = requireEnum(
    reasoning_effort,
    REASONING_EFFORTS.filter((item) => item !== null && item !== "ultra"),
    `${label}.reasoning_effort`,
  );
  if (mode !== "read") throw new CliError(`${label}.mode must be read for a native subagent`);
  return {
    model: exactModel,
    reasoning_effort: reasoningEffort,
    fork_turns: validateForkTurns(fork_turns, `${label}.fork_turns`),
    mode: "read",
  };
}

function operationSeed(operation) {
  return {
    schema_version: operation.schema_version,
    kind: operation.kind,
    task_contract_id: operation.task_contract_id,
    plan_id: operation.plan_id,
    revision_digest: operation.revision_digest,
    task_id: operation.task_id,
    task_digest: operation.task_digest,
    mode: operation.mode,
    model: operation.model,
    reasoning_effort: operation.reasoning_effort,
    fork_turns: operation.fork_turns,
    prompt_digest: operation.prompt_digest,
  };
}

function resultSeed(operationId, result) {
  return {
    operation_id: operationId,
    summary: result.summary,
    evidence_digests: result.evidence_digests,
  };
}

function validateSubagentResult(value, operationId, label = "result") {
  requireExactFields(value, { required: ["summary", "evidence_digests", "result_digest"] }, label);
  const evidenceDigests = requireStringArray(value.evidence_digests, `${label}.evidence_digests`, {
    maxItems: 128,
    maxText: 64,
  }).map((digest, index) => requireDigest(digest, `${label}.evidence_digests[${index}]`)).sort();
  if (new Set(evidenceDigests).size !== evidenceDigests.length) throw new CliError(`${label}.evidence_digests contains duplicates`);
  const result = {
    summary: requireText(value.summary, `${label}.summary`, { max: 4000 }),
    evidence_digests: evidenceDigests,
  };
  const expected = sha256(stableStringify(resultSeed(operationId, result)));
  if (value.result_digest !== expected) throw new CliError(`${label}.result_digest does not match subagent evidence`);
  return { ...result, result_digest: expected };
}

function validateOperation(value) {
  requireExactFields(value, {
    required: [
      "schema_version",
      "kind",
      "operation_id",
      "task_contract_id",
      "plan_id",
      "revision_digest",
      "task_id",
      "task_digest",
      "mode",
      "model",
      "reasoning_effort",
      "fork_turns",
      "prompt_digest",
      "state",
      "agent_id",
      "result",
      "coordinator_disposition",
    ],
  }, "Native subagent operation");
  if (value.schema_version !== SUBAGENT_OPERATION_SCHEMA_VERSION || value.kind !== "codex-flow-native-subagent-operation") {
    throw new CliError("Unsupported native subagent operation");
  }
  const selection = validateSelection(value, "Native subagent operation");
  const operation = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: "codex-flow-native-subagent-operation",
    task_contract_id: requireDigest(value.task_contract_id, "task_contract_id"),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task_digest"),
    ...selection,
    prompt_digest: requireDigest(value.prompt_digest, "prompt_digest"),
  };
  const expectedOperationId = `subagent-operation-v1-${sha256(stableStringify(operationSeed(operation)))}`;
  if (value.operation_id !== expectedOperationId) throw new CliError("operation_id does not match the native subagent request");
  const state = requireEnum(value.state, STATES, "state");
  const agentId = value.agent_id === null ? null : requireText(value.agent_id, "agent_id", { max: 256 });
  const result = value.result === null ? null : validateSubagentResult(value.result, expectedOperationId);
  const coordinatorDisposition = value.coordinator_disposition === null
    ? null
    : requireEnum(value.coordinator_disposition, ["accepted", "rejected"], "coordinator_disposition");
  if (state === "prepared" && (agentId !== null || result !== null || coordinatorDisposition !== null)) {
    throw new CliError("Prepared native subagent operations cannot contain host or result state");
  }
  if (state === "created" && (agentId === null || result !== null || coordinatorDisposition !== null)) {
    throw new CliError("Created native subagent operations require only agent_id");
  }
  if (state === "completed" && (agentId === null || result === null || coordinatorDisposition !== null)) {
    throw new CliError("Completed native subagent operations require read-only evidence without a disposition");
  }
  if (["accepted", "rejected"].includes(state)) {
    if (agentId === null || result === null || coordinatorDisposition !== state) {
      throw new CliError("Disposed native subagent operations require the matching coordinator disposition");
    }
  }
  return {
    ...operation,
    operation_id: expectedOperationId,
    state,
    agent_id: agentId,
    result,
    coordinator_disposition: coordinatorDisposition,
  };
}

export function validateSubagentOperation(value) {
  return validateOperation(value);
}

export function prepareSubagentOperation({ task_contract, model, reasoning_effort, fork_turns, mode, prompt_digest }) {
  const contract = validateGeneratedTaskContract(task_contract);
  if (contract.task.execution_kind !== "subagent") {
    throw new CliError("A native subagent operation requires a generated subagent task contract");
  }
  const selection = validateSelection({ model, reasoning_effort, fork_turns, mode }, "Subagent request");
  if (
    selection.model !== contract.task.model
    || selection.reasoning_effort !== contract.task.reasoning_effort
    || selection.fork_turns !== contract.task.fork_turns
    || selection.mode !== contract.task.mode
  ) {
    throw new CliError("Native subagent selection must exactly match its generated task contract");
  }
  const operation = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: "codex-flow-native-subagent-operation",
    task_contract_id: contract.contract_id,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    ...selection,
    prompt_digest: requireDigest(prompt_digest, "prompt_digest"),
  };
  return {
    ...operation,
    operation_id: `subagent-operation-v1-${sha256(stableStringify(operationSeed(operation)))}`,
    state: "prepared",
    agent_id: null,
    result: null,
    coordinator_disposition: null,
  };
}

export function reconcileCreatedSubagent(operation, agent_id) {
  const current = validateOperation(operation);
  if (current.state !== "prepared") throw new CliError("Only a prepared native subagent operation can reconcile creation");
  return { ...current, state: "created", agent_id: requireText(agent_id, "agent_id", { max: 256 }) };
}

export function completeSubagentOperation(operation, { summary, evidence_digests }) {
  const current = validateOperation(operation);
  if (current.state !== "created") throw new CliError("Only a created native subagent operation can complete");
  const evidenceDigests = requireStringArray(evidence_digests, "evidence_digests", {
    maxItems: 128,
    maxText: 64,
  }).map((digest, index) => requireDigest(digest, `evidence_digests[${index}]`)).sort();
  if (new Set(evidenceDigests).size !== evidenceDigests.length) throw new CliError("evidence_digests contains duplicates");
  const result = {
    summary: requireText(summary, "summary", { max: 4000 }),
    evidence_digests: evidenceDigests,
  };
  return {
    ...current,
    state: "completed",
    result: {
      ...result,
      result_digest: sha256(stableStringify(resultSeed(current.operation_id, result))),
    },
  };
}

export function recordSubagentCoordinatorDisposition(operation, disposition) {
  const current = validateOperation(operation);
  const acceptedDisposition = requireEnum(disposition, ["accepted", "rejected"], "disposition");
  if (current.state !== "completed") throw new CliError("Only completed native subagent evidence can receive a coordinator disposition");
  return {
    ...current,
    state: acceptedDisposition,
    coordinator_disposition: acceptedDisposition,
  };
}

export function isSubagentDependencyUnblocked(operation) {
  return validateOperation(operation).state === "accepted";
}

export function acceptedSubagentDependency(operation) {
  const current = validateOperation(operation);
  if (current.state !== "accepted" || current.result === null) {
    throw new CliError("Only an accepted native subagent result can unblock a dependent task");
  }
  return {
    task_id: current.task_id,
    disposition: "accepted",
    result_digest: current.result.result_digest,
  };
}
