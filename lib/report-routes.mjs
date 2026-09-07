import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
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
  sha256File,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";
import { bindRecipient, resolveRecipient } from "./recipients.mjs";
import { recipientBindingDigest } from "./task-results.mjs";
import {
  assertTaskLaunchRuntimeAuthority,
  taskLaunchStatus,
} from "./core/task-launch.mjs";
import { validateRunLifecycleState } from "./run-lifecycle.mjs";
import { createIterationForAssignment } from "./iteration-registry.mjs";
import {
  assignmentAuthorityForRoute,
  assignmentIdFor,
  assignmentStateRoot,
  assertAssignmentRouteAuthority,
  createAssignmentAuthority,
} from "./assignment-authority.mjs";

export const REPORT_ROUTE_SCHEMA_VERSION = 1;
export const REPORT_ROUTE_KIND = "codex-flow-v093-report-route";
export const REPORT_ROUTE_ID_PREFIX = "report-route-v1-";

const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const ROUTE_STATES = ["active", "closed"];
const CLOSURE_REASONS = ["terminal", "archived", "refresh", "unplug", "manual"];

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(stateRoot);
}

async function readRunFromStateRoot(stateRoot, runId) {
  const exactStateRoot = resolve(stateRoot);
  const commonDir = guardRoot(exactStateRoot);
  await assertNoSymlinkComponents(commonDir, exactStateRoot, "Report route state root");
  const lifecycle = validateRunLifecycleState(await readJson(resolve(exactStateRoot, "runs", "lifecycle.json"), {
    guardRoot: commonDir,
  }));
  const run = lifecycle.runs[requireText(runId, "run_id", { max: 128, safeId: true })];
  if (!run) throw new CliError(`Unknown report route run: ${runId}`, 73);
  return run;
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit timestamp`);
  }
  return result;
}

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function safeChild(directory, filename, label = "report route") {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label} state path`);
  }
  return path;
}

function hostId(value, label) {
  return requireText(value, label, { max: 128, safeId: true });
}

function routeId(value) {
  const result = requireText(value, "route_id", { max: 128, safeId: true });
  if (!new RegExp(`^${REPORT_ROUTE_ID_PREFIX}[0-9a-f]{64}$`).test(result)) {
    throw new CliError("route_id must be a report-route-v1 ID");
  }
  return result;
}

function sender(value, label = "sender") {
  requireExactFields(value, { required: ["host_id", "thread_id"] }, label);
  return {
    host_id: hostId(value.host_id, `${label}.host_id`),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
  };
}

function recipient(value, label = "recipient") {
  requireExactFields(value, {
    required: ["host_id", "lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const normalized = {
    host_id: hostId(value.host_id, `${label}.host_id`),
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, {
      min: 1,
      max: 2147483647,
    }),
    binding_digest: digest(value.binding_digest, `${label}.binding_digest`),
  };
  const expected = recipientBindingDigest({
    lineage_id: normalized.lineage_id,
    thread_id: normalized.thread_id,
    generation: normalized.generation,
  });
  if (normalized.binding_digest !== expected) {
    throw new CliError(`${label}.binding_digest does not match the recipient identity`);
  }
  return normalized;
}

function taskLaunchAssignment(value, label) {
  requireExactFields(value, {
    required: [
      "kind", "assignment_id", "run_id", "runtime_context_digest", "configuration_digest",
      "repository_id", "common_dir", "plan_id", "revision_digest", "task_id",
      "task_digest", "contract_id", "launch_id",
    ],
  }, label);
  const normalized = {
    kind: requireEnum(value.kind, ["task-launch"], `${label}.kind`),
    assignment_id: requireText(value.assignment_id, `${label}.assignment_id`, { max: 128, safeId: true }),
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    configuration_digest: digest(value.configuration_digest, `${label}.configuration_digest`),
    repository_id: requireText(value.repository_id, `${label}.repository_id`, { max: 128, safeId: true }),
    common_dir: requireText(value.common_dir, `${label}.common_dir`, { max: 4096 }),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, `${label}.revision_digest`),
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    task_digest: digest(value.task_digest, `${label}.task_digest`),
    contract_id: digest(value.contract_id, `${label}.contract_id`),
    launch_id: requireText(value.launch_id, `${label}.launch_id`, { max: 128, safeId: true }),
  };
  if (!normalized.launch_id.startsWith("task-launch-v1-")) {
    throw new CliError(`${label}.launch_id must be a task launch ID`);
  }
  if (normalized.assignment_id !== normalized.launch_id) {
    throw new CliError(`${label}.assignment_id must equal its launch_id`);
  }
  if (!normalized.common_dir.startsWith("/")) throw new CliError(`${label}.common_dir must be absolute`);
  return normalized;
}

function coordinatorAssignment(value, label) {
  requireExactFields(value, {
    required: [
      "kind", "assignment_id", "run_id", "runtime_context_digest", "configuration_digest",
      "repository_digest", "common_dir", "plan_id", "revision_digest", "approved_plan_path",
      "approved_plan_digest",
    ],
  }, label);
  const normalized = {
    kind: requireEnum(value.kind, ["coordinator-delegation"], `${label}.kind`),
    assignment_id: requireText(value.assignment_id, `${label}.assignment_id`, { max: 128, safeId: true }),
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: digest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    configuration_digest: digest(value.configuration_digest, `${label}.configuration_digest`),
    repository_digest: digest(value.repository_digest, `${label}.repository_digest`),
    common_dir: requireText(value.common_dir, `${label}.common_dir`, { max: 4096 }),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: digest(value.revision_digest, `${label}.revision_digest`),
    approved_plan_path: requireText(value.approved_plan_path, `${label}.approved_plan_path`, { max: 4096 }),
    approved_plan_digest: digest(value.approved_plan_digest, `${label}.approved_plan_digest`),
  };
  if (!normalized.assignment_id.startsWith("coordinator-assignment-v1-")) {
    throw new CliError(`${label}.assignment_id must be a coordinator assignment ID`);
  }
  if (!normalized.common_dir.startsWith("/") || !normalized.approved_plan_path.startsWith("/")) {
    throw new CliError(`${label} paths must be absolute`);
  }
  return normalized;
}

function assignment(value, label = "assignment") {
  if (value?.kind === "task-launch") return taskLaunchAssignment(value, label);
  if (value?.kind === "coordinator-delegation") return coordinatorAssignment(value, label);
  throw new CliError(`${label}.kind must identify task-launch or coordinator-delegation`);
}

function routeIdentity(value) {
  return {
    assignment: value.assignment,
    sender: value.sender,
    recipient: value.recipient,
  };
}

export function reportRouteIdFor(value) {
  const route = value.route_id === undefined
    ? validateReportRoute({
      schema_version: REPORT_ROUTE_SCHEMA_VERSION,
      kind: REPORT_ROUTE_KIND,
      route_id: `${REPORT_ROUTE_ID_PREFIX}${"0".repeat(64)}`,
      assignment: value.assignment,
      sender: value.sender,
      recipient: value.recipient,
      state: "active",
      lifecycle: { opened_at: "2026-01-01T00:00:00.000Z", closed_at: null, closure_reason: null },
    }, { allowComputedId: true })
    : validateReportRoute(value);
  return `${REPORT_ROUTE_ID_PREFIX}${sha256(stableStringify(routeIdentity(route)))}`;
}

export function validateReportRoute(value, { allowComputedId = false } = {}) {
  requireExactFields(value, {
    required: ["schema_version", "kind", "route_id", "assignment", "sender", "recipient", "state", "lifecycle"],
  }, "Report route");
  if (value.schema_version !== REPORT_ROUTE_SCHEMA_VERSION || value.kind !== REPORT_ROUTE_KIND) {
    throw new CliError("Unsupported report route authority");
  }
  const normalized = {
    schema_version: REPORT_ROUTE_SCHEMA_VERSION,
    kind: REPORT_ROUTE_KIND,
    route_id: routeId(value.route_id),
    assignment: assignment(value.assignment),
    sender: sender(value.sender),
    recipient: recipient(value.recipient),
    state: requireEnum(value.state, ROUTE_STATES, "report route state"),
    lifecycle: null,
  };
  if (normalized.sender.host_id !== normalized.recipient.host_id) {
    throw new CliError("Automatic report routes require the same sender and recipient host", 73);
  }
  if (normalized.sender.thread_id === normalized.recipient.thread_id) {
    throw new CliError("Automatic report routes cannot target their own sender", 73);
  }
  const expectedId = `${REPORT_ROUTE_ID_PREFIX}${sha256(stableStringify(routeIdentity(normalized)))}`;
  if (!allowComputedId && normalized.route_id !== expectedId) {
    throw new CliError("report route_id does not match its authenticated identity");
  }
  requireExactFields(value.lifecycle, { required: ["opened_at", "closed_at", "closure_reason"] }, "report route lifecycle");
  normalized.lifecycle = {
    opened_at: timestamp(value.lifecycle.opened_at, "report route.lifecycle.opened_at"),
    closed_at: value.lifecycle.closed_at === null
      ? null
      : timestamp(value.lifecycle.closed_at, "report route.lifecycle.closed_at"),
    closure_reason: value.lifecycle.closure_reason === null
      ? null
      : requireEnum(value.lifecycle.closure_reason, CLOSURE_REASONS, "report route.lifecycle.closure_reason"),
  };
  if (normalized.state === "active" && (
    normalized.lifecycle.closed_at !== null || normalized.lifecycle.closure_reason !== null
  )) throw new CliError("Active report route cannot have closure evidence");
  if (normalized.state === "closed" && (
    normalized.lifecycle.closed_at === null || normalized.lifecycle.closure_reason === null
  )) throw new CliError("Closed report route requires closure evidence");
  if (
    normalized.lifecycle.closed_at !== null
    && Date.parse(normalized.lifecycle.closed_at) < Date.parse(normalized.lifecycle.opened_at)
  ) throw new CliError("Report route closure precedes route opening");
  return normalized;
}

function paths(stateRoot, id) {
  const route = routeId(id);
  const root = resolve(stateRoot, "reports", "routes");
  return {
    record: safeChild(resolve(root, "records"), `${route}.json`),
    lock: safeChild(resolve(root, "locks"), `${route}.lock.json`),
  };
}

async function readRoute(stateRoot, id, { allowMissing = false } = {}) {
  const value = await readJson(paths(stateRoot, id).record, {
    allowMissing,
    guardRoot: guardRoot(stateRoot),
  });
  return value === null ? null : validateReportRoute(value);
}

async function writeRoute(stateRoot, route, { exclusive = false } = {}) {
  const validated = validateReportRoute(route);
  const write = exclusive ? ensureExactJson : atomicWriteJson;
  await write(paths(stateRoot, validated.route_id).record, validated, {
    guardRoot: guardRoot(stateRoot),
    mode: 0o600,
  });
  return validated;
}

async function withRouteLock(stateRoot, id, operation) {
  return withProcessLock({
    path: paths(stateRoot, id).lock,
    guardRoot: guardRoot(stateRoot),
    label: `report route ${id}`,
  }, async () => {
    const route = await readRoute(stateRoot, id);
    return operation(route);
  });
}

function assignmentFromLaunch(launch) {
  return {
    kind: "task-launch",
    assignment_id: launch.launch_id,
    run_id: launch.run_id,
    runtime_context_digest: launch.runtime_context_digest,
    configuration_digest: launch.configuration_digest,
    repository_id: launch.repository_id,
    common_dir: launch.common_dir,
    plan_id: launch.plan_id,
    revision_digest: launch.revision_digest,
    task_id: launch.task_id,
    task_digest: launch.task_digest,
    contract_id: launch.contract_id,
    launch_id: launch.launch_id,
  };
}

function assertRouteMatchesLaunch(route, launch) {
  if (stableStringify(route.assignment) !== stableStringify(assignmentFromLaunch(launch))) {
    throw new CliError("Report route assignment does not match the authoritative launch", 73);
  }
  if (launch.start_claim === null || route.sender.thread_id !== launch.start_claim.executor_thread_id) {
    throw new CliError("Report route sender does not match the accepted task identity", 73);
  }
  if (stableStringify({
    lineage_id: route.recipient.lineage_id,
    thread_id: route.recipient.thread_id,
    generation: route.recipient.generation,
    binding_digest: route.recipient.binding_digest,
  }) !== stableStringify(launch.coordinator_binding)) {
    throw new CliError("Report route recipient does not match the launch coordinator binding", 73);
  }
}

async function assertCoordinatorRouteAuthority(stateRoot, route) {
  const assignmentAuthority = await assignmentAuthorityForRoute({
    stateRoot,
    routeId: route.route_id,
  });
  if (assignmentAuthority !== null) {
    await assertAssignmentRouteAuthority({ stateRoot, route });
    return;
  }
  const run = await readRunFromStateRoot(stateRoot, route.assignment.run_id);
  if (run.status !== "active") throw new CliError("Coordinator report route run is not active", 73);
  const expectedAssignment = {
    runtime_context_digest: run.runtime_context_hash,
    configuration_digest: run.binding.config_hash,
    repository_digest: run.binding.repository_hash,
    plan_id: run.workflow_plan_id,
    revision_digest: run.workflow_revision_digest,
    common_dir: guardRoot(stateRoot),
  };
  for (const [field, expected] of Object.entries(expectedAssignment)) {
    if (route.assignment[field] !== expected) {
      throw new CliError(`Coordinator report route ${field} does not match the active run`, 73);
    }
  }
  if (
    route.sender.host_id !== run.binding.host.host_id
    || route.sender.thread_id !== run.binding.lineage.thread_id
  ) throw new CliError("Coordinator report route sender does not match the active run", 73);
  if (await sha256File(route.assignment.approved_plan_path) !== route.assignment.approved_plan_digest) {
    throw new CliError("Coordinator report route approved plan digest has drifted", 73);
  }
}

async function assertRouteAuthority(stateRoot, route, { requireActive = false } = {}) {
  if (route.assignment.kind === "coordinator-delegation") {
    await assertCoordinatorRouteAuthority(stateRoot, route);
  } else {
    const launch = await assertTaskLaunchRuntimeAuthority({
      stateRoot,
      launchId: route.assignment.launch_id,
    });
    assertRouteMatchesLaunch(route, launch);
    if (launch.status !== "active" || launch.git_activation?.state !== "completed") {
      throw new CliError("Report route assignment is not active", 73);
    }
  }
  const resolved = await resolveRecipient({
    stateRoot,
    recipient: {
      lineage_id: route.recipient.lineage_id,
      thread_id: route.recipient.thread_id,
      generation: route.recipient.generation,
    },
  });
  if (resolved.stale || stableStringify(resolved.recipient) !== stableStringify({
    lineage_id: route.recipient.lineage_id,
    thread_id: route.recipient.thread_id,
    generation: route.recipient.generation,
  })) {
    throw new CliError("Report route recipient generation is stale", 73);
  }
  if (requireActive && route.state !== "active") {
    throw new CliError("Report route is closed; late reports are fenced", 73);
  }
  return route;
}

async function activeRoutesForSender(stateRoot, senderIdentity) {
  const root = resolve(stateRoot, "reports", "routes", "records");
  await assertNoSymlinkComponents(guardRoot(stateRoot), root, "Report route state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const routes = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new CliError(`Report route state contains a symbolic link: ${entry.name}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = safeChild(root, entry.name, "report route");
    const route = validateReportRoute(await readJson(path, { guardRoot: guardRoot(stateRoot) }));
    if (route.state === "active" && stableStringify(route.sender) === stableStringify(senderIdentity)) {
      routes.push(route);
    }
  }
  return routes;
}

/**
 * Registers the sole automatic upstream route for an active task launch. The
 * route is repository-scoped and does not discover or enumerate unrelated
 * Codex tasks; host equality is an explicit, authenticated boundary.
 */
export async function registerReportRoute({
  stateRoot,
  launchId,
  senderHostId,
  recipientHostId,
  now = Date.now(),
}) {
  const launch = await taskLaunchStatus({ stateRoot, launchId });
  if (launch.status !== "active" || launch.start_claim === null || launch.git_activation?.state !== "completed") {
    throw new CliError("Report route requires an active launch with an accepted sender identity", 73);
  }
  await assertTaskLaunchRuntimeAuthority({ stateRoot, launchId: launch.launch_id });
  const senderHost = hostId(senderHostId, "sender_host_id");
  const recipientHost = hostId(recipientHostId, "recipient_host_id");
  if (launch.creation_evidence?.host_id !== null && launch.creation_evidence?.host_id !== senderHost) {
    throw new CliError("Report route sender host conflicts with task creation evidence", 73);
  }
  const routeDraft = {
    assignment: assignmentFromLaunch(launch),
    sender: { host_id: senderHost, thread_id: launch.start_claim.executor_thread_id },
    recipient: {
      host_id: recipientHost,
      lineage_id: launch.coordinator_binding.lineage_id,
      thread_id: launch.coordinator_binding.thread_id,
      generation: launch.coordinator_binding.generation,
      binding_digest: launch.coordinator_binding.binding_digest,
    },
  };
  const id = `${REPORT_ROUTE_ID_PREFIX}${sha256(stableStringify(routeDraft))}`;
  const openedAt = new Date(now).toISOString();
  const route = validateReportRoute({
    schema_version: REPORT_ROUTE_SCHEMA_VERSION,
    kind: REPORT_ROUTE_KIND,
    route_id: id,
    ...routeDraft,
    state: "active",
    lifecycle: { opened_at: openedAt, closed_at: null, closure_reason: null },
  });
  await assertRouteAuthority(stateRoot, route, { requireActive: true });
  return withProcessLock({
    path: paths(stateRoot, id).lock,
    guardRoot: guardRoot(stateRoot),
    label: `report route ${id}`,
  }, async () => {
    const existing = await readRoute(stateRoot, id, { allowMissing: true });
    if (existing !== null) {
      if (stableStringify(routeIdentity(existing)) !== stableStringify(routeIdentity(route))) {
        throw new CliError("Report route ID collides with different authority", 73);
      }
      if (existing.state !== "active") throw new CliError("Closed report route cannot be re-armed", 73);
      return { status: "already-registered", route: existing };
    }
    const active = await activeRoutesForSender(stateRoot, route.sender);
    if (active.length > 0) {
      throw new CliError("Sender already has an active upstream report route", 73);
    }
    await writeRoute(stateRoot, route, { exclusive: true });
    return { status: "registered", route };
  });
}

/** Registers one authenticated active-run coordinator back to a pre-bound director. */
export async function registerCoordinatorReportRoute({
  stateRoot,
  runId,
  senderThreadId,
  senderHostId,
  recipient: recipientInput,
  approvedPlanPath,
  approvedPlanDigest,
  iterationLabel,
  purpose,
  repositoryRoot = null,
  repositoryBranch = null,
  now = Date.now(),
}) {
  const commonDir = guardRoot(stateRoot);
  const reportingStateRoot = assignmentStateRoot(commonDir);
  const run = await readRunFromStateRoot(stateRoot, runId);
  if (run.status !== "active") throw new CliError("Coordinator report route requires an active run", 73);
  const senderIdentity = sender({ host_id: senderHostId, thread_id: senderThreadId });
  if (
    senderIdentity.host_id !== run.binding.host.host_id
    || senderIdentity.thread_id !== run.binding.lineage.thread_id
  ) throw new CliError("Coordinator report sender does not match active run identity", 73);
  const recipientIdentity = recipient(recipientInput);
  if (senderIdentity.host_id !== recipientIdentity.host_id) {
    throw new CliError("Automatic report routes require the same sender and recipient host", 73);
  }
  const resolved = await resolveRecipient({
    stateRoot,
    recipient: {
      lineage_id: recipientIdentity.lineage_id,
      thread_id: recipientIdentity.thread_id,
      generation: recipientIdentity.generation,
    },
  });
  if (resolved.stale) throw new CliError("Coordinator report recipient generation is stale", 73);
  const planDigest = digest(approvedPlanDigest, "approved_plan_digest");
  const planPath = resolve(requireText(approvedPlanPath, "approved_plan_path", { max: 4096 }));
  if (await sha256File(planPath) !== planDigest) throw new CliError("Approved plan digest does not match its bytes", 73);
  const preparedPlanRoot = resolve(reportingStateRoot, "preparations", "plans");
  const preparedRelative = relative(preparedPlanRoot, planPath);
  const planSnapshotPath = preparedRelative !== ""
    && !preparedRelative.startsWith("..")
    && !isAbsolute(preparedRelative)
    ? planPath
    : resolve(reportingStateRoot, "plans", `${planDigest}.md`);
  const executionBinding = {
    run_id: run.run_id,
    runtime_context_digest: run.runtime_context_hash,
    configuration_digest: run.binding.config_hash,
    repository_digest: run.binding.repository_hash,
    repository_root: repositoryRoot === null ? null : resolve(repositoryRoot),
    repository_branch: repositoryBranch,
    plan_id: run.workflow_plan_id,
    revision_digest: run.workflow_revision_digest,
    namespace: basename(resolve(stateRoot)),
    bound_at: new Date(now).toISOString(),
  };
  const assignmentIdentityDraft = {
    common_dir: commonDir,
    repository_digest: run.binding.repository_hash,
    approved_plan: { digest: planDigest, snapshot_path: planSnapshotPath },
    sender: senderIdentity,
    recipient: recipientIdentity,
    execution_bindings: [executionBinding],
  };
  const assignmentId = assignmentIdFor(assignmentIdentityDraft);
  const assignmentDraft = {
    kind: "coordinator-delegation",
    assignment_id: assignmentId,
    run_id: run.run_id,
    runtime_context_digest: run.runtime_context_hash,
    configuration_digest: run.binding.config_hash,
    repository_digest: run.binding.repository_hash,
    common_dir: commonDir,
    plan_id: run.workflow_plan_id,
    revision_digest: run.workflow_revision_digest,
    approved_plan_path: planSnapshotPath,
    approved_plan_digest: planDigest,
  };
  const routeDraft = {
    assignment: assignmentDraft,
    sender: senderIdentity,
    recipient: recipientIdentity,
  };
  const id = `${REPORT_ROUTE_ID_PREFIX}${sha256(stableStringify(routeDraft))}`;
  const route = validateReportRoute({
    schema_version: REPORT_ROUTE_SCHEMA_VERSION,
    kind: REPORT_ROUTE_KIND,
    route_id: id,
    ...routeDraft,
    state: "active",
    lifecycle: { opened_at: new Date(now).toISOString(), closed_at: null, closure_reason: null },
  });
  const assignmentAuthority = await createAssignmentAuthority({
    commonDir,
    routeId: route.route_id,
    repositoryDigest: run.binding.repository_hash,
    approvedPlanPath: planPath,
    approvedPlanDigest: planDigest,
    sender: senderIdentity,
    recipient: recipientIdentity,
    executionBinding,
    iterationLabel,
    purpose,
    expectedAssignmentId: assignmentId,
    now,
  });
  await createIterationForAssignment({
    assignment: assignmentAuthority.assignment,
    assignmentStateRoot: assignmentAuthority.state_root,
    now,
  });
  // The director lineage owns this fence. A fresh sender run may validate the
  // exact binding, but must not substitute its own execution fence.
  await bindRecipient({
    stateRoot: reportingStateRoot,
    recipient: {
      lineage_id: recipientIdentity.lineage_id,
      thread_id: recipientIdentity.thread_id,
      generation: recipientIdentity.generation,
    },
  });
  await assertRouteAuthority(reportingStateRoot, route, { requireActive: true });
  return withProcessLock({
    path: paths(reportingStateRoot, id).lock,
    guardRoot: commonDir,
    label: `report route ${id}`,
  }, async () => {
    const existing = await readRoute(reportingStateRoot, id, { allowMissing: true });
    if (existing !== null) {
      if (stableStringify(routeIdentity(existing)) !== stableStringify(routeIdentity(route))) {
        throw new CliError("Report route ID collides with different authority", 73);
      }
      if (existing.state !== "active") throw new CliError("Closed report route cannot be re-armed", 73);
      return { status: "already-registered", state_root: reportingStateRoot, route: existing };
    }
    if ((await activeRoutesForSender(reportingStateRoot, route.sender)).length > 0) {
      throw new CliError("Sender already has an active upstream report route", 73);
    }
    await writeRoute(reportingStateRoot, route, { exclusive: true });
    return { status: "registered", state_root: reportingStateRoot, route };
  });
}

export async function closeReportRoute({ stateRoot, routeId: id, reason = "terminal", now = Date.now() }) {
  const closureReason = requireEnum(reason, CLOSURE_REASONS, "report route closure reason");
  return withRouteLock(stateRoot, id, async (route) => {
    if (route.state === "closed") {
      if (route.lifecycle.closure_reason !== closureReason) {
        throw new CliError("Report route already closed for a different reason", 73);
      }
      return { status: "already-closed", route };
    }
    const next = validateReportRoute({
      ...route,
      state: "closed",
      lifecycle: {
        ...route.lifecycle,
        closed_at: new Date(now).toISOString(),
        closure_reason: closureReason,
      },
    });
    await writeRoute(stateRoot, next);
    return { status: "closed", route: next };
  });
}

/** Closes every still-active route owned by one exact assignment identity. */
export async function closeReportRoutesForAssignment({
  stateRoot,
  assignmentId,
  reason = "terminal",
  now = Date.now(),
}) {
  const exactAssignmentId = requireText(assignmentId, "assignment_id", { max: 128, safeId: true });
  const closed = [];
  for (const route of await reportRoutes({ stateRoot, state: "active" })) {
    if (route.assignment.assignment_id !== exactAssignmentId) continue;
    closed.push((await closeReportRoute({
      stateRoot,
      routeId: route.route_id,
      reason,
      now,
    })).route);
  }
  return closed;
}

/** Closes every still-active route when its owning run becomes terminal. */
export async function closeReportRoutesForRun({
  stateRoot,
  runId,
  reason = "terminal",
  now = Date.now(),
}) {
  const exactRunId = requireText(runId, "run_id", { max: 128, safeId: true });
  const closed = [];
  for (const route of await reportRoutes({ stateRoot, state: "active" })) {
    if (route.assignment.run_id !== exactRunId) continue;
    closed.push((await closeReportRoute({
      stateRoot,
      routeId: route.route_id,
      reason,
      now,
    })).route);
  }
  return closed;
}

export async function reportRoute({ stateRoot, routeId: id }) {
  return readRoute(stateRoot, id);
}

export async function findReportRoute({ stateRoot, commonDir, routeId: id }) {
  for (const candidate of [assignmentStateRoot(commonDir), resolve(stateRoot)]) {
    const route = await readRoute(candidate, id, { allowMissing: true });
    if (route !== null) return { state_root: candidate, route };
  }
  throw new CliError(`Unknown report route: ${id}`, 73);
}

export async function assertActiveReportRoute({ stateRoot, routeId: id }) {
  return withRouteLock(stateRoot, id, async (route) => {
    await assertRouteAuthority(stateRoot, route, { requireActive: true });
    return route;
  });
}

export async function withActiveReportRouteLock({ stateRoot, routeId: id }, operation) {
  return withRouteLock(stateRoot, id, async (route) => {
    await assertRouteAuthority(stateRoot, route, { requireActive: true });
    return operation(route);
  });
}

export async function reportRoutes({ stateRoot, state = null }) {
  if (state !== null) requireEnum(state, ROUTE_STATES, "report route state filter");
  const root = resolve(stateRoot, "reports", "routes", "records");
  await assertNoSymlinkComponents(guardRoot(stateRoot), root, "Report route state path");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new CliError(`Report route state contains a symbolic link: ${entry.name}`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = validateReportRoute(await readJson(safeChild(root, entry.name, "report route"), {
      guardRoot: guardRoot(stateRoot),
    }));
    if (state === null || record.state === state) result.push(record);
  }
  return result;
}
