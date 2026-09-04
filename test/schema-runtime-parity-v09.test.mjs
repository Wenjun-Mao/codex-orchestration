import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  archiveIdFor,
  validateArchiveOperation,
} from "../lib/archive-lifecycle.mjs";
import { validateCallbackRecord } from "../lib/callbacks.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import {
  dispositionIdForCallback,
  validateDispositionRecord,
} from "../lib/dispositions.mjs";
import { validateIntegrationRecord } from "../lib/integration.mjs";
import {
  recipientBindingDigest,
  terminalCallbackIdForV4,
  validateTerminalReceiptV4,
} from "../lib/task-results.mjs";
import { coordinatorBindingDigest } from "../lib/workflow-plan.mjs";

const packageRoot = resolve(import.meta.dirname, "..");
const digest = (character) => character.repeat(64);
const commit = (character) => character.repeat(40);

async function schema(name) {
  return JSON.parse(await readFile(resolve(packageRoot, "schemas", name), "utf8"));
}

function coordinator(threadId = "parity-coordinator-v09") {
  const identity = {
    lineage_id: "parity-lineage-v09",
    thread_id: threadId,
    generation: 1,
  };
  return { ...identity, binding_digest: coordinatorBindingDigest(identity) };
}

function terminalReceipt() {
  const recipient = coordinator();
  assert.equal(recipient.binding_digest, recipientBindingDigest({
    lineage_id: recipient.lineage_id,
    thread_id: recipient.thread_id,
    generation: recipient.generation,
  }));
  return validateTerminalReceiptV4({
    schema_version: 4,
    kind: "codex-flow-task-terminal-receipt-v4",
    recipient,
    executor_thread_id: "parity-executor-v09",
    run_id: "parity-run-v09",
    runtime_context_digest: digest("a"),
    configuration_digest: digest("b"),
    repository_id: "parity-repository-v09",
    common_dir: "/tmp/parity-repository/.git",
    plan_id: "parity-plan-v09",
    revision_digest: digest("c"),
    task_id: "parity-task-v09",
    task_digest: digest("d"),
    contract_id: digest("e"),
    launch_id: `task-launch-v1-${digest("f")}`,
    classification: "PASS",
    git_outcome: {
      kind: "unchanged",
      baseline_revision: commit("1"),
      final_revision: commit("1"),
      branch: "codex/parity-v09",
      upstream: null,
      cleanliness: "clean",
    },
    model_evidence: {
      configured: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      requested: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      accepted: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
      observed: null,
    },
    result_or_blocker: "The parity fixture completed.",
    next_decision: "Validate the exact schema boundary.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-09-04T01:00:00.000Z",
  });
}

const INTEGRATION_AUTHORITY_KEYS = [
  "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
  "common_dir", "coordinator_binding", "plan_id", "revision_digest", "task_id",
  "task_digest", "contract_id", "launch_id", "executor_thread_id",
  "launch_record_digest", "callback_id", "receipt_digest", "disposition_id",
  "disposition_record_digest", "main_branch", "executor_branch", "prepared_main_tip",
  "executor_tip",
];

function integrationRecord(overrides = {}) {
  const receipt = terminalReceipt();
  const draft = {
    schema_version: 1,
    kind: "codex-flow-v09-serial-integration",
    integration_id: "pending",
    run_id: receipt.run_id,
    runtime_context_digest: receipt.runtime_context_digest,
    configuration_digest: receipt.configuration_digest,
    repository_id: receipt.repository_id,
    common_dir: receipt.common_dir,
    coordinator_binding: receipt.recipient,
    plan_id: receipt.plan_id,
    revision_digest: receipt.revision_digest,
    task_id: receipt.task_id,
    task_digest: receipt.task_digest,
    contract_id: receipt.contract_id,
    launch_id: receipt.launch_id,
    executor_thread_id: receipt.executor_thread_id,
    launch_record_digest: digest("2"),
    callback_id: terminalCallbackIdForV4(receipt),
    receipt_digest: digest("3"),
    disposition_id: "parity-disposition-v09",
    disposition_record_digest: digest("4"),
    main_branch: "main",
    executor_branch: "codex/parity-v09",
    prepared_main_tip: commit("5"),
    executor_tip: commit("6"),
    state: "prepared",
    outcome: null,
    reconciled_main_tip: null,
    verification_id: null,
    combined_verification_digest: null,
    reconciliation_digest: null,
    prepared_at: "2026-09-04T01:00:01.000Z",
    reconciled_at: null,
    ...overrides,
  };
  const authority = Object.fromEntries(
    INTEGRATION_AUTHORITY_KEYS.map((key) => [key, draft[key]]),
  );
  draft.integration_id = `integration-v1-${sha256(stableStringify(authority))}`;
  return draft;
}

function pendingArchiveRecord(overrides = {}) {
  const receipt = terminalReceipt();
  const callbackId = terminalCallbackIdForV4(receipt);
  const draft = {
    schema_version: 1,
    kind: "codex-flow-v09-task-archive-operation",
    archive_id: "pending",
    run_id: receipt.run_id,
    runtime_context_digest: receipt.runtime_context_digest,
    configuration_digest: receipt.configuration_digest,
    repository_id: receipt.repository_id,
    common_dir: receipt.common_dir,
    coordinator_binding: receipt.recipient,
    plan_id: receipt.plan_id,
    revision_digest: receipt.revision_digest,
    task_id: receipt.task_id,
    task_digest: receipt.task_digest,
    contract_id: receipt.contract_id,
    launch_id: receipt.launch_id,
    executor_thread_id: receipt.executor_thread_id,
    callback_id: callbackId,
    disposition_id: dispositionIdForCallback(callbackId),
    decision: "accepted-no-change",
    task: {
      execution_kind: "task-thread",
      thread_id: receipt.executor_thread_id,
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
    host_intent: {
      action: "set-thread-archived",
      attempt_id: "pending",
      thread_id: receipt.executor_thread_id,
      host_id: "local",
      archived: true,
    },
    git_resolution: {
      kind: "unchanged",
      integration_id: null,
      verification_id: `verification-v1-${digest("7")}`,
      verification_digest: digest("8"),
    },
    worktree: {
      management: "host-managed",
      path: "/tmp/parity-repository-worktree",
      prepared_state: "present-clean",
    },
    setter: {
      outcome: "accepted",
      reconciled_at: "2026-09-04T01:00:02.000Z",
    },
    observation: {
      task: {
        execution_kind: "task-thread",
        thread_id: receipt.executor_thread_id,
        source: "host-observed",
        active_visible: false,
        archived_visible: true,
      },
      worktree_state: "present",
      observed_at: "2026-09-04T01:00:03.000Z",
    },
    state: "archived-awaiting-worktree-reclamation",
    prepared_at: "2026-09-04T01:00:01.000Z",
    updated_at: "2026-09-04T01:00:03.000Z",
    ...overrides,
  };
  draft.archive_id = archiveIdFor(draft);
  draft.host_intent.attempt_id = `archive-attempt-v1-${sha256(draft.archive_id)}`;
  return draft;
}

test("v0.9 schemas match the launch, receipt-v4, and task-surface runtime boundaries", async () => {
  const [
    integrationSchema,
    verificationSchema,
    receiptSchema,
    dispositionSchema,
    callbackSchema,
    workflowJournalSchema,
    archiveSchema,
  ] = await Promise.all([
    schema("integration-record.schema.json"),
    schema("verification-record.schema.json"),
    schema("task-terminal-receipt-v4.schema.json"),
    schema("task-disposition.schema.json"),
    schema("callback-record.schema.json"),
    schema("workflow-journal.schema.json"),
    schema("archive-operation.schema.json"),
  ]);

  assert.equal(integrationSchema.properties.launch_id.$ref, "#/$defs/safeId");
  assert.equal(integrationSchema.properties.launch_record_digest.$ref, "#/$defs/digest");
  assert.equal(integrationSchema.properties.release_id, undefined);
  assert.equal(receiptSchema.properties.schema_version.const, 4);
  assert.equal(receiptSchema.properties.kind.const, "codex-flow-task-terminal-receipt-v4");
  assert.match(receiptSchema.properties.launch_id.pattern, /task-launch-v1/);
  assert.equal(receiptSchema.properties.release_id, undefined);
  assert.equal(callbackSchema.properties.callback_id.pattern.startsWith("^terminal-v4-"), true);
  assert.equal(callbackSchema.properties.receipt.$ref, "task-terminal-receipt-v4.schema.json");
  assert.equal(dispositionSchema.properties.launch_id.$ref, "#/$defs/safeId");
  assert.equal(dispositionSchema.properties.decision.enum.includes("cancelled"), false);
  assert.equal(verificationSchema.properties.identity.properties.launch_id.$ref, "#/$defs/safeId");

  const surfaceRules = workflowJournalSchema.$defs.contractClaim.allOf.filter(
    (rule) => rule.if?.properties?.execution_kind,
  );
  const operationKindsFor = (executionKind) => surfaceRules.find(
    (rule) => rule.if.properties.execution_kind.const === executionKind,
  )?.then?.properties?.operation_kind?.enum;
  assert.deepEqual(operationKindsFor("task-thread"), [null, "task-launch"]);
  assert.deepEqual(operationKindsFor("subagent"), [null, "subagent-operation"]);
  assert.equal(operationKindsFor("task-thread").includes("subagent-operation"), false);
  assert.equal(operationKindsFor("subagent").includes("task-launch"), false);

  assert(archiveSchema.properties.state.enum.includes("archived-awaiting-worktree-reclamation"));
  assert.equal(archiveSchema.properties.launch_id.$ref, "#/$defs/safeId");

  const receipt = terminalReceipt();
  assert.throws(
    () => validateTerminalReceiptV4({ ...receipt, completed_at: "not-a-date" }),
    /completed_at must be an explicit timestamp/,
  );

  const callback = {
    schema_version: 1,
    kind: "codex-flow-v09-terminal-callback",
    callback_id: terminalCallbackIdForV4(receipt),
    receipt,
    delivery_recipient: {
      lineage_id: receipt.recipient.lineage_id,
      thread_id: receipt.recipient.thread_id,
      generation: receipt.recipient.generation,
    },
    state: "persisted",
    observed_by: null,
    consumed_by: null,
    disposition_id: null,
    lifecycle: {
      persisted_at: "2026-09-04T01:00:02.000Z",
      observed_at: null,
      consumed_at: null,
    },
  };
  assert.deepEqual(validateCallbackRecord(callback), callback);

  const disposition = {
    schema_version: 1,
    kind: "codex-flow-v09-task-disposition",
    disposition_id: dispositionIdForCallback(callback.callback_id),
    run_id: receipt.run_id,
    runtime_context_digest: receipt.runtime_context_digest,
    configuration_digest: receipt.configuration_digest,
    repository_id: receipt.repository_id,
    common_dir: receipt.common_dir,
    coordinator_binding: receipt.recipient,
    plan_id: receipt.plan_id,
    revision_digest: receipt.revision_digest,
    task_id: receipt.task_id,
    task_digest: receipt.task_digest,
    contract_id: receipt.contract_id,
    launch_id: receipt.launch_id,
    executor_thread_id: receipt.executor_thread_id,
    callback_id: callback.callback_id,
    receipt_digest: sha256(stableStringify(receipt)),
    decision: "accepted-no-change",
    reason: "The unchanged result is accepted with exact verification evidence.",
    integration_id: null,
    verification_id: `verification-v1-${digest("9")}`,
    verification_digest: digest("0"),
    state: "completed",
    prepared_at: "2026-09-04T01:00:03.000Z",
    finalized_at: "2026-09-04T01:00:04.000Z",
    callback_consumed_at: "2026-09-04T01:00:05.000Z",
  };
  assert.deepEqual(validateDispositionRecord(disposition), disposition);

  const integration = integrationRecord();
  assert.deepEqual(validateIntegrationRecord(integration), integration);
  assert.throws(
    () => validateIntegrationRecord(integrationRecord({ prepared_at: "not-a-date" })),
    /prepared_at must be an explicit timestamp/,
  );

  const pendingArchive = pendingArchiveRecord();
  assert.deepEqual(validateArchiveOperation(pendingArchive), pendingArchive);
  assert.throws(
    () => validateArchiveOperation(pendingArchiveRecord({
      observation: { ...pendingArchive.observation, worktree_state: "absent" },
    })),
    /requires the exact host-managed worktree to remain present/,
  );
});
