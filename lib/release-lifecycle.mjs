import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState, gitSnapshot } from "./git.mjs";
import {
  authenticateVisibleTaskWorktreeBinding,
  visibleTaskCreationStatus,
} from "./task-creation-v07.mjs";
import {
  coordinatorBindingDigest,
  validateGeneratedTaskContract,
} from "./workflow-plan.mjs";

const RELEASE_KIND = "codex-flow-v07-task-release";
const DELIVERY_OUTCOMES = ["sent", "rejected-before-send", "ambiguous"];
const DIGEST = /^[0-9a-f]{64}$/;
const WORKTREE_BINDING_ID = /^worktree-binding-v1-[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const MAX_PROMPT_BYTES = 512 * 1024;

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe release state path");
  }
  return path;
}

function paths(stateRoot, releaseId) {
  requireText(releaseId, "release_id", { max: 128, safeId: true });
  const root = resolve(stateRoot, "releases");
  return {
    record: safeChild(resolve(root, "records"), `${releaseId}.json`),
    lock: safeChild(resolve(root, "locks"), `${releaseId}.lock.json`),
  };
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function nullableWorktreeBindingId(value, label = "worktree_binding_id") {
  if (value === null) return null;
  const result = requireText(value, label, { max: 128, safeId: true });
  if (!WORKTREE_BINDING_ID.test(result)) {
    throw new CliError(`${label} must be a content-addressed worktree binding ID`);
  }
  return result;
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
}

function nowIso(now) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Release clock must be a finite timestamp");
  return new Date(milliseconds).toISOString();
}

function absolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
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
    binding_digest: digest(value.binding_digest, "coordinator_binding.binding_digest"),
  };
  if (binding.binding_digest !== coordinatorBindingDigest(binding)) {
    throw new CliError("coordinator_binding.binding_digest does not match the coordinator identity");
  }
  return binding;
}

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function canonicalIdentityFromContract(contract, operationId, readyThreadId, worktreeBindingId = null) {
  return {
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: clone(contract.coordinator_binding),
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
    operation_id: requireText(operationId, "operation_id", { max: 128, safeId: true }),
    ready_thread_id: requireText(readyThreadId, "ready_thread_id", { max: 256, safeId: true }),
    worktree_binding_id: nullableWorktreeBindingId(worktreeBindingId),
  };
}

function validateCanonicalIdentity(value, label = "release identity") {
  requireExactFields(value, {
    required: [
      "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
      "common_dir", "coordinator_binding", "plan_id", "revision_digest",
      "task_id", "task_digest", "contract_id", "operation_id", "ready_thread_id",
      "worktree_binding_id",
    ],
  }, label);
  return {
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    configuration_digest: digest(value.configuration_digest, `${label}.configuration_digest`),
    repository_id: requireText(value.repository_id, `${label}.repository_id`, { max: 128, safeId: true }),
    common_dir: absolutePath(value.common_dir, `${label}.common_dir`),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, `${label}.revision_digest`),
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, `${label}.task_digest`),
    contract_id: digest(value.contract_id, `${label}.contract_id`),
    operation_id: requireText(value.operation_id, `${label}.operation_id`, { max: 128, safeId: true }),
    ready_thread_id: requireText(value.ready_thread_id, `${label}.ready_thread_id`, { max: 256, safeId: true }),
    worktree_binding_id: nullableWorktreeBindingId(
      value.worktree_binding_id,
      `${label}.worktree_binding_id`,
    ),
  };
}

function releaseIdFromIdentity(identity) {
  return `release-v1-${sha256(stableStringify(validateCanonicalIdentity(identity)))}`;
}

export function releaseIdFor(options) {
  requireExactFields(options, {
    required: ["taskContract", "operationId", "readyThreadId"],
    optional: ["worktreeBindingId"],
  }, "Release ID request");
  const { taskContract, operationId, readyThreadId, worktreeBindingId = null } = options;
  const contract = validateGeneratedTaskContract(taskContract);
  return releaseIdFromIdentity(canonicalIdentityFromContract(
    contract,
    operationId,
    readyThreadId,
    worktreeBindingId,
  ));
}

function renderExecutorPrompt({ contract, releaseId, operationId, readyThreadId }) {
  return [
    "# Codex Flow v0.7 accepted task release",
    "",
    "Invoke `codex-orchestration:execute` and execute only the generated task contract below.",
    "Do not broaden its objective, dependencies, ownership, model selection, or Git baseline.",
    "Return exactly one terminal receipt through the accepted v0.7 callback path.",
    "",
    `Release: ${releaseId}`,
    `Visible-task operation: ${operationId}`,
    `Ready task: ${readyThreadId}`,
    `Generated contract: ${contract.contract_id}`,
    "",
    "<generated-task-contract>",
    stableStringify(contract),
    "</generated-task-contract>",
    "",
  ].join("\n");
}

function validateDelivery(value) {
  requireExactFields(value, {
    required: ["outcome", "reconciled_at"],
  }, "Release delivery");
  return {
    outcome: requireEnum(value.outcome, DELIVERY_OUTCOMES, "Release delivery outcome"),
    reconciled_at: timestamp(value.reconciled_at, "Release delivery reconciled_at"),
  };
}

function validateAcceptance(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "ready_thread_id", "contract_id", "runtime_context_digest",
      "common_dir", "accepted_at",
    ],
  }, "Release acceptance");
  return {
    ready_thread_id: requireText(value.ready_thread_id, "acceptance.ready_thread_id", {
      max: 256,
      safeId: true,
    }),
    contract_id: digest(value.contract_id, "acceptance.contract_id"),
    runtime_context_digest: digest(
      value.runtime_context_digest,
      "acceptance.runtime_context_digest",
    ),
    common_dir: absolutePath(value.common_dir, "acceptance.common_dir"),
    accepted_at: timestamp(value.accepted_at, "acceptance.accepted_at"),
  };
}

function recordIdentity(record) {
  return Object.fromEntries([
    "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
    "common_dir", "coordinator_binding", "plan_id", "revision_digest",
    "task_id", "task_digest", "contract_id", "operation_id", "ready_thread_id",
    "worktree_binding_id",
  ].map((key) => [key, record[key]]));
}

function assertContractIdentity(contract, identity, label) {
  const expected = canonicalIdentityFromContract(
    contract,
    identity.operation_id,
    identity.ready_thread_id,
    identity.worktree_binding_id,
  );
  if (stableStringify(expected) !== stableStringify(identity)) {
    throw new CliError(`${label} does not match the canonical generated task contract`, 73);
  }
}

export function validateReleaseRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "release_id", "run_id",
      "runtime_context_digest", "configuration_digest", "repository_id",
      "common_dir", "coordinator_binding", "plan_id", "revision_digest",
      "task_id", "task_digest", "contract_id", "operation_id", "ready_thread_id",
      "worktree_binding_id",
      "task_contract", "prompt_digest", "prompt_length", "delivery",
      "acceptance", "prepared_at", "updated_at",
    ],
  }, "Release record");
  if (value.schema_version !== 1 || value.kind !== RELEASE_KIND) {
    throw new CliError("Invalid v0.7 release record schema");
  }
  const identity = validateCanonicalIdentity(recordIdentity(value));
  const contract = validateGeneratedTaskContract(value.task_contract);
  assertContractIdentity(contract, identity, "Release record identity");
  const record = {
    schema_version: 1,
    kind: RELEASE_KIND,
    release_id: requireText(value.release_id, "release_id", { max: 128, safeId: true }),
    ...identity,
    task_contract: contract,
    prompt_digest: digest(value.prompt_digest, "prompt_digest"),
    prompt_length: Number(value.prompt_length),
    delivery: value.delivery === null ? null : validateDelivery(value.delivery),
    acceptance: validateAcceptance(value.acceptance),
    prepared_at: timestamp(value.prepared_at, "prepared_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  };
  const expectedReleaseId = releaseIdFromIdentity(identity);
  if (record.release_id !== expectedReleaseId) {
    throw new CliError("release_id does not match the canonical release identity");
  }
  const prompt = renderExecutorPrompt({
    contract,
    releaseId: expectedReleaseId,
    operationId: record.operation_id,
    readyThreadId: record.ready_thread_id,
  });
  const promptLength = Buffer.byteLength(prompt, "utf8");
  if (
    !Number.isInteger(record.prompt_length)
    || record.prompt_length < 1
    || record.prompt_length > MAX_PROMPT_BYTES
    || record.prompt_length !== promptLength
    || record.prompt_digest !== sha256(prompt)
  ) throw new CliError("Release prompt identity does not match the canonical generated contract");
  if (Date.parse(record.updated_at) < Date.parse(record.prepared_at)) {
    throw new CliError("Release updated_at predates prepared_at");
  }
  if (record.delivery) {
    if (
      Date.parse(record.delivery.reconciled_at) < Date.parse(record.prepared_at)
      || Date.parse(record.delivery.reconciled_at) > Date.parse(record.updated_at)
    ) throw new CliError("Release delivery timestamp is outside the release lifecycle");
  }
  if (record.acceptance) {
    if (!record.delivery) throw new CliError("Release acceptance requires reconciled delivery");
    if (record.delivery.outcome === "rejected-before-send") {
      throw new CliError("Rejected release delivery cannot be accepted");
    }
    if (
      Date.parse(record.acceptance.accepted_at) < Date.parse(record.delivery.reconciled_at)
      || Date.parse(record.acceptance.accepted_at) > Date.parse(record.updated_at)
    ) throw new CliError("Release acceptance timestamp is outside the release lifecycle");
    if (
      record.acceptance.ready_thread_id !== record.ready_thread_id
      || record.acceptance.contract_id !== record.contract_id
      || record.acceptance.runtime_context_digest !== record.runtime_context_digest
      || record.acceptance.common_dir !== record.common_dir
    ) throw new CliError("Release acceptance does not match the canonical release identity");
  }
  return record;
}

function view(record, { prompt = null, dispatchPermitted = false } = {}) {
  const validated = validateReleaseRecord(record);
  return {
    ...clone(validated),
    status: validated.acceptance
      ? "accepted"
      : validated.delivery?.outcome ?? "prepared",
    dispatch_permitted: dispatchPermitted,
    ...(prompt === null ? {} : { prompt }),
  };
}

function immutableRecord(record) {
  return Object.fromEntries([
    "release_id", "run_id", "runtime_context_digest", "configuration_digest",
    "repository_id", "common_dir", "coordinator_binding", "plan_id",
    "revision_digest", "task_id", "task_digest", "contract_id", "operation_id",
    "ready_thread_id", "worktree_binding_id", "task_contract", "prompt_digest", "prompt_length",
  ].map((key) => [key, record[key]]));
}

function assertCreationMatchesContract(creation, contract, operationId) {
  if (creation.status !== "ready-unreleased" || creation.release_permitted !== true || !creation.ready) {
    throw new CliError("Task release requires a ready-unreleased visible-task creation", 73);
  }
  const expected = canonicalIdentityFromContract(
    contract,
    operationId,
    creation.ready.thread_id,
    creation.worktree_binding?.binding_id ?? null,
  );
  const actual = {
    run_id: creation.run_id,
    runtime_context_digest: creation.runtime_context_digest,
    configuration_digest: creation.configuration_digest,
    repository_id: creation.repository_id,
    common_dir: creation.common_dir,
    coordinator_binding: creation.coordinator_binding,
    plan_id: creation.plan_id,
    revision_digest: creation.revision_digest,
    task_id: creation.task_id,
    task_digest: creation.task_digest,
    contract_id: creation.contract_id,
    operation_id: creation.operation_id,
    ready_thread_id: creation.ready.thread_id,
    worktree_binding_id: creation.worktree_binding?.binding_id ?? null,
  };
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new CliError("Visible-task creation does not match the canonical generated task contract", 73);
  }
  return expected;
}

export async function prepareTaskRelease(options) {
  requireExactFields(options, {
    required: ["stateRoot", "taskContract", "operationId"],
    optional: ["now"],
  }, "Release preparation request");
  const {
    stateRoot,
    taskContract,
    operationId,
    now = Date.now(),
  } = options;
  const contract = validateGeneratedTaskContract(taskContract);
  const canonicalCommonDir = await realpath(contract.common_dir).catch(() => null);
  if (!canonicalCommonDir) throw new CliError("Generated task contract common_dir does not exist");
  const journalCommonDir = await realpath(guardRoot(stateRoot)).catch(() => null);
  if (canonicalCommonDir !== journalCommonDir || contract.common_dir !== canonicalCommonDir) {
    throw new CliError("Generated task contract common_dir does not match the release journal");
  }
  let creation = await visibleTaskCreationStatus({ stateRoot, operationId, now });
  if (creation.selector_evidence.requested.worktree.mode === "host-worktree") {
    creation = (await authenticateVisibleTaskWorktreeBinding({ stateRoot, operationId })).creation;
  }
  const identity = assertCreationMatchesContract(creation, contract, operationId);
  const releaseId = releaseIdFromIdentity(identity);
  const prompt = renderExecutorPrompt({
    contract,
    releaseId,
    operationId: identity.operation_id,
    readyThreadId: identity.ready_thread_id,
  });
  const promptLength = Buffer.byteLength(prompt, "utf8");
  if (promptLength > MAX_PROMPT_BYTES) throw new CliError("Generated executor prompt exceeds the release limit");
  const preparedAt = nowIso(now);
  const record = validateReleaseRecord({
    schema_version: 1,
    kind: RELEASE_KIND,
    release_id: releaseId,
    ...identity,
    task_contract: contract,
    prompt_digest: sha256(prompt),
    prompt_length: promptLength,
    delivery: null,
    acceptance: null,
    prepared_at: preparedAt,
    updated_at: preparedAt,
  });
  const location = paths(stateRoot, releaseId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `release ${releaseId}`,
  }, async () => {
    const existing = await readJson(location.record, {
      allowMissing: true,
      guardRoot: guardRoot(stateRoot),
    });
    if (existing) {
      const validated = validateReleaseRecord(existing);
      if (stableStringify(immutableRecord(validated)) !== stableStringify(immutableRecord(record))) {
        throw new CliError("Existing release state does not match canonical release authority", 73);
      }
      return view(validated);
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    return view(record, { prompt, dispatchPermitted: true });
  });
}

async function readRecord(stateRoot, releaseId) {
  const location = paths(stateRoot, releaseId);
  const raw = await readJson(location.record, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (!raw) throw new CliError("Release record does not exist");
  return { location, record: validateReleaseRecord(raw) };
}

export async function reconcileTaskRelease({ stateRoot, releaseId, outcome, now = Date.now() }) {
  requireEnum(outcome, DELIVERY_OUTCOMES, "release outcome");
  const location = paths(stateRoot, releaseId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `release ${releaseId}`,
  }, async () => {
    const current = (await readRecord(stateRoot, releaseId)).record;
    if (current.delivery) {
      if (current.delivery.outcome !== outcome) {
        throw new CliError("Release delivery is already reconciled differently", 73);
      }
      return view(current);
    }
    const reconciledAt = nowIso(now);
    if (Date.parse(reconciledAt) < Date.parse(current.prepared_at)) {
      throw new CliError("Release delivery cannot predate preparation");
    }
    const next = validateReleaseRecord({
      ...current,
      delivery: { outcome, reconciled_at: reconciledAt },
      updated_at: reconciledAt,
    });
    await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
    return view(next);
  });
}

export async function acceptTaskRelease({
  stateRoot,
  releaseId,
  readyThreadId,
  contractId,
  runtimeContextDigest,
  commonDir,
  now = Date.now(),
}) {
  const location = paths(stateRoot, releaseId);
  return withProcessLock({
    path: location.lock,
    guardRoot: guardRoot(stateRoot),
    label: `release ${releaseId}`,
  }, async () => {
    const current = (await readRecord(stateRoot, releaseId)).record;
    if (!current.delivery) throw new CliError("Release acceptance requires delivery reconciliation", 73);
    if (current.delivery.outcome === "rejected-before-send") {
      throw new CliError("Rejected-before-send release cannot be accepted", 73);
    }
    const canonicalCommonDir = await realpath(commonDir).catch(() => null);
    if (canonicalCommonDir === null) throw new CliError("Release acceptance common_dir does not exist");
    const acceptedAt = nowIso(now);
    const acceptance = validateAcceptance({
      ready_thread_id: readyThreadId,
      contract_id: contractId,
      runtime_context_digest: runtimeContextDigest,
      common_dir: canonicalCommonDir,
      accepted_at: acceptedAt,
    });
    if (
      acceptance.ready_thread_id !== current.ready_thread_id
      || acceptance.contract_id !== current.contract_id
      || acceptance.runtime_context_digest !== current.runtime_context_digest
      || acceptance.common_dir !== current.common_dir
    ) throw new CliError("Release acceptance does not match the prepared authority", 73);
    if (current.acceptance) {
      const same = stableStringify({ ...current.acceptance, accepted_at: acceptance.accepted_at })
        === stableStringify(acceptance);
      if (!same) throw new CliError("Release is already accepted with different evidence", 73);
      return view(current);
    }
    if (Date.parse(acceptedAt) < Date.parse(current.delivery.reconciled_at)) {
      throw new CliError("Release acceptance cannot predate delivery reconciliation");
    }
    const next = validateReleaseRecord({
      ...current,
      acceptance,
      updated_at: acceptance.accepted_at,
    });
    await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
    return view(next);
  });
}

export async function resolveTaskReleaseExecutorWorktree({ stateRoot, releaseId }) {
  const current = (await readRecord(stateRoot, releaseId)).record;
  let creation = await visibleTaskCreationStatus({
    stateRoot,
    operationId: current.operation_id,
  });
  if (
    creation.run_id !== current.run_id
    || creation.contract_id !== current.contract_id
    || creation.ready?.thread_id !== current.ready_thread_id
  ) {
    throw new CliError("Release executor worktree evidence does not match the visible-task creation", 73);
  }
  const requested = creation.selector_evidence.requested.worktree;
  let binding;
  if (requested.mode === "host-worktree") {
    const authenticated = await authenticateVisibleTaskWorktreeBinding({
      stateRoot,
      operationId: current.operation_id,
    });
    creation = authenticated.creation;
    if (authenticated.binding.binding_id !== current.worktree_binding_id) {
      throw new CliError("Release worktree binding does not match prepared release authority", 73);
    }
    binding = {
      ...requested,
      path: authenticated.binding.worktree_path,
    };
  } else {
    if (current.worktree_binding_id !== null) {
      throw new CliError("Local task release cannot carry host-worktree binding authority", 73);
    }
    binding = creation.selector_evidence.observed?.worktree ?? requested;
  }
  if (binding === null || binding.path === null) {
    throw new CliError("Task release requires the exact persisted host-observed worktree path", 73);
  }
  const expectedRoot = await realpath(binding.path).catch(() => null);
  if (expectedRoot === null) throw new CliError("Persisted task release worktree path does not exist", 73);
  const snapshot = gitSnapshot(expectedRoot);
  const actualRoot = await realpath(snapshot.root).catch(() => null);
  const actualCommonDir = await realpath(snapshot.commonDir).catch(() => null);
  const expectedCommonDir = await realpath(current.common_dir).catch(() => null);
  if (
    actualRoot !== expectedRoot
    || actualCommonDir === null
    || expectedCommonDir === null
    || actualCommonDir !== expectedCommonDir
  ) {
    throw new CliError("Persisted task release worktree authority is inconsistent", 73);
  }
  return {
    release: view(current),
    worktree: clone(binding),
    repository: {
      root: actualRoot,
      common_dir: actualCommonDir,
      branch: snapshot.branch,
      revision: snapshot.revision,
      cleanliness: snapshot.cleanliness,
    },
  };
}

export async function authenticateTaskReleaseExecutorWorktree({
  stateRoot,
  releaseId,
  repositoryPath,
}) {
  const executor = await resolveTaskReleaseExecutorWorktree({ stateRoot, releaseId });
  const caller = gitSnapshot(absolutePath(repositoryPath, "repositoryPath"));
  const callerRoot = await realpath(caller.root).catch(() => null);
  const callerCommonDir = await realpath(caller.commonDir).catch(() => null);
  if (
    callerRoot !== executor.repository.root
    || callerCommonDir !== executor.repository.common_dir
  ) {
    throw new CliError("Release acceptance caller is not the exact persisted executor worktree", 73);
  }
  const { release, worktree: binding } = executor;
  const repository = {
    root: callerRoot,
    common_dir: callerCommonDir,
    branch: caller.branch,
    revision: caller.revision,
    cleanliness: caller.cleanliness,
  };
  if (repository.revision !== release.task_contract.current_baseline.revision) {
    throw new CliError("Release acceptance executor worktree is not at the exact task baseline", 73);
  }
  if (repository.cleanliness !== "clean") {
    throw new CliError("Release acceptance executor worktree must be pristine", 73);
  }
  if (binding.mode === "host-worktree" && repository.branch !== binding.executor_branch) {
    throw new CliError("Release acceptance executor worktree is on the wrong branch", 73);
  }
  return { ...executor, repository };
}

export async function taskReleaseStatus({ stateRoot, releaseId }) {
  return view((await readRecord(stateRoot, releaseId)).record);
}
