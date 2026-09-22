import { readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assignmentStateRoot,
  validateAssignmentAuthority,
} from "./assignment-authority.mjs";
import { cleanupPlan } from "./cleanup.mjs";
import { CliError, readJson, sha256, stableStringify } from "./core.mjs";
import { iterationStatus } from "./iteration-registry.mjs";
import { repositoryReportLocatorRetirement } from "./report-locator-authority.mjs";
import { reportDelivery } from "./report-records.mjs";
import { reportRoute } from "./report-routes.mjs";
import { workflowJournalStatus } from "./workflow-journal.mjs";

async function assignments(commonDir) {
  const stateRoot = assignmentStateRoot(commonDir);
  const directory = resolve(stateRoot, "records");
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
      throw new CliError(`Assignment authority directory contains an unsupported entry: ${entry.name}`, 73);
    }
    records.push(validateAssignmentAuthority(await readJson(resolve(directory, entry.name), {
      guardRoot: commonDir,
    })));
  }
  return records;
}

function exactBinding(assignment, namespace, run) {
  return assignment.execution_bindings.find((binding) => (
    binding.namespace === namespace
    && binding.run_id === run.run_id
    && binding.runtime_context_digest === run.runtime_context_hash
    && binding.configuration_digest === run.binding.config_hash
    && binding.repository_digest === run.binding.repository_hash
    && binding.plan_id === run.workflow_plan_id
    && binding.revision_digest === run.workflow_revision_digest
    && binding.repository_root !== null
  ));
}

function assertRetirement(assignment, namespace, run) {
  const retirement = (assignment.execution_retirements ?? []).find((entry) => (
    entry.namespace === namespace && entry.run_id === run.run_id
  ));
  const terminalDigest = sha256(stableStringify(run.terminal));
  if (
    retirement === undefined
    || retirement.runtime_context_digest !== run.runtime_context_hash
    || retirement.terminal_status !== "abandoned"
    || stableStringify(retirement.terminal) !== stableStringify(run.terminal)
    || retirement.terminal_digest !== terminalDigest
    || retirement.evidence_source !== "runtime"
    || retirement.evidence_digest !== sha256(stableStringify({
      namespace,
      run_id: run.run_id,
      runtime_context_digest: run.runtime_context_hash,
      terminal_digest: terminalDigest,
    }))
    || retirement.resource_disposition !== "retained"
    || retirement.owner_thread_id !== assignment.sender.thread_id
    || retirement.next_action === null
  ) throw new CliError(`Retained execution evidence does not match the abandoned run: ${namespace}/${run.run_id}`, 73);
  return retirement;
}

async function assertAcceptedResult(stateRoot, assignment) {
  if (assignment.acceptance === null) throw new CliError("Retained settlement requires accepted delivery evidence", 73);
  const report = await reportDelivery({ stateRoot, reportId: assignment.acceptance.report_id });
  if (
    report.state !== "accepted"
    || report.route_id !== assignment.route_id
    || report.source.host_id !== assignment.sender.host_id
    || report.source.thread_id !== assignment.sender.thread_id
    || report.source_text_digest !== assignment.acceptance.report_digest
    || assignment.acceptance.accepted_by_thread_id !== assignment.recipient.thread_id
  ) throw new CliError("Retained settlement accepted report does not match its assignment", 73);
  return report;
}

function assertTerminalWorkflow(workflow, cleanup) {
  const cleanLaunches = new Set(cleanup.items.filter((item) => (
    item.classification === "clean"
    && item.close_blocked === false
    && item.cleanup_required === false
  )).map((item) => item.launch_id));
  for (const entry of workflow.contracts) {
    const { claim } = entry;
    if (["current", "completed", "terminal-no-object", "revoked"].includes(claim.state)) continue;
    if (
      claim.state === "started"
      && claim.execution_kind === "task-thread"
      && cleanLaunches.has(claim.operation_id)
    ) continue;
    throw new CliError(`Retained settlement workflow operation remains unresolved: ${claim.task_id}`, 73);
  }
}

async function assertAcceptedStage({ commonDir, namespace, run, assignment }) {
  const stateRoot = resolve(commonDir, "codex-flow", namespace);
  const [cleanup, workflow, iteration] = await Promise.all([
    cleanupPlan({ stateRoot, runId: run.run_id }),
    workflowJournalStatus({ stateRoot, runId: run.run_id, planId: run.workflow_plan_id }),
    iterationStatus({ commonDir, iterationId: assignment.iteration_id }),
  ]);
  if (
    cleanup.run_status !== "abandoned"
    || cleanup.counts.cleanup_required !== 0
    || cleanup.counts.close_blocked !== 0
    || cleanup.blocking_launch_ids.length !== 0
    || cleanup.blocking_branch_fences.length !== 0
    || cleanup.items.some((item) => (
      item.classification !== "clean" || item.close_blocked || item.cleanup_required
    ))
    || cleanup.unbound_branch_fences.some((fence) => fence.close_blocked || fence.cleanup_required)
  ) throw new CliError(`Retained execution cleanup remains unresolved: ${namespace}/${run.run_id}`, 73);
  assertTerminalWorkflow(workflow, cleanup);
  const liveExecutor = iteration.members.find((member) => (
    member.role === "executor" && member.state !== "archived"
  ));
  if (liveExecutor !== undefined) {
    throw new CliError(`Retained settlement requires archived executor evidence: ${liveExecutor.member_id}`, 73);
  }
  return { stage: "accepted", cleanup_plan_id: cleanup.plan_id };
}

async function assertRetiredStage({ commonDir, assignment, report }) {
  const stateRoot = assignmentStateRoot(commonDir);
  const [iteration, route, locator] = await Promise.all([
    iterationStatus({ commonDir, iterationId: assignment.iteration_id }),
    reportRoute({ stateRoot, routeId: assignment.route_id }),
    repositoryReportLocatorRetirement({
      stateRoot,
      routeId: assignment.route_id,
      successorRouteId: null,
    }),
  ]);
  if (
    iteration.state !== "closed"
    || iteration.assignment_id !== assignment.assignment_id
    || iteration.members.some((member) => !member.retained && member.state !== "archived")
  ) throw new CliError("Retained settlement iteration closeout is incomplete", 73);
  if (route.state !== "closed" || route.lifecycle.closure_reason !== "archived") {
    throw new CliError("Retained settlement report route is not archived", 73);
  }
  if (
    locator.reason !== "archived"
    || locator.recovery !== null
    || !locator.accepted_report_ids.includes(report.report_id)
  ) throw new CliError("Retained settlement report locator is not durably retired", 73);
  const coordinator = iteration.members.find((member) => member.role === "coordinator");
  const preservedTip = coordinator?.archive_attempt?.branch_tip ?? null;
  if (!coordinator?.retained && preservedTip === null) {
    throw new CliError("Retained settlement coordinator preservation evidence is absent", 73);
  }
  return {
    stage: "retired",
    locator_retirement_id: locator.retirement_id,
    preserved_tip: preservedTip,
  };
}

/**
 * Interpret existing immutable evidence; never rewrite the abandoned outcome or
 * its retained retirement observation. The accepted stage proves executor/run
 * obligations, while the retired stage proves the later coordinator closeout.
 */
export async function assessRetainedRunSettlement({ commonDir, namespace, run, assignmentId = null }) {
  const common = await realpath(commonDir);
  if (run.status !== "abandoned") return { status: "not-retained" };
  const matches = (await assignments(common)).filter((assignment) => (
    ["accepted", "retired"].includes(assignment.state)
    && assignment.common_dir === common
    && assignment.sender.host_id === run.binding.host.host_id
    && assignment.sender.thread_id === run.binding.lineage.thread_id
    && (assignmentId === null || assignment.assignment_id === assignmentId)
    && exactBinding(assignment, namespace, run) !== undefined
  ));
  if (matches.length !== 1) {
    throw new CliError(`Retained run requires exactly one accepted assignment authority: ${namespace}/${run.run_id}`, 73);
  }
  const assignment = matches[0];
  assertRetirement(assignment, namespace, run);
  const report = await assertAcceptedResult(assignmentStateRoot(common), assignment);
  const evidence = assignment.state === "accepted"
    ? await assertAcceptedStage({ commonDir: common, namespace, run, assignment })
    : await assertRetiredStage({ commonDir: common, assignment, report });
  return {
    status: "settled",
    assignment_id: assignment.assignment_id,
    assignment_state: assignment.state,
    report_id: report.report_id,
    route_id: assignment.route_id,
    iteration_id: assignment.iteration_id,
    namespace,
    run_id: run.run_id,
    ...evidence,
  };
}
