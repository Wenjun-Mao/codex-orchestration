import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  atomicWrite,
  atomicWriteJson,
  CliError,
  readJson,
  requireExactFields,
  requireInteger,
  requireText,
  sha256,
  stableStringify,
  withProcessLock,
} from "./core.mjs";
import { assignmentStateRoot } from "./assignment-authority.mjs";
import { recipientBindingDigest } from "./task-results.mjs";
import { iterationTitle } from "./iteration-registry.mjs";

export const ASSIGNMENT_PREPARATION_KIND = "codex-flow-v097-assignment-preparation";

function list(value, label, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > 16) throw new CliError(`${label} must contain between ${min} and 16 entries`);
  return value.map((entry, index) => requireText(entry, `${label}[${index}]`, { max: 1200 }));
}

function recipient(value) {
  requireExactFields(value, { required: ["host_id", "lineage_id", "thread_id", "generation", "binding_digest"] }, "recipient");
  const result = {
    host_id: requireText(value.host_id, "recipient.host_id", { max: 128, safeId: true }),
    lineage_id: requireText(value.lineage_id, "recipient.lineage_id", { max: 128, safeId: true }),
    thread_id: requireText(value.thread_id, "recipient.thread_id", { max: 256, safeId: true }),
    generation: requireInteger(value.generation, "recipient.generation", { min: 1, max: 2147483647 }),
    binding_digest: requireText(value.binding_digest, "recipient.binding_digest", { max: 64 }),
  };
  if (result.binding_digest !== recipientBindingDigest({
    lineage_id: result.lineage_id,
    thread_id: result.thread_id,
    generation: result.generation,
  })) throw new CliError("recipient.binding_digest does not match its identity");
  return result;
}

function seed(value) {
  const { preparation_id: ignored, created_at: ignoredTimestamp, ...rest } = value;
  if (value.schema_version === 2) {
    const { snapshot_path: ignoredPath, ...approvedPlan } = rest.approved_plan;
    return { ...rest, approved_plan: approvedPlan };
  }
  return rest;
}

export function validateAssignmentPreparation(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "preparation_id", "common_dir", "approved_plan",
      "recipient", "iteration_label", "purpose", "title", "outcome", "scope",
      "acceptance_criteria", "constraints", "reasons", "created_at",
    ],
  }, "assignment preparation");
  if (![1, 2].includes(value.schema_version) || value.kind !== ASSIGNMENT_PREPARATION_KIND) throw new CliError("Unsupported assignment preparation");
  requireExactFields(value.approved_plan, { required: ["digest", "snapshot_path"] }, "approved_plan");
  const record = {
    schema_version: value.schema_version,
    kind: ASSIGNMENT_PREPARATION_KIND,
    preparation_id: requireText(value.preparation_id, "preparation_id", { max: 128, safeId: true }),
    common_dir: resolve(requireText(value.common_dir, "common_dir", { max: 2048 })),
    approved_plan: {
      digest: requireText(value.approved_plan.digest, "approved_plan.digest", { max: 64 }),
      snapshot_path: resolve(requireText(value.approved_plan.snapshot_path, "approved_plan.snapshot_path", { max: 4096 })),
    },
    recipient: recipient(value.recipient),
    iteration_label: requireText(value.iteration_label, "iteration_label", { max: 80 }),
    purpose: requireText(value.purpose, "purpose", { max: 120 }),
    title: requireText(value.title, "title", { max: 120 }),
    outcome: requireText(value.outcome, "outcome", { max: 2400 }),
    scope: list(value.scope, "scope", 1),
    acceptance_criteria: list(value.acceptance_criteria, "acceptance_criteria", 1),
    constraints: list(value.constraints, "constraints"),
    reasons: list(value.reasons, "reasons"),
    created_at: requireText(value.created_at, "created_at", { max: 64 }),
  };
  if (!/^[0-9a-f]{64}$/.test(record.approved_plan.digest)) throw new CliError("approved_plan.digest must be SHA-256");
  if (!Number.isFinite(Date.parse(record.created_at))) throw new CliError("created_at must be a timestamp");
  if (record.title !== iterationTitle("Coordinator", record.iteration_label, record.purpose)) throw new CliError("title is not the canonical iteration title");
  const idPrefix = record.schema_version === 1 ? "assignment-preparation-v1-" : "assignment-preparation-v2-";
  if (record.preparation_id !== `${idPrefix}${sha256(stableStringify(seed(record)))}`) throw new CliError("preparation_id does not match its content");
  if (
    record.schema_version === 2
    && dirname(record.approved_plan.snapshot_path) !== resolve(
      assignmentStateRoot(record.common_dir),
      "preparations",
      "plans",
      record.preparation_id,
    )
  ) throw new CliError("approved_plan.snapshot_path does not belong to its preparation");
  return record;
}

function paths(stateRoot, id) {
  const records = resolve(stateRoot, "preparations", "records");
  const record = resolve(records, `${id}.json`);
  if (dirname(record) !== records || basename(record) !== `${id}.json`) throw new CliError("Unsafe assignment preparation path");
  return { record, lock: resolve(stateRoot, "preparations", "locks", `${id}.lock.json`) };
}

export async function prepareCoordinatorAssignment({ commonDir, approvedPlanPath, recipient: recipientInput, iterationLabel, purpose, outcome, scope, acceptanceCriteria, constraints, reasons, now = Date.now() }) {
  const stateRoot = assignmentStateRoot(commonDir);
  const sourcePath = resolve(requireText(approvedPlanPath, "approved_plan_path", { max: 4096 }));
  const bytes = await readFile(sourcePath);
  const approvedPlanDigest = sha256(bytes);
  const candidateLabel = basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  const sourceLabel = ["", ".", ".."].includes(candidateLabel) ? "approved-plan.md" : candidateLabel;
  const identityDraft = {
    schema_version: 2, kind: ASSIGNMENT_PREPARATION_KIND, preparation_id: "pending",
    common_dir: resolve(commonDir), approved_plan: { digest: approvedPlanDigest, snapshot_path: resolve(commonDir, "pending") },
    recipient: recipient(recipientInput), iteration_label: iterationLabel, purpose,
    title: iterationTitle("Coordinator", iterationLabel, purpose), outcome,
    scope, acceptance_criteria: acceptanceCriteria, constraints, reasons,
    created_at: new Date(now).toISOString(),
  };
  const preparationId = `assignment-preparation-v2-${sha256(stableStringify(seed(identityDraft)))}`;
  const snapshotPath = resolve(stateRoot, "preparations", "plans", preparationId, sourceLabel);
  const record = validateAssignmentPreparation({
    ...identityDraft,
    preparation_id: preparationId,
    approved_plan: { digest: approvedPlanDigest, snapshot_path: snapshotPath },
  });
  const location = paths(stateRoot, record.preparation_id);
  let persisted = record;
  await withProcessLock({ path: location.lock, guardRoot: commonDir, label: `assignment preparation ${record.preparation_id}` }, async () => {
    const existing = await readJson(location.record, { allowMissing: true, guardRoot: commonDir });
    if (existing !== null) {
      const validated = validateAssignmentPreparation(existing);
      if (stableStringify(seed(validated)) !== stableStringify(seed(record))) throw new CliError("Assignment preparation conflicts", 73);
      if (sha256(await readFile(validated.approved_plan.snapshot_path)) !== validated.approved_plan.digest) {
        throw new CliError("Assignment preparation plan was tampered", 73);
      }
      persisted = validated;
    } else {
      try { await atomicWrite(snapshotPath, bytes, { exclusive: true, guardRoot: commonDir, mode: 0o600 }); }
      catch (error) { if (error?.code !== "EEXIST") throw error; if (sha256(await readFile(snapshotPath)) !== approvedPlanDigest) throw new CliError("Approved plan snapshot conflicts", 73); }
      await atomicWriteJson(location.record, record, { guardRoot: commonDir, mode: 0o600 });
    }
  });
  return { state_root: stateRoot, preparation: persisted, text: preparedAssignmentText(persisted) };
}

export async function assignmentPreparation({ stateRoot, preparationId }) {
  const record = validateAssignmentPreparation(await readJson(paths(stateRoot, preparationId).record, { guardRoot: resolve(stateRoot, "..", "..") }));
  if (sha256(await readFile(record.approved_plan.snapshot_path)) !== record.approved_plan.digest) throw new CliError("Assignment preparation plan was tampered", 73);
  return record;
}

export function preparedAssignmentText(recordInput) {
  const record = validateAssignmentPreparation(recordInput);
  const sections = [
    `# ${record.title}`, "", record.outcome, "", "## Scope", "", ...record.scope.map((x) => `- ${x}`),
    "", "## Acceptance", "", ...record.acceptance_criteria.map((x) => `- ${x}`),
  ];
  if (record.constraints.length) sections.push("", "## Constraints", "", ...record.constraints.map((x) => `- ${x}`));
  if (record.reasons.length) sections.push("", "## Action-changing reasons", "", ...record.reasons.map((x) => `- ${x}`));
  const sourceLabel = basename(record.approved_plan.snapshot_path);
  sections.push("", "## Start", "", `Preparation: \`${record.preparation_id}\``, `Approved plan snapshot (source: ${sourceLabel}): [open the approved plan](<${record.approved_plan.snapshot_path}>)`, `Reporting recipient: \`${record.recipient.thread_id}\` on \`${record.recipient.host_id}\``, "Invoke `codex-orchestration:coordinate`, activate the run, then register the coordinator report route using this preparation ID before substantive work.");
  return `${sections.join("\n")}\n`;
}
