import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  atomicWrite,
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
import { recipientBindingDigest } from "./task-results.mjs";

export const ASSIGNMENT_STATE_DIRECTORY = "assignments-v1";
export const ASSIGNMENT_AUTHORITY_KIND = "codex-flow-v097-assignment-authority";

const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function assignmentStateRoot(commonDir) {
  return resolve(requireText(commonDir, "common_dir", { max: 2048 }), "codex-flow", ASSIGNMENT_STATE_DIRECTORY);
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) throw new CliError(`${label} must be an explicit timestamp`);
  return result;
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function identity(value, label, { host = false } = {}) {
  requireExactFields(value, {
    required: host
      ? ["host_id", "thread_id"]
      : ["host_id", "lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  if (host) {
    return {
      host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
      thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    };
  }
  const recipient = {
    host_id: requireText(value.host_id, `${label}.host_id`, { max: 128, safeId: true }),
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1, max: 2147483647 }),
    binding_digest: digest(value.binding_digest, `${label}.binding_digest`),
  };
  if (recipient.binding_digest !== recipientBindingDigest({
    lineage_id: recipient.lineage_id,
    thread_id: recipient.thread_id,
    generation: recipient.generation,
  })) {
    throw new CliError(`${label}.binding_digest does not match its identity`);
  }
  return recipient;
}

function executionBinding(value, label) {
  requireExactFields(value, {
    required: [
      "run_id", "runtime_context_digest", "configuration_digest", "repository_digest",
      "repository_root", "repository_branch", "plan_id", "revision_digest", "namespace", "bound_at",
    ],
  }, label);
  return {
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    configuration_digest: digest(value.configuration_digest, `${label}.configuration_digest`),
    repository_digest: digest(value.repository_digest, `${label}.repository_digest`),
    repository_root: value.repository_root === null ? null : resolve(requireText(value.repository_root, `${label}.repository_root`, { max: 2048 })),
    repository_branch: value.repository_branch === null ? null : requireText(value.repository_branch, `${label}.repository_branch`, { max: 256 }),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, `${label}.revision_digest`),
    namespace: requireText(value.namespace, `${label}.namespace`, { max: 128, safeId: true }),
    bound_at: timestamp(value.bound_at, `${label}.bound_at`),
  };
}

function plan(value) {
  requireExactFields(value, { required: ["digest", "snapshot_path"] }, "approved_plan");
  return {
    digest: digest(value.digest, "approved_plan.digest"),
    snapshot_path: resolve(requireText(value.snapshot_path, "approved_plan.snapshot_path", { max: 4096 })),
  };
}

function cancellation(value) {
  if (value === null) return null;
  requireExactFields(value, {
    required: ["reason", "cancelled_by_thread_id", "cancelled_at", "execution_evidence"],
  }, "cancellation");
  if (!Array.isArray(value.execution_evidence) || value.execution_evidence.length < 1 || value.execution_evidence.length > 64) {
    throw new CliError("cancellation.execution_evidence must contain between 1 and 64 entries");
  }
  const executionEvidence = value.execution_evidence.map((entry, index) => {
    requireExactFields(entry, {
      required: [
        "namespace", "run_id", "runtime_context_digest", "terminal_status",
        "terminal_digest", "observed_at",
      ],
    }, `cancellation.execution_evidence[${index}]`);
    return {
      namespace: requireText(entry.namespace, `cancellation.execution_evidence[${index}].namespace`, { max: 128, safeId: true }),
      run_id: requireText(entry.run_id, `cancellation.execution_evidence[${index}].run_id`, { max: 128, safeId: true }),
      runtime_context_digest: digest(
        entry.runtime_context_digest,
        `cancellation.execution_evidence[${index}].runtime_context_digest`,
      ),
      terminal_status: requireEnum(
        entry.terminal_status,
        ["closed", "abandoned"],
        `cancellation.execution_evidence[${index}].terminal_status`,
      ),
      terminal_digest: digest(entry.terminal_digest, `cancellation.execution_evidence[${index}].terminal_digest`),
      observed_at: timestamp(entry.observed_at, `cancellation.execution_evidence[${index}].observed_at`),
    };
  }).sort((left, right) => (
    `${left.namespace}:${left.run_id}`.localeCompare(`${right.namespace}:${right.run_id}`)
  ));
  if (new Set(executionEvidence.map((entry) => `${entry.namespace}:${entry.run_id}`)).size !== executionEvidence.length) {
    throw new CliError("cancellation.execution_evidence contains duplicate run authority");
  }
  return {
    reason: requireText(value.reason, "cancellation.reason", { max: 512 }),
    cancelled_by_thread_id: requireText(value.cancelled_by_thread_id, "cancellation.cancelled_by_thread_id", {
      max: 256,
      safeId: true,
    }),
    cancelled_at: timestamp(value.cancelled_at, "cancellation.cancelled_at"),
    execution_evidence: executionEvidence,
  };
}

function authoritySeed(value) {
  const { bound_at: ignored, ...initialExecution } = value.execution_bindings[0];
  return {
    common_dir: value.common_dir,
    repository_digest: value.repository_digest,
    approved_plan: value.approved_plan,
    sender: value.sender,
    recipient: value.recipient,
    initial_execution: initialExecution,
  };
}

export function assignmentIdFor(value) {
  return `coordinator-assignment-v1-${sha256(stableStringify(authoritySeed(value)))}`;
}

function assignmentPaths(stateRoot, assignmentId) {
  const id = requireText(assignmentId, "assignment_id", { max: 128, safeId: true });
  const records = resolve(stateRoot, "records");
  const record = resolve(records, `${id}.json`);
  if (dirname(record) !== records || basename(record) !== `${id}.json`) throw new CliError("Unsafe assignment authority path");
  return { record, lock: resolve(stateRoot, "locks", `${id}.lock.json`) };
}

export function validateAssignmentAuthority(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "assignment_id", "route_id", "common_dir",
      "repository_digest", "approved_plan", "sender", "recipient", "execution_bindings",
      "iteration_id", "iteration_label", "purpose", "state", "acceptance", "created_at", "updated_at",
    ],
    optional: ["cancellation"],
  }, "assignment authority");
  if (value.schema_version !== 1 || value.kind !== ASSIGNMENT_AUTHORITY_KIND) {
    throw new CliError("Unsupported assignment authority");
  }
  if (!Array.isArray(value.execution_bindings) || value.execution_bindings.length < 1 || value.execution_bindings.length > 64) {
    throw new CliError("assignment execution_bindings must contain between 1 and 64 entries");
  }
  const record = {
    schema_version: 1,
    kind: ASSIGNMENT_AUTHORITY_KIND,
    assignment_id: requireText(value.assignment_id, "assignment_id", { max: 128, safeId: true }),
    route_id: requireText(value.route_id, "route_id", { max: 128, safeId: true }),
    common_dir: resolve(requireText(value.common_dir, "common_dir", { max: 2048 })),
    repository_digest: digest(value.repository_digest, "repository_digest"),
    approved_plan: plan(value.approved_plan),
    sender: identity(value.sender, "sender", { host: true }),
    recipient: identity(value.recipient, "recipient"),
    execution_bindings: value.execution_bindings.map((entry, index) => executionBinding(entry, `execution_bindings[${index}]`)),
    iteration_id: requireText(value.iteration_id, "iteration_id", { max: 128, safeId: true }),
    iteration_label: requireText(value.iteration_label, "iteration_label", { max: 80 }),
    purpose: requireText(value.purpose, "purpose", { max: 120 }),
    state: requireEnum(value.state, ["open", "accepted", "cancelled", "retired"], "state"),
    acceptance: value.acceptance,
    cancellation: Object.hasOwn(value, "cancellation") ? cancellation(value.cancellation) : null,
    created_at: timestamp(value.created_at, "created_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  };
  if (new Set(record.execution_bindings.map((entry) => `${entry.namespace}:${entry.run_id}`)).size !== record.execution_bindings.length) {
    throw new CliError("assignment execution bindings contain a duplicate run authority");
  }
  if (record.cancellation !== null) {
    const expectedExecutions = record.execution_bindings.map((entry) => (
      `${entry.namespace}:${entry.run_id}:${entry.runtime_context_digest}`
    )).sort();
    const observedExecutions = record.cancellation.execution_evidence.map((entry) => (
      `${entry.namespace}:${entry.run_id}:${entry.runtime_context_digest}`
    )).sort();
    if (stableStringify(observedExecutions) !== stableStringify(expectedExecutions)) {
      throw new CliError("cancellation execution evidence does not match assignment execution authority");
    }
  }
  if (record.assignment_id !== assignmentIdFor(record)) throw new CliError("assignment_id does not match its immutable authority");
  if (record.iteration_id !== `iteration-v1-${sha256(record.assignment_id)}`) throw new CliError("iteration_id does not match its assignment");
  if (record.state === "open") {
    if (record.acceptance !== null || record.cancellation !== null) {
      throw new CliError("Open assignment cannot contain terminal evidence");
    }
  } else if (record.state === "accepted") {
    if (record.cancellation !== null) throw new CliError("Accepted assignment cannot contain cancellation evidence");
    requireExactFields(record.acceptance, {
      required: ["report_id", "report_digest", "accepted_by_thread_id", "accepted_at"],
    }, "acceptance");
    record.acceptance = {
      report_id: requireText(record.acceptance.report_id, "acceptance.report_id", { max: 128, safeId: true }),
      report_digest: digest(record.acceptance.report_digest, "acceptance.report_digest"),
      accepted_by_thread_id: requireText(record.acceptance.accepted_by_thread_id, "acceptance.accepted_by_thread_id", { max: 256, safeId: true }),
      accepted_at: timestamp(record.acceptance.accepted_at, "acceptance.accepted_at"),
    };
  } else if (record.state === "retired") {
    if (record.cancellation !== null) throw new CliError("Retired assignment cannot contain cancellation evidence");
    if (record.acceptance === null) throw new CliError("Retired assignment must preserve acceptance evidence");
    requireExactFields(record.acceptance, {
      required: ["report_id", "report_digest", "accepted_by_thread_id", "accepted_at"],
    }, "acceptance");
    record.acceptance = {
      report_id: requireText(record.acceptance.report_id, "acceptance.report_id", { max: 128, safeId: true }),
      report_digest: digest(record.acceptance.report_digest, "acceptance.report_digest"),
      accepted_by_thread_id: requireText(record.acceptance.accepted_by_thread_id, "acceptance.accepted_by_thread_id", { max: 256, safeId: true }),
      accepted_at: timestamp(record.acceptance.accepted_at, "acceptance.accepted_at"),
    };
  } else if (record.acceptance !== null || record.cancellation === null) {
    throw new CliError("Cancelled assignment requires cancellation evidence and cannot invent acceptance evidence");
  }
  if (Date.parse(record.updated_at) < Date.parse(record.created_at)) throw new CliError("assignment updated_at predates creation");
  return record;
}

async function persistPlanSnapshot({ stateRoot, sourcePath, expectedDigest }) {
  const resolvedSource = resolve(sourcePath);
  const bytes = await readFile(resolvedSource);
  if (sha256(bytes) !== expectedDigest) throw new CliError("Approved plan digest does not match its bytes", 73);
  const preparedRoot = resolve(stateRoot, "preparations", "plans");
  const preparedRelative = relative(preparedRoot, resolvedSource);
  if (
    preparedRelative !== ""
    && !preparedRelative.startsWith("..")
    && !isAbsolute(preparedRelative)
  ) return resolvedSource;
  const snapshotPath = resolve(stateRoot, "plans", `${expectedDigest}.md`);
  try {
    await atomicWrite(snapshotPath, bytes, { exclusive: true, guardRoot: resolve(stateRoot, "..", ".."), mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (sha256(await readFile(snapshotPath)) !== expectedDigest) throw new CliError("Approved plan snapshot conflicts with its digest", 73);
  }
  return snapshotPath;
}

export async function createAssignmentAuthority({
  commonDir,
  routeId,
  repositoryDigest,
  approvedPlanPath,
  approvedPlanDigest,
  sender,
  recipient,
  executionBinding: binding,
  iterationLabel,
  purpose,
  expectedAssignmentId = null,
  now = Date.now(),
}) {
  const stateRoot = assignmentStateRoot(commonDir);
  const snapshotPath = await persistPlanSnapshot({
    stateRoot,
    sourcePath: approvedPlanPath,
    expectedDigest: digest(approvedPlanDigest, "approved_plan_digest"),
  });
  const createdAt = new Date(now).toISOString();
  const draft = {
    common_dir: resolve(commonDir),
    repository_digest: digest(repositoryDigest, "repository_digest"),
    approved_plan: { digest: approvedPlanDigest, snapshot_path: snapshotPath },
    sender: identity(sender, "sender", { host: true }),
    recipient: identity(recipient, "recipient"),
    execution_bindings: [executionBinding(binding, "execution_binding")],
  };
  const assignmentId = assignmentIdFor(draft);
  if (expectedAssignmentId !== null && expectedAssignmentId !== assignmentId) {
    throw new CliError("Prepared assignment ID does not match persisted authority", 73);
  }
  const record = validateAssignmentAuthority({
    schema_version: 1,
    kind: ASSIGNMENT_AUTHORITY_KIND,
    assignment_id: assignmentId,
    route_id: requireText(routeId, "route_id", { max: 128, safeId: true }),
    ...draft,
    iteration_id: `iteration-v1-${sha256(assignmentId)}`,
    iteration_label: requireText(iterationLabel, "iteration_label", { max: 80 }),
    purpose: requireText(purpose, "purpose", { max: 120 }),
    state: "open",
    acceptance: null,
    cancellation: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
  const paths = assignmentPaths(stateRoot, record.assignment_id);
  return withProcessLock({ path: paths.lock, guardRoot: resolve(commonDir), label: `assignment ${record.assignment_id}` }, async () => {
    const existing = await readJson(paths.record, { allowMissing: true, guardRoot: resolve(commonDir) });
    if (existing !== null) {
      const validated = validateAssignmentAuthority(existing);
      if (
        stableStringify(authoritySeed(validated)) !== stableStringify(authoritySeed(record))
        || validated.route_id !== record.route_id
        || validated.iteration_label !== record.iteration_label
        || validated.purpose !== record.purpose
      ) throw new CliError("Existing assignment authority conflicts", 73);
      return { status: "existing", state_root: stateRoot, assignment: validated };
    }
    await atomicWriteJson(paths.record, record, { guardRoot: resolve(commonDir), mode: 0o600 });
    return { status: "created", state_root: stateRoot, assignment: record };
  });
}

export async function assignmentAuthority({ stateRoot, assignmentId }) {
  const raw = await readJson(assignmentPaths(stateRoot, assignmentId).record, {
    guardRoot: resolve(stateRoot, "..", ".."),
  });
  return validateAssignmentAuthority(raw);
}

export async function assignmentAuthorityForRoute({ stateRoot, routeId }) {
  const records = resolve(stateRoot, "records");
  const { readdir } = await import("node:fs/promises");
  let entries;
  try { entries = await readdir(records, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateAssignmentAuthority(await readJson(resolve(records, entry.name), {
      guardRoot: resolve(stateRoot, "..", ".."),
    }));
    if (record.route_id === routeId) matches.push(record);
  }
  if (matches.length > 1) throw new CliError("Report route matches multiple assignment authorities", 73);
  return matches[0] ?? null;
}

export async function openAssignmentForSender({ stateRoot, hostId, threadId, runId = null }) {
  const records = resolve(stateRoot, "records");
  const { readdir } = await import("node:fs/promises");
  let entries;
  try { entries = await readdir(records, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateAssignmentAuthority(await readJson(resolve(records, entry.name), {
      guardRoot: resolve(stateRoot, "..", ".."),
    }));
    if (
      record.state === "open"
      && record.sender.host_id === hostId
      && record.sender.thread_id === threadId
      && (runId === null || record.execution_bindings.some((binding) => binding.run_id === runId))
    ) matches.push(record);
  }
  if (matches.length > 1) throw new CliError("Sender has multiple open assignment authorities", 73);
  return matches[0] ?? null;
}

/** Append one authenticated replacement-run binding without changing assignment identity. */
export async function bindAssignmentRefreshExecution({
  commonDir,
  sender,
  source,
  targetExecutionBinding,
}) {
  const common = resolve(requireText(commonDir, "common_dir", { max: 2048 }));
  const stateRoot = assignmentStateRoot(common);
  const senderIdentity = identity(sender, "sender", { host: true });
  requireExactFields(source, {
    required: [
      "run_id", "runtime_context_digest", "plan_id", "namespace",
    ],
  }, "refresh source execution");
  const sourceExecution = {
    run_id: requireText(source.run_id, "refresh source execution.run_id", { max: 128, safeId: true }),
    runtime_context_digest: digest(
      source.runtime_context_digest,
      "refresh source execution.runtime_context_digest",
    ),
    plan_id: requireText(source.plan_id, "refresh source execution.plan_id", { max: 128, safeId: true }),
    namespace: requireText(source.namespace, "refresh source execution.namespace", { max: 128, safeId: true }),
  };
  const target = executionBinding(targetExecutionBinding, "target_execution_binding");
  if (`${sourceExecution.namespace}:${sourceExecution.run_id}` === `${target.namespace}:${target.run_id}`) {
    throw new CliError("Refresh target execution must differ from its source", 73);
  }

  const assignment = await openAssignmentForSender({
    stateRoot,
    hostId: senderIdentity.host_id,
    threadId: senderIdentity.thread_id,
  });
  if (assignment === null) {
    return { status: "no-open-assignment", state_root: stateRoot, assignment: null };
  }
  if (assignment.common_dir !== common) throw new CliError("Open assignment belongs to a different repository", 73);

  const sourceMismatches = (binding) => Object.entries(sourceExecution)
    .filter(([field, expected]) => binding[field] !== expected)
    .map(([field]) => field);
  return updateAssignmentAuthority({
    stateRoot,
    assignmentId: assignment.assignment_id,
    update(current) {
      if (current.state !== "open") throw new CliError("Only an open assignment can bind a refresh execution", 73);
      if (stableStringify(current.sender) !== stableStringify(senderIdentity)) {
        throw new CliError("Refresh sender does not match the open assignment", 73);
      }
      const existingTarget = current.execution_bindings.find(
        (binding) => binding.namespace === target.namespace && binding.run_id === target.run_id,
      );
      if (existingTarget !== undefined) {
        if (stableStringify(existingTarget) !== stableStringify(target)) {
          throw new CliError("Assignment refresh target conflicts with its existing execution binding", 73);
        }
        return current;
      }
      const latest = current.execution_bindings.at(-1);
      const mismatches = sourceMismatches(latest);
      if (mismatches.length > 0) {
        throw new CliError(
          `Assignment refresh source is not its latest authenticated execution: ${mismatches.join(", ")}`,
          73,
        );
      }
      if (Date.parse(target.bound_at) < Date.parse(latest.bound_at)) {
        throw new CliError("Assignment refresh target predates its source execution", 73);
      }
      if (current.execution_bindings.length >= 64) {
        throw new CliError("Assignment execution binding history is full", 73);
      }
      return {
        ...current,
        execution_bindings: [...current.execution_bindings, target],
        updated_at: target.bound_at,
      };
    },
  }).then((updated) => ({
    status: updated.execution_bindings.length === assignment.execution_bindings.length
      ? "already-bound"
      : "bound",
    state_root: stateRoot,
    assignment: updated,
  }));
}

export async function assertAssignmentRouteAuthority({ stateRoot, route }) {
  const assignment = await assignmentAuthority({ stateRoot, assignmentId: route.assignment.assignment_id });
  if (assignment.state !== "open" && assignment.state !== "accepted") {
    throw new CliError("Coordinator reporting assignment is not open", 73);
  }
  if (
    assignment.route_id !== route.route_id
    || assignment.common_dir !== route.assignment.common_dir
    || assignment.repository_digest !== route.assignment.repository_digest
    || assignment.approved_plan.digest !== route.assignment.approved_plan_digest
    || assignment.approved_plan.snapshot_path !== route.assignment.approved_plan_path
    || stableStringify(assignment.sender) !== stableStringify(route.sender)
    || stableStringify(assignment.recipient) !== stableStringify(route.recipient)
  ) throw new CliError("Coordinator route does not match assignment-lived authority", 73);
  if (sha256(await readFile(assignment.approved_plan.snapshot_path)) !== assignment.approved_plan.digest) {
    throw new CliError("Assignment approved-plan snapshot was tampered", 73);
  }
  return assignment;
}

export async function updateAssignmentAuthority({ stateRoot, assignmentId, update }) {
  if (typeof update !== "function") throw new CliError("assignment update must be a function");
  const commonDir = resolve(stateRoot, "..", "..");
  const location = assignmentPaths(stateRoot, assignmentId);
  return withProcessLock({ path: location.lock, guardRoot: commonDir, label: `assignment ${assignmentId}` }, async () => {
    const current = validateAssignmentAuthority(await readJson(location.record, { guardRoot: commonDir }));
    const next = validateAssignmentAuthority(await update(current));
    if (next.assignment_id !== current.assignment_id) throw new CliError("Assignment identity cannot change", 73);
    await atomicWriteJson(location.record, next, { guardRoot: commonDir, mode: 0o600 });
    return next;
  });
}
