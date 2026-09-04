import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  preflightVisibleTaskBranchReservations,
  prepareVisibleTaskCreation,
  reconcileVisibleTaskCreation,
  recordVisibleTaskCreationAttempt,
  resolvePrivateVisibleTaskCreation,
  resolvePrivateVisibleTaskCreationRecord,
  validateVisibleTaskCreationRecord,
  visibleTaskCreationStatus,
} from "../lib/task-creation-v07.mjs";
import { recoverV081PrivateTaskResolution } from "../lib/private-resolution-recovery-v08.mjs";
import {
  coordinatorBindingDigest,
  createWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import {
  createWorkflowJournal,
  persistWorkflowTaskContract,
} from "../lib/workflow-journal-v07.mjs";
import {
  createGitFixture,
  packageRoot,
  removeFixture,
} from "./helpers.mjs";
import {
  acquireRuntimeContext,
  buildRuntimeContext,
  loadRuntimeBundleSource,
} from "../lib/runtime-context.mjs";
import { admitRun, buildFencePlan } from "../lib/run-lifecycle.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";

const START = Date.parse("2026-08-29T20:00:00.000Z");

function visibleTask(overrides = {}) {
  return {
    task_id: "visible-implementation",
    title: "Implement the bounded visible task",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Use the implementation model lane for the bounded visible write.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["lib/bounded-visible-task.mjs"],
    shared_resources: [],
    primary_outcome: "Complete one bounded implementation in a visible task.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Create the exact task once and execute its generated contract.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
    ...overrides,
  };
}

async function fixture({
  tasks = [visibleTask()],
  branchFences = ["codex/visible-implementation"],
} = {}) {
  const root = await createGitFixture("codex-flow-visible-create-");
  const commonDir = await realpath(resolve(root, ".git"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const plan = createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: "visible-task-creation",
    revision: 1,
    parent_revision_digest: null,
    tasks,
  });
  const coordinator = {
    lineage_id: "coordinator-lineage",
    thread_id: "coordinator-thread",
    generation: 1,
  };
  coordinator.binding_digest = coordinatorBindingDigest(coordinator);
  const stateRoot = resolve(commonDir, "codex-flow", "v0.8.2");
  const runId = "run-visible-task";
  const snapshot = gitSnapshot(root);
  const bundleSource = await loadRuntimeBundleSource({ packageRoot });
  const runtime = buildRuntimeContext({
    bundle: bundleSource.bundle,
    createdAt: new Date(START - 3_000).toISOString(),
    config: { config_id: "visible-create-config", snapshot: {} },
    policy: { policy_id: "visible-create-policy", snapshot: {} },
    repository: {
      common_dir: snapshot.commonDir,
      root: snapshot.root,
      branch: snapshot.branch,
      revision: snapshot.revision,
    },
    host: { host_id: "visible-create-host", session_id: "visible-create-session" },
    lineage: {
      lineage_id: coordinator.lineage_id,
      thread_id: coordinator.thread_id,
      generation: coordinator.generation,
    },
  });
  await acquireRuntimeContext({
    gitCommonDirectory: commonDir,
    context: runtime,
    bundleSource,
  });
  await admitRun({
    gitCommonDirectory: commonDir,
    runId,
    runtimeId: runtime.runtime_id,
    workflowPlanId: plan.plan_id,
    workflowRevisionDigest: plan.revision_digest,
    plan: buildFencePlan({
      pathFences: tasks.flatMap((task) => task.write_paths),
      branchFences,
    }),
    admittedAt: new Date(START - 3_000).toISOString(),
  });
  await createWorkflowJournal({
    stateRoot,
    runId,
    planId: plan.plan_id,
    planRevision: plan,
    now: START - 2_000,
  });
  const contract = await persistWorkflowTaskContract({
    stateRoot,
    runId,
    planId: plan.plan_id,
    taskId: "visible-implementation",
    currentBaseline: { revision },
    dependencyAuthorities: [],
    now: START - 1_000,
  });
  const requested = {
    project_id: "saved-project-id",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    worktree: {
      mode: "host-worktree",
      starting_revision: revision,
      starting_branch: "codex/v0.7",
      executor_branch: "codex/visible-implementation",
      path: null,
    },
  };
  return {
    root,
    stateRoot,
    contract,
    requested,
    commonDir,
    revision,
    runId,
    plan,
  };
}

function acceptedSelectors(requested, at = START + 500) {
  return {
    project_id: requested.project_id,
    model: requested.model,
    reasoning_effort: requested.reasoning_effort,
    worktree: requested.worktree,
    accepted_at: new Date(at).toISOString(),
  };
}

async function seedPrivateTaskEvidence({
  codexHome,
  context,
  attempt,
  provisionalClientThreadId,
  readyThreadId,
  provisionalObservedAt = START + 1_000,
  delegationObservedAt = START + 1_700,
  selectorObservedAt = START + 1_600,
}) {
  const atom = {
    "client-thread-bindings-v1": { [provisionalClientThreadId]: readyThreadId },
    [`thread-client-id-v1:${encodeURIComponent(`local:${readyThreadId}`)}`]: provisionalClientThreadId,
    "electron:last-seen-changelog-release-family": "26.727",
  };
  await writeFile(
    resolve(codexHome, ".codex-global-state.json"),
    JSON.stringify({ "electron-persisted-atom-state": atom }),
  );
  const sessionDirectory = resolve(codexHome, "sessions", "2026", "08", "29");
  await mkdir(sessionDirectory, { recursive: true });
  const sourceThreadId = context.contract.coordinator_binding.thread_id;
  const sourceRows = [
    {
      timestamp: new Date(START + 100).toISOString(),
      type: "session_meta",
      payload: { id: sourceThreadId },
    },
    {
      timestamp: new Date(provisionalObservedAt).toISOString(),
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: sourceThreadId,
        item: {
          type: "McpToolCall",
          status: "completed",
          server: "codex_app",
          tool: "create_thread",
          arguments: {
            prompt: attempt.bootstrap,
            title: context.contract.task.title,
            model: context.requested.model,
            thinking: context.requested.reasoning_effort,
            target: {
              type: "project",
              projectId: context.requested.project_id,
              environment: {
                type: context.requested.worktree.mode === "host-worktree" ? "worktree" : "local",
                ...(context.requested.worktree.mode === "host-worktree"
                  ? {
                    startingState: {
                      type: "branch",
                      branchName: context.requested.worktree.starting_branch,
                    },
                  }
                  : {}),
              },
            },
          },
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({ clientThreadId: provisionalClientThreadId, hostId: "local" }),
            }],
            isError: false,
          },
        },
      },
    },
  ];
  await writeFile(
    resolve(sessionDirectory, `rollout-fixture-${sourceThreadId}.jsonl`),
    `${sourceRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const turnId = `private-initial-turn-${readyThreadId}`;
  const delegation = [
    "<codex_delegation>",
    `  <source_thread_id>${context.contract.coordinator_binding.thread_id}</source_thread_id>`,
    `  <input>${attempt.bootstrap}</input>`,
    "</codex_delegation>",
  ].join("\n");
  const rows = [
    {
      timestamp: new Date(START + 1_500).toISOString(),
      type: "session_meta",
      payload: {
        id: readyThreadId,
        thread_source: "agent_created_thread",
        cwd: resolve(codexHome, "worktrees", "private", "repository"),
        cli_version: "0.152.0",
        git: { commit_hash: context.revision },
      },
    },
    {
      timestamp: new Date(START + 1_500).toISOString(),
      type: "event_msg",
      payload: { type: "task_started", turn_id: turnId },
    },
    {
      timestamp: new Date(selectorObservedAt).toISOString(),
      type: "turn_context",
      payload: {
        turn_id: turnId,
        model: context.requested.model,
        effort: context.requested.reasoning_effort,
      },
    },
    {
      timestamp: new Date(delegationObservedAt).toISOString(),
      type: "response_item",
      payload: {
        type: "function_call_output",
        namespace: "codex_app",
        name: "create_thread",
        output: delegation,
      },
    },
    {
      timestamp: new Date(Math.max(delegationObservedAt, selectorObservedAt) + 100).toISOString(),
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turnId },
    },
  ];
  await writeFile(
    resolve(sessionDirectory, `rollout-fixture-${readyThreadId}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

async function visibleCreationStateFiles(stateRoot) {
  const root = resolve(stateRoot, "visible-task-creations");
  const entries = await Promise.all(["claims", "records"].map(async (directory) => (
    (await readdir(resolve(root, directory)).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })).map((name) => `${directory}/${name}`)
  )));
  return entries.flat().sort();
}

test("one-shot visible creation binds provisional and ready identities through the exact launch nonce", async () => {
  const context = await fixture();
  const provisionalClientThreadId = "client-new-thread:89fe4605-fa97-4b2b-8722-39a4aa8644fa";
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.attempt_permitted, true);
    assert.equal(prepared.selector_rationale, context.contract.task.selector_rationale);
    assert.match(prepared.operation_id, /^visible-task-operation-v1-[0-9a-f]{64}$/);
    const {
      attempt_permitted: _attemptPermitted,
      binding_permitted: _bindingPermitted,
      release_permitted: _releasePermitted,
      reconciliation_open: _reconciliationOpen,
      ...durablePrepared
    } = prepared;
    assert.deepEqual(validateVisibleTaskCreationRecord(durablePrepared), durablePrepared);
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-1",
      timeoutSeconds: 300,
      now: START,
    });
    assert.equal(attempt.status, "attempting");
    assert.equal(attempt.dispatch_permitted, true);
    assert.match(attempt.bootstrap, new RegExp(`CODEX_FLOW_LAUNCH_NONCE=${attempt.launch_nonce}`));
    assert.equal(attempt.host_request.prompt, attempt.bootstrap);

    const provisional = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "provisional",
      provisionalClientThreadId,
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: null,
      },
      now: START + 1_000,
    });
    assert.equal(provisional.status, "provisional");
    assert.equal(provisional.release_permitted, false);
    assert.equal(provisional.provisional.client_thread_id, provisionalClientThreadId);

    await assert.rejects(
      () => reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "provisional",
        provisionalClientThreadId,
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: {
            project_id: null,
            model: null,
            reasoning_effort: null,
            worktree: null,
            observed_at: new Date(START + 1_500).toISOString(),
          },
        },
        now: START + 1_500,
      }),
      /observed selectors before ready task identity/,
    );
    assert.equal((await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 1_500,
    })).selector_evidence.observed, null);

    await assert.rejects(
      () => reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ambiguous",
        provisionalClientThreadId,
        reasonCode: "identity-evidence-missing",
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: {
            project_id: null,
            model: null,
            reasoning_effort: null,
            worktree: null,
            observed_at: new Date(START + 1_600).toISOString(),
          },
        },
        now: START + 1_600,
      }),
      /observed selectors before ready task identity/,
    );

    await assert.rejects(
      () => reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        provisionalClientThreadId,
        readyThreadId: "ready-thread-1",
        initialTurn: {
          source: "host-observed",
          thread_id: "ready-thread-1",
          turn_id: "initial-user-turn-injected",
          turn_index: 1,
          role: "user",
          content: `${attempt.bootstrap}\nInjected objective text.`,
          observed_at: new Date(START + 2_000).toISOString(),
        },
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 2_000,
      }),
      /exact canonical bootstrap-only/,
    );

    const ready = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ready",
      provisionalClientThreadId,
      readyThreadId: "ready-thread-1",
      initialTurn: {
        source: "host-observed",
        thread_id: "ready-thread-1",
        turn_id: "initial-user-turn-1",
        turn_index: 1,
        role: "user",
        content: attempt.bootstrap,
        observed_at: new Date(START + 2_000).toISOString(),
      },
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: {
          project_id: null,
          model: null,
          reasoning_effort: null,
          worktree: null,
          observed_at: new Date(START + 2_000).toISOString(),
        },
      },
      now: START + 2_000,
    });
    assert.equal(ready.status, "ready-unreleased");
    assert.equal(ready.binding_permitted, false);
    assert.equal(ready.release_permitted, false);
    assert.equal(ready.ready.thread_id, "ready-thread-1");
    assert.notEqual(ready.provisional.client_thread_id, ready.ready.thread_id);
    assert.equal(ready.selector_evidence.accepted.model, "gpt-5.6-terra");
    assert.equal(ready.selector_evidence.observed.model, null);
    assert.equal(ready.selector_evidence.observed.reasoning_effort, null);

    const replay = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ready",
      provisionalClientThreadId,
      readyThreadId: "ready-thread-1",
      initialTurn: {
        source: "host-observed",
        thread_id: "ready-thread-1",
        turn_id: "initial-user-turn-1",
        turn_index: 1,
        role: "user",
        content: attempt.bootstrap,
        observed_at: new Date(START + 2_000).toISOString(),
      },
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested),
        observed: {
          project_id: null,
          model: null,
          reasoning_effort: null,
          worktree: null,
          observed_at: new Date(START + 2_000).toISOString(),
        },
      },
      now: START + 9_000,
    });
    assert.equal(replay.ready.recorded_at, ready.ready.recorded_at);
  } finally {
    await removeFixture(context.root);
  }
});

test("explicit private resolution binds the exact provisional ID to delegated bootstrap evidence", async () => {
  const context = await fixture();
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-private-ready-"));
  const provisionalClientThreadId = "client-new-thread:private-resolution-fixture";
  const readyThreadId = "ready-private-task-1";
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "private-resolution-session",
      timeoutSeconds: 300,
      now: START,
    });
    await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "provisional",
      provisionalClientThreadId,
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested, START + 1_200),
        observed: null,
      },
      now: START + 1_200,
    });

    await seedPrivateTaskEvidence({
      codexHome,
      context,
      attempt,
      provisionalClientThreadId,
      readyThreadId,
    });

    const recovered = await resolvePrivateVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      codexHome,
      now: START + 2_000,
    });
    assert.equal(recovered.private_host_surface, true);
    assert.equal(recovered.reconcile_request.ready_thread_id, readyThreadId);
    assert.equal(
      recovered.reconcile_request.private_resolution.provisional_client_thread_id,
      provisionalClientThreadId,
    );
    const request = recovered.reconcile_request;
    assert.equal(Object.hasOwn(request, "reconciled_at"), false);
    const ready = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: request.selector_evidence,
      now: START + 2_000,
    });
    assert.equal(ready.status, "ready-unreleased");
    assert.equal(ready.ready.initial_turn.source, "codex-app-private-delegation-v1");
    assert.equal(ready.private_resolution.ready_thread_id, readyThreadId);
    const stored = JSON.parse(await readFile(resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${prepared.operation_id}.json`,
    ), "utf8"));
    stored.private_resolution.state_digest = "f".repeat(64);
    assert.throws(
      () => validateVisibleTaskCreationRecord(stored),
      /private task resolution binding_digest is invalid/i,
    );
    const unavailableVersion = JSON.parse(await readFile(resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${prepared.operation_id}.json`,
    ), "utf8"));
    unavailableVersion.private_resolution.app_version = "26.831.20005";
    assert.throws(
      () => validateVisibleTaskCreationRecord(unavailableVersion),
      /cannot claim an unavailable exact App version/,
    );

    const replay = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: request.selector_evidence,
      now: START + 400_000,
    });
    assert.equal(replay.updated_at, ready.updated_at);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(context.root);
  }
});

test("v0.8.2 recovers an exact v0.8.1 private request without mutating source Flow state", async () => {
  const context = await fixture();
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-v081-private-recovery-"));
  const provisionalClientThreadId = "client-new-thread:v081-private-recovery";
  const readyThreadId = "ready-v081-private-recovery";
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "v081-private-recovery-session",
      timeoutSeconds: 300,
      now: START,
    });
    await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "provisional",
      provisionalClientThreadId,
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested, START + 1_200),
        observed: null,
      },
      now: START + 1_200,
    });
    await seedPrivateTaskEvidence({
      codexHome,
      context,
      attempt,
      provisionalClientThreadId,
      readyThreadId,
    });
    const recordPath = resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${prepared.operation_id}.json`,
    );
    const before = await readFile(recordPath, "utf8");
    const creation = validateVisibleTaskCreationRecord(JSON.parse(before));
    const source = {
      namespace: "v0.8.1",
      runtime: {
        adapter: "v0.8-source-export",
        cli_path: "/immutable/v0.8.1/bin/codex-flow.mjs",
        manifest: {
          package_version: "0.8.1",
          bundle_sha256: "a".repeat(64),
        },
      },
      lifecycle: { active_run_id: context.runId },
      run: {
        run_id: context.runId,
        status: "active",
        runtime_id: "b".repeat(64),
        runtime_context_hash: creation.runtime_context_digest,
        binding: { lineage: { thread_id: "coordinator-thread" } },
      },
      task_states: [{
        task: visibleTask(),
        contract: context.contract,
        creation,
      }],
    };
    const recovered = await recoverV081PrivateTaskResolution({
      source,
      runId: context.runId,
      operationId: prepared.operation_id,
      coordinatorThreadId: "coordinator-thread",
      codexHome,
      now: START + 2_000,
    });
    assert.equal(recovered.source_authority.namespace, "v0.8.1");
    assert.equal(
      recovered.source_authority.source_cli_path,
      "/immutable/v0.8.1/bin/codex-flow.mjs",
    );
    assert.equal(recovered.reconcile_request.ready_thread_id, readyThreadId);
    assert.equal(await readFile(recordPath, "utf8"), before);
    await assert.rejects(
      recoverV081PrivateTaskResolution({
        source,
        runId: context.runId,
        operationId: prepared.operation_id,
        coordinatorThreadId: "different-coordinator",
        codexHome,
        now: START + 2_000,
      }),
      /does not match the active coordinator run/,
    );
    const direct = await resolvePrivateVisibleTaskCreationRecord({
      record: creation,
      codexHome,
      now: START + 2_000,
    });
    assert.deepEqual(direct.reconcile_request, recovered.reconcile_request);
    for (const malformed of [
      null,
      { ...source, runtime: null },
      { ...source, run: null },
      { ...source, task_states: null },
    ]) {
      await assert.rejects(
        recoverV081PrivateTaskResolution({
          source: malformed,
          runId: context.runId,
          operationId: prepared.operation_id,
          coordinatorThreadId: "coordinator-thread",
          codexHome,
          now: START + 2_000,
        }),
        /source authority is malformed/,
      );
    }
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(context.root);
  }
});

test("title and timing similarity never recover a ready task without exact initial-turn nonce evidence", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-ambiguous",
      timeoutSeconds: 60,
      now: START,
    });
    await assert.rejects(
      reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        readyThreadId: "similar-title-thread",
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      }),
      /exact initial host-visible turn evidence/,
    );
    await assert.rejects(
      reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        readyThreadId: "similar-title-thread",
        initialTurn: {
          source: "host-observed",
          thread_id: "similar-title-thread",
          turn_id: "similar-time-turn",
          turn_index: 1,
          role: "user",
          content: `${attempt.host_request.title}\nCODEX_FLOW_LAUNCH_NONCE=${"f".repeat(64)}`,
          observed_at: new Date(START + 1_000).toISOString(),
        },
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      }),
      /exact launch nonce/,
    );
    const ambiguous = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "ambiguous",
      reasonCode: "identity-evidence-missing",
      now: START + 2_000,
    });
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.release_permitted, false);
    assert.equal((await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 3_000,
    })).status, "ambiguous");
  } finally {
    await removeFixture(context.root);
  }
});

test("only exact expired ambiguity recovers from timely private host evidence", async () => {
  const context = await fixture();
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-private-late-ready-"));
  const provisionalClientThreadId = "client-new-thread:late-private-resolution";
  const readyThreadId = "ready-private-task-late";
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "deadline-session",
      timeoutSeconds: 5,
      now: START,
    });
    await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      outcome: "provisional",
      provisionalClientThreadId,
      selectorEvidence: {
        accepted: acceptedSelectors(context.requested, START + 1_200),
        observed: null,
      },
      now: START + 1_200,
    });
    await seedPrivateTaskEvidence({
      codexHome,
      context,
      attempt,
      provisionalClientThreadId,
      readyThreadId,
      selectorObservedAt: START + 3_500,
      delegationObservedAt: START + 4_000,
    });
    const expired = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 5_000,
    });
    assert.equal(expired.status, "ambiguous");
    assert.equal(expired.resolution.reason_code, "reconciliation-window-expired");
    const expiredResolutionDigest = sha256(stableStringify(expired.resolution));

    const recovered = await resolvePrivateVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      codexHome,
      now: START + 9_000,
    });
    const request = recovered.reconcile_request;
    const ready = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: request.selector_evidence,
      now: START + 9_000,
    });
    assert.equal(ready.status, "ready-unreleased");
    assert.equal(ready.operation_id, prepared.operation_id);
    assert.equal(ready.attempt.attempt_id, attempt.attempt.attempt_id);
    assert.deepEqual(ready.resolution, expired.resolution);
    assert.equal(
      ready.late_private_recovery.expired_resolution_digest,
      expiredResolutionDigest,
    );
    assert.equal(ready.late_private_recovery.source, "codex-app-private-state-v1");
    assert.equal(ready.late_private_recovery.recovered_at, new Date(START + 9_000).toISOString());
    assert.equal(ready.attempt_permitted, false);
    assert.equal(ready.reconciliation_open, false);
    const tampered = JSON.parse(await readFile(resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${prepared.operation_id}.json`,
    ), "utf8"));
    tampered.late_private_recovery.expired_resolution_digest = "f".repeat(64);
    assert.throws(
      () => validateVisibleTaskCreationRecord(tampered),
      /does not bind the exact expired reconciliation evidence/,
    );

    const replay = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: request.selector_evidence,
      now: START + 20_000,
    });
    assert.deepEqual(replay.late_private_recovery, ready.late_private_recovery);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(context.root);
  }
});

test("expired creation rejects direct host evidence even when its event was timely", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "late-event-session",
      timeoutSeconds: 5,
      now: START,
    });
    await assert.rejects(
      reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ready",
        readyThreadId: "ready-after-deadline",
        initialTurn: {
          source: "host-observed",
          thread_id: "ready-after-deadline",
          turn_id: "turn-before-deadline",
          turn_index: 1,
          role: "user",
          content: attempt.bootstrap,
          observed_at: new Date(START + 4_000).toISOString(),
        },
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 9_000,
      }),
      /recover only from authenticated private task evidence/,
    );
    const status = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 9_000,
    });
    assert.equal(status.status, "ambiguous");
    assert.equal(status.resolution.reason_code, "reconciliation-window-expired");
    assert.equal(status.reconciliation_open, false);
  } finally {
    await removeFixture(context.root);
  }
});

test("exact expiry may durably add a timely source-authenticated provisional identity", async () => {
  const context = await fixture();
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-late-first-provisional-"));
  const provisionalClientThreadId = "client-new-thread:late-first-provisional";
  const readyThreadId = "ready-late-first-provisional";
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const attempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "late-first-provisional-session",
      now: START,
    });
    await seedPrivateTaskEvidence({
      codexHome,
      context,
      attempt,
      provisionalClientThreadId,
      readyThreadId,
      provisionalObservedAt: START + 1_200,
      selectorObservedAt: START + 1_600,
      delegationObservedAt: START + 1_700,
    });
    const expired = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 300_000,
    });
    assert.equal(expired.status, "ambiguous");
    assert.equal(expired.provisional, null);
    const resolved = await resolvePrivateVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      codexHome,
      now: START + 309_000,
    });
    const request = resolved.reconcile_request;
    await assert.rejects(reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: {
        accepted: {
          ...request.selector_evidence.accepted,
          accepted_at: new Date(START + 1_300).toISOString(),
        },
        observed: request.selector_evidence.observed,
      },
      now: START + 309_000,
    }), /source creation event/);
    const ready = await reconcileVisibleTaskCreation({
      stateRoot: context.stateRoot,
      operationId: request.operation_id,
      outcome: request.outcome,
      provisionalClientThreadId: request.provisional_client_thread_id,
      readyThreadId: request.ready_thread_id,
      initialTurn: request.initial_turn,
      privateResolution: request.private_resolution,
      selectorEvidence: request.selector_evidence,
      now: START + 309_000,
    });
    assert.equal(ready.status, "ready-unreleased");
    assert.equal(ready.provisional.client_thread_id, provisionalClientThreadId);
    assert.equal(ready.provisional.observed_at, new Date(START + 1_200).toISOString());
    assert.equal(ready.provisional.recorded_at, new Date(START + 309_000).toISOString());
    assert.equal(ready.private_resolution.provisional_observed_at, ready.provisional.observed_at);
    assert.deepEqual(ready.resolution, expired.resolution);
    assert.equal(ready.late_private_recovery !== null, true);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await removeFixture(context.root);
  }
});

test("late private recovery rejects deadline events, other ambiguity, and missing provisional identity", async (t) => {
  await t.test("event at deadline", async () => {
    const context = await fixture();
    const codexHome = await mkdtemp(resolve(tmpdir(), "codex-flow-private-deadline-"));
    try {
      const prepared = await prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START,
      });
      const attempt = await recordVisibleTaskCreationAttempt({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        hostSessionId: "private-deadline-session",
        timeoutSeconds: 5,
        now: START,
      });
      const provisionalClientThreadId = "client-new-thread:private-deadline";
      await reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "provisional",
        provisionalClientThreadId,
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      });
      await seedPrivateTaskEvidence({
        codexHome,
        context,
        attempt,
        provisionalClientThreadId,
        readyThreadId: "ready-private-deadline",
        selectorObservedAt: START + 4_000,
        delegationObservedAt: START + 5_000,
      });
      await assert.rejects(resolvePrivateVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        codexHome,
        now: START + 9_000,
      }), /falls outside the open reconciliation window/);
      const status = await visibleTaskCreationStatus({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        now: START + 10_000,
      });
      assert.equal(status.status, "ambiguous");
      assert.equal(status.resolution.reason_code, "reconciliation-window-expired");
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      await removeFixture(context.root);
    }
  });

  await t.test("non-expiry ambiguity", async () => {
    const context = await fixture();
    try {
      const prepared = await prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START,
      });
      await recordVisibleTaskCreationAttempt({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        hostSessionId: "private-other-ambiguity",
        timeoutSeconds: 30,
        now: START,
      });
      await reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "provisional",
        provisionalClientThreadId: "client-new-thread:other-ambiguity",
        selectorEvidence: {
          accepted: acceptedSelectors(context.requested),
          observed: null,
        },
        now: START + 1_000,
      });
      await reconcileVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        outcome: "ambiguous",
        reasonCode: "identity-evidence-missing",
        now: START + 2_000,
      });
      await assert.rejects(resolvePrivateVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        codexHome: resolve(context.root, ".codex-home-missing"),
        now: START + 3_000,
      }), /exact expired ambiguity/);
    } finally {
      await removeFixture(context.root);
    }
  });

  await t.test("no provisional identity", async () => {
    const context = await fixture();
    try {
      const prepared = await prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START,
      });
      await recordVisibleTaskCreationAttempt({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        hostSessionId: "private-no-provisional",
        timeoutSeconds: 5,
        now: START,
      });
      await assert.rejects(resolvePrivateVisibleTaskCreation({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        codexHome: resolve(context.root, ".codex-home-missing"),
        now: START + 6_000,
      }), /Codex App sessions root is unavailable/);
      const status = await visibleTaskCreationStatus({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        now: START + 7_000,
      });
      assert.equal(status.status, "ambiguous");
      assert.equal(status.provisional, null);
    } finally {
      await removeFixture(context.root);
    }
  });
});

test("a generated visible-task contract authorizes exactly one native creation attempt", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const replayedPreparation = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START + 5_000,
    });
    assert.equal(replayedPreparation.operation_id, prepared.operation_id);
    assert.equal(replayedPreparation.launch_nonce, prepared.launch_nonce);

    const firstAttempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-once",
      timeoutSeconds: 30,
      now: START,
    });
    assert.equal(firstAttempt.dispatch_permitted, true);
    const replayedAttempt = await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      hostSessionId: "desktop-session-once",
      timeoutSeconds: 30,
      now: START + 1_000,
    });
    assert.equal(replayedAttempt.dispatch_permitted, false);
    assert.equal(Object.hasOwn(replayedAttempt, "bootstrap"), false);
    await assert.rejects(
      recordVisibleTaskCreationAttempt({
        stateRoot: context.stateRoot,
        operationId: prepared.operation_id,
        hostSessionId: "different-session",
        timeoutSeconds: 30,
        now: START + 1_000,
      }),
      /different one-shot attempt/,
    );
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: { ...context.requested, project_id: "different-project" },
        now: START + 2_000,
      }),
      /already claimed by a different creation request/,
    );

    const expired = await visibleTaskCreationStatus({
      stateRoot: context.stateRoot,
      operationId: prepared.operation_id,
      now: START + 31_000,
    });
    assert.equal(expired.status, "ambiguous");
    assert.equal(expired.resolution.reason_code, "reconciliation-window-expired");
    assert.equal(expired.reconciliation_open, false);
    assert.equal(expired.attempt_permitted, false);
  } finally {
    await removeFixture(context.root);
  }
});

test("visible preparation rejects stale and cross-task journal timestamps without native residue", async () => {
  const secondTask = visibleTask({
    task_id: "visible-later-contract",
    title: "Persist a later visible contract",
    read_paths: ["README.md"],
    write_paths: ["audit-sentinel/later-visible.txt"],
  });
  const context = await fixture({ tasks: [visibleTask(), secondTask] });
  try {
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START - 2_000,
      }),
      /preparation predates its contract claim/,
    );
    assert.deepEqual(await visibleCreationStateFiles(context.stateRoot), []);

    const later = await persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      taskId: secondTask.task_id,
      currentBaseline: { revision: context.revision },
      dependencyAuthorities: [],
      now: START + 1_000,
    });
    assert.equal(later.task_id, secondTask.task_id);
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START,
      }),
      /preparation predates the workflow journal/,
    );
    assert.deepEqual(await visibleCreationStateFiles(context.stateRoot), []);

    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START + 1_000,
    });
    assert.equal(prepared.status, "prepared");
    assert.equal((await visibleCreationStateFiles(context.stateRoot)).length, 2);
  } finally {
    await removeFixture(context.root);
  }
});

test("only an exact visible pre-dispatch orphan is recovered", async () => {
  const context = await fixture();
  const journalPath = resolve(
    context.stateRoot,
    "workflows",
    context.runId,
    context.plan.plan_id,
    "journal.json",
  );
  try {
    const unstartedJournal = await readFile(journalPath, "utf8");
    const first = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    await writeFile(journalPath, unstartedJournal, "utf8");
    const recovered = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START + 1_000,
    });
    assert.equal(recovered.operation_id, first.operation_id);
    assert.notEqual(recovered.launch_nonce, first.launch_nonce);

    await recordVisibleTaskCreationAttempt({
      stateRoot: context.stateRoot,
      operationId: recovered.operation_id,
      hostSessionId: "visible-recovery-attempt",
      timeoutSeconds: 60,
      now: START + 2_000,
    });
    await writeFile(journalPath, unstartedJournal, "utf8");
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START + 3_000,
      }),
      /Workflow native operation exists without its durable claim transition/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("an exact visible claim-only pre-dispatch crash is recovered without a host attempt", async () => {
  const context = await fixture();
  const journalPath = resolve(
    context.stateRoot,
    "workflows",
    context.runId,
    context.plan.plan_id,
    "journal.json",
  );
  try {
    const unstartedJournal = await readFile(journalPath, "utf8");
    const first = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    await unlink(resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${first.operation_id}.json`,
    ));
    await writeFile(journalPath, unstartedJournal, "utf8");

    const recovered = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START + 1_000,
    });
    assert.equal(recovered.operation_id, first.operation_id);
    assert.notEqual(recovered.launch_nonce, first.launch_nonce);
    assert.equal(recovered.status, "prepared");
  } finally {
    await removeFixture(context.root);
  }
});

test("host-worktree creation requires an exact admitted branch fence", async () => {
  const context = await fixture({ branchFences: [] });
  try {
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: context.contract,
        requestedSelectors: context.requested,
        now: START,
      }),
      /not an exact admitted run branch fence/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("one admitted executor branch cannot be claimed by two task contracts", async () => {
  const secondTask = visibleTask({
    task_id: "visible-review",
    title: "Review the bounded visible task",
    read_paths: ["README.md"],
    write_paths: ["audit-sentinel/bounded-visible-review.txt"],
    primary_outcome: "Complete one bounded visible review.",
  });
  const context = await fixture({ tasks: [visibleTask(), secondTask] });
  try {
    await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const secondContract = await persistWorkflowTaskContract({
      stateRoot: context.stateRoot,
      runId: context.runId,
      planId: context.plan.plan_id,
      taskId: secondTask.task_id,
      currentBaseline: { revision: context.revision },
      dependencyAuthorities: [],
      now: START + 1_000,
    });
    await assert.rejects(
      prepareVisibleTaskCreation({
        stateRoot: context.stateRoot,
        taskContract: secondContract,
        requestedSelectors: {
          ...context.requested,
          model: secondContract.task.model,
          reasoning_effort: secondContract.task.reasoning_effort,
        },
        now: START + 2_000,
      }),
      /retained by a non-reusable task contract/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("branch reservation preflight allows an exact same-run replay without writing state", async () => {
  const context = await fixture();
  try {
    await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    const creationRoot = resolve(context.stateRoot, "visible-task-creations");
    const before = (await readdir(creationRoot, { recursive: true })).sort();
    await preflightVisibleTaskBranchReservations({
      stateRoot: context.stateRoot,
      runId: context.runId,
      branchFences: [context.requested.worktree.executor_branch],
    });
    const after = (await readdir(creationRoot, { recursive: true })).sort();
    assert.deepEqual(after, before);
  } finally {
    await removeFixture(context.root);
  }
});

test("branch reservation preflight rejects a retained claim owned by another run", async () => {
  const context = await fixture();
  try {
    await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    await assert.rejects(
      preflightVisibleTaskBranchReservations({
        stateRoot: context.stateRoot,
        runId: "run-visible-task-next",
        branchFences: [context.requested.worktree.executor_branch],
      }),
      /retained by another run \(run-visible-task\)/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("branch reservation preflight fails closed for an orphaned retained claim", async () => {
  const context = await fixture();
  try {
    const prepared = await prepareVisibleTaskCreation({
      stateRoot: context.stateRoot,
      taskContract: context.contract,
      requestedSelectors: context.requested,
      now: START,
    });
    await unlink(resolve(
      context.stateRoot,
      "visible-task-creations",
      "records",
      `${prepared.operation_id}.json`,
    ));
    await assert.rejects(
      preflightVisibleTaskBranchReservations({
        stateRoot: context.stateRoot,
        runId: context.runId,
        branchFences: [context.requested.worktree.executor_branch],
      }),
      /claim is orphaned without its creation record/,
    );
  } finally {
    await removeFixture(context.root);
  }
});

test("visible task creation schema preserves provisional/ready distinction and fail-closed terminals", async () => {
  const schema = JSON.parse(await readFile(
    resolve(packageRoot, "schemas/visible-task-creation.schema.json"),
    "utf8",
  ));
  assert.equal(schema.properties.kind.const, "codex-flow-v07-visible-task-creation");
  for (const status of ["provisional", "ready-unreleased", "ambiguous", "not-created", "session-blocked"]) {
    assert.equal(schema.properties.status.enum.includes(status), true);
  }
  assert.equal(schema.properties.operation_id.pattern.startsWith("^visible-task-operation-v1-"), true);
  assert.equal(schema.required.includes("contract_id"), true);
  assert.equal(schema.required.includes("selector_rationale"), true);
  assert.equal(schema.required.includes("worktree_binding"), true);
  assert.equal(schema.required.includes("private_resolution"), true);
  assert.equal(schema.required.includes("late_private_recovery"), true);
  assert.equal(schema.$defs.privateResolution.properties.app_version.type, "null");
  assert.equal(
    schema.$defs.latePrivateRecovery.properties.kind.const,
    "codex-flow-v07-late-private-visible-task-recovery",
  );
  assert.equal(
    schema.$defs.latePrivateRecovery.properties.source.const,
    "codex-app-private-state-v1",
  );
  const readyRule = schema.allOf.find(
    (rule) => rule.if?.properties?.status?.const === "ready-unreleased",
  );
  assert.equal(readyRule.then.oneOf.length, 3);
  assert.equal(readyRule.then.oneOf[0].properties.private_resolution.type, "null");
  assert.equal(
    readyRule.then.oneOf[0].properties.ready.allOf[1]
      .properties.initial_turn.properties.source.const,
    "host-observed",
  );
  assert.equal(readyRule.then.oneOf[0].properties.resolution.type, "null");
  assert.equal(
    readyRule.then.oneOf[1].properties.provisional.$ref,
    "#/$defs/provisional",
  );
  assert.equal(readyRule.then.oneOf[1].properties.late_private_recovery.type, "null");
  assert.equal(readyRule.then.oneOf[1].properties.resolution.type, "null");
  assert.equal(
    readyRule.then.oneOf[2].properties.provisional.$ref,
    "#/$defs/provisional",
  );
  assert.equal(
    readyRule.then.oneOf[2].properties.resolution.allOf[1].properties.reason_code.const,
    "reconciliation-window-expired",
  );
  assert.deepEqual(
    schema.$defs.initialTurn.properties.source.enum,
    ["host-observed", "codex-app-private-delegation-v1"],
  );
  assert.equal(
    schema.$defs.worktreeBinding.properties.binding_id.pattern,
    "^worktree-binding-v1-[0-9a-f]{64}$",
  );
  assert.deepEqual(schema.$defs.worktreeBinding.properties.state.enum, ["prepared", "completed"]);
  assert.equal(Object.hasOwn(schema.properties, "task_contract_id"), false);
  assert.equal(
    schema.$defs.provisional.properties.client_thread_id.$ref,
    "#/$defs/provisionalHostId",
  );
  assert.equal(Object.hasOwn(schema.$defs.provisionalHostId, "pattern"), false);
});
