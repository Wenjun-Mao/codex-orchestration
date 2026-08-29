import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  deriveGitOutcome,
  prepareTerminalReceiptV3,
  recipientBindingDigest,
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);

function identity() {
  const recipient = {
    lineage_id: "lineage-v06",
    thread_id: "coordinator-v06",
    generation: 1,
  };
  return {
    recipient: {
      ...recipient,
      binding_digest: recipientBindingDigest(recipient),
    },
    executor_id: "executor-v06",
    run_id: "run-v06",
    runtime_digest: E,
    config_digest: F,
    plan_id: "plan-v06",
    revision_id: "revision-v06",
    task_id: "task-v06",
    task_contract_digest: G,
    operation_id: "operation-v06",
    release_id: "release-v06",
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
      observed: null,
    },
  };
}

function result(classification = "PASS") {
  return {
    classification,
    result_or_blocker: classification === "PASS" ? "Bounded result complete." : "Worktree retained for review.",
    next_decision: classification === "PASS" ? "Review the exact result." : "Resolve the blocker before proceeding.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
  };
}

test("Git outcomes distinguish unchanged, clean local commit, and dirty blocker", async () => {
  const root = await createGitFixture("codex-flow-v06-result-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(deriveGitOutcome({
      worktreePath: root,
      baselineRevision: baseline,
      expectedBranch: null,
      classification: "PASS",
    }).kind, "unchanged");

    execFileSync("git", ["switch", "-c", "codex/result-v06"], { cwd: root });
    await writeFile(resolve(root, "result.txt"), "result\n", "utf8");
    execFileSync("git", ["add", "result.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "result"], { cwd: root });
    const committed = deriveGitOutcome({
      worktreePath: root,
      baselineRevision: baseline,
      expectedBranch: "codex/result-v06",
      classification: "PASS",
    });
    assert.equal(committed.kind, "clean-commit");
    assert.equal(committed.upstream, null);

    await writeFile(resolve(root, "dirty.txt"), "dirty\n", "utf8");
    assert.equal(deriveGitOutcome({
      worktreePath: root,
      baselineRevision: baseline,
      expectedBranch: "codex/result-v06",
      classification: "BLOCKED",
    }).kind, "dirty-blocked");
    assert.throws(() => deriveGitOutcome({
      worktreePath: root,
      baselineRevision: baseline,
      expectedBranch: "codex/result-v06",
      classification: "PASS",
    }), /PASS result cannot have dirty/);
  } finally {
    await removeFixture(root);
  }
});

test("terminal receipt v3 binds full identity and derives callback identity", async () => {
  const root = await createGitFixture("codex-flow-v06-receipt-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const receipt = prepareTerminalReceiptV3({
      identity: identity(),
      result: result(),
      git: {
        worktree_path: root,
        baseline_revision: baseline,
        expected_branch: null,
      },
    });
    assert.equal(receipt.git_outcome.kind, "unchanged");
    assert.match(terminalCallbackIdForV3(receipt), /^terminal-v3-[0-9a-f]{64}$/);
    assert.deepEqual(validateTerminalReceiptV3(receipt), receipt);
    assert.throws(
      () => validateTerminalReceiptV3({ ...receipt, task_contract_digest: "bad" }),
      /SHA-256/,
    );
    assert.throws(
      () => validateTerminalReceiptV3({
        ...receipt,
        recipient: { ...receipt.recipient, binding_digest: "0".repeat(64) },
      }),
      /does not match the recipient binding/,
    );
    assert.throws(
      () => validateTerminalReceiptV3({
        ...receipt,
        model_evidence: {
          ...receipt.model_evidence,
          observed: { model: "gpt-5.6-sol", reasoning_effort: "ultra" },
        },
      }),
      /contradictory observed model evidence/,
    );
  } finally {
    await removeFixture(root);
  }
});
