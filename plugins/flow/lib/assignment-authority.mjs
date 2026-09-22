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
import { validateFencePlan } from "./run-lifecycle.mjs";

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

const REGISTRATION_STAGES = ["iteration", "recipient_binding", "route", "locator"];

function registration(value) {
  requireExactFields(value, {
    required: ["status", "iteration", "recipient_binding", "route", "locator", "updated_at"],
  }, "registration");
  const record = {
    status: requireEnum(value.status, ["registering", "ready", "aborted"], "registration.status"),
    iteration: requireEnum(value.iteration, ["pending", "ready"], "registration.iteration"),
    recipient_binding: requireEnum(
      value.recipient_binding,
      ["pending", "ready"],
      "registration.recipient_binding",
    ),
    route: requireEnum(value.route, ["pending", "ready"], "registration.route"),
    locator: requireEnum(value.locator, ["pending", "ready"], "registration.locator"),
    updated_at: timestamp(value.updated_at, "registration.updated_at"),
  };
  const ready = REGISTRATION_STAGES.every((stage) => record[stage] === "ready");
  if (record.status === "ready" && !ready) {
    throw new CliError("Ready registration requires every durable artifact");
  }
  return record;
}

function retirementTerminal(value, status, label) {
  if (status === "closed") {
    requireExactFields(value, {
      required: ["kind", "closed_at", "unresolved_fences"],
    }, label);
    if (value.kind !== "closed") throw new CliError(`${label}.kind must be closed`);
    const unresolvedFences = validateFencePlan(value.unresolved_fences, `${label}.unresolved_fences`);
    if (
      unresolvedFences.path_fences.length > 0
      || unresolvedFences.resource_fences.length > 0
      || unresolvedFences.branch_fences.length > 0
    ) throw new CliError("Closed execution retirement cannot retain unresolved fences");
    return {
      kind: "closed",
      closed_at: timestamp(value.closed_at, `${label}.closed_at`),
      unresolved_fences: unresolvedFences,
    };
  }
  requireExactFields(value, {
    required: ["kind", "abandoned_at", "reason", "unresolved_fences"],
  }, label);
  if (value.kind !== "abandoned") throw new CliError(`${label}.kind must be abandoned`);
  return {
    kind: "abandoned",
    abandoned_at: timestamp(value.abandoned_at, `${label}.abandoned_at`),
    reason: requireText(value.reason, `${label}.reason`, { max: 512 }),
    unresolved_fences: validateFencePlan(value.unresolved_fences, `${label}.unresolved_fences`),
  };
}

function executionRetirement(value, label) {
  requireExactFields(value, {
    required: [
      "namespace", "run_id", "runtime_context_digest", "terminal_status", "terminal",
      "terminal_digest", "evidence_source", "evidence_digest", "resource_disposition",
      "owner_thread_id", "next_action", "observed_at",
    ],
  }, label);
  const terminalStatus = requireEnum(
    value.terminal_status,
    ["closed", "abandoned"],
    `${label}.terminal_status`,
  );
  const terminal = retirementTerminal(value.terminal, terminalStatus, `${label}.terminal`);
  const record = {
    namespace: requireText(value.namespace, `${label}.namespace`, { max: 128, safeId: true }),
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    terminal_status: terminalStatus,
    terminal,
    terminal_digest: digest(value.terminal_digest, `${label}.terminal_digest`),
    evidence_source: requireEnum(value.evidence_source, ["runtime", "refresh"], `${label}.evidence_source`),
    evidence_digest: digest(value.evidence_digest, `${label}.evidence_digest`),
    resource_disposition: requireEnum(
      value.resource_disposition,
      ["released", "retained", "refresh-retired"],
      `${label}.resource_disposition`,
    ),
    owner_thread_id: requireText(value.owner_thread_id, `${label}.owner_thread_id`, {
      max: 256,
      safeId: true,
    }),
    next_action: value.next_action === null
      ? null
      : requireText(value.next_action, `${label}.next_action`, { max: 512 }),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
  };
  if (record.terminal_digest !== sha256(stableStringify(record.terminal))) {
    throw new CliError(`${label}.terminal_digest does not match its terminal evidence`);
  }
  if (record.resource_disposition === "released" && record.terminal_status !== "closed") {
    throw new CliError("Only a closed execution can release its reservations directly");
  }
  if (record.resource_disposition === "refresh-retired" && record.evidence_source !== "refresh") {
    throw new CliError("Refresh-retired execution evidence requires refresh authority");
  }
  if ((record.resource_disposition === "retained") !== (record.next_action !== null)) {
    throw new CliError("Retained execution obligations require exactly one next action");
  }
  return record;
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

export function assignmentMembershipAuthorityDigest(value) {
  const assignment = validateAssignmentAuthority(value);
  return sha256(stableStringify({
    assignment_id: assignment.assignment_id,
    route_id: assignment.route_id,
    common_dir: assignment.common_dir,
    sender: assignment.sender,
    recipient: assignment.recipient,
    iteration_id: assignment.iteration_id,
    iteration_label: assignment.iteration_label,
    purpose: assignment.purpose,
    created_at: assignment.created_at,
  }));
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
    optional: ["cancellation", "registration", "execution_retirements"],
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
    state: requireEnum(value.state, ["registering", "open", "accepted", "cancelled", "retired"], "state"),
    acceptance: value.acceptance,
    cancellation: Object.hasOwn(value, "cancellation") ? cancellation(value.cancellation) : null,
    ...(Object.hasOwn(value, "registration") ? { registration: registration(value.registration) } : {}),
    ...(Object.hasOwn(value, "execution_retirements") ? {
      execution_retirements: Array.isArray(value.execution_retirements)
        ? value.execution_retirements.map((entry, index) => executionRetirement(
          entry,
          `execution_retirements[${index}]`,
        )).sort((left, right) => (
          `${left.namespace}:${left.run_id}`.localeCompare(`${right.namespace}:${right.run_id}`)
        ))
        : (() => { throw new CliError("execution_retirements must be an array"); })(),
    } : {}),
    created_at: timestamp(value.created_at, "created_at"),
    updated_at: timestamp(value.updated_at, "updated_at"),
  };
  if (new Set(record.execution_bindings.map((entry) => `${entry.namespace}:${entry.run_id}`)).size !== record.execution_bindings.length) {
    throw new CliError("assignment execution bindings contain a duplicate run authority");
  }
  if (record.execution_retirements !== undefined) {
    if (record.execution_retirements.length > record.execution_bindings.length) {
      throw new CliError("execution_retirements cannot exceed execution bindings");
    }
    if (new Set(record.execution_retirements.map((entry) => `${entry.namespace}:${entry.run_id}`)).size !== record.execution_retirements.length) {
      throw new CliError("execution_retirements contains duplicate run authority");
    }
    for (const retirement of record.execution_retirements) {
      const binding = record.execution_bindings.find((entry) => (
        entry.namespace === retirement.namespace && entry.run_id === retirement.run_id
      ));
      if (
        binding === undefined
        || binding.runtime_context_digest !== retirement.runtime_context_digest
        || retirement.owner_thread_id !== record.sender.thread_id
      ) throw new CliError("execution retirement does not match assignment execution authority");
    }
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
  const explicitRegistration = record.registration ?? null;
  if (record.state === "registering") {
    if (explicitRegistration === null || explicitRegistration.status !== "registering") {
      throw new CliError("Registering assignment requires explicit unfinished registration evidence");
    }
    if (record.acceptance !== null || record.cancellation !== null) {
      throw new CliError("Registering assignment cannot contain terminal evidence");
    }
  } else if (record.state === "open") {
    if (explicitRegistration !== null && explicitRegistration.status !== "ready") {
      throw new CliError("Open assignment requires published registration readiness");
    }
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
  } else {
    if (record.cancellation === null) {
      throw new CliError("Cancelled assignment requires cancellation evidence");
    }
    if (record.acceptance !== null) {
      requireExactFields(record.acceptance, {
        required: ["report_id", "report_digest", "accepted_by_thread_id", "accepted_at"],
      }, "acceptance");
      record.acceptance = {
        report_id: requireText(record.acceptance.report_id, "acceptance.report_id", { max: 128, safeId: true }),
        report_digest: digest(record.acceptance.report_digest, "acceptance.report_digest"),
        accepted_by_thread_id: requireText(record.acceptance.accepted_by_thread_id, "acceptance.accepted_by_thread_id", { max: 256, safeId: true }),
        accepted_at: timestamp(record.acceptance.accepted_at, "acceptance.accepted_at"),
      };
    }
  }
  if (
    record.state === "cancelled"
    && explicitRegistration !== null
    && !["ready", "aborted"].includes(explicitRegistration.status)
  ) throw new CliError("Cancelled assignment registration must be ready or aborted");
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
    state: "registering",
    acceptance: null,
    cancellation: null,
    registration: {
      status: "registering",
      iteration: "pending",
      recipient_binding: "pending",
      route: "pending",
      locator: "pending",
      updated_at: createdAt,
    },
    execution_retirements: [],
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

async function assignmentForSender({
  stateRoot,
  hostId,
  threadId,
  runId,
  states,
  multipleLabel,
}) {
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
      states.includes(record.state)
      && record.sender.host_id === hostId
      && record.sender.thread_id === threadId
      && (runId === null || record.execution_bindings.some((binding) => binding.run_id === runId))
    ) matches.push(record);
  }
  if (matches.length > 1) throw new CliError(multipleLabel, 73);
  return matches[0] ?? null;
}

export function openAssignmentForSender({ stateRoot, hostId, threadId, runId = null }) {
  return assignmentForSender({
    stateRoot,
    hostId,
    threadId,
    runId,
    states: ["registering", "open"],
    multipleLabel: "Sender has multiple open assignment authorities",
  });
}

export function assignmentForExecutionRetirement({ stateRoot, hostId, threadId, runId }) {
  return assignmentForSender({
    stateRoot,
    hostId,
    threadId,
    runId,
    states: ["registering", "open", "accepted"],
    multipleLabel: "Sender has multiple unsettled assignment authorities",
  });
}

function assignmentForRefreshSource({ stateRoot, hostId, threadId, runId }) {
  return assignmentForSender({
    stateRoot,
    hostId,
    threadId,
    runId,
    states: ["registering", "open", "accepted", "cancelled", "retired"],
    multipleLabel: "Refresh source matches multiple assignment authorities",
  });
}

export function assignmentRegistration(record) {
  const assignment = validateAssignmentAuthority(record);
  return assignment.registration ?? {
    status: "ready",
    iteration: "ready",
    recipient_binding: "ready",
    route: "ready",
    locator: "ready",
    updated_at: assignment.created_at,
  };
}

export async function markAssignmentRegistrationStage({
  stateRoot,
  assignmentId,
  stage,
  now = Date.now(),
}) {
  const selected = requireEnum(stage, REGISTRATION_STAGES, "assignment registration stage");
  return updateAssignmentAuthority({
    stateRoot,
    assignmentId,
    update(current) {
      if (current.registration === undefined) {
        throw new CliError("Legacy ready assignments do not have resumable registration", 73);
      }
      if (current.state !== "registering" || current.registration.status !== "registering") {
        if (current.registration.status === "ready" && current.registration[selected] === "ready") return current;
        throw new CliError("Only an unfinished registration can advance", 73);
      }
      const index = REGISTRATION_STAGES.indexOf(selected);
      const missingPredecessor = REGISTRATION_STAGES.slice(0, index).find(
        (candidate) => current.registration[candidate] !== "ready",
      );
      if (missingPredecessor !== undefined) {
        throw new CliError(`Assignment registration ${selected} requires ${missingPredecessor}`, 73);
      }
      if (current.registration[selected] === "ready") return current;
      const updatedAt = new Date(now).toISOString();
      return {
        ...current,
        registration: { ...current.registration, [selected]: "ready", updated_at: updatedAt },
        updated_at: updatedAt,
      };
    },
  });
}

export async function publishAssignmentReadiness({ stateRoot, assignmentId, now = Date.now() }) {
  return updateAssignmentAuthority({
    stateRoot,
    assignmentId,
    update(current) {
      if (current.state === "open" && assignmentRegistration(current).status === "ready") return current;
      if (current.state !== "registering" || current.registration === undefined) {
        throw new CliError("Only an unfinished registration can publish readiness", 73);
      }
      if (!REGISTRATION_STAGES.every((stage) => current.registration[stage] === "ready")) {
        throw new CliError("Assignment registration is incomplete", 73);
      }
      const updatedAt = new Date(now).toISOString();
      return {
        ...current,
        state: "open",
        registration: { ...current.registration, status: "ready", updated_at: updatedAt },
        updated_at: updatedAt,
      };
    },
  });
}

export async function recordAssignmentExecutionRetirement({
  stateRoot,
  assignmentId,
  retirement,
}) {
  const requested = executionRetirement(retirement, "execution retirement");
  return updateAssignmentAuthority({
    stateRoot,
    assignmentId,
    update(current) {
      const binding = current.execution_bindings.find((entry) => (
        entry.namespace === requested.namespace && entry.run_id === requested.run_id
      ));
      if (
        binding === undefined
        || binding.runtime_context_digest !== requested.runtime_context_digest
        || requested.owner_thread_id !== current.sender.thread_id
      ) throw new CliError("Execution retirement does not match assignment authority", 73);
      const retirements = current.execution_retirements ?? [];
      const existing = retirements.find((entry) => (
        entry.namespace === requested.namespace && entry.run_id === requested.run_id
      ));
      if (existing !== undefined) {
        const { observed_at: existingAt, ...existingAuthority } = existing;
        const { observed_at: requestedAt, ...requestedAuthority } = requested;
        if (stableStringify(existingAuthority) === stableStringify(requestedAuthority)) return current;

        const retirementBasis = (entry) => {
          const {
            evidence_source: ignoredEvidenceSource,
            evidence_digest: ignoredEvidenceDigest,
            resource_disposition: ignoredDisposition,
            next_action: ignoredNextAction,
            ...basis
          } = entry;
          return basis;
        };
        const refreshRetiresPersistedRuntime = (
          requested.evidence_source === "refresh"
          && requested.resource_disposition === "refresh-retired"
          && requested.next_action === null
          && existing.evidence_source === "runtime"
          && ["retained", "released"].includes(existing.resource_disposition)
          && stableStringify(retirementBasis(existingAuthority))
            === stableStringify(retirementBasis(requestedAuthority))
        );
        if (!refreshRetiresPersistedRuntime) {
          throw new CliError("Execution retirement conflicts with persisted evidence", 73);
        }
        const updatedAt = new Date(Math.max(
          Date.parse(current.updated_at),
          Date.parse(requested.observed_at),
        )).toISOString();
        return {
          ...current,
          execution_retirements: retirements.map((entry) => (
            entry.namespace === requested.namespace && entry.run_id === requested.run_id
              ? requested
              : entry
          )),
          updated_at: updatedAt,
        };
      }
      return {
        ...current,
        execution_retirements: [...retirements, requested],
        updated_at: new Date(Math.max(
          Date.parse(current.updated_at),
          Date.parse(requested.observed_at),
        )).toISOString(),
      };
    },
  });
}

/**
 * Append one authenticated replacement-run binding without changing assignment
 * identity. Refresh admission may provide a bounded post-persist operation: the
 * assignment lock remains held so cancellation observes either the old open
 * source or the durable target obligation, never an admitted unbound target.
 */
export async function bindAssignmentRefreshExecution({
  commonDir,
  sender,
  source,
  targetExecutionBinding,
  beforeBinding = null,
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
  if (beforeBinding !== null && typeof beforeBinding !== "function") {
    throw new CliError("beforeBinding must be a function");
  }
  if (`${sourceExecution.namespace}:${sourceExecution.run_id}` === `${target.namespace}:${target.run_id}`) {
    throw new CliError("Refresh target execution must differ from its source", 73);
  }

  const assignment = await (beforeBinding === null ? openAssignmentForSender : assignmentForRefreshSource)({
    stateRoot,
    hostId: senderIdentity.host_id,
    threadId: senderIdentity.thread_id,
    runId: sourceExecution.run_id,
  });
  if (assignment === null) {
    const operationResult = beforeBinding === null ? undefined : await beforeBinding(null);
    return {
      status: "no-open-assignment",
      state_root: stateRoot,
      assignment: null,
      ...(beforeBinding === null ? {} : { operation_result: operationResult }),
    };
  }
  if (assignment.common_dir !== common) throw new CliError("Open assignment belongs to a different repository", 73);

  const sourceMismatches = (binding) => Object.entries(sourceExecution)
    .filter(([field, expected]) => binding[field] !== expected)
    .map(([field]) => field);
  let operationResult;
  const updated = await updateAssignmentAuthority({
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
    afterPersist: beforeBinding === null ? null : async (persisted) => {
      operationResult = await beforeBinding(persisted);
    },
  });
  return {
    status: updated.execution_bindings.length === assignment.execution_bindings.length
      ? "already-bound"
      : "bound",
    state_root: stateRoot,
    assignment: updated,
    ...(beforeBinding === null ? {} : { operation_result: operationResult }),
  };
}

export async function assertAssignmentRouteAuthority({
  stateRoot,
  route,
  allowRegistering = false,
  allowRetired = false,
}) {
  const assignment = await assignmentAuthority({ stateRoot, assignmentId: route.assignment.assignment_id });
  const permitted = [
    ...(allowRegistering ? ["registering"] : []),
    "open",
    "accepted",
    ...(allowRetired ? ["retired"] : []),
  ];
  if (!permitted.includes(assignment.state)) {
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

export async function updateAssignmentAuthority({
  stateRoot,
  assignmentId,
  update,
  afterPersist = null,
}) {
  if (typeof update !== "function") throw new CliError("assignment update must be a function");
  if (afterPersist !== null && typeof afterPersist !== "function") {
    throw new CliError("assignment afterPersist must be a function");
  }
  const commonDir = resolve(stateRoot, "..", "..");
  const location = assignmentPaths(stateRoot, assignmentId);
  return withProcessLock({ path: location.lock, guardRoot: commonDir, label: `assignment ${assignmentId}` }, async () => {
    const current = validateAssignmentAuthority(await readJson(location.record, { guardRoot: commonDir }));
    const next = validateAssignmentAuthority(await update(current));
    if (next.assignment_id !== current.assignment_id) throw new CliError("Assignment identity cannot change", 73);
    await atomicWriteJson(location.record, next, { guardRoot: commonDir, mode: 0o600 });
    if (afterPersist !== null) await afterPersist(next);
    return next;
  });
}
