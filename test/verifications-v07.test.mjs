import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  readVerificationRecord,
  runCombinedVerification,
  validateVerificationRecordV07,
  verificationRecordDigest,
  verificationStatus,
} from "../lib/verifications-v07.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import {
  recipientBindingDigest,
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

const digest = (character) => character.repeat(64);
const NOW = Date.parse("2026-08-29T20:00:00Z");

function receipt({ baseline, commonDir, final = baseline, kind = "unchanged" }) {
  const recipient = {
    lineage_id: "verification-lineage-v07",
    thread_id: "verification-coordinator-v07",
    generation: 1,
  };
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient: {
      ...recipient,
      binding_digest: recipientBindingDigest(recipient),
    },
    executor_thread_id: "verification-executor-v07",
    run_id: "verification-run-v07",
    runtime_context_digest: digest("b"),
    configuration_digest: digest("c"),
    repository_id: "verification-repository-v07",
    common_dir: commonDir,
    plan_id: "verification-plan-v07",
    revision_digest: digest("d"),
    task_id: "verification-task-v07",
    task_digest: digest("e"),
    contract_id: digest("f"),
    operation_id: "verification-operation-v07",
    release_id: "verification-release-v07",
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
  return resolve(root, ".git", "codex-flow", "v0.7.7");
}

async function terminalReceipt({ root, baseline, final = baseline, kind = "unchanged" }) {
  return receipt({
    baseline,
    final,
    kind,
    commonDir: await realpath(resolve(root, ".git")),
  });
}

function canonicalIdentity(terminal) {
  return {
    callback_id: terminalCallbackIdForV3(terminal),
    receipt_digest: sha256(stableStringify(terminal)),
    recipient_binding_digest: terminal.recipient.binding_digest,
    executor_thread_id: terminal.executor_thread_id,
    run_id: terminal.run_id,
    runtime_context_digest: terminal.runtime_context_digest,
    configuration_digest: terminal.configuration_digest,
    repository_id: terminal.repository_id,
    common_dir: terminal.common_dir,
    plan_id: terminal.plan_id,
    revision_digest: terminal.revision_digest,
    task_id: terminal.task_id,
    task_digest: terminal.task_digest,
    contract_id: terminal.contract_id,
    operation_id: terminal.operation_id,
    release_id: terminal.release_id,
  };
}

test("combined verification persists content-addressed PASS and FAIL evidence idempotently", async () => {
  const root = await createGitFixture("codex-flow-v07-verification-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const terminal = await terminalReceipt({ root, baseline });
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

    const unavailableSource = await runCombinedVerification({
      stateRoot: stateRoot(root),
      repositoryPath: root,
      receipt: terminal,
      checks: [{
        check_id: "source-disappeared",
        argv: [resolve(root, "verification-source-that-does-not-exist")],
      }],
      now: NOW + 180_000,
    });
    assert.equal(unavailableSource.classification, "FAIL");
    assert.equal(unavailableSource.checks[0].exit_code, 127);
    assert.notEqual(unavailableSource.checks[0].stderr_digest, sha256(""));

    const status = await verificationStatus({
      stateRoot: stateRoot(root),
      runId: terminal.run_id,
    });
    assert.deepEqual(
      { total: status.total, pass: status.pass, fail: status.fail },
      { total: 3, pass: 1, fail: 2 },
    );
    assert.throws(
      () => validateVerificationRecordV07({ ...passed, classification: "FAIL" }),
      /classification contradicts/,
    );
    assert.throws(
      () => validateVerificationRecordV07({ ...passed, started_at: "2026-08-29" }),
      /explicit timestamp/,
    );
    assert.throws(
      () => validateVerificationRecordV07({
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
  const root = await createGitFixture("codex-flow-v07-verification-integration-");
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
    const terminal = await terminalReceipt({
      root,
      baseline,
      final: integrated,
      kind: "clean-commit",
    });
    const scope = {
      integration_id: `integration-v1-${digest("e")}`,
      integration_record_digest: digest("f"),
      ...canonicalIdentity(terminal),
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
  const root = await createGitFixture("codex-flow-v07-verification-drift-");
  const other = await createGitFixture("codex-flow-v07-verification-other-");
  try {
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const terminal = await terminalReceipt({ root, baseline });
    await assert.rejects(
      runCombinedVerification({
        stateRoot: stateRoot(other),
        repositoryPath: root,
        receipt: terminal,
        checks: [{ check_id: "wrong-common-dir", argv: [process.execPath, "-e", "process.exit(0)"] }],
      }),
      /does not match the journal Git common directory/,
    );

    const wrongReceiptCommonDir = receipt({
      baseline,
      commonDir: await realpath(resolve(other, ".git")),
    });
    await assert.rejects(
      runCombinedVerification({
        stateRoot: stateRoot(root),
        repositoryPath: root,
        receipt: wrongReceiptCommonDir,
        checks: [{
          check_id: "wrong-receipt-common-dir",
          argv: [process.execPath, "-e", "process.exit(0)"],
        }],
      }),
      /does not match the terminal receipt common directory/,
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

test("verification schema exposes only canonical terminal and integration identities", async () => {
  const schema = JSON.parse(await readFile(
    resolve(import.meta.dirname, "..", "schemas", "verification-record.schema.json"),
    "utf8",
  ));
  const identityFields = [
    "callback_id", "receipt_digest", "recipient_binding_digest", "executor_thread_id",
    "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
    "common_dir", "plan_id", "revision_digest", "task_id", "task_digest",
    "contract_id", "operation_id", "release_id",
  ];
  assert.deepEqual(schema.properties.identity.required, identityFields);
  const integration = schema.properties.integration_scope.oneOf[1];
  assert.deepEqual(
    integration.required,
    [
      "integration_id", "integration_record_digest", ...identityFields,
      "main_branch", "reconciled_main_tip", "outcome",
    ],
  );
  for (const alias of [
    "executor_id", "runtime_digest", "config_digest", "revision_id",
    "task_contract_digest",
  ]) {
    assert.equal(Object.hasOwn(schema.properties.identity.properties, alias), false);
    assert.equal(Object.hasOwn(integration.properties, alias), false);
  }
});
