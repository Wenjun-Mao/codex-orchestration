import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";

const RELEASE_KIND = "codex-flow-v06-task-release";
const DELIVERY_OUTCOMES = ["sent", "rejected-before-send", "ambiguous"];
const DIGEST = /^[0-9a-f]{64}$/;

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

function identity(input) {
  requireExactFields(input, {
    required: [
      "run_id", "plan_id", "revision_id", "task_id", "task_contract_digest",
      "operation_id", "ready_thread_id", "runtime_digest", "config_digest",
      "repository_id", "common_dir", "prompt",
    ],
  }, "Release preparation");
  const prompt = requireText(input.prompt, "prompt", { max: 64 * 1024 });
  return {
    run_id: requireText(input.run_id, "run_id", { max: 128, safeId: true }),
    plan_id: requireText(input.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_id: requireText(input.revision_id, "revision_id", { max: 128, safeId: true }),
    task_id: requireText(input.task_id, "task_id", { max: 128, safeId: true }),
    task_contract_digest: digest(input.task_contract_digest, "task_contract_digest"),
    operation_id: requireText(input.operation_id, "operation_id", { max: 128, safeId: true }),
    ready_thread_id: requireText(input.ready_thread_id, "ready_thread_id", { max: 128, safeId: true }),
    runtime_digest: digest(input.runtime_digest, "runtime_digest"),
    config_digest: digest(input.config_digest, "config_digest"),
    repository_id: requireText(input.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: requireText(input.common_dir, "common_dir", { max: 1024 }),
    prompt,
    prompt_digest: sha256(prompt),
  };
}

export function releaseIdFor(input) {
  const value = identity(input);
  const causal = {
    run_id: value.run_id,
    plan_id: value.plan_id,
    revision_id: value.revision_id,
    task_id: value.task_id,
    task_contract_digest: value.task_contract_digest,
    operation_id: value.operation_id,
    ready_thread_id: value.ready_thread_id,
    runtime_digest: value.runtime_digest,
    config_digest: value.config_digest,
    repository_id: value.repository_id,
    common_dir: resolve(value.common_dir),
  };
  return `release-v1-${sha256(stableStringify(causal))}`;
}

function validateDelivery(value) {
  requireExactFields(value, {
    required: ["outcome", "reconciled_at"],
  }, "Release delivery");
  return {
    outcome: requireEnum(value.outcome, DELIVERY_OUTCOMES, "Release delivery outcome"),
    reconciled_at: requireText(value.reconciled_at, "Release delivery reconciled_at", { max: 64 }),
  };
}

function validateAcceptance(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: [
      "executor_thread_id", "task_contract_digest", "runtime_digest",
      "common_dir", "accepted_at",
    ],
  }, "Release acceptance");
  return {
    executor_thread_id: requireText(value.executor_thread_id, "executor_thread_id", { max: 128, safeId: true }),
    task_contract_digest: digest(value.task_contract_digest, "task_contract_digest"),
    runtime_digest: digest(value.runtime_digest, "runtime_digest"),
    common_dir: requireText(value.common_dir, "common_dir", { max: 1024 }),
    accepted_at: requireText(value.accepted_at, "accepted_at", { max: 64 }),
  };
}

export function validateReleaseRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "release_id", "run_id", "plan_id",
      "revision_id", "task_id", "task_contract_digest", "operation_id",
      "ready_thread_id", "runtime_digest", "config_digest", "repository_id",
      "common_dir", "prompt_digest", "prompt_length", "delivery",
      "acceptance", "prepared_at", "updated_at",
    ],
  }, "Release record");
  if (value.schema_version !== 1 || value.kind !== RELEASE_KIND) {
    throw new CliError("Invalid v0.6 release record schema");
  }
  const record = {
    schema_version: 1,
    kind: RELEASE_KIND,
    release_id: requireText(value.release_id, "release_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_id: requireText(value.revision_id, "revision_id", { max: 128, safeId: true }),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_contract_digest: digest(value.task_contract_digest, "task_contract_digest"),
    operation_id: requireText(value.operation_id, "operation_id", { max: 128, safeId: true }),
    ready_thread_id: requireText(value.ready_thread_id, "ready_thread_id", { max: 128, safeId: true }),
    runtime_digest: digest(value.runtime_digest, "runtime_digest"),
    config_digest: digest(value.config_digest, "config_digest"),
    repository_id: requireText(value.repository_id, "repository_id", { max: 128, safeId: true }),
    common_dir: requireText(value.common_dir, "common_dir", { max: 1024 }),
    prompt_digest: digest(value.prompt_digest, "prompt_digest"),
    prompt_length: Number(value.prompt_length),
    delivery: value.delivery === null ? null : validateDelivery(value.delivery),
    acceptance: validateAcceptance(value.acceptance),
    prepared_at: requireText(value.prepared_at, "prepared_at", { max: 64 }),
    updated_at: requireText(value.updated_at, "updated_at", { max: 64 }),
  };
  if (!Number.isInteger(record.prompt_length) || record.prompt_length < 1 || record.prompt_length > 64 * 1024) {
    throw new CliError("Release prompt_length is invalid");
  }
  if (record.acceptance && !record.delivery) {
    throw new CliError("Release acceptance requires reconciled delivery");
  }
  if (record.acceptance && record.delivery.outcome === "rejected-before-send") {
    throw new CliError("Rejected release delivery cannot be accepted");
  }
  return record;
}

function view(record, { prompt = null, dispatchPermitted = false } = {}) {
  return {
    ...record,
    status: record.acceptance
      ? "accepted"
      : record.delivery?.outcome ?? "prepared",
    dispatch_permitted: dispatchPermitted,
    ...(prompt === null ? {} : { prompt }),
  };
}

function immutableRecord(record) {
  return Object.fromEntries([
    "release_id", "run_id", "plan_id", "revision_id", "task_id",
    "task_contract_digest", "operation_id", "ready_thread_id",
    "runtime_digest", "config_digest", "repository_id", "common_dir",
    "prompt_digest", "prompt_length",
  ].map((key) => [key, record[key]]));
}

export async function prepareTaskRelease({ stateRoot, input, now = Date.now() }) {
  const value = identity(input);
  const canonicalCommonDir = await realpath(value.common_dir).catch(() => null);
  if (!canonicalCommonDir) throw new CliError("Release common_dir does not exist");
  if (canonicalCommonDir !== await realpath(guardRoot(stateRoot))) {
    throw new CliError("Release common_dir does not match the journal Git common directory");
  }
  const releaseId = releaseIdFor({ ...input, common_dir: canonicalCommonDir });
  const timestamp = new Date(now).toISOString();
  const record = validateReleaseRecord({
    schema_version: 1,
    kind: RELEASE_KIND,
    release_id: releaseId,
    run_id: value.run_id,
    plan_id: value.plan_id,
    revision_id: value.revision_id,
    task_id: value.task_id,
    task_contract_digest: value.task_contract_digest,
    operation_id: value.operation_id,
    ready_thread_id: value.ready_thread_id,
    runtime_digest: value.runtime_digest,
    config_digest: value.config_digest,
    repository_id: value.repository_id,
    common_dir: canonicalCommonDir,
    prompt_digest: value.prompt_digest,
    prompt_length: Buffer.byteLength(value.prompt, "utf8"),
    delivery: null,
    acceptance: null,
    prepared_at: timestamp,
    updated_at: timestamp,
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
        throw new CliError("Existing release state does not match prepared authority", 73);
      }
      return view(validated);
    }
    await ensureExactJson(location.record, record, { guardRoot: guardRoot(stateRoot) });
    return view(record, { prompt: value.prompt, dispatchPermitted: true });
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
    const timestamp = new Date(now).toISOString();
    const next = validateReleaseRecord({
      ...current,
      delivery: { outcome, reconciled_at: timestamp },
      updated_at: timestamp,
    });
    await atomicWriteJson(location.record, next, { guardRoot: guardRoot(stateRoot) });
    return view(next);
  });
}

export async function acceptTaskRelease({
  stateRoot,
  releaseId,
  executorThreadId,
  taskContractDigest,
  runtimeDigest,
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
    const acceptance = validateAcceptance({
      executor_thread_id: executorThreadId,
      task_contract_digest: taskContractDigest,
      runtime_digest: runtimeDigest,
      common_dir: canonicalCommonDir ?? commonDir,
      accepted_at: new Date(now).toISOString(),
    });
    if (
      acceptance.executor_thread_id !== current.ready_thread_id
      || acceptance.task_contract_digest !== current.task_contract_digest
      || acceptance.runtime_digest !== current.runtime_digest
      || acceptance.common_dir !== current.common_dir
    ) throw new CliError("Release acceptance does not match the prepared authority", 73);
    if (current.acceptance) {
      const same = stableStringify({ ...current.acceptance, accepted_at: acceptance.accepted_at })
        === stableStringify(acceptance);
      if (!same) throw new CliError("Release is already accepted with different evidence", 73);
      return view(current);
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

export async function taskReleaseStatus({ stateRoot, releaseId }) {
  return view((await readRecord(stateRoot, releaseId)).record);
}
