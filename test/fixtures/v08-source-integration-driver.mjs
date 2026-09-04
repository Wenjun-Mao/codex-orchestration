import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deliverCallbackV07, observeCallbackV07 } from "./lib/callbacks-v07.mjs";
import { prepareTaskArchive, reconcileTaskArchive } from "./lib/archive-lifecycle.mjs";
import { finalizeTaskDisposition, prepareTaskDisposition } from "./lib/dispositions.mjs";
import {
  integrationVerificationRequest,
  prepareSerialIntegration,
  reconcileSerialIntegration,
} from "./lib/integration-v07.mjs";
import {
  recipientBindingDigest,
  validateTerminalReceiptV3,
} from "./lib/task-results.mjs";
import { runCombinedVerification } from "./lib/verifications-v07.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { repository_root: root, state_root: stateRoot, executor } = JSON.parse(input);
const worktree = executor.observed_worktree_path;
const taskPath = resolve(worktree, executor.contract.task.write_paths[0]);
await mkdir(resolve(taskPath, ".."), { recursive: true });
await writeFile(taskPath, "integrated v0.8 source result\n", "utf8");
execFileSync("git", ["add", executor.contract.task.write_paths[0]], { cwd: worktree });
execFileSync("git", ["commit", "--quiet", "-m", "integrate v0.8 refresh fixture"], { cwd: worktree });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
const selector = {
  model: executor.requested_selectors.model,
  reasoning_effort: executor.requested_selectors.reasoning_effort,
};
const recipient = {
  lineage_id: executor.coordinator.lineage_id,
  thread_id: executor.coordinator.thread_id,
  generation: executor.coordinator.generation,
};
const receipt = validateTerminalReceiptV3({
  schema_version: 3,
  recipient: { ...recipient, binding_digest: recipientBindingDigest(recipient) },
  executor_thread_id: executor.ready_thread_id,
  run_id: executor.contract.run_id,
  runtime_context_digest: executor.contract.runtime_context_digest,
  configuration_digest: executor.contract.configuration_digest,
  repository_id: executor.contract.repository_id,
  common_dir: executor.contract.common_dir,
  plan_id: executor.contract.plan_id,
  revision_digest: executor.contract.revision_digest,
  task_id: executor.contract.task_id,
  task_digest: executor.contract.task_digest,
  contract_id: executor.contract.contract_id,
  operation_id: executor.creation.operation_id,
  release_id: executor.release.release_id,
  classification: "PASS",
  git_outcome: {
    kind: "clean-commit",
    baseline_revision: executor.baseline,
    commit,
    branch: executor.branch,
    upstream: null,
    cleanliness: "clean",
  },
  model_evidence: {
    configured: selector,
    requested: selector,
    accepted: selector,
    observed: selector,
  },
  result_or_blocker: "The exact v0.8 source fixture completed.",
  next_decision: "Integrate the authenticated commit.",
  accounting: {
    PRODUCT: 1,
    CROSS_CUTTING_PRODUCT_FIX: 0,
    ENVIRONMENT: 0,
    PROOF_HARNESS: 0,
  },
  completed_at: new Date().toISOString(),
});
const delivered = await deliverCallbackV07({ stateRoot, receipt });
await observeCallbackV07({
  stateRoot,
  callbackId: delivered.callback_id,
  recipient,
});
const disposition = await prepareTaskDisposition({
  stateRoot,
  callbackId: delivered.callback_id,
  decision: "accepted-for-integration",
  reason: "The source result is accepted into the coordinator baseline.",
});
const integration = await prepareSerialIntegration({
  stateRoot,
  repositoryPath: root,
  dispositionId: disposition.disposition_id,
  mainBranch: "main",
});
execFileSync("git", ["merge", "--ff-only", executor.branch], { cwd: root });
const verificationRequest = await integrationVerificationRequest({
  stateRoot,
  repositoryPath: root,
  integrationId: integration.integration_id,
});
const verification = await runCombinedVerification({
  stateRoot,
  repositoryPath: root,
  receipt: verificationRequest.receipt,
  integrationScope: verificationRequest.integration_scope,
  checks: [{ check_id: "v08-source-pass", argv: [process.execPath, "-e", "process.exit(0)"] }],
});
const reconciled = await reconcileSerialIntegration({
  stateRoot,
  repositoryPath: root,
  integrationId: integration.integration_id,
  verificationId: verification.verification_id,
});
const finalized = await finalizeTaskDisposition({
  stateRoot,
  dispositionId: disposition.disposition_id,
  recipient,
  executorThreadId: executor.ready_thread_id,
  integrationId: integration.integration_id,
  verificationId: verification.verification_id,
});
const archive = await prepareTaskArchive({
  stateRoot,
  dispositionId: finalized.disposition_id,
  taskObservation: {
    execution_kind: "task-thread",
    thread_id: executor.ready_thread_id,
    source: "host-observed",
    active_visible: true,
    archived_visible: false,
  },
});
await reconcileTaskArchive({
  stateRoot,
  archiveId: archive.archive_id,
  attemptId: archive.host_intent.attempt_id,
  outcome: "accepted",
});
execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });
const archived = await reconcileTaskArchive({
  stateRoot,
  archiveId: archive.archive_id,
  attemptId: archive.host_intent.attempt_id,
  outcome: "accepted",
  observation: {
    execution_kind: "task-thread",
    thread_id: executor.ready_thread_id,
    source: "host-observed",
    active_visible: false,
    archived_visible: true,
  },
});
execFileSync("git", ["branch", "-d", executor.branch], { cwd: root });
process.stdout.write(`${JSON.stringify({ commit, integration: reconciled, archive: archived })}\n`);
