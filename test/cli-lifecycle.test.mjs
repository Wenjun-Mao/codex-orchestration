import assert from "node:assert/strict";
import test from "node:test";
import { assertSuccess, createGitFixture, initializeFixture, removeFixture, runCli } from "./helpers.mjs";

function receipt() {
  return {
    schema_version: 2,
    recipient: {
      lineage_id: "cli-lineage",
      thread_id: "cli-coordinator",
      generation: 1,
    },
    executor_id: "cli-executor",
    run_id: "cli-run-01",
    source_revision: "0123456789abcdef",
    sequence: 1,
    supersedes_callback_ids: [],
    expires_at: "2030-08-23T17:15:00-04:00",
    classification: "PASS",
    branch: "codex/cli-executor",
    commit: "0123456789abcdef",
    upstream: "origin/codex/cli-executor",
    cleanliness: "clean",
    result_or_blocker: "Bounded CLI result complete.",
    next_decision: "Integrate once.",
    accounting: {
      PRODUCT: 0,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 1,
    },
  };
}

test("CLI binds a redacted recipient and enforces observe before consume", async () => {
  const root = await createGitFixture("codex-flow-cli-lifecycle-");
  try {
    initializeFixture([], { cwd: root });

    const binding = runCli([
      "recipient", "bind", "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--json",
    ], { cwd: root });
    assertSuccess(binding, "recipient bind");
    assert.ok(JSON.parse(binding.stdout).recipient.fence_token);
    const repeatedBinding = runCli([
      "recipient", "bind", "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--json",
    ], { cwd: root });
    assertSuccess(repeatedBinding, "recipient bind replay");
    assert.equal(JSON.parse(repeatedBinding.stdout).recipient.fence_token, undefined);
    const status = runCli(["recipient", "status", "--lineage-id", "cli-lineage", "--json"], { cwd: root });
    assertSuccess(status, "recipient status");
    assert.equal(JSON.parse(status.stdout).current.fence_token, undefined);

    const delivered = runCli(["callback", "deliver", "--json"], {
      cwd: root,
      input: receipt(),
    });
    assertSuccess(delivered, "callback deliver");
    const callbackId = JSON.parse(delivered.stdout).callback_id;

    const premature = runCli([
      "callback", "consume", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
      "--executor-id", "cli-executor",
    ], { cwd: root });
    assert.equal(premature.status, 73);
    assert.match(premature.stderr, /observed before it can be consumed/);

    assertSuccess(runCli([
      "callback", "observe", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
      "--source", "journal-monitor",
    ], { cwd: root }), "callback observe");
    assertSuccess(runCli([
      "callback", "consume", "--callback-id", callbackId,
      "--lineage-id", "cli-lineage", "--thread-id", "cli-coordinator", "--generation", "1",
      "--executor-id", "cli-executor",
    ], { cwd: root }), "callback consume");

    const callbacks = runCli(["callback", "status", "--json"], { cwd: root });
    assertSuccess(callbacks, "callback status");
    assert.equal(JSON.parse(callbacks.stdout).consumed_count, 1);
  } finally {
    await removeFixture(root);
  }
});
