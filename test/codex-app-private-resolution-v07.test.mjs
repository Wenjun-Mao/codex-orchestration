import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  PRIVATE_DELEGATION_SOURCE,
  PRIVATE_TASK_RESOLUTION_SOURCE,
  privateAcceptedSelectorDigest,
  privateTaskResolutionBindingDigest,
  resolveCodexAppPrivateTask,
} from "../lib/codex-app-private-resolution-v07.mjs";

const START = Date.parse("2026-09-02T02:31:20.000Z");
const READY = "01a0600e-1bc5-7052-be92-4b72daf6ec1a";
const PROVISIONAL = "client-new-thread:db29182f-a5f1-4b98-8d52-cd5a0cfe2d1e";
const SOURCE = "01a04b13-a1ef-7731-a63b-819b7f8cb150";
const REVISION = "3d1ffec5ae012cdcb1a4199240e91e1927610f93";
const BOOTSTRAP = "# Codex Flow bootstrap\nCODEX_FLOW_LAUNCH_NONCE=" + "a".repeat(64) + "\n";
const TASK_TITLE = "Resolve one exact private task";

function requestedSelectors() {
  return {
    project_id: "codex-orchestration",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    worktree: {
      mode: "host-worktree",
      starting_revision: REVISION,
      starting_branch: "main",
      executor_branch: "codex/private-resolution",
      path: null,
    },
  };
}

function delegationOutput(bootstrap = BOOTSTRAP) {
  return [
    "<codex_delegation>",
    `  <source_thread_id>${SOURCE}</source_thread_id>`,
    `  <input>${bootstrap}</input>`,
    "</codex_delegation>",
  ].join("\n");
}

async function fixture({
  stateTransform = (value) => value,
  delegation = delegationOutput(),
  observedModel = "gpt-5.6-luna",
  sourceTransform = (rows) => rows,
  sourcePrefix = "",
} = {}) {
  const codexHome = await mkdtemp(resolve(tmpdir(), "codex-private-resolution-"));
  const state = stateTransform({
    "electron-persisted-atom-state": {
      "client-thread-bindings-v1": { [PROVISIONAL]: READY },
      [`thread-client-id-v1:${encodeURIComponent(`local:${READY}`)}`]: PROVISIONAL,
      "electron:last-seen-changelog-release-family": "26.727",
    },
  });
  await writeFile(resolve(codexHome, ".codex-global-state.json"), JSON.stringify(state));
  const sessionDirectory = resolve(codexHome, "sessions", "2026", "09", "01");
  await mkdir(sessionDirectory, { recursive: true });
  const sourceRows = sourceTransform([
    {
      timestamp: "2026-09-02T02:31:25.000Z",
      type: "session_meta",
      payload: { id: SOURCE },
    },
    {
      timestamp: "2026-09-02T02:33:31.000Z",
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: SOURCE,
        item: {
          type: "McpToolCall",
          status: "completed",
          server: "codex_app",
          tool: "create_thread",
          arguments: {
            prompt: BOOTSTRAP,
            title: TASK_TITLE,
            model: "gpt-5.6-luna",
            thinking: "medium",
            target: {
              type: "project",
              projectId: "codex-orchestration",
              environment: {
                type: "worktree",
                startingState: { type: "branch", branchName: "main" },
              },
            },
          },
          result: {
            content: [{ type: "text", text: JSON.stringify({ clientThreadId: PROVISIONAL, hostId: "local" }) }],
            isError: false,
          },
        },
      },
    },
  ]);
  const sourceSessionPath = resolve(
    sessionDirectory,
    `rollout-2026-09-01T22-31-20-${SOURCE}.jsonl`,
  );
  await writeFile(
    sourceSessionPath,
    `${sourcePrefix}${sourceRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const turnId = "01a0600e-20ee-7777-aaaa-111111111111";
  const rows = [
    {
      timestamp: "2026-09-02T02:33:32.120Z",
      type: "session_meta",
      payload: {
        id: READY,
        thread_source: "agent_created_thread",
        cwd: resolve(codexHome, "worktrees", "1fff", "codex-orchestration"),
        cli_version: "0.152.0",
        git: { commit_hash: REVISION },
      },
    },
    {
      timestamp: "2026-09-02T02:33:32.120Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: turnId },
    },
    {
      timestamp: "2026-09-02T02:33:33.994Z",
      type: "turn_context",
      payload: {
        turn_id: turnId,
        model: observedModel,
        effort: "medium",
      },
    },
    {
      timestamp: "2026-09-02T02:33:33.998Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        namespace: "codex_app",
        name: "create_thread",
        output: delegation,
      },
    },
    {
      timestamp: "2026-09-02T02:33:36.930Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turnId },
    },
  ];
  await writeFile(
    resolve(sessionDirectory, `rollout-2026-09-01T22-33-31-${READY}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  return { codexHome, sourceSessionPath };
}

async function resolveFixture(context, overrides = {}) {
  return resolveCodexAppPrivateTask({
    provisionalClientThreadId: PROVISIONAL,
    sourceThreadId: SOURCE,
    bootstrap: BOOTSTRAP,
    taskTitle: TASK_TITLE,
    requestedSelectors: requestedSelectors(),
    attemptStartedAt: new Date(START).toISOString(),
    reconcileBy: new Date(START + 300_000).toISOString(),
    codexHome: context.codexHome,
    now: START + 150_000,
    ...overrides,
  });
}

test("private resolver requires agreeing exact bindings and authenticates the delegated bootstrap", async () => {
  const context = await fixture();
  try {
    const result = await resolveFixture(context);
    assert.equal(result.resolution.source, PRIVATE_TASK_RESOLUTION_SOURCE);
    assert.equal(result.resolution.provisional_client_thread_id, PROVISIONAL);
    assert.equal(result.resolution.host_id, "local");
    assert.equal(result.resolution.ready_thread_id, READY);
    assert.equal(
      result.resolution.binding_digest,
      privateTaskResolutionBindingDigest(result.resolution),
    );
    assert.match(result.resolution.state_digest, /^[0-9a-f]{64}$/);
    assert.match(result.resolution.source_session_digest, /^[0-9a-f]{64}$/);
    assert.match(result.resolution.session_digest, /^[0-9a-f]{64}$/);
    assert.equal(result.resolution.provisional_observed_at, "2026-09-02T02:33:31.000Z");
    assert.equal(result.resolution.app_version, null);
    assert.equal(result.resolution.app_release_family, "26.727");
    assert.equal(result.resolution.host_cli_version, "0.152.0");
    assert.equal(result.initial_turn.source, PRIVATE_DELEGATION_SOURCE);
    assert.equal(result.initial_turn.role, "delegation");
    assert.equal(result.initial_turn.content, BOOTSTRAP);
    assert.equal(result.accepted_selectors.accepted_at, "2026-09-02T02:33:31.000Z");
    assert.equal(result.accepted_selectors.model, "gpt-5.6-luna");
    assert.equal(
      result.resolution.accepted_selector_digest,
      privateAcceptedSelectorDigest(result.accepted_selectors),
    );
    assert.equal(result.observed_selectors.model, "gpt-5.6-luna");
    assert.equal(result.observed_selectors.worktree.path.includes("worktrees/1fff"), true);
  } finally {
    await rm(context.codexHome, { recursive: true, force: true });
  }
});

test("private resolver fails closed on absent, disagreeing, or malformed bindings", async (suite) => {
  await suite.test("missing reverse binding", async () => {
    const context = await fixture({
      stateTransform: (state) => {
        delete state["electron-persisted-atom-state"]["client-thread-bindings-v1"][PROVISIONAL];
        return state;
      },
    });
    try {
      await assert.rejects(() => resolveFixture(context), /binding is not ready/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("forward binding disagreement", async () => {
    const context = await fixture({
      stateTransform: (state) => {
        const atom = state["electron-persisted-atom-state"];
        delete atom[`thread-client-id-v1:${encodeURIComponent(`local:${READY}`)}`];
        atom[`thread-client-id-v1:${encodeURIComponent("local:different-ready-id")}`] = PROVISIONAL;
        return state;
      },
    });
    try {
      await assert.rejects(() => resolveFixture(context), /bindings disagree/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("unsupported state structure", async () => {
    const context = await fixture({ stateTransform: () => ({}) });
    try {
      await assert.rejects(() => resolveFixture(context), /unsupported structure/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("oversized source line", async () => {
    const context = await fixture();
    try {
      await writeFile(context.sourceSessionPath, `${"x".repeat((4 * 1024 * 1024) + 1)}\n`);
      await assert.rejects(() => resolveFixture(context), /oversized JSON line/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("source session larger than the child-session cap streams successfully", async () => {
    const paddingLine = `${JSON.stringify({ type: "ignored", payload: "x".repeat(4096) })}\n`;
    const sourcePrefix = paddingLine.repeat(Math.ceil((33 * 1024 * 1024) / Buffer.byteLength(paddingLine)));
    const context = await fixture({ sourcePrefix });
    try {
      const result = await resolveFixture(context);
      assert.equal(result.resolution.provisional_client_thread_id, PROVISIONAL);
      assert.match(result.resolution.source_session_digest, /^[0-9a-f]{64}$/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });
});

test("private resolver rejects altered bootstrap and selector drift while preserving event-time evidence", async (suite) => {
  await suite.test("altered bootstrap", async () => {
    const context = await fixture({ delegation: delegationOutput(`${BOOTSTRAP}extra`) });
    try {
      await assert.rejects(() => resolveFixture(context), /exact private delegation bootstrap/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("source completion mismatch, duplicate, malformed, or deadline evidence", async (t) => {
    const cases = [
      {
        name: "mismatched source selector",
        transform: (rows) => {
          rows[1].payload.item.arguments.model = "gpt-5.6-terra";
          return rows;
        },
        error: /does not match exact selectors and placement/,
      },
      {
        name: "duplicate exact source completion",
        transform: (rows) => [rows[0], rows[1], structuredClone(rows[1])],
        error: /no exact create_thread completion/,
      },
      {
        name: "malformed source result",
        transform: (rows) => {
          rows[1].payload.item.result.content[0].text = "not-json";
          return rows;
        },
        error: /malformed JSON/,
      },
      {
        name: "source provisional ID disagreement",
        transform: (rows) => {
          rows[1].payload.item.result.content[0].text = JSON.stringify({
            clientThreadId: "client-new-thread:different",
            hostId: "local",
          });
          return rows;
        },
        error: /does not match the recorded provisional identity/,
      },
      {
        name: "source host disagreement",
        transform: (rows) => {
          rows[1].payload.item.result.content[0].text = JSON.stringify({
            clientThreadId: PROVISIONAL,
            hostId: "remote-host",
          });
          return rows;
        },
        error: /unsupported host identity/,
      },
      {
        name: "source thread disagreement",
        transform: (rows) => {
          rows[1].payload.thread_id = "different-coordinator";
          return rows;
        },
        error: /does not match exact selectors and placement/,
      },
      {
        name: "source title disagreement",
        transform: (rows) => {
          rows[1].payload.item.arguments.title = "Different task";
          return rows;
        },
        error: /does not match exact selectors and placement/,
      },
      {
        name: "source branch disagreement",
        transform: (rows) => {
          rows[1].payload.item.arguments.target.environment.startingState.branchName = "different";
          return rows;
        },
        error: /does not match exact selectors and placement/,
      },
      {
        name: "source event at deadline",
        transform: (rows) => {
          rows[1].timestamp = new Date(START + 300_000).toISOString();
          return rows;
        },
        error: /falls outside the open reconciliation window/,
      },
    ];
    for (const item of cases) await t.test(item.name, async () => {
      const context = await fixture({ sourceTransform: item.transform });
      try {
        await assert.rejects(() => resolveFixture(context), item.error);
      } finally {
        await rm(context.codexHome, { recursive: true, force: true });
      }
    });
  });

  await suite.test("selector drift", async () => {
    const context = await fixture({ observedModel: "gpt-5.6-terra" });
    try {
      await assert.rejects(() => resolveFixture(context), /selectors do not match/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("late processing", async () => {
    const context = await fixture();
    try {
      const result = await resolveFixture(context, { now: START + 300_000 });
      assert.equal(result.initial_turn.observed_at, "2026-09-02T02:33:33.998Z");
      assert.equal(result.resolution.resolved_at, new Date(START + 300_000).toISOString());
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });
});
