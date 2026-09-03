import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  archiveIdFor,
  validateArchiveOperation,
} from "../lib/archive-lifecycle.mjs";
import { validateCallbackRecordV07 } from "../lib/callbacks-v07.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";
import {
  cancellationDispositionIdForRelease,
  validateDispositionRecord,
} from "../lib/dispositions.mjs";
import { validateIntegrationRecordV07 } from "../lib/integration-v07.mjs";
import {
  recipientBindingDigest,
  terminalCallbackIdForV3,
  validateTerminalReceiptV3,
} from "../lib/task-results.mjs";
import { coordinatorBindingDigest } from "../lib/workflow-plan.mjs";

const packageRoot = resolve(import.meta.dirname, "..");
const digest = (character) => character.repeat(64);
const commit = (character) => character.repeat(40);

async function schema(name) {
  return JSON.parse(await readFile(resolve(packageRoot, "schemas", name), "utf8"));
}

function coordinator(threadId) {
  const identity = {
    lineage_id: "parity-lineage-v07",
    thread_id: threadId,
    generation: 1,
  };
  return { ...identity, binding_digest: coordinatorBindingDigest(identity) };
}

function terminalReceipt() {
  const recipient = coordinator("c".repeat(256));
  assert.equal(
    recipient.binding_digest,
    recipientBindingDigest({
      lineage_id: recipient.lineage_id,
      thread_id: recipient.thread_id,
      generation: recipient.generation,
    }),
  );
  return validateTerminalReceiptV3({
    schema_version: 3,
    recipient,
    executor_thread_id: "e".repeat(128),
    run_id: "parity-run-v07",
    runtime_context_digest: digest("a"),
    configuration_digest: digest("b"),
    repository_id: "parity-repository-v07",
    common_dir: "/tmp/parity-repository/.git",
    plan_id: "parity-plan-v07",
    revision_digest: digest("c"),
    task_id: "parity-task-v07",
    task_digest: digest("d"),
    contract_id: digest("e"),
    operation_id: "parity-operation-v07",
    release_id: "parity-release-v07",
    classification: "PASS",
    git_outcome: {
      kind: "unchanged",
      baseline_revision: commit("1"),
      final_revision: commit("1"),
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
    result_or_blocker: "The parity fixture completed.",
    next_decision: "Validate the exact schema boundary.",
    accounting: {
      PRODUCT: 1,
      CROSS_CUTTING_PRODUCT_FIX: 0,
      ENVIRONMENT: 0,
      PROOF_HARNESS: 0,
    },
    completed_at: "2026-08-30T01:00:00.000Z",
  });
}

const INTEGRATION_AUTHORITY_KEYS = [
  "run_id", "runtime_context_digest", "configuration_digest", "repository_id",
  "common_dir", "coordinator_binding", "plan_id", "revision_digest", "task_id",
  "task_digest", "contract_id", "operation_id", "release_id", "executor_thread_id",
  "release_record_digest", "callback_id", "receipt_digest", "disposition_id",
  "disposition_record_digest", "main_branch", "executor_branch", "prepared_main_tip",
  "executor_tip",
];

function integrationRecord(overrides = {}) {
  const draft = {
    schema_version: 1,
    kind: "codex-flow-v07-serial-integration",
    integration_id: "pending",
    run_id: "parity-run-v07",
    runtime_context_digest: digest("a"),
    configuration_digest: digest("b"),
    repository_id: "parity-repository-v07",
    common_dir: "/tmp/parity-repository/.git",
    coordinator_binding: coordinator("c".repeat(256)),
    plan_id: "parity-plan-v07",
    revision_digest: digest("c"),
    task_id: "parity-task-v07",
    task_digest: digest("d"),
    contract_id: digest("e"),
    operation_id: "parity-operation-v07",
    release_id: "parity-release-v07",
    executor_thread_id: "x".repeat(256),
    release_record_digest: digest("f"),
    callback_id: "parity-callback-v07",
    receipt_digest: digest("1"),
    disposition_id: "parity-disposition-v07",
    disposition_record_digest: digest("2"),
    main_branch: "main",
    executor_branch: "codex/parity-v07",
    prepared_main_tip: commit("3"),
    executor_tip: commit("4"),
    state: "prepared",
    outcome: null,
    reconciled_main_tip: null,
    verification_id: null,
    combined_verification_digest: null,
    reconciliation_digest: null,
    prepared_at: "2026-08-30T01:00:01.000Z",
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
  const draft = {
    schema_version: 1,
    kind: "codex-flow-v07-task-archive-operation",
    archive_id: "pending",
    run_id: "parity-run-v07",
    runtime_context_digest: digest("a"),
    configuration_digest: digest("b"),
    repository_id: "parity-repository-v07",
    common_dir: "/tmp/parity-repository/.git",
    coordinator_binding: coordinator("archive-coordinator-v07"),
    plan_id: "parity-plan-v07",
    revision_digest: digest("c"),
    task_id: "parity-task-v07",
    task_digest: digest("d"),
    contract_id: digest("e"),
    operation_id: "parity-operation-v07",
    release_id: "parity-release-v07",
    executor_thread_id: "parity-executor-v07",
    callback_id: "parity-callback-v07",
    disposition_id: "parity-disposition-v07",
    decision: "accepted-no-change",
    task: {
      execution_kind: "task-thread",
      thread_id: "parity-executor-v07",
      source: "host-observed",
      active_visible: true,
      archived_visible: false,
    },
    host_intent: {
      action: "set-thread-archived",
      attempt_id: "pending",
      thread_id: "parity-executor-v07",
      host_id: "local",
      archived: true,
    },
    git_resolution: {
      kind: "unchanged",
      integration_id: null,
      verification_id: `verification-v1-${digest("f")}`,
      verification_digest: digest("1"),
    },
    worktree: {
      management: "host-managed",
      path: "/tmp/parity-repository-worktree",
      prepared_state: "present-clean",
    },
    setter: {
      outcome: "accepted",
      reconciled_at: "2026-08-30T01:00:02.000Z",
    },
    observation: {
      task: {
        execution_kind: "task-thread",
        thread_id: "parity-executor-v07",
        source: "host-observed",
        active_visible: false,
        archived_visible: true,
      },
      worktree_state: "present",
      observed_at: "2026-08-30T01:00:03.000Z",
    },
    state: "archived-awaiting-worktree-reclamation",
    prepared_at: "2026-08-30T01:00:01.000Z",
    updated_at: "2026-08-30T01:00:03.000Z",
    ...overrides,
  };
  draft.archive_id = archiveIdFor(draft);
  draft.host_intent.attempt_id = `archive-attempt-v1-${sha256(draft.archive_id)}`;
  return draft;
}

test("active v0.7 schemas match direct runtime timestamp, thread, and task-surface boundaries", async () => {
  const [
    integrationSchema,
    verificationSchema,
    receiptSchema,
    dispositionSchema,
    callbackSchema,
    workflowJournalSchema,
    archiveSchema,
    refreshSchema,
  ] =
    await Promise.all([
      schema("integration-record.schema.json"),
      schema("verification-record.schema.json"),
      schema("terminal-receipt-v3.schema.json"),
      schema("task-disposition.schema.json"),
      schema("callback-record.schema.json"),
      schema("workflow-journal-v07.schema.json"),
      schema("archive-operation.schema.json"),
      schema("refresh-handoff-v1.schema.json"),
    ]);

  assert.equal(integrationSchema.properties.executor_thread_id.$ref, "#/$defs/threadId");
  assert.equal(
    integrationSchema.$defs.coordinatorBinding.properties.thread_id.$ref,
    "#/$defs/threadId",
  );
  assert.equal(integrationSchema.$defs.threadId.maxLength, 256);
  assert.equal(integrationSchema.$defs.timestamp.maxLength, 64);
  assert.equal(integrationSchema.$defs.timestamp.format, "date-time");
  assert.equal(
    receiptSchema.properties.recipient.properties.thread_id.$ref,
    "#/$defs/threadId",
  );
  assert.equal(receiptSchema.properties.executor_thread_id.$ref, "#/$defs/safeId");
  assert.equal(receiptSchema.$defs.threadId.maxLength, 256);
  assert.equal(receiptSchema.$defs.safeId.maxLength, 128);
  assert.equal(receiptSchema.properties.completed_at.$ref, "#/$defs/timestamp");
  assert.equal(receiptSchema.$defs.timestamp.maxLength, 64);
  assert.equal(dispositionSchema.properties.executor_thread_id.$ref, "#/$defs/threadId");
  assert.equal(
    dispositionSchema.$defs.coordinatorBinding.properties.thread_id.$ref,
    "#/$defs/threadId",
  );
  assert.equal(dispositionSchema.$defs.threadId.maxLength, 256);
  assert.equal(dispositionSchema.properties.prepared_at.$ref, "#/$defs/timestamp");
  assert.equal(dispositionSchema.$defs.timestamp.maxLength, 64);
  assert.equal(callbackSchema.$defs.recipient.properties.thread_id.$ref, "#/$defs/safeId");
  assert.equal(callbackSchema.$defs.safeId.maxLength, 128);
  assert.equal(
    callbackSchema.properties.lifecycle.properties.persisted_at.$ref,
    "#/$defs/timestamp",
  );
  assert.equal(callbackSchema.$defs.timestamp.maxLength, 64);
  assert.equal(
    verificationSchema.properties.identity.properties.executor_thread_id.$ref,
    "#/$defs/safeId",
  );
  assert.equal(verificationSchema.$defs.safeId.maxLength, 128);
  assert.equal(verificationSchema.$defs.timestamp.maxLength, 64);

  const surfaceRules = workflowJournalSchema.$defs.contractClaim.allOf.filter(
    (rule) => rule.if?.properties?.execution_kind,
  );
  const operationKindsFor = (executionKind) => surfaceRules.find(
    (rule) => rule.if.properties.execution_kind.const === executionKind,
  )?.then?.properties?.operation_kind?.enum;
  assert.deepEqual(operationKindsFor("task-thread"), [null, "visible-task-creation"]);
  assert.deepEqual(operationKindsFor("subagent"), [null, "subagent-operation"]);
  assert.equal(operationKindsFor("task-thread").includes("subagent-operation"), false);
  assert.equal(operationKindsFor("subagent").includes("visible-task-creation"), false);
  assert(archiveSchema.properties.state.enum.includes("archived-awaiting-worktree-reclamation"));
  assert(archiveSchema.properties.observation.oneOf[1].properties.worktree_state.enum.includes("present"));
  assert.deepEqual(refreshSchema.$defs.archiveEvidence.required.toSorted(), [
    "archive_intent_id", "handoff_digest", "host_id", "kind", "private_observation",
    "proof_digest", "refresh_id", "schema_version", "source", "thread_id",
  ].toSorted());
  assert.equal(refreshSchema.$defs.archiveEvidence.properties.active_visible, undefined);
  assert.equal(
    refreshSchema.$defs.archiveEvidence.properties.private_observation.$ref,
    "#/$defs/privateArchiveObservation",
  );
  assert.equal(refreshSchema.$defs.privateArchiveObservation.properties.active_session_absent.const, true);
  assert.equal(
    refreshSchema.$defs.privateArchiveObservation.properties.source.const,
    "codex-app-private-archive-session-v1",
  );

  const pendingArchive = pendingArchiveRecord();
  assert.deepEqual(validateArchiveOperation(pendingArchive), pendingArchive);
  assert.throws(
    () => validateArchiveOperation(pendingArchiveRecord({
      observation: {
        ...pendingArchive.observation,
        worktree_state: "absent",
      },
    })),
    /requires the exact host-managed worktree to remain present/,
  );

  const integration = integrationRecord();
  assert.deepEqual(validateIntegrationRecordV07(integration), integration);
  assert.throws(
    () => validateIntegrationRecordV07(integrationRecord({ prepared_at: "not-a-date" })),
    /prepared_at must be an explicit timestamp/,
  );
  assert.throws(
    () => validateIntegrationRecordV07({ ...integration, executor_thread_id: "x".repeat(257) }),
    /executor_thread_id must be nonempty text no longer than 256 characters/,
  );

  const receipt = terminalReceipt();
  assert.throws(
    () => validateTerminalReceiptV3({ ...receipt, completed_at: "not-a-date" }),
    /completed_at must be an explicit timestamp/,
  );

  const callback = {
    schema_version: 1,
    kind: "codex-flow-v07-terminal-callback",
    callback_id: terminalCallbackIdForV3(receipt),
    receipt,
    delivery_recipient: {
      lineage_id: receipt.recipient.lineage_id,
      thread_id: "delivery-thread-v07",
      generation: 1,
    },
    state: "persisted",
    observed_by: null,
    consumed_by: null,
    disposition_id: null,
    lifecycle: {
      persisted_at: "2026-08-30T01:00:02.000Z",
      observed_at: null,
      consumed_at: null,
    },
  };
  assert.deepEqual(validateCallbackRecordV07(callback), callback);
  assert.throws(
    () => validateCallbackRecordV07({
      ...callback,
      lifecycle: { ...callback.lifecycle, persisted_at: "not-a-date" },
    }),
    /lifecycle.persisted_at must be an explicit timestamp/,
  );

  const cancelled = {
    schema_version: 1,
    kind: "codex-flow-v07-task-disposition",
    disposition_id: cancellationDispositionIdForRelease(receipt.release_id),
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
    operation_id: receipt.operation_id,
    release_id: receipt.release_id,
    executor_thread_id: "y".repeat(256),
    callback_id: null,
    receipt_digest: null,
    decision: "cancelled",
    reason: "Cancelled before any objective delivery.",
    integration_id: null,
    verification_id: null,
    verification_digest: null,
    state: "completed",
    prepared_at: "2026-08-30T01:00:03.000Z",
    finalized_at: "2026-08-30T01:00:03.000Z",
    callback_consumed_at: null,
  };
  assert.deepEqual(validateDispositionRecord(cancelled), cancelled);
  assert.throws(
    () => validateDispositionRecord({ ...cancelled, prepared_at: "not-a-date" }),
    /prepared_at must be an ISO-8601 timestamp with an explicit offset/,
  );
});
