import {
  assignmentAuthority,
  updateAssignmentAuthority,
} from "./assignment-authority.mjs";
import { CliError, requireText } from "./core.mjs";
import { closeoutIteration } from "./iteration-registry.mjs";
import { reportDelivery } from "./report-records.mjs";
import { closeReportRoute, reportRoute } from "./report-routes.mjs";

export async function acceptAssignmentResult({
  stateRoot,
  assignmentId,
  reportId,
  directorThreadId,
  archiveThread,
  retireLocator,
  now = Date.now(),
}) {
  const director = requireText(directorThreadId, "director_thread_id", { max: 256, safeId: true });
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
  if (assignment.state === "open") {
    assignment = await updateAssignmentAuthority({
      stateRoot,
      assignmentId,
      update: async (current) => ({ ...current, state: "accepted", acceptance, updated_at: acceptance.accepted_at }),
    });
  } else if (assignment.state === "accepted" || assignment.state === "retired") {
    if (assignment.acceptance.report_id !== report.report_id || assignment.acceptance.report_digest !== report.source_text_digest) {
      throw new CliError("Assignment was accepted against a different report", 73);
    }
  } else {
    throw new CliError("Cancelled assignment cannot be accepted", 73);
  }
  if (assignment.state === "retired") return { status: "already-retired", assignment };
  const closeout = await closeoutIteration({
    commonDir: assignment.common_dir,
    iterationId: assignment.iteration_id,
    allowCoordinator: true,
    archiveThread,
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
    update: async (current) => ({ ...current, state: "retired", updated_at: new Date(now).toISOString() }),
  });
  return { status: "retired", assignment, closeout, locator_retirement: locator };
}
