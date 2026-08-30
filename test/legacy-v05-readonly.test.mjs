import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { callbackStatus, deliverCallback } from "../lib/callbacks.mjs";
import { PACKAGE_VERSION, sha256 } from "../lib/core.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  LEGACY_V05_PACKAGE_VERSION,
  LEGACY_V05_STATE_NAMESPACE,
  createLegacyV05ReadonlyContext,
  readLegacyV05ReadonlySummary,
} from "../lib/legacy-v05-readonly.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { prepareTaskOperation, taskOperationStatus } from "../lib/task-operations.mjs";
import { persistUrgentSignal, urgentSignalStatus } from "../lib/urgent-signals.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const FIXTURE_TIME = Date.parse("2026-08-29T20:00:00.000Z");

function legacyStateRoot(snapshot) {
  return resolve(snapshot.commonDir, "codex-flow", LEGACY_V05_STATE_NAMESPACE);
}

function currentStateRoot(snapshot) {
  return resolve(snapshot.commonDir, "codex-flow", "v0.6.1");
}

function taskPacket(index) {
  const taskId = `legacy-task-${index}`;
  return {
    schema_version: 5,
    task_id: taskId,
    run_id: "legacy-history-run",
    title: `Legacy task ${index}`,
    objective: "Fixture historical status without creating a task.",
    role: "executor",
    execution_kind: "task-thread",
    launch_deadline: { at: "2031-01-01T00:00:00.000Z", timezone: "America/Toronto" },
    baseline: { revision: "fixture-revision", cleanliness: "clean" },
    environment: { type: "projectless" },
    host_placement: { mode: "projectless", target_project_id: null, reason: "fixture" },
    model: null,
    reasoning_effort: null,
    ownership: {
      write_paths: [`fixtures/legacy-${index}.mjs`],
      read_paths: [],
      exclusions: [],
    },
    dependencies: [],
    shared_resources: [],
    verification: ["Inspect the fixture."],
    callback: {
      recipient: { lineage_id: "legacy-lineage", thread_id: "legacy-thread", generation: 1 },
      executor_id: taskId,
      receipt_schema_version: 2,
    },
    integration_gate: { gate_id: `legacy-gate-${index}`, reproof: ["Inspect the fixture."] },
    cleanup_owner: "legacy-lineage",
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "journal-monitor",
    },
  };
}

function callbackReceipt() {
  return {
    schema_version: 2,
    recipient: { lineage_id: "legacy-lineage", thread_id: "legacy-thread", generation: 1 },
    executor_id: "legacy-task-1",
    run_id: "legacy-history-run",
    source_revision: "0123456789abcdef",
    sequence: 1,
    supersedes_callback_ids: [],
    expires_at: "2031-01-01T00:00:00.000Z",
    classification: "PASS",
    branch: "codex/legacy-fixture",
    commit: "0123456789abcdef",
    upstream: "origin/codex/legacy-fixture",
    cleanliness: "clean",
    result_or_blocker: "Fixture is ready for historical verification.",
    next_decision: "Inspect the journal once.",
    accounting: {
      PRODUCT: 0,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 1,
    },
  };
}

function urgentSignal() {
  return {
    schema_version: 1,
    recipient: { lineage_id: "legacy-lineage", thread_id: "legacy-thread", generation: 1 },
    executor_id: "legacy-task-2",
    run_id: "legacy-history-run",
    sequence: 1,
    supersedes_urgent_ids: [],
    expires_at: "2031-01-01T00:00:00.000Z",
    classification: "blocker",
    summary: "Fixture requires historical review.",
    requested_action: "Inspect the historical status.",
  };
}

async function snapshotTree(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const result = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await snapshotTree(path);
      for (const [relative, contents] of Object.entries(nested)) {
        result[`${entry.name}/${relative}`] = contents;
      }
    } else if (entry.isFile()) {
      result[entry.name] = await readFile(path, "utf8");
    } else {
      result[entry.name] = entry.isSymbolicLink() ? "<symlink>" : "<unsupported>";
    }
  }
  return result;
}

async function writeHistoricalAuthority(root) {
  const managedRoot = resolve(root, ".codex", "orchestration");
  const managedFile = resolve(managedRoot, "lib", "legacy-reader.mjs");
  const managedContents = "export const accepted = 'v0.5.1';\n";
  const agentsContents = "External historical authority.\n";
  await mkdir(resolve(managedRoot, "lib"), { recursive: true });
  await writeFile(managedFile, managedContents, "utf8");
  await writeFile(resolve(managedRoot, "version.json"), `${JSON.stringify({
    schema_version: 1,
    package_version: LEGACY_V05_PACKAGE_VERSION,
    files: { "lib/legacy-reader.mjs": sha256(managedContents) },
  }, null, 2)}\n`, "utf8");
  await writeFile(resolve(root, "AGENTS.md"), agentsContents, "utf8");
  await writeFile(resolve(managedRoot, "project.json"), `${JSON.stringify({
    schema_version: 4,
    project_id: "legacy-project",
    max_parallel_executors: 2,
    default_model: "gpt-5.6-terra",
    default_reasoning_effort: "xhigh",
    agents_integration: {
      mode: "external",
      path: "AGENTS.md",
      sha256: sha256(agentsContents),
      contract_version: "1",
      attested: true,
    },
    git_lifecycle: {
      protected_branches: ["main", "master"],
      warn_at: 5,
      block_at: 10,
    },
  }, null, 2)}\n`, "utf8");
}

async function writeHistoricalStatuses(stateRoot) {
  await bindRecipient({
    stateRoot,
    recipient: { lineage_id: "legacy-lineage", thread_id: "legacy-thread", generation: 1 },
    fenceToken: "legacy-fence",
  });
  for (let index = 1; index <= 6; index += 1) {
    await prepareTaskOperation({
      stateRoot,
      projectId: "legacy-project",
      packet: taskPacket(index),
      now: FIXTURE_TIME,
    });
  }
  await deliverCallback({ stateRoot, receipt: callbackReceipt(), now: FIXTURE_TIME });
  await persistUrgentSignal({ stateRoot, signal: urgentSignal(), now: FIXTURE_TIME });
}

test("legacy summary binds v0.5.1 package and state authority without touching v0.6", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-readonly-");
  t.after(() => removeFixture(root));
  await writeHistoricalAuthority(root);
  const snapshot = gitSnapshot(root);
  const v051State = legacyStateRoot(snapshot);
  const v06State = currentStateRoot(snapshot);
  await writeHistoricalStatuses(v051State);

  const beforeV051 = await snapshotTree(v051State);
  const beforeV06 = await snapshotTree(v06State);
  const summary = await readLegacyV05ReadonlySummary(snapshot);

  assert.notEqual(PACKAGE_VERSION, LEGACY_V05_PACKAGE_VERSION);
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.package_authority, {
    package: "@wjmao/codex-flow",
    package_version: "0.5.1",
  });
  assert.deepEqual(summary.state_authority, {
    namespace: "v0.5.1",
    state_root: v051State,
  });
  assert.equal(summary.runtime.package_version, "0.5.1");
  assert.deepEqual(summary.runtime.drift, []);
  assert.deepEqual(summary.runtime.unexpected, []);
  assert.deepEqual(summary.agents, {
    mode: "external",
    status: "verified",
    path: "AGENTS.md",
    contract_version: "1",
  });
  assert.equal(summary.task_operations.length, 6);
  assert.equal(summary.callbacks.pending.length, 1);
  assert.equal(summary.urgent_signals.pending.length, 1);

  assert.deepEqual(await taskOperationStatus({ stateRoot: v06State }), []);
  assert.deepEqual(await callbackStatus(v06State), {
    pending: [],
    consumed_count: 0,
    superseded_count: 0,
    expired_count: 0,
  });
  assert.deepEqual(await urgentSignalStatus(v06State), {
    pending: [],
    consumed_count: 0,
    superseded_count: 0,
    expired_count: 0,
    host_replay_count: 0,
    sender_attempt_duplicate_count: 0,
  });
  assert.deepEqual(await snapshotTree(v051State), beforeV051);
  assert.deepEqual(await snapshotTree(v06State), beforeV06);
});

test("legacy context rejects the current namespace and reports predecessor authority drift", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-authority-");
  t.after(() => removeFixture(root));
  await writeHistoricalAuthority(root);
  const snapshot = gitSnapshot(root);
  const beforeV051 = await snapshotTree(legacyStateRoot(snapshot));
  const beforeV06 = await snapshotTree(currentStateRoot(snapshot));

  assert.throws(
    () => createLegacyV05ReadonlyContext({ git: snapshot, stateRoot: currentStateRoot(snapshot) }),
    /state root must be .*v0\.5\.1/,
  );
  assert.throws(
    () => createLegacyV05ReadonlyContext({ git: snapshot, packageVersion: "0.6.0-dev.0" }),
    /only accepts package version 0\.5\.1/,
  );

  await writeFile(resolve(root, ".codex", "orchestration", "lib", "legacy-reader.mjs"), "drifted\n", "utf8");
  await writeFile(resolve(root, ".codex", "orchestration", "unexpected.txt"), "unexpected\n", "utf8");
  await writeFile(resolve(root, "AGENTS.md"), "External authority drifted.\n", "utf8");
  const summary = await readLegacyV05ReadonlySummary(snapshot);

  assert.equal(summary.ok, false);
  assert.deepEqual(summary.runtime.drift, [{ path: "lib/legacy-reader.mjs", state: "modified" }]);
  assert.deepEqual(summary.runtime.unexpected, ["unexpected.txt"]);
  assert.equal(summary.agents.status, "drifted");
  assert.ok(summary.errors.some((error) => error.includes("managed-file drift")));
  assert.ok(summary.errors.some((error) => error.includes("unowned files")));
  assert.ok(summary.errors.some((error) => error.includes("attestation has drifted")));
  assert.deepEqual(await snapshotTree(legacyStateRoot(snapshot)), beforeV051);
  assert.deepEqual(await snapshotTree(currentStateRoot(snapshot)), beforeV06);
});
