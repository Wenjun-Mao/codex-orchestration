import {
  assignmentAuthority,
  updateAssignmentAuthority,
} from "./assignment-authority.mjs";
import {
  assertNoSymlinkComponents,
  CliError,
  readJson,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import {
  cancelIteration,
  closeoutIterationWithOwningHost,
  iterationStatus,
  reconcileAcceptedCoordinatorResourceAbsence,
} from "./iteration-registry.mjs";
import { reportDeliveries, reportDelivery } from "./report-records.mjs";
import { closeReportRoute, reportRoute } from "./report-routes.mjs";
import { validateRunLifecycleState } from "./run-lifecycle.mjs";
import { resolve } from "node:path";

function assertExactAssignmentRoute(assignment, route) {
  if (
    route.assignment.assignment_id !== assignment.assignment_id
    || route.assignment.common_dir !== assignment.common_dir
    || route.assignment.run_id !== assignment.execution_bindings[0].run_id
  ) throw new CliError("Assignment cancellation route does not match its exact authority", 73);
}

async function terminalExecutionEvidence(assignment, now) {
  const observedAt = new Date(now).toISOString();
  const evidence = [];
  for (const binding of assignment.execution_bindings) {
    const lifecyclePath = resolve(
      assignment.common_dir,
      "codex-flow",
      binding.namespace,
      "runs",
      "lifecycle.json",
    );
    await assertNoSymlinkComponents(
      assignment.common_dir,
      lifecyclePath,
      "Assigned execution lifecycle",
    );
    const lifecycle = validateRunLifecycleState(await readJson(lifecyclePath, {
      guardRoot: assignment.common_dir,
    }));
    const run = lifecycle.runs[binding.run_id];
    if (run === undefined) {
      throw new CliError(`Assigned execution is absent: ${binding.namespace}/${binding.run_id}`, 73);
    }
    if (
      run.runtime_context_hash !== binding.runtime_context_digest
      || run.binding.config_hash !== binding.configuration_digest
      || run.binding.repository_hash !== binding.repository_digest
      || run.workflow_plan_id !== binding.plan_id
      || run.workflow_revision_digest !== binding.revision_digest
      || run.binding.host.host_id !== assignment.sender.host_id
      || run.binding.lineage.thread_id !== assignment.sender.thread_id
    ) throw new CliError(`Assigned execution authority drifted: ${binding.namespace}/${binding.run_id}`, 73);
    if (run.status === "active") {
      throw new CliError(`Assignment cancellation requires terminal execution evidence: ${binding.namespace}/${binding.run_id}`, 73);
    }
    evidence.push({
      namespace: binding.namespace,
      run_id: binding.run_id,
      runtime_context_digest: binding.runtime_context_digest,
      terminal_status: run.status,
      terminal_digest: sha256(stableStringify(run.terminal)),
      observed_at: observedAt,
    });
  }
  return evidence.sort((left, right) => (
    `${left.namespace}:${left.run_id}`.localeCompare(`${right.namespace}:${right.run_id}`)
  ));
}

function assertMatchingCancellation(assignment, { reason, directorThreadId }) {
  const cancellation = assignment.cancellation;
  if (
    cancellation.reason !== reason
    || cancellation.cancelled_by_thread_id !== directorThreadId
  ) throw new CliError("Cancelled assignment does not match this exact cancellation request", 73);
  return cancellation;
}

async function assertRouteReportsSettled(stateRoot, route) {
  const unresolved = (await reportDeliveries({ stateRoot, routeId: route.route_id }))
    .find((report) => report.state !== "accepted");
  if (unresolved !== undefined) {
    throw new CliError(`Assignment cancellation is blocked by unresolved report evidence: ${unresolved.report_id}`, 73);
  }
}

async function assertIterationCancellationEligible(assignment) {
  const iteration = await iterationStatus({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
  });
  if (iteration.assignment_id !== assignment.assignment_id) {
    throw new CliError("Assignment cancellation iteration does not match its authority", 73);
  }
  if (iteration.state === "closed") throw new CliError("Closed iteration cannot be cancelled", 73);
  const liveExecutor = iteration.members.find((member) => (
    member.role === "executor" && member.state !== "archived"
  ));
  if (liveExecutor !== undefined) {
    throw new CliError(`Assignment cancellation requires archived executor evidence: ${liveExecutor.member_id}`, 73);
  }
  return iteration;
}

/**
 * Ends an unsuccessful assignment only after its exact execution bindings are
 * terminal. It deliberately leaves all coordinator and Git ownership intact.
 */
export async function cancelAssignmentResult({
  stateRoot,
  assignmentId,
  directorThreadId,
  reason,
  retireLocator,
  now = Date.now(),
  beforeCancellationUpdate = null,
}) {
  const director = requireText(directorThreadId, "director_thread_id", { max: 256, safeId: true });
  const cancellationReason = requireText(reason, "cancellation reason", { max: 512 });
  if (typeof retireLocator !== "function") throw new CliError("Cancellation requires a locator retirement adapter");
  if (beforeCancellationUpdate !== null && typeof beforeCancellationUpdate !== "function") {
    throw new CliError("Assignment cancellation synchronization hook must be a function");
  }

  let assignment = await assignmentAuthority({ stateRoot, assignmentId });
  if (assignment.recipient.thread_id !== director) {
    throw new CliError("Only the assigned director can cancel this assignment", 73);
  }
  if (assignment.state === "accepted" || assignment.state === "retired") {
    throw new CliError("Accepted or retired assignment cannot be cancelled", 73);
  }

  const wasCancelled = assignment.state === "cancelled";
  const executionEvidence = wasCancelled
    ? assertMatchingCancellation(assignment, { reason: cancellationReason, directorThreadId: director }).execution_evidence
    : await terminalExecutionEvidence(assignment, now);
  await assertIterationCancellationEligible(assignment);

  let route = await reportRoute({ stateRoot, routeId: assignment.route_id });
  assertExactAssignmentRoute(assignment, route);
  if (route.state === "active") {
    await assertRouteReportsSettled(stateRoot, route);
  }
  if (!wasCancelled) {
    const cancellation = {
      reason: cancellationReason,
      cancelled_by_thread_id: director,
      cancelled_at: new Date(now).toISOString(),
      execution_evidence: executionEvidence,
    };
    if (beforeCancellationUpdate !== null) await beforeCancellationUpdate();
    assignment = await updateAssignmentAuthority({
      stateRoot,
      assignmentId,
      update(current) {
        if (current.recipient.thread_id !== director) {
          throw new CliError("Only the assigned director can cancel this assignment", 73);
        }
        if (current.state === "cancelled") {
          assertMatchingCancellation(current, { reason: cancellationReason, directorThreadId: director });
          return current;
        }
        if (current.state !== "open") throw new CliError("Assignment terminal state changed during cancellation", 73);
        return {
          ...current,
          state: "cancelled",
          cancellation,
          updated_at: cancellation.cancelled_at,
        };
      },
    });
  }

  if (route.state === "active") {
    await closeReportRoute({ stateRoot, routeId: route.route_id, reason: "terminal", now });
    route = await reportRoute({ stateRoot, routeId: route.route_id });
  }
  if (route.state !== "closed") throw new CliError("Assignment cancellation did not close its report route", 73);
  const locator = await retireLocator({ routeId: route.route_id, reason: "terminal", now });

  const iteration = await cancelIteration({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
    assignmentId: assignment.assignment_id,
    now,
  });
  return {
    status: wasCancelled && iteration.status === "already-cancelled"
      ? "already-cancelled"
      : "cancelled",
    assignment,
    iteration,
    locator_retirement: locator,
  };
}

export async function acceptAssignmentResult({
  stateRoot,
  assignmentId,
  reportId,
  directorThreadId,
  taskObservation = null,
  hostResult = null,
  coordinatorRecovery = null,
  observeArchivedThread,
  retireLocator,
  now = Date.now(),
  beforeAcceptanceUpdate = null,
}) {
  const director = requireText(directorThreadId, "director_thread_id", { max: 256, safeId: true });
  if (beforeAcceptanceUpdate !== null && typeof beforeAcceptanceUpdate !== "function") {
    throw new CliError("Assignment acceptance synchronization hook must be a function");
  }
  let assignment = await assignmentAuthority({ stateRoot, assignmentId });
  if (assignment.recipient.thread_id !== director) throw new CliError("Only the assigned director can accept this result", 73);
  const report = await reportDelivery({ stateRoot, reportId });
  if (report.route_id !== assignment.route_id || report.state !== "accepted") {
    throw new CliError("Assignment acceptance requires an accepted report from its exact route", 73);
  }
  const acceptance = {
    report_id: report.report_id,
    report_digest: report.source_text_digest,
    accepted_by_thread_id: director,
    accepted_at: new Date(now).toISOString(),
  };
  if (beforeAcceptanceUpdate !== null) await beforeAcceptanceUpdate();
  assignment = await updateAssignmentAuthority({
    stateRoot,
    assignmentId,
    update(current) {
      if (current.recipient.thread_id !== director) {
        throw new CliError("Only the assigned director can accept this result", 73);
      }
      if (current.state === "open") {
        return { ...current, state: "accepted", acceptance, updated_at: acceptance.accepted_at };
      }
      if (current.state === "accepted" || current.state === "retired") {
        if (
          current.acceptance.report_id !== report.report_id
          || current.acceptance.report_digest !== report.source_text_digest
        ) throw new CliError("Assignment was accepted against a different report", 73);
        return current;
      }
      throw new CliError("Cancelled assignment cannot be accepted", 73);
    },
  });
  if (assignment.state === "retired") return { status: "already-retired", assignment };
  if (coordinatorRecovery !== null) {
    requireExactFields(coordinatorRecovery, {
      required: ["kind", "preserved_tip"],
    }, "coordinator recovery");
    if (coordinatorRecovery.kind !== "resources-absent") {
      throw new CliError("Unsupported coordinator recovery kind", 73);
    }
    await reconcileAcceptedCoordinatorResourceAbsence({
      commonDir: assignment.common_dir,
      iterationId: assignment.iteration_id,
      directorThreadId: director,
      preservedTip: coordinatorRecovery.preserved_tip,
      now,
    });
  }
  const closeout = await closeoutIterationWithOwningHost({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    taskObservation,
    hostResult,
    observeArchivedThread,
    now,
  });
  if (closeout.status !== "closed") return { status: "closeout-pending", assignment, closeout };
  const route = await reportRoute({ stateRoot, routeId: assignment.route_id });
  if (route.state === "active") await closeReportRoute({ stateRoot, routeId: route.route_id, reason: "archived", now });
  if (typeof retireLocator !== "function") throw new CliError("acceptance requires a locator retirement adapter");
  const locator = await retireLocator({ routeId: route.route_id, reason: "archived", now });
  assignment = await updateAssignmentAuthority({
    stateRoot,
    assignmentId,
    update(current) {
      if (current.state === "retired") return current;
      if (current.state !== "accepted") {
        throw new CliError("Only an accepted assignment can be retired", 73);
      }
      return { ...current, state: "retired", updated_at: new Date(now).toISOString() };
    },
  });
  return { status: "retired", assignment, closeout, locator_retirement: locator };
}
