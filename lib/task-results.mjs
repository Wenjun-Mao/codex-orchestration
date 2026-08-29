import { spawnSync } from "node:child_process";
import {
  CliError,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { assertSafeContent } from "./content-safety.mjs";
import { gitSnapshot, validateGitBranchName } from "./git.mjs";

export const ACCOUNTING_FIELDS = [
  "PRODUCT",
  "CROSS_CUTTING_PRODUCT_FIX",
  "ENVIRONMENT",
  "PROOF_HARNESS",
];

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const TERMINAL_CLASSIFICATIONS = ["PASS", "BLOCKED", "FAIL"];
const REASONING = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const EXPLICIT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function digest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function commit(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a full Git commit`);
  return result;
}

function nullableText(value, label, { max = 256, safeId = false } = {}) {
  return value === null ? null : requireText(value, label, { max, safeId });
}

function timestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!EXPLICIT_TIMESTAMP_PATTERN.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new CliError(`${label} must be an explicit timestamp`);
  }
  return result;
}

function runGit(cwd, args, label, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`);
  }
  return result;
}

function validateSelector(value, label) {
  requireExactFields(value, {
    required: ["model", "reasoning_effort"],
  }, label);
  return {
    model: requireText(value.model, `${label}.model`, { max: 128 }),
    reasoning_effort: requireEnum(value.reasoning_effort, REASONING, `${label}.reasoning_effort`),
  };
}

function validateModelEvidence(value) {
  requireExactFields(value, {
    required: ["configured", "requested", "accepted", "observed"],
  }, "model_evidence");
  return {
    configured: validateSelector(value.configured, "model_evidence.configured"),
    requested: validateSelector(value.requested, "model_evidence.requested"),
    accepted: value.accepted === null ? null : validateSelector(value.accepted, "model_evidence.accepted"),
    observed: value.observed === null ? null : validateSelector(value.observed, "model_evidence.observed"),
  };
}

export function validateGitOutcome(value) {
  requireExactFields(value, {
    required: value?.kind === "clean-commit"
      ? ["kind", "baseline_revision", "commit", "branch", "upstream", "cleanliness"]
      : value?.kind === "unchanged"
        ? ["kind", "baseline_revision", "final_revision", "branch", "upstream", "cleanliness"]
        : ["kind", "baseline_revision", "commit", "branch", "upstream", "cleanliness", "status_digest"],
  }, "git_outcome");
  const kind = requireEnum(value.kind, ["unchanged", "clean-commit", "dirty-blocked"], "git_outcome.kind");
  const common = {
    kind,
    baseline_revision: commit(value.baseline_revision, "git_outcome.baseline_revision"),
    branch: nullableText(value.branch, "git_outcome.branch", { max: 256 }),
    upstream: nullableText(value.upstream, "git_outcome.upstream", { max: 256 }),
    cleanliness: requireEnum(value.cleanliness, ["clean", "dirty"], "git_outcome.cleanliness"),
  };
  if (kind === "unchanged") {
    const finalRevision = commit(value.final_revision, "git_outcome.final_revision");
    if (common.cleanliness !== "clean" || finalRevision !== common.baseline_revision) {
      throw new CliError("unchanged Git outcome must be clean at the exact baseline");
    }
    return { ...common, final_revision: finalRevision };
  }
  const result = { ...common, commit: commit(value.commit, "git_outcome.commit") };
  if (kind === "clean-commit") {
    if (common.cleanliness !== "clean" || common.branch === null || result.commit === common.baseline_revision) {
      throw new CliError("clean-commit Git outcome requires a clean named branch advanced from baseline");
    }
    return result;
  }
  if (common.cleanliness !== "dirty") {
    throw new CliError("dirty-blocked Git outcome must report dirty cleanliness");
  }
  return { ...result, status_digest: digest(value.status_digest, "git_outcome.status_digest") };
}

export function deriveGitOutcome({
  worktreePath,
  baselineRevision,
  expectedBranch = null,
  classification,
}) {
  requireEnum(classification, TERMINAL_CLASSIFICATIONS, "classification");
  const baseline = commit(baselineRevision, "baseline_revision");
  const snapshot = gitSnapshot(worktreePath);
  const head = commit(snapshot.revision, "Git HEAD");
  const status = runGit(snapshot.root, ["status", "--porcelain=v1", "-z"], "Git status").stdout;
  const clean = status === "";
  const branch = snapshot.branch === "detached" ? null : snapshot.branch;
  const upstream = snapshot.upstream;

  if (!clean) {
    if (classification === "PASS") throw new CliError("PASS result cannot have dirty Git state");
    return validateGitOutcome({
      kind: "dirty-blocked",
      baseline_revision: baseline,
      commit: head,
      branch,
      upstream,
      cleanliness: "dirty",
      status_digest: sha256(status),
    });
  }
  if (head === baseline) {
    return validateGitOutcome({
      kind: "unchanged",
      baseline_revision: baseline,
      final_revision: head,
      branch,
      upstream,
      cleanliness: "clean",
    });
  }
  if (expectedBranch === null) {
    throw new CliError("Read-only or unchanged task advanced Git HEAD");
  }
  const expected = validateGitBranchName(snapshot.root, expectedBranch, "expected executor branch");
  if (branch !== expected) throw new CliError("Executor result is on the wrong Git branch");
  const ancestor = runGit(
    snapshot.root,
    ["merge-base", "--is-ancestor", baseline, head],
    "Git ancestry",
    { allowFailure: true },
  );
  if (ancestor.status !== 0) throw new CliError("Executor baseline is not an ancestor of its result");
  return validateGitOutcome({
    kind: "clean-commit",
    baseline_revision: baseline,
    commit: head,
    branch,
    upstream,
    cleanliness: "clean",
  });
}

export function recipientBindingDigest(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation"],
  }, "recipient binding");
  const binding = {
    lineage_id: requireText(value.lineage_id, "recipient binding.lineage_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "recipient binding.thread_id", { max: 128, safeId: true }),
    generation: requireInteger(value.generation, "recipient binding.generation", { min: 1 }),
  };
  return sha256(stableStringify(binding));
}

function validateRecipient(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, "recipient");
  const recipient = {
    lineage_id: requireText(value.lineage_id, "recipient.lineage_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "recipient.thread_id", { max: 128, safeId: true }),
    generation: requireInteger(value.generation, "recipient.generation", { min: 1 }),
    binding_digest: digest(value.binding_digest, "recipient.binding_digest"),
  };
  const expected = recipientBindingDigest({
    lineage_id: recipient.lineage_id,
    thread_id: recipient.thread_id,
    generation: recipient.generation,
  });
  if (recipient.binding_digest !== expected) {
    throw new CliError("recipient.binding_digest does not match the recipient binding");
  }
  return recipient;
}

export function validateTerminalReceiptV3(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "recipient", "executor_id", "run_id", "runtime_digest",
      "config_digest", "plan_id", "revision_id", "task_id",
      "task_contract_digest", "operation_id", "release_id", "classification",
      "git_outcome", "model_evidence", "result_or_blocker", "next_decision",
      "accounting", "completed_at",
    ],
  }, "Terminal receipt");
  if (value.schema_version !== 3) throw new CliError("Unsupported terminal receipt schema_version; expected 3");
  const classification = requireEnum(value.classification, TERMINAL_CLASSIFICATIONS, "classification");
  const gitOutcome = validateGitOutcome(value.git_outcome);
  if (classification === "PASS" && gitOutcome.kind === "dirty-blocked") {
    throw new CliError("PASS receipt cannot use dirty-blocked Git outcome");
  }
  const resultOrBlocker = requireText(value.result_or_blocker, "result_or_blocker", { max: 512 });
  const nextDecision = requireText(value.next_decision, "next_decision", { max: 512 });
  assertSafeContent("Terminal receipt", "result_or_blocker", resultOrBlocker);
  assertSafeContent("Terminal receipt", "next_decision", nextDecision);
  requireExactFields(value.accounting, { required: ACCOUNTING_FIELDS }, "Terminal receipt accounting");
  const accounting = Object.fromEntries(ACCOUNTING_FIELDS.map((field) => {
    const amount = value.accounting[field];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new CliError(`Terminal receipt accounting.${field} must be a nonnegative number`);
    }
    return [field, amount];
  }));
  const modelEvidence = validateModelEvidence(value.model_evidence);
  if (classification === "PASS") {
    const requested = stableStringify(modelEvidence.requested);
    for (const [label, selector] of [
      ["configured", modelEvidence.configured],
      ["accepted", modelEvidence.accepted],
      ["observed", modelEvidence.observed],
    ]) {
      if (selector !== null && stableStringify(selector) !== requested) {
        throw new CliError(`PASS receipt has contradictory ${label} model evidence`);
      }
    }
  }
  return {
    schema_version: 3,
    recipient: validateRecipient(value.recipient),
    executor_id: requireText(value.executor_id, "executor_id", { max: 128, safeId: true }),
    run_id: requireText(value.run_id, "run_id", { max: 128, safeId: true }),
    runtime_digest: digest(value.runtime_digest, "runtime_digest"),
    config_digest: digest(value.config_digest, "config_digest"),
    plan_id: requireText(value.plan_id, "plan_id", { max: 128, safeId: true }),
    revision_id: requireText(value.revision_id, "revision_id", { max: 128, safeId: true }),
    task_id: requireText(value.task_id, "task_id", { max: 128, safeId: true }),
    task_contract_digest: digest(value.task_contract_digest, "task_contract_digest"),
    operation_id: requireText(value.operation_id, "operation_id", { max: 128, safeId: true }),
    release_id: requireText(value.release_id, "release_id", { max: 128, safeId: true }),
    classification,
    git_outcome: gitOutcome,
    model_evidence: modelEvidence,
    result_or_blocker: resultOrBlocker,
    next_decision: nextDecision,
    accounting,
    completed_at: timestamp(value.completed_at, "completed_at"),
  };
}

function callbackIdentityV3(receipt) {
  return {
    recipient_binding_digest: receipt.recipient.binding_digest,
    executor_id: receipt.executor_id,
    run_id: receipt.run_id,
    plan_id: receipt.plan_id,
    revision_id: receipt.revision_id,
    task_id: receipt.task_id,
    task_contract_digest: receipt.task_contract_digest,
    operation_id: receipt.operation_id,
    release_id: receipt.release_id,
  };
}

export function terminalCallbackIdForV3(value) {
  const receipt = validateTerminalReceiptV3(value);
  return `terminal-v3-${sha256(stableStringify(callbackIdentityV3(receipt)))}`;
}

export function prepareTerminalReceiptV3({ identity, result, git }) {
  requireExactFields(identity, {
    required: [
      "recipient", "executor_id", "run_id", "runtime_digest", "config_digest",
      "plan_id", "revision_id", "task_id", "task_contract_digest",
      "operation_id", "release_id", "model_evidence",
    ],
  }, "Terminal receipt identity");
  requireExactFields(result, {
    required: ["classification", "result_or_blocker", "next_decision", "accounting"],
  }, "Terminal result");
  requireExactFields(git, {
    required: ["worktree_path", "baseline_revision", "expected_branch"],
  }, "Terminal Git input");
  return validateTerminalReceiptV3({
    schema_version: 3,
    ...identity,
    classification: result.classification,
    git_outcome: deriveGitOutcome({
      worktreePath: git.worktree_path,
      baselineRevision: git.baseline_revision,
      expectedBranch: git.expected_branch,
      classification: result.classification,
    }),
    result_or_blocker: result.result_or_blocker,
    next_decision: result.next_decision,
    accounting: result.accounting,
    completed_at: new Date().toISOString(),
  });
}
