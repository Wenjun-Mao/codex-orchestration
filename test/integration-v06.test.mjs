import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { bindRecipient } from "../lib/recipients.mjs";
import { deliverCallbackV06, observeCallbackV06 } from "../lib/callbacks-v06.mjs";
import { prepareTaskDisposition } from "../lib/dispositions.mjs";
import {
  prepareSerialIntegration,
  reconcileSerialIntegration,
  serialIntegrationStatus,
} from "../lib/integration-v06.mjs";
import {
  acceptTaskRelease,
  prepareTaskRelease,
  reconcileTaskRelease,
} from "../lib/release-lifecycle.mjs";
import {
  recipientBindingDigest,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const digest = (character) => character.repeat(64);

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function commitFile(root, path, contents, message) {
  await writeFile(resolve(root, path), contents, "utf8");
  git(root, ["add", path]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function integrationFixture(suffix, { decision = "accepted-for-integration" } = {}) {
  const root = await createGitFixture(`codex-flow-v06-integration-${suffix}-`);
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.6.0-dev.0");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const executorBranch = `codex/integration-${suffix}`;
  git(root, ["switch", "--quiet", "-c", executorBranch]);
  const executorTip = await commitFile(
    root,
    `executor-${suffix}.txt`,
    `executor ${suffix}\n`,
    `executor ${suffix}`,
  );
  git(root, ["switch", "--quiet", "main"]);

  const recipient = {
    lineage_id: `integration-lineage-${suffix}`,
    thread_id: `integration-coordinator-${suffix}`,
    generation: 1,
  };
  await bindRecipient({ stateRoot, recipient });
  const commonDir = await realpath(resolve(root, ".git"));
  const releaseInput = {
    run_id: `integration-run-${suffix}`,
    plan_id: `integration-plan-${suffix}`,
    revision_id: `integration-revision-${suffix}`,
    task_id: `integration-task-${suffix}`,
    task_contract_digest: digest("a"),
    operation_id: `integration-operation-${suffix}`,
    ready_thread_id: `integration-executor-thread-${suffix}`,
    runtime_digest: digest("b"),
    config_digest: digest("c"),
    repository_id: `integration-repository-${suffix}`,
    common_dir: commonDir,
    prompt: "Execute the exact integration test packet.",
  };
  const release = await prepareTaskRelease({ stateRoot, input: releaseInput });
  await reconcileTaskRelease({ stateRoot, releaseId: release.release_id, outcome: "sent" });
  await acceptTaskRelease({
    stateRoot,
    releaseId: release.release_id,
    executorThreadId: releaseInput.ready_thread_id,
    taskContractDigest: releaseInput.task_contract_digest,
    runtimeDigest: releaseInput.runtime_digest,
    commonDir,
  });
  const receipt = validateTerminalReceiptV3({
    schema_version: 3,
    recipient: { ...recipient, binding_digest: recipientBindingDigest(recipient) },
    executor_id: `integration-executor-${suffix}`,
    run_id: releaseInput.run_id,
    runtime_digest: releaseInput.runtime_digest,
    config_digest: releaseInput.config_digest,
    plan_id: releaseInput.plan_id,
    revision_id: releaseInput.revision_id,
    task_id: releaseInput.task_id,
    task_contract_digest: releaseInput.task_contract_digest,
    operation_id: releaseInput.operation_id,
    release_id: release.release_id,
    classification: "PASS",
    git_outcome: {
      kind: "clean-commit",
      baseline_revision: baseline,
      commit: executorTip,
      branch: executorBranch,
      upstream: null,
      cleanliness: "clean",
    },
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      observed: null,
    },
    result_or_blocker: "The executor committed its path-bounded result.",
    next_decision: "Review and integrate the exact executor tip.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-08-29T16:00:00-04:00",
  });
  const delivered = await deliverCallbackV06({ stateRoot, receipt });
  await observeCallbackV06({ stateRoot, callbackId: delivered.callback_id, recipient });
  const disposition = await prepareTaskDisposition({
    stateRoot,
    callbackId: delivered.callback_id,
    decision,
    reason: decision === "accepted-for-integration"
      ? "The clean executor commit is accepted for exact serial integration."
      : "The executor result is retained but not accepted for integration.",
  });
  return {
    root,
    stateRoot,
    baseline,
    executorBranch,
    executorTip,
    disposition,
  };
}

test("serial integration preparation binds all task authorities and exact Git tips", async () => {
  const value = await integrationFixture("identity");
  try {
    const prepared = await prepareSerialIntegration({
      stateRoot: value.stateRoot,
      repositoryPath: value.root,
      dispositionId: value.disposition.disposition_id,
      mainBranch: "main",
    });
    assert.equal(prepared.state, "prepared");
    assert.equal(prepared.prepared_main_tip, value.baseline);
    assert.equal(prepared.executor_tip, value.executorTip);
    assert.equal(prepared.operation_id, "integration-operation-identity");
    assert.equal(prepared.release_id.startsWith("release-v1-"), true);
    assert.equal(prepared.callback_id.startsWith("terminal-v3-"), true);
    assert.equal(prepared.disposition_id, value.disposition.disposition_id);
    assert.equal(prepared.safe_to_finalize, false);
    assert.equal((await prepareSerialIntegration({
      stateRoot: value.stateRoot,
      repositoryPath: value.root,
      dispositionId: value.disposition.disposition_id,
      mainBranch: "main",
    })).integration_id, prepared.integration_id);

    const stored = JSON.parse(await readFile(resolve(
      value.stateRoot,
      "integration-lifecycle",
      "records",
      `${prepared.integration_id}.json`,
    ), "utf8"));
    assert.equal(Object.hasOwn(stored, "safe_to_finalize"), false);
  } finally {
    await removeFixture(value.root);
  }
});

test("reconciliation classifies ancestor, patch-equivalent, and unmerged without merging", async (t) => {
  const cases = [
    {
      name: "ancestor",
      mutate(value) {
        git(value.root, ["merge", "--quiet", "--ff-only", value.executorBranch]);
      },
    },
    {
      name: "patch-equivalent",
      async mutate(value) {
        await commitFile(value.root, "main-only.txt", "main only\n", "main only");
        git(value.root, ["cherry-pick", "--quiet", value.executorTip]);
      },
    },
    { name: "unmerged", mutate() {} },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const value = await integrationFixture(item.name);
      try {
        const prepared = await prepareSerialIntegration({
          stateRoot: value.stateRoot,
          repositoryPath: value.root,
          dispositionId: value.disposition.disposition_id,
          mainBranch: "main",
        });
        await item.mutate(value);
        const reconciled = await reconcileSerialIntegration({
          stateRoot: value.stateRoot,
          repositoryPath: value.root,
          integrationId: prepared.integration_id,
          combinedVerificationDigest: digest("d"),
        });
        assert.equal(reconciled.outcome, item.name);
        assert.equal(reconciled.safe_to_finalize, item.name !== "unmerged");
        assert.equal(reconciled.reconciliation_digest.length, 64);
        assert.equal((await serialIntegrationStatus({
          stateRoot: value.stateRoot,
          integrationId: prepared.integration_id,
        })).outcome, item.name);
        assert.equal((await reconcileSerialIntegration({
          stateRoot: value.stateRoot,
          repositoryPath: value.root,
          integrationId: prepared.integration_id,
          combinedVerificationDigest: digest("d"),
        })).reconciliation_digest, reconciled.reconciliation_digest);
      } finally {
        await removeFixture(value.root);
      }
    });
  }
});

test("integration fails closed on coordinator decision and post-prepare executor drift", async () => {
  const rejected = await integrationFixture("rejected", { decision: "rejected" });
  try {
    await assert.rejects(prepareSerialIntegration({
      stateRoot: rejected.stateRoot,
      repositoryPath: rejected.root,
      dispositionId: rejected.disposition.disposition_id,
      mainBranch: "main",
    }), /requires a prepared accepted-for-integration disposition/);
  } finally {
    await removeFixture(rejected.root);
  }

  const drifted = await integrationFixture("drifted");
  try {
    const prepared = await prepareSerialIntegration({
      stateRoot: drifted.stateRoot,
      repositoryPath: drifted.root,
      dispositionId: drifted.disposition.disposition_id,
      mainBranch: "main",
    });
    git(drifted.root, ["branch", "--force", drifted.executorBranch, "main"]);
    await assert.rejects(reconcileSerialIntegration({
      stateRoot: drifted.stateRoot,
      repositoryPath: drifted.root,
      integrationId: prepared.integration_id,
      combinedVerificationDigest: digest("e"),
    }), /Executor branch tip drifted/);
  } finally {
    await removeFixture(drifted.root);
  }
});
