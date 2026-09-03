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
import { deliverCallbackV07, observeCallbackV07 } from "../lib/callbacks-v07.mjs";
import { prepareTaskArchive, reconcileTaskArchive } from "../lib/archive-lifecycle.mjs";
import { finalizeTaskDisposition, prepareTaskDisposition } from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "../lib/integration-v07.mjs";
import { applyRefresh, refreshStatus } from "../lib/refresh-v08.mjs";
import { loadRefreshSourceAuthority } from "../lib/refresh-source-v08.mjs";
import { runCombinedVerification } from "../lib/verifications-v07.mjs";
import { terminalReceipt } from "./v07-lifecycle-fixture.mjs";
import {
  assertSuccess,
  createGitFixture,
  packageRoot,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function sourceTask(overrides = {}) {
  return {
    task_id: "source-discard",
    title: "Implement the bounded refresh candidate",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Terra-xhigh is selected for the source multi-module implementation.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["audit-sentinel/refresh.txt"],
    shared_resources: ["refresh-resource"],
    primary_outcome: "Complete the bounded refresh candidate.",
    causal_question: "Can the candidate complete under its immutable source runtime?",
    cheapest_safe_direct_attempt: "Implement the candidate once in its isolated executor worktree.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

function activationRequest({
  runId,
  task,
  tasks = null,
  lineageId,
  threadId,
  branch,
  branchFences = null,
  resourceFences = null,
  refreshId = null,
}) {
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
      tasks: tasks ?? [task],
    },
    fences: {
      path_fences: ["audit-sentinel"],
      resource_fences: resourceFences ?? ["refresh-resource"],
      branch_fences: branchFences ?? [branch],
    },
  };
}

async function jsonFile(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

function invoke(cli, args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
}

async function copyTargetPackage(version) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v08-target-"));
  for (const path of ["bin", "lib", "schemas", "skills", "templates", ".codex-plugin"]) {
    await cp(resolve(packageRoot, path), resolve(root, path), { recursive: true });
  }
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  packageJson.version = version;
  await writeFile(resolve(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  const pluginJson = JSON.parse(await readFile(resolve(root, ".codex-plugin", "plugin.json"), "utf8"));
  pluginJson.version = version;
  await writeFile(resolve(root, ".codex-plugin", "plugin.json"), `${JSON.stringify(pluginJson, null, 2)}\n`, "utf8");
  const corePath = resolve(root, "lib", "core.mjs");
  const core = await readFile(corePath, "utf8");
  await writeFile(
    corePath,
    core.replace(/export const PACKAGE_VERSION = "[^"]+";/, `export const PACKAGE_VERSION = "${version}";`),
    "utf8",
  );
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

async function copyTaggedPackage(tag) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v08-tagged-"));
  const archive = resolve(root, "source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, tag], { cwd: packageRoot });
  execFileSync("tar", ["-xf", archive, "-C", root]);
  await rm(archive);
  return { root, cli: resolve(root, "bin", "codex-flow.mjs") };
}

async function allowForwardCreationField(packageCopy) {
  const validatorPath = resolve(packageCopy.root, "lib", "task-creation-v07.mjs");
  const source = await readFile(validatorPath, "utf8");
  const marker = "export function validateVisibleTaskCreationRecord(value) {\n  requireExactFields(value, {";
  assert.ok(source.includes(marker));
  await writeFile(validatorPath, source.replace(marker, [
    "export function validateVisibleTaskCreationRecord(value) {",
    "  const { source_only_forward_field: ignoredForwardField, ...compatibleValue } = value;",
    "  value = compatibleValue;",
    "  requireExactFields(value, {",
  ].join("\n")), "utf8");
}

async function rejectTargetCreationValidation(packageCopy) {
  const validatorPath = resolve(packageCopy.root, "lib", "task-creation-v07.mjs");
  const source = await readFile(validatorPath, "utf8");
  const marker = "export function validateVisibleTaskCreationRecord(value) {";
  assert.ok(source.includes(marker));
  await writeFile(validatorPath, source.replace(
    marker,
    `${marker}\n  throw new Error("target validator must not parse exact-v0.7.8 source records");`,
  ), "utf8");
}

async function consumeTargetRefreshDirect({ targetPackage, root, activation, refreshId, crashAfter }) {
  const driver = resolve(targetPackage.root, "refresh-consume-test-driver.mjs");
  await cp(resolve(packageRoot, "test", "fixtures", "refresh-consume-test-driver.mjs"), driver);
  const result = spawnSync(process.execPath, [driver], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    input: JSON.stringify({
      package_root: targetPackage.root,
      repository_root: root,
      activation,
      refresh_id: refreshId,
      crash_after: crashAfter,
    }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return JSON.parse(result.stdout);
}

async function createSourceExecutor({
  root,
  requests,
  worktree,
  task = sourceTask(),
  tasks = null,
  sourceCli = resolve(packageRoot, "bin", "codex-flow.mjs"),
}) {
  const sourceBranch = "codex/refresh-source-discard";
  const coordinatorThread = "long-lived-refresh-coordinator";
  const activation = activationRequest({
    runId: "refresh-source-run",
    task,
    tasks,
    lineageId: "refresh-source-lineage",
    threadId: coordinatorThread,
    branch: sourceBranch,
    branchFences: tasks === null ? null : [sourceBranch, "codex/refresh-source-discarded"],
    resourceFences: tasks === null ? null : tasks.flatMap((entry) => entry.shared_resources),
  });
  const activationPath = await jsonFile(requests, "source-activation", activation);
  const activated = invoke(sourceCli, [
    "run", "activate", "--run-id", activation.run_id, "--file", activationPath, "--json",
  ], root);
  assertSuccess(activated, "source activation");
  const activatedRecord = JSON.parse(activated.stdout);
  const runtimeCli = resolve(activatedRecord.runtime_authority.bundle_root, "bin", "codex-flow.mjs");

  const contractPath = await jsonFile(requests, "source-contract", {
    run_id: activation.run_id,
    plan_id: activation.workflow.plan_id,
    task_id: activation.workflow.tasks[0].task_id,
    dependency_authorities: [],
  });
  const contracted = invoke(runtimeCli, [
    "workflow", "contract", "--run-id", activation.run_id, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contracted, "source contract");
  const contract = JSON.parse(contracted.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const requestedSelectors = {
    project_id: "refresh-project",
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: sourceBranch,
      path: null,
    },
  };
  const preparePath = await jsonFile(requests, "source-create-prepare", {
    run_id: activation.run_id,
    task_contract: contract,
    requested_selectors: requestedSelectors,
  });
  const prepared = invoke(runtimeCli, [
    "task", "create", "prepare", "--run-id", activation.run_id, "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "source task preparation");
  const creation = JSON.parse(prepared.stdout);
  const attemptPath = await jsonFile(requests, "source-create-attempt", {
    run_id: activation.run_id,
    operation_id: creation.operation_id,
    host_session_id: "refresh-source-host-session",
    timeout_seconds: 300,
  });
  const attempted = invoke(runtimeCli, [
    "task", "create", "attempt", "--run-id", activation.run_id, "--file", attemptPath, "--json",
  ], root);
  assertSuccess(attempted, "source task attempt");
  const attempt = JSON.parse(attempted.stdout);
  execFileSync("git", ["worktree", "add", "--detach", worktree, baseline], { cwd: root });
  const observedPath = await realpath(worktree);
  const observedAt = new Date().toISOString();
  const readyThreadId = "refresh-source-executor-task";
  const reconcilePath = await jsonFile(requests, "source-create-reconcile", {
    run_id: activation.run_id,
    operation_id: creation.operation_id,
    outcome: "ready",
    ready_thread_id: readyThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: "refresh-source-initial-turn",
      turn_index: 1,
      role: "user",
      content: attempt.host_request.prompt,
      observed_at: observedAt,
    },
    selector_evidence: {
      accepted: { ...requestedSelectors, accepted_at: observedAt },
      observed: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: { ...requestedSelectors.worktree, path: observedPath },
        observed_at: observedAt,
      },
    },
  });
  const reconciled = invoke(runtimeCli, [
    "task", "create", "reconcile", "--run-id", activation.run_id, "--file", reconcilePath, "--json",
  ], root);
  assertSuccess(reconciled, "source task reconciliation");
  const bindPath = await jsonFile(requests, "source-create-bind", {
    run_id: activation.run_id,
    operation_id: creation.operation_id,
  });
  assertSuccess(invoke(runtimeCli, [
    "task", "create", "bind", "--run-id", activation.run_id, "--file", bindPath, "--json",
  ], root), "source worktree binding");
  const releasePreparePath = await jsonFile(requests, "source-release-prepare", {
    run_id: activation.run_id,
    task_contract: contract,
    operation_id: creation.operation_id,
  });
  const releasePrepared = invoke(runtimeCli, [
    "release", "prepare", "--run-id", activation.run_id, "--file", releasePreparePath, "--json",
  ], root);
  assertSuccess(releasePrepared, "source release preparation");
  const release = JSON.parse(releasePrepared.stdout);
  const releaseReconcilePath = await jsonFile(requests, "source-release-reconcile", {
    run_id: activation.run_id,
    release_id: release.release_id,
    outcome: "sent",
  });
  assertSuccess(invoke(runtimeCli, [
    "release", "reconcile", "--run-id", activation.run_id, "--file", releaseReconcilePath, "--json",
  ], root), "source release reconciliation");
  const releaseAcceptPath = await jsonFile(requests, "source-release-accept", {
    run_id: activation.run_id,
    release_id: release.release_id,
    ready_thread_id: readyThreadId,
    contract_id: contract.contract_id,
    runtime_context_digest: contract.runtime_context_digest,
    common_dir: contract.common_dir,
  });
  assertSuccess(invoke(runtimeCli, [
    "release", "accept", "--run-id", activation.run_id, "--file", releaseAcceptPath, "--json",
  ], worktree), "source release acceptance");
  return {
    activation,
    activated: activatedRecord,
    runtimeCli,
    contract,
    creation,
    release,
    requestedSelectors,
    observedWorktreePath: observedPath,
    baseline,
    sourceBranch,
    coordinatorThread,
    coordinator: activation.runtime.lineage,
    readyThreadId,
  };
}

async function createSourceSiblingExecutor({
  root,
  requests,
  source,
  task,
  sourceBranch,
  worktree,
  readyThreadId,
}) {
  const runId = source.activation.run_id;
  const contractPath = await jsonFile(requests, `${task.task_id}-contract`, {
    run_id: runId,
    plan_id: source.activation.workflow.plan_id,
    task_id: task.task_id,
    dependency_authorities: [],
  });
  const contracted = invoke(source.runtimeCli, [
    "workflow", "contract", "--run-id", runId, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contracted, `${task.task_id} contract`);
  const contract = JSON.parse(contracted.stdout);
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const requestedSelectors = {
    project_id: "refresh-project",
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: sourceBranch,
      path: null,
    },
  };
  const preparePath = await jsonFile(requests, `${task.task_id}-create-prepare`, {
    run_id: runId,
    task_contract: contract,
    requested_selectors: requestedSelectors,
  });
  const prepared = invoke(source.runtimeCli, [
    "task", "create", "prepare", "--run-id", runId, "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, `${task.task_id} task preparation`);
  const creation = JSON.parse(prepared.stdout);
  const attemptPath = await jsonFile(requests, `${task.task_id}-create-attempt`, {
    run_id: runId,
    operation_id: creation.operation_id,
    host_session_id: `${task.task_id}-host-session`,
    timeout_seconds: 300,
  });
  const attempted = invoke(source.runtimeCli, [
    "task", "create", "attempt", "--run-id", runId, "--file", attemptPath, "--json",
  ], root);
  assertSuccess(attempted, `${task.task_id} task attempt`);
  const attempt = JSON.parse(attempted.stdout);
  execFileSync("git", ["worktree", "add", "--detach", worktree, baseline], { cwd: root });
  const observedPath = await realpath(worktree);
  const observedAt = new Date().toISOString();
  const reconcilePath = await jsonFile(requests, `${task.task_id}-create-reconcile`, {
    run_id: runId,
    operation_id: creation.operation_id,
    outcome: "ready",
    ready_thread_id: readyThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: `${task.task_id}-initial-turn`,
      turn_index: 1,
      role: "user",
      content: attempt.host_request.prompt,
      observed_at: observedAt,
    },
    selector_evidence: {
      accepted: { ...requestedSelectors, accepted_at: observedAt },
      observed: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: { ...requestedSelectors.worktree, path: observedPath },
        observed_at: observedAt,
      },
    },
  });
  assertSuccess(invoke(source.runtimeCli, [
    "task", "create", "reconcile", "--run-id", runId, "--file", reconcilePath, "--json",
  ], root), `${task.task_id} task reconciliation`);
  const bindPath = await jsonFile(requests, `${task.task_id}-create-bind`, {
    run_id: runId,
    operation_id: creation.operation_id,
  });
  assertSuccess(invoke(source.runtimeCli, [
    "task", "create", "bind", "--run-id", runId, "--file", bindPath, "--json",
  ], root), `${task.task_id} worktree binding`);
  const releasePreparePath = await jsonFile(requests, `${task.task_id}-release-prepare`, {
    run_id: runId,
    task_contract: contract,
    operation_id: creation.operation_id,
  });
  const releasePrepared = invoke(source.runtimeCli, [
    "release", "prepare", "--run-id", runId, "--file", releasePreparePath, "--json",
  ], root);
  assertSuccess(releasePrepared, `${task.task_id} release preparation`);
  const release = JSON.parse(releasePrepared.stdout);
  const releaseReconcilePath = await jsonFile(requests, `${task.task_id}-release-reconcile`, {
    run_id: runId,
    release_id: release.release_id,
    outcome: "sent",
  });
  assertSuccess(invoke(source.runtimeCli, [
    "release", "reconcile", "--run-id", runId, "--file", releaseReconcilePath, "--json",
  ], root), `${task.task_id} release reconciliation`);
  const releaseAcceptPath = await jsonFile(requests, `${task.task_id}-release-accept`, {
    run_id: runId,
    release_id: release.release_id,
    ready_thread_id: readyThreadId,
    contract_id: contract.contract_id,
    runtime_context_digest: contract.runtime_context_digest,
    common_dir: contract.common_dir,
  });
  assertSuccess(invoke(source.runtimeCli, [
    "release", "accept", "--run-id", runId, "--file", releaseAcceptPath, "--json",
  ], worktree), `${task.task_id} release acceptance`);
  return {
    ...source,
    contract,
    creation,
    release,
    requestedSelectors,
    observedWorktreePath: observedPath,
    baseline,
    sourceBranch,
    readyThreadId,
    worktree,
  };
}

async function integrateExecutorResult({ root, executor }) {
  await writeFile(resolve(executor.observedWorktreePath, "integrated-result.txt"), "integrated\n", "utf8");
  execFileSync("git", ["add", "integrated-result.txt"], { cwd: executor.observedWorktreePath });
  execFileSync("git", ["commit", "--quiet", "-m", "integrated refresh result"], {
    cwd: executor.observedWorktreePath,
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: executor.observedWorktreePath,
    encoding: "utf8",
  }).trim();
  const stateRoot = resolve(executor.contract.common_dir, "codex-flow", "v0.8.0-rc.1");
  const receipt = terminalReceipt(executor, {
    kind: "clean-commit",
    baseline_revision: executor.baseline,
    commit,
    branch: executor.sourceBranch,
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallbackV07({ stateRoot, receipt });
  await observeCallbackV07({
    stateRoot,
    callbackId: delivered.callback_id,
    recipient: {
      lineage_id: executor.coordinator.lineage_id,
      thread_id: executor.coordinator.thread_id,
      generation: executor.coordinator.generation,
    },
  });
  const disposition = await prepareTaskDisposition({
    stateRoot,
    callbackId: delivered.callback_id,
    decision: "accepted-for-integration",
    reason: "The refresh executor result is embodied in the coordinator baseline.",
  });
  const integration = await prepareSerialIntegration({
    stateRoot,
    repositoryPath: root,
    dispositionId: disposition.disposition_id,
    mainBranch: "main",
  });
  execFileSync("git", ["merge", "--ff-only", executor.sourceBranch], { cwd: root });
  const verificationRequest = await integrationVerificationRequest({
    stateRoot,
    repositoryPath: root,
    integrationId: integration.integration_id,
  });
  const verification = await runCombinedVerification({
    stateRoot,
    repositoryPath: root,
    receipt: verificationRequest.receipt,
    integrationScope: verificationRequest.integration_scope,
    checks: [{ check_id: "refresh-integrated-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
  });
  const reconciled = await reconcileSerialIntegration({
    stateRoot,
    repositoryPath: root,
    integrationId: integration.integration_id,
    verificationId: verification.verification_id,
  });
  assert.equal(reconciled.outcome, "ancestor");
  const completedDisposition = await finalizeTaskDisposition({
    stateRoot,
    dispositionId: disposition.disposition_id,
    recipient: executor.coordinator,
    executorThreadId: executor.readyThreadId,
    integrationId: integration.integration_id,
    verificationId: verification.verification_id,
  });
  const archive = await prepareTaskArchive({
    stateRoot,
    dispositionId: completedDisposition.disposition_id,
    taskObservation: {
      execution_kind: "task-thread",
      thread_id: executor.readyThreadId,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
  });
  await reconcileTaskArchive({
    stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
  });
  execFileSync("git", ["worktree", "remove", "--force", executor.observedWorktreePath], { cwd: root });
  const completedArchive = await reconcileTaskArchive({
    stateRoot,
    archiveId: archive.archive_id,
    attemptId: archive.host_intent.attempt_id,
    outcome: "accepted",
    observation: {
      execution_kind: "task-thread",
      thread_id: executor.readyThreadId,
      source: "host-observed",
      active_visible: false,
      archived_visible: true,
    },
  });
  assert.equal(completedArchive.state, "completed");
  return { commit, reconciled, archive: completedArchive };
}

async function createActiveSourceSubagent({ root, requests, sourceCli }) {
  const task = sourceTask({
    task_id: "active-native-subagent",
    title: "Read the refresh source without changing it",
    execution_kind: "subagent",
    mode: "read",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Luna-medium is explicitly selected for this bounded read-only inspection.",
    fork_turns: "3",
    write_paths: [],
    shared_resources: [],
  });
  const activation = activationRequest({
    runId: "refresh-active-subagent-run",
    task,
    lineageId: "refresh-active-subagent-lineage",
    threadId: "refresh-active-subagent-coordinator",
    branch: "codex/refresh-active-subagent",
    resourceFences: [],
  });
  const activationPath = await jsonFile(requests, "active-subagent-activation", activation);
  const activated = invoke(sourceCli, [
    "run", "activate", "--run-id", activation.run_id, "--file", activationPath, "--json",
  ], root);
  assertSuccess(activated, "active subagent source activation");
  const activatedRecord = JSON.parse(activated.stdout);
  const runtimeCli = resolve(activatedRecord.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const contractPath = await jsonFile(requests, "active-subagent-contract", {
    run_id: activation.run_id,
    plan_id: activation.workflow.plan_id,
    task_id: task.task_id,
    dependency_authorities: [],
  });
  const contracted = invoke(runtimeCli, [
    "workflow", "contract", "--run-id", activation.run_id, "--file", contractPath, "--json",
  ], root);
  assertSuccess(contracted, "active subagent contract");
  const contract = JSON.parse(contracted.stdout);
  const preparePath = await jsonFile(requests, "active-subagent-prepare", {
    run_id: activation.run_id,
    task_contract: contract,
    model: task.model,
    reasoning_effort: task.reasoning_effort,
    fork_turns: task.fork_turns,
    mode: task.mode,
    prompt_digest: "a".repeat(64),
    worktree_path: root,
  });
  const prepared = invoke(runtimeCli, [
    "subagent", "prepare", "--run-id", activation.run_id, "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "active subagent operation preparation");
  return { activation, contract, runtimeCli };
}

test("long-lived coordinator refresh discards exact dirty work and consumes a v0.8 source handoff", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v08-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v08-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v08-worktree-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.8");
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));
  const source = await createSourceExecutor({ root, requests, worktree, sourceCli: sourcePackage.cli });
  await writeFile(resolve(worktree, "unintegrated.txt"), "discard me\n", "utf8");
  await mkdir(resolve(worktree, "ignored-output"));
  await writeFile(resolve(worktree, "ignored-output", "artifact.bin"), "generated\n", "utf8");

  await loadRefreshSourceAuthority({
    commonDir: source.contract.common_dir,
    namespace: "v0.8.0-rc.1",
    runId: source.activation.run_id,
  });

  const targetSkill = resolve(targetPackage.root, "skills", "refresh", "SKILL.md");
  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspected, "target refresh inspection");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.run_id, source.activation.run_id);

  const targetBranch = "codex/refresh-target-replacement";
  const targetTask = sourceTask({
    task_id: "target-replacement",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is freshly selected for the bounded replacement implementation.",
  });
  const targetActivation = activationRequest({
    runId: "refresh-target-run",
    task: targetTask,
    lineageId: "refresh-target-lineage",
    threadId: source.coordinatorThread,
    branch: targetBranch,
  });
  const prepareRequest = {
    source_namespace: "v0.8.0-rc.1",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "discard",
      rationale: "This exact executor is unintegrated and its local work is replaceable.",
    }],
    replacements: [{
      source_task_id: source.contract.task_id,
      target_task_id: targetTask.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinatorThread,
  };
  const preparePath = await jsonFile(requests, "refresh-prepare", prepareRequest);
  const prepared = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "refresh preparation");
  const handoff = JSON.parse(prepared.stdout).handoff;
  assert.equal(handoff.state, "prepared");
  assert.equal(handoff.cleanup[0].git_authority.dirty, true);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "model"), false);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "reasoning_effort"), false);

  const archiveEvidence = [{
    archive_intent_id: handoff.cleanup[0].archive_intent_id,
    thread_id: handoff.cleanup[0].thread_id,
    host_id: handoff.cleanup[0].host_id,
    active_visible: false,
    archived_visible: true,
    observed_at: new Date().toISOString(),
  }];
  await assert.rejects(applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [{ ...archiveEvidence[0], thread_id: "wrong-executor-task" }],
    appliedAt: new Date().toISOString(),
  }), /task or host identity drifted/);
  assert.equal((await stat(worktree)).isDirectory(), true);
  const lifecyclePath = resolve(
    source.contract.common_dir,
    "codex-flow",
    "v0.8.0-rc.1",
    "runs",
    "lifecycle.json",
  );
  const originalLifecycle = await readFile(lifecyclePath, "utf8");
  await writeFile(lifecyclePath, `${originalLifecycle}\n`, "utf8");
  await assert.rejects(applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence,
    appliedAt: new Date().toISOString(),
  }), /source state changed after handoff preparation/);
  await writeFile(lifecyclePath, originalLifecycle, "utf8");
  await assert.rejects(
    applyRefresh({
      commonDir: source.contract.common_dir,
      refreshId: handoff.refresh_id,
      expectedHandoffDigest: handoff.handoff_digest,
      archiveEvidence,
      appliedAt: new Date().toISOString(),
      hooks: {
        afterArchiveObserved() {
          throw new Error("simulated crash after archive observation");
        },
      },
    }),
    /simulated crash after archive observation/,
  );
  let interrupted = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(interrupted.status, "archive-observed");
  assert.equal((await stat(worktree)).isDirectory(), true);
  await assert.rejects(
    applyRefresh({
      commonDir: source.contract.common_dir,
      refreshId: handoff.refresh_id,
      expectedHandoffDigest: interrupted.handoff_digest,
      archiveEvidence,
      appliedAt: new Date().toISOString(),
      hooks: {
        afterWorktreeRemoval() {
          throw new Error("simulated crash after worktree removal");
        },
      },
    }),
    /simulated crash/,
  );
  await assert.rejects(stat(worktree), /ENOENT/);
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${source.sourceBranch}`], {
    cwd: root,
  }).status, 0);
  interrupted = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(interrupted.status, "archive-observed");
  await assert.rejects(
    applyRefresh({
      commonDir: source.contract.common_dir,
      refreshId: handoff.refresh_id,
      expectedHandoffDigest: interrupted.handoff_digest,
      archiveEvidence,
      appliedAt: new Date().toISOString(),
      hooks: {
        afterBranchDeletion() {
          throw new Error("simulated crash after branch deletion");
        },
      },
    }),
    /simulated crash after branch deletion/,
  );
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${source.sourceBranch}`], {
    cwd: root,
  }).status, 1);
  interrupted = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(interrupted.status, "archive-observed");
  await assert.rejects(
    applyRefresh({
      commonDir: source.contract.common_dir,
      refreshId: handoff.refresh_id,
      expectedHandoffDigest: interrupted.handoff_digest,
      archiveEvidence,
      appliedAt: new Date().toISOString(),
      hooks: {
        afterSourceRetirement() {
          throw new Error("simulated crash after source retirement");
        },
      },
    }),
    /simulated crash after source retirement/,
  );
  interrupted = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(interrupted.status, "archive-observed");
  let applied;
  try {
    applied = await applyRefresh({
      commonDir: source.contract.common_dir,
      refreshId: handoff.refresh_id,
      expectedHandoffDigest: interrupted.handoff_digest,
      archiveEvidence,
      appliedAt: new Date().toISOString(),
    });
  } catch (error) {
    const lifecycle = await readFile(resolve(
      source.contract.common_dir,
      "codex-flow",
      "v0.8.0-rc.1",
      "runs",
      "lifecycle.json",
    ), "utf8");
    throw new Error(`${error.message}\nsource lifecycle: ${lifecycle}`);
  }
  assert.equal(applied.status, "source-retired");
  assert.ok(
    Date.parse(applied.handoff.updated_at) >= Date.parse(applied.handoff.intent.prepared_at),
    JSON.stringify({
      prepared_at: applied.handoff.intent.prepared_at,
      updated_at: applied.handoff.updated_at,
      retired_at: applied.handoff.source_retirement?.retired_at,
    }),
  );
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${source.sourceBranch}`], {
    cwd: root,
  }).status, 1);

  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  const originPath = resolve(
    root,
    ".git",
    "codex-flow",
    "v0.8.0-rc.8",
    "runs",
    "refresh-origins",
    `${targetActivation.run_id}.json`,
  );
  await assert.rejects(consumeTargetRefreshDirect({
    targetPackage,
    root,
    activation: targetActivation,
    refreshId: handoff.refresh_id,
    crashAfter: "afterTargetAdmission",
  }), /simulated crash at afterTargetAdmission/);
  await assert.rejects(stat(originPath), /ENOENT/);
  await assert.rejects(consumeTargetRefreshDirect({
    targetPackage,
    root,
    activation: targetActivation,
    refreshId: handoff.refresh_id,
    crashAfter: "afterOriginWrite",
  }), /simulated crash at afterOriginWrite/);
  const originalOrigin = await readFile(originPath, "utf8");
  await assert.rejects(consumeTargetRefreshDirect({
    targetPackage,
    root,
    activation: targetActivation,
    refreshId: handoff.refresh_id,
    crashAfter: "afterConsumedWrite",
  }), /simulated crash at afterConsumedWrite/);
  assert.equal(await readFile(originPath, "utf8"), originalOrigin);
  const consumedStatus = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(consumedStatus.status, "consumed");
  await assert.rejects(consumeTargetRefreshDirect({
    targetPackage,
    root,
    activation: targetActivation,
    refreshId: handoff.refresh_id,
    crashAfter: "afterSourceNamespaceRemoval",
  }), /simulated crash at afterSourceNamespaceRemoval/);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "v0.8.0-rc.1")), /ENOENT/);
  assert.equal((await stat(resolve(root, ".git", "codex-flow", "refresh-v1"))).isDirectory(), true);

  const targetActivationPath = await jsonFile(requests, "target-activation", targetActivation);
  const activated = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", targetActivationPath, "--json",
  ], root);
  assertSuccess(activated, "target refresh activation");
  const target = JSON.parse(activated.stdout);
  assert.equal(target.state_authority.namespace, "v0.8.0-rc.8");
  assert.equal(target.refresh_origin.refresh_id, handoff.refresh_id);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "v0.8.0-rc.1")), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "refresh-v1")), /ENOENT/);
  assert.equal((await stat(resolve(root, ".git", "codex-flow", "v0.8.0-rc.8"))).isDirectory(), true);
  const targetLifecyclePath = resolve(
    root,
    ".git",
    "codex-flow",
    "v0.8.0-rc.8",
    "runs",
    "lifecycle.json",
  );
  await rm(targetLifecyclePath);
  const tamperedReplay = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", targetActivationPath, "--json",
  ], root);
  assert.notEqual(tamperedReplay.status, 0);
  assert.match(tamperedReplay.stderr, /already bound|no exact existing target run/);
  await assert.rejects(stat(targetLifecyclePath), /ENOENT/);
});

test("detached coordinator refresh preserves its exact root and normalized branch identity", async (t) => {
  const repositoryRoot = await createGitFixture("codex-flow-refresh-detached-v08-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-detached-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-detached-worktrees-"));
  const coordinatorRoot = resolve(worktreeParent, "coordinator");
  const executorRoot = resolve(worktreeParent, "executor");
  const impostorRoot = resolve(worktreeParent, "same-revision-other-root");
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.7");
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["worktree", "add", "--detach", coordinatorRoot, baseline], { cwd: repositoryRoot });
  const canonicalCoordinatorRoot = await realpath(coordinatorRoot);
  t.after(async () => {
    for (const path of [executorRoot, impostorRoot, coordinatorRoot]) {
      spawnSync("git", ["worktree", "remove", "--force", path], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    }
    await Promise.all([
      rm(requests, { recursive: true, force: true }),
      rm(worktreeParent, { recursive: true, force: true }),
      rm(sourcePackage.root, { recursive: true, force: true }),
      rm(targetPackage.root, { recursive: true, force: true }),
    ]);
    await removeFixture(repositoryRoot);
  });

  const source = await createSourceExecutor({
    root: coordinatorRoot,
    requests,
    worktree: executorRoot,
    sourceCli: sourcePackage.cli,
  });
  await writeFile(resolve(executorRoot, "discard-detached.txt"), "discard me\n", "utf8");
  const targetSkill = resolve(targetPackage.root, "skills", "refresh", "SKILL.md");
  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], coordinatorRoot);
  assertSuccess(inspected, "detached refresh inspection");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.baseline.root, canonicalCoordinatorRoot);
  assert.equal(inspection.authority.source.baseline.branch, "detached");

  const replacement = sourceTask({
    task_id: "detached-target-replacement",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is freshly selected for detached-root identity coverage.",
  });
  const targetActivation = activationRequest({
    runId: "refresh-detached-target-run",
    task: replacement,
    lineageId: "refresh-detached-target-lineage",
    threadId: source.coordinatorThread,
    branch: "codex/refresh-detached-target",
  });
  const preparePath = await jsonFile(requests, "detached-refresh-prepare", {
    source_namespace: "v0.8.0-rc.1",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "discard",
      rationale: "The exact detached-coordinator executor is unintegrated and disposable.",
    }],
    replacements: [{
      source_task_id: source.contract.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinatorThread,
  });
  const prepared = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], coordinatorRoot);
  assertSuccess(prepared, "detached refresh preparation");
  const handoff = JSON.parse(prepared.stdout).handoff;
  assert.equal(handoff.intent.target.baseline.root, canonicalCoordinatorRoot);
  assert.equal(handoff.intent.target.baseline.branch, "detached");
  const applied = await applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [{
      archive_intent_id: handoff.cleanup[0].archive_intent_id,
      thread_id: handoff.cleanup[0].thread_id,
      host_id: handoff.cleanup[0].host_id,
      active_visible: false,
      archived_visible: true,
      observed_at: new Date().toISOString(),
    }],
    appliedAt: new Date().toISOString(),
  });
  assert.equal(applied.status, "source-retired");

  execFileSync("git", ["worktree", "add", "--detach", impostorRoot, baseline], { cwd: repositoryRoot });
  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  const targetActivationPath = await jsonFile(requests, "detached-target-activation", targetActivation);
  const wrongRoot = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", targetActivationPath, "--json",
  ], impostorRoot);
  assert.notEqual(wrongRoot.status, 0);
  assert.match(wrongRoot.stderr, /baseline drifted after refresh preparation/);
  assert.equal((await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  })).status, "source-retired");
});

test("refresh preserves an integrated baseline and reissues only the discarded executor with fresh selectors", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-mixed-v08-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-mixed-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-mixed-worktree-"));
  const integratedWorktree = resolve(worktreeParent, "integrated");
  const discardedWorktree = resolve(worktreeParent, "discarded");
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.2");
  t.after(async () => {
    for (const worktree of [integratedWorktree, discardedWorktree]) {
      spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    }
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));

  const integratedTask = sourceTask({
    task_id: "source-integrated",
    write_paths: ["audit-sentinel/integrated.txt"],
    shared_resources: ["refresh-integrated-resource"],
  });
  const discardedTask = sourceTask({
    task_id: "source-discarded",
    write_paths: ["audit-sentinel/discarded.txt"],
    shared_resources: ["refresh-discarded-resource"],
  });
  const integrated = await createSourceExecutor({
    root,
    requests,
    worktree: integratedWorktree,
    task: integratedTask,
    tasks: [integratedTask, discardedTask],
    sourceCli: sourcePackage.cli,
  });
  const discarded = await createSourceSiblingExecutor({
    root,
    requests,
    source: integrated,
    task: discardedTask,
    sourceBranch: "codex/refresh-source-discarded",
    worktree: discardedWorktree,
    readyThreadId: "refresh-source-discarded-executor",
  });
  const integratedResult = await integrateExecutorResult({ root, executor: integrated });
  await writeFile(resolve(discardedWorktree, "unintegrated.txt"), "discarded\n", "utf8");

  const replacement = sourceTask({
    task_id: "replacement-discarded",
    write_paths: discardedTask.write_paths,
    shared_resources: discardedTask.shared_resources,
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is newly selected for the smaller bounded replacement.",
  });
  const targetActivation = activationRequest({
    runId: "refresh-mixed-target-run",
    task: replacement,
    lineageId: "refresh-mixed-target-lineage",
    threadId: integrated.coordinatorThread,
    branch: "codex/refresh-mixed-replacement",
  });
  const targetSkill = resolve(targetPackage.root, "skills", "refresh", "SKILL.md");
  const integratedDiscardPath = await jsonFile(requests, "refresh-mixed-integrated-discard", {
    source_namespace: "v0.8.0-rc.1",
    source_run_id: integrated.activation.run_id,
    source_resume: integrated.activated.run.binding,
    decisions: [
      {
        source_task_id: integratedTask.task_id,
        disposition: "discard",
        rationale: "This must fail because integration has already been recorded.",
      },
      {
        source_task_id: discardedTask.task_id,
        disposition: "discard",
        rationale: "This executor is still eligible for discard.",
      },
    ],
    replacements: [{
      source_task_id: discardedTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: integrated.coordinatorThread,
  });
  const integratedDiscard = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", integratedDiscardPath, "--json",
  ], root);
  assert.notEqual(integratedDiscard.status, 0);
  assert.match(integratedDiscard.stderr, /integration record can no longer be discarded/);
  const preparePath = await jsonFile(requests, "refresh-mixed-prepare", {
    source_namespace: "v0.8.0-rc.1",
    source_run_id: integrated.activation.run_id,
    source_resume: integrated.activated.run.binding,
    decisions: [
      {
        source_task_id: integratedTask.task_id,
        disposition: "wait",
        rationale: "This result is already durably integrated into the coordinator baseline.",
      },
      {
        source_task_id: discardedTask.task_id,
        disposition: "discard",
        rationale: "This unintegrated executor has only disposable local work.",
      },
    ],
    replacements: [{
      source_task_id: discardedTask.task_id,
      target_task_id: replacement.task_id,
    }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: integrated.coordinatorThread,
  });
  const prepared = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "mixed refresh preparation");
  const handoff = JSON.parse(prepared.stdout).handoff;
  assert.deepEqual(handoff.cleanup.map((entry) => entry.source_task_id), [discardedTask.task_id]);
  assert.deepEqual(handoff.intent.replacements.map((entry) => entry.source_task_id), [discardedTask.task_id]);
  assert.equal(handoff.intent.replacements[0].target_task_id, replacement.task_id);
  assert.equal(handoff.intent.replacements[0].brief.brief_digest.length, 64);
  assert.equal(Object.hasOwn(handoff.intent.replacements[0].brief, "model"), false);
  assert.equal(replacement.model, "gpt-5.6-terra");
  assert.equal(replacement.reasoning_effort, "high");
  assert.match(replacement.selector_rationale, /newly selected/);
  assert.match(await readFile(resolve(root, "integrated-result.txt"), "utf8"), /integrated/);
  assert.equal(
    execFileSync("git", ["merge-base", "--is-ancestor", integratedResult.commit, "HEAD"], { cwd: root }).toString(),
    "",
  );

  const archiveEvidence = [{
    archive_intent_id: handoff.cleanup[0].archive_intent_id,
    thread_id: handoff.cleanup[0].thread_id,
    host_id: handoff.cleanup[0].host_id,
    active_visible: false,
    archived_visible: true,
    observed_at: new Date().toISOString(),
  }];
  await assert.rejects(applyRefresh({
    commonDir: discarded.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence,
    appliedAt: new Date().toISOString(),
  }), /Waited executor cleanup is incomplete/);
  const cleanupBlocked = await refreshStatus({
    commonDir: discarded.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(cleanupBlocked.status, "archive-observed");
  execFileSync("git", ["branch", "-d", integrated.sourceBranch], { cwd: root });
  const applied = await applyRefresh({
    commonDir: discarded.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: cleanupBlocked.handoff_digest,
    archiveEvidence,
    appliedAt: new Date().toISOString(),
  });
  assert.equal(applied.status, "source-retired");
  await assert.rejects(stat(discardedWorktree), /ENOENT/);
  assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/codex/refresh-source-discarded"], {
    cwd: root,
  }).status, 1);
  await assert.rejects(stat(integratedWorktree), /ENOENT/);
  assert.match(await readFile(resolve(root, "integrated-result.txt"), "utf8"), /integrated/);
});

test("all-wait refresh consumes to a clean start without inventing a target run", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-all-wait-v08-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-all-wait-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-all-wait-worktree-"));
  const worktree = resolve(worktreeParent, "integrated");
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.5");
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));

  const source = await createSourceExecutor({ root, requests, worktree, sourceCli: sourcePackage.cli });
  const integrated = await integrateExecutorResult({ root, executor: source });
  assert.match(await readFile(resolve(root, "integrated-result.txt"), "utf8"), /integrated/);
  assert.equal(
    execFileSync("git", ["merge-base", "--is-ancestor", integrated.commit, "HEAD"], { cwd: root }).toString(),
    "",
  );

  const targetSkill = resolve(targetPackage.root, "skills", "refresh", "SKILL.md");
  const baseRequest = {
    source_namespace: "v0.8.0-rc.1",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "wait",
      rationale: "The executor result is integrated, dispositioned, and archived under the source snapshot.",
    }],
    replacements: [],
    target_workflow: null,
    target_fences: { path_fences: [], resource_fences: [], branch_fences: [] },
    target_coordinator_thread_id: source.coordinatorThread,
  };
  const invalidFencePath = await jsonFile(requests, "all-wait-invalid-fence", {
    ...baseRequest,
    target_fences: { path_fences: ["invented"], resource_fences: [], branch_fences: [] },
  });
  const invalidFence = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", invalidFencePath, "--json",
  ], root);
  assert.notEqual(invalidFence.status, 0);
  assert.match(invalidFence.stderr, /must not reserve target fences/);

  const preparePath = await jsonFile(requests, "all-wait-prepare", baseRequest);
  const prepared = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill,
    "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "all-wait refresh preparation");
  const handoff = JSON.parse(prepared.stdout).handoff;
  assert.equal(handoff.intent.target.mode, "no-replacements");
  assert.equal(handoff.intent.target.workflow_plan_id, null);
  assert.equal(handoff.intent.target.workflow_revision_digest, null);
  assert.deepEqual(handoff.intent.replacements, []);
  assert.deepEqual(handoff.cleanup, []);

  await assert.rejects(applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
  }), /Waited executor cleanup is incomplete/);
  const cleanupBlocked = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(cleanupBlocked.status, "archive-observed");
  execFileSync("git", ["branch", "-d", source.sourceBranch], { cwd: root });

  await assert.rejects(applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: cleanupBlocked.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
    hooks: {
      afterConsumedWrite() {
        throw new Error("simulated crash after clean-start consumption");
      },
    },
  }), /simulated crash after clean-start consumption/);
  const consumed = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.target.mode, "no-replacements");
  assert.match(consumed.next_action, /refresh apply/);
  assert.deepEqual(consumed.handoff?.target_consumption, undefined);

  const forbiddenActivation = activationRequest({
    runId: "invented-all-wait-target-run",
    task: sourceTask({ task_id: "invented-all-wait-target" }),
    lineageId: "invented-all-wait-target-lineage",
    threadId: source.coordinatorThread,
    branch: "codex/invented-all-wait-target",
    refreshId: handoff.refresh_id,
  });
  const forbiddenActivationPath = await jsonFile(requests, "all-wait-forbidden-activation", forbiddenActivation);
  const forbidden = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", forbiddenActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", forbiddenActivationPath, "--json",
  ], root);
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /consumed with refresh apply, not run activation/);

  await assert.rejects(applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: consumed.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
    hooks: {
      afterSourceNamespaceRemoval() {
        throw new Error("simulated crash after clean-start source removal");
      },
    },
  }), /simulated crash after clean-start source removal/);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "v0.8.0-rc.1")), /ENOENT/);
  const residue = await refreshStatus({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
  });
  assert.equal(residue.status, "consumed");
  const completed = await applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: residue.handoff_digest,
    archiveEvidence: [],
    appliedAt: new Date().toISOString(),
  });
  assert.equal(completed.status, "consumed-clean-start");
  assert.equal(completed.handoff.target_consumption.mode, "clean-start");
  assert.equal(completed.handoff.target_consumption.target_run_id, null);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "refresh-v1")), /ENOENT/);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "v0.8.0-rc.5")), /ENOENT/);
  assert.match(await readFile(resolve(root, "integrated-result.txt"), "utf8"), /integrated/);

  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspected, "post-clean-start refresh inspection");
  assert.equal(JSON.parse(inspected.stdout).route, "fresh");
});

test("refresh accepts only the exact v0.7.8 adapter as a legacy source", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-v078-adapter-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v078-adapter-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-v078-adapter-worktree-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await copyTaggedPackage("v0.7.8");
  const targetPackage = await copyTargetPackage("0.8.0-rc.4");
  await rejectTargetCreationValidation(targetPackage);
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));
  const source = await createSourceExecutor({ root, requests, worktree, sourceCli: sourcePackage.cli });
  await writeFile(resolve(worktree, "discard-me.txt"), "v0.7.8 local work\n", "utf8");
  const targetSkill = resolve(targetPackage.root, "skills", "refresh", "SKILL.md");
  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill", targetSkill, "--json",
  ], root);
  assertSuccess(inspected, "v0.7.8 adapter inspection");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.route, "refresh-ready");
  assert.equal(inspection.authority.source.adapter, "exact-v0.7.8-adapter");

  const replacement = sourceTask({
    task_id: "v078-replacement",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is freshly selected for the v0.7.8 replacement.",
  });
  const targetActivation = activationRequest({
    runId: "refresh-v078-target-run",
    task: replacement,
    lineageId: "refresh-v078-target-lineage",
    threadId: source.coordinatorThread,
    branch: "codex/refresh-v078-target",
  });
  const preparePath = await jsonFile(requests, "v078-refresh-prepare", {
    source_namespace: "v0.7.8",
    source_run_id: source.activation.run_id,
    source_resume: source.activated.run.binding,
    decisions: [{
      source_task_id: source.contract.task_id,
      disposition: "discard",
      rationale: "The old exact-v0.7.8 executor has no integrated result.",
    }],
    replacements: [{ source_task_id: source.contract.task_id, target_task_id: replacement.task_id }],
    target_workflow: targetActivation.workflow,
    target_fences: targetActivation.fences,
    target_coordinator_thread_id: source.coordinatorThread,
  });
  const prepared = invoke(targetPackage.cli, [
    "refresh", "prepare", "--invoking-skill", targetSkill, "--file", preparePath, "--json",
  ], root);
  assertSuccess(prepared, "v0.7.8 adapter preparation");
  const handoff = JSON.parse(prepared.stdout).handoff;
  assert.equal(handoff.intent.source.adapter, "exact-v0.7.8-adapter");
  const applied = await applyRefresh({
    commonDir: source.contract.common_dir,
    refreshId: handoff.refresh_id,
    expectedHandoffDigest: handoff.handoff_digest,
    archiveEvidence: [{
      archive_intent_id: handoff.cleanup[0].archive_intent_id,
      thread_id: handoff.cleanup[0].thread_id,
      host_id: handoff.cleanup[0].host_id,
      active_visible: false,
      archived_visible: true,
      observed_at: new Date().toISOString(),
    }],
    appliedAt: new Date().toISOString(),
  });
  assert.equal(applied.status, "source-retired");
  targetActivation.refresh_id = handoff.refresh_id;
  targetActivation.activated_at = new Date().toISOString();
  const targetActivationPath = await jsonFile(requests, "v078-target-activation", targetActivation);
  const activated = invoke(targetPackage.cli, [
    "run", "activate", "--run-id", targetActivation.run_id,
    "--refresh-id", handoff.refresh_id,
    "--file", targetActivationPath, "--json",
  ], root);
  assertSuccess(activated, "v0.7.8 adapter target activation");
  await assert.rejects(stat(resolve(root, ".git", "codex-flow", "v0.7.8")), /ENOENT/);
});

test("a later v0.8 source parses its own forward-compatible records", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-forward-source-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-forward-source-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-forward-source-worktree-"));
  const worktree = resolve(worktreeParent, "executor");
  const sourcePackage = await copyTargetPackage("0.8.1");
  const targetPackage = await copyTargetPackage("0.8.2");
  await allowForwardCreationField(sourcePackage);
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));

  const source = await createSourceExecutor({ root, requests, worktree, sourceCli: sourcePackage.cli });
  const recordPath = resolve(
    source.contract.common_dir,
    "codex-flow",
    "v0.8.1",
    "visible-task-creations",
    "records",
    `${source.creation.operation_id}.json`,
  );
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  await writeFile(recordPath, `${JSON.stringify({
    ...record,
    source_only_forward_field: "accepted only by the authenticated source snapshot",
  })}\n`, "utf8");

  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill",
    resolve(targetPackage.root, "skills", "refresh", "SKILL.md"),
    "--json",
  ], root);
  assertSuccess(inspected, "forward-compatible source inspection");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.route, "refresh-ready", inspection.reason);
  assert.equal(inspection.authority.source.package_version, "0.8.1");
  assert.equal(inspection.authority.source.adapter, "v0.8-source-export");

  const exporterPath = resolve(
    source.activated.runtime_authority.bundle_root,
    "bin",
    "codex-flow-refresh-source.mjs",
  );
  await writeFile(
    exporterPath,
    `${await readFile(exporterPath, "utf8")}\n// simulated authenticated-snapshot drift\n`,
    "utf8",
  );
  const tampered = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill",
    resolve(targetPackage.root, "skills", "refresh", "SKILL.md"),
    "--json",
  ], root);
  assertSuccess(tampered, "tampered source snapshot inspection");
  const tamperedInspection = JSON.parse(tampered.stdout);
  assert.equal(tamperedInspection.route, "blocked");
  assert.match(tamperedInspection.reason, /hash|digest|bundle/i);
});

test("refresh refuses to erase an unretired non-selected source run", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-other-run-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-other-run-requests-"));
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-other-run-worktree-"));
  const worktree = resolve(worktreeParent, "current-executor");
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.6");
  t.after(async () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  });
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(worktreeParent, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));

  const oldTask = sourceTask({
    task_id: "older-unretired-task",
    write_paths: ["older-unretired"],
    shared_resources: ["older-unretired-resource"],
  });
  const oldActivation = activationRequest({
    runId: "older-unretired-run",
    task: oldTask,
    lineageId: "older-unretired-lineage",
    threadId: "long-lived-refresh-coordinator",
    branch: "codex/older-unretired",
  });
  oldActivation.fences.path_fences = ["older-unretired"];
  oldActivation.fences.resource_fences = ["older-unretired-resource"];
  const oldActivationPath = await jsonFile(requests, "older-unretired-activation", oldActivation);
  const activatedOld = invoke(sourcePackage.cli, [
    "run", "activate", "--run-id", oldActivation.run_id,
    "--file", oldActivationPath, "--json",
  ], root);
  assertSuccess(activatedOld, "older source activation");
  const oldRecord = JSON.parse(activatedOld.stdout);
  const oldRuntimeCli = resolve(oldRecord.runtime_authority.bundle_root, "bin", "codex-flow.mjs");
  const abandonPath = await jsonFile(requests, "older-unretired-abandon", {
    run_id: oldActivation.run_id,
    resume: oldRecord.run.binding,
    reason: "Fixture preserves unresolved predecessor authority.",
  });
  assertSuccess(invoke(oldRuntimeCli, [
    "run", "abandon", "--run-id", oldActivation.run_id,
    "--file", abandonPath, "--json",
  ], root), "older source abandonment");

  await createSourceExecutor({ root, requests, worktree, sourceCli: sourcePackage.cli });
  const inspected = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill",
    resolve(targetPackage.root, "skills", "refresh", "SKILL.md"),
    "--json",
  ], root);
  assertSuccess(inspected, "multi-run refresh inspection");
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /Non-selected source run must be independently closed/);
});

test("refresh blocks an active native subagent instead of placing it on the executor discard path", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-active-subagent-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-refresh-active-subagent-requests-"));
  const sourcePackage = await copyTargetPackage("0.8.0-rc.1");
  const targetPackage = await copyTargetPackage("0.8.0-rc.3");
  t.after(async () => Promise.all([
    removeFixture(root),
    rm(requests, { recursive: true, force: true }),
    rm(sourcePackage.root, { recursive: true, force: true }),
    rm(targetPackage.root, { recursive: true, force: true }),
  ]));
  await createActiveSourceSubagent({ root, requests, sourceCli: sourcePackage.cli });
  const result = invoke(targetPackage.cli, [
    "refresh", "inspect", "--invoking-skill",
    resolve(targetPackage.root, "skills", "refresh", "SKILL.md"),
    "--json",
  ], root);
  assertSuccess(result, "active subagent refresh inspection");
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /Active native subagent must complete and be disposed/);
});

test("refresh skill authentication rejects a stale loaded catalog path", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-stale-skill-");
  t.after(() => removeFixture(root));
  const result = runCli([
    "refresh", "inspect", "--invoking-skill",
    resolve(packageRoot, "skills", "coordinate", "SKILL.md"),
    "--json",
  ], { cwd: root });
  assertSuccess(result, "blocked stale-skill inspection");
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /reload the Codex App/);
});

test("refresh inspection blocks malformed current namespace authority", async (t) => {
  const root = await createGitFixture("codex-flow-refresh-malformed-current-");
  t.after(() => removeFixture(root));
  const lifecycleRoot = resolve(root, ".git", "codex-flow", "v0.8.0-rc.2", "runs");
  await mkdir(lifecycleRoot, { recursive: true });
  await writeFile(resolve(lifecycleRoot, "lifecycle.json"), "{}\n", "utf8");
  const result = runCli([
    "refresh", "inspect", "--invoking-skill",
    resolve(packageRoot, "skills", "refresh", "SKILL.md"),
    "--json",
  ], { cwd: root });
  assertSuccess(result, "malformed current namespace inspection");
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.route, "blocked");
  assert.match(inspection.reason, /run lifecycle state/);
});
