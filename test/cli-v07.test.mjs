import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v07-lifecycle-fixture.mjs";

const ACTIVATED_AT = "2026-08-29T20:00:00.000Z";

function task() {
  return {
    task_id: "visible-implementation",
    title: "Implement one bounded visible change",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Terra-xhigh is required for this multi-module CLI lifecycle fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["audit-sentinel/visible-implementation.txt"],
    shared_resources: ["cli-v07-resource"],
    primary_outcome: "Complete one bounded implementation.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Attempt the bounded source change and its focused verification.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

function activationRequest(runId = "run-cli-v07") {
  return {
    run_id: runId,
    activated_at: ACTIVATED_AT,
    runtime: {
      config: {
        config_id: "cli-v07-config",
        snapshot: { project_id: "saved-project", coordinator_model: "gpt-5.6-sol" },
      },
      policy: {
        policy_id: "cli-v07-policy",
        snapshot: { routine_callbacks: "journal", urgent_callbacks: "direct" },
      },
      host: { host_id: "local", session_id: "cli-v07-session" },
      lineage: {
        lineage_id: "cli-v07-lineage",
        thread_id: "cli-v07-coordinator",
        generation: 1,
      },
    },
    workflow: {
      schema_version: 1,
      plan_id: "cli-v07-workflow",
      revision: 1,
      parent_revision_digest: null,
      tasks: [task()],
    },
    fences: {
      path_fences: ["audit-sentinel"],
      resource_fences: ["cli-v07-resource"],
      branch_fences: ["codex/cli-v07-visible"],
    },
  };
}

async function requestFile(directory, name, value) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

async function activatedFixture(t, suffix = "base") {
  const root = await createGitFixture(`codex-flow-cli-v07-${suffix}-`);
  const requests = await mkdtemp(resolve(tmpdir(), `codex-flow-cli-v07-requests-${suffix}-`));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const runId = `run-cli-${suffix}`;
  const activation = activationRequest(runId);
  const activationPath = await requestFile(requests, "activation", activation);
  const first = runCli([
    "run", "activate", "--run-id", runId, "--file", activationPath, "--json",
  ], { cwd: root });
  assertSuccess(first, "v0.7 run activation");
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

test("v0.7 help exposes no bare callback consume or predecessor commands", () => {
  const help = runCli(["--help"]);
  assertSuccess(help, "v0.7 help");
  assert.match(help.stdout, /callback deliver\|observe --run-id/);
  assert.match(help.stdout, /task create prepare\|attempt\|reconcile\|bind --run-id/);
  assert.match(help.stdout, /task create resolve-private --run-id/);
  assert.match(help.stdout, /archive prepare\|reconcile\|observe-private --run-id/);
  assert.match(help.stdout, /urgent persist\|attempt\|reconcile\|observe\|consume\|expire --run-id/);
  assert.match(help.stdout, /cleanup plan --run-id/);
  assert.match(help.stdout, /unplug plan/);
  assert.match(help.stdout, /unplug observe-private/);
  assert.match(help.stdout, /unplug apply/);
  assert.doesNotMatch(help.stdout, /callback consume/);
  assert.doesNotMatch(help.stdout, /legacy-v05|adopt/);

  const privateHelp = runCli(["task", "create", "resolve-private", "--help"]);
  assertSuccess(privateHelp, "private resolver scoped help");
  assert.match(privateHelp.stdout, /Read-only temporary Codex App compatibility adapter/);
  assert.match(privateHelp.stdout, /--run-id ID --operation-id ID/);
  assert.match(privateHelp.stdout, /exact persisted\s+reconciliation-window-expired ambiguity/);
  assert.match(privateHelp.stdout, /previously unjournaled provisional, accepted-selector, and ready\s+evidence/);
  assert.match(privateHelp.stdout, /never creates or retries a task/);
  assert.match(privateHelp.stdout, /preserves the original resolution and one-shot attempt/);
  assert.doesNotMatch(privateHelp.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs/);

  const familyHelp = runCli(["release", "prepare", "--help"]);
  assertSuccess(familyHelp, "generic scoped help");
  assert.match(familyHelp.stdout, /codex-flow release prepare\|reconcile\|accept/);
  assert.doesNotMatch(familyHelp.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs/);

  const consume = runCli(["callback", "consume", "--run-id", "run-cli-help"]);
  assert.notEqual(consume.status, 0);
  assert.match(consume.stderr, /internal to finalized disposition/);

  const predecessor = runCli(["legacy-v05", "status"]);
  assert.notEqual(predecessor.status, 0);
  assert.match(predecessor.stderr, /Unknown command: legacy-v05/);
});

test("v0.7 activation requires a clean start when an incompatible namespace remains", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-clean-start-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-clean-start-requests-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  await mkdir(resolve(root, ".git", "codex-flow", "v0.7.0"), { recursive: true });
  const request = activationRequest("run-clean-start-blocked");
  const path = await requestFile(requests, "activation", request);
  const result = runCli([
    "run", "activate", "--run-id", request.run_id, "--file", path, "--json",
  ], { cwd: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Clean start required before activation/);
  assert.match(result.stderr, /codex-flow unplug plan/);
  await assert.rejects(
    stat(resolve(root, ".git", "codex-flow", "v0.8.0-dev.0", "runs", "lifecycle.json")),
    { code: "ENOENT" },
  );
});

test("v0.7 activation cannot race an in-progress unplug", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-unplug-marker-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-unplug-marker-requests-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  await mkdir(resolve(root, ".git", "codex-flow-unplug-v07"), { recursive: true });
  const request = activationRequest("run-unplug-marker-blocked");
  const path = await requestFile(requests, "activation", request);
  const result = runCli([
    "run", "activate", "--run-id", request.run_id, "--file", path, "--json",
  ], { cwd: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unplug is already in progress/i);
  await assert.rejects(
    stat(resolve(root, ".git", "codex-flow", "v0.8.0-dev.0", "runs", "lifecycle.json")),
    { code: "ENOENT" },
  );
});

test("v0.7 CLI plans unplug read-only and requires exact explicit approval to apply", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-unplug-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-unplug-requests-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const retainedState = resolve(root, ".git", "codex-flow", "retained-evidence.json");
  await mkdir(resolve(root, ".git", "codex-flow"), { recursive: true });
  await writeFile(retainedState, "{not-runtime-json\n");
  const planRequest = await requestFile(requests, "unplug-plan", { resources: [] });
  const planned = runCli(["unplug", "plan", "--file", planRequest, "--json"], { cwd: root });
  assertSuccess(planned, "unplug plan");
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.mutation_performed, false);
  assert.equal(plan.schema_version, 2);
  assert.equal(plan.kind, "codex-flow-v07-unplug-plan-v2");
  assert.deepEqual(plan.state_entries.map((entry) => [entry.name, entry.kind]), [
    ["retained-evidence.json", "opaque-file"],
  ]);

  const deniedRequest = await requestFile(requests, "unplug-denied", {
    approved: false,
    plan,
    archive_evidence: {},
  });
  const denied = runCli(["unplug", "apply", "--file", deniedRequest, "--json"], { cwd: root });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /approved=true/);

  const applyRequest = await requestFile(requests, "unplug-apply", {
    approved: true,
    plan,
    archive_evidence: {},
    applied_at: "2026-08-30T12:00:00.000Z",
  });
  const applied = runCli(["unplug", "apply", "--file", applyRequest, "--json"], { cwd: root });
  assertSuccess(applied, "unplug apply");
  assert.equal(JSON.parse(applied.stdout).residue, false);
  await assert.rejects(stat(retainedState), { code: "ENOENT" });
});

test("v0.7 callback delivery accepts an authenticated linked executor worktree", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-callback-linked-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-linked-worktree-"));
  const linkedWorktree = resolve(worktreeParent, "executor");
  let linkedWorktreeCreated = false;
  t.after(async () => {
    if (linkedWorktreeCreated) {
      execFileSync("git", ["worktree", "remove", "--force", linkedWorktree], { cwd: root });
    }
    await Promise.all([
      removeFixture(root),
      rm(worktreeParent, { recursive: true, force: true }),
    ]);
  });

  const context = await createAcceptedVisibleTask(root, "callback-linked", {
    task: {
      selector_rationale: "Terra xhigh validates callback delivery against a linked executor worktree.",
    },
  });
  execFileSync("git", ["worktree", "add", "--detach", linkedWorktree, context.baseline], { cwd: root });
  linkedWorktreeCreated = true;
  const canonicalLinkedWorktree = await realpath(linkedWorktree);
  assert.equal(execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: linkedWorktree,
    encoding: "utf8",
  }).trim(), canonicalLinkedWorktree);
  assert.equal(execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: linkedWorktree,
    encoding: "utf8",
  }).trim(), context.commonDir);

  const receipt = terminalReceipt(context, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: context.requestedSelectors.worktree.executor_branch,
    upstream: null,
    cleanliness: "clean",
  });
  const requestPath = await requestFile(worktreeParent, "callback-deliver", {
    run_id: context.contract.run_id,
    receipt,
    delivered_at: "2026-08-29T20:00:07.000Z",
  });
  const delivered = runCli([
    "callback", "deliver", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: linkedWorktree });
  assertSuccess(delivered, "linked-worktree callback delivery");
  assert.equal(JSON.parse(delivered.stdout).status, "persisted");
});

test("v0.7 no-change verification uses the observed linked executor worktree from a detached coordinator", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-verification-linked-");
  const worktreeParent = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-verification-worktree-"));
  const linkedWorktree = resolve(worktreeParent, "executor");
  let linkedWorktreeCreated = false;
  t.after(async () => {
    if (linkedWorktreeCreated) {
      execFileSync("git", ["worktree", "remove", "--force", linkedWorktree], { cwd: root });
    }
    await Promise.all([
      removeFixture(root),
      rm(worktreeParent, { recursive: true, force: true }),
    ]);
  });

  const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  execFileSync("git", [
    "worktree", "add", "--detach", linkedWorktree, baseline,
  ], { cwd: root });
  linkedWorktreeCreated = true;
  const context = await createAcceptedVisibleTask(root, "verification-linked", {
    observedWorktreePath: linkedWorktree,
  });
  const canonicalLinkedWorktree = await realpath(linkedWorktree);
  assert.equal(execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: linkedWorktree,
    encoding: "utf8",
  }).trim(), canonicalLinkedWorktree);
  assert.equal(execFileSync("git", ["branch", "--show-current"], {
    cwd: linkedWorktree,
    encoding: "utf8",
  }).trim(), context.requestedSelectors.worktree.executor_branch);

  execFileSync("git", ["checkout", "--detach", context.baseline], { cwd: root });
  const coordinatorBranch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.equal(coordinatorBranch, "");

  const receipt = terminalReceipt(context, {
    kind: "unchanged",
    baseline_revision: context.baseline,
    final_revision: context.baseline,
    branch: context.requestedSelectors.worktree.executor_branch,
    upstream: null,
    cleanliness: "clean",
  });
  const requestPath = await requestFile(worktreeParent, "verification-run", {
    run_id: context.contract.run_id,
    receipt,
    checks: [{
      check_id: "detached-coordinator-no-change",
      argv: [process.execPath, "-e", "process.exit(0)"],
    }],
    verified_at: "2026-08-29T20:00:07.000Z",
  });
  const verified = runCli([
    "verification", "run", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: root });
  assertSuccess(verified, "detached-coordinator no-change verification");
  const record = JSON.parse(verified.stdout);
  assert.equal(record.classification, "PASS");
  assert.equal(record.repository.root, canonicalLinkedWorktree);
  assert.equal(record.repository.requested_branch, context.requestedSelectors.worktree.executor_branch);
  assert.equal(record.repository.started_branch, context.requestedSelectors.worktree.executor_branch);
  assert.equal(record.repository.completed_branch, context.requestedSelectors.worktree.executor_branch);

  const mismatchedReceipts = [
    {
      name: "wrong-receipt-branch",
      receipt: {
        ...receipt,
        git_outcome: { ...receipt.git_outcome, branch: "main" },
      },
      pattern: /Terminal Git branch does not match the ready task executor branch/,
    },
    {
      name: "wrong-receipt-baseline",
      receipt: {
        ...receipt,
        git_outcome: {
          ...receipt.git_outcome,
          baseline_revision: "a".repeat(40),
          final_revision: "a".repeat(40),
        },
      },
      pattern: /Terminal Git baseline does not match the ready task starting revision/,
    },
    {
      name: "wrong-receipt-model",
      receipt: {
        ...receipt,
        model_evidence: {
          configured: { model: "gpt-5.6-luna", reasoning_effort: "medium" },
          requested: { model: "gpt-5.6-luna", reasoning_effort: "medium" },
          accepted: { model: "gpt-5.6-luna", reasoning_effort: "medium" },
          observed: null,
        },
      },
      pattern: /Terminal model evidence does not match the visible-task selector evidence/,
    },
  ];
  for (const mismatch of mismatchedReceipts) {
    const mismatchPath = await requestFile(worktreeParent, mismatch.name, {
      run_id: context.contract.run_id,
      receipt: mismatch.receipt,
      checks: [{
        check_id: mismatch.name,
        argv: [process.execPath, "-e", "process.exit(0)"],
      }],
      verified_at: "2026-08-29T20:00:07.000Z",
    });
    const rejected = runCli([
      "verification", "run", "--run-id", context.contract.run_id,
      "--file", mismatchPath, "--json",
    ], { cwd: root });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, mismatch.pattern);
  }

  const executorCaller = runCli([
    "verification", "run", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: linkedWorktree });
  assert.notEqual(executorCaller.status, 0);
  assert.match(executorCaller.stderr, /coordinator-only mutation authority/);

  await writeFile(resolve(linkedWorktree, "unexpected-verification-dirt.txt"), "dirty\n", "utf8");
  const dirtySubject = runCli([
    "verification", "run", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: root });
  assert.notEqual(dirtySubject.status, 0);
  assert.match(dirtySubject.stderr, /must be pristine before objective release/);
  await rm(resolve(linkedWorktree, "unexpected-verification-dirt.txt"));

  execFileSync("git", ["switch", "--quiet", "--detach", context.baseline], {
    cwd: linkedWorktree,
  });
  const wrongBranchSubject = runCli([
    "verification", "run", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: root });
  assert.notEqual(wrongBranchSubject.status, 0);
  assert.match(wrongBranchSubject.stderr, /wrong branch or detached/);
  execFileSync("git", [
    "switch", "--quiet", context.requestedSelectors.worktree.executor_branch,
  ], { cwd: linkedWorktree });

  execFileSync("git", ["worktree", "remove", "--force", linkedWorktree], { cwd: root });
  linkedWorktreeCreated = false;
  const missingSubject = runCli([
    "verification", "run", "--run-id", context.contract.run_id,
    "--file", requestPath, "--json",
  ], { cwd: root });
  assert.notEqual(missingSubject.status, 0);
  assert.match(missingSubject.stderr, /Observed host worktree path does not exist/);

  const verificationStatus = runCli([
    "verification", "status", "--run-id", context.contract.run_id, "--json",
  ], { cwd: root });
  assertSuccess(verificationStatus, "verification status after rejected subjects");
  assert.deepEqual(
    JSON.parse(verificationStatus.stdout),
    { total: 1, pass: 1, fail: 0, records: [record] },
  );
});

test("v0.7 urgent delivery is journal-first, one-shot, and separate from quiet callbacks", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-urgent-one-shot-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-urgent-requests-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const context = await createAcceptedVisibleTask(root, "urgent-one-shot");
  const runId = context.contract.run_id;
  const signal = {
    schema_version: 1,
    recipient: {
      lineage_id: context.coordinator.lineage_id,
      thread_id: context.coordinator.thread_id,
      generation: context.coordinator.generation,
    },
    executor_id: context.readyThreadId,
    run_id: runId,
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2026-08-30T20:00:00.000Z",
    classification: "high-risk-drift",
    summary: "A bounded ownership conflict requires coordinator attention.",
    requested_action: "Reconcile the exact ownership conflict before execution resumes.",
  };
  const persistPath = await requestFile(requests, "urgent-persist", {
    run_id: runId,
    release_id: context.release.release_id,
    signal,
    persisted_at: "2026-08-29T20:00:06.000Z",
  });
  const persistResult = runCli([
    "urgent", "persist", "--run-id", runId, "--file", persistPath, "--json",
  ], { cwd: root });
  assertSuccess(persistResult, "v0.7 urgent persistence");
  const persisted = JSON.parse(persistResult.stdout);
  assert.equal(persisted.status, "persisted");

  const attemptPath = await requestFile(requests, "urgent-attempt", {
    run_id: runId,
    urgent_id: persisted.urgent_id,
    prepared_at: "2026-08-29T20:00:07.000Z",
  });
  const attempted = runCli([
    "urgent", "attempt", "--run-id", runId, "--file", attemptPath, "--json",
  ], { cwd: root });
  assertSuccess(attempted, "v0.7 urgent attempt");
  const attempt = JSON.parse(attempted.stdout);
  assert.equal(attempt.dispatch_permitted, true);
  const hostPrompt = JSON.parse(attempt.host_prompt);
  assert.equal(hostPrompt.kind, "codex-flow-urgent-direct");
  assert.equal(hostPrompt.urgent_id, persisted.urgent_id);

  const replay = runCli([
    "urgent", "attempt", "--run-id", runId, "--file", attemptPath, "--json",
  ], { cwd: root });
  assertSuccess(replay, "v0.7 urgent attempt replay");
  assert.equal(JSON.parse(replay.stdout).dispatch_permitted, false);
  assert.equal(Object.hasOwn(JSON.parse(replay.stdout), "host_prompt"), false);

  const reconcilePath = await requestFile(requests, "urgent-reconcile", {
    run_id: runId,
    urgent_id: persisted.urgent_id,
    delivery_attempt_id: attempt.delivery_attempt_id,
    host_call_result: "sent",
    reconciled_at: "2026-08-29T20:00:08.000Z",
  });
  assertSuccess(runCli([
    "urgent", "reconcile", "--run-id", runId,
    "--file", reconcilePath, "--json",
  ], { cwd: root }), "v0.7 urgent reconciliation");

  const observePath = await requestFile(requests, "urgent-observe", {
    run_id: runId,
    urgent_id: persisted.urgent_id,
    delivery_attempt_id: attempt.delivery_attempt_id,
    recipient: signal.recipient,
    observed_at: "2026-08-29T20:00:09.000Z",
  });
  const observed = runCli([
    "urgent", "observe", "--run-id", runId, "--file", observePath, "--json",
  ], { cwd: root });
  assertSuccess(observed, "v0.7 urgent observation");
  assert.equal(JSON.parse(observed.stdout).disposition, "process");

  const consumePath = await requestFile(requests, "urgent-consume", {
    run_id: runId,
    urgent_id: persisted.urgent_id,
    recipient: signal.recipient,
    sender_executor_id: signal.executor_id,
    consumed_at: "2026-08-29T20:00:10.000Z",
  });
  const consumed = runCli([
    "urgent", "consume", "--run-id", runId, "--file", consumePath, "--json",
  ], { cwd: root });
  assertSuccess(consumed, "v0.7 urgent consumption");
  assert.equal(JSON.parse(consumed.stdout).status, "consumed");

  const status = runCli(["urgent", "status", "--run-id", runId, "--json"], {
    cwd: root,
  });
  assertSuccess(status, "v0.7 urgent status");
  assert.equal(JSON.parse(status.stdout).consumed_count, 1);
});

test("run activation needs no tracked setup and replays the same disclosed authority", async (t) => {
  const context = await activatedFixture(t, "activation");
  await assert.rejects(stat(resolve(context.root, ".codex", "orchestration")), /ENOENT/);
  assert.equal(context.result.status, "admitted");
  assert.equal(context.result.state_authority.namespace, "v0.8.0-dev.0");
  assert.match(context.result.state_authority.state_root, /\.git\/codex-flow\/v0\.8\.0-dev\.0$/);
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
  assertSuccess(replay, "idempotent v0.7 activation");
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

test("run activation rejects a workflow outside its reservation envelope before state acquisition", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-envelope-refusal-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-envelope-requests-"));
  t.after(async () => {
    await Promise.all([removeFixture(root), rm(requests, { recursive: true, force: true })]);
  });
  const request = activationRequest("run-cli-envelope-refusal");
  request.fences.path_fences = [];
  const requestPath = await requestFile(requests, "activation", request);
  const result = runCli([
    "run", "activate", "--run-id", request.run_id, "--file", requestPath, "--json",
  ], { cwd: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the admitted run fence envelope/);
  await assert.rejects(
    stat(resolve(root, ".git", "codex-flow", "v0.8.0-dev.0")),
    (error) => error?.code === "ENOENT",
  );
});

test("run rebind advances the canonical recipient with the same fenced authority", async (t) => {
  const context = await activatedFixture(t, "recipient-rebind");
  const request = {
    run_id: context.runId,
    resume: context.result.run.binding,
    next: {
      host: { host_id: "local", session_id: "cli-v07-session-rebound" },
      lineage: {
        lineage_id: context.activation.runtime.lineage.lineage_id,
        thread_id: "cli-v07-coordinator-rebound",
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
  stale.next.lineage.thread_id = "cli-v07-coordinator-forged";
  stale.next.lineage.generation = 3;
  const stalePath = await requestFile(context.requests, "recipient-stale-rebind", stale);
  const refused = runCli([
    "run", "rebind", "--run-id", context.runId, "--file", stalePath, "--json",
  ], { cwd: context.root });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /resume fence|authoritative coordinator recipient/);
});

test("request.run_id mismatch is rejected before operational state is created", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v07-mismatch-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v07-mismatch-request-"));
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
    "v0.8.0-dev.0",
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
  assert.match(result.stderr, /different v0\.7 run is already active/);
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
      executor_branch: "codex/cli-v07-visible",
      path: null,
    },
  };
  const prepareRequest = {
    run_id: context.runId,
    task_contract: contract,
    requested_selectors: requestedSelectors,
  };
  const rejectedPreparePath = await requestFile(context.requests, "task-prepare-clock", {
    ...prepareRequest,
    prepared_at: "2099-01-01T00:00:00.000Z",
  });
  const rejectedPrepare = runCli([
    "task", "create", "prepare", "--run-id", context.runId,
    "--file", rejectedPreparePath, "--json",
  ], { cwd: context.root });
  assert.notEqual(rejectedPrepare.status, 0);
  assert.match(rejectedPrepare.stderr, /field is not allowed: prepared_at/);

  const preparePath = await requestFile(context.requests, "task-prepare", prepareRequest);
  const preparedResult = runCli([
    "task", "create", "prepare", "--run-id", context.runId,
    "--file", preparePath, "--json",
  ], { cwd: context.root });
  assertSuccess(preparedResult, "visible-task prepare");
  const prepared = JSON.parse(preparedResult.stdout);

  const attemptRequest = {
    run_id: context.runId,
    operation_id: prepared.operation_id,
    host_session_id: "desktop-session-one-shot",
    timeout_seconds: 300,
  };
  const rejectedAttemptPath = await requestFile(context.requests, "task-attempt-clock", {
    ...attemptRequest,
    attempted_at: "2099-01-01T00:00:00.000Z",
  });
  const rejectedAttempt = runCli([
    "task", "create", "attempt", "--run-id", context.runId,
    "--file", rejectedAttemptPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(rejectedAttempt.status, 0);
  assert.match(rejectedAttempt.stderr, /field is not allowed: attempted_at/);

  const attemptPath = await requestFile(context.requests, "task-attempt", attemptRequest);
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

  const creationStatus = runCli([
    "task", "create", "status", "--run-id", context.runId,
    "--operation-id", prepared.operation_id, "--json",
  ], { cwd: context.root });
  assertSuccess(creationStatus, "visible-task creation status");
  const persistedAttempt = JSON.parse(creationStatus.stdout);
  assert(Date.parse(persistedAttempt.attempt.started_at) >= Date.parse(prepared.prepared_at));
  const hostObservedAt = new Date().toISOString();

  const repeatedAttemptResult = runCli([
    "task", "create", "attempt", "--run-id", context.runId,
    "--file", attemptPath, "--json",
  ], { cwd: context.root });
  assertSuccess(repeatedAttemptResult, "visible-task attempt replay");
  const repeatedAttempt = JSON.parse(repeatedAttemptResult.stdout);
  assert.equal(repeatedAttempt.dispatch_permitted, false);
  assert.equal(Object.hasOwn(repeatedAttempt, "host_request"), false);

  const executorPath = resolve(context.requests, "visible-executor");
  execFileSync("git", ["worktree", "add", "--detach", executorPath, context.revision], {
    cwd: context.root,
  });
  const observedExecutorPath = await realpath(executorPath);
  const readyThreadId = "ready-cli-v07-thread";
  const reconcileRequest = {
    run_id: context.runId,
    operation_id: prepared.operation_id,
    outcome: "ready",
    ready_thread_id: readyThreadId,
    initial_turn: {
      source: "host-observed",
      thread_id: readyThreadId,
      turn_id: "initial-cli-v07-turn",
      turn_index: 1,
      role: "user",
      content: attempted.host_request.prompt,
      observed_at: hostObservedAt,
    },
    selector_evidence: {
      accepted: {
        ...requestedSelectors,
        accepted_at: hostObservedAt,
      },
      observed: {
        project_id: requestedSelectors.project_id,
        model: requestedSelectors.model,
        reasoning_effort: requestedSelectors.reasoning_effort,
        worktree: { ...requestedSelectors.worktree, path: observedExecutorPath },
        observed_at: hostObservedAt,
      },
    },
  };
  const rejectedReconcilePath = await requestFile(context.requests, "task-reconcile-clock", {
    ...reconcileRequest,
    reconciled_at: "2099-01-01T00:00:00.000Z",
  });
  const rejectedReconcile = runCli([
    "task", "create", "reconcile", "--run-id", context.runId,
    "--file", rejectedReconcilePath, "--json",
  ], { cwd: context.root });
  assert.notEqual(rejectedReconcile.status, 0);
  assert.match(rejectedReconcile.stderr, /field is not allowed: reconciled_at/);

  const reconcilePath = await requestFile(context.requests, "task-reconcile", reconcileRequest);
  const reconcileResult = runCli([
    "task", "create", "reconcile", "--run-id", context.runId,
    "--file", reconcilePath, "--json",
  ], { cwd: context.root });
  assertSuccess(reconcileResult, "visible-task ready reconciliation");
  assert.equal(JSON.parse(reconcileResult.stdout).status, "ready-unreleased");

  const bindRequest = {
    run_id: context.runId,
    operation_id: prepared.operation_id,
  };
  const rejectedBindPath = await requestFile(context.requests, "task-bind-clock", {
    ...bindRequest,
    bound_at: "2099-01-01T00:00:00.000Z",
  });
  const rejectedBind = runCli([
    "task", "create", "bind", "--run-id", context.runId,
    "--file", rejectedBindPath, "--json",
  ], { cwd: context.root });
  assert.notEqual(rejectedBind.status, 0);
  assert.match(rejectedBind.stderr, /field is not allowed: bound_at/);

  const bindPath = await requestFile(context.requests, "task-bind", bindRequest);
  const bindResult = runCli([
    "task", "create", "bind", "--run-id", context.runId,
    "--file", bindPath, "--json",
  ], { cwd: context.root });
  assertSuccess(bindResult, "visible-task worktree bind");
  assert.equal(JSON.parse(bindResult.stdout).release_permitted, true);

  const releasePath = await requestFile(context.requests, "release-prepare", {
    run_id: context.runId,
    task_contract: contract,
    operation_id: prepared.operation_id,
    prepared_at: new Date().toISOString(),
  });
  const releaseResult = runCli([
    "release", "prepare", "--run-id", context.runId, "--file", releasePath, "--json",
  ], { cwd: context.root });
  assertSuccess(releaseResult, "task release prepare");
  const release = JSON.parse(releaseResult.stdout);
  assert.equal(release.dispatch_permitted, true);
  assert.equal(release.host_request.thread_id, readyThreadId);
  assert.match(release.host_request.prompt, /Codex Flow v0\.7 accepted task release/);
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
    reconciled_at: new Date().toISOString(),
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
    cancelled_at: new Date().toISOString(),
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
  const cleanupResult = runCli([
    "cleanup", "plan", "--run-id", context.runId, "--json",
  ], { cwd: context.root });
  assertSuccess(cleanupResult, "read-only v0.7 cleanup plan");
  const cleanup = JSON.parse(cleanupResult.stdout);
  assert.equal(cleanup.run_id, context.runId);
  assert.equal(cleanup.mutation_performed, false);
  assert.equal(cleanup.counts.close_blocked, 0);
  const cleanupApply = runCli([
    "cleanup", "apply", "--run-id", context.runId, "--json",
  ], { cwd: context.root });
  assert.notEqual(cleanupApply.status, 0);
  assert.match(cleanupApply.stderr, /read-only plan only/);

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
    reason: "Bounded regression terminalizes the run with its admitted fences intact.",
    abandoned_at: "2026-08-29T20:01:30.000Z",
  });
  const abandoned = runCli([
    "run", "abandon", "--run-id", context.runId, "--file", abandonPath, "--json",
  ], { cwd: context.root });
  assertSuccess(abandoned, "run abandonment");
  assert.equal(JSON.parse(abandoned.stdout).run.status, "abandoned");
  assert.deepEqual(
    JSON.parse(abandoned.stdout).run.terminal.unresolved_fences,
    context.result.workflow_authority.fences,
  );

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
  ];
  for (const command of mutations) {
    const result = runCli([
      ...command, "--run-id", context.runId, "--file", inertPath, "--json",
    ], { cwd: context.root });
    assert.notEqual(result.status, 0, `terminal mutation unexpectedly passed: ${command.join(" ")}`);
    assert.match(result.stderr, /v0\.7 run is not active/);
  }

  const rebind = structuredClone(JSON.parse(await readFile(abandonPath, "utf8")));
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
    assert.match(terminalRebind.stderr, /v0\.7 run is not active/);

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
