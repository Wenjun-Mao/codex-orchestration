import { isAbsolute, resolve } from "node:path";
import {
  CliError,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
} from "../core.mjs";

/**
 * A task launch is deliberately a pure value. The host owns persistence and the
 * Git switch; this module only decides whether the independently observed facts
 * are sufficient to activate an executor and makes conflicting replays fail.
 */
export const TASK_LAUNCH_SCHEMA_VERSION = 1;
export const TASK_LAUNCH_KIND = "codex-flow-v09-task-launch";

const DIGEST = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const STATUSES = ["prepared", "identity-admitted", "git-activated", "active"];

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function requireDigest(value, label) {
  const digest = requireText(value, label, { max: 64 });
  if (!DIGEST.test(digest)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return digest;
}

function requireRevision(value, label) {
  const revision = requireText(value, label, { max: 64 });
  if (!REVISION.test(revision)) throw new CliError(`${label} must be a concrete lowercase Git revision`);
  return revision;
}

function requireTimestamp(value, label) {
  const timestamp = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return timestamp;
}

function requireAbsolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function requireBranch(value, label) {
  const branch = requireText(value, label, { max: 256 });
  if (
    branch.includes("\\")
    || /\s/.test(branch)
    || branch.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new CliError(`${label} must be a normalized Git branch name`);
  return branch;
}

function validateCoordinatorBinding(value) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, "task launch authority.coordinator_binding");
  const binding = {
    lineage_id: requireText(value.lineage_id, "task launch authority.coordinator_binding.lineage_id", {
      max: 128,
      safeId: true,
    }),
    thread_id: requireText(value.thread_id, "task launch authority.coordinator_binding.thread_id", {
      max: 256,
      safeId: true,
    }),
    generation: requireInteger(value.generation, "task launch authority.coordinator_binding.generation", {
      min: 1,
      max: 2147483647,
    }),
  };
  const bindingDigest = sha256(stableStringify(binding));
  if (value.binding_digest !== bindingDigest) {
    throw new CliError("task launch authority.coordinator_binding.binding_digest does not match its identity");
  }
  return { ...binding, binding_digest: bindingDigest };
}

export function validateTaskLaunchAuthority(value) {
  requireExactFields(value, {
    required: [
      "run_id", "operation_id", "release_id", "ready_thread_id", "contract_id",
      "runtime_context_digest", "configuration_digest", "repository_id", "common_dir",
      "coordinator_binding", "plan_id", "revision_digest", "task_id", "task_digest",
      "baseline_revision",
    ],
  }, "task launch authority");
  return {
    run_id: requireText(value.run_id, "task launch authority.run_id", { max: 128, safeId: true }),
    operation_id: requireText(value.operation_id, "task launch authority.operation_id", {
      max: 128,
      safeId: true,
    }),
    release_id: requireText(value.release_id, "task launch authority.release_id", {
      max: 128,
      safeId: true,
    }),
    ready_thread_id: requireText(value.ready_thread_id, "task launch authority.ready_thread_id", {
      max: 256,
      safeId: true,
    }),
    contract_id: requireDigest(value.contract_id, "task launch authority.contract_id"),
    runtime_context_digest: requireDigest(
      value.runtime_context_digest,
      "task launch authority.runtime_context_digest",
    ),
    configuration_digest: requireDigest(
      value.configuration_digest,
      "task launch authority.configuration_digest",
    ),
    repository_id: requireText(value.repository_id, "task launch authority.repository_id", {
      max: 128,
      safeId: true,
    }),
    common_dir: requireAbsolutePath(value.common_dir, "task launch authority.common_dir"),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding),
    plan_id: requireText(value.plan_id, "task launch authority.plan_id", { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, "task launch authority.revision_digest"),
    task_id: requireText(value.task_id, "task launch authority.task_id", { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, "task launch authority.task_digest"),
    baseline_revision: requireRevision(value.baseline_revision, "task launch authority.baseline_revision"),
  };
}

function validateExpectedInitialTurn(value) {
  requireExactFields(value, {
    required: ["launch_nonce", "bootstrap_digest"],
  }, "task launch expected_initial_turn");
  return {
    launch_nonce: requireDigest(value.launch_nonce, "task launch expected_initial_turn.launch_nonce"),
    bootstrap_digest: requireDigest(
      value.bootstrap_digest,
      "task launch expected_initial_turn.bootstrap_digest",
    ),
  };
}

function validateExpectedGitActivation(value, authority) {
  requireExactFields(value, {
    required: ["worktree_path", "common_dir", "executor_branch", "baseline_revision"],
  }, "task launch expected_git_activation");
  const expected = {
    worktree_path: requireAbsolutePath(value.worktree_path, "task launch expected_git_activation.worktree_path"),
    common_dir: requireAbsolutePath(value.common_dir, "task launch expected_git_activation.common_dir"),
    executor_branch: requireBranch(value.executor_branch, "task launch expected_git_activation.executor_branch"),
    baseline_revision: requireRevision(
      value.baseline_revision,
      "task launch expected_git_activation.baseline_revision",
    ),
  };
  if (expected.common_dir !== authority.common_dir) {
    throw new CliError("task launch expected_git_activation.common_dir does not match authority.common_dir");
  }
  if (expected.baseline_revision !== authority.baseline_revision) {
    throw new CliError("task launch expected_git_activation.baseline_revision does not match authority.baseline_revision");
  }
  return expected;
}

function launchIdFor({ authority, expected_initial_turn: initialTurn, expected_git_activation: gitActivation }) {
  return `task-launch-v09-${sha256(stableStringify({
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    authority,
    expected_initial_turn: initialTurn,
    expected_git_activation: gitActivation,
  }))}`;
}

function identityDigestFor(identity) {
  const { identity_digest: ignored, ...seed } = identity;
  return sha256(stableStringify(seed));
}

function gitActivationDigestFor(activation) {
  const { activation_digest: ignored, ...seed } = activation;
  return sha256(stableStringify(seed));
}

function stateDigestFor(launch) {
  const { state_digest: ignored, ...seed } = launch;
  return sha256(stableStringify(seed));
}

function expectedStatus(identity, gitActivation) {
  if (identity !== null && gitActivation !== null) return "active";
  if (identity !== null) return "identity-admitted";
  if (gitActivation !== null) return "git-activated";
  return "prepared";
}

function validateIdentityRecord(value, authority, expectedInitialTurn) {
  requireExactFields(value, {
    required: [
      "thread_id", "turn_id", "turn_index", "role", "launch_nonce", "content_digest",
      "observed_at", "identity_digest",
    ],
  }, "task launch identity");
  const identity = {
    thread_id: requireText(value.thread_id, "task launch identity.thread_id", { max: 256, safeId: true }),
    turn_id: requireText(value.turn_id, "task launch identity.turn_id", { max: 256, safeId: true }),
    turn_index: requireInteger(value.turn_index, "task launch identity.turn_index", { min: 1, max: 2147483647 }),
    role: requireEnum(value.role, ["user"], "task launch identity.role"),
    launch_nonce: requireDigest(value.launch_nonce, "task launch identity.launch_nonce"),
    content_digest: requireDigest(value.content_digest, "task launch identity.content_digest"),
    observed_at: requireTimestamp(value.observed_at, "task launch identity.observed_at"),
    identity_digest: requireDigest(value.identity_digest, "task launch identity.identity_digest"),
  };
  if (identity.thread_id !== authority.ready_thread_id) {
    throw new CliError("task launch identity.thread_id does not match authority.ready_thread_id");
  }
  if (identity.turn_index !== 1) throw new CliError("task launch identity must be the first executor turn");
  if (identity.launch_nonce !== expectedInitialTurn.launch_nonce) {
    throw new CliError("task launch identity.launch_nonce does not match the expected launch nonce");
  }
  if (identity.content_digest !== expectedInitialTurn.bootstrap_digest) {
    throw new CliError("task launch identity.content_digest does not match the expected bootstrap");
  }
  if (identity.identity_digest !== identityDigestFor(identity)) {
    throw new CliError("task launch identity.identity_digest does not match identity evidence");
  }
  return identity;
}

function validateGitActivationRecord(value, expectedGitActivation) {
  requireExactFields(value, {
    required: [
      "worktree_path", "common_dir", "branch", "revision", "cleanliness", "observed_at",
      "activation_digest",
    ],
  }, "task launch git_activation");
  const activation = {
    worktree_path: requireAbsolutePath(value.worktree_path, "task launch git_activation.worktree_path"),
    common_dir: requireAbsolutePath(value.common_dir, "task launch git_activation.common_dir"),
    branch: requireBranch(value.branch, "task launch git_activation.branch"),
    revision: requireRevision(value.revision, "task launch git_activation.revision"),
    cleanliness: requireEnum(value.cleanliness, ["clean"], "task launch git_activation.cleanliness"),
    observed_at: requireTimestamp(value.observed_at, "task launch git_activation.observed_at"),
    activation_digest: requireDigest(value.activation_digest, "task launch git_activation.activation_digest"),
  };
  if (activation.worktree_path !== expectedGitActivation.worktree_path) {
    throw new CliError("task launch git_activation.worktree_path does not match the expected executor worktree");
  }
  if (activation.common_dir !== expectedGitActivation.common_dir) {
    throw new CliError("task launch git_activation.common_dir does not match authority.common_dir");
  }
  if (activation.branch !== expectedGitActivation.executor_branch) {
    throw new CliError("task launch git_activation.branch does not match the expected executor branch");
  }
  if (activation.revision !== expectedGitActivation.baseline_revision) {
    throw new CliError("task launch git_activation.revision does not match the exact baseline");
  }
  if (activation.activation_digest !== gitActivationDigestFor(activation)) {
    throw new CliError("task launch git_activation.activation_digest does not match activation evidence");
  }
  return activation;
}

function attachStateDigest(launch) {
  return { ...launch, state_digest: stateDigestFor(launch) };
}

/**
 * Validate the serializable lifecycle value. This function has no I/O so it is
 * safe to run before a caller persists an exact replay.
 */
export function validateTaskLaunch(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "launch_id", "authority", "expected_initial_turn",
      "expected_git_activation", "prepared_at", "identity", "git_activation", "status",
      "state_digest",
    ],
  }, "task launch");
  if (value.schema_version !== TASK_LAUNCH_SCHEMA_VERSION || value.kind !== TASK_LAUNCH_KIND) {
    throw new CliError("Unsupported task launch lifecycle");
  }
  const authority = validateTaskLaunchAuthority(value.authority);
  const expectedInitialTurn = validateExpectedInitialTurn(value.expected_initial_turn);
  const expectedGitActivation = validateExpectedGitActivation(value.expected_git_activation, authority);
  const launch = {
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    launch_id: requireText(value.launch_id, "task launch.launch_id", { max: 128, safeId: true }),
    authority,
    expected_initial_turn: expectedInitialTurn,
    expected_git_activation: expectedGitActivation,
    prepared_at: requireTimestamp(value.prepared_at, "task launch.prepared_at"),
    identity: value.identity === null
      ? null
      : validateIdentityRecord(value.identity, authority, expectedInitialTurn),
    git_activation: value.git_activation === null
      ? null
      : validateGitActivationRecord(value.git_activation, expectedGitActivation),
    status: requireEnum(value.status, STATUSES, "task launch.status"),
    state_digest: requireDigest(value.state_digest, "task launch.state_digest"),
  };
  const expectedLaunchId = launchIdFor(launch);
  if (launch.launch_id !== expectedLaunchId) {
    throw new CliError("task launch.launch_id does not match the immutable launch authority");
  }
  if (launch.status !== expectedStatus(launch.identity, launch.git_activation)) {
    throw new CliError("task launch.status does not match its admitted identity and Git activation");
  }
  if (
    launch.identity !== null
    && Date.parse(launch.identity.observed_at) < Date.parse(launch.prepared_at)
  ) throw new CliError("task launch identity observation predates launch preparation");
  if (
    launch.git_activation !== null
    && Date.parse(launch.git_activation.observed_at) < Date.parse(launch.prepared_at)
  ) throw new CliError("task launch Git activation observation predates launch preparation");
  if (launch.state_digest !== stateDigestFor(launch)) {
    throw new CliError("task launch.state_digest does not match its lifecycle state");
  }
  return launch;
}

export function createTaskLaunch(value) {
  requireExactFields(value, {
    required: ["authority", "expected_initial_turn", "expected_git_activation", "prepared_at"],
  }, "task launch draft");
  const authority = validateTaskLaunchAuthority(value.authority);
  const expectedInitialTurn = validateExpectedInitialTurn(value.expected_initial_turn);
  const expectedGitActivation = validateExpectedGitActivation(value.expected_git_activation, authority);
  const launch = {
    schema_version: TASK_LAUNCH_SCHEMA_VERSION,
    kind: TASK_LAUNCH_KIND,
    launch_id: launchIdFor({
      authority,
      expected_initial_turn: expectedInitialTurn,
      expected_git_activation: expectedGitActivation,
    }),
    authority,
    expected_initial_turn: expectedInitialTurn,
    expected_git_activation: expectedGitActivation,
    prepared_at: requireTimestamp(value.prepared_at, "task launch draft.prepared_at"),
    identity: null,
    git_activation: null,
    status: "prepared",
  };
  return validateTaskLaunch(attachStateDigest(launch));
}

function identityFromEvidence(launch, value) {
  requireExactFields(value, {
    required: ["thread_id", "turn_id", "turn_index", "role", "content", "observed_at"],
  }, "task launch identity evidence");
  const content = requireText(value.content, "task launch identity evidence.content", { max: 16384 });
  const marker = `CODEX_FLOW_LAUNCH_NONCE=${launch.expected_initial_turn.launch_nonce}`;
  if (!content.includes(marker)) {
    throw new CliError("task launch identity evidence.content does not contain the exact launch nonce marker");
  }
  const identity = {
    thread_id: requireText(value.thread_id, "task launch identity evidence.thread_id", { max: 256, safeId: true }),
    turn_id: requireText(value.turn_id, "task launch identity evidence.turn_id", { max: 256, safeId: true }),
    turn_index: requireInteger(value.turn_index, "task launch identity evidence.turn_index", {
      min: 1,
      max: 2147483647,
    }),
    role: requireEnum(value.role, ["user"], "task launch identity evidence.role"),
    launch_nonce: launch.expected_initial_turn.launch_nonce,
    content_digest: sha256(content),
    observed_at: requireTimestamp(value.observed_at, "task launch identity evidence.observed_at"),
  };
  identity.identity_digest = identityDigestFor(identity);
  return validateIdentityRecord(identity, launch.authority, launch.expected_initial_turn);
}

function gitActivationFromEvidence(launch, value) {
  requireExactFields(value, {
    required: ["worktree_path", "common_dir", "branch", "revision", "cleanliness", "observed_at"],
  }, "task launch Git activation evidence");
  const activation = {
    worktree_path: requireAbsolutePath(value.worktree_path, "task launch Git activation evidence.worktree_path"),
    common_dir: requireAbsolutePath(value.common_dir, "task launch Git activation evidence.common_dir"),
    branch: requireBranch(value.branch, "task launch Git activation evidence.branch"),
    revision: requireRevision(value.revision, "task launch Git activation evidence.revision"),
    cleanliness: requireEnum(value.cleanliness, ["clean"], "task launch Git activation evidence.cleanliness"),
    observed_at: requireTimestamp(value.observed_at, "task launch Git activation evidence.observed_at"),
  };
  activation.activation_digest = gitActivationDigestFor(activation);
  return validateGitActivationRecord(activation, launch.expected_git_activation);
}

function withIdentity(launch, evidence) {
  const current = validateTaskLaunch(launch);
  const identity = identityFromEvidence(current, evidence);
  if (current.identity !== null) {
    if (stableStringify(current.identity) !== stableStringify(identity)) {
      throw new CliError("Task launch identity reconciliation conflicts with the one-shot admitted identity", 73);
    }
    return current;
  }
  return validateTaskLaunch(attachStateDigest({
    ...current,
    identity,
    status: expectedStatus(identity, current.git_activation),
  }));
}

function withGitActivation(launch, evidence) {
  const current = validateTaskLaunch(launch);
  const activation = gitActivationFromEvidence(current, evidence);
  if (current.git_activation !== null) {
    if (stableStringify(current.git_activation) !== stableStringify(activation)) {
      throw new CliError("Task launch Git activation conflicts with the one-shot admitted activation", 73);
    }
    return current;
  }
  return validateTaskLaunch(attachStateDigest({
    ...current,
    git_activation: activation,
    status: expectedStatus(current.identity, activation),
  }));
}

/**
 * Admit the executor's exact first user turn. It may arrive before or after
 * the Git observation; the result is the same active record once both facts
 * are present.
 */
export function admitTaskLaunchIdentity(value) {
  requireExactFields(value, { required: ["launch", "identity"] }, "task launch identity request");
  return withIdentity(value.launch, value.identity);
}

/**
 * Admit the executor worktree only when it is clean, on its reserved branch,
 * and still at the release baseline. This does not perform Git I/O.
 */
export function admitTaskLaunchGitActivation(value) {
  requireExactFields(
    value,
    { required: ["launch", "git_activation"] },
    "task launch Git activation request",
  );
  return withGitActivation(value.launch, value.git_activation);
}

/**
 * Reconcile either host result order in one persistence-friendly transition.
 * Supplying an already admitted value is an exact replay; a different value
 * is a contradiction and is rejected before a caller can persist it.
 */
export function reconcileTaskLaunch(value) {
  requireExactFields(value, {
    required: ["launch"],
    optional: ["identity", "git_activation"],
  }, "task launch reconciliation request");
  if (value.identity === undefined && value.git_activation === undefined) {
    throw new CliError("Task launch reconciliation requires identity or Git activation evidence");
  }
  let launch = validateTaskLaunch(value.launch);
  if (value.identity !== undefined) launch = withIdentity(launch, value.identity);
  if (value.git_activation !== undefined) launch = withGitActivation(launch, value.git_activation);
  return launch;
}

export function taskLaunchStatus(value) {
  const launch = validateTaskLaunch(value);
  return {
    launch_id: launch.launch_id,
    state_digest: launch.state_digest,
    status: launch.status,
    identity_admitted: launch.identity !== null,
    git_activation_admitted: launch.git_activation !== null,
    executor_activation_permitted: launch.status === "active",
  };
}

export function taskLaunchIdentityDigest(value) {
  return validateTaskLaunch(value).identity?.identity_digest ?? null;
}

export function taskLaunchGitActivationDigest(value) {
  return validateTaskLaunch(value).git_activation?.activation_digest ?? null;
}

export function cloneTaskLaunch(value) {
  return clone(validateTaskLaunch(value));
}
