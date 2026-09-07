import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assignmentAuthority } from "../lib/assignment-authority.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { iterationStatus } from "../lib/iteration-registry.mjs";
import { PACKAGE_VERSION, sha256 } from "../lib/core.mjs";
import {
  assertSuccess,
  createGitFixture,
  packageRoot,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function visibleTask() {
  return {
    task_id: "cli-v09-visible",
    title: "Exercise v0.9 CLI activation",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded CLI fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["audit-sentinel/cli-v09.txt"],
    shared_resources: ["cli-v09-resource"],
    primary_outcome: "Prove the v0.9 CLI activation path is wired.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Activate one clean fixture run.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

test("v0.9 help exposes launch authority and no retired bootstrap or release commands", () => {
  const help = runCli(["--help"]);
  assertSuccess(help, "top-level help");
  assert.match(help.stdout, /task launch prepare\|attempt\|reconcile/);
  assert.match(help.stdout, /task launch start --run-id/);
  assert.match(help.stdout, /report route coordinator --run-id/);
  assert.match(help.stdout, /full first-turn assignment/);
  assert.doesNotMatch(help.stdout, /task create|release prepare|resolve-private/);
  assert.doesNotMatch(help.stdout, /v0\.7\.8|v0\.8\.1|bootstrap-only/);

  const scoped = runCli(["task", "launch", "start", "--help"]);
  assertSuccess(scoped, "scoped launch help");
  assert.match(scoped.stdout, /task launch start --run-id/);
  assert.doesNotMatch(scoped.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs|node:internal/);

  const retired = runCli(["task", "create", "--help"]);
  assertSuccess(retired, "retired scoped help remains non-crashing");
  assert.doesNotMatch(retired.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs|node:internal/);

  const retiredExecution = runCli(["task", "create", "--run-id", "retired-command"]);
  assert.notEqual(retiredExecution.status, 0);
  assert.match(retiredExecution.stderr, /task requires the v0\.9 launch lifecycle/);
  assert.doesNotMatch(retiredExecution.stderr, /node:internal|at main/);
});

test("installed CLI rejects a plugin manifest cachebuster that diverges from package identity", async (t) => {
  const installedRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-installed-identity-"));
  t.after(() => rm(installedRoot, { recursive: true, force: true }));
  await Promise.all([
    cp(resolve(packageRoot, ".codex-plugin"), resolve(installedRoot, ".codex-plugin"), { recursive: true }),
    cp(resolve(packageRoot, "bin"), resolve(installedRoot, "bin"), { recursive: true }),
    cp(resolve(packageRoot, "lib"), resolve(installedRoot, "lib"), { recursive: true }),
    cp(resolve(packageRoot, "skills"), resolve(installedRoot, "skills"), { recursive: true }),
    cp(resolve(packageRoot, "package.json"), resolve(installedRoot, "package.json")),
  ]);
  const manifestPath = resolve(installedRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = `${manifest.version}+codex.fixture`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = spawnSync(process.execPath, [
    resolve(installedRoot, "bin", "codex-flow.mjs"),
    "refresh", "inspect",
    "--invoking-skill", resolve(installedRoot, "skills", "refresh", "SKILL.md"),
    "--json",
  ], { cwd: packageRoot, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`package metadata must exactly match version ${PACKAGE_VERSION}`));
});

test("v0.9 CLI activates a clean run through current launch-era wiring", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v09-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v09-requests-"));
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
    ]);
  });

  const task = visibleTask();
  const runId = "cli-v09-run";
  const coordinatorThreadId = "cli-v09-coordinator";
  const request = {
    run_id: runId,
    activated_at: new Date().toISOString(),
    runtime: {
      config: { config_id: "cli-v09-config", snapshot: { project_id: "fixture-project" } },
      policy: { policy_id: "cli-v09-policy", snapshot: { routine_callbacks: "journal" } },
      host: { host_id: "local", session_id: "cli-v09-session" },
      lineage: {
        lineage_id: "cli-v09-lineage",
        thread_id: coordinatorThreadId,
        generation: 1,
      },
    },
    workflow: {
      schema_version: 1,
      plan_id: "cli-v09-plan",
      revision: 1,
      parent_revision_digest: null,
      tasks: [task],
    },
    fences: {
      path_fences: task.write_paths,
      resource_fences: task.shared_resources,
      branch_fences: ["codex/cli-v09-visible"],
    },
  };
  const requestPath = resolve(requests, "activation.json");
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");

  const activated = runCli([
    "run", "activate", "--run-id", runId, "--file", requestPath, "--json",
  ], {
    cwd: root,
    env: { CODEX_THREAD_ID: coordinatorThreadId },
  });
  assertSuccess(activated, "run activation");
  const result = JSON.parse(activated.stdout);
  assert.equal(result.run.run_id, runId);
  assert.equal(result.coordinator_identity.matched, true);
  assert.match(
    result.runtime_authority.bundle_root,
    new RegExp(`${RUNTIME_DIRECTORY.replaceAll(".", "\\.")}/runtimes/`),
  );

  await stat(resolve(root, ".git", "codex-flow", RUNTIME_DIRECTORY, "runs", "lifecycle.json"));
  const status = runCli(["run", "status", "--run-id", runId, "--json"], { cwd: root });
  assertSuccess(status, "run status");
  assert.equal(JSON.parse(status.stdout).run.run_id, runId);

  const preparationRequest = {
    recipient: {
      host_id: "local",
      lineage_id: "cli-v09-director-lineage",
      thread_id: "cli-v09-director",
      generation: 1,
    },
    approved_plan_path: requestPath,
    approved_plan_digest: sha256(`${JSON.stringify(request)}\n`),
    iteration_label: "CLI v0.9 test",
    purpose: "Coordinator reporting",
    outcome: "Exercise the assignment preparation and activation contract.",
    scope: ["Register one coordinator route."],
    acceptance_criteria: ["The route binds the prepared recipient."],
    constraints: [],
    reasons: [],
  };
  const preparationRequestPath = resolve(requests, "assignment-preparation.json");
  await writeFile(preparationRequestPath, `${JSON.stringify(preparationRequest)}\n`, "utf8");
  const prepared = runCli(["assignment", "prepare", "--file", preparationRequestPath, "--json"], {
    cwd: root,
    env: { CODEX_THREAD_ID: "cli-v09-director" },
  });
  assertSuccess(prepared, "coordinator assignment preparation");
  const preparation = JSON.parse(prepared.stdout).preparation;
  const reportRequest = {
    run_id: runId,
    sender_thread_id: coordinatorThreadId,
    preparation_id: preparation.preparation_id,
  };
  const reportRequestPath = resolve(requests, "report-route.json");
  await writeFile(reportRequestPath, `${JSON.stringify(reportRequest)}\n`, "utf8");
  const registered = runCli([
    "report", "route", "coordinator", "--run-id", runId, "--file", reportRequestPath, "--json",
  ], {
    cwd: root,
    env: { CODEX_THREAD_ID: coordinatorThreadId },
  });
  assertSuccess(registered, "coordinator report route");
  const reporting = JSON.parse(registered.stdout);
  assert.equal(reporting.route.assignment.kind, "coordinator-delegation");
  assert.equal(reporting.route.recipient.thread_id, "cli-v09-director");
  await stat(resolve(
    root,
    ".git",
    "codex-flow",
    "report-locators",
    "records",
    `${sha256(coordinatorThreadId)}.json`,
  ));

  const contractRequestPath = resolve(requests, "workflow-contract.json");
  await writeFile(contractRequestPath, `${JSON.stringify({
    run_id: runId,
    plan_id: request.workflow.plan_id,
    task_id: task.task_id,
    dependency_authorities: [],
  })}\n`, "utf8");
  const contracted = runCli([
    "workflow", "contract", "--run-id", runId, "--file", contractRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(contracted, "workflow task contract");
  const contract = JSON.parse(contracted.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const launchRequestPath = resolve(requests, "task-launch.json");
  await writeFile(launchRequestPath, `${JSON.stringify({
    run_id: runId,
    task_contract: contract,
    requested_selectors: {
      project_id: "fixture-project",
      model: task.model,
      reasoning_effort: task.reasoning_effort,
      worktree: {
        mode: "host-worktree",
        starting_revision: baseline,
        starting_branch: "main",
        executor_branch: "codex/cli-v09-visible",
        path: null,
      },
    },
  })}\n`, "utf8");
  const launchPrepared = runCli([
    "task", "launch", "prepare", "--run-id", runId, "--file", launchRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(launchPrepared, "assignment-bound task launch preparation");
  const launch = JSON.parse(launchPrepared.stdout);
  const canonicalExecutorTitle = "Executor · CLI v0.9 test · Coordinator reporting";
  assert.equal(launch.task_title, canonicalExecutorTitle);

  const attemptRequestPath = resolve(requests, "task-launch-attempt.json");
  await writeFile(attemptRequestPath, `${JSON.stringify({
    run_id: runId,
    launch_id: launch.launch_id,
    host_session_id: "cli-v09-host-session",
  })}\n`, "utf8");
  const attempted = runCli([
    "task", "launch", "attempt", "--run-id", runId, "--file", attemptRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(attempted, "assignment-bound task launch attempt");
  assert.equal(JSON.parse(attempted.stdout).host_request.title, canonicalExecutorTitle);

  const reconcileRequestPath = resolve(requests, "task-launch-reconcile.json");
  await writeFile(reconcileRequestPath, `${JSON.stringify({
    run_id: runId,
    launch_id: launch.launch_id,
    outcome: "provisional",
    host_id: "local",
    provisional_client_thread_id: "client-new-thread:cli-v09-executor",
  })}\n`, "utf8");
  const reconciled = runCli([
    "task", "launch", "reconcile", "--run-id", runId, "--file", reconcileRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(reconciled, "assignment-bound task launch reconciliation");
  const assignment = await assignmentAuthority({
    stateRoot: reporting.state_root,
    assignmentId: reporting.route.assignment.assignment_id,
  });
  const iteration = await iterationStatus({
    commonDir: resolve(root, ".git"),
    iterationId: assignment.iteration_id,
  });
  const executor = iteration.members.find((member) => member.role === "executor");
  assert.equal(executor.requested_title, canonicalExecutorTitle);
  assert.equal(executor.provisional_id, "client-new-thread:cli-v09-executor");
});
