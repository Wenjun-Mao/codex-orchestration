import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireStringArray,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { REASONING_EFFORTS } from "./config.mjs";
import { discoverGit, gitCommonDirectoryForState } from "./git.mjs";
import { assertWorkflowTaskContractCurrent } from "./workflow-journal-v06.mjs";
import {
  coordinatorBindingDigest,
  validateGeneratedTaskContract,
} from "./workflow-plan.mjs";

export const SUBAGENT_OPERATION_SCHEMA_VERSION = 1;

const KIND = "codex-flow-native-subagent-operation";
const CLAIM_KIND = "codex-flow-native-subagent-contract-claim";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const STATES = [
  "prepared",
  "attempting",
  "created",
  "rejected-before-send",
  "ambiguous",
  "completed",
  "accepted",
  "rejected",
];
const ATTEMPT_OUTCOMES = ["accepted", "rejected-before-send", "ambiguous"];
const AMBIGUITY_REASONS = ["host-result-ambiguous", "reconciliation-window-expired"];
const CLASSIFICATIONS = ["PASS", "BLOCKED", "FAIL"];
const MAX_PROMPT_LENGTH = 128 * 1024;

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireRevision(value, label) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    throw new CliError(`${label} must be a concrete lowercase Git revision`);
  }
  return value;
}

function requireTimestamp(value, label) {
  requireText(value, label, { max: 64 });
  if (!TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : requireTimestamp(value, label);
}

function nowMilliseconds(now, label = "clock") {
  const value = now instanceof Date ? now.getTime() : now;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CliError(`${label} must produce a finite timestamp`);
  }
  return value;
}

function nowIso(now, label = "clock") {
  return new Date(nowMilliseconds(now, label)).toISOString();
}

function validateForkTurns(value, label) {
  if (value === "none" || (typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value))) {
    return value;
  }
  throw new CliError(
    `${label} must be none or a positive integer string; full-history forks cannot override model routing`,
  );
}

function nativeTaskName(taskId) {
  const slug = taskId
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "task";
  return `flow_${slug}_${sha256(taskId).slice(0, 12)}`;
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

function validateCoordinatorBinding(value, label) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const binding = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, {
      min: 1,
      max: 2147483647,
    }),
    binding_digest: requireDigest(value.binding_digest, `${label}.binding_digest`),
  };
  if (binding.binding_digest !== coordinatorBindingDigest(binding)) {
    throw new CliError(`${label}.binding_digest does not match the coordinator identity`);
  }
  return binding;
}

function runGit(cwd, args, label, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return result;
}

function validateGitProof(value, label) {
  requireExactFields(value, {
    required: [
      "root", "common_dir", "head", "branch", "head_ref",
      "head_ref_revision", "status_digest", "cleanliness",
    ],
  }, label);
  const branch = value.branch === null
    ? null
    : requireText(value.branch, `${label}.branch`, { max: 256 });
  const headRef = value.head_ref === null
    ? null
    : requireText(value.head_ref, `${label}.head_ref`, { max: 512 });
  const headRefRevision = value.head_ref_revision === null
    ? null
    : requireRevision(value.head_ref_revision, `${label}.head_ref_revision`);
  if ((headRef === null) !== (headRefRevision === null)) {
    throw new CliError(`${label} head ref and revision must be present together`);
  }
  const proof = {
    root: resolve(requireText(value.root, `${label}.root`, { max: 2048 })),
    common_dir: resolve(requireText(value.common_dir, `${label}.common_dir`, { max: 2048 })),
    head: requireRevision(value.head, `${label}.head`),
    branch,
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

function captureGitProof(cwd) {
  const repository = discoverGit(cwd);
  const head = runGit(
    repository.root,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Subagent Git HEAD",
  ).stdout.trim();
  const symbolic = runGit(
    repository.root,
    ["symbolic-ref", "--quiet", "HEAD"],
    "Subagent symbolic HEAD",
    { allowFailure: true },
  );
  if (![0, 1].includes(symbolic.status)) throw new CliError("Subagent symbolic HEAD inspection failed");
  const headRef = symbolic.status === 0 ? symbolic.stdout.trim() : null;
  const headRefRevision = headRef === null
    ? null
    : runGit(
      repository.root,
      ["rev-parse", "--verify", `${headRef}^{commit}`],
      "Subagent branch ref",
    ).stdout.trim();
  const status = runGit(
    repository.root,
    ["status", "--porcelain=v1", "-z"],
    "Subagent Git status",
  ).stdout;
  return validateGitProof({
    root: resolve(repository.root),
    common_dir: resolve(repository.commonDir),
    head,
    branch: headRef === null ? null : headRef.replace(/^refs\/heads\//, ""),
    head_ref: headRef,
    head_ref_revision: headRefRevision,
    status_digest: sha256(status),
    cleanliness: status === "" ? "clean" : "dirty",
  }, "captured_git_proof");
}

function operationSeed(operation) {
  return {
    schema_version: operation.schema_version,
    kind: operation.kind,
    contract_id: operation.contract_id,
    run_id: operation.run_id,
    runtime_context_digest: operation.runtime_context_digest,
    configuration_digest: operation.configuration_digest,
    repository_id: operation.repository_id,
    common_dir: operation.common_dir,
    coordinator_binding: operation.coordinator_binding,
    plan_id: operation.plan_id,
    revision_digest: operation.revision_digest,
    task_id: operation.task_id,
    task_digest: operation.task_digest,
    mode: operation.mode,
    model: operation.model,
    reasoning_effort: operation.reasoning_effort,
    fork_turns: operation.fork_turns,
    prompt_digest: operation.prompt_digest,
    initial_git_proof: operation.initial_git_proof,
  };
}

function operationIdFor(operation) {
  return `subagent-operation-v1-${sha256(stableStringify(operationSeed(operation)))}`;
}

function attemptIdFor(operationId) {
  return `subagent-attempt-v1-${sha256(`${operationId}:1`)}`;
}

function resultSeed(operationId, result) {
  return {
    operation_id: operationId,
    classification: result.classification,
    summary: result.summary,
    evidence_digests: result.evidence_digests,
    final_git_proof: result.final_git_proof,
  };
}

function validateSubagentResult(value, operationId, initialGitProof, label = "result") {
  requireExactFields(value, {
    required: ["classification", "summary", "evidence_digests", "final_git_proof", "result_digest"],
  }, label);
  const evidenceDigests = requireStringArray(value.evidence_digests, `${label}.evidence_digests`, {
    maxItems: 128,
    maxText: 64,
  }).map((digest, index) => requireDigest(digest, `${label}.evidence_digests[${index}]`)).sort();
  if (new Set(evidenceDigests).size !== evidenceDigests.length) {
    throw new CliError(`${label}.evidence_digests contains duplicates`);
  }
  const finalGitProof = validateGitProof(value.final_git_proof, `${label}.final_git_proof`);
  if (stableStringify(finalGitProof) !== stableStringify(initialGitProof)) {
    throw new CliError(`${label} does not prove unchanged Git HEAD, ref, and status`);
  }
  const result = {
    classification: requireEnum(value.classification, CLASSIFICATIONS, `${label}.classification`),
    summary: requireText(value.summary, `${label}.summary`, { max: 4000 }),
    evidence_digests: evidenceDigests,
    final_git_proof: finalGitProof,
  };
  const expected = sha256(stableStringify(resultSeed(operationId, result)));
  if (value.result_digest !== expected) {
    throw new CliError(`${label}.result_digest does not match subagent evidence`);
  }
  return { ...result, result_digest: expected };
}

function validateAttempt(value, operationId) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "attempt_id", "started_at", "reconcile_by", "outcome",
      "ambiguity_reason", "reconciled_at",
    ],
  }, "Subagent attempt");
  const outcome = value.outcome === null
    ? null
    : requireEnum(value.outcome, ATTEMPT_OUTCOMES, "Subagent attempt.outcome");
  const ambiguityReason = value.ambiguity_reason === null
    ? null
    : requireEnum(
      value.ambiguity_reason,
      AMBIGUITY_REASONS,
      "Subagent attempt.ambiguity_reason",
    );
  const attempt = {
    attempt_id: requireText(value.attempt_id, "Subagent attempt.attempt_id", {
      max: 128,
      safeId: true,
    }),
    started_at: requireTimestamp(value.started_at, "Subagent attempt.started_at"),
    reconcile_by: requireTimestamp(value.reconcile_by, "Subagent attempt.reconcile_by"),
    outcome,
    ambiguity_reason: ambiguityReason,
    reconciled_at: nullableTimestamp(value.reconciled_at, "Subagent attempt.reconciled_at"),
  };
  if (attempt.attempt_id !== attemptIdFor(operationId)) {
    throw new CliError("Subagent attempt_id does not match its one-shot operation");
  }
  if (Date.parse(attempt.reconcile_by) <= Date.parse(attempt.started_at)) {
    throw new CliError("Subagent attempt reconcile_by must follow started_at");
  }
  if ((attempt.outcome === null) !== (attempt.reconciled_at === null)) {
    throw new CliError("Subagent attempt outcome and reconciled_at must be present together");
  }
  if ((attempt.outcome === "ambiguous") !== (attempt.ambiguity_reason !== null)) {
    throw new CliError("Only an ambiguous subagent attempt requires ambiguity_reason");
  }
  if (
    attempt.reconciled_at !== null
    && (
      Date.parse(attempt.reconciled_at) < Date.parse(attempt.started_at)
      || Date.parse(attempt.reconciled_at) > Date.parse(attempt.reconcile_by)
    )
  ) throw new CliError("Subagent attempt was not reconciled inside its bounded window");
  return attempt;
}

function validateOperation(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "contract_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "mode", "model", "reasoning_effort", "fork_turns", "prompt_digest",
      "initial_git_proof", "state", "attempt", "agent_id", "result",
      "coordinator_disposition", "prepared_at", "created_at", "completed_at", "disposed_at",
    ],
  }, "Native subagent operation");
  if (value.schema_version !== SUBAGENT_OPERATION_SCHEMA_VERSION || value.kind !== KIND) {
    throw new CliError("Unsupported native subagent operation");
  }
  const selection = validateSelection(value, "Native subagent operation");
  const operation = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: KIND,
    contract_id: requireDigest(value.contract_id, "contract_id"),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_context_digest: requireDigest(value.runtime_context_digest, "runtime_context_digest"),
    configuration_digest: requireDigest(value.configuration_digest, "configuration_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: resolve(requireText(value.common_dir, "common_dir", { max: 2048 })),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding, "coordinator_binding"),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task_digest"),
    ...selection,
    prompt_digest: requireDigest(value.prompt_digest, "prompt_digest"),
    initial_git_proof: validateGitProof(value.initial_git_proof, "initial_git_proof"),
  };
  const expectedOperationId = operationIdFor(operation);
  if (value.operation_id !== expectedOperationId) {
    throw new CliError("operation_id does not match the native subagent request");
  }
  const state = requireEnum(value.state, STATES, "state");
  const attempt = validateAttempt(value.attempt, expectedOperationId);
  const agentId = value.agent_id === null
    ? null
    : requireText(value.agent_id, "agent_id", { max: 256, safeId: true });
  const result = value.result === null
    ? null
    : validateSubagentResult(value.result, expectedOperationId, operation.initial_git_proof);
  const coordinatorDisposition = value.coordinator_disposition === null
    ? null
    : requireEnum(value.coordinator_disposition, ["accepted", "rejected"], "coordinator_disposition");
  const timestamps = {
    prepared_at: requireTimestamp(value.prepared_at, "prepared_at"),
    created_at: nullableTimestamp(value.created_at, "created_at"),
    completed_at: nullableTimestamp(value.completed_at, "completed_at"),
    disposed_at: nullableTimestamp(value.disposed_at, "disposed_at"),
  };

  const hasExecutionEvidence = agentId !== null
    || result !== null
    || coordinatorDisposition !== null
    || timestamps.created_at !== null
    || timestamps.completed_at !== null
    || timestamps.disposed_at !== null;
  if (state === "prepared" && (attempt !== null || hasExecutionEvidence)) {
    throw new CliError("Prepared native subagent operations cannot contain host or result state");
  }
  if (state === "attempting" && (
    attempt === null
    || attempt.outcome !== null
    || hasExecutionEvidence
  )) throw new CliError("Attempting native subagent operations require only an open one-shot attempt");
  if (["rejected-before-send", "ambiguous"].includes(state) && (
    attempt?.outcome !== state
    || hasExecutionEvidence
  )) throw new CliError(`${state} native subagent operations are terminal without executor identity`);
  if (["created", "completed", "accepted", "rejected"].includes(state) && (
    attempt?.outcome !== "accepted"
    || agentId === null
    || timestamps.created_at === null
  )) throw new CliError(`${state} native subagent operations require an accepted one-shot attempt`);
  if (state === "created" && (
    result !== null
    || coordinatorDisposition !== null
    || timestamps.completed_at !== null
    || timestamps.disposed_at !== null
  )) throw new CliError("Created native subagent operations require only created identity state");
  if (state === "completed" && (
    result === null
    || coordinatorDisposition !== null
    || timestamps.completed_at === null
    || timestamps.disposed_at !== null
  )) throw new CliError("Completed native subagent operations require evidence without a disposition");
  if (["accepted", "rejected"].includes(state)) {
    if (
      result === null
      || coordinatorDisposition !== state
      || timestamps.completed_at === null
      || timestamps.disposed_at === null
    ) throw new CliError("Disposed native subagent operations require their coordinator disposition");
    if (state === "accepted" && result.classification !== "PASS") {
      throw new CliError("Only a PASS native-subagent result may be accepted");
    }
  }
  if (attempt !== null && Date.parse(attempt.started_at) < Date.parse(timestamps.prepared_at)) {
    throw new CliError("Native subagent attempt predates preparation");
  }
  if (
    timestamps.created_at !== null
    && timestamps.created_at !== attempt.reconciled_at
  ) throw new CliError("Native subagent created_at must match accepted attempt reconciliation");
  if (
    timestamps.completed_at !== null
    && Date.parse(timestamps.completed_at) < Date.parse(timestamps.created_at)
  ) throw new CliError("Native subagent completion predates creation");
  if (
    timestamps.disposed_at !== null
    && Date.parse(timestamps.disposed_at) < Date.parse(timestamps.completed_at)
  ) throw new CliError("Native subagent disposition predates completion");

  return {
    ...operation,
    operation_id: expectedOperationId,
    state,
    attempt,
    agent_id: agentId,
    result,
    coordinator_disposition: coordinatorDisposition,
    ...timestamps,
  };
}

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(resolve(stateRoot));
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe native-subagent state path");
  }
  return path;
}

function paths(stateRoot, { operationId = null, contractId = null } = {}) {
  const root = resolve(stateRoot, "subagents");
  const result = {};
  if (operationId !== null) {
    const id = requireText(operationId, "operation_id", { max: 128, safeId: true });
    result.record = safeChild(resolve(root, "records"), `${id}.json`);
    result.operationLock = safeChild(resolve(root, "locks"), `${id}.lock`);
  }
  if (contractId !== null) {
    const id = requireDigest(contractId, "contract_id");
    result.claim = safeChild(resolve(root, "claims"), `${id}.json`);
    result.contractLock = safeChild(resolve(root, "locks"), `${id}.contract.lock`);
  }
  return result;
}

function validateClaim(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "contract_id", "operation_id",
      "operation_identity_digest", "prepared_at",
    ],
  }, "Native subagent contract claim");
  if (value.schema_version !== 1 || value.kind !== CLAIM_KIND) {
    throw new CliError("Unsupported native subagent contract claim");
  }
  return {
    schema_version: 1,
    kind: CLAIM_KIND,
    contract_id: requireDigest(value.contract_id, "claim.contract_id"),
    operation_id: requireText(value.operation_id, "claim.operation_id", {
      max: 128,
      safeId: true,
    }),
    operation_identity_digest: requireDigest(
      value.operation_identity_digest,
      "claim.operation_identity_digest",
    ),
    prepared_at: requireTimestamp(value.prepared_at, "claim.prepared_at"),
  };
}

async function readOperation(stateRoot, operationId) {
  const location = paths(stateRoot, { operationId });
  const raw = await readJson(location.record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (!raw) throw new CliError("Native subagent operation does not exist");
  return { location, operation: validateOperation(raw) };
}

async function writeOperation(stateRoot, operationId, value) {
  const operation = validateOperation(value);
  if (operation.operation_id !== operationId) {
    throw new CliError("Native subagent operation identity changed during update");
  }
  await atomicWriteJson(paths(stateRoot, { operationId }).record, operation, {
    guardRoot: guardRoot(stateRoot),
    mode: 0o600,
  });
  return operation;
}

async function assertRepositoryAuthority(stateRoot, contract, proof) {
  const journalCommonDir = await realpath(guardRoot(stateRoot)).catch(() => null);
  const contractCommonDir = await realpath(contract.common_dir).catch(() => null);
  const proofCommonDir = await realpath(proof.common_dir).catch(() => null);
  if (!journalCommonDir || contractCommonDir !== journalCommonDir || proofCommonDir !== journalCommonDir) {
    throw new CliError(
      "Native subagent repository does not match its task contract and journal common directory",
    );
  }
  if (proof.head !== contract.current_baseline.revision || proof.cleanliness !== "clean") {
    throw new CliError("Native subagent must start clean at the exact generated-contract baseline");
  }
}

function immutable(operation) {
  return operationSeed(operation);
}

function closeExpired(operation, now) {
  if (operation.state !== "attempting") return operation;
  if (nowMilliseconds(now) <= Date.parse(operation.attempt.reconcile_by)) return operation;
  return validateOperation({
    ...operation,
    state: "ambiguous",
    attempt: {
      ...operation.attempt,
      outcome: "ambiguous",
      ambiguity_reason: "reconciliation-window-expired",
      reconciled_at: operation.attempt.reconcile_by,
    },
  });
}

function attemptView(operation, { dispatchPermitted = false, prompt = null } = {}) {
  const record = validateOperation(operation);
  const result = {
    ...clone(record),
    dispatch_permitted: dispatchPermitted,
    reconciliation_open: record.state === "attempting",
  };
  if (dispatchPermitted) {
    result.host_request = {
      kind: "spawn-native-subagent",
      task_name: nativeTaskName(record.task_id),
      message: prompt,
      model: record.model,
      reasoning_effort: record.reasoning_effort,
      fork_turns: record.fork_turns,
    };
  }
  return result;
}

export function validateSubagentOperation(value) {
  return validateOperation(value);
}

export async function prepareSubagentOperation({
  stateRoot,
  task_contract,
  model,
  reasoning_effort,
  fork_turns,
  mode,
  prompt_digest,
  worktree_path,
  now = Date.now(),
}) {
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
  ) throw new CliError("Native subagent selection must exactly match its generated task contract");
  const initialGitProof = captureGitProof(worktree_path);
  await assertRepositoryAuthority(stateRoot, contract, initialGitProof);
  const preparedAt = nowIso(now);
  const identity = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: KIND,
    contract_id: contract.contract_id,
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
    ...selection,
    prompt_digest: requireDigest(prompt_digest, "prompt_digest"),
    initial_git_proof: initialGitProof,
  };
  const operationId = operationIdFor(identity);
  const record = validateOperation({
    ...identity,
    operation_id: operationId,
    state: "prepared",
    attempt: null,
    agent_id: null,
    result: null,
    coordinator_disposition: null,
    prepared_at: preparedAt,
    created_at: null,
    completed_at: null,
    disposed_at: null,
  });
  const location = paths(stateRoot, {
    operationId,
    contractId: contract.contract_id,
  });
  return withProcessLock({
    path: location.contractLock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent contract ${contract.contract_id}`,
  }, async () => {
    const rawClaim = await readJson(location.claim, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    const expectedClaim = validateClaim({
      schema_version: 1,
      kind: CLAIM_KIND,
      contract_id: contract.contract_id,
      operation_id: operationId,
      operation_identity_digest: sha256(stableStringify(immutable(record))),
      prepared_at: preparedAt,
    });
    const claim = rawClaim === null ? null : validateClaim(rawClaim);
    if (claim !== null) {
      if (
        claim.contract_id !== expectedClaim.contract_id
        || claim.operation_id !== expectedClaim.operation_id
        || claim.operation_identity_digest !== expectedClaim.operation_identity_digest
      ) throw new CliError("Generated subagent contract is already claimed by a different operation", 73);
    }
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing !== null) {
      const current = validateOperation(existing);
      if (stableStringify(immutable(current)) !== stableStringify(immutable(record))) {
        throw new CliError("Native subagent operation identity collides with a different request", 73);
      }
      return current;
    }
    await assertWorkflowTaskContractCurrent({
      stateRoot,
      runId: contract.run_id,
      planId: contract.plan_id,
      taskContract: contract,
    });
    if (claim === null) {
      await ensureExactJson(location.claim, expectedClaim, {
        guardRoot: guardRoot(stateRoot),
        mode: 0o600,
      });
    }
    const recoveredRecord = claim === null
      ? record
      : validateOperation({ ...record, prepared_at: claim.prepared_at });
    await ensureExactJson(location.record, recoveredRecord, {
      guardRoot: guardRoot(stateRoot),
      mode: 0o600,
    });
    return recoveredRecord;
  });
}

export async function beginSubagentOperationAttempt({
  stateRoot,
  operationId,
  prompt,
  timeoutSeconds = 300,
  now = Date.now(),
}) {
  const message = requireText(prompt, "prompt", { max: MAX_PROMPT_LENGTH });
  const timeout = requireInteger(timeoutSeconds, "timeout_seconds", { min: 5, max: 1800 });
  const location = paths(stateRoot, { operationId });
  return withProcessLock({
    path: location.operationLock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    let current = (await readOperation(stateRoot, operationId)).operation;
    if (sha256(message) !== current.prompt_digest) {
      throw new CliError("Subagent attempt prompt does not match the prepared prompt_digest", 73);
    }
    const closed = closeExpired(current, now);
    if (stableStringify(closed) !== stableStringify(current)) {
      current = await writeOperation(stateRoot, operationId, closed);
    }
    if (current.attempt !== null) {
      const existingTimeout = (
        Date.parse(current.attempt.reconcile_by) - Date.parse(current.attempt.started_at)
      ) / 1000;
      if (existingTimeout !== timeout) {
        throw new CliError("Native subagent operation already has a different one-shot attempt", 73);
      }
      return attemptView(current);
    }
    if (current.state !== "prepared") {
      throw new CliError(`Native subagent operation is not dispatchable: ${current.state}`, 73);
    }
    const started = nowMilliseconds(now);
    current = await writeOperation(stateRoot, operationId, {
      ...current,
      state: "attempting",
      attempt: {
        attempt_id: attemptIdFor(operationId),
        started_at: new Date(started).toISOString(),
        reconcile_by: new Date(started + timeout * 1000).toISOString(),
        outcome: null,
        ambiguity_reason: null,
        reconciled_at: null,
      },
    });
    return attemptView(current, { dispatchPermitted: true, prompt: message });
  });
}

export async function reconcileSubagentOperationAttempt({
  stateRoot,
  operationId,
  outcome,
  agent_id = null,
  now = Date.now(),
}) {
  const result = requireEnum(outcome, ATTEMPT_OUTCOMES, "subagent attempt outcome");
  const agentId = agent_id === null
    ? null
    : requireText(agent_id, "agent_id", { max: 256, safeId: true });
  if ((result === "accepted") !== (agentId !== null)) {
    throw new CliError("Only an accepted subagent attempt requires agent_id");
  }
  const location = paths(stateRoot, { operationId });
  return withProcessLock({
    path: location.operationLock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    let current = (await readOperation(stateRoot, operationId)).operation;
    if (current.attempt === null) {
      throw new CliError("Native subagent operation must begin its one-shot attempt before reconciliation", 73);
    }
    const closed = closeExpired(current, now);
    if (stableStringify(closed) !== stableStringify(current)) {
      current = await writeOperation(stateRoot, operationId, closed);
    }
    if (current.attempt.outcome !== null) {
      if (
        current.attempt.outcome === result
        && (result !== "accepted" || current.agent_id === agentId)
      ) return current;
      throw new CliError(
        `Native subagent one-shot attempt is already reconciled as ${current.attempt.outcome}`,
        73,
      );
    }
    const reconciledAt = nowIso(now);
    if (Date.parse(reconciledAt) > Date.parse(current.attempt.reconcile_by)) {
      throw new CliError("Native subagent attempt reconciliation window has expired", 73);
    }
    const next = {
      ...current,
      state: result === "accepted" ? "created" : result,
      attempt: {
        ...current.attempt,
        outcome: result,
        ambiguity_reason: result === "ambiguous" ? "host-result-ambiguous" : null,
        reconciled_at: reconciledAt,
      },
      agent_id: agentId,
      created_at: result === "accepted" ? reconciledAt : null,
    };
    return writeOperation(stateRoot, operationId, next);
  });
}

export async function completeSubagentOperation({
  stateRoot,
  operationId,
  classification,
  summary,
  evidence_digests,
  now = Date.now(),
}) {
  const location = paths(stateRoot, { operationId });
  return withProcessLock({
    path: location.operationLock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    const current = (await readOperation(stateRoot, operationId)).operation;
    if (current.state !== "created") {
      throw new CliError("Only a created native subagent operation can complete");
    }
    const finalGitProof = captureGitProof(current.initial_git_proof.root);
    if (stableStringify(finalGitProof) !== stableStringify(current.initial_git_proof)) {
      throw new CliError("Native subagent completion changed Git HEAD, its symbolic ref, or worktree status");
    }
    const evidenceDigests = requireStringArray(evidence_digests, "evidence_digests", {
      maxItems: 128,
      maxText: 64,
    }).map((digest, index) => requireDigest(digest, `evidence_digests[${index}]`)).sort();
    if (new Set(evidenceDigests).size !== evidenceDigests.length) {
      throw new CliError("evidence_digests contains duplicates");
    }
    const result = {
      classification: requireEnum(classification, CLASSIFICATIONS, "classification"),
      summary: requireText(summary, "summary", { max: 4000 }),
      evidence_digests: evidenceDigests,
      final_git_proof: finalGitProof,
    };
    return writeOperation(stateRoot, operationId, {
      ...current,
      state: "completed",
      result: {
        ...result,
        result_digest: sha256(stableStringify(resultSeed(current.operation_id, result))),
      },
      completed_at: nowIso(now),
    });
  });
}

export async function recordSubagentCoordinatorDisposition({
  stateRoot,
  operationId,
  disposition,
  now = Date.now(),
}) {
  const location = paths(stateRoot, { operationId });
  return withProcessLock({
    path: location.operationLock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    const current = (await readOperation(stateRoot, operationId)).operation;
    const acceptedDisposition = requireEnum(disposition, ["accepted", "rejected"], "disposition");
    if (current.state === acceptedDisposition) return current;
    if (current.state !== "completed") {
      throw new CliError("Only completed native subagent evidence can receive a coordinator disposition");
    }
    if (acceptedDisposition === "accepted" && current.result.classification !== "PASS") {
      throw new CliError("Only a PASS native-subagent result may be accepted");
    }
    return writeOperation(stateRoot, operationId, {
      ...current,
      state: acceptedDisposition,
      coordinator_disposition: acceptedDisposition,
      disposed_at: nowIso(now),
    });
  });
}

export async function subagentOperationStatus({ stateRoot, operationId }) {
  return (await readOperation(stateRoot, operationId)).operation;
}

export function isSubagentDependencyUnblocked(operation) {
  return validateOperation(operation).state === "accepted";
}

export function acceptedSubagentDependency(operation) {
  const current = validateOperation(operation);
  if (current.state !== "accepted" || current.result === null) {
    throw new CliError("Only an accepted native subagent result can unblock a dependent task");
  }
  return clone(current);
}
