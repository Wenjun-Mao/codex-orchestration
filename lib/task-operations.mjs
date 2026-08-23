import { readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assertNoSymlinkComponents,
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
import { REASONING_EFFORTS } from "./config.mjs";
import { isLaunchExpired, validateLaunchDeadline, validateTaskPacket } from "./task-packet.mjs";

const OPERATION_KIND = "codex-flow-task-create-operation";
const MAX_ATTEMPTS = 32;
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function operationGuardRoot(stateRoot) {
  return dirname(resolve(stateRoot));
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError("Unsafe task-operation state path");
  }
  return path;
}

function operationPaths(stateRoot, operationId) {
  requireText(operationId, "operation_id", { max: 96, safeId: true });
  const root = resolve(stateRoot, "task-operations");
  return {
    root,
    record: safeChild(resolve(root, "records"), `${operationId}.json`),
    lock: safeChild(resolve(root, "locks"), `${operationId}.lock.json`),
  };
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function launchExpired(deadline, now = Date.now()) {
  return isLaunchExpired(deadline, now);
}

function requireTimestamp(value, label) {
  const text = requireText(value, label, { max: 64 });
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new CliError(`${label} must be an ISO timestamp with an explicit UTC offset`);
  }
  return text;
}

function operationIdFromFields(projectId, taskId, runId, executionKind) {
  return `task-operation-v1-${sha256(stableStringify({
    schema_version: 1,
    project_id: projectId,
    task_id: taskId,
    run_id: runId,
    execution_kind: executionKind,
  }))}`;
}

export function taskOperationIdFor(projectId, packet) {
  return operationIdFromFields(projectId, packet.task_id, packet.run_id, packet.execution_kind);
}

function validateAttempt(value, index) {
  const label = `Task operation attempts[${index}]`;
  requireExactFields(value, {
    required: ["attempt_id", "sequence", "status", "started_at", "ambiguous_after", "finished_at"],
  }, label);
  return {
    attempt_id: requireText(value.attempt_id, `${label}.attempt_id`, { max: 96, safeId: true }),
    sequence: requireInteger(value.sequence, `${label}.sequence`, { min: 1, max: MAX_ATTEMPTS }),
    status: requireEnum(value.status, ["dispatching", "ambiguous", "not-created", "observed", "failed"], `${label}.status`),
    started_at: requireTimestamp(value.started_at, `${label}.started_at`),
    ambiguous_after: requireTimestamp(value.ambiguous_after, `${label}.ambiguous_after`),
    finished_at: value.finished_at === null
      ? null
      : requireTimestamp(value.finished_at, `${label}.finished_at`),
  };
}

function validateObserved(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["object_id", "actual_kind", "title", "visible", "observed_at"],
  }, "Task operation observed result");
  if (typeof value.visible !== "boolean") throw new CliError("Task operation observed visibility must be boolean");
  return {
    object_id: requireText(value.object_id, "observed.object_id", { max: 256, safeId: true }),
    actual_kind: requireEnum(value.actual_kind, ["task-thread", "subagent"], "observed.actual_kind"),
    title: requireText(value.title, "observed.title", { max: 160 }),
    visible: value.visible,
    observed_at: requireTimestamp(value.observed_at, "observed.observed_at"),
  };
}

function validateOperationRecord(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "operation_id", "project_id", "packet_hash", "request",
      "status", "attempts", "observed", "created_at", "updated_at",
    ],
  }, "Task operation record");
  if (value.schema_version !== 1 || value.kind !== OPERATION_KIND) {
    throw new CliError("Unsupported task-operation record");
  }
  requireExactFields(value.request, {
    required: [
      "task_id", "run_id", "role", "execution_kind", "title", "launch_deadline",
      "model", "reasoning_effort",
    ],
  }, "Task operation request");
  if (!Array.isArray(value.attempts) || value.attempts.length > MAX_ATTEMPTS) {
    throw new CliError(`Task operation attempts must contain at most ${MAX_ATTEMPTS} entries`);
  }
  const projectId = requireText(value.project_id, "project_id", { max: 128, safeId: true });
  const packetHash = requireText(value.packet_hash, "packet_hash", { max: 64, safeId: true });
  if (!/^[a-f0-9]{64}$/.test(packetHash)) throw new CliError("packet_hash must be a SHA-256 digest");
  const taskId = requireText(value.request.task_id, "request.task_id", { max: 128, safeId: true });
  const runId = requireText(value.request.run_id, "request.run_id", { max: 128, safeId: true });
  const executionKind = requireEnum(value.request.execution_kind, ["task-thread", "subagent"], "request.execution_kind");
  const operationId = requireText(value.operation_id, "operation_id", { max: 96, safeId: true });
  if (operationId !== operationIdFromFields(projectId, taskId, runId, executionKind)) {
    throw new CliError("Task operation ID does not match its immutable request identity");
  }
  const attempts = value.attempts.map(validateAttempt);
  for (let index = 0; index < attempts.length; index += 1) {
    if (attempts[index].sequence !== index + 1) throw new CliError("Task operation attempt sequence is not contiguous");
    const expected = `task-attempt-v1-${sha256(`${operationId}:${index + 1}`)}`;
    if (attempts[index].attempt_id !== expected) throw new CliError("Task operation attempt ID is invalid");
    if (attempts[index].status === "dispatching" && attempts[index].finished_at !== null) {
      throw new CliError("Dispatching task operation attempt cannot have finished_at");
    }
    if (attempts[index].status !== "dispatching" && attempts[index].finished_at === null) {
      throw new CliError(`Task operation attempt ${attempts[index].status} is missing finished_at`);
    }
  }
  const observed = validateObserved(value.observed);
  const status = requireEnum(value.status, ["prepared", "dispatching", "ambiguous", "observed", "failed", "expired"], "status");
  if (status === "observed" && observed === null) throw new CliError("Observed task operation is missing its host observation");
  if (status !== "observed" && observed !== null) throw new CliError("Non-observed task operation cannot contain a host observation");
  const lastAttempt = attempts.at(-1);
  if (status === "dispatching" && lastAttempt?.status !== "dispatching") {
    throw new CliError("Dispatching task operation is missing its active attempt");
  }
  if (["ambiguous", "observed", "failed"].includes(status) && lastAttempt?.status !== status) {
    throw new CliError(`Task operation ${status} state does not match its latest attempt`);
  }
  if (status === "prepared" && lastAttempt && lastAttempt.status !== "not-created") {
    throw new CliError("Prepared retry state requires a latest not-created attempt");
  }
  const model = value.request.model === null
    ? null
    : requireText(value.request.model, "request.model", { max: 128 });
  const reasoningEffort = requireEnum(value.request.reasoning_effort, REASONING_EFFORTS, "request.reasoning_effort");
  return {
    schema_version: 1,
    kind: OPERATION_KIND,
    operation_id: operationId,
    project_id: projectId,
    packet_hash: packetHash,
    request: {
      task_id: taskId,
      run_id: runId,
      role: requireEnum(value.request.role, ["coordinator", "executor"], "request.role"),
      execution_kind: executionKind,
      title: requireText(value.request.title, "request.title", { max: 160 }),
      launch_deadline: validateLaunchDeadline(value.request.launch_deadline, "request.launch_deadline"),
      model,
      reasoning_effort: reasoningEffort,
    },
    status,
    attempts,
    observed,
    created_at: requireTimestamp(value.created_at, "created_at"),
    updated_at: requireTimestamp(value.updated_at, "updated_at"),
  };
}

async function readOperation(paths, guardRoot) {
  const raw = await readJson(paths.record, { allowMissing: true, guardRoot });
  return raw ? validateOperationRecord(raw) : null;
}

async function writeOperation(paths, guardRoot, record) {
  const validated = validateOperationRecord(record);
  await atomicWriteJson(paths.record, validated, { guardRoot });
  return validated;
}

function operationView(record, now = Date.now()) {
  let effectiveStatus = record.status;
  if (record.status === "dispatching") {
    const active = record.attempts.at(-1);
    if (active && Date.parse(active.ambiguous_after) <= now) effectiveStatus = "ambiguous-due";
  }
  return { ...record, effective_status: effectiveStatus };
}

export async function prepareTaskOperation({ stateRoot, projectId, packet: input, now = Date.now() }) {
  requireText(projectId, "project_id", { max: 128, safeId: true });
  const packet = validateTaskPacket(input);
  const operationId = taskOperationIdFor(projectId, packet);
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const existing = await readOperation(paths, guardRoot);
    const packetHash = sha256(stableStringify(packet));
    if (existing) {
      if (existing.packet_hash !== packetHash) {
        throw new CliError("Task operation identity collides with a different packet");
      }
      return operationView(existing, now);
    }
    const timestamp = nowIso(now);
    const record = {
      schema_version: 1,
      kind: OPERATION_KIND,
      operation_id: operationId,
      project_id: projectId,
      packet_hash: packetHash,
      request: {
        task_id: packet.task_id,
        run_id: packet.run_id,
        role: packet.role,
        execution_kind: packet.execution_kind,
        title: packet.title,
        launch_deadline: packet.launch_deadline,
        model: packet.model,
        reasoning_effort: packet.reasoning_effort,
      },
      status: launchExpired(packet.launch_deadline, now) ? "expired" : "prepared",
      attempts: [],
      observed: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await ensureExactJson(paths.record, validateOperationRecord(record), { guardRoot });
    return operationView(record, now);
  });
}

export async function beginTaskOperationAttempt({
  stateRoot,
  operationId,
  timeoutSeconds = 60,
  now = Date.now(),
}) {
  requireInteger(timeoutSeconds, "timeout_seconds", { min: 5, max: 600 });
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const record = await readOperation(paths, guardRoot);
    if (!record) throw new CliError("Task operation does not exist");
    if (record.status === "observed") return { status: "already-observed", operation: operationView(record, now) };
    if (record.status === "failed" || record.status === "expired") {
      throw new CliError(`Task operation is terminal: ${record.status}`, 74);
    }
    if (record.status === "ambiguous") {
      throw new CliError("Task operation is ambiguous; inspect the host and reconcile before retrying", 75);
    }
    if (record.status === "dispatching") {
      const active = record.attempts.at(-1);
      if (active && Date.parse(active.ambiguous_after) <= now) {
        active.status = "ambiguous";
        active.finished_at = nowIso(now);
        record.status = "ambiguous";
        record.updated_at = nowIso(now);
        await writeOperation(paths, guardRoot, record);
        throw new CliError("Prior task operation exceeded its bounded wait; inspect the host before retrying", 75);
      }
      throw new CliError("Task operation dispatch is already in progress", 75);
    }
    if (launchExpired(record.request.launch_deadline, now)) {
      record.status = "expired";
      record.updated_at = nowIso(now);
      await writeOperation(paths, guardRoot, record);
      throw new CliError("Task launch deadline has expired; no new host operation may start", 74);
    }
    if (record.attempts.length >= MAX_ATTEMPTS) throw new CliError("Task operation attempt limit reached", 74);
    const sequence = record.attempts.length + 1;
    const attemptId = `task-attempt-v1-${sha256(`${operationId}:${sequence}`)}`;
    const attempt = {
      attempt_id: attemptId,
      sequence,
      status: "dispatching",
      started_at: nowIso(now),
      ambiguous_after: nowIso(now + timeoutSeconds * 1000),
      finished_at: null,
    };
    record.attempts.push(attempt);
    record.status = "dispatching";
    record.updated_at = nowIso(now);
    await writeOperation(paths, guardRoot, record);
    return {
      status: "dispatching",
      operation_id: operationId,
      attempt,
      request: record.request,
    };
  });
}

export async function reconcileTaskOperation({
  stateRoot,
  operationId,
  attemptId,
  outcome,
  objectId = null,
  actualKind = null,
  title = null,
  visible = null,
  now = Date.now(),
}) {
  const paths = operationPaths(stateRoot, operationId);
  const guardRoot = operationGuardRoot(stateRoot);
  requireText(attemptId, "attempt_id", { max: 96, safeId: true });
  requireEnum(outcome, ["observed", "not-created", "ambiguous", "failed"], "outcome");
  return withProcessLock({
    path: paths.lock,
    guardRoot,
    label: `task operation ${operationId}`,
  }, async () => {
    const record = await readOperation(paths, guardRoot);
    if (!record) throw new CliError("Task operation does not exist");
    const attempt = record.attempts.find((item) => item.attempt_id === attemptId);
    if (!attempt) throw new CliError("Task operation attempt does not exist");
    if (!["dispatching", "ambiguous"].includes(attempt.status)) {
      if (attempt.status === outcome) return operationView(record, now);
      throw new CliError(`Task operation attempt is already reconciled as ${attempt.status}`);
    }
    const timestamp = nowIso(now);
    if (outcome === "observed") {
      requireText(objectId, "object_id", { max: 256, safeId: true });
      requireEnum(actualKind, ["task-thread", "subagent"], "actual_kind");
      requireText(title, "observed title", { max: 160 });
      if (typeof visible !== "boolean") throw new CliError("Observed visibility must be explicit");
      if (actualKind !== record.request.execution_kind) {
        throw new CliError(`Requested ${record.request.execution_kind} but observed ${actualKind}`);
      }
      const expectedVisible = record.request.execution_kind === "task-thread";
      if (visible !== expectedVisible) {
        throw new CliError(`Observed visibility does not match requested ${record.request.execution_kind}`);
      }
      if (title !== record.request.title) throw new CliError("Observed task title does not match the requested title");
      record.observed = {
        object_id: objectId,
        actual_kind: actualKind,
        title,
        visible,
        observed_at: timestamp,
      };
      record.status = "observed";
    } else if (outcome === "not-created") {
      record.status = launchExpired(record.request.launch_deadline, now) ? "expired" : "prepared";
    } else {
      record.status = outcome;
    }
    attempt.status = outcome;
    attempt.finished_at = timestamp;
    record.updated_at = timestamp;
    return operationView(await writeOperation(paths, guardRoot, record), now);
  });
}

async function listOperationRecords(root, guardRoot) {
  await assertNoSymlinkComponents(guardRoot, root, "Task-operation state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new CliError(`Task-operation state contains a symbolic link: ${path}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    records.push(validateOperationRecord(await readJson(path, { guardRoot })));
  }
  return records;
}

export async function taskOperationStatus({ stateRoot, operationId = null, now = Date.now() }) {
  const guardRoot = operationGuardRoot(stateRoot);
  if (operationId) {
    const paths = operationPaths(stateRoot, operationId);
    const record = await readOperation(paths, guardRoot);
    return record ? [operationView(record, now)] : [];
  }
  const records = await listOperationRecords(resolve(stateRoot, "task-operations", "records"), guardRoot);
  return records
    .map((record) => operationView(record, now))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
