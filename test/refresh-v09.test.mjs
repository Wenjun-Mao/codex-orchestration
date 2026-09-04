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
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyRefresh,
  observeRefreshPrivateArchives,
  refreshStatus,
} from "../lib/compat/refresh.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

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

async function copyCurrentPackage() {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v09-target-package-"));
  for (const path of ["bin", "lib", "schemas", "skills", "templates", ".codex-plugin"]) {
    await cp(resolve(packageRoot, path), resolve(root, path), { recursive: true });
  }
  await cp(resolve(packageRoot, "package.json"), resolve(root, "package.json"));
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
  return { activated, request, runtimeCli };
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
  assert.equal(activated.state_authority.namespace, "v0.9.0-rc.2");
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
  assert.match(inspection.reason, /Earlier source run is not cleanup-complete/);
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
