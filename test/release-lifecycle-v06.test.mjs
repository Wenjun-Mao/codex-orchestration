import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
  taskReleaseStatus,
} from "../lib/release-lifecycle.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

async function fixtureInput(root, overrides = {}) {
  return {
    run_id: "run-release-v06",
    plan_id: "plan-release-v06",
    revision_id: "revision-release-v06",
    task_id: "task-release-v06",
    task_contract_digest: A,
    operation_id: "operation-release-v06",
    ready_thread_id: "thread-release-v06",
    runtime_digest: B,
    config_digest: C,
    repository_id: "repository-release-v06",
    common_dir: await realpath(resolve(root, ".git")),
    prompt: "Execute the exact generated packet.",
    ...overrides,
  };
}

test("release requires one reconciled send and exact executor acceptance", async () => {
  const root = await createGitFixture("codex-flow-v06-release-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  try {
    const input = await fixtureInput(root);
    const prepared = await prepareTaskRelease({ stateRoot, input });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.prompt, input.prompt);
    assert.equal(prepared.dispatch_permitted, true);
    const replay = await prepareTaskRelease({ stateRoot, input });
    assert.equal(replay.release_id, prepared.release_id);
    assert.equal(replay.dispatch_permitted, false);
    assert.equal(Object.hasOwn(replay, "prompt"), false);
    await assert.rejects(
      prepareTaskRelease({
        stateRoot,
        input: { ...input, prompt: "A changed prompt must not create a second release." },
      }),
      /does not match prepared authority/,
    );

    await assert.rejects(
      acceptTaskRelease({
        stateRoot,
        releaseId: prepared.release_id,
        executorThreadId: input.ready_thread_id,
        taskContractDigest: input.task_contract_digest,
        runtimeDigest: input.runtime_digest,
        commonDir: input.common_dir,
      }),
      /requires delivery reconciliation/,
    );

    assert.equal((await reconcileTaskRelease({
      stateRoot,
      releaseId: prepared.release_id,
      outcome: "ambiguous",
    })).status, "ambiguous");
    const accepted = await acceptTaskRelease({
      stateRoot,
      releaseId: prepared.release_id,
      executorThreadId: input.ready_thread_id,
      taskContractDigest: input.task_contract_digest,
      runtimeDigest: input.runtime_digest,
      commonDir: input.common_dir,
    });
    assert.equal(accepted.status, "accepted");
    assert.equal((await taskReleaseStatus({ stateRoot, releaseId: prepared.release_id })).status, "accepted");
    assert.equal((await acceptTaskRelease({
      stateRoot,
      releaseId: prepared.release_id,
      executorThreadId: input.ready_thread_id,
      taskContractDigest: input.task_contract_digest,
      runtimeDigest: input.runtime_digest,
      commonDir: input.common_dir,
    })).status, "accepted");
  } finally {
    await removeFixture(root);
  }
});

test("release rejects conflicting reconciliation and acceptance evidence", async () => {
  const root = await createGitFixture("codex-flow-v06-release-reject-");
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0");
  try {
    const input = await fixtureInput(root, { task_id: "task-release-reject" });
    const prepared = await prepareTaskRelease({ stateRoot, input });
    await reconcileTaskRelease({
      stateRoot,
      releaseId: prepared.release_id,
      outcome: "rejected-before-send",
    });
    await assert.rejects(
      reconcileTaskRelease({ stateRoot, releaseId: prepared.release_id, outcome: "sent" }),
      /already reconciled differently/,
    );
    await assert.rejects(
      acceptTaskRelease({
        stateRoot,
        releaseId: prepared.release_id,
        executorThreadId: input.ready_thread_id,
        taskContractDigest: input.task_contract_digest,
        runtimeDigest: input.runtime_digest,
        commonDir: input.common_dir,
      }),
      /cannot be accepted/,
    );
  } finally {
    await removeFixture(root);
  }
});
