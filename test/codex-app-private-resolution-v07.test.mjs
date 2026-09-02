import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  PRIVATE_DELEGATION_SOURCE,
  PRIVATE_TASK_RESOLUTION_SOURCE,
  privateTaskResolutionBindingDigest,
  resolveCodexAppPrivateTask,
} from "../lib/codex-app-private-resolution-v07.mjs";

const START = Date.parse("2026-09-02T02:31:20.000Z");
const READY = "01a0600e-1bc5-7052-be92-4b72daf6ec1a";
const PROVISIONAL = "client-new-thread:db29182f-a5f1-4b98-8d52-cd5a0cfe2d1e";
const SOURCE = "01a04b13-a1ef-7731-a63b-819b7f8cb150";
const REVISION = "3d1ffec5ae012cdcb1a4199240e91e1927610f93";
const BOOTSTRAP = "# Codex Flow bootstrap\nCODEX_FLOW_LAUNCH_NONCE=" + "a".repeat(64) + "\n";

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
  return { codexHome };
}

async function resolveFixture(context, overrides = {}) {
  return resolveCodexAppPrivateTask({
    provisionalClientThreadId: PROVISIONAL,
    sourceThreadId: SOURCE,
    bootstrap: BOOTSTRAP,
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
    assert.equal(result.resolution.ready_thread_id, READY);
    assert.equal(
      result.resolution.binding_digest,
      privateTaskResolutionBindingDigest(result.resolution),
    );
    assert.match(result.resolution.state_digest, /^[0-9a-f]{64}$/);
    assert.match(result.resolution.session_digest, /^[0-9a-f]{64}$/);
    assert.equal(result.resolution.app_version, null);
    assert.equal(result.resolution.app_release_family, "26.727");
    assert.equal(result.resolution.host_cli_version, "0.152.0");
    assert.equal(result.initial_turn.source, PRIVATE_DELEGATION_SOURCE);
    assert.equal(result.initial_turn.role, "delegation");
    assert.equal(result.initial_turn.content, BOOTSTRAP);
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
});

test("private resolver rejects altered bootstrap, selector drift, and a closed window", async (suite) => {
  await suite.test("altered bootstrap", async () => {
    const context = await fixture({ delegation: delegationOutput(`${BOOTSTRAP}extra`) });
    try {
      await assert.rejects(() => resolveFixture(context), /exact private delegation bootstrap/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("selector drift", async () => {
    const context = await fixture({ observedModel: "gpt-5.6-terra" });
    try {
      await assert.rejects(() => resolveFixture(context), /selectors do not match/);
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });

  await suite.test("closed window", async () => {
    const context = await fixture();
    try {
      await assert.rejects(
        () => resolveFixture(context, { now: START + 300_000 }),
        /resolution window is closed/,
      );
    } finally {
      await rm(context.codexHome, { recursive: true, force: true });
    }
  });
});
