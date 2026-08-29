import { readdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  atomicWrite,
  CliError,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import {
  assertNoTrackedLegacyAuthority,
  loadRuntimeBundleDirectory,
  readRuntimeBundleSnapshot,
  readRuntimeContext,
  runtimeContextHash,
  validateRuntimeBundle,
  validateRuntimeConfig,
  validateRuntimeContext,
  validateRuntimePolicy,
} from "./runtime-context.mjs";

export const V06_ADOPTION_SCHEMA_VERSION = 1;
export const V06_ADOPTION_KIND = "codex-flow-v06-adoption";
export const V06_ADOPTION_PLAN_KIND = "codex-flow-v06-adoption-plan";
export const V06_RETIREMENT_PLAN_KIND = "codex-flow-v06-adoption-retirement-plan";

const ADOPTION_RELATIVE_PATH = ".codex/orchestration/v0.6/adoption.json";
const INSTRUCTIONS_RELATIVE_PATH = ".codex/orchestration/v0.6/INSTRUCTIONS.md";
const BUNDLE_RELATIVE_PATH = ".codex/orchestration/v0.6/runtime/bundle.json";
const BUNDLE_FILES_PREFIX = ".codex/orchestration/v0.6/runtime/files/";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const DIGEST = /^[0-9a-f]{64}$/;

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function validateTimestamp(value, label) {
  requireText(value, label, { max: 64 });
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CliError(`${label} must be an ISO-8601 timestamp with an explicit offset`);
  }
  return value;
}

function validateAbsoluteRepositoryRoot(value, label = "repositoryRoot") {
  requireText(value, label, { max: 2048 });
  if (!isAbsolute(value)) throw new CliError(`${label} must be an absolute path`);
  return resolve(value);
}

function validateDigest(value, label) {
  requireText(value, label, { max: 64 });
  if (!DIGEST.test(value)) throw new CliError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

export function adoptionRoot(repositoryRoot) {
  return join(validateAbsoluteRepositoryRoot(repositoryRoot), ".codex", "orchestration", "v0.6");
}

export function adoptionManifestPath(repositoryRoot) {
  return join(validateAbsoluteRepositoryRoot(repositoryRoot), ...ADOPTION_RELATIVE_PATH.split("/"));
}

export function adoptionInstructionsPath(repositoryRoot) {
  return join(validateAbsoluteRepositoryRoot(repositoryRoot), ...INSTRUCTIONS_RELATIVE_PATH.split("/"));
}

export function adoptionRuntimeRoot(repositoryRoot) {
  return join(adoptionRoot(repositoryRoot), "runtime");
}

function validateReviewedInstructions(value, label = "reviewed_instructions") {
  requireExactFields(value, {
    required: ["reviewed_by", "reviewed_at", "text"],
  }, label);
  return {
    reviewed_by: requireText(value.reviewed_by, `${label}.reviewed_by`, { max: 256 }),
    reviewed_at: validateTimestamp(value.reviewed_at, `${label}.reviewed_at`),
    text: requireText(value.text, `${label}.text`, { max: 16384 }),
  };
}

export function validateAdoptionManifest(value, label = "adoption manifest") {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "adopted_at", "bundle", "config",
      "policy", "reviewed_instructions",
    ],
  }, label);
  if (value.schema_version !== V06_ADOPTION_SCHEMA_VERSION) {
    throw new CliError(`${label}.schema_version must be ${V06_ADOPTION_SCHEMA_VERSION}`);
  }
  if (value.kind !== V06_ADOPTION_KIND) {
    throw new CliError(`${label}.kind must be ${V06_ADOPTION_KIND}`);
  }
  const adoption = {
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_ADOPTION_KIND,
    adopted_at: validateTimestamp(value.adopted_at, `${label}.adopted_at`),
    bundle: validateRuntimeBundle(value.bundle, `${label}.bundle`),
    config: validateRuntimeConfig(value.config),
    policy: validateRuntimePolicy(value.policy),
    reviewed_instructions: validateReviewedInstructions(value.reviewed_instructions, `${label}.reviewed_instructions`),
  };
  return adoption;
}

export function buildAdoptionManifest({
  runtime,
  config = runtime?.config,
  policy = runtime?.policy,
  reviewedInstructions,
  adoptedAt,
}) {
  return validateAdoptionManifest({
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_ADOPTION_KIND,
    adopted_at: adoptedAt,
    bundle: validateRuntimeContext(runtime).bundle,
    config,
    policy,
    reviewed_instructions: reviewedInstructions,
  });
}

export function renderAdoptionInstructions(manifest) {
  const adoption = validateAdoptionManifest(manifest);
  return [
    "# Codex Flow v0.6 adoption instructions",
    "",
    `Reviewed by: ${adoption.reviewed_instructions.reviewed_by}`,
    `Reviewed at: ${adoption.reviewed_instructions.reviewed_at}`,
    `Runtime bundle: ${adoption.bundle.bundle_sha256}`,
    `Configuration: ${adoption.config.config_id}`,
    `Policy: ${adoption.policy.policy_id}`,
    "",
    adoption.reviewed_instructions.text,
    "",
  ].join("\n");
}

function manifestBytes(manifest) {
  return Buffer.from(`${stableStringify(validateAdoptionManifest(manifest), 2)}\n`);
}

function operationFor(relativePath, before, after) {
  if (before !== null && Buffer.from(before).equals(Buffer.from(after))) return null;
  return {
    path: relativePath,
    action: before === null ? "create" : "update",
    before_sha256: before === null ? null : sha256(before),
    after_sha256: sha256(after),
  };
}

async function readOptionalBytes(repositoryRoot, path) {
  await assertNoSymlinkComponents(repositoryRoot, path, "v0.6 adoption path");
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function planIdFor(plan) {
  const { plan_id: ignored, ...withoutId } = plan;
  return sha256(stableStringify(withoutId));
}

function isSafeAdoptionPath(path) {
  if ([ADOPTION_RELATIVE_PATH, INSTRUCTIONS_RELATIVE_PATH, BUNDLE_RELATIVE_PATH].includes(path)) {
    return true;
  }
  if (!path.startsWith(BUNDLE_FILES_PREFIX)) return false;
  const runtimePath = path.slice(BUNDLE_FILES_PREFIX.length);
  return (
    runtimePath !== ""
    && !runtimePath.includes("\\")
    && !runtimePath.split("/").some((part) => part === "" || part === "." || part === "..")
    && ["bin/", "lib/", "schemas/", "roles/", "references/"].some(
      (prefix) => runtimePath.startsWith(prefix),
    )
  );
}

function validatePlanOperation(value, label, { retirement = false } = {}) {
  requireExactFields(value, {
    required: ["path", "action", "before_sha256", "after_sha256"],
  }, label);
  const path = requireText(value.path, `${label}.path`, { max: 1024 });
  if (!isSafeAdoptionPath(path)) {
    throw new CliError(`${label}.path is outside the v0.6 tracked adoption root`);
  }
  const allowed = retirement ? ["delete"] : ["create", "update"];
  if (!allowed.includes(value.action)) {
    throw new CliError(`${label}.action is not valid for this adoption plan`);
  }
  if (value.before_sha256 !== null) validateDigest(value.before_sha256, `${label}.before_sha256`);
  if (retirement) {
    if (value.before_sha256 === null || value.after_sha256 !== null) {
      throw new CliError(`${label} retirement operations must delete an existing file`);
    }
  } else {
    if (value.action === "create" && value.before_sha256 !== null) {
      throw new CliError(`${label}.create must not declare a previous hash`);
    }
    if (value.action === "update" && value.before_sha256 === null) {
      throw new CliError(`${label}.update must declare a previous hash`);
    }
    validateDigest(value.after_sha256, `${label}.after_sha256`);
  }
  return {
    path,
    action: value.action,
    before_sha256: value.before_sha256,
    after_sha256: value.after_sha256,
  };
}

function validatePlanOperations(value, label, options) {
  if (!Array.isArray(value) || value.length > 2052) {
    throw new CliError(`${label} must contain at most 2052 operations`);
  }
  const operations = value.map((operation, index) => validatePlanOperation(
    operation,
    `${label}[${index}]`,
    options,
  ));
  if (new Set(operations.map((operation) => operation.path)).size !== operations.length) {
    throw new CliError(`${label} cannot target the same path more than once`);
  }
  return operations.sort((left, right) => left.path.localeCompare(right.path));
}

function allowedPathsFor(adoption) {
  return new Set([
    ADOPTION_RELATIVE_PATH,
    INSTRUCTIONS_RELATIVE_PATH,
    BUNDLE_RELATIVE_PATH,
    ...Object.keys(adoption.bundle.files).map((path) => `${BUNDLE_FILES_PREFIX}${path}`),
  ]);
}

function assertOperationsBoundToAdoption(operations, adoption, label) {
  const allowed = allowedPathsFor(adoption);
  for (const operation of operations) {
    if (!allowed.has(operation.path)) {
      throw new CliError(`${label} contains a runtime path outside adoption.bundle`);
    }
  }
}

function validateAdoptionPlan(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "repository_root", "runtime_context_hash",
      "source_runtime", "adoption", "operations", "plan_id",
    ],
  }, "adoption plan");
  if (value.schema_version !== V06_ADOPTION_SCHEMA_VERSION || value.kind !== V06_ADOPTION_PLAN_KIND) {
    throw new CliError("adoption plan has an unsupported schema or kind");
  }
  const adoption = validateAdoptionManifest(value.adoption, "adoption plan.adoption");
  const sourceRuntime = validateRuntimeContext(value.source_runtime);
  const plan = {
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_ADOPTION_PLAN_KIND,
    repository_root: validateAbsoluteRepositoryRoot(value.repository_root, "adoption plan.repository_root"),
    runtime_context_hash: validateDigest(value.runtime_context_hash, "adoption plan.runtime_context_hash"),
    source_runtime: sourceRuntime,
    adoption,
    operations: validatePlanOperations(value.operations, "adoption plan.operations"),
    plan_id: validateDigest(value.plan_id, "adoption plan.plan_id"),
  };
  if (runtimeContextHash(sourceRuntime) !== plan.runtime_context_hash) {
    throw new CliError("adoption plan runtime_context_hash does not match source_runtime");
  }
  if (
    stableStringify(adoption.bundle) !== stableStringify(sourceRuntime.bundle)
    || stableStringify(adoption.config) !== stableStringify(sourceRuntime.config)
    || stableStringify(adoption.policy) !== stableStringify(sourceRuntime.policy)
  ) {
    throw new CliError("adoption must pin source_runtime bundle, configuration, and policy exactly");
  }
  assertOperationsBoundToAdoption(plan.operations, adoption, "adoption plan.operations");
  if (planIdFor(plan) !== plan.plan_id) throw new CliError("adoption plan_id does not match plan contents");
  return plan;
}

function validateRetirementPlan(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "repository_root", "adoption_hash",
      "retired_at", "reason", "operations", "plan_id",
    ],
  }, "retirement plan");
  if (value.schema_version !== V06_ADOPTION_SCHEMA_VERSION || value.kind !== V06_RETIREMENT_PLAN_KIND) {
    throw new CliError("retirement plan has an unsupported schema or kind");
  }
  const plan = {
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_RETIREMENT_PLAN_KIND,
    repository_root: validateAbsoluteRepositoryRoot(value.repository_root, "retirement plan.repository_root"),
    adoption_hash: validateDigest(value.adoption_hash, "retirement plan.adoption_hash"),
    retired_at: validateTimestamp(value.retired_at, "retirement plan.retired_at"),
    reason: requireText(value.reason, "retirement plan.reason", { max: 512 }),
    operations: validatePlanOperations(value.operations, "retirement plan.operations", { retirement: true }),
    plan_id: validateDigest(value.plan_id, "retirement plan.plan_id"),
  };
  if (plan.operations.length === 0) {
    throw new CliError("retirement plan must contain at least one explicit deletion");
  }
  if (planIdFor(plan) !== plan.plan_id) throw new CliError("retirement plan_id does not match plan contents");
  return plan;
}

function targetForOperation(repositoryRoot, operation) {
  const target = resolve(repositoryRoot, ...operation.path.split("/"));
  const relativeTarget = relative(repositoryRoot, target).split(sep).join("/");
  if (relativeTarget !== operation.path) {
    throw new CliError("adoption operation resolves outside the repository");
  }
  return target;
}

async function expectedAdoptionContents(adoption, sourceRuntime) {
  const validated = validateAdoptionManifest(adoption);
  const runtime = validateRuntimeContext(sourceRuntime);
  const runtimeSource = await readRuntimeBundleSnapshot({
    gitCommonDirectory: runtime.repository.common_dir,
    runtimeId: runtime.runtime_id,
  });
  if (stableStringify(runtimeSource.bundle) !== stableStringify(validated.bundle)) {
    throw new CliError("Adoption runtime snapshot does not match adoption.bundle");
  }
  return new Map([
    [ADOPTION_RELATIVE_PATH, manifestBytes(validated)],
    [INSTRUCTIONS_RELATIVE_PATH, Buffer.from(renderAdoptionInstructions(validated), "utf8")],
    [BUNDLE_RELATIVE_PATH, Buffer.from(`${stableStringify(runtimeSource.bundle, 2)}\n`)],
    ...runtimeSource.files.map((file) => [
      `${BUNDLE_FILES_PREFIX}${file.relativePath}`,
      Buffer.from(file.contents),
    ]),
  ]);
}

async function prepareRepositoryRoot(repositoryRoot) {
  const root = validateAbsoluteRepositoryRoot(repositoryRoot);
  await assertNoSymlinkComponents(root, root, "Repository root");
  return root;
}

export async function planAdoption({
  repositoryRoot,
  gitCommonDirectory,
  runtimeId,
  config,
  policy,
  reviewedInstructions,
  adoptedAt,
}) {
  const root = await prepareRepositoryRoot(repositoryRoot);
  await assertNoTrackedLegacyAuthority(root);
  const { context } = await readRuntimeContext({ gitCommonDirectory, runtimeId });
  if (context.repository.root !== root) {
    throw new CliError("runtime context.repository.root does not match repositoryRoot");
  }
  const adoption = buildAdoptionManifest({
    runtime: context,
    config: config ?? context.config,
    policy: policy ?? context.policy,
    reviewedInstructions,
    adoptedAt,
  });
  const contents = await expectedAdoptionContents(adoption, context);
  const operations = [];
  for (const [relativePath, after] of contents) {
    const before = await readOptionalBytes(root, targetForOperation(root, { path: relativePath }));
    const operation = operationFor(relativePath, before, after);
    if (operation) operations.push(operation);
  }
  const draft = {
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_ADOPTION_PLAN_KIND,
    repository_root: root,
    runtime_context_hash: runtimeContextHash(context),
    source_runtime: context,
    adoption,
    operations: operations.sort((left, right) => left.path.localeCompare(right.path)),
  };
  return {
    ...draft,
    plan_id: planIdFor(draft),
  };
}

function writeOrder(operations) {
  return [...operations].sort((left, right) => {
    if (left.path === ADOPTION_RELATIVE_PATH) return 1;
    if (right.path === ADOPTION_RELATIVE_PATH) return -1;
    return left.path.localeCompare(right.path);
  });
}

export async function applyAdoptionPlan({ repositoryRoot, plan }) {
  const root = await prepareRepositoryRoot(repositoryRoot);
  await assertNoTrackedLegacyAuthority(root);
  const validated = validateAdoptionPlan(plan);
  if (validated.repository_root !== root) {
    throw new CliError("adoption plan is bound to a different repository root");
  }
  const contents = await expectedAdoptionContents(validated.adoption, validated.source_runtime);
  const pending = [];
  for (const operation of validated.operations) {
    const target = targetForOperation(root, operation);
    const before = await readOptionalBytes(root, target);
    const actualHash = before === null ? null : sha256(before);
    if (actualHash === operation.after_sha256) continue;
    if (actualHash !== operation.before_sha256) {
      throw new CliError(`adoption plan is stale at ${operation.path}`);
    }
    const after = contents.get(operation.path);
    if (!after || sha256(after) !== operation.after_sha256) {
      throw new CliError(`adoption plan content does not match ${operation.path}`);
    }
    pending.push(operation);
  }
  for (const operation of writeOrder(pending)) {
    await atomicWrite(targetForOperation(root, operation), contents.get(operation.path), {
      guardRoot: root,
      mode: 0o600,
    });
  }
  await readAdoption({ repositoryRoot: root });
  return {
    plan_id: validated.plan_id,
    status: pending.length === 0 ? "already-applied" : "applied",
    applied: pending.map((operation) => ({
      path: operation.path,
      action: operation.action,
    })),
    adoption_path: adoptionManifestPath(root),
    instructions_path: adoptionInstructionsPath(root),
    runtime_root: adoptionRuntimeRoot(root),
  };
}

async function readRawAdoption(root) {
  const path = adoptionManifestPath(root);
  const raw = await readOptionalBytes(root, path);
  if (raw === null) return null;
  try {
    return {
      adoption: validateAdoptionManifest(JSON.parse(raw.toString("utf8"))),
      path,
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError(`Invalid v0.6 adoption manifest: ${path}`);
    throw error;
  }
}

async function adoptionFileInventory(root) {
  const managedRoot = adoptionRoot(root);
  const inventory = [];
  async function visit(directory) {
    await assertNoSymlinkComponents(root, directory, "Tracked v0.6 adoption directory");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Tracked v0.6 adoption contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) inventory.push(relative(root, path).split(sep).join("/"));
      else throw new CliError(`Tracked v0.6 adoption contains an unsupported entry: ${path}`);
    }
  }
  await visit(managedRoot);
  return inventory.sort((left, right) => left.localeCompare(right));
}

export async function readAdoption({ repositoryRoot }) {
  const root = await prepareRepositoryRoot(repositoryRoot);
  const record = await readRawAdoption(root);
  if (record === null) return null;
  const bundlePath = targetForOperation(root, { path: BUNDLE_RELATIVE_PATH });
  const rawBundle = await readOptionalBytes(root, bundlePath);
  if (rawBundle === null) throw new CliError("Tracked v0.6 adoption runtime bundle manifest is missing");
  let bundle;
  try {
    bundle = validateRuntimeBundle(JSON.parse(rawBundle.toString("utf8")), "tracked adoption runtime bundle");
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError(`Invalid tracked runtime bundle manifest: ${bundlePath}`);
    throw error;
  }
  if (stableStringify(bundle) !== stableStringify(record.adoption.bundle)) {
    throw new CliError("Tracked adoption runtime bundle does not match adoption.bundle");
  }
  await loadRuntimeBundleDirectory({
    bundleRoot: join(adoptionRuntimeRoot(root), "files"),
    bundle,
  });
  const rawInstructions = await readOptionalBytes(root, adoptionInstructionsPath(root));
  if (
    rawInstructions === null
    || !rawInstructions.equals(Buffer.from(renderAdoptionInstructions(record.adoption), "utf8"))
  ) {
    throw new CliError("Tracked v0.6 adoption instructions do not match the adoption manifest");
  }
  const inventory = await adoptionFileInventory(root);
  const expectedInventory = [...allowedPathsFor(record.adoption)].sort((left, right) => left.localeCompare(right));
  if (stableStringify(inventory) !== stableStringify(expectedInventory)) {
    throw new CliError("Tracked v0.6 adoption file inventory does not match the adoption manifest");
  }
  return record;
}

export async function planAdoptionRetirement({
  repositoryRoot,
  retiredAt,
  reason,
}) {
  const root = await prepareRepositoryRoot(repositoryRoot);
  const adoption = await readAdoption({ repositoryRoot: root });
  if (adoption === null) throw new CliError("No v0.6 tracked adoption is available to retire");
  const allowed = allowedPathsFor(adoption.adoption);
  const operations = [];
  for (const relativePath of allowed) {
    const target = targetForOperation(root, { path: relativePath });
    const before = await readOptionalBytes(root, target);
    if (before !== null) {
      operations.push({
        path: relativePath,
        action: "delete",
        before_sha256: sha256(before),
        after_sha256: null,
      });
    }
  }
  const draft = {
    schema_version: V06_ADOPTION_SCHEMA_VERSION,
    kind: V06_RETIREMENT_PLAN_KIND,
    repository_root: root,
    adoption_hash: sha256(manifestBytes(adoption.adoption)),
    retired_at: validateTimestamp(retiredAt, "retiredAt"),
    reason: requireText(reason, "reason", { max: 512 }),
    operations: operations.sort((left, right) => left.path.localeCompare(right.path)),
  };
  return {
    ...draft,
    plan_id: planIdFor(draft),
  };
}

function retirementOrder(operations) {
  return [...operations].sort((left, right) => {
    if (left.path === ADOPTION_RELATIVE_PATH) return 1;
    if (right.path === ADOPTION_RELATIVE_PATH) return -1;
    return right.path.localeCompare(left.path);
  });
}

export async function applyAdoptionRetirementPlan({ repositoryRoot, plan }) {
  const root = await prepareRepositoryRoot(repositoryRoot);
  const validated = validateRetirementPlan(plan);
  if (validated.repository_root !== root) {
    throw new CliError("retirement plan is bound to a different repository root");
  }
  const adoption = await readRawAdoption(root);
  if (adoption === null || sha256(manifestBytes(adoption.adoption)) !== validated.adoption_hash) {
    throw new CliError("retirement plan does not match the current v0.6 adoption");
  }
  assertOperationsBoundToAdoption(validated.operations, adoption.adoption, "retirement plan.operations");
  const expectedPaths = [...allowedPathsFor(adoption.adoption)].sort();
  const actualPaths = validated.operations.map((operation) => operation.path).sort();
  if (stableStringify(actualPaths) !== stableStringify(expectedPaths)) {
    throw new CliError("retirement plan must cover every tracked v0.6 adoption file");
  }
  const pending = [];
  for (const operation of validated.operations) {
    const target = targetForOperation(root, operation);
    const before = await readOptionalBytes(root, target);
    if (before === null) continue;
    if (sha256(before) !== operation.before_sha256) {
      throw new CliError(`retirement plan is stale at ${operation.path}`);
    }
    pending.push(operation);
  }
  for (const operation of retirementOrder(pending)) {
    await rm(targetForOperation(root, operation), { force: false });
  }
  return {
    plan_id: validated.plan_id,
    status: pending.length === 0 ? "already-applied" : "applied",
    applied: pending.map((operation) => ({
      path: operation.path,
      action: operation.action,
    })),
  };
}

export function adoptionSnapshot(manifest) {
  return clone(validateAdoptionManifest(manifest));
}
