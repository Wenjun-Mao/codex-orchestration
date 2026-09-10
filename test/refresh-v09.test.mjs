import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyRefresh,
  observeRefreshPrivateArchives,
  recoverRefreshReportLocator,
  refreshDiscardCreationAuthority,
  refreshSourceCutoverBlocker,
  refreshStatus,
} from "../lib/compat/refresh.mjs";
import { sha256, stableStringify, withProcessLock } from "../lib/core.mjs";
import { reportRouteIdFor, validateReportRoute } from "../lib/report-routes.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import {
  assignmentAuthority,
  markAssignmentRegistrationStage,
  openAssignmentForSender,
  publishAssignmentReadiness,
} from "../lib/assignment-authority.mjs";
import { installRepositoryReportLocator } from "../lib/report-hook.mjs";
import { closeoutIterationWithOwningHost, iterationStatus } from "../lib/iteration-registry.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { registerCoordinatorReportRoute, reportRoute } from "../lib/report-routes.mjs";
import {
  captureRefreshGitAuthority,
  deleteRefreshExecutorBranch,
  removeRefreshExecutorWorktree,
} from "../lib/compat/refresh-discard-git.mjs";
import {
  assertRefreshNamespaceRemovalSafe,
  loadRefreshSourceAuthority,
} from "../lib/compat/refresh-source.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";
import { createActiveTaskLaunch } from "./v09-lifecycle-fixture.mjs";

function invoke(cli, args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...env },
    encoding: "utf8",
  });
}

function assertSuccess(result, label) {
  assert.equal(result.status, 0, `${label}: ${String(result.stderr || result.stdout).trim()}`);
}

async function jsonFile(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

function task(taskId, overrides = {}) {
  return {
    task_id: taskId,
    title: `Execute ${taskId}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded refresh fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${taskId}.txt`],
    shared_resources: [taskId],
    primary_outcome: `Complete ${taskId}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Execute ${taskId} once in its isolated worktree.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

test("refresh cutover accepts an active v0.9 launch representation without confusing it with v0.8 creation", () => {
  const source = {
    task_states: [{
      task: task("v09-active-launch"),
      launch: { status: "active" },
      integrations: [{ state: "reconciled" }],
    }],
  };
  assert.equal(refreshSourceCutoverBlocker(source), null);
});

test("refresh discard distinguishes an absent direct-coordinator launch from launch authority", () => {
  const direct = {
    task: task("direct-coordinator", { execution_kind: "coordinator" }),
    launch: null,
  };
  assert.equal(refreshDiscardCreationAuthority(direct), null);
  const launch = { status: "active", launch_id: "task-launch-v1-source" };
  assert.equal(refreshDiscardCreationAuthority({ ...direct, launch }), launch);
  assert.throws(
    () => refreshDiscardCreationAuthority({ task: direct.task }),
    /contradictory operation authority/,
  );
  assert.throws(
    () => refreshDiscardCreationAuthority({ ...direct, creation: null }),
    /contradictory operation authority/,
  );
});

function activation({
  runId,
  workflowTask,
  workflowTasks = null,
  lineageId,
  threadId,
  branch,
  branchFences = null,
  refreshId = null,
}) {
  const tasks = workflowTasks ?? [workflowTask];
  return {
    run_id: runId,
    ...(refreshId === null ? {} : { refresh_id: refreshId }),
    activated_at: new Date().toISOString(),
    runtime: {
      config: { config_id: `${runId}-config`, snapshot: { project_id: "refresh-project" } },
      policy: { policy_id: `${runId}-policy`, snapshot: { routine_callbacks: "journal" } },
      host: { host_id: "local", session_id: `${runId}-session` },
      lineage: { lineage_id: lineageId, thread_id: threadId, generation: 1 },
    },
    workflow: {
      schema_version: 1,
      plan_id: `${runId}-plan`,
      revision: 1,
      parent_revision_digest: null,
      tasks,
    },
    fences: {
      path_fences: [...new Set(tasks.flatMap((entry) => entry.write_paths))],
      resource_fences: [...new Set(tasks.flatMap((entry) => entry.shared_resources))],
      branch_fences: branchFences ?? [branch],
    },
  };
}

async function extractTaggedPackage(tag) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v09-source-tag-"));
  const archive = resolve(root, "source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, tag], { cwd: packageRoot });
  execFileSync("tar", ["-xf", archive, "-C", root]);
  await rm(archive);
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

async function copyCurrentPackage({ version = null } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v09-target-package-"));
  for (const path of ["bin", "lib", "schemas", "skills", "templates", ".codex-plugin"]) {
    await cp(resolve(packageRoot, path), resolve(root, path), { recursive: true });
  }
  await cp(resolve(packageRoot, "package.json"), resolve(root, "package.json"));
  if (version !== null) {
    const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    packageMetadata.version = version;
    await writeFile(resolve(root, "package.json"), `${JSON.stringify(packageMetadata, null, 2)}\n`, "utf8");
    const pluginPath = resolve(root, ".codex-plugin", "plugin.json");
    const pluginMetadata = JSON.parse(await readFile(pluginPath, "utf8"));
    pluginMetadata.version = version;
    await writeFile(pluginPath, `${JSON.stringify(pluginMetadata, null, 2)}\n`, "utf8");
    const corePath = resolve(root, "lib", "core.mjs");
    const coreSource = await readFile(corePath, "utf8");
    await writeFile(
      corePath,
      coreSource.replace(
        /export const PACKAGE_VERSION = "[^"]+";/,
        `export const PACKAGE_VERSION = ${JSON.stringify(version)};`,
      ),
      "utf8",
    );
  }
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

async function createAbandonedV08Run({
  root,
  requests,
  sourcePackage,
  runId = "refresh-v08-prior-abandoned",
  branchFences = [],
}) {
  const workflowTask = task(`${runId}-sentinel`, {
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Luna-medium is sufficient for this read-only lifecycle sentinel.",
    fork_turns: "2",
    write_paths: [],
    shared_resources: [],
  });
  const request = activation({
    runId,
    workflowTask,
    lineageId: `${runId}-lineage`,
    threadId: `${runId}-coordinator`,
    branch: branchFences[0] ?? "codex/unused-abandoned-sentinel",
    branchFences,
  });
  const activationPath = await jsonFile(requests, `${runId}-activation`, request);
  const activatedCall = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", runId, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
  assertSuccess(activatedCall, "v0.8.3 prior run activation");
  const activated = JSON.parse(activatedCall.stdout);
  const runtimeCli = resolve(activated.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const abandonPath = await jsonFile(requests, `${runId}-abandon`, {
    run_id: runId,
    resume: activated.run.binding,
    reason: "The fixture intentionally preserves an honest terminal abandonment.",
  });
  const abandonedCall = invoke(runtimeCli, [
    "run", "abandon", "--run-id", runId, "--file", abandonPath, "--json",
  ], root);
  assertSuccess(abandonedCall, "v0.8.3 prior run abandonment");
  return { activated, request, runtimeCli, abandoned: JSON.parse(abandonedCall.stdout) };
}

async function createAbandonedDirectCoordinatorRun({
  root,
  requests,
  sourcePackage,
  runId = "refresh-v097-direct-coordinator",
  beforeAbandon = null,
  terminalKind = "abandoned",
  workflowTaskOverrides = {},
}) {
  const workflowTask = task(`${runId}-delivery`, {
    execution_kind: "coordinator",
    mode: "read",
    write_paths: [],
    shared_resources: [],
    ...workflowTaskOverrides,
  });
  const request = activation({
    runId,
    workflowTask,
    lineageId: `${runId}-lineage`,
    threadId: `${runId}-coordinator`,
    branch: "main",
    branchFences: [],
  });
  const activationPath = await jsonFile(requests, `${runId}-activation`, request);
  const activatedCall = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", runId, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
  assertSuccess(activatedCall, "v0.9.7 direct coordinator source activation");
  const activated = JSON.parse(activatedCall.stdout);
  const runtimeCli = resolve(activated.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const startPath = await jsonFile(requests, `${runId}-local-start`, {
    run_id: runId,
    plan_id: request.workflow.plan_id,
    task_id: workflowTask.task_id,
    dependency_authorities: [],
  });
  const startedCall = invoke(runtimeCli, [
    "workflow", "local", "start", "--run-id", runId, "--file", startPath, "--json",
  ], root, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
  assertSuccess(startedCall, "v0.9.7 direct coordinator work start");
  const localWork = JSON.parse(startedCall.stdout);
  assert.equal(localWork.state, "started");
  const beforeAbandonResult = beforeAbandon === null
    ? null
    : await beforeAbandon({ activated, request, runtimeCli, workflowTask, localWork });
  let audit = null;
  let terminal;
  if (terminalKind === "closed") {
    const auditCall = invoke(runtimeCli, ["run", "audit", "--run-id", runId, "--json"], root);
    assertSuccess(auditCall, "v0.9 direct coordinator source closure audit");
    audit = JSON.parse(auditCall.stdout).audit;
    assert.equal(audit.terminal_ready, true);
    const closePath = await jsonFile(requests, `${runId}-close`, {
      run_id: runId,
      resume: activated.run.binding,
      audit_id: audit.audit_id,
    });
    const closeCall = invoke(runtimeCli, [
      "run", "close", "--run-id", runId, "--file", closePath, "--json",
    ], root);
    assertSuccess(closeCall, "v0.9 direct coordinator source closure");
    terminal = { closed: JSON.parse(closeCall.stdout) };
  } else if (terminalKind === "abandoned") {
    const abandonPath = await jsonFile(requests, `${runId}-abandon`, {
      run_id: runId,
      resume: activated.run.binding,
      reason: "The terminal direct coordinator delivery must be reissued under the corrected release.",
    });
    const abandonedCall = invoke(runtimeCli, [
      "run", "abandon", "--run-id", runId, "--file", abandonPath, "--json",
    ], root);
    assertSuccess(abandonedCall, "v0.9.7 direct coordinator source abandonment");
    terminal = { abandoned: JSON.parse(abandonedCall.stdout) };
  } else {
    throw new Error(`Unsupported direct coordinator terminal fixture: ${terminalKind}`);
  }
  return {
    activated,
    ...terminal,
    audit,
    request,
    runtimeCli,
    workflowTask,
    localWork,
    beforeAbandonResult,
  };
}

test("v0.9 refresh reissues unfinished coordinator work without inventing child cleanup authority", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v096-direct-coordinator-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v096-direct-coordinator-requests-"));
  const sourcePackage = await extractTaggedPackage("68251f17077edc9e71ef8758f85a27d25c87ee14");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const source = await createAbandonedDirectCoordinatorRun({
    root,
    requests,
    sourcePackage,
    workflowTaskOverrides: {
      mode: "write",
      write_paths: ["audit-sentinel/refresh-v096-replacement.txt"],
      shared_resources: ["refresh-v096-replacement-resource"],
    },
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "direct coordinator refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.package_version, "0.9.7-rc.7");

  const replacement = {
    ...source.workflowTask,
    task_id: "refresh-v096-direct-coordinator-replacement",
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    selector_rationale: "Sol-xhigh is freshly selected for the bounded coordinator replacement.",
  };
  const targetActivation = activation({
    runId: "refresh-v096-direct-coordinator-target",
    workflowTask: replacement,
    lineageId: "refresh-v096-direct-coordinator-target-lineage",
    threadId: source.request.runtime.lineage.thread_id,
    branch: "main",
    branchFences: [],
  });
  const invalidWaitPath = await jsonFile(requests, "refresh-v096-direct-coordinator-wait", {
    source_namespace: "v0.9.7-rc.7",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.workflowTask.task_id,
      disposition: "wait",
      rationale: "An unfinished coordinator claim cannot be treated as settled.",
    }],
    replacements: [],
    target_workflow: null,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const invalidWait = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", invalidWaitPath, "--json",
  ], root);
  assert.notEqual(invalidWait.status, 0);
  assert.match(invalidWait.stderr, /Unfinished coordinator work must be discarded and reissued/);

  const partialFencePath = await jsonFile(requests, "refresh-v096-direct-coordinator-partial-fences", {
    source_namespace: "v0.9.7-rc.7",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.workflowTask.task_id,
      disposition: "discard",
      rationale: "The terminal direct delivery has no executor resources and will be reissued.",
    }],
    replacements: [{
      source_task_id: source.workflowTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const partialFenceCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", partialFencePath, "--json",
  ], root);
  assert.notEqual(partialFenceCall.status, 0);
  assert.match(partialFenceCall.stderr, /outside the admitted run fence envelope/);

  const preparePath = await jsonFile(requests, "refresh-v096-direct-coordinator-prepare", {
    source_namespace: "v0.9.7-rc.7",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.workflowTask.task_id,
      disposition: "discard",
      rationale: "The terminal direct delivery has no executor resources and will be reissued.",
    }],
    replacements: [{
      source_task_id: source.workflowTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "direct coordinator refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.deepEqual(handoff.cleanup, []);
  assert.equal(handoff.intent.replacements[0].source_operation_id, source.localWork.local_work_id);

  const applyPath = await jsonFile(requests, "refresh-v096-direct-coordinator-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: [],
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill,
    "--file", applyPath, "--json",
  ], root);
  assertSuccess(appliedCall, "direct coordinator refresh apply");
  const applied = JSON.parse(appliedCall.stdout);
  assert.equal(applied.status, "source-retired");

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  const activationPath = await jsonFile(requests, "refresh-v096-direct-coordinator-target", targetActivation);
  const activatedCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: source.request.runtime.lineage.thread_id });
  assertSuccess(activatedCall, "direct coordinator target activation");
  const activated = JSON.parse(activatedCall.stdout);
  assert.equal(activated.state_authority.namespace, RUNTIME_DIRECTORY);
  assert.equal(activated.refresh_origin.refresh_id, handoff.refresh_id);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.9.7-rc.7")), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/refresh-v1")), /ENOENT/);
});

test("v0.9 refresh keeps completed coordinator work on the true no-work clean-start path", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v097-completed-coordinator-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v097-completed-coordinator-requests-"));
  const sourcePackage = await extractTaggedPackage("68251f17077edc9e71ef8758f85a27d25c87ee14");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const source = await createAbandonedDirectCoordinatorRun({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v097-completed-coordinator-source",
    beforeAbandon: async ({ request, runtimeCli, localWork }) => {
      const completePath = await jsonFile(requests, "refresh-v097-completed-coordinator-complete", {
        run_id: request.run_id,
        local_work_id: localWork.local_work_id,
        checks: [{
          check_id: "completed-source-no-change",
          argv: [process.execPath, "-e", "process.exit(0)"],
        }],
      });
      const completedCall = invoke(runtimeCli, [
        "workflow", "local", "complete", "--run-id", request.run_id,
        "--file", completePath, "--json",
      ], root, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
      assertSuccess(completedCall, "v0.9.7 completed coordinator source work");
      return JSON.parse(completedCall.stdout);
    },
  });
  assert.equal(source.beforeAbandonResult.state, "completed");
  assert.equal(source.beforeAbandonResult.result.kind, "no-change");

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const preparePath = await jsonFile(requests, "refresh-v097-completed-coordinator-prepare", {
    source_namespace: "v0.9.7-rc.7",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [],
    replacements: [],
    target_workflow: null,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "completed coordinator clean-start preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.equal(handoff.intent.target.mode, "no-replacements");
  assert.deepEqual(handoff.intent.decisions, []);
  assert.deepEqual(handoff.intent.replacements, []);

  const applyPath = await jsonFile(requests, "refresh-v097-completed-coordinator-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: [],
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill,
    "--file", applyPath, "--json",
  ], root);
  assertSuccess(appliedCall, "completed coordinator clean-start apply");
  assert.equal(JSON.parse(appliedCall.stdout).status, "consumed-clean-start");
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.9.7-rc.7")), /ENOENT/);
});

test("assignment-lived reporting binds the exact target before refresh source deletion", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v097-assignment-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v097-assignment-requests-"));
  const sourcePackage = await copyCurrentPackage();
  const targetPackage = await copyCurrentPackage({ version: "0.9.11-rc.5" });
  const sourceNamespace = RUNTIME_DIRECTORY;
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const recipient = {
    lineage_id: "refresh-assignment-director-lineage",
    thread_id: "refresh-assignment-director",
    generation: 1,
  };
  const planPath = resolve(root, "refresh-assignment-plan.md");
  const source = await createAbandonedDirectCoordinatorRun({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v097-assignment-source",
    beforeAbandon: async ({ activated, request }) => {
      await writeFile(planPath, "# Refresh assignment fixture\n", "utf8");
      await bindRecipient({ stateRoot: activated.state_authority.state_root, recipient });
      const result = await registerCoordinatorReportRoute({
        stateRoot: activated.state_authority.state_root,
        runId: request.run_id,
        senderThreadId: request.runtime.lineage.thread_id,
        senderHostId: request.runtime.host.host_id,
        recipient: {
          host_id: request.runtime.host.host_id,
          ...recipient,
          binding_digest: recipientBindingDigest(recipient),
        },
        approvedPlanPath: planPath,
        approvedPlanDigest: sha256("# Refresh assignment fixture\n"),
        iterationLabel: "v0.9.7",
        purpose: "Refresh assignment binding",
        repositoryRoot: root,
        repositoryBranch: "main",
      });
      await installRepositoryReportLocator({
        stateRoot: result.state_root,
        route: result.route,
        packageRoot: targetPackage.root,
        nativeQueue: {
          binary_path: CODEX_APP_BINARY_PATH,
          expected_version: CODEX_APP_CLI_VERSION,
          sqlite_home: resolve(homedir(), ".codex"),
        },
      });
      await markAssignmentRegistrationStage({
        stateRoot: result.state_root,
        assignmentId: result.route.assignment.assignment_id,
        stage: "locator",
      });
      await publishAssignmentReadiness({
        stateRoot: result.state_root,
        assignmentId: result.route.assignment.assignment_id,
      });
      await rm(planPath);
      return result;
    },
  });
  const registered = source.beforeAbandonResult;
  const originalAssignment = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
  });
  assert.equal(originalAssignment.execution_bindings.length, 1);

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "assignment refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.package_version, "0.9.11-rc.4");

  const replacement = {
    ...source.workflowTask,
    task_id: "refresh-v097-assignment-target-delivery",
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    selector_rationale: "Sol-xhigh is freshly selected for the assignment-bound coordinator replacement.",
  };
  const targetActivation = activation({
    runId: "refresh-v097-assignment-target",
    workflowTask: replacement,
    lineageId: "refresh-v097-assignment-target-lineage",
    threadId: source.request.runtime.lineage.thread_id,
    branch: "main",
    branchFences: [],
  });
  const preparePath = await jsonFile(requests, "refresh-v097-assignment-prepare", {
    source_namespace: sourceNamespace,
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.workflowTask.task_id,
      disposition: "discard",
      rationale: "The terminal direct delivery is reissued under the corrected target.",
    }],
    replacements: [{
      source_task_id: source.workflowTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "assignment refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  const applyPath = await jsonFile(requests, "refresh-v097-assignment-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: [],
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill,
    "--file", applyPath, "--json",
  ], root);
  assertSuccess(appliedCall, "assignment refresh apply");

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  await assert.rejects(consumeWithHooks({
    targetPackage,
    root,
    activationRequest: targetActivation,
    refreshId: handoff.refresh_id,
    crashAfter: "afterAssignmentBinding",
  }), /afterAssignmentBinding/);
  const interrupted = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: originalAssignment.assignment_id,
  });
  assert.equal(interrupted.execution_bindings.length, 2);
  assert.deepEqual(interrupted.execution_bindings[0], originalAssignment.execution_bindings[0]);
  assert.equal(interrupted.execution_bindings[1].run_id, targetActivation.run_id);
  const interruptedStatusCall = invoke(targetPackage.cli, [
    "refresh", "status", "--invoking-skill", targetSkill,
    "--refresh-id", handoff.refresh_id, "--json",
  ], root);
  assertSuccess(interruptedStatusCall, "interrupted current-source refresh status");
  assert.equal(JSON.parse(interruptedStatusCall.stdout).status, "source-retired");

  const targetActivationPath = await jsonFile(requests, "refresh-v097-assignment-target", targetActivation);
  const activatedCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id, "--file", targetActivationPath, "--json",
  ], root, { CODEX_THREAD_ID: source.request.runtime.lineage.thread_id });
  assertSuccess(activatedCall, "assignment refresh target activation replay");
  const activatedTarget = JSON.parse(activatedCall.stdout);
  const rebound = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: originalAssignment.assignment_id,
  });
  assert.deepEqual(rebound.execution_bindings, interrupted.execution_bindings);
  assert.equal((await openAssignmentForSender({
    stateRoot: registered.state_root,
    hostId: source.request.runtime.host.host_id,
    threadId: source.request.runtime.lineage.thread_id,
    runId: targetActivation.run_id,
  })).assignment_id, originalAssignment.assignment_id);
  await assert.rejects(stat(resolve(root, ".git/codex-flow", sourceNamespace)), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/refresh-v1")), /ENOENT/);

  const afterCutover = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: originalAssignment.assignment_id,
  });
  const sourceRetirement = afterCutover.execution_retirements.find(
    (entry) => entry.run_id === source.request.run_id,
  );
  assert.equal(sourceRetirement.terminal_status, "abandoned");
  assert.equal(sourceRetirement.evidence_source, "refresh");
  assert.equal(sourceRetirement.resource_disposition, "refresh-retired");

  const abandonPath = await jsonFile(requests, "refresh-v097-assignment-target-abandon", {
    run_id: targetActivation.run_id,
    resume: activatedTarget.run.binding,
    reason: "The replacement was interrupted after cutover and the assignment must be cancelled honestly.",
  });
  const abandonedTargetCall = invoke(targetPackage.cli, [
    "run", "abandon", "--run-id", targetActivation.run_id,
    "--file", abandonPath, "--json",
  ], root);
  assertSuccess(abandonedTargetCall, "assignment refresh target abandonment");

  const cancellationPath = await jsonFile(requests, "refresh-v097-assignment-cancel", {
    assignment_id: originalAssignment.assignment_id,
    reason: "The post-cutover replacement failed and no further execution belongs to this assignment.",
  });
  const cancellationCall = invoke(targetPackage.cli, [
    "assignment", "cancel", "--assignment-id", originalAssignment.assignment_id,
    "--file", cancellationPath, "--json",
  ], root, { CODEX_THREAD_ID: recipient.thread_id });
  assertSuccess(cancellationCall, "same-assignment cancellation after refresh source removal");
  const cancelled = JSON.parse(cancellationCall.stdout);
  assert.equal(cancelled.assignment.state, "cancelled");
  assert.deepEqual(
    cancelled.assignment.execution_retirements.map((entry) => entry.run_id).sort(),
    [source.request.run_id, targetActivation.run_id].sort(),
  );
  const targetObligation = cancelled.obligations.find(
    (entry) => entry.run_id === targetActivation.run_id,
  );
  assert.equal(targetObligation.resource_disposition, "retained");
  assert.equal(targetObligation.owner_thread_id, source.request.runtime.lineage.thread_id);
  assert.match(targetObligation.next_action, /release|reconcile|resolve/i);
});

for (const creationOutcome of ["provisional", "opaque"]) {
test(`applyRefresh retires an assigned ${creationOutcome}-first launch whose iteration projection is absent`, async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v0911-launch-assignment-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v0911-launch-requests-"));
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v0911-launch-home-"));
  const targetPackage = await copyCurrentPackage({ version: "0.9.11-rc.5" });
  const source = await createActiveTaskLaunch(root, "refresh-assigned-provisional", {
    taskTitle: "Executor · v0.9.7 · Assignment reporting",
    creationOutcome,
    creationBeforeStart: true,
    creationHostId: creationOutcome === "opaque" ? "unknown" : "local",
  });
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", source.executorPath], {
      cwd: root,
      stdio: "ignore",
    });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(codexHome, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const director = {
    lineage_id: "refresh-launch-director-lineage",
    thread_id: "refresh-launch-director",
    generation: 1,
  };
  const planText = "# Refresh launch assignment fixture\n";
  const planPath = resolve(root, "refresh-launch-assignment-plan.md");
  await writeFile(planPath, planText, "utf8");
  await bindRecipient({ stateRoot: source.stateRoot, recipient: director });
  const registered = await registerCoordinatorReportRoute({
    stateRoot: source.stateRoot,
    runId: source.contract.run_id,
    senderThreadId: source.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...director,
      binding_digest: recipientBindingDigest(director),
    },
    approvedPlanPath: planPath,
    approvedPlanDigest: sha256(planText),
    iterationLabel: "v0.9.7",
    purpose: "Assignment reporting",
    repositoryRoot: root,
    repositoryBranch: "main",
  });
  await installRepositoryReportLocator({
    stateRoot: registered.state_root,
    route: registered.route,
    packageRoot: targetPackage.root,
    nativeQueue: {
      binary_path: CODEX_APP_BINARY_PATH,
      expected_version: CODEX_APP_CLI_VERSION,
      sqlite_home: resolve(homedir(), ".codex"),
    },
  });
  await markAssignmentRegistrationStage({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
    stage: "locator",
  });
  await publishAssignmentReadiness({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
  });
  await rm(planPath);
  const assignment = await assignmentAuthority({
    stateRoot: registered.state_root,
    assignmentId: registered.route.assignment.assignment_id,
  });
  const before = await iterationStatus({
    commonDir: source.commonDir,
    iterationId: assignment.iteration_id,
  });
  assert.equal(before.members.some((entry) => entry.role === "executor"), false);

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "assigned provisional launch refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);

  const replacement = {
    ...source.contract.task,
    task_id: "refresh-assigned-provisional-replacement",
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    selector_rationale: "Sol-xhigh is freshly selected for the replacement assignment.",
  };
  const targetActivation = activation({
    runId: "refresh-assigned-provisional-target",
    workflowTask: replacement,
    lineageId: "refresh-assigned-provisional-target-lineage",
    threadId: source.coordinator.thread_id,
    branch: "codex/refresh-assigned-provisional-target",
  });
  const preparePath = await jsonFile(requests, "refresh-assigned-provisional-prepare", {
    source_namespace: RUNTIME_DIRECTORY,
    source_run_id: source.contract.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "discard",
      rationale: "The exact provisional-first launch is disposable and will be reissued.",
    }],
    replacements: [{
      source_task_id: source.contract.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinator.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "assigned provisional launch refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.deepEqual(handoff.cleanup.map((entry) => entry.source_task_id), [source.contract.task_id]);

  await writeArchivedSession(codexHome, source.executorThreadId, source.executorPath);
  const observedCall = invoke(targetPackage.cli, [
    "refresh", "observe-private", "--invoking-skill", targetSkill,
    "--refresh-id", handoff.refresh_id, "--json",
  ], root, { CODEX_HOME: codexHome });
  assertSuccess(observedCall, "assigned provisional launch archive observation");
  const observed = JSON.parse(observedCall.stdout);
  const applyPath = await jsonFile(requests, "refresh-assigned-provisional-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: observed.archive_evidence,
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill,
    "--file", applyPath, "--json",
  ], root, { CODEX_HOME: codexHome });
  assertSuccess(appliedCall, "assigned provisional launch refresh apply");
  const applied = JSON.parse(appliedCall.stdout);
  assert.equal(applied.status, "source-retired");
  const retired = await iterationStatus({
    commonDir: source.commonDir,
    iterationId: assignment.iteration_id,
  });
  const retiredExecutor = retired.members.find(
    (entry) => entry.authority.kind === "task-launch" && entry.authority.authority_id === source.launch.launch_id,
  );
  assert.equal(retiredExecutor.state, "archived");
  assert.equal(retiredExecutor.thread_id, source.executorThreadId);
  assert.equal(retiredExecutor.archive_attempt.reason, "refresh-retired");
  await assert.rejects(stat(source.executorPath), /ENOENT/);

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  const activationPath = await jsonFile(requests, "refresh-assigned-provisional-target", targetActivation);
  const activatedCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: source.coordinator.thread_id });
  assertSuccess(activatedCall, "assigned provisional launch target activation");
  const activatedTarget = JSON.parse(activatedCall.stdout);
  await assert.rejects(stat(resolve(source.commonDir, "codex-flow", RUNTIME_DIRECTORY)), /ENOENT/);

  const abandonPath = await jsonFile(requests, "refresh-assigned-provisional-target-abandon", {
    run_id: targetActivation.run_id,
    resume: activatedTarget.run.binding,
    reason: "The replacement stopped after cutover so the assignment can be cancelled honestly.",
  });
  const abandonedCall = invoke(targetPackage.cli, [
    "run", "abandon", "--run-id", targetActivation.run_id,
    "--file", abandonPath, "--json",
  ], root);
  assertSuccess(abandonedCall, "assigned provisional launch target abandonment");
  const cancellationPath = await jsonFile(requests, "refresh-assigned-provisional-cancel", {
    assignment_id: assignment.assignment_id,
    reason: "No further execution belongs to the refreshed assignment.",
  });
  const cancellationCall = invoke(targetPackage.cli, [
    "assignment", "cancel", "--assignment-id", assignment.assignment_id,
    "--file", cancellationPath, "--json",
  ], root, { CODEX_THREAD_ID: director.thread_id });
  assertSuccess(cancellationCall, "assigned provisional launch cancellation after source removal");
  const cancelled = JSON.parse(cancellationCall.stdout);
  assert.equal(cancelled.assignment.state, "cancelled");
  assert.equal(
    cancelled.iteration.iteration.members.find((entry) => entry.member_id === retiredExecutor.member_id).state,
    "archived",
  );
});
}

test("RC2 snapshot abandonment cancellation permits same-coordinator fresh assignment admission", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-rc2-failed-assignment-");
  const commonDir = resolve(root, ".git");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-rc2-failed-assignment-requests-"));
  const sourcePackage = await extractTaggedPackage("1d5595621f1b6d5afaf3daa3f38cb359fa3f8759");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const coordinatorThreadId = "rc2-failed-assignment-source-coordinator";
  const director = {
    lineage_id: "rc2-failed-assignment-director-lineage",
    thread_id: "rc2-failed-assignment-director",
    generation: 1,
  };
  const sourcePlan = resolve(requests, "rc2-failed-assignment-plan.md");
  await writeFile(sourcePlan, "# Failed assignment exit fixture\n", "utf8");
  const source = await createAbandonedDirectCoordinatorRun({
    root,
    requests,
    sourcePackage,
    runId: "rc2-failed-assignment-source",
    beforeAbandon: async ({ activated, request, runtimeCli, localWork }) => {
      await bindRecipient({ stateRoot: activated.state_authority.state_root, recipient: director });
      const registration = await registerCoordinatorReportRoute({
        stateRoot: activated.state_authority.state_root,
        runId: request.run_id,
        senderThreadId: coordinatorThreadId,
        senderHostId: "local",
        recipient: {
          host_id: "local",
          ...director,
          binding_digest: recipientBindingDigest(director),
        },
        approvedPlanPath: sourcePlan,
        approvedPlanDigest: sha256("# Failed assignment exit fixture\n"),
        iterationLabel: "v0.9.10 failed assignment",
        purpose: "Cross-namespace cancellation proof",
        repositoryRoot: root,
        repositoryBranch: "main",
      });
      await installRepositoryReportLocator({
        stateRoot: registration.state_root,
        route: registration.route,
        packageRoot: targetPackage.root,
        nativeQueue: {
          binary_path: CODEX_APP_BINARY_PATH,
          expected_version: CODEX_APP_CLI_VERSION,
          sqlite_home: resolve(homedir(), ".codex"),
        },
      });
      await markAssignmentRegistrationStage({
        stateRoot: registration.state_root,
        assignmentId: registration.route.assignment.assignment_id,
        stage: "locator",
      });
      await publishAssignmentReadiness({
        stateRoot: registration.state_root,
        assignmentId: registration.route.assignment.assignment_id,
      });
      const assignmentPath = resolve(
        registration.state_root,
        "records",
        `${registration.route.assignment.assignment_id}.json`,
      );
      const legacyAssignment = JSON.parse(await readFile(assignmentPath, "utf8"));
      delete legacyAssignment.cancellation;
      await writeFile(assignmentPath, `${JSON.stringify(legacyAssignment)}\n`, "utf8");

      const cancellationRequest = await jsonFile(requests, "rc2-active-cancellation", {
        assignment_id: registration.route.assignment.assignment_id,
        reason: "The original snapshot fixture is intentionally failed after its coordinator work completed.",
      });
      const wrongDirector = invoke(targetPackage.cli, [
        "assignment", "cancel", "--assignment-id", registration.route.assignment.assignment_id,
        "--file", cancellationRequest, "--json",
      ], root, { CODEX_THREAD_ID: "wrong-director" });
      assert.notEqual(wrongDirector.status, 0);
      assert.match(wrongDirector.stderr, /Only the assigned director can cancel/);
      const active = invoke(targetPackage.cli, [
        "assignment", "cancel", "--assignment-id", registration.route.assignment.assignment_id,
        "--file", cancellationRequest, "--json",
      ], root, { CODEX_THREAD_ID: director.thread_id });
      assert.notEqual(active.status, 0);
      assert.match(active.stderr, /requires terminal execution evidence/);

      const completePath = await jsonFile(requests, "rc2-source-coordinator-complete", {
        run_id: request.run_id,
        local_work_id: localWork.local_work_id,
        checks: [{
          check_id: "rc2-source-completed-no-change",
          argv: [process.execPath, "-e", "process.exit(0)"],
        }],
      });
      const complete = invoke(runtimeCli, [
        "workflow", "local", "complete", "--run-id", request.run_id,
        "--file", completePath, "--json",
      ], root, { CODEX_THREAD_ID: coordinatorThreadId });
      assertSuccess(complete, "RC2 source coordinator completion");
      return registration;
    },
  });
  assert.equal(source.activated.package_authority.package_version, "0.9.10-rc.2");
  const registration = source.beforeAbandonResult;
  const cancellationPath = await jsonFile(requests, "rc2-terminal-cancellation", {
    assignment_id: registration.route.assignment.assignment_id,
    reason: "The original snapshot fixture is intentionally failed after its coordinator work completed.",
  });
  const cancellationCall = invoke(targetPackage.cli, [
    "assignment", "cancel", "--assignment-id", registration.route.assignment.assignment_id,
    "--file", cancellationPath, "--json",
  ], root, { CODEX_THREAD_ID: director.thread_id });
  assertSuccess(cancellationCall, "RC2 assignment cancellation through the newer candidate");
  const cancelled = JSON.parse(cancellationCall.stdout);
  assert.equal(cancelled.assignment.state, "cancelled");
  assert.equal(cancelled.assignment.acceptance, null);
  assert.equal(cancelled.assignment.cancellation.execution_evidence[0].namespace, "v0.9.10-rc.2");
  assert.equal(cancelled.assignment.cancellation.execution_evidence[0].terminal_status, "abandoned");
  assert.equal(cancelled.iteration.iteration.state, "cancelled");
  assert.equal((await reportRoute({ stateRoot: registration.state_root, routeId: registration.route.route_id })).state, "closed");
  await assert.rejects(stat(resolve(
    commonDir,
    "codex-flow",
    "report-locators",
    "records",
    `${sha256(coordinatorThreadId)}.json`,
  )), /ENOENT/);
  const cancelledIteration = await iterationStatus({
    commonDir,
    iterationId: cancelled.assignment.iteration_id,
  });
  assert.equal(cancelledIteration.members.find((member) => member.role === "coordinator").worktree_path, root);
  assert.equal((await closeoutIterationWithOwningHost({
    commonDir,
    iterationId: cancelled.assignment.iteration_id,
    allowCoordinator: true,
  })).status, "cancelled");

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const refreshPrepare = await jsonFile(requests, "rc2-cancelled-refresh-prepare", {
    source_namespace: "v0.9.10-rc.2",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [],
    replacements: [],
    target_workflow: null,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: coordinatorThreadId,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", refreshPrepare, "--json",
  ], root);
  assertSuccess(preparedCall, "RC2 cancelled-source refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.equal(handoff.intent.source.package_version, "0.9.10-rc.2");
  assert.equal(handoff.intent.target.package_version, JSON.parse(await readFile(resolve(targetPackage.root, "package.json"), "utf8")).version);
  const refreshApply = await jsonFile(requests, "rc2-cancelled-refresh-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: [],
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill,
    "--file", refreshApply, "--json",
  ], root);
  assertSuccess(appliedCall, "RC2 cancelled-source refresh consumption");
  assert.equal(JSON.parse(appliedCall.stdout).status, "consumed-clean-start");
  await assert.rejects(stat(resolve(commonDir, "codex-flow", "v0.9.10-rc.2")), /ENOENT/);

  const freshTask = task("rc2-failed-assignment-fresh-canary", {
    execution_kind: "coordinator",
    mode: "read",
    write_paths: [],
    shared_resources: [],
  });
  const freshActivation = activation({
    runId: "rc2-failed-assignment-fresh-target",
    workflowTask: freshTask,
    lineageId: "rc2-failed-assignment-fresh-lineage",
    threadId: coordinatorThreadId,
    branch: "main",
    branchFences: [],
  });
  const freshActivationPath = await jsonFile(requests, "rc2-failed-assignment-fresh-activation", freshActivation);
  const freshCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", freshActivation.run_id,
    "--file", freshActivationPath, "--json",
  ], root, { CODEX_THREAD_ID: coordinatorThreadId });
  assertSuccess(freshCall, "fresh candidate run admission after cancelled RC2");
  const fresh = JSON.parse(freshCall.stdout);
  assert.equal(fresh.run.status, "active");

  const targetStateRoot = resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY);
  await bindRecipient({ stateRoot: targetStateRoot, recipient: director });
  const freshRegistration = await registerCoordinatorReportRoute({
    stateRoot: targetStateRoot,
    runId: freshActivation.run_id,
    senderThreadId: coordinatorThreadId,
    senderHostId: "local",
    recipient: {
      host_id: "local",
      ...director,
      binding_digest: recipientBindingDigest(director),
    },
    approvedPlanPath: sourcePlan,
    approvedPlanDigest: sha256("# Failed assignment exit fixture\n"),
    iterationLabel: "v0.9.10 fresh canary",
    purpose: "Fresh assignment after failed exit",
    repositoryRoot: root,
    repositoryBranch: "main",
  });
  await installRepositoryReportLocator({
    stateRoot: freshRegistration.state_root,
    route: freshRegistration.route,
    packageRoot: targetPackage.root,
    nativeQueue: {
      binary_path: CODEX_APP_BINARY_PATH,
      expected_version: CODEX_APP_CLI_VERSION,
      sqlite_home: resolve(homedir(), ".codex"),
    },
  });
  await markAssignmentRegistrationStage({
    stateRoot: freshRegistration.state_root,
    assignmentId: freshRegistration.route.assignment.assignment_id,
    stage: "locator",
  });
  await publishAssignmentReadiness({
    stateRoot: freshRegistration.state_root,
    assignmentId: freshRegistration.route.assignment.assignment_id,
  });
  const freshAssignment = await assignmentAuthority({
    stateRoot: freshRegistration.state_root,
    assignmentId: freshRegistration.route.assignment.assignment_id,
  });
  assert.equal(freshAssignment.state, "open");
  assert.equal((await openAssignmentForSender({
    stateRoot: freshRegistration.state_root,
    hostId: "local",
    threadId: coordinatorThreadId,
  })).assignment_id, freshAssignment.assignment_id);
  const freshIteration = await iterationStatus({
    commonDir,
    iterationId: freshAssignment.iteration_id,
  });
  assert.equal(freshIteration.members.find((member) => member.role === "coordinator").worktree_path, root);
  assert.equal(cancelledIteration.state, "cancelled");
});

async function createClosedV09Run({
  root,
  requests,
  sourcePackage,
  runId = "refresh-v09-closed-source",
  selectorReplan = false,
  blockedAuditFirst = false,
}) {
  const prompt = "Inspect the bounded refresh fixture and return its terminal result.";
  const workflowTask = task(`${runId}-subagent`, {
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Luna-medium is sufficient for this bounded source fixture.",
    fork_turns: "2",
    write_paths: [],
    shared_resources: [],
  });
  const request = activation({
    runId,
    workflowTask,
    lineageId: `${runId}-lineage`,
    threadId: `${runId}-coordinator`,
    branch: "codex/unused-v09-source",
    branchFences: [],
  });
  const activationPath = await jsonFile(requests, `${runId}-activation`, request);
  const activatedCall = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", runId, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
  assertSuccess(activatedCall, "v0.9.0 source activation");
  const activated = JSON.parse(activatedCall.stdout);
  const runtimeCli = resolve(activated.runtime_authority.bundle_root, "bin", "codex-flow.mjs");

  const contractPath = await jsonFile(requests, `${runId}-contract`, {
    run_id: runId,
    plan_id: request.workflow.plan_id,
    task_id: workflowTask.task_id,
    dependency_authorities: [],
  });
  const contractCall = invoke(runtimeCli, [
    "workflow", "contract", "--run-id", runId, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contractCall, "v0.9.0 source contract");
  const contract = JSON.parse(contractCall.stdout);

  const preparePath = await jsonFile(requests, `${runId}-subagent-prepare`, {
    run_id: runId,
    task_contract: contract,
    model: workflowTask.model,
    reasoning_effort: workflowTask.reasoning_effort,
    fork_turns: workflowTask.fork_turns,
    mode: workflowTask.mode,
    prompt_digest: sha256(prompt),
    worktree_path: root,
  });
  const preparedCall = invoke(runtimeCli, [
    "subagent", "prepare", "--run-id", runId, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "v0.9.0 source subagent preparation");
  const operation = JSON.parse(preparedCall.stdout);

  const attemptPath = await jsonFile(requests, `${runId}-subagent-attempt`, {
    run_id: runId,
    operation_id: operation.operation_id,
    prompt,
    timeout_seconds: 300,
  });
  assertSuccess(invoke(runtimeCli, [
    "subagent", "attempt", "--run-id", runId, "--file", attemptPath, "--json",
  ], root), "v0.9.0 source subagent attempt");
  const reconcilePath = await jsonFile(requests, `${runId}-subagent-reconcile`, {
    run_id: runId,
    operation_id: operation.operation_id,
    outcome: selectorReplan ? "selector-rejected-before-agent-identity" : "accepted",
    ...(selectorReplan ? {} : { agent_id: `${runId}-agent` }),
  });
  assertSuccess(invoke(runtimeCli, [
    "subagent", "reconcile", "--run-id", runId, "--file", reconcilePath, "--json",
  ], root), "v0.9.0 source subagent reconciliation");
  let activeOperation = operation;
  if (selectorReplan) {
    const replacementTask = {
      ...workflowTask,
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "Terra-high replaces the rejected Luna selector under the single replan authority.",
    };
    const revisePath = await jsonFile(requests, `${runId}-selector-replan`, {
      run_id: runId,
      plan_id: request.workflow.plan_id,
      draft: {
        schema_version: 1,
        plan_id: request.workflow.plan_id,
        revision: 2,
        parent_revision_digest: contract.revision_digest,
        tasks: [replacementTask],
      },
    });
    assertSuccess(invoke(runtimeCli, [
      "workflow", "revise", "--run-id", runId, "--file", revisePath, "--json",
    ], root), "v0.9 source selector replan");
    const replacementContractPath = await jsonFile(requests, `${runId}-replacement-contract`, {
      run_id: runId,
      plan_id: request.workflow.plan_id,
      task_id: replacementTask.task_id,
      dependency_authorities: [],
    });
    const replacementContractCall = invoke(runtimeCli, [
      "workflow", "contract", "--run-id", runId, "--file", replacementContractPath, "--json",
    ], root);
    assertSuccess(replacementContractCall, "v0.9 source replacement contract");
    const replacementContract = JSON.parse(replacementContractCall.stdout);
    const replacementPreparePath = await jsonFile(requests, `${runId}-replacement-prepare`, {
      run_id: runId,
      task_contract: replacementContract,
      model: replacementTask.model,
      reasoning_effort: replacementTask.reasoning_effort,
      fork_turns: replacementTask.fork_turns,
      mode: replacementTask.mode,
      prompt_digest: sha256(prompt),
      worktree_path: root,
    });
    const replacementPreparedCall = invoke(runtimeCli, [
      "subagent", "prepare", "--run-id", runId, "--file", replacementPreparePath, "--json",
    ], root);
    assertSuccess(replacementPreparedCall, "v0.9 source replacement subagent preparation");
    activeOperation = JSON.parse(replacementPreparedCall.stdout);
    const replacementAttemptPath = await jsonFile(requests, `${runId}-replacement-attempt`, {
      run_id: runId,
      operation_id: activeOperation.operation_id,
      prompt,
      timeout_seconds: 300,
    });
    assertSuccess(invoke(runtimeCli, [
      "subagent", "attempt", "--run-id", runId, "--file", replacementAttemptPath, "--json",
    ], root), "v0.9 source replacement subagent attempt");
    const replacementReconcilePath = await jsonFile(requests, `${runId}-replacement-reconcile`, {
      run_id: runId,
      operation_id: activeOperation.operation_id,
      outcome: "accepted",
      agent_id: `${runId}-replacement-agent`,
    });
    assertSuccess(invoke(runtimeCli, [
      "subagent", "reconcile", "--run-id", runId, "--file", replacementReconcilePath, "--json",
    ], root), "v0.9 source replacement subagent reconciliation");
  }
  let blockedAudit = null;
  if (blockedAuditFirst) {
    const blockedAuditCall = invoke(runtimeCli, ["run", "audit", "--run-id", runId, "--json"], root);
    assertSuccess(blockedAuditCall, "v0.9 source blocked closure audit");
    blockedAudit = JSON.parse(blockedAuditCall.stdout).audit;
    assert.equal(blockedAudit.terminal_ready, false);
  }
  const completePath = await jsonFile(requests, `${runId}-subagent-complete`, {
    run_id: runId,
    operation_id: activeOperation.operation_id,
    classification: "PASS",
    summary: "The bounded source fixture is complete.",
    evidence_digests: [sha256("v0.9.0 closed refresh fixture")],
  });
  assertSuccess(invoke(runtimeCli, [
    "subagent", "complete", "--run-id", runId, "--file", completePath, "--json",
  ], root), "v0.9.0 source subagent completion");
  const disposePath = await jsonFile(requests, `${runId}-subagent-dispose`, {
    run_id: runId,
    operation_id: activeOperation.operation_id,
    disposition: "accepted",
  });
  assertSuccess(invoke(runtimeCli, [
    "subagent", "dispose", "--run-id", runId, "--file", disposePath, "--json",
  ], root), "v0.9.0 source subagent disposition");

  const auditCall = invoke(runtimeCli, ["run", "audit", "--run-id", runId, "--json"], root);
  assertSuccess(auditCall, "v0.9.0 source closure audit");
  const audit = JSON.parse(auditCall.stdout).audit;
  assert.equal(audit.terminal_ready, true);
  const closePath = await jsonFile(requests, `${runId}-close`, {
    run_id: runId,
    resume: activated.run.binding,
    audit_id: audit.audit_id,
  });
  const closeCall = invoke(runtimeCli, [
    "run", "close", "--run-id", runId, "--file", closePath, "--json",
  ], root);
  assertSuccess(closeCall, "v0.9.0 source closure");
  return {
    activated,
    closed: JSON.parse(closeCall.stdout),
    audit,
    blockedAudit,
    request,
    runtimeCli,
  };
}

async function prepareSelectedAbandonedV08Refresh({ root, requests, sourcePackage, targetPackage }) {
  const source = await createAbandonedV08Run({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v08-selected-already-abandoned",
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "already-terminal refresh inspection");
  assert.equal(JSON.parse(inspectionCall.stdout).route, "refresh-ready");
  const preparePath = await jsonFile(requests, "refresh-already-terminal-prepare", {
    source_namespace: "v0.8.3",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [],
    replacements: [],
    target_workflow: null,
    target_fences: {
      path_fences: [],
      resource_fences: [],
      branch_fences: [],
    },
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "already-terminal refresh preparation");
  return { source, handoff: JSON.parse(preparedCall.stdout).handoff };
}

async function createV08Source({
  root,
  requests,
  worktree,
  sourcePackage,
  workflowTask = task("v08-discard"),
  workflowTasks = null,
  branch = "codex/refresh-v08-discard",
  branchFences = null,
  executorThreadId = "refresh-v08-executor",
  coordinatorThreadId = "long-lived-refresh-coordinator",
}) {
  const request = activation({
    runId: "refresh-v08-source-run",
    workflowTask,
    workflowTasks,
    lineageId: "refresh-v08-source-lineage",
    threadId: coordinatorThreadId,
    branch,
    branchFences,
  });
  const activationPath = await jsonFile(requests, "source-activation", request);
  const activatedCall = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", request.run_id, "--file", activationPath, "--json",
  ], root, { CODEX_THREAD_ID: coordinatorThreadId });
  assertSuccess(activatedCall, "v0.8.3 source activation");
  const activated = JSON.parse(activatedCall.stdout);
  const runtimeCli = resolve(activated.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const contractPath = await jsonFile(requests, "source-contract", {
    run_id: request.run_id,
    plan_id: request.workflow.plan_id,
    task_id: workflowTask.task_id,
    dependency_authorities: [],
  });
  const contractCall = invoke(runtimeCli, [
    "workflow", "contract", "--run-id", request.run_id, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contractCall, "v0.8.3 source contract");
  const contract = JSON.parse(contractCall.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const selectors = {
    project_id: "refresh-project",
    model: workflowTask.model,
    reasoning_effort: workflowTask.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: branch,
      path: null,
    },
  };
  const preparePath = await jsonFile(requests, "source-create-prepare", {
    run_id: request.run_id,
    task_contract: contract,
    requested_selectors: selectors,
  });
  const preparedCall = invoke(runtimeCli, [
    "task", "create", "prepare", "--run-id", request.run_id, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "v0.8.3 source task preparation");
  const creation = JSON.parse(preparedCall.stdout);
  const attemptPath = await jsonFile(requests, "source-create-attempt", {
    run_id: request.run_id,
    operation_id: creation.operation_id,
    host_session_id: "refresh-source-session",
    timeout_seconds: 300,
  });
  const attemptCall = invoke(runtimeCli, [
    "task", "create", "attempt", "--run-id", request.run_id, "--file", attemptPath, "--json",
  ], root);
  assertSuccess(attemptCall, "v0.8.3 source task attempt");
  const attempt = JSON.parse(attemptCall.stdout);
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", worktree, baseline], { cwd: root });
  const observedPath = await realpath(worktree);
  const observedAt = new Date().toISOString();
  const reconcilePath = await jsonFile(requests, "source-create-reconcile", {
    run_id: request.run_id,
    operation_id: creation.operation_id,
    outcome: "ready",
    ready_thread_id: executorThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: executorThreadId,
      turn_id: "refresh-v08-initial-turn",
      turn_index: 1,
      role: "user",
      content: attempt.host_request.prompt,
      observed_at: observedAt,
    },
    selector_evidence: {
      accepted: { ...selectors, accepted_at: observedAt },
      observed: {
        project_id: selectors.project_id,
        model: selectors.model,
        reasoning_effort: selectors.reasoning_effort,
        worktree: { ...selectors.worktree, path: observedPath },
        observed_at: observedAt,
      },
    },
  });
  assertSuccess(invoke(runtimeCli, [
    "task", "create", "reconcile", "--run-id", request.run_id, "--file", reconcilePath, "--json",
  ], root), "v0.8.3 source task reconciliation");
  const bindPath = await jsonFile(requests, "source-create-bind", {
    run_id: request.run_id,
    operation_id: creation.operation_id,
  });
  assertSuccess(invoke(runtimeCli, [
    "task", "create", "bind", "--run-id", request.run_id, "--file", bindPath, "--json",
  ], root), "v0.8.3 source branch binding");
  const releasePreparePath = await jsonFile(requests, "source-release-prepare", {
    run_id: request.run_id,
    task_contract: contract,
    operation_id: creation.operation_id,
  });
  const releaseCall = invoke(runtimeCli, [
    "release", "prepare", "--run-id", request.run_id, "--file", releasePreparePath, "--json",
  ], root);
  assertSuccess(releaseCall, "v0.8.3 source release preparation");
  const release = JSON.parse(releaseCall.stdout);
  const releaseReconcilePath = await jsonFile(requests, "source-release-reconcile", {
    run_id: request.run_id,
    release_id: release.release_id,
    outcome: "sent",
  });
  assertSuccess(invoke(runtimeCli, [
    "release", "reconcile", "--run-id", request.run_id, "--file", releaseReconcilePath, "--json",
  ], root), "v0.8.3 source release reconciliation");
  const releaseAcceptPath = await jsonFile(requests, "source-release-accept", {
    run_id: request.run_id,
    release_id: release.release_id,
    ready_thread_id: executorThreadId,
    contract_id: contract.contract_id,
    runtime_context_digest: contract.runtime_context_digest,
    common_dir: contract.common_dir,
  });
  assertSuccess(invoke(runtimeCli, [
    "release", "accept", "--run-id", request.run_id, "--file", releaseAcceptPath, "--json",
  ], worktree), "v0.8.3 source release acceptance");
  return {
    activated,
    activation: request,
    workflowTask,
    contract,
    creation,
    release,
    requestedSelectors: selectors,
    branch,
    baseline,
    executorThreadId,
    coordinatorThreadId,
    worktree: observedPath,
    observedWorktreePath: observedPath,
    coordinator: request.runtime.lineage,
    runtimeCli,
  };
}

async function createV08Sibling({
  root,
  requests,
  source,
  workflowTask,
  branch,
  worktree,
  executorThreadId,
}) {
  const runId = source.activation.run_id;
  const prefix = workflowTask.task_id;
  const contractPath = await jsonFile(requests, `${prefix}-contract`, {
    run_id: runId,
    plan_id: source.activation.workflow.plan_id,
    task_id: workflowTask.task_id,
    dependency_authorities: [],
  });
  const contractCall = invoke(source.runtimeCli, [
    "workflow", "contract", "--run-id", runId, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contractCall, `${prefix} contract`);
  const contract = JSON.parse(contractCall.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const selectors = {
    project_id: "refresh-project",
    model: workflowTask.model,
    reasoning_effort: workflowTask.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: branch,
      path: null,
    },
  };
  const preparePath = await jsonFile(requests, `${prefix}-create-prepare`, {
    run_id: runId,
    task_contract: contract,
    requested_selectors: selectors,
  });
  const preparedCall = invoke(source.runtimeCli, [
    "task", "create", "prepare", "--run-id", runId, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, `${prefix} task preparation`);
  const creation = JSON.parse(preparedCall.stdout);
  const attemptPath = await jsonFile(requests, `${prefix}-create-attempt`, {
    run_id: runId,
    operation_id: creation.operation_id,
    host_session_id: `${prefix}-host-session`,
    timeout_seconds: 300,
  });
  const attemptCall = invoke(source.runtimeCli, [
    "task", "create", "attempt", "--run-id", runId, "--file", attemptPath, "--json",
  ], root);
  assertSuccess(attemptCall, `${prefix} task attempt`);
  const attempt = JSON.parse(attemptCall.stdout);
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", worktree, baseline], { cwd: root });
  const observedPath = await realpath(worktree);
  const observedAt = new Date().toISOString();
  const reconcilePath = await jsonFile(requests, `${prefix}-create-reconcile`, {
    run_id: runId,
    operation_id: creation.operation_id,
    outcome: "ready",
    ready_thread_id: executorThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: executorThreadId,
      turn_id: `${prefix}-initial-turn`,
      turn_index: 1,
      role: "user",
      content: attempt.host_request.prompt,
      observed_at: observedAt,
    },
    selector_evidence: {
      accepted: { ...selectors, accepted_at: observedAt },
      observed: {
        project_id: selectors.project_id,
        model: selectors.model,
        reasoning_effort: selectors.reasoning_effort,
        worktree: { ...selectors.worktree, path: observedPath },
        observed_at: observedAt,
      },
    },
  });
  assertSuccess(invoke(source.runtimeCli, [
    "task", "create", "reconcile", "--run-id", runId, "--file", reconcilePath, "--json",
  ], root), `${prefix} task reconciliation`);
  const bindPath = await jsonFile(requests, `${prefix}-create-bind`, {
    run_id: runId,
    operation_id: creation.operation_id,
  });
  assertSuccess(invoke(source.runtimeCli, [
    "task", "create", "bind", "--run-id", runId, "--file", bindPath, "--json",
  ], root), `${prefix} worktree binding`);
  const releasePreparePath = await jsonFile(requests, `${prefix}-release-prepare`, {
    run_id: runId,
    task_contract: contract,
    operation_id: creation.operation_id,
  });
  const releaseCall = invoke(source.runtimeCli, [
    "release", "prepare", "--run-id", runId, "--file", releasePreparePath, "--json",
  ], root);
  assertSuccess(releaseCall, `${prefix} release preparation`);
  const release = JSON.parse(releaseCall.stdout);
  const releaseReconcilePath = await jsonFile(requests, `${prefix}-release-reconcile`, {
    run_id: runId,
    release_id: release.release_id,
    outcome: "sent",
  });
  assertSuccess(invoke(source.runtimeCli, [
    "release", "reconcile", "--run-id", runId, "--file", releaseReconcilePath, "--json",
  ], root), `${prefix} release reconciliation`);
  const releaseAcceptPath = await jsonFile(requests, `${prefix}-release-accept`, {
    run_id: runId,
    release_id: release.release_id,
    ready_thread_id: executorThreadId,
    contract_id: contract.contract_id,
    runtime_context_digest: contract.runtime_context_digest,
    common_dir: contract.common_dir,
  });
  assertSuccess(invoke(source.runtimeCli, [
    "release", "accept", "--run-id", runId, "--file", releaseAcceptPath, "--json",
  ], worktree), `${prefix} release acceptance`);
  return {
    ...source,
    workflowTask,
    contract,
    creation,
    release,
    requestedSelectors: selectors,
    branch,
    baseline,
    executorThreadId,
    readyThreadId: executorThreadId,
    worktree: observedPath,
    observedWorktreePath: observedPath,
  };
}

async function integrateV08Source({ sourcePackage, root, source }) {
  const driver = resolve(sourcePackage.root, "v08-source-integration-driver.mjs");
  await cp(resolve(packageRoot, "test/fixtures/v08-source-integration-driver.mjs"), driver);
  const result = spawnSync(process.execPath, [driver], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    input: JSON.stringify({
      repository_root: root,
      state_root: resolve(source.contract.common_dir, "codex-flow", "v0.8.3"),
      executor: {
        contract: source.contract,
        creation: source.creation,
        release: source.release,
        requested_selectors: source.requestedSelectors,
        coordinator: source.coordinator,
        ready_thread_id: source.executorThreadId,
        observed_worktree_path: source.observedWorktreePath,
        baseline: source.baseline,
        branch: source.branch,
      },
    }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return JSON.parse(result.stdout);
}

async function writeArchivedSession(codexHome, threadId, worktree) {
  const directory = resolve(codexHome, "archived_sessions");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `refresh-${threadId}.jsonl`),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "session_meta",
      payload: {
        id: threadId,
        cwd: worktree,
        thread_source: "agent_created_thread",
        cli_version: "0.160.0",
      },
    })}\n`,
    "utf8",
  );
}

async function consumeWithHooks({ targetPackage, root, activationRequest, refreshId, crashAfter }) {
  const driver = resolve(targetPackage.root, "refresh-consume-test-driver.mjs");
  await cp(resolve(packageRoot, "test/fixtures/refresh-consume-test-driver.mjs"), driver);
  const result = spawnSync(process.execPath, [driver], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    input: JSON.stringify({
      package_root: targetPackage.root,
      repository_root: root,
      activation: activationRequest,
      refresh_id: refreshId,
      crash_after: crashAfter,
    }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return JSON.parse(result.stdout);
}

test("refresh discards a tagged local branch while a matching remote ref still blocks", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-tagged-branch-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-tagged-worktree-"));
  const worktree = resolve(worktreeParent, "executor");
  const branch = "codex/refresh-tagged-discard";
  const tag = "v-refresh-tagged-baseline";
  t.after(async () => {
    spawnSync("git", ["update-ref", "-d", `refs/remotes/origin/${branch}`], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["branch", "-D", branch], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(worktreeParent, { recursive: true, force: true }),
    ]);
  });

  execFileSync("git", ["worktree", "add", "--quiet", "-b", branch, worktree, "HEAD"], { cwd: root });
  execFileSync("git", ["tag", "-a", tag, "-m", "Retain the executor baseline independently"], { cwd: root });
  await writeFile(resolve(worktree, "discarded.txt"), "dirty executor-local work\n", "utf8");
  const commonDir = await realpath(resolve(root, ".git"));
  const authority = await captureRefreshGitAuthority({
    commonDir,
    worktreePath: worktree,
    branch,
    expectedHead: null,
    forbiddenRoots: [root],
    protectedBranches: ["main"],
  });
  assert.deepEqual(authority.tags_at_tip, [tag]);

  execFileSync("git", ["update-ref", `refs/remotes/origin/${branch}`, authority.head], { cwd: root });
  await assert.rejects(captureRefreshGitAuthority({
    commonDir,
    worktreePath: worktree,
    branch,
    expectedHead: authority.head,
    forbiddenRoots: [root],
    protectedBranches: ["main"],
  }), /matching remote ref/);
  execFileSync("git", ["update-ref", "-d", `refs/remotes/origin/${branch}`], { cwd: root });

  await removeRefreshExecutorWorktree(authority);
  await deleteRefreshExecutorBranch(authority);
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root }).status, 1);
  assert.equal(execFileSync("git", ["rev-parse", `${tag}^{commit}`], { cwd: root, encoding: "utf8" }).trim(), authority.head);
});

test("v0.9 consumes one exact v0.8.3 semantic handoff and resumes every deletion boundary", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-worktree-"));
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-home-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(codexHome, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  await createAbandonedV08Run({ root, requests, sourcePackage });
  const source = await createV08Source({ root, requests, worktree, sourcePackage });
  await writeFile(resolve(worktree, "unintegrated.txt"), "discarded local work\n", "utf8");
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "v0.9 refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.package_version, "0.8.3");

  const replacement = {
    ...source.workflowTask,
    task_id: "v09-replacement",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is freshly selected for the replacement assignment.",
  };
  const targetBranch = "codex/refresh-v09-replacement";
  const targetActivation = activation({
    runId: "refresh-v09-target-run",
    workflowTask: replacement,
    lineageId: "refresh-v09-target-lineage",
    threadId: source.coordinatorThreadId,
    branch: targetBranch,
  });
  const preparePath = await jsonFile(requests, "refresh-prepare", {
    source_namespace: "v0.8.3",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "discard",
      rationale: "This exact unintegrated executor is disposable and will be reissued.",
    }],
    replacements: [{ source_task_id: source.contract.task_id, target_task_id: replacement.task_id }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinatorThreadId,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "v0.9 refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.equal(handoff.state, "prepared");
  assert.equal(handoff.cleanup[0].git_authority.dirty, true);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "model"), false);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "reasoning_effort"), false);

  await writeArchivedSession(codexHome, source.executorThreadId, source.worktree);
  const observed = await observeRefreshPrivateArchives({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    codexHome,
  });
  const archiveEvidence = observed.archive_evidence;
  const apply = async (expectedHandoffDigest, hooks = {}) => applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest,
    archiveEvidence,
    appliedAt: new Date().toISOString(),
    codexHome,
    hooks,
  });

  await assert.rejects(
    apply(handoff.handoff_digest, { afterArchiveObserved() { throw new Error("after archive"); } }),
    /after archive/,
  );
  let status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  assert.equal(status.status, "archive-observed");
  await assert.rejects(
    apply(status.handoff_digest, { afterWorktreeRemoval() { throw new Error("after worktree"); } }),
    /after worktree/,
  );
  await assert.rejects(stat(source.worktree), /ENOENT/);
  status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  await assert.rejects(
    apply(status.handoff_digest, { afterBranchDeletion() { throw new Error("after branch"); } }),
    /after branch/,
  );
  assert.notEqual(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${source.branch}`], { cwd: root }).status, 0);
  status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  await assert.rejects(
    apply(status.handoff_digest, { afterSourceRetirement() { throw new Error("after source"); } }),
    /after source/,
  );
  status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  const retired = await apply(status.handoff_digest);
  assert.equal(retired.status, "source-retired");

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  await assert.rejects(
    consumeWithHooks({ targetPackage, root, activationRequest: targetActivation, refreshId: handoff.refresh_id, crashAfter: "afterTargetAdmission" }),
    /afterTargetAdmission/,
  );
  await assert.rejects(
    consumeWithHooks({ targetPackage, root, activationRequest: targetActivation, refreshId: handoff.refresh_id, crashAfter: "afterOriginWrite" }),
    /afterOriginWrite/,
  );
  await assert.rejects(
    consumeWithHooks({ targetPackage, root, activationRequest: targetActivation, refreshId: handoff.refresh_id, crashAfter: "afterConsumedWrite" }),
    /afterConsumedWrite/,
  );
  await assert.rejects(
    consumeWithHooks({ targetPackage, root, activationRequest: targetActivation, refreshId: handoff.refresh_id, crashAfter: "afterSourceNamespaceRemoval" }),
    /afterSourceNamespaceRemoval/,
  );
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.8.3")), /ENOENT/);

  const targetActivationPath = await jsonFile(requests, "target-activation", targetActivation);
  const activatedCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id, "--file", targetActivationPath, "--json",
  ], root, { CODEX_THREAD_ID: source.coordinatorThreadId });
  assertSuccess(activatedCall, "v0.9 target activation");
  const activated = JSON.parse(activatedCall.stdout);
  assert.equal(activated.state_authority.namespace, RUNTIME_DIRECTORY);
  assert.equal(activated.refresh_origin.refresh_id, handoff.refresh_id);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/refresh-v1")), /ENOENT/);
});

test("v0.9 refresh rejects an abandoned predecessor that retains a live Git fence", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-abandoned-residue-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-abandoned-residue-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-abandoned-residue-worktree-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  const retainedBranch = "codex/refresh-v08-abandoned-residue";
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["branch", "-D", retainedBranch], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  await createAbandonedV08Run({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v08-abandoned-with-residue",
    branchFences: [retainedBranch],
  });
  execFileSync("git", ["branch", retainedBranch], { cwd: root });
  await createV08Source({ root, requests, worktree, sourcePackage });

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "v0.9 blocked refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /Earlier source run retains unresolved fences/);
});

test("v0.9 refresh recognizes a reclaimed closed predecessor only through its authenticated terminal audit", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-reclaimed-closed-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-closed-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-closed-worktree-"));
  const reclaimedRoot = resolve(worktreeParent, "reclaimed-source");
  const sourcePackage = await extractTaggedPackage("v0.9.9");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  execFileSync("git", ["worktree", "add", "--quiet", "--detach", reclaimedRoot, "HEAD"], { cwd: root });
  const reclaimed = await createClosedV09Run({
    root: reclaimedRoot,
    requests,
    sourcePackage,
    runId: "refresh-v090-reclaimed-closed",
    blockedAuditFirst: true,
  });
  assert.equal(reclaimed.blockedAudit.terminal_ready, false);
  assert.notEqual(reclaimed.blockedAudit.audit_id, reclaimed.audit.audit_id);
  execFileSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root });
  await assert.rejects(stat(reclaimedRoot), /ENOENT/);

  const selected = await createClosedV09Run({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v090-selected-closed",
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "reclaimed closed predecessor refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);

  const commonDir = await realpath(resolve(root, ".git"));
  const selectedSource = await loadRefreshSourceAuthority({
    commonDir,
    namespace: "v0.9.9",
    runId: selected.request.run_id,
  });
  await assert.doesNotReject(assertRefreshNamespaceRemovalSafe({
    source: selectedSource,
    handoff: { cleanup: [] },
  }));
  const auditPath = resolve(
    commonDir,
    "codex-flow",
    "v0.9.9",
    "run-closure-audits",
    "records",
    `${reclaimed.audit.audit_id}.json`,
  );
  const tampered = JSON.parse(await readFile(auditPath, "utf8"));
  tampered.record_digest = "0".repeat(64);
  await writeFile(auditPath, `${JSON.stringify(tampered)}\n`, "utf8");
  const tamperedCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(tamperedCall, "tampered reclaimed predecessor refresh inspection");
  const tamperedInspection = JSON.parse(tamperedCall.stdout);
  assert.equal(tamperedInspection.route, "blocked");
  assert.match(tamperedInspection.reason, /Run-closure audit record digest is invalid/);
});

test("v0.9 refresh recognizes reclaimed closed coordinator work from terminal audit evidence", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-reclaimed-coordinator-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-coordinator-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-coordinator-worktree-"));
  const reclaimedRoot = resolve(worktreeParent, "reclaimed-source");
  const sourcePackage = await extractTaggedPackage("v0.9.9");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  execFileSync("git", ["worktree", "add", "--quiet", "--detach", reclaimedRoot, "HEAD"], { cwd: root });
  const reclaimed = await createAbandonedDirectCoordinatorRun({
    root: reclaimedRoot,
    requests,
    sourcePackage,
    runId: "refresh-v099-reclaimed-coordinator",
    terminalKind: "closed",
    beforeAbandon: async ({ request, runtimeCli, localWork }) => {
      const completePath = await jsonFile(requests, "reclaimed-coordinator-complete", {
        run_id: request.run_id,
        local_work_id: localWork.local_work_id,
        checks: [{
          check_id: "completed-reclaimed-coordinator",
          argv: [process.execPath, "-e", "process.exit(0)"],
        }],
      });
      const completedCall = invoke(runtimeCli, [
        "workflow", "local", "complete", "--run-id", request.run_id,
        "--file", completePath, "--json",
      ], reclaimedRoot, { CODEX_THREAD_ID: request.runtime.lineage.thread_id });
      assertSuccess(completedCall, "reclaimed coordinator work completion");
    },
  });
  assert.equal(reclaimed.audit.counts.coordinator_work, 1);
  execFileSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root });

  await createClosedV09Run({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v099-selected-closed",
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "reclaimed coordinator predecessor refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
});

test("v0.9 refresh recognizes a reclaimed closed selector-replan run", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-reclaimed-replan-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-replan-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-reclaimed-replan-worktree-"));
  const reclaimedRoot = resolve(worktreeParent, "reclaimed-source");
  const sourcePackage = await extractTaggedPackage("v0.9.9");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  execFileSync("git", ["worktree", "add", "--quiet", "--detach", reclaimedRoot, "HEAD"], { cwd: root });
  const reclaimed = await createClosedV09Run({
    root: reclaimedRoot,
    requests,
    sourcePackage,
    runId: "refresh-v099-reclaimed-selector-replan",
    selectorReplan: true,
  });
  assert.notEqual(
    reclaimed.audit.authority.activated_revision_digest,
    reclaimed.audit.authority.current_revision_digest,
  );
  execFileSync("git", ["worktree", "remove", "--force", reclaimedRoot], { cwd: root });

  await createClosedV09Run({
    root,
    requests,
    sourcePackage,
    runId: "refresh-v099-selected-after-replan",
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "reclaimed selector-replan refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
});

test("v0.9 refresh recognizes a selected source already abandoned before preparation", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-selected-terminal-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-selected-terminal-requests-"));
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const { source, handoff } = await prepareSelectedAbandonedV08Refresh({
    root,
    requests,
    sourcePackage,
    targetPackage,
  });
  const applied = await applyRefresh({
    commonDir: source.activated.state_authority.git_common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
  });

  assert.equal(applied.status, "consumed-clean-start");
  assert.equal(applied.handoff.source_retirement.method, "already-terminal");
  assert.equal(applied.handoff.source_retirement.terminal_status, "abandoned");
  assert.ok(Date.parse(applied.handoff.source_retirement.retired_at) >= Date.parse(handoff.intent.prepared_at));
  assert.ok(Date.parse(source.abandoned.run.terminal.abandoned_at) <= Date.parse(handoff.intent.prepared_at));
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.8.3")), /ENOENT/);
});

test("v0.9 refresh consumes a closed exact-v0.9.0 source with no replacements", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v091-closed-v090-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v091-closed-v090-requests-"));
  const sourcePackage = await extractTaggedPackage("v0.9.0");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const source = await createClosedV09Run({ root, requests, sourcePackage });
  assert.equal(source.closed.run.status, "closed");
  const commonDir = await realpath(resolve(root, ".git"));
  const sourceStateRoot = resolve(commonDir, "codex-flow", "v0.9.0");
  const sender = {
    host_id: "fixture-host",
    thread_id: source.request.runtime.lineage.thread_id,
  };
  const recipientSeed = {
    lineage_id: "refresh-recovery-director-lineage",
    thread_id: "refresh-recovery-director",
    generation: 1,
  };
  const routeDraft = {
    assignment: {
      kind: "coordinator-delegation",
      assignment_id: `coordinator-assignment-v1-${"a".repeat(64)}`,
      run_id: source.request.run_id,
      runtime_context_digest: source.activated.runtime_authority.runtime_context_digest,
      configuration_digest: source.closed.run.binding.config_hash,
      repository_digest: source.closed.run.binding.repository_hash,
      common_dir: commonDir,
      plan_id: source.closed.run.workflow_plan_id,
      revision_digest: source.closed.run.workflow_revision_digest,
      approved_plan_path: resolve(requests, "approved-recovery-plan.md"),
      approved_plan_digest: "b".repeat(64),
    },
    sender,
    recipient: {
      host_id: sender.host_id,
      ...recipientSeed,
      binding_digest: recipientBindingDigest(recipientSeed),
    },
  };
  const orphanRoute = validateReportRoute({
    schema_version: 1,
    kind: "codex-flow-v093-report-route",
    route_id: reportRouteIdFor(routeDraft),
    ...routeDraft,
    state: "active",
    lifecycle: {
      opened_at: source.activated.run.admitted_at,
      closed_at: null,
      closure_reason: null,
    },
  });
  const orphanLocator = {
    schema_version: 1,
    kind: "codex-flow-report-route-locator-v1",
    sender_thread_id: sender.thread_id,
    state_root: sourceStateRoot,
    route_id: orphanRoute.route_id,
    route_sha256: sha256(stableStringify(orphanRoute)),
    reporter: {
      package_version: "0.9.0",
      entrypoint_sha256: "1".repeat(64),
      report_hook_sha256: "2".repeat(64),
      adapter_sha256: "3".repeat(64),
      records_sha256: "4".repeat(64),
      routes_sha256: "5".repeat(64),
      core_sha256: "6".repeat(64),
      git_sha256: "7".repeat(64),
    },
    native_queue: {
      binary_path: CODEX_APP_BINARY_PATH,
      expected_version: CODEX_APP_CLI_VERSION,
      sqlite_home: resolve(homedir(), ".codex"),
    },
  };
  await mkdir(resolve(sourceStateRoot, "reports", "routes", "records"), { recursive: true });
  await writeFile(
    resolve(sourceStateRoot, "reports", "routes", "records", `${orphanRoute.route_id}.json`),
    `${stableStringify(orphanRoute)}\n`,
    "utf8",
  );
  const locatorRecords = resolve(commonDir, "codex-flow", "report-locators", "records");
  const locatorPath = resolve(locatorRecords, `${sha256(sender.thread_id)}.json`);
  await mkdir(locatorRecords, { recursive: true });
  await writeFile(locatorPath, `${stableStringify(orphanLocator)}\n`, "utf8");
  const cleanupCall = invoke(source.runtimeCli, [
    "cleanup", "plan", "--run-id", source.request.run_id, "--json",
  ], root);
  assertSuccess(cleanupCall, "v0.9.0 source cleanup plan");
  const cleanup = JSON.parse(cleanupCall.stdout);
  assert.equal(cleanup.kind, "codex-flow-v09-cleanup-plan");
  assert.deepEqual(cleanup.blocking_launch_ids, []);
  assert.equal(Object.hasOwn(cleanup, "blocking_operation_ids"), false);

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "closed v0.9.0 refresh inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.package_version, "0.9.0");

  const preparePath = await jsonFile(requests, "refresh-closed-v090-prepare", {
    source_namespace: "v0.9.0",
    source_run_id: source.request.run_id,
    source_resume: source.activated.run.binding,
    decisions: [],
    replacements: [],
    target_workflow: null,
    target_fences: {
      path_fences: [],
      resource_fences: [],
      branch_fences: [],
    },
    target_coordinator_thread_id: source.request.runtime.lineage.thread_id,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "closed v0.9.0 refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.equal(handoff.cleanup.length, 0);

  const applyPath = await jsonFile(requests, "refresh-closed-v090-apply", {
    refresh_id: handoff.refresh_id,
    expected_handoff_digest: handoff.handoff_digest,
    archive_evidence: [],
  });
  const appliedCall = invoke(targetPackage.cli, [
    "refresh", "apply", "--invoking-skill", targetSkill, "--file", applyPath, "--json",
  ], root);
  assertSuccess(appliedCall, "closed v0.9.0 refresh apply");
  const applied = JSON.parse(appliedCall.stdout);
  assert.equal(applied.status, "consumed-clean-start");
  assert.equal(applied.handoff.source_retirement.method, "already-terminal");
  assert.equal(applied.handoff.source_retirement.terminal_status, "closed");
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.9.0")), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/refresh-v1")), /ENOENT/);

  const reportObservation = {
    status: "none-observed-before-source-removal",
    observer_thread_id: recipientSeed.thread_id,
    observed_at: source.closed.run.updated_at,
    records_digest: sha256(stableStringify([])),
  };
  const refreshAuthoritySeed = {
    schema_version: 1,
    kind: "codex-flow-v095-consumed-refresh-recovery-authority-v1",
    refresh_id: applied.handoff.refresh_id,
    handoff_digest: applied.handoff.handoff_digest,
    source_namespace: applied.handoff.intent.source.namespace,
    source_run_id: applied.handoff.intent.source.run_id,
    source_coordinator_thread_id: applied.handoff.intent.source.coordinator.thread_id,
    target_coordinator_thread_id: applied.handoff.intent.target.coordinator_thread_id,
    source_tree_digest: applied.handoff.source_retirement.final_source_tree.tree_digest,
    consumption_observed_at: new Date().toISOString(),
  };
  const refreshAuthority = {
    ...refreshAuthoritySeed,
    authority_digest: sha256(stableStringify(refreshAuthoritySeed)),
  };
  const dispositionSeed = {
    refresh_authority_digest: refreshAuthority.authority_digest,
    handoff_digest: applied.handoff.handoff_digest,
    locator_sha256: sha256(stableStringify(orphanLocator)),
    route_sha256: sha256(stableStringify(orphanRoute)),
    source_tree_digest: applied.handoff.source_retirement.final_source_tree.tree_digest,
    approved_by: { host_id: sender.host_id, thread_id: recipientSeed.thread_id },
    approved_at: new Date().toISOString(),
    report_observation: reportObservation,
  };
  const disposition = {
    schema_version: 1,
    kind: "codex-flow-v095-orphan-locator-recovery-v1",
    disposition_id: `refresh-locator-recovery-v1-${sha256(stableStringify(dispositionSeed))}`,
    ...dispositionSeed,
  };
  await assert.rejects(
    () => recoverRefreshReportLocator({
      commonDir,
      refreshAuthority,
      locator: orphanLocator,
      route: orphanRoute,
      disposition: { ...disposition, source_tree_digest: "f".repeat(64) },
      recoveredAt: new Date().toISOString(),
    }),
    /disposition identity is invalid/,
  );
  const misattributedSeed = {
    ...dispositionSeed,
    report_observation: {
      ...reportObservation,
      observer_thread_id: sender.thread_id,
    },
  };
  const misattributedDisposition = {
    schema_version: 1,
    kind: "codex-flow-v095-orphan-locator-recovery-v1",
    disposition_id: `refresh-locator-recovery-v1-${sha256(stableStringify(misattributedSeed))}`,
    ...misattributedSeed,
  };
  await assert.rejects(
    () => recoverRefreshReportLocator({
      commonDir,
      refreshAuthority,
      locator: orphanLocator,
      route: orphanRoute,
      disposition: misattributedDisposition,
      recoveredAt: new Date().toISOString(),
    }),
    /disposition does not match its exact authority/,
  );
  const repositoryLock = resolve(commonDir, "codex-flow", "foreign-active-run.lock");
  await withProcessLock({
    path: repositoryLock,
    guardRoot: commonDir,
    label: "test repository refresh lock",
  }, async () => {
    await assert.rejects(
      () => recoverRefreshReportLocator({
        commonDir,
        refreshAuthority,
        locator: orphanLocator,
        route: orphanRoute,
        disposition,
        recoveredAt: new Date().toISOString(),
      }),
      /Orphan report locator recovery is already in progress/,
    );
  });
  await stat(locatorPath);
  const recoveredAt = new Date().toISOString();
  const recoveryPath = await jsonFile(requests, "refresh-closed-v090-recover-locator", {
    refresh_authority: refreshAuthority,
    locator: orphanLocator,
    route: orphanRoute,
    disposition,
    recovered_at: recoveredAt,
  });
  const recoveredCall = invoke(targetPackage.cli, [
    "refresh", "recover-locator", "--invoking-skill", targetSkill,
    "--file", recoveryPath, "--json",
  ], root);
  assertSuccess(recoveredCall, "closed v0.9.0 orphan locator recovery");
  const recovered = JSON.parse(recoveredCall.stdout);
  assert.equal(recovered.status, "retired");
  assert.equal(recovered.retirement.recovery.disposition_id, disposition.disposition_id);
  await assert.rejects(stat(locatorPath), /ENOENT/);
  const replay = await recoverRefreshReportLocator({
    commonDir,
    refreshAuthority,
    locator: orphanLocator,
    route: orphanRoute,
    disposition,
    recoveredAt: new Date().toISOString(),
  });
  assert.equal(replay.status, "already-retired");
});

test("v0.9 resumes discarded cleanup and consumption for a selected already-abandoned source", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-selected-terminal-replay-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-selected-terminal-replay-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-selected-terminal-replay-worktree-"));
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-selected-terminal-replay-home-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  const sourceBranch = "codex/refresh-v08-selected-terminal-discard";
  const targetBranch = "codex/refresh-v09-selected-terminal-replacement";
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["branch", "-D", sourceBranch], { cwd: root, stdio: "ignore" });
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(codexHome, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const sourceTask = task("v08-selected-terminal-discard");
  const source = await createV08Source({
    root,
    requests,
    worktree,
    sourcePackage,
    workflowTask: sourceTask,
    branch: sourceBranch,
    executorThreadId: "refresh-v08-selected-terminal-executor",
    coordinatorThreadId: "refresh-v08-selected-terminal-coordinator",
  });
  await writeFile(resolve(worktree, "discarded.txt"), "discarded already-terminal work\n", "utf8");
  const abandonPath = await jsonFile(requests, "selected-terminal-source-abandon", {
    run_id: source.activation.run_id,
    resume: source.activated.run.binding,
    reason: "The selected source is intentionally abandoned before refresh preparation.",
  });
  const abandonedCall = invoke(source.runtimeCli, [
    "run", "abandon", "--run-id", source.activation.run_id,
    "--file", abandonPath, "--json",
  ], root);
  assertSuccess(abandonedCall, "selected source abandonment");
  const originalTerminal = JSON.parse(abandonedCall.stdout).run.terminal;

  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const inspectionCall = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspectionCall, "selected already-terminal replay inspection");
  const inspection = JSON.parse(inspectionCall.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.run_status, "abandoned");

  const replacement = {
    ...sourceTask,
    task_id: "v09-selected-terminal-replacement",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for the bounded replay replacement.",
  };
  const targetActivation = activation({
    runId: "refresh-v09-selected-terminal-target",
    workflowTask: replacement,
    lineageId: "refresh-v09-selected-terminal-target-lineage",
    threadId: source.coordinatorThreadId,
    branch: targetBranch,
  });
  const preparePath = await jsonFile(requests, "selected-terminal-replay-prepare", {
    source_namespace: "v0.8.3",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: sourceTask.task_id,
      disposition: "discard",
      rationale: "The exact unintegrated executor resources are disposable and will be reissued.",
    }],
    replacements: [{
      source_task_id: sourceTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinatorThreadId,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "selected already-terminal replay preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.equal(handoff.intent.source.run_status, "abandoned");
  assert.equal(handoff.cleanup.length, 1);
  assert.equal(handoff.cleanup[0].git_authority.dirty, true);

  await writeArchivedSession(codexHome, source.executorThreadId, source.worktree);
  const observed = await observeRefreshPrivateArchives({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    codexHome,
  });
  const apply = async (expectedHandoffDigest, hooks = {}) => applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest,
    archiveEvidence: observed.archive_evidence,
    appliedAt: new Date().toISOString(),
    codexHome,
    hooks,
  });

  await assert.rejects(
    apply(handoff.handoff_digest, { afterArchiveObserved() { throw new Error("after archive"); } }),
    /after archive/,
  );
  let status = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(status.status, "archive-observed");
  await assert.rejects(
    apply(status.handoff_digest, { afterWorktreeRemoval() { throw new Error("after worktree"); } }),
    /after worktree/,
  );
  await assert.rejects(stat(source.worktree), /ENOENT/);
  status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  await assert.rejects(
    apply(status.handoff_digest, { afterBranchDeletion() { throw new Error("after branch"); } }),
    /after branch/,
  );
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${sourceBranch}`], {
    cwd: root,
  }).status, 1);
  status = await refreshStatus({ commonDir: source.contract.common_dir, refreshId: handoff.refresh_id });
  const retired = await apply(status.handoff_digest);
  assert.equal(retired.status, "source-retired");
  assert.equal(retired.handoff.source_retirement.method, "already-terminal");
  assert.ok(Date.parse(retired.handoff.source_retirement.retired_at) >= Date.parse(handoff.intent.prepared_at));

  const preservedCall = invoke(source.runtimeCli, [
    "run", "status", "--run-id", source.activation.run_id, "--json",
  ], root);
  assertSuccess(preservedCall, "already-terminal source evidence replay");
  assert.deepEqual(JSON.parse(preservedCall.stdout).run.terminal, originalTerminal);

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  await assert.rejects(
    consumeWithHooks({
      targetPackage,
      root,
      activationRequest: targetActivation,
      refreshId: handoff.refresh_id,
      crashAfter: "afterTargetAdmission",
    }),
    /afterTargetAdmission/,
  );
  const targetActivationPath = await jsonFile(requests, "selected-terminal-target-activation", targetActivation);
  const activatedCall = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", targetActivationPath, "--json",
  ], root, { CODEX_THREAD_ID: source.coordinatorThreadId });
  assertSuccess(activatedCall, "selected already-terminal target activation resume");
  const activated = JSON.parse(activatedCall.stdout);
  assert.equal(activated.refresh_origin.refresh_id, handoff.refresh_id);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/v0.8.3")), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git/codex-flow/refresh-v1")), /ENOENT/);
});

test("v0.9 refresh rejects drift in a selected already-terminal source", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-terminal-drift-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-terminal-drift-requests-"));
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const { source, handoff } = await prepareSelectedAbandonedV08Refresh({
    root,
    requests,
    sourcePackage,
    targetPackage,
  });
  await writeFile(resolve(root, ".git/codex-flow/v0.8.3/runs/lifecycle.json"), "{}\n", "utf8");

  await assert.rejects(applyRefresh({
    commonDir: source.activated.state_authority.git_common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
  }), /Refresh source state changed after handoff preparation/);
});

test("v0.9 mixed refresh preserves integrated work and reissues only the discarded assignment", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v09-mixed-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-mixed-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-mixed-worktrees-"));
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v09-mixed-home-"));
  const integratedWorktree = resolve(worktreeParent, "integrated");
  const discardedWorktree = resolve(worktreeParent, "discarded");
  const sourcePackage = await extractTaggedPackage("v0.8.3");
  const targetPackage = await copyCurrentPackage();
  t.after(async () => {
    for (const worktree of [integratedWorktree, discardedWorktree]) {
      spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    }
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(codexHome, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
  });

  const integratedTask = task("v08-integrated", {
    write_paths: ["audit-sentinel/v08-integrated.txt"],
    shared_resources: ["v08-integrated-resource"],
  });
  const discardedTask = task("v08-discarded", {
    write_paths: ["audit-sentinel/v08-discarded.txt"],
    shared_resources: ["v08-discarded-resource"],
  });
  const integratedBranch = "codex/refresh-v08-integrated";
  const discardedBranch = "codex/refresh-v08-discarded";
  const integrated = await createV08Source({
    root,
    requests,
    worktree: integratedWorktree,
    sourcePackage,
    workflowTask: integratedTask,
    workflowTasks: [integratedTask, discardedTask],
    branch: integratedBranch,
    branchFences: [integratedBranch, discardedBranch],
    executorThreadId: "refresh-v08-integrated-executor",
    coordinatorThreadId: "refresh-v08-mixed-coordinator",
  });
  const discarded = await createV08Sibling({
    root,
    requests,
    source: integrated,
    workflowTask: discardedTask,
    branch: discardedBranch,
    worktree: discardedWorktree,
    executorThreadId: "refresh-v08-discarded-executor",
  });
  const integratedResult = await integrateV08Source({ sourcePackage, root, source: integrated });
  await writeFile(resolve(discardedWorktree, "unintegrated.txt"), "discard this local work\n", "utf8");

  const replacement = {
    ...discardedTask,
    task_id: "v09-discarded-replacement",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Luna-medium is freshly selected for the now-mechanical replacement.",
  };
  const targetBranch = "codex/refresh-v09-mixed-replacement";
  const targetActivation = activation({
    runId: "refresh-v09-mixed-target-run",
    workflowTask: replacement,
    lineageId: "refresh-v09-mixed-target-lineage",
    threadId: integrated.coordinatorThreadId,
    branch: targetBranch,
  });
  const targetSkill = resolve(targetPackage.root, "skills/refresh/SKILL.md");
  const invalidPath = await jsonFile(requests, "refresh-mixed-invalid", {
    source_namespace: "v0.8.3",
    source_run_id: integrated.activation.run_id,
    source_resume: integrated.activated.run.binding,
    decisions: [
      {
        source_task_id: integratedTask.task_id,
        disposition: "discard",
        rationale: "This must fail because the result is integrated.",
      },
      {
        source_task_id: discardedTask.task_id,
        disposition: "discard",
        rationale: "This task remains disposable.",
      },
    ],
    replacements: [{ source_task_id: discardedTask.task_id, target_task_id: replacement.task_id }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: integrated.coordinatorThreadId,
  });
  const invalid = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", invalidPath, "--json",
  ], root);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /integration record can no longer be discarded/);

  const preparePath = await jsonFile(requests, "refresh-mixed-prepare", {
    source_namespace: "v0.8.3",
    source_run_id: integrated.activation.run_id,
    source_resume: integrated.activated.run.binding,
    decisions: [
      {
        source_task_id: integratedTask.task_id,
        disposition: "wait",
        rationale: "Its accepted result is already embodied in the current baseline.",
      },
      {
        source_task_id: discardedTask.task_id,
        disposition: "discard",
        rationale: "Its exact unintegrated local work is disposable.",
      },
    ],
    replacements: [{ source_task_id: discardedTask.task_id, target_task_id: replacement.task_id }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: integrated.coordinatorThreadId,
  });
  const preparedCall = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(preparedCall, "mixed refresh preparation");
  const handoff = JSON.parse(preparedCall.stdout).handoff;
  assert.deepEqual(handoff.cleanup.map((entry) => entry.source_task_id), [discardedTask.task_id]);
  assert.deepEqual(handoff.intent.replacements.map((entry) => entry.source_task_id), [discardedTask.task_id]);
  assert.equal(handoff.intent.replacements[0].target_task_id, replacement.task_id);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "model"), false);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "reasoning_effort"), false);
  assert.equal(replacement.model, "gpt-5.6-luna");
  assert.equal(replacement.reasoning_effort, "medium");
  assert.match(replacement.selector_rationale, /freshly selected/);
  assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", integratedResult.commit, "HEAD"], {
    cwd: root,
  }).status, 0);
  assert.match(await readFile(resolve(root, integratedTask.write_paths[0]), "utf8"), /integrated v0\.8/);

  await writeArchivedSession(codexHome, discarded.executorThreadId, discarded.worktree);
  const observed = await observeRefreshPrivateArchives({
    commonDir: discarded.contract.common_dir,
    refreshId: handoff.refresh_id,
    codexHome,
  });
  const applied = await applyRefresh({
    commonDir: discarded.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: observed.archive_evidence,
    appliedAt: new Date().toISOString(),
    codexHome,
  });
  assert.equal(applied.status, "source-retired");
  await assert.rejects(stat(discardedWorktree), /ENOENT/);
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${discardedBranch}`], {
    cwd: root,
  }).status, 1);
  assert.match(await readFile(resolve(root, integratedTask.write_paths[0]), "utf8"), /integrated v0\.8/);
});
