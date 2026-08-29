import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  atomicWriteJson,
  CliError,
  ensureExactJson,
  readJson,
  requireEnum,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { gitCommonDirectoryForState, gitSnapshot } from "./git.mjs";
import { readRun } from "./run-lifecycle.mjs";
import {
  readRuntimeContext,
  runtimeBindingFromContext,
  runtimeContextHash,
} from "./runtime-context.mjs";
import {
  coordinatorBindingDigest,
  createNextWorkflowPlanRevision,
  createWorkflowPlanRevision,
  generateTaskContract,
  validateGeneratedTaskContract,
  validateWorkflowPlanRevision,
} from "./workflow-plan.mjs";

export const WORKFLOW_JOURNAL_SCHEMA_VERSION = 1;
export const WORKFLOW_JOURNAL_KIND = "codex-flow-v06-workflow-journal";
export const WORKFLOW_CONTRACT_CLAIM_KIND = "codex-flow-v06-workflow-contract-claim";

const DIGEST = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const CLAIM_STATES = ["current", "started", "revoked"];
const OPERATION_KINDS = ["visible-task-creation", "subagent-operation"];

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function requireDigest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function requireTimestamp(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return result;
}

function nullableTimestamp(value, label) {
  return value === null ? null : requireTimestamp(value, label);
}

function nowIso(now) {
  const milliseconds = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(milliseconds)) throw new CliError("Workflow journal clock must be a finite timestamp");
  return new Date(milliseconds).toISOString();
}

function requireAbsolutePath(value, label) {
  const path = requireText(value, label, { max: 2048 });
  if (!isAbsolute(path)) throw new CliError(`${label} must be an absolute path`);
  return resolve(path);
}

function validateCoordinatorBinding(value, label) {
  requireExactFields(value, {
    required: ["lineage_id", "thread_id", "generation", "binding_digest"],
  }, label);
  const binding = {
    lineage_id: requireText(value.lineage_id, `${label}.lineage_id`, { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, `${label}.thread_id`, { max: 256, safeId: true }),
    generation: requireInteger(value.generation, `${label}.generation`, { min: 1, max: 2147483647 }),
    binding_digest: requireDigest(value.binding_digest, `${label}.binding_digest`),
  };
  if (binding.binding_digest !== coordinatorBindingDigest(binding)) {
    throw new CliError(`${label}.binding_digest does not match the coordinator identity`);
  }
  return binding;
}

function claimIdentity(contract) {
  return {
    run_id: contract.run_id,
    runtime_context_digest: contract.runtime_context_digest,
    configuration_digest: contract.configuration_digest,
    repository_id: contract.repository_id,
    common_dir: contract.common_dir,
    coordinator_binding: contract.coordinator_binding,
    plan_id: contract.plan_id,
    revision_digest: contract.revision_digest,
    task_id: contract.task_id,
    task_digest: contract.task_digest,
    contract_id: contract.contract_id,
    execution_kind: contract.task.execution_kind,
  };
}

function claimIdFor(identity) {
  return `workflow-contract-claim-v1-${sha256(stableStringify(identity))}`;
}

function validateContractClaim(value, label = "workflow contract claim") {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "claim_id", "run_id", "runtime_context_digest",
      "configuration_digest", "repository_id", "common_dir", "coordinator_binding",
      "plan_id", "revision_digest", "task_id", "task_digest", "contract_id",
      "execution_kind", "state", "operation_kind", "operation_id", "claimed_at",
      "started_at", "revoked_at",
    ],
  }, label);
  if (value.schema_version !== WORKFLOW_JOURNAL_SCHEMA_VERSION || value.kind !== WORKFLOW_CONTRACT_CLAIM_KIND) {
    throw new CliError(`${label} is not a supported v0.6 workflow contract claim`);
  }
  const claim = {
    schema_version: WORKFLOW_JOURNAL_SCHEMA_VERSION,
    kind: WORKFLOW_CONTRACT_CLAIM_KIND,
    claim_id: requireText(value.claim_id, `${label}.claim_id`, { max: 128, safeId: true }),
    run_id: requireText(value.run_id, `${label}.run_id`, { max: 128, safeId: true }),
    runtime_context_digest: requireDigest(value.runtime_context_digest, `${label}.runtime_context_digest`),
    configuration_digest: requireDigest(value.configuration_digest, `${label}.configuration_digest`),
    repository_id: requireText(value.repository_id, `${label}.repository_id`, { max: 128, safeId: true }),
    common_dir: requireAbsolutePath(value.common_dir, `${label}.common_dir`),
    coordinator_binding: validateCoordinatorBinding(value.coordinator_binding, `${label}.coordinator_binding`),
    plan_id: requireText(value.plan_id, `${label}.plan_id`, { max: 128, safeId: true }),
    revision_digest: requireDigest(value.revision_digest, `${label}.revision_digest`),
    task_id: requireText(value.task_id, `${label}.task_id`, { max: 128, safeId: true }),
    task_digest: requireDigest(value.task_digest, `${label}.task_digest`),
    contract_id: requireDigest(value.contract_id, `${label}.contract_id`),
    execution_kind: requireEnum(value.execution_kind, ["task-thread", "subagent"], `${label}.execution_kind`),
    state: requireEnum(value.state, CLAIM_STATES, `${label}.state`),
    operation_kind: value.operation_kind === null
      ? null
      : requireEnum(value.operation_kind, OPERATION_KINDS, `${label}.operation_kind`),
    operation_id: value.operation_id === null
      ? null
      : requireText(value.operation_id, `${label}.operation_id`, { max: 128, safeId: true }),
    claimed_at: requireTimestamp(value.claimed_at, `${label}.claimed_at`),
    started_at: nullableTimestamp(value.started_at, `${label}.started_at`),
    revoked_at: nullableTimestamp(value.revoked_at, `${label}.revoked_at`),
  };
  const expectedClaimId = claimIdFor({
    run_id: claim.run_id,
    runtime_context_digest: claim.runtime_context_digest,
    configuration_digest: claim.configuration_digest,
    repository_id: claim.repository_id,
    common_dir: claim.common_dir,
    coordinator_binding: claim.coordinator_binding,
    plan_id: claim.plan_id,
    revision_digest: claim.revision_digest,
    task_id: claim.task_id,
    task_digest: claim.task_digest,
    contract_id: claim.contract_id,
    execution_kind: claim.execution_kind,
  });
  if (claim.claim_id !== expectedClaimId) {
    throw new CliError(`${label}.claim_id does not match its canonical task-contract identity`);
  }
  if (claim.state === "current" && (
    claim.operation_kind !== null || claim.operation_id !== null
    || claim.started_at !== null || claim.revoked_at !== null
  )) throw new CliError(`${label} current state cannot contain operation or revocation evidence`);
  if (claim.state === "started" && (
    claim.operation_kind === null || claim.operation_id === null
    || claim.started_at === null || claim.revoked_at !== null
  )) throw new CliError(`${label} started state requires exact operation evidence without revocation`);
  if (claim.state === "revoked" && (
    claim.operation_kind !== null || claim.operation_id !== null
    || claim.started_at !== null || claim.revoked_at === null
  )) throw new CliError(`${label} revoked state cannot contain operation evidence`);
  if (claim.operation_kind === "visible-task-creation" && claim.execution_kind !== "task-thread") {
    throw new CliError(`${label} visible-task operation does not match its task execution kind`);
  }
  if (claim.operation_kind === "subagent-operation" && claim.execution_kind !== "subagent") {
    throw new CliError(`${label} subagent operation does not match its task execution kind`);
  }
  if (claim.started_at !== null && Date.parse(claim.started_at) < Date.parse(claim.claimed_at)) {
    throw new CliError(`${label}.started_at predates its contract claim`);
  }
  if (claim.revoked_at !== null && Date.parse(claim.revoked_at) < Date.parse(claim.claimed_at)) {
    throw new CliError(`${label}.revoked_at predates its contract claim`);
  }
  return claim;
}

function revisionEntry(value, label) {
  requireExactFields(value, { required: ["revision", "revision_digest", "admitted_at"] }, label);
  return {
    revision: requireInteger(value.revision, `${label}.revision`, { min: 1, max: 2147483647 }),
    revision_digest: requireDigest(value.revision_digest, `${label}.revision_digest`),
    admitted_at: requireTimestamp(value.admitted_at, `${label}.admitted_at`),
  };
}

function journalSeed(value) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    run_id: value.run_id,
    plan_id: value.plan_id,
    current_revision: value.current_revision,
    current_revision_digest: value.current_revision_digest,
    revisions: value.revisions,
    contract_claims: value.contract_claims,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function validateWorkflowJournal(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "run_id", "plan_id", "current_revision",
      "current_revision_digest", "revisions", "contract_claims", "created_at",
      "updated_at", "journal_digest",
    ],
  }, "workflow journal");
  if (value.schema_version !== WORKFLOW_JOURNAL_SCHEMA_VERSION || value.kind !== WORKFLOW_JOURNAL_KIND) {
    throw new CliError("Unsupported v0.6 workflow journal");
  }
  if (!Array.isArray(value.revisions) || value.revisions.length === 0 || value.revisions.length > 256) {
    throw new CliError("workflow journal revisions must contain between 1 and 256 entries");
  }
  const revisions = value.revisions.map((entry, index) => revisionEntry(entry, `revisions[${index}]`));
  for (const [index, entry] of revisions.entries()) {
    if (entry.revision !== index + 1) throw new CliError("workflow journal revisions must be contiguous from revision one");
    if (index > 0 && Date.parse(entry.admitted_at) < Date.parse(revisions[index - 1].admitted_at)) {
      throw new CliError("workflow journal revision admission timestamps must be monotonic");
    }
  }
  if (!Array.isArray(value.contract_claims) || value.contract_claims.length > 4096) {
    throw new CliError("workflow journal contract_claims must contain at most 4096 entries");
  }
  const contractClaims = value.contract_claims
    .map((claim, index) => validateContractClaim(claim, `contract_claims[${index}]`))
    .sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  if (new Set(contractClaims.map((claim) => claim.claim_id)).size !== contractClaims.length) {
    throw new CliError("workflow journal contains duplicate claim IDs");
  }
  if (new Set(contractClaims.map((claim) => `${claim.revision_digest}:${claim.task_id}`)).size !== contractClaims.length) {
    throw new CliError("workflow journal contains multiple contract claims for one task revision");
  }
  const journal = {
    schema_version: WORKFLOW_JOURNAL_SCHEMA_VERSION,
    kind: WORKFLOW_JOURNAL_KIND,
    run_id: requireText(value.run_id, "workflow journal.run_id", { max: 128, safeId: true }),
    plan_id: requireText(value.plan_id, "workflow journal.plan_id", { max: 128, safeId: true }),
    current_revision: requireInteger(value.current_revision, "workflow journal.current_revision", {
      min: 1,
      max: 2147483647,
    }),
    current_revision_digest: requireDigest(
      value.current_revision_digest,
      "workflow journal.current_revision_digest",
    ),
    revisions,
    contract_claims: contractClaims,
    created_at: requireTimestamp(value.created_at, "workflow journal.created_at"),
    updated_at: requireTimestamp(value.updated_at, "workflow journal.updated_at"),
  };
  const current = revisions.at(-1);
  if (
    journal.current_revision !== current.revision
    || journal.current_revision_digest !== current.revision_digest
  ) throw new CliError("workflow journal current pointer must name its latest admitted revision");
  if (Date.parse(journal.updated_at) < Date.parse(journal.created_at)) {
    throw new CliError("workflow journal.updated_at predates created_at");
  }
  for (const entry of revisions) {
    if (
      Date.parse(entry.admitted_at) < Date.parse(journal.created_at)
      || Date.parse(entry.admitted_at) > Date.parse(journal.updated_at)
    ) throw new CliError("workflow journal revision admission falls outside the journal lifetime");
  }
  for (const claim of contractClaims) {
    if (claim.run_id !== journal.run_id || claim.plan_id !== journal.plan_id) {
      throw new CliError("workflow journal contract claim belongs to a different run or plan");
    }
    const admitted = revisions.find((entry) => entry.revision_digest === claim.revision_digest);
    if (!admitted) throw new CliError("workflow journal contract claim names an unadmitted revision");
    if (claim.state === "current" && claim.revision_digest !== journal.current_revision_digest) {
      throw new CliError("only the current workflow revision may retain an unstarted contract claim");
    }
    if (claim.state === "revoked" && claim.revision_digest === journal.current_revision_digest) {
      throw new CliError("the current workflow revision cannot contain a revoked contract claim");
    }
    const terminalAt = claim.started_at ?? claim.revoked_at ?? claim.claimed_at;
    if (
      Date.parse(claim.claimed_at) < Date.parse(journal.created_at)
      || Date.parse(terminalAt) > Date.parse(journal.updated_at)
    ) throw new CliError("workflow journal contract claim falls outside the journal lifetime");
  }
  const expectedDigest = sha256(stableStringify(journalSeed(journal)));
  if (value.journal_digest !== expectedDigest) {
    throw new CliError("workflow journal.journal_digest does not match its canonical state");
  }
  return { ...journal, journal_digest: expectedDigest };
}

function withJournalDigest(value) {
  const normalized = {
    ...value,
    revisions: value.revisions.map((entry, index) => revisionEntry(entry, `revisions[${index}]`)),
    contract_claims: value.contract_claims
      .map((claim, index) => validateContractClaim(claim, `contract_claims[${index}]`))
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
  };
  const journal = {
    ...normalized,
    journal_digest: sha256(stableStringify(journalSeed(normalized))),
  };
  return validateWorkflowJournal(journal);
}

function safeSegment(value, label) {
  return requireText(value, label, { max: 128, safeId: true });
}

function safeChild(directory, filename, label) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory || basename(path) !== filename) {
    throw new CliError(`Unsafe ${label} state path`);
  }
  return path;
}

function journalPaths(stateRoot, runId, planId, { revisionDigest = null, contractId = null } = {}) {
  const run = safeSegment(runId, "run_id");
  const plan = safeSegment(planId, "plan_id");
  const workflows = resolve(stateRoot, "workflows");
  const runRoot = safeChild(workflows, run, "workflow run");
  const root = safeChild(runRoot, plan, "workflow plan");
  const paths = {
    root,
    journal: resolve(root, "journal.json"),
    lock: resolve(root, "workflow.lock"),
    revisions: resolve(root, "revisions"),
    contracts: resolve(root, "contracts"),
  };
  if (revisionDigest !== null) {
    paths.revision = safeChild(paths.revisions, `${requireDigest(revisionDigest, "revision_digest")}.json`, "revision");
  }
  if (contractId !== null) {
    paths.contract = safeChild(paths.contracts, `${requireDigest(contractId, "contract_id")}.json`, "contract");
  }
  return paths;
}

function guardRoot(stateRoot) {
  return gitCommonDirectoryForState(resolve(stateRoot));
}

async function activeContractAuthority(stateRoot, runId, planId, currentBaseline) {
  const commonDir = guardRoot(stateRoot);
  const { run } = await readRun({ gitCommonDirectory: commonDir, runId });
  if (run.status !== "active") throw new CliError(`v0.6 run is not active: ${runId}`, 73);
  if (run.workflow_plan_id !== planId) {
    throw new CliError("Generated task contract plan does not match the active run", 73);
  }
  const { context } = await readRuntimeContext({
    gitCommonDirectory: commonDir,
    runtimeId: run.runtime_id,
  });
  const binding = runtimeBindingFromContext(context);
  if (
    runtimeContextHash(context) !== run.runtime_context_hash
    || binding.runtime_context_hash !== run.binding.runtime_context_hash
    || binding.config_hash !== run.binding.config_hash
    || binding.repository_hash !== run.binding.repository_hash
    || context.repository.common_dir !== commonDir
  ) throw new CliError("Generated task contract runtime does not match the active run", 73);
  const snapshot = gitSnapshot(context.repository.root);
  if (
    snapshot.commonDir !== commonDir
    || snapshot.cleanliness !== "clean"
    || snapshot.revision !== currentBaseline.revision
  ) throw new CliError("Generated task contract baseline must be the current clean repository revision", 73);
  const coordinator = {
    lineage_id: run.binding.lineage.lineage_id,
    thread_id: run.binding.lineage.thread_id,
    generation: run.binding.lineage.generation,
  };
  return {
    run_id: run.run_id,
    runtime_context_digest: run.runtime_context_hash,
    configuration_digest: run.binding.config_hash,
    repository_id: run.binding.repository_hash,
    common_dir: commonDir,
    coordinator_binding: {
      ...coordinator,
      binding_digest: coordinatorBindingDigest(coordinator),
    },
  };
}

function dependencyAuthorityReferences(value) {
  if (!Array.isArray(value) || value.length > 128) {
    throw new CliError("dependency_authorities must be an array with at most 128 entries");
  }
  const references = value.map((entry, index) => {
    requireExactFields(entry, {
      required: ["authority_kind", "authority_id"],
    }, `dependency_authorities[${index}]`);
    return {
      authority_kind: requireEnum(
        entry.authority_kind,
        ["task-disposition", "subagent-operation"],
        `dependency_authorities[${index}].authority_kind`,
      ),
      authority_id: requireText(
        entry.authority_id,
        `dependency_authorities[${index}].authority_id`,
        { max: 128, safeId: true },
      ),
    };
  });
  const identities = references.map((entry) => `${entry.authority_kind}:${entry.authority_id}`);
  if (new Set(identities).size !== identities.length) {
    throw new CliError("dependency_authorities contains duplicate authority references");
  }
  return references;
}

async function assertJournalCommonDirectory(stateRoot, commonDir) {
  const journalCommon = await realpath(guardRoot(stateRoot)).catch(() => null);
  const requestedCommon = await realpath(commonDir).catch(() => null);
  if (journalCommon === null || requestedCommon === null) {
    throw new CliError("Workflow journal and generated-contract Git common directories must exist");
  }
  if (journalCommon !== requestedCommon || commonDir !== requestedCommon) {
    throw new CliError("Generated task contract common_dir does not match the workflow journal");
  }
}

async function readPersistedJournal(stateRoot, runId, planId) {
  const paths = journalPaths(stateRoot, runId, planId);
  const raw = await readJson(paths.journal, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (raw === null) throw new CliError(`Unknown v0.6 workflow journal: ${runId}/${planId}`);
  const journal = validateWorkflowJournal(raw);
  if (journal.run_id !== runId || journal.plan_id !== planId) {
    throw new CliError("Workflow journal path does not match its run and plan identity");
  }
  return { paths, journal };
}

async function readRevision(stateRoot, runId, planId, revisionDigest) {
  const path = journalPaths(stateRoot, runId, planId, { revisionDigest }).revision;
  const raw = await readJson(path, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (raw === null) throw new CliError(`Persisted workflow revision is missing: ${revisionDigest}`);
  const revision = validateWorkflowPlanRevision(raw);
  if (revision.plan_id !== planId || revision.revision_digest !== revisionDigest) {
    throw new CliError("Persisted workflow revision path does not match its content-addressed identity");
  }
  return revision;
}

async function readContract(stateRoot, runId, planId, contractId) {
  const path = journalPaths(stateRoot, runId, planId, { contractId }).contract;
  const raw = await readJson(path, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
  if (raw === null) throw new CliError(`Persisted generated task contract is missing: ${contractId}`);
  const contract = validateGeneratedTaskContract(raw);
  if (
    contract.run_id !== runId || contract.plan_id !== planId || contract.contract_id !== contractId
  ) throw new CliError("Persisted generated task contract path does not match its canonical identity");
  return contract;
}

async function loadAuthority(stateRoot, runId, planId) {
  const { paths, journal } = await readPersistedJournal(stateRoot, runId, planId);
  const revisions = [];
  for (const entry of journal.revisions) {
    const revision = await readRevision(stateRoot, runId, planId, entry.revision_digest);
    if (revision.revision !== entry.revision) {
      throw new CliError("Persisted workflow revision number does not match its journal entry");
    }
    if (revision.revision === 1 && revision.parent_revision_digest !== null) {
      throw new CliError("Persisted workflow revision one must not name a parent");
    }
    if (revision.revision > 1 && revision.parent_revision_digest !== revisions.at(-1).revision_digest) {
      throw new CliError("Persisted workflow revision chain is not contiguous");
    }
    revisions.push(revision);
  }
  const contracts = new Map();
  for (const claim of journal.contract_claims) {
    const contract = await readContract(stateRoot, runId, planId, claim.contract_id);
    if (stableStringify(claimIdentity(contract)) !== stableStringify({
      run_id: claim.run_id,
      runtime_context_digest: claim.runtime_context_digest,
      configuration_digest: claim.configuration_digest,
      repository_id: claim.repository_id,
      common_dir: claim.common_dir,
      coordinator_binding: claim.coordinator_binding,
      plan_id: claim.plan_id,
      revision_digest: claim.revision_digest,
      task_id: claim.task_id,
      task_digest: claim.task_digest,
      contract_id: claim.contract_id,
      execution_kind: claim.execution_kind,
    })) throw new CliError("Workflow contract claim does not match its persisted generated contract");
    contracts.set(claim.contract_id, contract);
  }
  return { paths, journal, revisions, contracts, currentRevision: revisions.at(-1) };
}

async function listJournalRecords(directory, stateRoot) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = safeChild(directory, entry.name, "operation record");
    records.push({ path, raw: await readJson(path, { guardRoot: guardRoot(stateRoot) }) });
  }
  return records;
}

function operationIdentity(record) {
  return {
    run_id: record.run_id,
    runtime_context_digest: record.runtime_context_digest,
    configuration_digest: record.configuration_digest,
    repository_id: record.repository_id,
    common_dir: record.common_dir,
    coordinator_binding: record.coordinator_binding,
    plan_id: record.plan_id,
    revision_digest: record.revision_digest,
    task_id: record.task_id,
    task_digest: record.task_digest,
    contract_id: record.contract_id,
  };
}

function assertOperationMatchesContract(operation, contract, operationKind) {
  const contractIdentity = claimIdentity(contract);
  const expected = {
    run_id: contractIdentity.run_id,
    runtime_context_digest: contractIdentity.runtime_context_digest,
    configuration_digest: contractIdentity.configuration_digest,
    repository_id: contractIdentity.repository_id,
    common_dir: contractIdentity.common_dir,
    coordinator_binding: contractIdentity.coordinator_binding,
    plan_id: contractIdentity.plan_id,
    revision_digest: contractIdentity.revision_digest,
    task_id: contractIdentity.task_id,
    task_digest: contractIdentity.task_digest,
    contract_id: contractIdentity.contract_id,
  };
  if (stableStringify(operationIdentity(operation)) !== stableStringify(expected)) {
    throw new CliError("Persisted native operation does not match its workflow contract claim");
  }
  const expectedExecutionKind = operationKind === "visible-task-creation" ? "task-thread" : "subagent";
  if (contract.task.execution_kind !== expectedExecutionKind) {
    throw new CliError("Persisted native operation uses the wrong execution surface for its workflow contract");
  }
}

async function scanStartedOperations(stateRoot, authority) {
  const operations = new Map();
  const visibleRoot = resolve(stateRoot, "visible-task-creations", "records");
  const visibleRecords = await listJournalRecords(visibleRoot, stateRoot);
  const validateVisibleTaskCreationRecord = visibleRecords.length === 0
    ? null
    : (await import("./task-creation-v06.mjs")).validateVisibleTaskCreationRecord;
  for (const { path, raw } of visibleRecords) {
    const record = validateVisibleTaskCreationRecord(raw);
    if (basename(path) !== `${record.operation_id}.json`) {
      throw new CliError("Visible-task operation filename does not match its operation_id");
    }
    if (record.run_id !== authority.journal.run_id || record.plan_id !== authority.journal.plan_id) continue;
    const contract = authority.contracts.get(record.contract_id);
    if (!contract) throw new CliError("Visible-task operation has no persisted workflow contract claim");
    assertOperationMatchesContract(record, contract, "visible-task-creation");
    if (operations.has(record.contract_id)) {
      throw new CliError("Workflow task contract has multiple persisted native operations");
    }
    operations.set(record.contract_id, {
      operation_kind: "visible-task-creation",
      operation_id: record.operation_id,
      started_at: record.prepared_at,
    });
  }
  const subagentRoot = resolve(stateRoot, "subagents", "records");
  const subagentRecords = await listJournalRecords(subagentRoot, stateRoot);
  const validateSubagentOperation = subagentRecords.length === 0
    ? null
    : (await import("./subagent-operations-v06.mjs")).validateSubagentOperation;
  for (const { path, raw } of subagentRecords) {
    const record = validateSubagentOperation(raw);
    if (basename(path) !== `${record.operation_id}.json`) {
      throw new CliError("Subagent operation filename does not match its operation_id");
    }
    if (record.run_id !== authority.journal.run_id || record.plan_id !== authority.journal.plan_id) continue;
    const contract = authority.contracts.get(record.contract_id);
    if (!contract) throw new CliError("Subagent operation has no persisted workflow contract claim");
    assertOperationMatchesContract(record, contract, "subagent-operation");
    if (operations.has(record.contract_id)) {
      throw new CliError("Workflow task contract has multiple persisted native operations");
    }
    operations.set(record.contract_id, {
      operation_kind: "subagent-operation",
      operation_id: record.operation_id,
      started_at: record.prepared_at,
    });
  }
  return operations;
}

function deriveClaims(journal, operations) {
  return journal.contract_claims.map((claim) => {
    const operation = operations.get(claim.contract_id);
    if (!operation) return claim;
    if (claim.state === "revoked") {
      throw new CliError(`Revoked workflow contract was used to start task ${claim.task_id}`);
    }
    if (claim.state === "started") {
      if (
        claim.operation_kind !== operation.operation_kind
        || claim.operation_id !== operation.operation_id
        || claim.started_at !== operation.started_at
      ) throw new CliError("Started workflow claim disagrees with its persisted native operation");
      return claim;
    }
    return validateContractClaim({
      ...claim,
      state: "started",
      operation_kind: operation.operation_kind,
      operation_id: operation.operation_id,
      started_at: operation.started_at,
    });
  });
}

function claimForContract(contract, claimedAt) {
  const identity = claimIdentity(contract);
  return validateContractClaim({
    schema_version: WORKFLOW_JOURNAL_SCHEMA_VERSION,
    kind: WORKFLOW_CONTRACT_CLAIM_KIND,
    claim_id: claimIdFor(identity),
    ...identity,
    state: "current",
    operation_kind: null,
    operation_id: null,
    claimed_at: claimedAt,
    started_at: null,
    revoked_at: null,
  });
}

function journalWithClaims(journal, contractClaims, updatedAt) {
  return withJournalDigest({
    ...journal,
    contract_claims: contractClaims,
    updated_at: updatedAt,
  });
}

async function persistedView(stateRoot, authority) {
  const operations = await scanStartedOperations(stateRoot, authority);
  const derived = deriveClaims(authority.journal, operations);
  return {
    journal: clone(authority.journal),
    current_revision: clone(authority.currentRevision),
    contracts: derived.map((claim) => ({
      claim: clone(claim),
      contract: clone(authority.contracts.get(claim.contract_id)),
      operation_record_present: operations.has(claim.contract_id),
      start_permitted: claim.state === "current"
        && claim.revision_digest === authority.journal.current_revision_digest,
      historical_authority: claim.state === "started"
        && claim.revision_digest !== authority.journal.current_revision_digest,
    })),
  };
}

export async function createWorkflowJournal({
  stateRoot,
  runId,
  planId,
  planRevision,
  now = Date.now(),
}) {
  const run = safeSegment(runId, "run_id");
  const plan = safeSegment(planId, "plan_id");
  const revision = createWorkflowPlanRevision(planRevision);
  if (revision.plan_id !== plan) throw new CliError("Workflow plan_id does not match the explicit journal planId");
  const paths = journalPaths(stateRoot, run, plan, { revisionDigest: revision.revision_digest });
  return withProcessLock({
    path: paths.lock,
    guardRoot: guardRoot(stateRoot),
    label: `workflow journal ${run}/${plan}`,
  }, async () => {
    const existing = await readJson(paths.journal, { allowMissing: true, guardRoot: guardRoot(stateRoot) });
    if (existing !== null) {
      const authority = await loadAuthority(stateRoot, run, plan);
      if (authority.revisions[0].revision_digest !== revision.revision_digest) {
        throw new CliError("Workflow journal already exists with a different root revision");
      }
      return persistedView(stateRoot, authority);
    }
    const timestamp = nowIso(now);
    await ensureExactJson(paths.revision, revision, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    const journal = withJournalDigest({
      schema_version: WORKFLOW_JOURNAL_SCHEMA_VERSION,
      kind: WORKFLOW_JOURNAL_KIND,
      run_id: run,
      plan_id: plan,
      current_revision: 1,
      current_revision_digest: revision.revision_digest,
      revisions: [{ revision: 1, revision_digest: revision.revision_digest, admitted_at: timestamp }],
      contract_claims: [],
      created_at: timestamp,
      updated_at: timestamp,
    });
    await ensureExactJson(paths.journal, journal, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    return persistedView(stateRoot, {
      paths: journalPaths(stateRoot, run, plan),
      journal,
      revisions: [revision],
      contracts: new Map(),
      currentRevision: revision,
    });
  });
}

function assertHistoricalStartedTasksUnchanged(nextRevision, claims, contracts) {
  const nextTasks = new Map(nextRevision.tasks.map((task) => [task.task_id, task]));
  for (const claim of claims.filter((entry) => entry.state === "started")) {
    const historical = contracts.get(claim.contract_id);
    const next = nextTasks.get(claim.task_id);
    if (!next || stableStringify(next) !== stableStringify(historical.task)) {
      throw new CliError(`Started task ${claim.task_id} and its dependency edges are immutable`);
    }
  }
}

export async function reviseWorkflowJournal({
  stateRoot,
  runId,
  planId,
  draft,
  now = Date.now(),
}) {
  const run = safeSegment(runId, "run_id");
  const plan = safeSegment(planId, "plan_id");
  const paths = journalPaths(stateRoot, run, plan);
  return withProcessLock({
    path: paths.lock,
    guardRoot: guardRoot(stateRoot),
    label: `workflow journal ${run}/${plan}`,
  }, async () => {
    let authority = await loadAuthority(stateRoot, run, plan);
    const operations = await scanStartedOperations(stateRoot, authority);
    const derivedClaims = deriveClaims(authority.journal, operations);
    if (draft?.revision === authority.currentRevision.revision) {
      const candidate = validateWorkflowPlanRevision({
        ...draft,
        revision_digest: draft.revision_digest ?? authority.currentRevision.revision_digest,
      });
      if (candidate.revision_digest !== authority.currentRevision.revision_digest) {
        throw new CliError("Workflow revision retry does not match the current content-addressed revision");
      }
      if (stableStringify(derivedClaims) !== stableStringify(authority.journal.contract_claims)) {
        const updated = journalWithClaims(authority.journal, derivedClaims, nowIso(now));
        await atomicWriteJson(paths.journal, updated, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
        authority = { ...authority, journal: updated };
      }
      return persistedView(stateRoot, authority);
    }
    const startedCurrentContracts = derivedClaims
      .filter((claim) => claim.state === "started" && claim.revision_digest === authority.currentRevision.revision_digest)
      .map((claim) => authority.contracts.get(claim.contract_id));
    const nextRevision = createNextWorkflowPlanRevision({
      previous_revision: authority.currentRevision,
      draft,
      started_task_contracts: startedCurrentContracts,
    });
    assertHistoricalStartedTasksUnchanged(nextRevision, derivedClaims, authority.contracts);
    const timestamp = nowIso(now);
    const transitionedClaims = derivedClaims.map((claim) => {
      if (claim.state !== "current") return claim;
      return validateContractClaim({
        ...claim,
        state: "revoked",
        revoked_at: timestamp,
      });
    });
    const revisionPath = journalPaths(stateRoot, run, plan, {
      revisionDigest: nextRevision.revision_digest,
    }).revision;
    await ensureExactJson(revisionPath, nextRevision, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    const updated = withJournalDigest({
      ...authority.journal,
      current_revision: nextRevision.revision,
      current_revision_digest: nextRevision.revision_digest,
      revisions: [
        ...authority.journal.revisions,
        {
          revision: nextRevision.revision,
          revision_digest: nextRevision.revision_digest,
          admitted_at: timestamp,
        },
      ],
      contract_claims: transitionedClaims,
      updated_at: timestamp,
    });
    await atomicWriteJson(paths.journal, updated, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    return persistedView(stateRoot, {
      ...authority,
      journal: updated,
      revisions: [...authority.revisions, nextRevision],
      currentRevision: nextRevision,
    });
  });
}

export async function workflowJournalStatus({ stateRoot, runId, planId }) {
  const run = safeSegment(runId, "run_id");
  const plan = safeSegment(planId, "plan_id");
  return persistedView(stateRoot, await loadAuthority(stateRoot, run, plan));
}

async function resolvePersistedDependencyRecords({
  stateRoot,
  authority,
  claims,
  taskId,
  dependencyAuthorities,
}) {
  const task = authority.currentRevision.tasks.find((entry) => entry.task_id === taskId);
  if (!task) throw new CliError(`Unknown workflow task: ${taskId}`);
  const references = dependencyAuthorityReferences(dependencyAuthorities);
  if (references.length !== task.dependencies.length) {
    throw new CliError("dependency_authorities must cover exactly the task dependencies");
  }
  const expectedTasks = new Map(task.dependencies.map((dependencyTaskId) => {
    const dependencyTask = authority.currentRevision.tasks.find(
      (entry) => entry.task_id === dependencyTaskId,
    );
    if (!dependencyTask) throw new CliError(`Unknown workflow dependency: ${dependencyTaskId}`);
    return [dependencyTaskId, dependencyTask];
  }));
  const records = [];
  for (const reference of references) {
    let record;
    if (reference.authority_kind === "task-disposition") {
      const { taskDispositionStatus } = await import("./dispositions.mjs");
      const status = await taskDispositionStatus({
        stateRoot,
        dispositionId: reference.authority_id,
      });
      if (!status.unblocks_dependencies) {
        throw new CliError(`Dependency disposition is not completed and accepted: ${reference.authority_id}`);
      }
      const { unblocks_dependencies: ignored, ...persistedRecord } = status;
      record = persistedRecord;
    } else {
      const { subagentOperationStatus, isSubagentDependencyUnblocked } = await import(
        "./subagent-operations-v06.mjs"
      );
      record = await subagentOperationStatus({
        stateRoot,
        operationId: reference.authority_id,
      });
      if (!isSubagentDependencyUnblocked(record)) {
        throw new CliError(`Dependency subagent is not durably accepted: ${reference.authority_id}`);
      }
    }
    const dependencyTask = expectedTasks.get(record.task_id);
    if (!dependencyTask) {
      throw new CliError("dependency_authorities resolved outside the task dependency set");
    }
    const expectedKind = dependencyTask.execution_kind === "task-thread"
      ? "task-disposition"
      : "subagent-operation";
    if (reference.authority_kind !== expectedKind) {
      throw new CliError(`Dependency ${record.task_id} uses the wrong terminal authority kind`);
    }
    const claim = claims.find((entry) => (
      entry.task_id === record.task_id
      && entry.contract_id === record.contract_id
      && entry.state === "started"
    ));
    const contract = authority.contracts.get(record.contract_id);
    if (
      !claim
      || !contract
      || claim.operation_id !== record.operation_id
      || stableStringify(operationIdentity(record)) !== stableStringify(operationIdentity(contract))
    ) {
      throw new CliError(`Dependency ${record.task_id} does not match its persisted workflow authority`);
    }
    records.push(record);
    expectedTasks.delete(record.task_id);
  }
  if (expectedTasks.size !== 0) {
    throw new CliError("dependency_authorities must cover exactly the task dependencies");
  }
  return records;
}

export async function persistWorkflowTaskContract({
  stateRoot,
  runId,
  planId,
  taskId,
  currentBaseline,
  dependencyAuthorities,
  now = Date.now(),
}) {
  const run = safeSegment(runId, "run_id");
  const plan = safeSegment(planId, "plan_id");
  const task = safeSegment(taskId, "task_id");
  const paths = journalPaths(stateRoot, run, plan);
  return withProcessLock({
    path: paths.lock,
    guardRoot: guardRoot(stateRoot),
    label: `workflow journal ${run}/${plan}`,
  }, async () => {
    let persisted = await loadAuthority(stateRoot, run, plan);
    const operations = await scanStartedOperations(stateRoot, persisted);
    const derivedClaims = deriveClaims(persisted.journal, operations);
    const historicalStarted = derivedClaims.find((claim) => (
      claim.task_id === task
      && claim.state === "started"
      && claim.revision_digest !== persisted.journal.current_revision_digest
    ));
    if (historicalStarted) {
      throw new CliError(`Task ${task} already started under historical revision ${historicalStarted.revision_digest}`);
    }
    const contractAuthority = await activeContractAuthority(
      stateRoot,
      run,
      plan,
      currentBaseline,
    );
    await assertJournalCommonDirectory(stateRoot, contractAuthority.common_dir);
    const dependencyRecords = await resolvePersistedDependencyRecords({
      stateRoot,
      authority: persisted,
      claims: derivedClaims,
      taskId: task,
      dependencyAuthorities,
    });
    const contract = generateTaskContract({
      plan_revision: persisted.currentRevision,
      task_id: task,
      current_baseline: currentBaseline,
      dependency_records: dependencyRecords,
      authority: contractAuthority,
    });
    const existingClaim = derivedClaims.find((claim) => (
      claim.task_id === task && claim.revision_digest === persisted.journal.current_revision_digest
    ));
    if (existingClaim) {
      if (existingClaim.contract_id !== contract.contract_id) {
        throw new CliError(`Task ${task} already has a different contract claim in the current revision`);
      }
      return clone(persisted.contracts.get(existingClaim.contract_id));
    }
    const timestamp = nowIso(now);
    const claim = claimForContract(contract, timestamp);
    const contractPath = journalPaths(stateRoot, run, plan, { contractId: contract.contract_id }).contract;
    await ensureExactJson(contractPath, contract, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    const updated = journalWithClaims(
      persisted.journal,
      [...derivedClaims, claim],
      timestamp,
    );
    await atomicWriteJson(paths.journal, updated, { guardRoot: guardRoot(stateRoot), mode: 0o600 });
    return clone(contract);
  });
}

export async function workflowTaskContractStatus({ stateRoot, runId, planId, contractId }) {
  const id = requireDigest(contractId, "contract_id");
  const status = await workflowJournalStatus({ stateRoot, runId, planId });
  const entry = status.contracts.find((candidate) => candidate.claim.contract_id === id);
  if (!entry) throw new CliError(`Unknown workflow contract claim: ${id}`);
  return entry;
}

export async function assertWorkflowTaskContractCurrent({ stateRoot, runId, planId, taskContract }) {
  const contract = validateGeneratedTaskContract(taskContract);
  if (contract.run_id !== runId || contract.plan_id !== planId) {
    throw new CliError("Generated task contract does not match the explicit workflow journal identity");
  }
  const status = await workflowTaskContractStatus({
    stateRoot,
    runId,
    planId,
    contractId: contract.contract_id,
  });
  const freshStart = status.claim.state === "current" && status.start_permitted;
  const exactReplay = status.claim.state === "started" && status.operation_record_present;
  if (!freshStart && !exactReplay) {
    throw new CliError(`Workflow task contract is not current and startable: ${contract.contract_id}`);
  }
  if (stableStringify(status.contract) !== stableStringify(contract)) {
    throw new CliError("Generated task contract does not match its persisted workflow authority");
  }
  return clone(status);
}
