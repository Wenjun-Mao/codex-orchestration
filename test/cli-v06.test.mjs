import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";
import { persistUrgentSignal } from "../lib/urgent-signals.mjs";

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
  assert.match(help.stdout, /urgent persist\|attempt\|reconcile\|observe\|consume\|expire --run-id/);
  assert.doesNotMatch(help.stdout, /callback consume/);
  assert.match(help.stdout, /legacy-v05/);

  const consume = runCli(["callback", "consume", "--run-id", "run-cli-help"]);
  assert.notEqual(consume.status, 0);
  assert.match(consume.stderr, /internal to finalized disposition/);

  const oldInit = runCli(["init", "--check"]);
  assert.notEqual(oldInit.status, 0);
  assert.match(oldInit.stderr, /quarantined v0\.5 command/);
});

test("v0.6 urgent delivery is journal-first, one-shot, and separate from quiet callbacks", async (t) => {
  const context = await activatedFixture(t, "urgent-one-shot");
  const signal = {
    schema_version: 1,
    recipient: context.activation.runtime.lineage,
    executor_id: "urgent-executor-v06",
    run_id: context.runId,
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2026-08-30T20:00:00.000Z",
    classification: "high-risk-drift",
    summary: "A bounded ownership conflict requires coordinator attention.",
    requested_action: "Reconcile the exact ownership conflict before execution resumes.",
  };
  const persisted = await persistUrgentSignal({
    stateRoot: context.result.state_authority.state_root,
    signal,
    now: Date.parse("2026-08-29T20:00:01.000Z"),
  });
  const attemptPath = await requestFile(context.requests, "urgent-attempt", {
    run_id: context.runId,
    urgent_id: persisted.urgent_id,
    prepared_at: "2026-08-29T20:00:02.000Z",
  });
  const attempted = runCli([
    "urgent", "attempt", "--run-id", context.runId, "--file", attemptPath, "--json",
  ], { cwd: context.root });
  assertSuccess(attempted, "v0.6 urgent attempt");
  const attempt = JSON.parse(attempted.stdout);
  assert.equal(attempt.dispatch_permitted, true);
  const hostPrompt = JSON.parse(attempt.host_prompt);
  assert.equal(hostPrompt.kind, "codex-flow-urgent-direct");
  assert.equal(hostPrompt.urgent_id, persisted.urgent_id);

  const replay = runCli([
    "urgent", "attempt", "--run-id", context.runId, "--file", attemptPath, "--json",
  ], { cwd: context.root });
  assertSuccess(replay, "v0.6 urgent attempt replay");
  assert.equal(JSON.parse(replay.stdout).dispatch_permitted, false);
  assert.equal(Object.hasOwn(JSON.parse(replay.stdout), "host_prompt"), false);

  const reconcilePath = await requestFile(context.requests, "urgent-reconcile", {
    run_id: context.runId,
    urgent_id: persisted.urgent_id,
    delivery_attempt_id: attempt.delivery_attempt_id,
    host_call_result: "sent",
    reconciled_at: "2026-08-29T20:00:03.000Z",
  });
  assertSuccess(runCli([
    "urgent", "reconcile", "--run-id", context.runId,
    "--file", reconcilePath, "--json",
  ], { cwd: context.root }), "v0.6 urgent reconciliation");

  const observePath = await requestFile(context.requests, "urgent-observe", {
    run_id: context.runId,
    urgent_id: persisted.urgent_id,
    delivery_attempt_id: attempt.delivery_attempt_id,
    recipient: context.activation.runtime.lineage,
    observed_at: "2026-08-29T20:00:04.000Z",
  });
  const observed = runCli([
    "urgent", "observe", "--run-id", context.runId, "--file", observePath, "--json",
  ], { cwd: context.root });
  assertSuccess(observed, "v0.6 urgent observation");
  assert.equal(JSON.parse(observed.stdout).disposition, "process");

  const consumePath = await requestFile(context.requests, "urgent-consume", {
    run_id: context.runId,
    urgent_id: persisted.urgent_id,
    recipient: context.activation.runtime.lineage,
    sender_executor_id: signal.executor_id,
    consumed_at: "2026-08-29T20:00:05.000Z",
  });
  const consumed = runCli([
    "urgent", "consume", "--run-id", context.runId, "--file", consumePath, "--json",
  ], { cwd: context.root });
  assertSuccess(consumed, "v0.6 urgent consumption");
  assert.equal(JSON.parse(consumed.stdout).status, "consumed");

  const status = runCli(["urgent", "status", "--run-id", context.runId, "--json"], {
    cwd: context.root,
  });
  assertSuccess(status, "v0.6 urgent status");
  assert.equal(JSON.parse(status.stdout).consumed_count, 1);
});

test("legacy-v05 exposes read-only verification and refuses every mutation family", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v06-legacy-read-only-");
  t.after(() => removeFixture(root));
  const help = runCli(["legacy-v05", "--help"], { cwd: root });
  assertSuccess(help, "legacy-v05 help");
  assert.match(help.stdout, /Read-only historical verification/);
  assert.doesNotMatch(help.stdout, /init --plan|recipient bind|callback deliver|cleanup apply/);

  const refused = [
    ["init", "--plan"],
    ["sync"],
    ["config", "set", "--model", "gpt-5.6-terra"],
    ["task", "start", "--role", "coordinator"],
    ["task", "operation", "prepare"],
    ["recipient", "bind", "--lineage-id", "legacy", "--thread-id", "legacy-thread"],
    ["callback", "deliver"],
    ["urgent", "persist"],
    ["git", "bind", "--operation-id", "legacy-operation"],
    ["lease", "acquire", "--resource", "legacy", "--owner", "legacy"],
    ["cleanup", "plan", "--main-branch", "main"],
  ];
  for (const command of refused) {
    const result = runCli(["legacy-v05", ...command], { cwd: root });
    assert.notEqual(result.status, 0, `legacy mutation unexpectedly passed: ${command.join(" ")}`);
    assert.match(result.stderr, /legacy-v05 is read-only historical verification/);
  }
  assert.equal(execFileSync("git", ["status", "--porcelain=v1"], {
    cwd: root,
    encoding: "utf8",
  }), "");
  await assert.rejects(stat(resolve(root, ".git", "codex-flow")), /ENOENT/);
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
  const recipientPath = resolve(
    context.result.state_authority.state_root,
    "recipients",
    "bindings",
    `${context.activation.runtime.lineage.lineage_id}.json`,
  );
  const recipient = JSON.parse(await readFile(recipientPath, "utf8"));
  assert.equal(recipient.current.thread_id, context.activation.runtime.lineage.thread_id);
  assert.equal(recipient.current.generation, context.activation.runtime.lineage.generation);
  assert.equal(recipient.current.fence_token, context.result.run.binding.fence_token);
  assert.deepEqual(
    context.result.runtime_authority.coordinator_recipient,
    { ...context.activation.runtime.lineage, fence_token: context.result.run.binding.fence_token },
  );

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
  assert.deepEqual(
    repeated.runtime_authority.coordinator_recipient,
    context.result.runtime_authority.coordinator_recipient,
  );
});

test("run rebind advances the canonical recipient with the same fenced authority", async (t) => {
  const context = await activatedFixture(t, "recipient-rebind");
  const request = {
    run_id: context.runId,
    resume: context.result.run.binding,
    next: {
      host: { host_id: "local", session_id: "cli-v06-session-rebound" },
      lineage: {
        lineage_id: context.activation.runtime.lineage.lineage_id,
        thread_id: "cli-v06-coordinator-rebound",
        generation: 2,
      },
    },
    rebound_at: "2026-08-29T20:00:30.000Z",
  };
  const path = await requestFile(context.requests, "recipient-rebind", request);
  const first = runCli([
    "run", "rebind", "--run-id", context.runId, "--file", path, "--json",
  ], { cwd: context.root });
  assertSuccess(first, "coordinator rebind");
  const rebound = JSON.parse(first.stdout);
  assert.deepEqual(rebound.run.binding.lineage, request.next.lineage);

  const recipientPath = resolve(
    context.result.state_authority.state_root,
    "recipients",
    "bindings",
    `${request.next.lineage.lineage_id}.json`,
  );
  const recipient = JSON.parse(await readFile(recipientPath, "utf8"));
  assert.equal(recipient.current.thread_id, request.next.lineage.thread_id);
  assert.equal(recipient.current.generation, request.next.lineage.generation);
  assert.equal(recipient.current.fence_token, rebound.run.binding.fence_token);
  assert.equal(recipient.bindings.length, 2);

  const replay = runCli([
    "run", "rebind", "--run-id", context.runId, "--file", path, "--json",
  ], { cwd: context.root });
  assertSuccess(replay, "idempotent coordinator rebind");
  assert.equal(JSON.parse(replay.stdout).run.binding.fence_token, rebound.run.binding.fence_token);
  assert.equal(
    JSON.parse(await readFile(recipientPath, "utf8")).bindings.length,
    2,
  );

  const stale = structuredClone(request);
  stale.next.lineage.thread_id = "cli-v06-coordinator-forged";
  stale.next.lineage.generation = 3;
  const stalePath = await requestFile(context.requests, "recipient-stale-rebind", stale);
  const refused = runCli([
    "run", "rebind", "--run-id", context.runId, "--file", stalePath, "--json",
  ], { cwd: context.root });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /resume fence|authoritative coordinator recipient/);
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
    dependency_authorities: [],
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

  const injectedRecordsPath = await requestFile(context.requests, "injected-records", {
    run_id: context.runId,
    plan_id: context.result.workflow_authority.plan_id,
    task_id: "visible-implementation",
    dependency_records: [],
  });
  const injectedRecordsResult = runCli([
    "workflow", "contract", "--run-id", context.runId,
    "--file", injectedRecordsPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(injectedRecordsResult.status, 0);
  assert.match(injectedRecordsResult.stderr, /dependency_authorities|dependency_records/);

  const contractPath = await requestFile(context.requests, "contract", {
    run_id: context.runId,
    plan_id: context.result.workflow_authority.plan_id,
    task_id: "visible-implementation",
    dependency_authorities: [],
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

  const rejectedReleasePath = await requestFile(context.requests, "release-rejected", {
    run_id: context.runId,
    release_id: release.release_id,
    outcome: "rejected-before-send",
    reconciled_at: "2026-08-29T20:00:07.000Z",
  });
  const rejectedReleaseResult = runCli([
    "release", "reconcile", "--run-id", context.runId,
    "--file", rejectedReleasePath, "--json",
  ], { cwd: context.root });
  assertSuccess(rejectedReleaseResult, "release rejected before objective send");
  assert.equal(JSON.parse(rejectedReleaseResult.stdout).delivery.outcome, "rejected-before-send");

  const cancelPath = await requestFile(context.requests, "disposition-cancel", {
    run_id: context.runId,
    release_id: release.release_id,
    reason: "The native host refused the one allowed objective delivery.",
    cancelled_at: "2026-08-29T20:00:08.000Z",
  });
  const cancelResult = runCli([
    "disposition", "cancel", "--run-id", context.runId,
    "--file", cancelPath, "--json",
  ], { cwd: context.root });
  assertSuccess(cancelResult, "pre-execution task cancellation");
  const cancelled = JSON.parse(cancelResult.stdout);
  assert.equal(cancelled.decision, "cancelled");
  assert.equal(cancelled.state, "completed");
  assert.equal(cancelled.callback_id, null);
  assert.equal(cancelled.release_id, release.release_id);

  const cancelReplayResult = runCli([
    "disposition", "cancel", "--run-id", context.runId,
    "--file", cancelPath, "--json",
  ], { cwd: context.root });
  assertSuccess(cancelReplayResult, "pre-execution cancellation replay");
  assert.equal(JSON.parse(cancelReplayResult.stdout).disposition_id, cancelled.disposition_id);
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
  assert.match(closeResult.stderr, /current terminal-ready.*audit/);

  const status = runCli(["run", "status", "--run-id", context.runId, "--json"], {
    cwd: context.root,
  });
  assertSuccess(status, "run status after refused close");
  assert.equal(JSON.parse(status.stdout).run.status, "active");
});

test("terminal runs remain inspectable but every public mutation family fails closed", async (t) => {
  const context = await activatedFixture(t, "terminal-mutation-fence");
  const abandonPath = await requestFile(context.requests, "abandon", {
    run_id: context.runId,
    resume: context.result.run.binding,
    unresolved_fences: context.result.workflow_authority.fences,
    reason: "Bounded regression terminalizes the run with its admitted fences intact.",
    abandoned_at: "2026-08-29T20:01:30.000Z",
  });
  const abandoned = runCli([
    "run", "abandon", "--run-id", context.runId, "--file", abandonPath, "--json",
  ], { cwd: context.root });
  assertSuccess(abandoned, "run abandonment");
  assert.equal(JSON.parse(abandoned.stdout).run.status, "abandoned");

  const inertPath = await requestFile(context.requests, "terminal-mutation", {
    run_id: context.runId,
  });
  const mutations = [
    ["workflow", "create"],
    ["task", "create", "prepare"],
    ["subagent", "prepare"],
    ["release", "prepare"],
    ["callback", "deliver"],
    ["disposition", "prepare"],
    ["disposition", "cancel"],
    ["verification", "run"],
    ["integration", "prepare"],
    ["archive", "prepare"],
    ["adopt", "apply"],
  ];
  for (const command of mutations) {
    const result = runCli([
      ...command, "--run-id", context.runId, "--file", inertPath, "--json",
    ], { cwd: context.root });
    assert.notEqual(result.status, 0, `terminal mutation unexpectedly passed: ${command.join(" ")}`);
    assert.match(result.stderr, /v0\.6 run is not active/);
  }

  const rebind = structuredClone(JSON.parse(await readFile(abandonPath, "utf8")));
  delete rebind.unresolved_fences;
  delete rebind.reason;
  delete rebind.abandoned_at;
  rebind.next = {
    host: { host_id: "local", session_id: "terminal-rebind" },
    lineage: {
      lineage_id: context.activation.runtime.lineage.lineage_id,
      thread_id: "terminal-rebind-thread",
      generation: 2,
    },
  };
  const rebindPath = await requestFile(context.requests, "terminal-rebind", rebind);
  const terminalRebind = runCli([
    "run", "rebind", "--run-id", context.runId, "--file", rebindPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(terminalRebind.status, 0);
  assert.match(terminalRebind.stderr, /v0\.6 run is not active/);

  const runStatus = runCli(["run", "status", "--run-id", context.runId, "--json"], {
    cwd: context.root,
  });
  assertSuccess(runStatus, "terminal run status");
  assert.equal(JSON.parse(runStatus.stdout).run.status, "abandoned");
  const workflowStatus = runCli([
    "workflow", "status", "--run-id", context.runId,
    "--plan-id", context.result.workflow_authority.plan_id, "--json",
  ], { cwd: context.root });
  assertSuccess(workflowStatus, "terminal workflow status");
});
