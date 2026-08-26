import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitFixture,
  initializeFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

test("cleanup CLI emits a structured nonempty failure result", async () => {
  const root = await createGitFixture("codex-flow-cleanup-cli-");
  try {
    initializeFixture([], { cwd: root });
    const result = runCli([
      "cleanup", "apply",
      "--plan-id", "0".repeat(64),
      "--main-branch", "main",
      "--json",
    ], { cwd: root });

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /undefined/);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.status, "failed");
    assert.equal(failure.plan_id, "0".repeat(64));
    assert.deepEqual(failure.completed_actions, []);
    assert.equal(failure.failed_action, "preflight");
    assert.match(failure.error, /between 1 and 64 explicit operation IDs/);
  } finally {
    await removeFixture(root);
  }
});
