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

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const STATES = ["prepared", "created", "completed", "accepted", "rejected"];
const CLASSIFICATIONS = ["PASS", "BLOCKED", "FAIL"];

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

function validateCoordinatorBinding(value, label) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const binding = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1, max: 2147483647 }),
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
  const branch = value.branch === null ? null : requireText(value.branch, `${label}.branch`, { max: 256 });
  const headRef = value.head_ref === null ? null : requireText(value.head_ref, `${label}.head_ref`, { max: 512 });
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
  const head = runGit(repository.root, ["rev-parse", "--verify", "HEAD^{commit}"], "Subagent Git HEAD").stdout.trim();
  const symbolic = runGit(repository.root, ["symbolic-ref", "--quiet", "HEAD"], "Subagent symbolic HEAD", {
    allowFailure: true,
  });
  if (![0, 1].includes(symbolic.status)) throw new CliError("Subagent symbolic HEAD inspection failed");
  const headRef = symbolic.status === 0 ? symbolic.stdout.trim() : null;
  const headRefRevision = headRef === null
    ? null
    : runGit(repository.root, ["rev-parse", "--verify", `${headRef}^{commit}`], "Subagent branch ref").stdout.trim();
  const status = runGit(repository.root, ["status", "--porcelain=v1", "-z"], "Subagent Git status").stdout;
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
  if (value.result_digest !== expected) throw new CliError(`${label}.result_digest does not match subagent evidence`);
  return { ...result, result_digest: expected };
}

function validateOperation(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "contract_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "mode", "model", "reasoning_effort", "fork_turns", "prompt_digest",
      "initial_git_proof", "state", "agent_id", "result", "coordinator_disposition",
      "prepared_at", "created_at", "completed_at", "disposed_at",
    ],
  }, "Native subagent operation");
  if (value.schema_version !== SUBAGENT_OPERATION_SCHEMA_VERSION || value.kind !== "codex-flow-native-subagent-operation") {
    throw new CliError("Unsupported native subagent operation");
  }
  const selection = validateSelection(value, "Native subagent operation");
  const operation = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: "codex-flow-native-subagent-operation",
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
  const expectedOperationId = `subagent-operation-v1-${sha256(stableStringify(operationSeed(operation)))}`;
  if (value.operation_id !== expectedOperationId) throw new CliError("operation_id does not match the native subagent request");
  const state = requireEnum(value.state, STATES, "state");
  const agentId = value.agent_id === null ? null : requireText(value.agent_id, "agent_id", { max: 256 });
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
  if (state === "prepared" && (agentId !== null || result !== null || coordinatorDisposition !== null
    || timestamps.created_at !== null || timestamps.completed_at !== null || timestamps.disposed_at !== null)) {
    throw new CliError("Prepared native subagent operations cannot contain host or result state");
  }
  if (state === "created" && (agentId === null || result !== null || coordinatorDisposition !== null
    || timestamps.created_at === null || timestamps.completed_at !== null || timestamps.disposed_at !== null)) {
    throw new CliError("Created native subagent operations require only created identity state");
  }
  if (state === "completed" && (agentId === null || result === null || coordinatorDisposition !== null
    || timestamps.created_at === null || timestamps.completed_at === null || timestamps.disposed_at !== null)) {
    throw new CliError("Completed native subagent operations require classified read-only evidence without a disposition");
  }
  if (["accepted", "rejected"].includes(state)) {
    if (agentId === null || result === null || coordinatorDisposition !== state
      || timestamps.created_at === null || timestamps.completed_at === null || timestamps.disposed_at === null) {
      throw new CliError("Disposed native subagent operations require the matching coordinator disposition");
    }
    if (state === "accepted" && result.classification !== "PASS") {
      throw new CliError("Only a PASS native-subagent result may be accepted");
    }
  }
  return {
    ...operation,
    operation_id: expectedOperationId,
    state,
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

function paths(stateRoot, operationId) {
  const id = requireText(operationId, "operation_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "subagents");
  return {
    record: safeChild(resolve(root, "records"), `${id}.json`),
    lock: safeChild(resolve(root, "locks"), `${id}.lock`),
  };
}

async function readOperation(stateRoot, operationId) {
  const location = paths(stateRoot, operationId);
  const raw = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (!raw) throw new CliError("Native subagent operation does not exist");
  return { location, operation: validateOperation(raw) };
}

async function assertRepositoryAuthority(stateRoot, contract, proof) {
  const journalCommonDir = await realpath(guardRoot(stateRoot)).catch(() => null);
  const contractCommonDir = await realpath(contract.common_dir).catch(() => null);
  const proofCommonDir = await realpath(proof.common_dir).catch(() => null);
  if (!journalCommonDir || contractCommonDir !== journalCommonDir || proofCommonDir !== journalCommonDir) {
    throw new CliError("Native subagent repository does not match its task contract and journal common directory");
  }
  if (proof.head !== contract.current_baseline.revision || proof.cleanliness !== "clean") {
    throw new CliError("Native subagent must start clean at the exact generated-contract baseline");
  }
}

function immutable(operation) {
  return operationSeed(operation);
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
  await assertWorkflowTaskContractCurrent({
    stateRoot,
    runId: contract.run_id,
    planId: contract.plan_id,
    taskContract: contract,
  });
  const selection = validateSelection({ model, reasoning_effort, fork_turns, mode }, "Subagent request");
  if (
    selection.model !== contract.task.model
    || selection.reasoning_effort !== contract.task.reasoning_effort
    || selection.fork_turns !== contract.task.fork_turns
    || selection.mode !== contract.task.mode
  ) {
    throw new CliError("Native subagent selection must exactly match its generated task contract");
  }
  const initialGitProof = captureGitProof(worktree_path);
  await assertRepositoryAuthority(stateRoot, contract, initialGitProof);
  const operation = {
    schema_version: SUBAGENT_OPERATION_SCHEMA_VERSION,
    kind: "codex-flow-native-subagent-operation",
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
  const record = validateOperation({
    ...operation,
    operation_id: `subagent-operation-v1-${sha256(stableStringify(operationSeed(operation)))}`,
    state: "prepared",
    agent_id: null,
    result: null,
    coordinator_disposition: null,
    prepared_at: new Date(now).toISOString(),
    created_at: null,
    completed_at: null,
    disposed_at: null,
  });
  const location = paths(stateRoot, record.operation_id);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${record.operation_id}`,
  }, async () => {
    const existing = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    if (existing) {
      const current = validateOperation(existing);
      if (stableStringify(immutable(current)) !== stableStringify(immutable(record))) {
        throw new CliError("Native subagent operation identity collides with a different request");
      }
      return current;
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    return record;
  });
}

export async function reconcileCreatedSubagent({ stateRoot, operationId, agent_id, now = Date.now() }) {
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    const { operation: current } = await readOperation(stateRoot, operationId);
    const agentId = requireText(agent_id, "agent_id", { max: 256 });
    if (current.state === "created" && current.agent_id === agentId) return current;
    if (current.state !== "prepared") throw new CliError("Only a prepared native subagent operation can reconcile creation");
    const updated = validateOperation({
      ...current,
      state: "created",
      agent_id: agentId,
      created_at: new Date(now).toISOString(),
    });
    await atomicWriteJson(location.record, updated, { guardRoot: guardRoot(stateRoot) });
    return updated;
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
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    const { operation: current } = await readOperation(stateRoot, operationId);
    if (current.state !== "created") throw new CliError("Only a created native subagent operation can complete");
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
    const updated = validateOperation({
      ...current,
      state: "completed",
      result: {
        ...result,
        result_digest: sha256(stableStringify(resultSeed(current.operation_id, result))),
      },
      completed_at: new Date(now).toISOString(),
    });
    await atomicWriteJson(location.record, updated, { guardRoot: guardRoot(stateRoot) });
    return updated;
  });
}

export async function recordSubagentCoordinatorDisposition({
  stateRoot,
  operationId,
  disposition,
  now = Date.now(),
}) {
  const location = paths(stateRoot, operationId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `native subagent ${operationId}`,
  }, async () => {
    const { operation: current } = await readOperation(stateRoot, operationId);
    const acceptedDisposition = requireEnum(disposition, ["accepted", "rejected"], "disposition");
    if (current.state === acceptedDisposition) return current;
    if (current.state !== "completed") {
      throw new CliError("Only completed native subagent evidence can receive a coordinator disposition");
    }
    if (acceptedDisposition === "accepted" && current.result.classification !== "PASS") {
      throw new CliError("Only a PASS native-subagent result may be accepted");
    }
    const updated = validateOperation({
      ...current,
      state: acceptedDisposition,
      coordinator_disposition: acceptedDisposition,
      disposed_at: new Date(now).toISOString(),
    });
    await atomicWriteJson(location.record, updated, { guardRoot: guardRoot(stateRoot) });
    return updated;
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
  return JSON.parse(stableStringify(current));
}
