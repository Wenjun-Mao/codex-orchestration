import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { deliverCallbackV07, observeCallbackV07 } from "../lib/callbacks-v07.mjs";
import { prepareTaskDisposition } from "../lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
  serialIntegrationStatus,
} from "../lib/integration-v07.mjs";
import { runCombinedVerification } from "../lib/verifications-v07.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";
import { createAcceptedVisibleTask, terminalReceipt } from "./v07-lifecycle-fixture.mjs";

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
  const root = await createGitFixture(`codex-flow-v07-integration-${suffix}-`);
  const stateRoot = resolve(root, ".git", "codex-flow", "v0.7.8");
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
  const authority = await createAcceptedVisibleTask(root, `integration-${suffix}`, {
    task: { write_paths: [`executor-${suffix}.txt`] },
    executorBranch,
  });
  const receipt = terminalReceipt(authority, {
    kind: "clean-commit",
    baseline_revision: baseline,
    commit: executorTip,
    branch: executorBranch,
    upstream: null,
    cleanliness: "clean",
  });
  const delivered = await deliverCallbackV07({ stateRoot, receipt });
  await observeCallbackV07({
    stateRoot,
    callbackId: delivered.callback_id,
    recipient: {
      lineage_id: authority.coordinator.lineage_id,
      thread_id: authority.coordinator.thread_id,
      generation: authority.coordinator.generation,
    },
  });
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
    authority,
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
    assert.equal(prepared.operation_id, value.authority.creation.operation_id);
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
        let verificationId = null;
        if (item.name !== "unmerged") {
          const request = await integrationVerificationRequest({
            stateRoot: value.stateRoot,
            repositoryPath: value.root,
            integrationId: prepared.integration_id,
          });
          if (item.name === "ancestor") {
            const mismatched = await runCombinedVerification({
              stateRoot: value.stateRoot,
              repositoryPath: value.root,
              receipt: request.receipt,
              integrationScope: {
                ...request.integration_scope,
                integration_record_digest: digest("f"),
              },
              checks: [{
                check_id: "mismatched-scope-pass",
                argv: [process.execPath, "-e", "process.exit(0)"],
              }],
            });
            await assert.rejects(reconcileSerialIntegration({
              stateRoot: value.stateRoot,
              repositoryPath: value.root,
              integrationId: prepared.integration_id,
              verificationId: mismatched.verification_id,
            }), /scope does not match the independently reconciled integration/);
          }
          const verification = await runCombinedVerification({
            stateRoot: value.stateRoot,
            repositoryPath: value.root,
            receipt: request.receipt,
            integrationScope: request.integration_scope,
            checks: [{
              check_id: "integration-pass",
              argv: [process.execPath, "-e", "process.exit(0)"],
            }],
          });
          verificationId = verification.verification_id;
        }
        const reconciled = await reconcileSerialIntegration({
          stateRoot: value.stateRoot,
          repositoryPath: value.root,
          integrationId: prepared.integration_id,
          verificationId,
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
          verificationId,
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
    }), /Executor branch tip drifted/);
  } finally {
    await removeFixture(drifted.root);
  }
});
