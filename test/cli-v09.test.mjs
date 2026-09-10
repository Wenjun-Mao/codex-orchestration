import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import { assignmentAuthority } from "../lib/assignment-authority.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { iterationStatus } from "../lib/iteration-registry.mjs";
import { PACKAGE_VERSION, sha256 } from "../lib/core.mjs";
import { captureStopReport } from "../lib/report-hook.mjs";
import {
  CODEX_APP_BINARY_PATH,
  CODEX_APP_CLI_VERSION,
} from "../lib/codex-app-report-adapter.mjs";
import { terminalReceiptV4 } from "./v09-lifecycle-fixture.mjs";
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

function localTask() {
  return {
    task_id: "cli-v09-local",
    title: "Produce the CLI journey dependency",
    execution_kind: "coordinator",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for the connected CLI fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: [],
    write_paths: ["audit-sentinel/cli-v09-local.txt"],
    shared_resources: ["cli-v09-local-resource"],
    primary_outcome: "Produce the authenticated input for the visible task.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Commit and verify one local dependency.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

function activeTaskObservation(threadId) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "typed-host-activity-v1",
    active_visible: true,
    archived_visible: false,
    activity_state: "idle",
    observed_at: new Date().toISOString(),
  };
}

function archivedTaskObservation(threadId) {
  return {
    execution_kind: "task-thread",
    thread_id: threadId,
    source: "host-observed",
    active_visible: false,
    archived_visible: true,
    observed_at: new Date().toISOString(),
  };
}

function nativeQueue() {
  return {
    binary_path: CODEX_APP_BINARY_PATH,
    expected_version: CODEX_APP_CLI_VERSION,
    sqlite_home: resolve(homedir(), ".codex"),
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

test("installed CLI admits the updater's bounded manifest cachebuster through refresh inspection", async (t) => {
  const installedRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-installed-identity-"));
  const root = await createGitFixture("codex-flow-installed-identity-");
  t.after(() => rm(installedRoot, { recursive: true, force: true }));
  t.after(() => removeFixture(root));
  await Promise.all([
    cp(resolve(packageRoot, ".codex-plugin"), resolve(installedRoot, ".codex-plugin"), { recursive: true }),
    cp(resolve(packageRoot, "bin"), resolve(installedRoot, "bin"), { recursive: true }),
    cp(resolve(packageRoot, "lib"), resolve(installedRoot, "lib"), { recursive: true }),
    cp(resolve(packageRoot, "schemas"), resolve(installedRoot, "schemas"), { recursive: true }),
    cp(resolve(packageRoot, "skills"), resolve(installedRoot, "skills"), { recursive: true }),
    cp(resolve(packageRoot, "templates"), resolve(installedRoot, "templates"), { recursive: true }),
    cp(resolve(packageRoot, "package.json"), resolve(installedRoot, "package.json")),
  ]);
  const manifestPath = resolve(installedRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = `${manifest.version}+codex.20260909011550`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = spawnSync(process.execPath, [
    resolve(installedRoot, "bin", "codex-flow.mjs"),
    "refresh", "inspect",
    "--invoking-skill", resolve(installedRoot, "skills", "refresh", "SKILL.md"),
    "--json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.route, "fresh", inspection.reason);
});

test("installed CLI rejects unrecognized distribution metadata and a non-loaded refresh skill", async (t) => {
  const installedRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-installed-identity-"));
  t.after(() => rm(installedRoot, { recursive: true, force: true }));
  await Promise.all([
    cp(resolve(packageRoot, ".codex-plugin"), resolve(installedRoot, ".codex-plugin"), { recursive: true }),
    cp(resolve(packageRoot, "bin"), resolve(installedRoot, "bin"), { recursive: true }),
    cp(resolve(packageRoot, "lib"), resolve(installedRoot, "lib"), { recursive: true }),
    cp(resolve(packageRoot, "schemas"), resolve(installedRoot, "schemas"), { recursive: true }),
    cp(resolve(packageRoot, "skills"), resolve(installedRoot, "skills"), { recursive: true }),
    cp(resolve(packageRoot, "templates"), resolve(installedRoot, "templates"), { recursive: true }),
    cp(resolve(packageRoot, "package.json"), resolve(installedRoot, "package.json")),
  ]);
  const manifestPath = resolve(installedRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const invalidVersion of [
    "0.9.9+codex.20260909011550",
    `${PACKAGE_VERSION}+codex.fixture`,
  ]) {
    manifest.version = invalidVersion;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      resolve(installedRoot, "bin", "codex-flow.mjs"), "refresh", "inspect",
      "--invoking-skill", resolve(installedRoot, "skills", "refresh", "SKILL.md"), "--json",
    ], { cwd: packageRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Installed codex-orchestration Installed plugin metadata/);
  }

  manifest.version = PACKAGE_VERSION;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const wrongSkill = resolve(installedRoot, "wrong-refresh-skill.md");
  await writeFile(wrongSkill, await readFile(resolve(installedRoot, "skills", "refresh", "SKILL.md")));
  const result = spawnSync(process.execPath, [
    resolve(installedRoot, "bin", "codex-flow.mjs"), "refresh", "inspect",
    "--invoking-skill", wrongSkill, "--json",
  ], { cwd: packageRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /Loaded skill and CLI package disagree/);
});

test("v0.9 CLI activates a clean run through current launch-era wiring", async (t) => {
  const primary = await createGitFixture("codex-flow-cli-v09-");
  const root = resolve(primary, `../${basename(primary)}-coordinator`);
  const coordinatorBranch = "codex/cli-v09-coordinator";
  execFileSync("git", ["worktree", "add", "--quiet", "-b", coordinatorBranch, root], {
    cwd: primary,
  });
  const commonDir = resolve(execFileSync("git", [
    "rev-parse", "--path-format=absolute", "--git-common-dir",
  ], { cwd: root, encoding: "utf8" }).trim());
  const coordinatorGitDir = resolve(execFileSync("git", [
    "rev-parse", "--path-format=absolute", "--git-dir",
  ], { cwd: root, encoding: "utf8" }).trim());
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v09-requests-"));
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", root], { cwd: primary });
    await Promise.all([
      removeFixture(primary),
      rm(requests, { recursive: true, force: true }),
    ]);
  });

  const local = localTask();
  const task = { ...visibleTask(), dependencies: [local.task_id] };
  const localAContent = "connected CLI local A\n";
  const visibleBPrefix = "connected CLI visible B consumed:\n";
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
      tasks: [local, task],
    },
    fences: {
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
  const runtimeCli = resolve(result.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  assert.equal(result.run.run_id, runId);
  assert.deepEqual(
    result.workflow_authority.fences.path_fences,
    [...local.write_paths, ...task.write_paths].sort(),
  );
  assert.deepEqual(
    result.workflow_authority.fences.resource_fences,
    [...local.shared_resources, ...task.shared_resources].sort(),
  );
  assert.equal(result.coordinator_identity.matched, true);
  assert.match(
    result.runtime_authority.bundle_root,
    new RegExp(`${RUNTIME_DIRECTORY.replaceAll(".", "\\.")}/runtimes/`),
  );
  await stat(resolve(result.runtime_authority.bundle_root, "package.json"));

  await stat(resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY, "runs", "lifecycle.json"));
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
    iteration_label: "CLI v0.9 test",
    purpose: "Coordinator reporting",
    outcome: "Exercise the assignment preparation and activation contract.",
    scope: ["Complete local A, dependent visible B, cleanup, acceptance, and useful successor work."],
    acceptance_criteria: ["The connected public journey retires its exact resources and admits a successor."],
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
  const savedPlan = await readFile(preparation.approved_plan.snapshot_path, "utf8");
  await writeFile(requestPath, "source changed after preparation\n", "utf8");
  assert.equal(await readFile(preparation.approved_plan.snapshot_path, "utf8"), savedPlan);
  const reportRequest = {
    run_id: runId,
    sender_thread_id: coordinatorThreadId,
    preparation_id: preparation.preparation_id,
  };
  const reportRequestPath = resolve(requests, "report-route.json");
  await writeFile(reportRequestPath, `${JSON.stringify(reportRequest)}\n`, "utf8");
  await writeFile(resolve(coordinatorGitDir, "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: coordinatorThreadId,
  })}\n`, "utf8");
  await writeFile(preparation.approved_plan.snapshot_path, "corrupt snapshot\n", "utf8");
  const corrupted = runCli([
    "report", "route", "coordinator", "--run-id", runId, "--file", reportRequestPath, "--json",
  ], {
    cwd: root,
    env: { CODEX_THREAD_ID: coordinatorThreadId },
  });
  assert.notEqual(corrupted.status, 0);
  assert.match(`${corrupted.stdout}\n${corrupted.stderr}`, /plan was tampered/);
  await writeFile(preparation.approved_plan.snapshot_path, savedPlan, "utf8");
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
  const briefRequestPath = resolve(requests, "assignment-brief.json");
  await writeFile(briefRequestPath, `${JSON.stringify({
    assignment_id: reporting.route.assignment.assignment_id,
    outcome: "Deliver the approved assignment.",
    scope: ["Complete the bounded work."],
    acceptance_criteria: ["Return verified evidence."],
    constraints: [],
    reasons: [],
  })}\n`, "utf8");
  const briefResult = runCli([
    "assignment", "brief", "--assignment-id", reporting.route.assignment.assignment_id,
    "--file", briefRequestPath, "--json",
  ], { cwd: root });
  assertSuccess(briefResult, "coordinator assignment brief");
  const brief = JSON.parse(briefResult.stdout);
  assert.match(brief.text, /Approved plan snapshot \(source: [^)]+\): \[open the approved plan\]\(<\//);
  assert.doesNotMatch(brief.text, new RegExp(preparation.approved_plan.digest));
  assert.doesNotMatch(brief.text, /checksum|authenticate.*bytes|plan hash/i);
  await stat(resolve(
    commonDir,
    "codex-flow",
    "report-locators",
    "records",
    `${sha256(coordinatorThreadId)}.json`,
  ));

  const localStartPath = resolve(requests, "workflow-local-start.json");
  await writeFile(localStartPath, `${JSON.stringify({
    run_id: runId,
    plan_id: request.workflow.plan_id,
    task_id: local.task_id,
    dependency_authorities: [],
  })}\n`, "utf8");
  const localStarted = spawnSync(process.execPath, [
    runtimeCli,
    "workflow", "local", "start", "--run-id", runId,
    "--file", localStartPath, "--json",
  ], {
    cwd: root,
    env: { ...process.env, CODEX_THREAD_ID: coordinatorThreadId },
    encoding: "utf8",
  });
  assertSuccess(localStarted, "connected CLI local A start");
  const localWork = JSON.parse(localStarted.stdout);
  await mkdir(resolve(root, "audit-sentinel"), { recursive: true });
  await writeFile(resolve(root, local.write_paths[0]), localAContent, "utf8");
  execFileSync("git", ["add", local.write_paths[0]], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "test: connected CLI local A"], { cwd: root });
  const localCompletePath = resolve(requests, "workflow-local-complete.json");
  await writeFile(localCompletePath, `${JSON.stringify({
    run_id: runId,
    local_work_id: localWork.local_work_id,
    checks: [{
      check_id: "connected-cli-local-a",
      argv: [process.execPath, "-e", "require('fs').accessSync('audit-sentinel/cli-v09-local.txt')"],
    }],
  })}\n`, "utf8");
  const localCompleted = spawnSync(process.execPath, [
    runtimeCli,
    "workflow", "local", "complete", "--run-id", runId,
    "--file", localCompletePath, "--json",
  ], {
    cwd: root,
    env: { ...process.env, CODEX_THREAD_ID: coordinatorThreadId },
    encoding: "utf8",
  });
  assertSuccess(localCompleted, "connected CLI local A completion");
  const completedLocalWork = JSON.parse(localCompleted.stdout);
  assert.equal(completedLocalWork.state, "completed");

  const contractRequestPath = resolve(requests, "workflow-contract.json");
  await writeFile(contractRequestPath, `${JSON.stringify({
    run_id: runId,
    plan_id: request.workflow.plan_id,
    task_id: task.task_id,
    dependency_authorities: [{
      authority_kind: "coordinator-work",
      authority_id: localWork.local_work_id,
    }],
  })}\n`, "utf8");
  const contracted = runCli([
    "workflow", "contract", "--run-id", runId, "--file", contractRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(contracted, "workflow task contract");
  const contract = JSON.parse(contracted.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(contract.accepted_dependencies[0].authority_id, localWork.local_work_id);
  assert.notEqual(
    execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: root, encoding: "utf8" }).trim(),
    baseline,
    "Keep primary behind the coordinator so branch-selector mistakes remain observable",
  );
  const requestedSelectors = {
    project_id: "fixture-project",
    model: task.model,
    reasoning_effort: task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: coordinatorBranch,
      executor_branch: "codex/cli-v09-visible",
      path: null,
    },
  };
  const launchRequestPath = resolve(requests, "task-launch.json");
  await writeFile(launchRequestPath, `${JSON.stringify({
    run_id: runId,
    task_contract: contract,
    requested_selectors: requestedSelectors,
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
  const hostRequest = JSON.parse(attempted.stdout).host_request;
  assert.equal(hostRequest.title, canonicalExecutorTitle);
  assert.equal(hostRequest.target.environment.startingState.type, "branch");
  const startingBranch = hostRequest.target.environment.startingState.branchName;
  assert.equal(startingBranch, coordinatorBranch);

  // Rehearse the explicit v0.9.12 trial guard, not a production preflight claim.
  // A native host must honor the emitted branch instead of substituting baseline.
  const assertStartingBaseline = (branch) => assert.equal(
    execFileSync("git", ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], {
      cwd: root, encoding: "utf8",
    }).trim(),
    contract.current_baseline.revision,
    "Emitted starting branch must match the contracted baseline before host creation",
  );
  const inventoryBeforeGuard = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root, encoding: "utf8",
  });
  assert.throws(() => assertStartingBaseline("main"), /Emitted starting branch must match/);
  assert.equal(execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root, encoding: "utf8",
  }), inventoryBeforeGuard, "Wrong-branch preflight creates no host worktree");
  assertStartingBaseline(startingBranch);

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
    commonDir,
    iterationId: assignment.iteration_id,
  });
  const executor = iteration.members.find((member) => member.role === "executor");
  assert.equal(executor.requested_title, canonicalExecutorTitle);
  assert.equal(executor.provisional_id, "client-new-thread:cli-v09-executor");
  const originalMemberId = executor.member_id;
  const originalRegisteredAt = executor.registered_at;
  const originalAuthorityDigest = executor.authority.authority_digest;
  const originalCreationObservedAt = JSON.parse(reconciled.stdout).creation_evidence.observed_at;
  const executorPath = resolve(root, `../${basename(root)}-cli-v09-executor`);
  assertStartingBaseline(startingBranch);
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", executorPath, startingBranch], { cwd: root });
  t.after(() => {
    spawnSync("git", ["worktree", "remove", "--force", executorPath], { cwd: primary });
  });
  const started = spawnSync(process.execPath, [
    runtimeCli,
    "task", "launch", "start",
    "--run-id", runId,
    "--launch-id", launch.launch_id,
    "--nonce", launch.launch_nonce,
    "--json",
  ], {
    cwd: executorPath,
    env: { ...process.env, CODEX_THREAD_ID: "cli-v09-executor" },
    encoding: "utf8",
  });
  assertSuccess(started, "assignment-bound task launch start");
  const replayed = runCli([
    "task", "launch", "reconcile", "--run-id", runId, "--file", reconcileRequestPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(replayed, "assignment-bound task launch reconciliation replay");
  assert.equal(JSON.parse(replayed.stdout).creation_evidence.observed_at, originalCreationObservedAt);
  const promoted = await iterationStatus({
    commonDir,
    iterationId: assignment.iteration_id,
  });
  const promotedExecutor = promoted.members.find((member) => member.role === "executor");
  assert.equal(promoted.members.filter((member) => member.role === "executor").length, 1);
  assert.equal(promotedExecutor.member_id, originalMemberId);
  assert.equal(promotedExecutor.registered_at, originalRegisteredAt);
  assert.equal(promotedExecutor.authority.authority_digest, originalAuthorityDigest);
  assert.equal(promotedExecutor.thread_id, "cli-v09-executor");
  assert.equal(promotedExecutor.provisional_id, null);
  const assignmentStatus = runCli([
    "assignment", "status", "--assignment-id", assignment.assignment_id, "--json",
  ], { cwd: root });
  assertSuccess(assignmentStatus, "assignment launch projection status");
  assert.equal(
    JSON.parse(assignmentStatus.stdout).iteration_launch_projections[0].publication,
    "current",
  );

  const committedLocalA = await readFile(resolve(executorPath, local.write_paths[0]), "utf8");
  assert.equal(committedLocalA, localAContent);
  await writeFile(
    resolve(executorPath, task.write_paths[0]),
    `${visibleBPrefix}${committedLocalA}`,
    "utf8",
  );
  execFileSync("git", ["add", task.write_paths[0]], { cwd: executorPath });
  execFileSync("git", ["commit", "--quiet", "-m", "test: connected CLI visible B"], {
    cwd: executorPath,
  });
  const executorTip = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: executorPath,
    encoding: "utf8",
  }).trim();
  const startReplay = spawnSync(process.execPath, [
    runtimeCli,
    "task", "launch", "start",
    "--run-id", runId,
    "--launch-id", launch.launch_id,
    "--nonce", launch.launch_nonce,
    "--json",
  ], {
    cwd: executorPath,
    env: { ...process.env, CODEX_THREAD_ID: "cli-v09-executor" },
    encoding: "utf8",
  });
  assertSuccess(startReplay, "assignment-bound task launch start replay after work");
  assert.equal(JSON.parse(startReplay.stdout).activation_performed, false);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: executorPath,
    encoding: "utf8",
  }).trim(), executorTip);

  const receipt = terminalReceiptV4({
    baseline,
    contract,
    coordinator: request.runtime.lineage,
    executorBranch: requestedSelectors.worktree.executor_branch,
    executorThreadId: "cli-v09-executor",
    launch,
    requestedSelectors,
  }, {
    kind: "clean-commit",
    baseline_revision: baseline,
    commit: executorTip,
    branch: requestedSelectors.worktree.executor_branch,
    upstream: null,
    cleanliness: "clean",
  }, { completedAt: new Date().toISOString() });
  const callbackDeliverPath = resolve(requests, "callback-deliver.json");
  await writeFile(callbackDeliverPath, `${JSON.stringify({ run_id: runId, receipt })}\n`, "utf8");
  const deliveredCall = spawnSync(process.execPath, [
    runtimeCli,
    "callback", "deliver", "--run-id", runId,
    "--file", callbackDeliverPath, "--json",
  ], {
    cwd: executorPath,
    env: { ...process.env, CODEX_THREAD_ID: "cli-v09-executor" },
    encoding: "utf8",
  });
  assertSuccess(deliveredCall, "connected CLI executor callback delivery");
  const delivered = JSON.parse(deliveredCall.stdout);
  const callbackObservePath = resolve(requests, "callback-observe.json");
  await writeFile(callbackObservePath, `${JSON.stringify({
    run_id: runId,
    callback_id: delivered.callback_id,
    recipient: request.runtime.lineage,
  })}\n`, "utf8");
  const observedCall = spawnSync(process.execPath, [
    runtimeCli,
    "callback", "observe", "--run-id", runId,
    "--file", callbackObservePath, "--json",
  ], {
    cwd: root,
    env: { ...process.env, CODEX_THREAD_ID: coordinatorThreadId },
    encoding: "utf8",
  });
  assertSuccess(observedCall, "connected CLI callback observation");

  const dispositionPreparePath = resolve(requests, "disposition-prepare.json");
  await writeFile(dispositionPreparePath, `${JSON.stringify({
    run_id: runId,
    callback_id: delivered.callback_id,
    decision: "accepted-for-integration",
    reason: "The dependent visible task returned one clean commit.",
  })}\n`, "utf8");
  const dispositionCall = spawnSync(process.execPath, [
    runtimeCli,
    "disposition", "prepare", "--run-id", runId,
    "--file", dispositionPreparePath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(dispositionCall, "connected CLI disposition preparation");
  const disposition = JSON.parse(dispositionCall.stdout);

  const integrationPreparePath = resolve(requests, "integration-prepare.json");
  await writeFile(integrationPreparePath, `${JSON.stringify({
    run_id: runId,
    disposition_id: disposition.disposition_id,
    main_branch: coordinatorBranch,
  })}\n`, "utf8");
  const integrationCall = spawnSync(process.execPath, [
    runtimeCli,
    "integration", "prepare", "--run-id", runId,
    "--file", integrationPreparePath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(integrationCall, "connected CLI integration preparation");
  const integration = JSON.parse(integrationCall.stdout);
  execFileSync("git", ["merge", "--ff-only", "--quiet", requestedSelectors.worktree.executor_branch], {
    cwd: root,
  });
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(), executorTip);

  const verificationRequestPath = resolve(requests, "integration-verification-request.json");
  await writeFile(verificationRequestPath, `${JSON.stringify({
    run_id: runId,
    integration_id: integration.integration_id,
  })}\n`, "utf8");
  const verificationRequestCall = spawnSync(process.execPath, [
    runtimeCli,
    "integration", "verification-request", "--run-id", runId,
    "--file", verificationRequestPath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(verificationRequestCall, "connected CLI integration verification request");
  const verificationRequest = JSON.parse(verificationRequestCall.stdout);
  const verificationRunPath = resolve(requests, "verification-run.json");
  await writeFile(verificationRunPath, `${JSON.stringify({
    run_id: runId,
    receipt: verificationRequest.receipt,
    integration_scope: verificationRequest.integration_scope,
    checks: [{
      check_id: "connected-cli-visible-b",
      argv: [process.execPath, "-e", "require('fs').accessSync('audit-sentinel/cli-v09.txt')"],
    }],
  })}\n`, "utf8");
  const verificationCall = spawnSync(process.execPath, [
    runtimeCli,
    "verification", "run", "--run-id", runId,
    "--file", verificationRunPath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(verificationCall, "connected CLI integrated verification");
  const verification = JSON.parse(verificationCall.stdout);
  assert.equal(verification.classification, "PASS");
  const integrationReconcilePath = resolve(requests, "integration-reconcile.json");
  await writeFile(integrationReconcilePath, `${JSON.stringify({
    run_id: runId,
    integration_id: integration.integration_id,
    verification_id: verification.verification_id,
  })}\n`, "utf8");
  const integrationReconcileCall = spawnSync(process.execPath, [
    runtimeCli,
    "integration", "reconcile", "--run-id", runId,
    "--file", integrationReconcilePath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(integrationReconcileCall, "connected CLI integration reconciliation");
  assert.equal(JSON.parse(integrationReconcileCall.stdout).outcome, "ancestor");

  const dispositionFinalizePath = resolve(requests, "disposition-finalize.json");
  await writeFile(dispositionFinalizePath, `${JSON.stringify({
    run_id: runId,
    disposition_id: disposition.disposition_id,
    recipient: request.runtime.lineage,
    executor_thread_id: "cli-v09-executor",
    integration_id: integration.integration_id,
    verification_id: verification.verification_id,
  })}\n`, "utf8");
  const finalizedCall = spawnSync(process.execPath, [
    runtimeCli,
    "disposition", "finalize", "--run-id", runId,
    "--file", dispositionFinalizePath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(finalizedCall, "connected CLI disposition finalization");
  assert.equal(JSON.parse(finalizedCall.stdout).state, "completed");

  const closeoutPath = resolve(requests, "assignment-closeout.json");
  await writeFile(closeoutPath, `${JSON.stringify({
    assignment_id: assignment.assignment_id,
    phase: "coordinator",
    task_observation: activeTaskObservation("cli-v09-executor"),
  })}\n`, "utf8");
  const closeoutCall = runCli([
    "assignment", "closeout", "--assignment-id", assignment.assignment_id,
    "--file", closeoutPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(closeoutCall, "connected CLI executor owning-host closeout preparation");
  const closeout = JSON.parse(closeoutCall.stdout);
  assert.equal(closeout.status, "host-action-required");
  await writeFile(closeoutPath, `${JSON.stringify({
    assignment_id: assignment.assignment_id,
    phase: "coordinator",
    task_observation: archivedTaskObservation("cli-v09-executor"),
    host_result: {
      attempt_id: closeout.host_request.attempt_id,
      thread_id: closeout.host_request.thread_id,
      outcome: "accepted",
    },
  })}\n`, "utf8");
  const closedOutCall = runCli([
    "assignment", "closeout", "--assignment-id", assignment.assignment_id,
    "--file", closeoutPath, "--json",
  ], { cwd: root, env: { CODEX_THREAD_ID: coordinatorThreadId } });
  assertSuccess(closedOutCall, "connected CLI executor owning-host closeout reconciliation");
  const closedOut = JSON.parse(closedOutCall.stdout);
  assert.equal(closedOut.status, "phase-complete");
  await assert.rejects(stat(executorPath), /ENOENT/);
  assert.equal(execFileSync("git", ["branch", "--list", requestedSelectors.worktree.executor_branch], {
    cwd: root,
    encoding: "utf8",
  }).trim(), "");

  const coordinatorFinal = await captureStopReport({
    event: {
      hook_event_name: "Stop",
      session_id: coordinatorThreadId,
      turn_id: "cli-v09-coordinator-final",
      last_assistant_message: "Connected CLI A/B delivery is complete.",
    },
    route: reporting.route,
    stateRoot: reporting.state_root,
    nativeQueue: nativeQueue(),
    submit: async () => ({
      outcome: "accepted",
      queued_submission_id: "cli-v09-coordinator-report",
      queue_attempted: true,
      diagnostics: {},
    }),
  });
  assert.equal(coordinatorFinal.status, "submitted");
  const acceptPath = resolve(requests, "assignment-accept.json");
  await writeFile(acceptPath, `${JSON.stringify({
    assignment_id: assignment.assignment_id,
    report_id: coordinatorFinal.report_id,
    task_observation: activeTaskObservation(coordinatorThreadId),
  })}\n`, "utf8");
  const prematureAccept = runCli([
    "assignment", "accept", "--assignment-id", assignment.assignment_id,
    "--file", acceptPath, "--json",
  ], { cwd: primary, env: { CODEX_THREAD_ID: preparationRequest.recipient.thread_id } });
  assertSuccess(prematureAccept, "connected CLI premature director acceptance");
  const prematureAcceptance = JSON.parse(prematureAccept.stdout);
  assert.equal(prematureAcceptance.status, "closeout-pending");
  assert.equal(prematureAcceptance.reason, "execution-terminal-required");
  assert.equal(prematureAcceptance.assignment.state, "accepted");
  const prematureStatusCall = runCli([
    "assignment", "status", "--assignment-id", assignment.assignment_id, "--json",
  ], { cwd: primary });
  assertSuccess(prematureStatusCall, "connected CLI premature acceptance status");
  const prematureStatus = JSON.parse(prematureStatusCall.stdout);
  assert.equal(prematureStatus.assignment.state, "accepted");
  assert.equal(prematureStatus.locator.status, "active");

  const auditCall = spawnSync(process.execPath, [
    runtimeCli, "run", "audit", "--run-id", runId, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(auditCall, "connected CLI run audit");
  const audit = JSON.parse(auditCall.stdout).audit;
  assert.equal(audit.terminal_ready, true, JSON.stringify(audit.blockers));
  assert.equal(audit.counts.coordinator_work, 1);
  assert.equal(audit.counts.task_launches, 1);
  assert.equal(audit.counts.callbacks, 1);
  assert.equal(audit.counts.dispositions, 1);
  assert.equal(audit.counts.integrations, 1);
  assert.equal(audit.counts.verifications, 1);
  assert.equal(audit.counts.archives, 1);
  const closeRunPath = resolve(requests, "run-close.json");
  await writeFile(closeRunPath, `${JSON.stringify({
    run_id: runId,
    resume: result.run.binding,
    audit_id: audit.audit_id,
  })}\n`, "utf8");
  const runClosedCall = spawnSync(process.execPath, [
    runtimeCli,
    "run", "close", "--run-id", runId,
    "--file", closeRunPath, "--json",
  ], { cwd: root, encoding: "utf8" });
  assertSuccess(runClosedCall, "connected CLI run closure");
  execFileSync("git", ["merge", "--ff-only", "--quiet", coordinatorBranch], { cwd: primary });

  await writeFile(acceptPath, `${JSON.stringify({
    assignment_id: assignment.assignment_id,
    report_id: coordinatorFinal.report_id,
    task_observation: archivedTaskObservation(coordinatorThreadId),
  })}\n`, "utf8");
  const acceptedCall = runCli([
    "assignment", "accept", "--assignment-id", assignment.assignment_id,
    "--file", acceptPath, "--json",
  ], { cwd: primary, env: { CODEX_THREAD_ID: preparationRequest.recipient.thread_id } });
  assertSuccess(acceptedCall, "connected CLI director acceptance and locator retirement");
  const accepted = JSON.parse(acceptedCall.stdout);
  assert.equal(accepted.status, "retired");
  assert.equal(accepted.locator_retirement.status, "retired");

  const successorThreadId = "cli-v09-successor";
  await writeFile(resolve(primary, ".git", "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: successorThreadId,
  })}\n`, "utf8");
  const successor = localTask();
  successor.task_id = "cli-v09-successor-local";
  successor.title = "Complete useful successor work";
  successor.write_paths = [];
  successor.shared_resources = [];
  successor.mode = "read";
  const successorRunId = "cli-v09-successor-run";
  const successorActivationPath = resolve(requests, "successor-activation.json");
  await writeFile(successorActivationPath, `${JSON.stringify({
    run_id: successorRunId,
    activated_at: new Date().toISOString(),
    runtime: {
      config: { config_id: "cli-v09-successor-config", snapshot: { project_id: "fixture-project" } },
      policy: { policy_id: "cli-v09-successor-policy", snapshot: { routine_callbacks: "journal" } },
      host: { host_id: "local", session_id: "cli-v09-successor-session" },
      lineage: { lineage_id: "cli-v09-successor-lineage", thread_id: successorThreadId, generation: 1 },
    },
    workflow: {
      schema_version: 1,
      plan_id: "cli-v09-successor-plan",
      revision: 1,
      parent_revision_digest: null,
      tasks: [successor],
    },
    fences: { branch_fences: [] },
  })}\n`, "utf8");
  const successorActivationCall = runCli([
    "run", "activate", "--run-id", successorRunId,
    "--file", successorActivationPath, "--json",
  ], { cwd: primary, env: { CODEX_THREAD_ID: successorThreadId } });
  assertSuccess(successorActivationCall, "connected CLI successor activation");
  const successorActivation = JSON.parse(successorActivationCall.stdout);
  const successorRuntimeCli = resolve(successorActivation.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const successorPreparationPath = resolve(requests, "successor-preparation.json");
  await writeFile(successorPreparationPath, `${JSON.stringify({
    approved_plan_path: successorActivationPath,
    recipient: preparationRequest.recipient,
    iteration_label: "CLI v0.9 successor",
    purpose: "Prove useful successor admission",
    outcome: "Start and complete one successor operation.",
    scope: ["Complete the successor local task."],
    acceptance_criteria: ["The public successor local-work result is completed."],
    constraints: [],
    reasons: [],
  })}\n`, "utf8");
  const successorPreparationCall = runCli([
    "assignment", "prepare", "--file", successorPreparationPath, "--json",
  ], { cwd: primary, env: { CODEX_THREAD_ID: preparationRequest.recipient.thread_id } });
  assertSuccess(successorPreparationCall, "connected CLI successor assignment preparation");
  const successorPreparation = JSON.parse(successorPreparationCall.stdout).preparation;
  const successorRoutePath = resolve(requests, "successor-route.json");
  await writeFile(successorRoutePath, `${JSON.stringify({
    run_id: successorRunId,
    sender_thread_id: successorThreadId,
    preparation_id: successorPreparation.preparation_id,
  })}\n`, "utf8");
  const successorRegistrationCall = spawnSync(process.execPath, [
    successorRuntimeCli,
    "report", "route", "coordinator", "--run-id", successorRunId,
    "--file", successorRoutePath, "--json",
  ], {
    cwd: primary,
    env: { ...process.env, CODEX_THREAD_ID: successorThreadId },
    encoding: "utf8",
  });
  assertSuccess(successorRegistrationCall, "connected CLI successor registration");
  assert.equal(JSON.parse(successorRegistrationCall.stdout).assignment.state, "open");
  const successorStartPath = resolve(requests, "successor-local-start.json");
  await writeFile(successorStartPath, `${JSON.stringify({
    run_id: successorRunId,
    plan_id: "cli-v09-successor-plan",
    task_id: successor.task_id,
    dependency_authorities: [],
  })}\n`, "utf8");
  const successorStartedCall = spawnSync(process.execPath, [
    successorRuntimeCli,
    "workflow", "local", "start", "--run-id", successorRunId,
    "--file", successorStartPath, "--json",
  ], {
    cwd: primary,
    env: { ...process.env, CODEX_THREAD_ID: successorThreadId },
    encoding: "utf8",
  });
  assertSuccess(successorStartedCall, "connected CLI useful successor start");
  const successorWork = JSON.parse(successorStartedCall.stdout);
  const successorCompletePath = resolve(requests, "successor-local-complete.json");
  await writeFile(successorCompletePath, `${JSON.stringify({
    run_id: successorRunId,
    local_work_id: successorWork.local_work_id,
    checks: [{
      check_id: "successor-preserved-a-b-relationship",
      argv: [
        process.execPath,
        "-e",
        "const fs=require('node:fs');const a=fs.readFileSync(process.argv[1],'utf8');const b=fs.readFileSync(process.argv[2],'utf8');if(a!==process.argv[3]||b!==process.argv[4]+a)process.exit(1)",
        local.write_paths[0],
        task.write_paths[0],
        localAContent,
        visibleBPrefix,
      ],
    }],
  })}\n`, "utf8");
  const successorCompletedCall = spawnSync(process.execPath, [
    successorRuntimeCli,
    "workflow", "local", "complete", "--run-id", successorRunId,
    "--file", successorCompletePath, "--json",
  ], {
    cwd: primary,
    env: { ...process.env, CODEX_THREAD_ID: successorThreadId },
    encoding: "utf8",
  });
  assertSuccess(successorCompletedCall, "connected CLI useful successor completion");
  assert.equal(JSON.parse(successorCompletedCall.stdout).state, "completed");
});
