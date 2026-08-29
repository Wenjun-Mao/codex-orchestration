import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  deriveGitOutcome,
  prepareTerminalReceiptV3,
  recipientBindingDigest,
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { coordinatorBindingDigest } from "../lib/workflow-plan.mjs";
import { createGitFixture, packageRoot, removeFixture } from "./helpers.mjs";

const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);
const H = "2".repeat(64);
const I = "3".repeat(64);

function identity(commonDir = "/tmp/codex-flow-terminal-receipt/.git") {
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
    executor_thread_id: "executor-v06",
    run_id: "run-v06",
    runtime_context_digest: E,
    configuration_digest: F,
    repository_id: "repository-v06",
    common_dir: commonDir,
    plan_id: "plan-v06",
    revision_digest: G,
    task_id: "task-v06",
    task_digest: H,
    contract_id: I,
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
      identity: identity(resolve(root, ".git")),
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
      () => validateTerminalReceiptV3({ ...receipt, contract_id: "bad" }),
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
      /Contradictory observed model evidence requires BLOCKED/,
    );

    const callbackId = terminalCallbackIdForV3(receipt);
    const changedResult = validateTerminalReceiptV3({
      ...receipt,
      classification: "BLOCKED",
      result_or_blocker: "A later result cannot claim a second callback identity.",
      next_decision: "Review the identity collision.",
      completed_at: "2026-08-29T20:00:00Z",
    });
    assert.equal(terminalCallbackIdForV3(changedResult), callbackId);
    assert.notEqual(
      terminalCallbackIdForV3({ ...receipt, contract_id: "4".repeat(64) }),
      callbackId,
    );

    const blockedMismatch = validateTerminalReceiptV3({
      ...receipt,
      classification: "BLOCKED",
      model_evidence: {
        ...receipt.model_evidence,
        accepted: { model: "gpt-5.6-sol", reasoning_effort: "ultra" },
      },
    });
    assert.equal(blockedMismatch.classification, "BLOCKED");
    assert.throws(
      () => validateTerminalReceiptV3({ ...blockedMismatch, classification: "FAIL" }),
      /Contradictory accepted model evidence requires BLOCKED/,
    );

    assert.throws(
      () => validateTerminalReceiptV3({
        ...receipt,
        git_outcome: {
          ...receipt.git_outcome,
          baseline_revision: "a".repeat(41),
          final_revision: "a".repeat(41),
        },
      }),
      /full Git commit/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("terminal receipt schema exposes only canonical generated-contract identity names", async () => {
  const schema = JSON.parse(await readFile(
    resolve(packageRoot, "schemas/terminal-receipt-v3.schema.json"),
    "utf8",
  ));
  for (const field of [
    "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
    "common_dir", "plan_id", "revision_digest", "task_id", "task_digest",
    "contract_id", "operation_id", "release_id", "executor_thread_id",
  ]) {
    assert.equal(schema.required.includes(field), true, `${field} must be required`);
  }
  for (const alias of [
    "runtime_digest", "config_digest", "revision_id", "task_contract_digest", "executor_id",
  ]) {
    assert.equal(schema.required.includes(alias), false, `${alias} must not be required`);
    assert.equal(Object.hasOwn(schema.properties, alias), false, `${alias} must not remain a property`);
  }
  assert.equal(schema.allOf[0].not.properties.classification.const, "PASS");
  assert.equal(schema.allOf[0].not.properties.git_outcome.properties.kind.const, "dirty-blocked");
});

test("receipt recipient binding is structurally identical to a contract coordinator binding", () => {
  const coordinator = {
    lineage_id: "lineage-v06",
    thread_id: "t".repeat(256),
    generation: 2147483647,
  };
  assert.equal(recipientBindingDigest(coordinator), coordinatorBindingDigest(coordinator));
});
