import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

const ACTIVATED_AT = "2026-08-29T20:00:00.000Z";

function task() {
  return {
    task_id: "visible-implementation",
    title: "Implement one bounded visible change",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["audit-sentinel/visible-implementation.txt"],
    primary_outcome: "Complete one bounded implementation.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Attempt the bounded source change and its focused verification.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

function activationRequest(runId = "run-cli-v06") {
  return {
    run_id: runId,
    activated_at: ACTIVATED_AT,
    runtime: {
      config: {
        config_id: "cli-v06-config",
        snapshot: { project_id: "saved-project", coordinator_model: "gpt-5.6-sol" },
      },
      policy: {
        policy_id: "cli-v06-policy",
        snapshot: { routine_callbacks: "journal", urgent_callbacks: "direct" },
      },
      host: { host_id: "local", session_id: "cli-v06-session" },
      lineage: {
        lineage_id: "cli-v06-lineage",
        thread_id: "cli-v06-coordinator",
        generation: 1,
      },
    },
    workflow: {
      schema_version: 1,
      plan_id: "cli-v06-workflow",
      revision: 1,
      parent_revision_digest: null,
      tasks: [task()],
    },
    fences: {
      path_fences: ["audit-sentinel"],
      resource_fences: ["cli-v06-resource"],
      branch_fences: ["codex/cli-v06-visible"],
      operation_fences: ["cli-v06-operation"],
    },
  };
}

async function requestFile(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

async function activatedFixture(t, suffix = "base") {
  const root = await createGitFixture(`codex-flow-cli-v06-${suffix}-`);
  const requests = await mkdtemp(resolve(tmpdir(), `codex-flow-cli-v06-requests-${suffix}-`));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const runId = `run-cli-${suffix}`;
  const activation = activationRequest(runId);
  const activationPath = await requestFile(requests, "activation", activation);
  const first = runCli([
    "run", "activate", "--run-id", runId, "--file", activationPath, "--json",
  ], { cwd: root });
  assertSuccess(first, "v0.6 run activation");
  return {
    root,
    requests,
    runId,
    activation,
    activationPath,
    result: JSON.parse(first.stdout),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  };
}

test("v0.6 help exposes no bare callback consume and direct v0.5 paths fail closed", () => {
  const help = runCli(["--help"]);
  assertSuccess(help, "v0.6 help");
  assert.match(help.stdout, /callback deliver\|observe --run-id/);
  assert.doesNotMatch(help.stdout, /callback consume/);
  assert.match(help.stdout, /legacy-v05/);

  const consume = runCli(["callback", "consume", "--run-id", "run-cli-help"]);
  assert.notEqual(consume.status, 0);
  assert.match(consume.stderr, /internal to finalized disposition/);

  const oldInit = runCli(["init", "--check"]);
  assert.notEqual(oldInit.status, 0);
  assert.match(oldInit.stderr, /quarantined v0\.5 command/);
});

test("run activation needs no tracked setup and replays the same disclosed authority", async (t) => {
  const context = await activatedFixture(t, "activation");
  await assert.rejects(stat(resolve(context.root, ".codex", "orchestration")), /ENOENT/);
  assert.equal(context.result.status, "admitted");
  assert.equal(context.result.state_authority.namespace, "v0.6.0");
  assert.match(context.result.state_authority.state_root, /\.git\/codex-flow\/v0\.6\.0$/);
  assert.equal(context.result.repository_authority.cleanliness, "clean");
  assert.equal(context.result.workflow_authority.run_id, context.runId);
  assert.equal(context.result.model_routing[0].model, "gpt-5.6-terra");
  assert.equal(context.result.model_routing[0].reasoning_effort, "xhigh");
  assert.equal(context.result.host_call_performed, false);

  const replay = runCli([
    "run", "activate", "--run-id", context.runId,
    "--file", context.activationPath, "--json",
  ], { cwd: context.root });
  assertSuccess(replay, "idempotent v0.6 activation");
  const repeated = JSON.parse(replay.stdout);
  assert.equal(repeated.status, "already-active");
  assert.equal(repeated.runtime_authority.acquisition_status, "existing");
  assert.equal(
    repeated.runtime_authority.runtime_context_digest,
    context.result.runtime_authority.runtime_context_digest,
  );
  assert.equal(
    repeated.workflow_authority.journal_digest,
    context.result.workflow_authority.journal_digest,
  );
});

test("request.run_id mismatch is rejected before operational state is created", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v06-mismatch-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v06-mismatch-request-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const path = await requestFile(requests, "mismatch", activationRequest("run-in-file"));
  const result = runCli([
    "run", "activate", "--run-id", "run-on-command", "--file", path, "--json",
  ], { cwd: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /request\.run_id does not match --run-id/);
  await assert.rejects(stat(resolve(root, ".git", "codex-flow")), /ENOENT/);
});

test("a second active run is refused before acquiring orphan runtime or workflow authority", async (t) => {
  const context = await activatedFixture(t, "active-conflict");
  const contextsRoot = resolve(
    context.result.state_authority.git_common_dir,
    "codex-flow",
    "v0.6.0",
    "contexts",
  );
  const beforeContexts = await readdir(contextsRoot);
  const conflicting = activationRequest("run-cli-active-conflict-other");
  conflicting.activated_at = "2026-08-29T20:00:10.000Z";
  conflicting.runtime.host.session_id = "different-session";
  const conflictingPath = await requestFile(context.requests, "conflicting-activation", conflicting);
  const result = runCli([
    "run", "activate", "--run-id", conflicting.run_id,
    "--file", conflictingPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different v0\.6 run is already active/);
  assert.deepEqual(await readdir(contextsRoot), beforeContexts);
  await assert.rejects(
    stat(resolve(
      context.result.state_authority.state_root,
      "workflows",
      conflicting.run_id,
    )),
    /ENOENT/,
  );
});

test("task creation and release expose each native host payload at most once", async (t) => {
  const context = await activatedFixture(t, "one-shot");
  const forgedContractPath = await requestFile(context.requests, "forged-contract", {
    run_id: context.runId,
    plan_id: context.result.workflow_authority.plan_id,
    task_id: "visible-implementation",
    dependency_records: [],
    authority: {
      run_id: context.runId,
      runtime_context_digest: "f".repeat(64),
    },
  });
  const forgedContractResult = runCli([
    "workflow", "contract", "--run-id", context.runId,
    "--file", forgedContractPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(forgedContractResult.status, 0);
  assert.match(forgedContractResult.stderr, /field is not allowed: authority/);

  const contractPath = await requestFile(context.requests, "contract", {
    run_id: context.runId,
    plan_id: context.result.workflow_authority.plan_id,
    task_id: "visible-implementation",
    dependency_records: [],
    created_at: "2026-08-29T20:00:01.000Z",
  });
  const contractResult = runCli([
    "workflow", "contract", "--run-id", context.runId, "--file", contractPath, "--json",
  ], { cwd: context.root });
  assertSuccess(contractResult, "workflow contract");
  const contract = JSON.parse(contractResult.stdout);

  const requestedSelectors = {
    project_id: "saved-project",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    worktree: {
      mode: "host-worktree",
      starting_revision: context.revision,
      starting_branch: "main",
      executor_branch: "codex/cli-v06-visible",
      path: null,
    },
  };
  const preparePath = await requestFile(context.requests, "task-prepare", {
    run_id: context.runId,
    task_contract: contract,
    requested_selectors: requestedSelectors,
    prepared_at: "2026-08-29T20:00:02.000Z",
  });
  const preparedResult = runCli([
    "task", "create", "prepare", "--run-id", context.runId,
    "--file", preparePath, "--json",
  ], { cwd: context.root });
  assertSuccess(preparedResult, "visible-task prepare");
  const prepared = JSON.parse(preparedResult.stdout);

  const attemptPath = await requestFile(context.requests, "task-attempt", {
    run_id: context.runId,
    operation_id: prepared.operation_id,
    host_session_id: "desktop-session-one-shot",
    timeout_seconds: 300,
    attempted_at: "2026-08-29T20:00:03.000Z",
  });
  const attemptedResult = runCli([
    "task", "create", "attempt", "--run-id", context.runId,
    "--file", attemptPath, "--json",
  ], { cwd: context.root });
  assertSuccess(attemptedResult, "visible-task attempt");
  const attempted = JSON.parse(attemptedResult.stdout);
  assert.equal(attempted.dispatch_permitted, true);
  assert.equal(attempted.host_request.model, "gpt-5.6-terra");
  assert.equal(attempted.host_request.reasoning_effort, "xhigh");
  assert.match(attempted.host_request.prompt, /CODEX_FLOW_LAUNCH_NONCE=[0-9a-f]{64}/);
  assert.equal((attempted.host_request.prompt.match(/CODEX_FLOW_LAUNCH_NONCE=/g) ?? []).length, 1);

  const repeatedAttemptResult = runCli([
    "task", "create", "attempt", "--run-id", context.runId,
    "--file", attemptPath, "--json",
  ], { cwd: context.root });
  assertSuccess(repeatedAttemptResult, "visible-task attempt replay");
  const repeatedAttempt = JSON.parse(repeatedAttemptResult.stdout);
  assert.equal(repeatedAttempt.dispatch_permitted, false);
  assert.equal(Object.hasOwn(repeatedAttempt, "host_request"), false);

  const readyThreadId = "ready-cli-v06-thread";
  const reconcilePath = await requestFile(context.requests, "task-reconcile", {
    run_id: context.runId,
    operation_id: prepared.operation_id,
    outcome: "ready",
    ready_thread_id: readyThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: "initial-cli-v06-turn",
      turn_index: 1,
      role: "user",
      content: attempted.host_request.prompt,
      observed_at: "2026-08-29T20:00:05.000Z",
    },
    selector_evidence: {
      accepted: {
        ...requestedSelectors,
        accepted_at: "2026-08-29T20:00:04.000Z",
      },
      observed: null,
    },
    reconciled_at: "2026-08-29T20:00:05.000Z",
  });
  const reconcileResult = runCli([
    "task", "create", "reconcile", "--run-id", context.runId,
    "--file", reconcilePath, "--json",
  ], { cwd: context.root });
  assertSuccess(reconcileResult, "visible-task ready reconciliation");
  assert.equal(JSON.parse(reconcileResult.stdout).status, "ready-unreleased");

  const releasePath = await requestFile(context.requests, "release-prepare", {
    run_id: context.runId,
    task_contract: contract,
    operation_id: prepared.operation_id,
    prepared_at: "2026-08-29T20:00:06.000Z",
  });
  const releaseResult = runCli([
    "release", "prepare", "--run-id", context.runId, "--file", releasePath, "--json",
  ], { cwd: context.root });
  assertSuccess(releaseResult, "task release prepare");
  const release = JSON.parse(releaseResult.stdout);
  assert.equal(release.dispatch_permitted, true);
  assert.equal(release.host_request.thread_id, readyThreadId);
  assert.match(release.host_request.prompt, /Codex Flow v0\.6 accepted task release/);
  assert.equal(release.prompt_digest.length, 64);

  const repeatedReleaseResult = runCli([
    "release", "prepare", "--run-id", context.runId, "--file", releasePath, "--json",
  ], { cwd: context.root });
  assertSuccess(repeatedReleaseResult, "task release replay");
  const repeatedRelease = JSON.parse(repeatedReleaseResult.stdout);
  assert.equal(repeatedRelease.dispatch_permitted, false);
  assert.equal(Object.hasOwn(repeatedRelease, "host_request"), false);
});

test("audited close refuses an incomplete run and keeps it active", async (t) => {
  const context = await activatedFixture(t, "close-refusal");
  const auditResult = runCli([
    "run", "audit", "--run-id", context.runId, "--json",
  ], { cwd: context.root });
  assertSuccess(auditResult, "run closure audit");
  const auditView = JSON.parse(auditResult.stdout);
  assert.equal(auditView.audit.terminal_ready, false);
  assert.ok(auditView.audit.blockers.length > 0);

  const closePath = await requestFile(context.requests, "close", {
    run_id: context.runId,
    resume: context.result.run.binding,
    audit_id: auditView.audit.audit_id,
    closed_at: "2026-08-29T20:01:00.000Z",
  });
  const closeResult = runCli([
    "run", "close", "--run-id", context.runId, "--file", closePath, "--json",
  ], { cwd: context.root });
  assert.notEqual(closeResult.status, 0);
  assert.match(closeResult.stderr, /current terminal-ready audit/);

  const status = runCli(["run", "status", "--run-id", context.runId, "--json"], {
    cwd: context.root,
  });
  assertSuccess(status, "run status after refused close");
  assert.equal(JSON.parse(status.stdout).run.status, "active");
});
