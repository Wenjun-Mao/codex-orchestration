import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState, gitIsAncestor, gitSnapshot } from "./git.mjs";
import { assertCommittedWriteScope } from "./committed-write-scope.mjs";
import { runIntegrationRecords } from "./integration.mjs";
import { readRun } from "./run-lifecycle.mjs";
import { readRuntimeContext } from "./runtime-context.mjs";
import {
  activeWorkflowRepositoryAuthority,
  commitWorkflowOperationPreparation,
  transitionWorkflowOperationClaim,
  workflowJournalStatus,
  workflowTaskContractAuthority,
} from "./workflow-journal.mjs";
import {
  coordinatorBindingDigest,
  validateGeneratedTaskContract,
} from "./workflow-plan.mjs";

export const COORDINATOR_WORK_KIND = "codex-flow-v097-coordinator-work";
export const COORDINATOR_WORK_ID_PREFIX = "coordinator-work-v1-";

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit ISO-8601 timestamp`);
  }
  return result;
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function commit(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a concrete Git revision`);
  return result;
}

function coordinatorBinding(value, label = "coordinator_binding") {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const result = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1, max: 2147483647 }),
    binding_digest: digest(value.binding_digest, `${label}.binding_digest`),
  };
  if (result.binding_digest !== coordinatorBindingDigest(result)) {
    throw new CliError(`${label}.binding_digest does not match its identity`);
  }
  return result;
}

function repositorySnapshot(value, label) {
  requireExactFields(value, {
    required: ["root", "common_dir", "branch", "revision", "cleanliness"],
  }, label);
  const snapshot = {
    root: resolve(requireText(value.root, `${label}.root`, { max: 2048 })),
    common_dir: resolve(requireText(value.common_dir, `${label}.common_dir`, { max: 2048 })),
    branch: requireText(value.branch, `${label}.branch`, { max: 256 }),
    revision: commit(value.revision, `${label}.revision`),
    cleanliness: requireEnum(value.cleanliness, ["clean"], `${label}.cleanliness`),
  };
  return snapshot;
}

function resultEvidence(value, label) {
  if (value === null) return null;
  requireExactFields(value, { required: ["kind", "baseline_revision", "final_revision"] }, label);
  const result = {
    kind: requireEnum(value.kind, ["no-change", "mutation"], `${label}.kind`),
    baseline_revision: commit(value.baseline_revision, `${label}.baseline_revision`),
    final_revision: commit(value.final_revision, `${label}.final_revision`),
  };
  if ((result.kind === "no-change") !== (result.baseline_revision === result.final_revision)) {
    throw new CliError(`${label}.kind does not match its revisions`);
  }
  return result;
}

function checkEvidence(value, label) {
  requireExactFields(value, {
    required: ["check_id", "argv", "exit_code", "stdout_digest", "stderr_digest"],
  }, label);
  if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > 64) {
    throw new CliError(`${label}.argv must contain between 1 and 64 arguments`);
  }
  return {
    check_id: requireText(value.check_id, `${label}.check_id`, { max: 128, safeId: true }),
    argv: value.argv.map((entry, index) => requireText(entry, `${label}.argv[${index}]`, { max: 2048 })),
    exit_code: requireInteger(value.exit_code, `${label}.exit_code`, { min: 0, max: 0 }),
    stdout_digest: digest(value.stdout_digest, `${label}.stdout_digest`),
    stderr_digest: digest(value.stderr_digest, `${label}.stderr_digest`),
  };
}

function verificationEvidence(value, label) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["verification_id", "classification", "subject_revision", "checks", "evidence_digest"],
  }, label);
  if (!Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 64) {
    throw new CliError(`${label}.checks must contain between 1 and 64 checks`);
  }
  const checks = value.checks.map((entry, index) => checkEvidence(entry, `${label}.checks[${index}]`));
  if (new Set(checks.map((entry) => entry.check_id)).size !== checks.length) {
    throw new CliError(`${label}.checks contains duplicate check IDs`);
  }
  const seed = {
    classification: requireEnum(value.classification, ["PASS"], `${label}.classification`),
    subject_revision: commit(value.subject_revision, `${label}.subject_revision`),
    checks,
  };
  const evidenceDigest = digest(value.evidence_digest, `${label}.evidence_digest`);
  if (evidenceDigest !== sha256(stableStringify(seed))) {
    throw new CliError(`${label}.evidence_digest does not match its checks`);
  }
  const verificationId = requireText(value.verification_id, `${label}.verification_id`, { max: 128, safeId: true });
  if (verificationId !== `coordinator-verification-v1-${evidenceDigest}`) {
    throw new CliError(`${label}.verification_id does not match its evidence`);
  }
  return { verification_id: verificationId, ...seed, evidence_digest: evidenceDigest };
}

function identityForContract(contract) {
  return {
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
    contract_id: contract.contract_id,
  };
}

function localWorkId(identity) {
  return `${COORDINATOR_WORK_ID_PREFIX}${sha256(stableStringify(identity))}`;
}

function recordPaths(stateRoot, localWorkIdValue) {
  const id = requireText(localWorkIdValue, "local_work_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "coordinator-work");
  const record = resolve(root, "records", `${id}.json`);
  if (basename(record) !== `${id}.json` || dirname(record) !== resolve(root, "records")) {
    throw new CliError("Unsafe coordinator-work record path");
  }
  return { record, lock: resolve(root, "locks", `${id}.lock.json`) };
}

export function validateCoordinatorWorkRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "local_work_id", "run_id", "runtime_context_digest",
      "configuration_digest", "repository_id", "common_dir", "coordinator_binding",
      "plan_id", "revision_digest", "task_id", "task_digest", "contract_id",
      "baseline", "result", "verification", "state", "started_at", "completed_at",
    ],
  }, "coordinator-work record");
  if (value.schema_version !== 1 || value.kind !== COORDINATOR_WORK_KIND) {
    throw new CliError("Unsupported coordinator-work record");
  }
  const identity = {
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, "runtime_context_digest"),
    configuration_digest: digest(value.configuration_digest, "configuration_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: resolve(requireText(value.common_dir, "common_dir", { max: 2048 })),
    coordinator_binding: coordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, "revision_digest"),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, "task_digest"),
    contract_id: digest(value.contract_id, "contract_id"),
  };
  const record = {
    schema_version: 1,
    kind: COORDINATOR_WORK_KIND,
    local_work_id: requireText(value.local_work_id, "local_work_id", { max: 128, safeId: true }),
    ...identity,
    baseline: repositorySnapshot(value.baseline, "baseline"),
    result: resultEvidence(value.result, "result"),
    verification: verificationEvidence(value.verification, "verification"),
    state: requireEnum(value.state, ["started", "completed"], "state"),
    started_at: timestamp(value.started_at, "started_at"),
    completed_at: value.completed_at === null ? null : timestamp(value.completed_at, "completed_at"),
  };
  if (record.local_work_id !== localWorkId(identity)) {
    throw new CliError("local_work_id does not match its task-contract identity");
  }
  if (record.baseline.common_dir !== record.common_dir) {
    throw new CliError("Coordinator-work baseline belongs to another repository");
  }
  if (record.state === "started" && (record.result !== null || record.verification !== null || record.completed_at !== null)) {
    throw new CliError("Started coordinator work cannot contain terminal evidence");
  }
  if (record.state === "completed" && (record.result === null || record.verification === null || record.completed_at === null)) {
    throw new CliError("Completed coordinator work requires result and verification evidence");
  }
  if (record.completed_at !== null && Date.parse(record.completed_at) < Date.parse(record.started_at)) {
    throw new CliError("Coordinator work completed before it started");
  }
  if (record.result !== null && (
    record.result.baseline_revision !== record.baseline.revision
    || record.verification.subject_revision !== record.result.final_revision
  )) throw new CliError("Coordinator-work terminal evidence does not match its revisions");
  return record;
}

function assertCurrentCoordinator(contract) {
  const threadId = process.env.CODEX_THREAD_ID;
  if (typeof threadId !== "string" || threadId !== contract.coordinator_binding.thread_id) {
    throw new CliError("Coordinator work must be claimed by the active coordinator task", 73);
  }
}

async function readRecord(stateRoot, id) {
  const raw = await readJson(recordPaths(stateRoot, id).record, {
    allowMissing: true,
    guardRoot: guardRoot(stateRoot),
  });
  if (raw === null) throw new CliError(`Unknown coordinator work: ${id}`);
  return validateCoordinatorWorkRecord(raw);
}

async function coordinatorWorkRecordsForRun(stateRoot, runId) {
  const directory = resolve(stateRoot, "coordinator-work", "records");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new CliError(`Coordinator-work records contain an unsupported entry: ${entry.name}`, 73);
    }
    const record = validateCoordinatorWorkRecord(await readJson(resolve(directory, entry.name), {
      guardRoot: guardRoot(stateRoot),
    }));
    if (record.run_id === runId) records.push(record);
  }
  return records;
}

function contractWritePaths(workflow, contractId, label) {
  const entry = workflow.contracts.find((candidate) => candidate.contract.contract_id === contractId);
  if (entry === undefined) throw new CliError(`${label} has no exact workflow task contract`, 73);
  return entry.contract.task.write_paths;
}

async function assertCoordinatorCommittedScope({ stateRoot, record, repositoryPath }) {
  const { run } = await readRun({ gitCommonDirectory: guardRoot(stateRoot), runId: record.run_id });
  const [workflow, runtime, persistedWorks, integrations] = await Promise.all([
    workflowJournalStatus({ stateRoot, runId: record.run_id, planId: record.plan_id }),
    readRuntimeContext({ gitCommonDirectory: guardRoot(stateRoot), runtimeId: run.runtime_id }),
    coordinatorWorkRecordsForRun(stateRoot, record.run_id),
    runIntegrationRecords({ stateRoot, runId: record.run_id }),
  ]);
  const completedWorks = persistedWorks
    .map((entry) => entry.local_work_id === record.local_work_id ? record : entry)
    .filter((entry) => entry.state === "completed")
    .map((entry) => ({
      taskId: entry.task_id,
      baselineRevision: entry.baseline.revision,
      finalRevision: entry.result.final_revision,
      writePaths: contractWritePaths(workflow, entry.contract_id, "Coordinator work"),
    }));
  const integrationAuthorities = integrations
    .filter((entry) => entry.state === "reconciled")
    .map((entry) => ({
      taskId: entry.task_id,
      prepared_main_tip: entry.prepared_main_tip,
      executor_tip: entry.executor_tip,
      reconciled_main_tip: entry.reconciled_main_tip,
      outcome: entry.outcome,
      writePaths: contractWritePaths(workflow, entry.contract_id, "Integration"),
    }));
  return assertCommittedWriteScope({
    repositoryPath,
    admissionRevision: runtime.context.repository.revision,
    finalRevision: record.result.final_revision,
    runPathFences: run.plan.path_fences,
    coordinatorWorks: completedWorks,
    integrations: integrationAuthorities,
  });
}

function assertReplayRepository(record, repositoryPath) {
  const snapshot = gitSnapshot(repositoryPath);
  if (
    snapshot.cleanliness !== "clean"
    || snapshot.root !== record.baseline.root
    || snapshot.commonDir !== record.common_dir
    || snapshot.branch !== record.baseline.branch
  ) throw new CliError("Coordinator-work replay requires its clean authoritative repository", 73);
  assertAncestor(repositoryPath, record.baseline.revision, snapshot.revision);
  if (record.state === "completed") {
    assertAncestor(repositoryPath, record.result.final_revision, snapshot.revision);
  }
  return snapshot;
}

function assertMatchingStartAuthority(record, contract) {
  if (
    stableStringify(identityForContract(record)) !== stableStringify(identityForContract(contract))
    || record.baseline.revision !== contract.current_baseline.revision
  ) throw new CliError("Existing coordinator-work start has different authority", 73);
}

async function assertPersistedWorkAuthority({ stateRoot, record, repositoryPath }) {
  const contractEntry = await workflowTaskContractAuthority({
    stateRoot,
    runId: record.run_id,
    planId: record.plan_id,
    contractId: record.contract_id,
  });
  if (record.baseline.revision !== contractEntry.contract.current_baseline.revision) {
    throw new CliError("Coordinator-work baseline does not match its persisted task contract", 73);
  }
  const snapshot = assertReplayRepository(record, repositoryPath);
  const { repositorySnapshot } = await activeWorkflowRepositoryAuthority({
    stateRoot,
    runId: record.run_id,
    planId: record.plan_id,
  });
  if (
    snapshot.root !== repositorySnapshot.root
    || snapshot.commonDir !== repositorySnapshot.commonDir
    || snapshot.branch !== repositorySnapshot.branch
    || snapshot.revision !== repositorySnapshot.revision
  ) {
    throw new CliError("Coordinator-work repository is not the active run authority", 73);
  }
  return { contractEntry, snapshot };
}

export async function startCoordinatorWork({
  stateRoot,
  taskContract,
  repositoryPath,
  now = Date.now(),
  interruptAfterStartPersist = null,
}) {
  const contract = validateGeneratedTaskContract(taskContract);
  if (contract.task.execution_kind !== "coordinator") {
    throw new CliError("Coordinator work requires a coordinator execution_kind task");
  }
  assertCurrentCoordinator(contract);
  const identity = identityForContract(contract);
  const id = localWorkId(identity);
  const paths = recordPaths(stateRoot, id);
  const existing = await readJson(paths.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (existing !== null) {
    const recovered = validateCoordinatorWorkRecord(existing);
    assertMatchingStartAuthority(recovered, contract);
    await assertPersistedWorkAuthority({ stateRoot, record: recovered, repositoryPath });
    await transitionWorkflowOperationClaim({ stateRoot, coordinatorWorkRecord: recovered });
    return recovered;
  }
  const snapshot = gitSnapshot(repositoryPath);
  if (snapshot.cleanliness !== "clean" || snapshot.commonDir !== contract.common_dir) {
    throw new CliError("Coordinator work requires the clean authoritative repository", 73);
  }
  if (snapshot.revision !== contract.current_baseline.revision) {
    throw new CliError("Coordinator work baseline drifted before start", 73);
  }
  const record = validateCoordinatorWorkRecord({
    schema_version: 1,
    kind: COORDINATOR_WORK_KIND,
    local_work_id: id,
    ...identity,
    baseline: {
      root: snapshot.root,
      common_dir: snapshot.commonDir,
      branch: snapshot.branch,
      revision: snapshot.revision,
      cleanliness: snapshot.cleanliness,
    },
    result: null,
    verification: null,
    state: "started",
    started_at: new Date(now).toISOString(),
    completed_at: null,
  });
  await commitWorkflowOperationPreparation({
    stateRoot,
    coordinatorWorkRecord: record,
    persistNative: async () => atomicWriteJson(paths.record, record, {
      exclusive: true,
      guardRoot: guardRoot(stateRoot),
      mode: 0o600,
    }),
    compensateNative: async () => rm(paths.record, { force: true }),
    interruptAfterNativePersist: interruptAfterStartPersist,
  });
  return record;
}

function validateCheckRequest(value, index) {
  requireExactFields(value, { required: ["check_id", "argv"], optional: ["timeout_seconds"] }, `checks[${index}]`);
  if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > 64) {
    throw new CliError(`checks[${index}].argv must contain between 1 and 64 arguments`);
  }
  return {
    check_id: requireText(value.check_id, `checks[${index}].check_id`, { max: 128, safeId: true }),
    argv: value.argv.map((entry, argumentIndex) => requireText(
      entry,
      `checks[${index}].argv[${argumentIndex}]`,
      { max: 2048 },
    )),
    timeout_seconds: value.timeout_seconds === undefined
      ? 300
      : requireInteger(value.timeout_seconds, `checks[${index}].timeout_seconds`, { min: 1, max: 3600 }),
  };
}

function runChecks(repositoryPath, checks) {
  return checks.map((check) => {
    const [command, ...args] = check.argv;
    const result = spawnSync(command, args, {
      cwd: repositoryPath,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      timeout: check.timeout_seconds * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const stdout = String(result.stdout ?? "");
    const stderr = String(result.stderr ?? "");
    if (result.error || result.status !== 0) {
      throw new CliError(`Coordinator verification failed: ${check.check_id}`, 73);
    }
    return {
      check_id: check.check_id,
      argv: check.argv,
      exit_code: 0,
      stdout_digest: sha256(stdout),
      stderr_digest: sha256(stderr),
    };
  });
}

function assertAncestor(repositoryPath, baseline, finalRevision) {
  if (!gitIsAncestor(repositoryPath, baseline, finalRevision)) {
    throw new CliError("Coordinator work final revision does not descend from its required authority", 73);
  }
}

function assertMatchingCompletionRequest(record, requests) {
  const persistedRequests = record.verification.checks.map(({ check_id, argv }) => ({
    check_id,
    argv,
  }));
  const normalizedRequests = requests.map(({ check_id, argv }) => ({
    check_id,
    argv,
  }));
  if (stableStringify(persistedRequests) !== stableStringify(normalizedRequests)) {
    throw new CliError("Completed coordinator work has different verification authority", 73);
  }
}

export async function completeCoordinatorWork({
  stateRoot,
  localWorkId: id,
  repositoryPath,
  checks,
  now = Date.now(),
  interruptAfterCompletionPersist = null,
}) {
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 64) {
    throw new CliError("Coordinator work completion requires between 1 and 64 checks");
  }
  if (interruptAfterCompletionPersist !== null && typeof interruptAfterCompletionPersist !== "function") {
    throw new CliError("Coordinator-work completion interruption hook must be a function");
  }
  const requests = checks.map(validateCheckRequest);
  if (new Set(requests.map((entry) => entry.check_id)).size !== requests.length) {
    throw new CliError("Coordinator verification check IDs must be unique");
  }
  const paths = recordPaths(stateRoot, id);
  return withProcessLock({
    path: paths.lock,
    guardRoot: guardRoot(stateRoot),
    label: `coordinator work ${id}`,
  }, async () => {
    const current = await readRecord(stateRoot, id);
    if (process.env.CODEX_THREAD_ID !== current.coordinator_binding.thread_id) {
      throw new CliError("Coordinator work must be completed by its authoritative coordinator", 73);
    }
    if (current.state === "completed") {
      assertMatchingCompletionRequest(current, requests);
      await assertPersistedWorkAuthority({ stateRoot, record: current, repositoryPath });
      await transitionWorkflowOperationClaim({ stateRoot, coordinatorWorkRecord: current });
      return current;
    }
    const { contractEntry } = await assertPersistedWorkAuthority({
      stateRoot,
      record: current,
      repositoryPath,
    });
    if (contractEntry.claim.state !== "started" || contractEntry.claim.operation_id !== current.local_work_id) {
      throw new CliError("Coordinator-work claim is not started by this exact record", 73);
    }
    const checkEvidenceRecords = runChecks(repositoryPath, requests);
    const { snapshot } = await assertPersistedWorkAuthority({
      stateRoot,
      record: current,
      repositoryPath,
    });
    const verificationSeed = {
      classification: "PASS",
      subject_revision: snapshot.revision,
      checks: checkEvidenceRecords,
    };
    const evidenceDigest = sha256(stableStringify(verificationSeed));
    const completedAt = new Date(now).toISOString();
    const completed = validateCoordinatorWorkRecord({
      ...current,
      result: {
        kind: snapshot.revision === current.baseline.revision ? "no-change" : "mutation",
        baseline_revision: current.baseline.revision,
        final_revision: snapshot.revision,
      },
      verification: {
        verification_id: `coordinator-verification-v1-${evidenceDigest}`,
        ...verificationSeed,
        evidence_digest: evidenceDigest,
      },
      state: "completed",
      completed_at: completedAt,
    });
    await assertCoordinatorCommittedScope({ stateRoot, record: completed, repositoryPath });
    await atomicWriteJson(paths.record, completed, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    if (interruptAfterCompletionPersist !== null) await interruptAfterCompletionPersist();
    await transitionWorkflowOperationClaim({ stateRoot, coordinatorWorkRecord: completed });
    return completed;
  });
}

export async function coordinatorWorkStatus({ stateRoot, localWorkId: id }) {
  return readRecord(stateRoot, id);
}
