import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  readVerificationRecord,
  runCombinedVerification,
  validateVerificationRecordV06,
  verificationRecordDigest,
  verificationStatus,
} from "../lib/verifications-v06.mjs";
import { sha256 } from "../lib/core.mjs";
import {
  recipientBindingDigest,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const digest = (character) => character.repeat(64);
const NOW = Date.parse("2026-08-29T20:00:00Z");

function receipt({ baseline, final = baseline, kind = "unchanged" }) {
  const recipient = {
    lineage_id: "verification-lineage-v06",
    thread_id: "verification-coordinator-v06",
    generation: 1,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: {
      ...recipient,
      binding_digest: recipientBindingDigest(recipient),
    },
    executor_id: "verification-executor-v06",
    run_id: "verification-run-v06",
    runtime_digest: digest("b"),
    config_digest: digest("c"),
    plan_id: "verification-plan-v06",
    revision_id: "verification-revision-v06",
    task_id: "verification-task-v06",
    task_contract_digest: digest("d"),
    operation_id: "verification-operation-v06",
    release_id: "verification-release-v06",
    classification: "PASS",
    git_outcome: kind === "unchanged"
      ? {
        kind,
        baseline_revision: baseline,
        final_revision: final,
        branch: "main",
        upstream: null,
        cleanliness: "clean",
      }
      : {
        kind,
        baseline_revision: baseline,
        commit: final,
        branch: "main",
        upstream: null,
        cleanliness: "clean",
      },
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      observed: null,
    },
    result_or_blocker: "The bounded executor result passed.",
    next_decision: "Run authoritative combined verification.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-08-29T19:55:00Z",
  });
}

function stateRoot(root) {
  return resolve(root, ".git", "codex-flow", "v0.6.0");
}

test("combined verification persists content-addressed PASS and FAIL evidence idempotently", async () => {
  const root = await createGitFixture("codex-flow-v06-verification-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const terminal = receipt({ baseline });
    const passInput = {
      stateRoot: stateRoot(root),
      repositoryPath: root,
      receipt: terminal,
      checks: [{
        check_id: "node-pass",
        argv: [process.execPath, "-e", "process.stdout.write('verified')"],
      }],
      now: NOW,
    };
    const passed = await runCombinedVerification(passInput);
    assert.equal(passed.classification, "PASS");
    assert.match(passed.verification_id, /^verification-v1-[0-9a-f]{64}$/);
    assert.equal(verificationRecordDigest(passed), passed.verification_id.slice("verification-v1-".length));
    assert.equal(passed.checks[0].stdout_digest, sha256("verified"));
    assert.equal(passed.checks[0].stderr_digest, sha256(""));
    assert.equal(passed.repository.requested_revision, baseline);
    assert.equal(passed.repository.started_revision, baseline);
    assert.equal(passed.repository.completed_revision, baseline);
    assert.equal((await readVerificationRecord({
      stateRoot: stateRoot(root),
      verificationId: passed.verification_id,
    })).verification_id, passed.verification_id);

    const repeated = await runCombinedVerification({ ...passInput, now: NOW + 60_000 });
    assert.deepEqual(repeated, passed);

    const failed = await runCombinedVerification({
      stateRoot: stateRoot(root),
      repositoryPath: root,
      receipt: terminal,
      checks: [{
        check_id: "node-fail",
        argv: [
          process.execPath,
          "-e",
          "process.stdout.write('out');process.stderr.write('err');process.exit(7)",
        ],
      }],
      now: NOW + 120_000,
    });
    assert.equal(failed.classification, "FAIL");
    assert.equal(failed.checks[0].exit_code, 7);
    assert.equal(failed.checks[0].stdout_digest, sha256("out"));
    assert.equal(failed.checks[0].stderr_digest, sha256("err"));

    const status = await verificationStatus({
      stateRoot: stateRoot(root),
      runId: terminal.run_id,
    });
    assert.deepEqual(
      { total: status.total, pass: status.pass, fail: status.fail },
      { total: 2, pass: 1, fail: 1 },
    );
    assert.throws(
      () => validateVerificationRecordV06({ ...passed, classification: "FAIL" }),
      /classification contradicts/,
    );
    assert.throws(
      () => validateVerificationRecordV06({ ...passed, started_at: "2026-08-29" }),
      /explicit timestamp/,
    );
    assert.throws(
      () => validateVerificationRecordV06({
        ...passed,
        checks: [{ ...passed.checks[0], stdout_digest: digest("f") }],
      }),
      /content identity is invalid/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("integration-scoped verification binds callback identity and reconciled main state", async () => {
  const root = await createGitFixture("codex-flow-v06-verification-integration-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    await writeFile(resolve(root, "integrated.txt"), "integrated\n", "utf8");
    execFileSync("git", ["add", "integrated.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "integrated"], { cwd: root });
    const integrated = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const terminal = receipt({ baseline, final: integrated, kind: "clean-commit" });
    const scope = {
      integration_id: `integration-v1-${digest("e")}`,
      integration_record_digest: digest("f"),
      run_id: terminal.run_id,
      runtime_digest: terminal.runtime_digest,
      config_digest: terminal.config_digest,
      plan_id: terminal.plan_id,
      revision_id: terminal.revision_id,
      task_id: terminal.task_id,
      task_contract_digest: terminal.task_contract_digest,
      main_branch: "main",
      reconciled_main_tip: integrated,
      outcome: "ancestor",
    };
    const verified = await runCombinedVerification({
      stateRoot: stateRoot(root),
      repositoryPath: root,
      receipt: terminal,
      integrationScope: scope,
      checks: [{ check_id: "integrated-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
      now: NOW,
    });
    assert.equal(verified.classification, "PASS");
    assert.equal(verified.integration_scope.integration_id, scope.integration_id);
    assert.equal(verified.repository.requested_revision, integrated);

    await assert.rejects(
      runCombinedVerification({
        stateRoot: stateRoot(root),
        repositoryPath: root,
        receipt: terminal,
        integrationScope: { ...scope, task_id: "different-task" },
        checks: [{ check_id: "must-not-run", argv: [process.execPath, "-e", "process.exit(0)"] }],
      }),
      /task_id does not match the callback identity/,
    );
  } finally {
    await removeFixture(root);
  }
});

test("combined verification rejects repository authority and exact-state drift", async () => {
  const root = await createGitFixture("codex-flow-v06-verification-drift-");
  const other = await createGitFixture("codex-flow-v06-verification-other-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const terminal = receipt({ baseline });
    await assert.rejects(
      runCombinedVerification({
        stateRoot: stateRoot(other),
        repositoryPath: root,
        receipt: terminal,
        checks: [{ check_id: "wrong-common-dir", argv: [process.execPath, "-e", "process.exit(0)"] }],
      }),
      /does not match the journal Git common directory/,
    );

    await writeFile(resolve(root, "dirty.txt"), "dirty\n", "utf8");
    await assert.rejects(
      runCombinedVerification({
        stateRoot: stateRoot(root),
        repositoryPath: root,
        receipt: terminal,
        checks: [{ check_id: "dirty-repository", argv: [process.execPath, "-e", "process.exit(0)"] }],
      }),
      /exact clean requested revision and branch/,
    );
  } finally {
    await removeFixture(root);
    await removeFixture(other);
  }
});
