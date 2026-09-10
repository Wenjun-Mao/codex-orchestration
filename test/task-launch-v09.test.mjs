import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import { registerReportRoute } from "../lib/report-routes.mjs";
import { sha256 } from "../lib/core.mjs";
import { RUNTIME_DIRECTORY, runtimeBundleFilesRoot } from "../lib/runtime-context.mjs";
import {
  prepareTaskLaunch,
  reconcileTaskLaunch,
  recordTaskLaunchAttempt,
  startTaskLaunch,
  taskLaunchIdForContract,
  taskLaunchStatus,
  validateTaskLaunchRecord,
} from "../lib/core/task-launch.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { activateFixtureRun, createGitFixture } from "./helpers.mjs";

const BASE_TIME = Date.parse("2026-09-04T00:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function workflowTask(suffix, overrides = {}) {
  return {
    task_id: `launch-task-${suffix}`,
    title: `Execute first-turn task ${suffix}`,
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded implementation task.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: [`audit-sentinel/${suffix}.txt`],
    shared_resources: [],
    primary_outcome: `Complete first-turn task ${suffix}.`,
    causal_question: null,
    cheapest_safe_direct_attempt: `Run the bounded assignment ${suffix} once.`,
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

async function launchContext(root, suffix, { task = {}, baseTime = BASE_TIME } = {}) {
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const coordinator = {
    lineage_id: `launch-lineage-${suffix}`,
    thread_id: `launch-coordinator-${suffix}`,
    generation: 1,
  };
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `launch-plan-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [workflowTask(suffix, task)],
  });
  const runId = `launch-run-${suffix}`;
  const activated = await activateFixtureRun({
    root,
    runId,
    plan,
    branchFences: [`codex/launch-${suffix}`],
    lineage: coordinator,
    now: baseTime,
  });
  const coordinatorBinding = {
    ...coordinator,
    binding_digest: coordinatorBindingDigest(coordinator),
  };
  const stateRoot = resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY);
  await bindRecipient({
    stateRoot,
    recipient: coordinator,
    fenceToken: activated.run.binding.fence_token,
  });
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: baseTime + 1_000,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: plan.tasks[0].task_id,
    currentBaseline: { revision: baseline },
    dependencyAuthorities: [],
    now: baseTime + 2_000,
  });
  const requestedSelectors = {
    project_id: `project-${suffix}`,
    model: contract.task.model,
    reasoning_effort: contract.task.reasoning_effort,
    worktree: {
      mode: "host-worktree",
      starting_revision: baseline,
      starting_branch: "main",
      executor_branch: `codex/launch-${suffix}`,
      path: null,
    },
  };
  return {
    root,
    commonDir,
    stateRoot,
    baseline,
    coordinator: coordinatorBinding,
    plan,
    runId,
    contract,
    requestedSelectors,
    baseTime,
    runtime: activated.runtime,
  };
}

async function preparedAttempt(context) {
  const prepared = await prepareTaskLaunch({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
    now: context.baseTime + 3_000,
  });
  const attempted = await recordTaskLaunchAttempt({
    stateRoot: context.stateRoot,
    launchId: prepared.launch_id,
    hostSessionId: `session-${context.runId}`,
    timeoutSeconds: 300,
    now: context.baseTime + 4_000,
  });
  return { prepared, attempted };
}

async function linkedWorktree(context, suffix = "executor") {
  const path = resolve(context.root, `../${context.runId}-${suffix}`);
  git(context.root, ["worktree", "add", "--quiet", "--detach", path, context.baseline]);
  return path;
}

async function removeWorktree(context, path) {
  try {
    git(context.root, ["worktree", "remove", "--force", path]);
  } catch {
    // A negative-path test may have removed or never attached the fixture.
  }
  await rm(path, { recursive: true, force: true });
}

function readyEvidence(context, launch, observedAt = context.baseTime + 6_000) {
  return {
    stateRoot: context.stateRoot,
    launchId: launch.launch_id,
    outcome: "ready",
    hostId: "local",
    readyThreadId: `executor-${context.runId}`,
    selectorEvidence: {
      accepted: {
        project_id: context.requestedSelectors.project_id,
        model: context.requestedSelectors.model,
        reasoning_effort: context.requestedSelectors.reasoning_effort,
        observed_at: new Date(observedAt).toISOString(),
      },
      observed: null,
    },
    observedAt: new Date(observedAt).toISOString(),
    now: observedAt,
  };
}

test("launch attempt emits one full first-turn assignment and no release prompt", async (t) => {
  const root = await createGitFixture("codex-flow-v09-launch-prompt-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = await launchContext(root, "prompt");
  const { prepared, attempted } = await preparedAttempt(context);

  assert.match(prepared.launch_id, /^task-launch-v1-[0-9a-f]{64}$/);
  assert.equal(prepared.launch_id, taskLaunchIdForContract({
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
  }));
  assert.equal(attempted.dispatch_permitted, true);
  assert.equal(attempted.host_request.prompt.includes(context.contract.task.primary_outcome), true);
  assert.equal(attempted.host_request.prompt.includes(context.contract.contract_id), true);
  assert.equal(attempted.host_request.prompt.includes("task launch start"), true);
  assert.equal(attempted.host_request.prompt.includes("begin the assignment"), true);
  assert.equal(attempted.host_request.prompt.includes("bootstrap-only"), false);
  assert.equal(attempted.host_request.prompt.includes("awaiting release"), false);
  assert.equal(attempted.host_request.prompt.includes("send_message_to_thread"), false);
  const persistentFields = Object.fromEntries(Object.entries(prepared).filter(([key]) => ![
    "dispatch_permitted", "activation_performed", "execution_permitted", "host_request",
  ].includes(key)));
  assert.deepEqual(validateTaskLaunchRecord(persistentFields), persistentFields);

  const replay = await recordTaskLaunchAttempt({
    stateRoot: context.stateRoot,
    launchId: prepared.launch_id,
    hostSessionId: `session-${context.runId}`,
    timeoutSeconds: 300,
    now: BASE_TIME + 4_000,
  });
  assert.equal(replay.dispatch_permitted, false);
  assert.equal(replay.host_request, null);
});

test("launch identity includes an assignment-generated display title when supplied", async (t) => {
  const root = await createGitFixture("codex-flow-v09-launch-title-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = await launchContext(root, "display-title");
  const taskTitle = "Executor · v0.9.7 · Assignment reporting";
  const prepared = await prepareTaskLaunch({
    stateRoot: context.stateRoot,
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
    taskTitle,
    now: BASE_TIME + 3_000,
  });
  const attempted = await recordTaskLaunchAttempt({
    stateRoot: context.stateRoot,
    launchId: prepared.launch_id,
    hostSessionId: `session-${context.runId}`,
    timeoutSeconds: 300,
    now: BASE_TIME + 4_000,
  });

  assert.equal(prepared.task_title, taskTitle);
  assert.equal(attempted.host_request.title, taskTitle);
  assert.equal(prepared.launch_id, taskLaunchIdForContract({
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
    taskTitle,
  }));
  assert.notEqual(prepared.launch_id, taskLaunchIdForContract({
    taskContract: context.contract,
    requestedSelectors: context.requestedSelectors,
  }));
});

test("executor start can establish exact identity before or after the host result", async (t) => {
  for (const order of ["start-first", "result-first"]) {
    const root = await createGitFixture(`codex-flow-v09-${order}-`);
    const context = await launchContext(root, order);
    const { attempted } = await preparedAttempt(context);
    const worktree = await linkedWorktree(context);
    t.after(async () => {
      await removeWorktree(context, worktree);
      await rm(root, { recursive: true, force: true });
    });
    const executorThreadId = `executor-${context.runId}`;
    let result;
    if (order === "result-first") {
      result = await reconcileTaskLaunch(readyEvidence(context, attempted));
      assert.equal(result.status, "awaiting-start");
    }
    result = await startTaskLaunch({
      stateRoot: context.stateRoot,
      launchId: attempted.launch_id,
      launchNonce: attempted.launch_nonce,
      executorThreadId,
      repositoryPath: worktree,
      now: BASE_TIME + 5_000,
    });
    assert.equal(result.status, "active");
    assert.equal(result.execution_permitted, true);
    assert.equal(result.start_claim.executor_thread_id, executorThreadId);
    assert.equal(git(worktree, ["branch", "--show-current"]), context.requestedSelectors.worktree.executor_branch);
    if (order === "start-first") {
      const reporting = await registerReportRoute({
        stateRoot: context.stateRoot,
        launchId: attempted.launch_id,
        senderHostId: "local",
        recipientHostId: "local",
        now: BASE_TIME + 5_500,
      });
      assert.equal(reporting.status, "registered");
      assert.equal(reporting.route.sender.thread_id, executorThreadId);
      result = await reconcileTaskLaunch(readyEvidence(context, attempted));
      assert.equal(result.status, "active");
    }
    const status = await taskLaunchStatus({ stateRoot: context.stateRoot, launchId: attempted.launch_id });
    assert.equal(status.start_claim.executor_thread_id, executorThreadId);
    assert.equal(status.creation_evidence.ready_thread_id, executorThreadId);
  }
});

test("runtime CLI installs reporting across creation-evidence orderings and resumes a partial start", async (t) => {
  for (const order of [
    "start-first",
    "result-first",
    "opaque-first",
    "opaque-after-start",
    "partial-start",
  ]) {
    const baseTime = Date.now() - 10_000;
    const root = await createGitFixture(`codex-flow-v09-cli-${order}-`);
    const context = await launchContext(root, `cli-${order}`, { baseTime });
    const { attempted } = await preparedAttempt(context);
    const worktree = await linkedWorktree(context);
    t.after(async () => {
      await removeWorktree(context, worktree);
      await rm(root, { recursive: true, force: true });
    });
    const executorThreadId = `executor-${context.runId}`;
    const runtimeCli = resolve(
      runtimeBundleFilesRoot(context.commonDir, context.runtime.bundle.bundle_sha256),
      "bin",
      "codex-flow.mjs",
    );
    const reconcileRequestPath = resolve(root, `reconcile-${order}.json`);
    const opaque = order.startsWith("opaque-");
    await writeFile(reconcileRequestPath, `${JSON.stringify({
      run_id: context.runId,
      launch_id: attempted.launch_id,
      outcome: opaque ? "opaque" : "ready",
      host_id: "fixture-host",
      ...(opaque
        ? { opaque_result: { classification: "unrecognized", fixture: order } }
        : { ready_thread_id: executorThreadId }),
    })}\n`, "utf8");
    const reconcile = () => spawnSync(process.execPath, [
      runtimeCli,
      "task", "launch", "reconcile",
      "--run-id", context.runId,
      "--file", reconcileRequestPath,
      "--json",
    ], {
      cwd: root,
      env: { ...process.env, CODEX_THREAD_ID: context.coordinator.thread_id },
      encoding: "utf8",
    });
    if (["result-first", "opaque-first"].includes(order)) {
      const reconciled = reconcile();
      assert.equal(reconciled.status, 0, reconciled.stderr || reconciled.stdout);
      assert.equal(JSON.parse(reconciled.stdout).status, "awaiting-start");
    }
    if (order === "partial-start") {
      await assert.rejects(startTaskLaunch({
        stateRoot: context.stateRoot,
        launchId: attempted.launch_id,
        launchNonce: attempted.launch_nonce,
        executorThreadId,
        repositoryPath: worktree,
        now: baseTime + 5_000,
        hooks: { afterPreparedIntent: () => { throw new Error("fixture partial start"); } },
      }), /fixture partial start/);
    }
    const started = spawnSync(process.execPath, [
      runtimeCli,
      "task", "launch", "start",
      "--run-id", context.runId,
      "--launch-id", attempted.launch_id,
      "--nonce", attempted.launch_nonce,
      "--json",
    ], {
      cwd: worktree,
      env: { ...process.env, CODEX_THREAD_ID: executorThreadId },
      encoding: "utf8",
    });
    assert.equal(started.status, 0, started.stderr || started.stdout);
    const output = JSON.parse(started.stdout);
    assert.equal(output.status, "active");
    assert.match(output.report_route.route_id, /^report-route-v1-/);
    const locator = JSON.parse(await readFile(resolve(
      context.commonDir,
      "codex-flow",
      "report-locators",
      "records",
      `${sha256(executorThreadId)}.json`,
    ), "utf8"));
    assert.equal(locator.sender_thread_id, executorThreadId);
    assert.equal(locator.route_id, output.report_route.route_id);
    if (!["result-first", "opaque-first"].includes(order)) {
      const reconciled = reconcile();
      assert.equal(reconciled.status, 0, reconciled.stderr || reconciled.stdout);
      assert.equal(JSON.parse(reconciled.stdout).status, "active");
    }
    const status = await taskLaunchStatus({ stateRoot: context.stateRoot, launchId: attempted.launch_id });
    assert.equal(status.start_claim.executor_thread_id, executorThreadId);
    assert.equal(status.creation_evidence.host_id, opaque ? "unknown" : "fixture-host");
  }
});

test("provisional and opaque App results remain non-authoritative until exact task start", async (t) => {
  for (const outcome of ["provisional", "opaque"]) {
    const root = await createGitFixture(`codex-flow-v09-${outcome}-`);
    const context = await launchContext(root, outcome);
    const { attempted } = await preparedAttempt(context);
    const worktree = await linkedWorktree(context);
    t.after(async () => {
      await removeWorktree(context, worktree);
      await rm(root, { recursive: true, force: true });
    });
    const result = await reconcileTaskLaunch({
      stateRoot: context.stateRoot,
      launchId: attempted.launch_id,
      outcome,
      hostId: "local",
      provisionalId: outcome === "provisional" ? "client-new-thread:fixture" : null,
      opaqueEvidence: outcome === "opaque" ? { digest: "a".repeat(64), length: 42 } : null,
      selectorEvidence: {
        accepted: {
          project_id: context.requestedSelectors.project_id,
          model: context.requestedSelectors.model,
          reasoning_effort: context.requestedSelectors.reasoning_effort,
          observed_at: new Date(BASE_TIME + 5_000).toISOString(),
        },
        observed: null,
      },
      observedAt: new Date(BASE_TIME + 5_000).toISOString(),
      now: BASE_TIME + 5_000,
    });
    assert.equal(result.status, "awaiting-start");
    assert.equal(result.execution_permitted, false);
    const active = await startTaskLaunch({
      stateRoot: context.stateRoot,
      launchId: attempted.launch_id,
      launchNonce: attempted.launch_nonce,
      executorThreadId: `executor-${context.runId}`,
      repositoryPath: worktree,
      now: BASE_TIME + 6_000,
    });
    assert.equal(active.status, "active");
  }
});

test("creation replay preserves original evidence timestamps and completed start replays after work advances", async (t) => {
  const root = await createGitFixture("codex-flow-v09-semantic-replay-");
  const context = await launchContext(root, "semantic-replay");
  const { attempted } = await preparedAttempt(context);
  const worktree = await linkedWorktree(context);
  t.after(async () => {
    await removeWorktree(context, worktree);
    await rm(root, { recursive: true, force: true });
  });
  const firstObservedAt = context.baseTime + 5_000;
  const first = await reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt),
    hostId: "local",
  });
  const replay = await reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt + 600_000),
    hostId: "local",
  });
  assert.equal(replay.creation_evidence.observed_at, first.creation_evidence.observed_at);
  assert.equal(
    replay.selector_evidence.accepted.observed_at,
    first.selector_evidence.accepted.observed_at,
  );
  const omittedSelectors = await reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt + 610_000),
    selectorEvidence: null,
  });
  assert.deepEqual(omittedSelectors.selector_evidence, first.selector_evidence);
  await assert.rejects(reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt + 620_000),
    hostId: "different-host",
  }), /conflicts with recorded evidence/);
  await assert.rejects(reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt + 630_000),
    readyThreadId: "different-executor",
  }), /conflicts with recorded evidence/);
  await assert.rejects(reconcileTaskLaunch({
    ...readyEvidence(context, attempted, firstObservedAt + 640_000),
    outcome: "provisional",
    readyThreadId: null,
    provisionalId: "client-new-thread:different",
  }), /conflicts with recorded evidence/);

  const executorThreadId = `executor-${context.runId}`;
  const active = await startTaskLaunch({
    stateRoot: context.stateRoot,
    launchId: attempted.launch_id,
    launchNonce: attempted.launch_nonce,
    executorThreadId,
    repositoryPath: worktree,
    now: context.baseTime + 6_000,
  });
  await writeFile(resolve(worktree, "advanced.txt"), "advanced\n", "utf8");
  git(worktree, ["add", "advanced.txt"]);
  git(worktree, ["commit", "--quiet", "-m", "advance after activation"]);
  const lateReplay = await startTaskLaunch({
    stateRoot: context.stateRoot,
    launchId: attempted.launch_id,
    launchNonce: attempted.launch_nonce,
    executorThreadId,
    repositoryPath: worktree,
    now: context.baseTime + 600_000,
  });
  assert.equal(lateReplay.activation_performed, false);
  assert.equal(lateReplay.git_activation.completed_at, active.git_activation.completed_at);
});

test("task start is crash-resumable on both sides of branch attachment", async (t) => {
  for (const boundary of ["after-intent", "after-switch"]) {
    const root = await createGitFixture(`codex-flow-v09-crash-${boundary}-`);
    const context = await launchContext(root, `crash-${boundary}`);
    const { attempted } = await preparedAttempt(context);
    const worktree = await linkedWorktree(context);
    t.after(async () => {
      await removeWorktree(context, worktree);
      await rm(root, { recursive: true, force: true });
    });
    const hooks = boundary === "after-intent"
      ? { afterPreparedIntent: () => { throw new Error("fixture crash after intent"); } }
      : { afterBranchSwitch: () => { throw new Error("fixture crash after switch"); } };
    await assert.rejects(startTaskLaunch({
      stateRoot: context.stateRoot,
      launchId: attempted.launch_id,
      launchNonce: attempted.launch_nonce,
      executorThreadId: `executor-${context.runId}`,
      repositoryPath: worktree,
      now: BASE_TIME + 5_000,
      hooks,
    }), /fixture crash/);
    const recovered = await startTaskLaunch({
      stateRoot: context.stateRoot,
      launchId: attempted.launch_id,
      launchNonce: attempted.launch_nonce,
      executorThreadId: `executor-${context.runId}`,
      repositoryPath: worktree,
      now: BASE_TIME + 6_000,
    });
    assert.equal(recovered.status, "active");
    assert.equal(git(worktree, ["branch", "--show-current"]), context.requestedSelectors.worktree.executor_branch);
  }
});

test("task start rejects coordinator, dirty, wrong identity, nonce, and returned-ID contradictions", async (t) => {
  const root = await createGitFixture("codex-flow-v09-negative-");
  const context = await launchContext(root, "negative");
  const { attempted } = await preparedAttempt(context);
  const worktree = await linkedWorktree(context);
  t.after(async () => {
    await removeWorktree(context, worktree);
    await rm(root, { recursive: true, force: true });
  });
  const base = {
    stateRoot: context.stateRoot,
    launchId: attempted.launch_id,
    launchNonce: attempted.launch_nonce,
    executorThreadId: `executor-${context.runId}`,
    repositoryPath: worktree,
    now: BASE_TIME + 5_000,
  };
  await assert.rejects(startTaskLaunch({ ...base, launchNonce: "0".repeat(64) }), /nonce does not match/);
  await assert.rejects(startTaskLaunch({ ...base, repositoryPath: root }), /coordinator checkout|source checkout/);
  await writeFile(resolve(worktree, "untracked.txt"), "dirty\n", "utf8");
  await assert.rejects(startTaskLaunch(base), /must be pristine/);
  await rm(resolve(worktree, "untracked.txt"));
  const active = await startTaskLaunch(base);
  assert.equal(active.status, "active");
  await assert.rejects(startTaskLaunch({ ...base, executorThreadId: "different-executor" }), /different executor/);
  await assert.rejects(reconcileTaskLaunch({
    ...readyEvidence(context, attempted),
    readyThreadId: "different-executor",
  }), /contradicts the executor start claim/);
});

test("task start rejects another repository and a drifted baseline", async (t) => {
  const root = await createGitFixture("codex-flow-v09-negative-git-");
  const foreign = await createGitFixture("codex-flow-v09-negative-foreign-");
  const context = await launchContext(root, "negative-git");
  const { attempted } = await preparedAttempt(context);
  const driftedWorktree = resolve(root, `../${context.runId}-drifted`);
  t.after(async () => {
    await removeWorktree(context, driftedWorktree);
    await rm(root, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  });
  const base = {
    stateRoot: context.stateRoot,
    launchId: attempted.launch_id,
    launchNonce: attempted.launch_nonce,
    executorThreadId: `executor-${context.runId}`,
    now: BASE_TIME + 5_000,
  };
  await assert.rejects(
    startTaskLaunch({ ...base, repositoryPath: foreign }),
    /wrong repository|common directory/,
  );

  await writeFile(resolve(root, "later.txt"), "later baseline\n", "utf8");
  git(root, ["add", "later.txt"]);
  git(root, ["commit", "--quiet", "-m", "later baseline"]);
  git(root, ["worktree", "add", "--quiet", "--detach", driftedWorktree, "HEAD"]);
  await assert.rejects(
    startTaskLaunch({ ...base, repositoryPath: driftedWorktree }),
    /starting revision|baseline/,
  );
});

test("task start rejects an existing reserved branch before attachment", async (t) => {
  const root = await createGitFixture("codex-flow-v09-negative-branch-");
  const context = await launchContext(root, "negative-branch");
  const { attempted } = await preparedAttempt(context);
  const worktree = await linkedWorktree(context);
  t.after(async () => {
    await removeWorktree(context, worktree);
    try {
      git(root, ["branch", "-D", context.requestedSelectors.worktree.executor_branch]);
    } catch {
      // The start must not remove a pre-existing branch.
    }
    await rm(root, { recursive: true, force: true });
  });
  git(root, ["branch", context.requestedSelectors.worktree.executor_branch, context.baseline]);
  await assert.rejects(startTaskLaunch({
    stateRoot: context.stateRoot,
    launchId: attempted.launch_id,
    launchNonce: attempted.launch_nonce,
    executorThreadId: `executor-${context.runId}`,
    repositoryPath: worktree,
    now: BASE_TIME + 5_000,
  }), /pristine detached launch worktree|branch already exists/);
});

test("task-launch schema describes the persistent first-turn lifecycle", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../schemas/task-launch.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.launch_id.pattern, "^task-launch-v1-[0-9a-f]{64}$");
  assert.equal(schema.required.includes("task_contract"), true);
  assert.equal(schema.required.includes("initial_prompt_digest"), true);
  assert.equal(JSON.stringify(schema).includes("release_id"), false);
  assert.equal(JSON.stringify(schema).includes("bootstrap_digest"), false);
});
