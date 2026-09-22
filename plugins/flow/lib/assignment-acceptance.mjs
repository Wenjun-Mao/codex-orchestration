import {
  assignmentRegistration,
  assignmentAuthority,
  recordAssignmentExecutionRetirement,
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
  reconcileExecutorIterationMembers,
  reconcileAcceptedCoordinatorResourceAbsence,
} from "./iteration-registry.mjs";
import { reportDeliveries, reportDelivery } from "./report-records.mjs";
import { closeReportRoute, reportRoute } from "./report-routes.mjs";
import { validateRunLifecycleState } from "./run-lifecycle.mjs";
import { assessRetainedRunSettlement } from "./retained-obligation-settlement.mjs";
import { resolve } from "node:path";

function assertExactAssignmentRoute(assignment, route) {
  if (
    route.assignment.assignment_id !== assignment.assignment_id
    || route.assignment.common_dir !== assignment.common_dir
    || route.assignment.run_id !== assignment.execution_bindings[0].run_id
  ) throw new CliError("Assignment cancellation route does not match its exact authority", 73);
}

function assertRunMatchesBinding(assignment, binding, run) {
  if (
    run.runtime_context_hash !== binding.runtime_context_digest
    || run.binding.config_hash !== binding.configuration_digest
    || run.binding.repository_hash !== binding.repository_digest
    || run.workflow_plan_id !== binding.plan_id
    || run.workflow_revision_digest !== binding.revision_digest
    || run.binding.host.host_id !== assignment.sender.host_id
    || run.binding.lineage.thread_id !== assignment.sender.thread_id
  ) throw new CliError(`Assigned execution authority drifted: ${binding.namespace}/${binding.run_id}`, 73);
}

async function reconcileTerminalExecutionEvidence(assignment, stateRoot, now) {
  let current = assignment;
  const active = [];
  for (const binding of assignment.execution_bindings) {
    if ((current.execution_retirements ?? []).some((entry) => (
      entry.namespace === binding.namespace && entry.run_id === binding.run_id
    ))) continue;
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
    const raw = await readJson(lifecyclePath, {
      allowMissing: true,
      guardRoot: assignment.common_dir,
    });
    if (raw === null) {
      throw new CliError(
        `Assigned execution retirement evidence is absent: ${binding.namespace}/${binding.run_id}`,
        73,
      );
    }
    const lifecycle = validateRunLifecycleState(raw);
    const run = lifecycle.runs[binding.run_id];
    if (run === undefined) {
      throw new CliError(`Assigned execution is absent: ${binding.namespace}/${binding.run_id}`, 73);
    }
    assertRunMatchesBinding(assignment, binding, run);
    if (run.status === "active") {
      active.push({ namespace: binding.namespace, run_id: binding.run_id });
      continue;
    }
    const terminalDigest = sha256(stableStringify(run.terminal));
    current = await recordAssignmentExecutionRetirement({
      stateRoot,
      assignmentId: assignment.assignment_id,
      retirement: {
      namespace: binding.namespace,
      run_id: binding.run_id,
      runtime_context_digest: binding.runtime_context_digest,
      terminal_status: run.status,
        terminal: run.terminal,
        terminal_digest: terminalDigest,
        evidence_source: "runtime",
        evidence_digest: sha256(stableStringify({
          namespace: binding.namespace,
          run_id: binding.run_id,
          runtime_context_digest: binding.runtime_context_digest,
          terminal_digest: terminalDigest,
        })),
        resource_disposition: run.status === "closed" ? "released" : "retained",
        owner_thread_id: assignment.sender.thread_id,
        next_action: run.status === "closed"
          ? null
          : `resolve retained fences through ${binding.namespace}/${binding.run_id} before conflicting successor work`,
        observed_at: new Date(now).toISOString(),
      },
    });
  }
  return { assignment: current, active };
}

function cancellationExecutionEvidence(assignment) {
  const retirements = assignment.execution_retirements ?? [];
  if (retirements.length !== assignment.execution_bindings.length) {
    throw new CliError("Assignment cancellation requires terminal evidence for every execution", 73);
  }
  return retirements.map((entry) => ({
    namespace: entry.namespace,
    run_id: entry.run_id,
    runtime_context_digest: entry.runtime_context_digest,
    terminal_status: entry.terminal_status,
    terminal_digest: entry.terminal_digest,
    observed_at: entry.observed_at,
  })).sort((left, right) => (
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
  let iteration = await iterationStatus({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
    allowMissing: true,
  });
  const progress = assignmentRegistration(assignment);
  if (iteration === null) {
    if (progress.iteration === "ready") {
      throw new CliError("Published assignment iteration is absent", 73);
    }
    return null;
  }
  if (iteration.assignment_id !== assignment.assignment_id) {
    throw new CliError("Assignment cancellation iteration does not match its authority", 73);
  }
  if (iteration.state === "closed") throw new CliError("Closed iteration cannot be cancelled", 73);
  iteration = await reconcileExecutorIterationMembers({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
  });
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
  if (assignment.state === "retired") throw new CliError("Retired assignment cannot be cancelled", 73);

  const wasCancelled = assignment.state === "cancelled";
  if (!wasCancelled) {
    const reconciled = await reconcileTerminalExecutionEvidence(assignment, stateRoot, now);
    assignment = reconciled.assignment;
    if (reconciled.active.length > 0) {
      const active = reconciled.active[0];
      throw new CliError(
        `Assignment cancellation requires terminal execution evidence: ${active.namespace}/${active.run_id}`,
        73,
      );
    }
  }
  const acceptedWithRetainedObligations = assignment.state === "accepted" && (
    assignment.execution_retirements ?? []
  ).some((entry) => entry.resource_disposition === "retained");
  if (assignment.state === "accepted" && !acceptedWithRetainedObligations) {
    throw new CliError("Accepted assignment without retained execution obligations cannot be cancelled", 73);
  }
  const executionEvidence = wasCancelled
    ? assertMatchingCancellation(assignment, { reason: cancellationReason, directorThreadId: director }).execution_evidence
    : cancellationExecutionEvidence(assignment);
  const existingIteration = await assertIterationCancellationEligible(assignment);

  const progress = assignmentRegistration(assignment);
  let route = await reportRoute({ stateRoot, routeId: assignment.route_id, allowMissing: true });
  if (route === null && progress.route === "ready") {
    throw new CliError("Published assignment report route is absent", 73);
  }
  if (route !== null) assertExactAssignmentRoute(assignment, route);
  if (route?.state === "active") {
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
        const acceptedCancellation = current.state === "accepted" && (
          current.execution_retirements ?? []
        ).some((entry) => entry.resource_disposition === "retained");
        if (!["registering", "open"].includes(current.state) && !acceptedCancellation) {
          throw new CliError("Assignment terminal state changed during cancellation", 73);
        }
        const cancelledAt = cancellation.cancelled_at;
        return {
          ...current,
          state: "cancelled",
          cancellation,
          ...(current.registration === undefined ? {} : {
            registration: {
              ...current.registration,
              status: current.registration.status === "ready" ? "ready" : "aborted",
              updated_at: cancelledAt,
            },
          }),
          updated_at: cancelledAt,
        };
      },
    });
  }

  if (route?.state === "active") {
    await closeReportRoute({ stateRoot, routeId: route.route_id, reason: "terminal", now });
    route = await reportRoute({ stateRoot, routeId: route.route_id });
  }
  if (route !== null && route.state !== "closed") {
    throw new CliError("Assignment cancellation did not close its report route", 73);
  }
  const locator = route === null ? { status: "not-created", retirement: null } : await retireLocator({
    routeId: route.route_id,
    reason: "terminal",
    now,
    allowNeverInstalled: progress.locator === "pending",
  });

  const iteration = existingIteration === null ? {
    status: "not-created",
    iteration: null,
  } : await cancelIteration({
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
    obligations: (assignment.execution_retirements ?? []).map((entry) => ({
      namespace: entry.namespace,
      run_id: entry.run_id,
      resource_disposition: entry.resource_disposition,
      owner_thread_id: entry.owner_thread_id,
      next_action: entry.next_action,
    })),
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
  if (assignment.state === "registering") {
    throw new CliError("Assignment result cannot be accepted before registration readiness", 73);
  }
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
  const execution = await reconcileTerminalExecutionEvidence(assignment, stateRoot, now);
  assignment = execution.assignment;
  if (execution.active.length > 0) {
    return {
      status: "closeout-pending",
      reason: "execution-terminal-required",
      assignment,
      active_executions: execution.active,
    };
  }
  const retainedObligations = (assignment.execution_retirements ?? []).filter(
    (entry) => entry.resource_disposition === "retained",
  );
  let retainedSettlement = [];
  if (retainedObligations.length > 0) {
    await reconcileExecutorIterationMembers({
      commonDir: assignment.common_dir,
      iterationId: assignment.iteration_id,
    });
    try {
      retainedSettlement = await Promise.all(retainedObligations.map(async (entry) => {
        const lifecyclePath = resolve(
          assignment.common_dir,
          "codex-flow",
          entry.namespace,
          "runs",
          "lifecycle.json",
        );
        const lifecycle = validateRunLifecycleState(await readJson(lifecyclePath, {
          guardRoot: assignment.common_dir,
        }));
        return assessRetainedRunSettlement({
          commonDir: assignment.common_dir,
          namespace: entry.namespace,
          run: lifecycle.runs[entry.run_id],
          assignmentId: assignment.assignment_id,
        });
      }));
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      return {
        status: "closeout-pending",
        reason: "execution-obligations-retained",
        assignment,
        retained_obligations: retainedObligations.map((entry) => ({
          namespace: entry.namespace,
          run_id: entry.run_id,
          owner_thread_id: entry.owner_thread_id,
          next_action: entry.next_action,
        })),
        settlement_blocker: error.message,
      };
    }
  }
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
  return {
    status: "retired",
    assignment,
    closeout,
    locator_retirement: locator,
    ...(retainedSettlement.length === 0 ? {} : { retained_settlement: retainedSettlement }),
  };
}
