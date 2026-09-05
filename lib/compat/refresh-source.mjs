import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertNoSymlinkComponents,
  CliError,
  PACKAGE_VERSION,
  readJson,
  requireExactFields,
  requireObject,
  requireText,
  sha256,
  stableStringify,
} from "../core.mjs";
import { validateArchiveOperation } from "../archive-lifecycle.mjs";
import { validateDispositionRecord } from "../dispositions.mjs";
import { validateIntegrationRecord } from "../integration.mjs";
import { validateRunLifecycleState } from "../run-lifecycle.mjs";
import { gitSnapshot } from "../git.mjs";
import {
  loadRuntimeBundleDirectory,
  runtimeBindingFromContext,
  runtimeContextHash,
  validateRuntimeBundle,
  validateRuntimeContext,
} from "../runtime-context.mjs";
import { validateSubagentOperation } from "../subagent-operations.mjs";
import { validateTaskLaunchRecord } from "../core/task-launch.mjs";
import { validateWorkflowJournal } from "../workflow-journal.mjs";
import {
  validateGeneratedTaskContract,
  validateWorkflowPlanRevision,
} from "../workflow-plan.mjs";

export const REFRESH_SOURCE_EXPORT_SCHEMA_VERSION = 1;
export const REFRESH_SOURCE_EXPORT_KIND = "codex-flow-refresh-source-v1";

const VERSIONED_REFRESH_SOURCE = /^v(\d+)\.(\d+)\.(\d+)(?:-(?:dev|rc)\.[0-9]+)?$/;
const MAX_SOURCE_FILES = 8192;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_EXPORT_BYTES = 256 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const REFRESH_BUNDLE_PATH_PREFIXES = [
  "bin/", "lib/", "schemas/", "roles/", "references/", "skills/",
];

const CURRENT_SOURCE_API = {
  readJson,
  validateArchiveOperation,
  validateDispositionRecord,
  validateGeneratedTaskContract,
  validateIntegrationRecord,
  validateRunLifecycleState,
  validateSubagentOperation,
  validateTaskLaunchRecord,
  validateWorkflowJournal,
  validateWorkflowPlanRevision,
  loadRuntimeBundleDirectory,
  runtimeBindingFromContext,
  runtimeContextHash,
  validateRuntimeBundle,
  validateRuntimeContext,
};

function objectValue(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`${label} must be an object`, 73);
  }
  return value;
}

function digestValue(value, label) {
  const text = requireText(value, label, { max: 64 });
  if (!DIGEST.test(text)) throw new CliError(`${label} must be a lowercase SHA-256 digest`, 73);
  return text;
}

function absoluteValue(value, label) {
  const text = requireText(value, label, { max: 2048 });
  if (!isAbsolute(text)) throw new CliError(`${label} must be an absolute path`, 73);
  return resolve(text);
}

function refreshBundlePath(value, label) {
  const path = requireText(value, label, { max: 512 });
  if (
    path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
    || !REFRESH_BUNDLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) throw new CliError(`${label} must be a safe runtime path`, 73);
  return path;
}

function refreshBundleKind(packageVersion) {
  if (/^0\.8\./.test(packageVersion)) return "codex-flow-v07-runtime-bundle";
  if (/^0\.9\./.test(packageVersion)) return "codex-flow-v09-runtime-bundle";
  throw new CliError(`Unsupported refresh bundle version ${packageVersion}`, 73);
}

function validateRefreshBootstrapBundle(value, label = "refresh source bootstrap bundle") {
  requireExactFields(value, {
    required: ["schema_version", "kind", "package_version", "files", "bundle_sha256"],
  }, label);
  if (value.schema_version !== 1) throw new CliError(`${label}.schema_version must be 1`, 73);
  const packageVersion = requireText(value.package_version, `${label}.package_version`, { max: 128 });
  const expectedKind = refreshBundleKind(packageVersion);
  if (value.kind !== expectedKind) throw new CliError(`${label}.kind must be ${expectedKind}`, 73);
  requireObject(value.files, `${label}.files`);
  const entries = Object.entries(value.files);
  if (entries.length === 0 || entries.length > 2048) {
    throw new CliError(`${label}.files must contain between 1 and 2048 files`, 73);
  }
  const files = Object.fromEntries(entries.map(([path, hash]) => [
    refreshBundlePath(path, `${label}.files path`),
    digestValue(hash, `${label}.files.${path}`),
  ]).sort(([left], [right]) => left.localeCompare(right)));
  const bundle = {
    schema_version: 1,
    kind: expectedKind,
    package_version: packageVersion,
    files,
    bundle_sha256: digestValue(value.bundle_sha256, `${label}.bundle_sha256`),
  };
  const { bundle_sha256: ignored, ...seed } = bundle;
  if (sha256(stableStringify(seed)) !== bundle.bundle_sha256) {
    throw new CliError(`${label}.bundle_sha256 does not match the bundle manifest`, 73);
  }
  return bundle;
}

async function loadRefreshBootstrapBundleDirectory({ bundleRoot, bundle }) {
  const root = absoluteValue(bundleRoot, "refresh source bundle root");
  const expected = validateRefreshBootstrapBundle(bundle);
  await assertNoSymlinkComponents(root, root, "Refresh source bundle root");
  const inventory = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Refresh bundle contains a symlink: ${path}`, 73);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) inventory.push(relative(root, path).split(sep).join("/"));
      else throw new CliError(`Refresh bundle contains an unsupported entry: ${path}`, 73);
    }
  }
  await visit(root);
  const paths = Object.keys(expected.files).sort();
  if (stableStringify(inventory.sort()) !== stableStringify(paths)) {
    throw new CliError("Refresh bundle inventory does not match its manifest", 73);
  }
  for (const relativePath of paths) {
    const path = join(root, ...relativePath.split("/"));
    await assertNoSymlinkComponents(root, path, "Refresh source bundle file");
    if (sha256(await readFile(path)) !== expected.files[relativePath]) {
      throw new CliError(`Refresh bundle file hash does not match: ${relativePath}`, 73);
    }
  }
  return expected;
}

function runGit(cwd, args, label, { allow = [] } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0 && !allow.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || `${label} failed`, 73);
  }
  return result;
}

function sourceNamespaceRoot(commonDir, namespace) {
  const name = requireText(namespace, "source namespace", { max: 128, safeId: true });
  return resolve(commonDir, "codex-flow", name);
}

async function boundedJsonRecords(directory, validator, commonDir, readSourceJson = readJson) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (entries.length > 4096) throw new CliError(`Refresh source record inventory is too large: ${directory}`, 73);
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".json")) {
      throw new CliError(`Refresh source contains an unsupported record entry: ${entry.name}`, 73);
    }
    records.push(validator(await readSourceJson(resolve(directory, entry.name), { guardRoot: commonDir })));
  }
  return records;
}

export async function refreshNamespaceTreeDigest({ commonDir, namespace }) {
  const common = resolve(commonDir);
  const root = sourceNamespaceRoot(common, namespace);
  await assertNoSymlinkComponents(common, root, "Refresh source namespace");
  const inventory = [];
  let totalBytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CliError(`Refresh source contains a symbolic link: ${path}`, 73);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const info = await lstat(path);
        totalBytes += info.size;
        if (inventory.length >= MAX_SOURCE_FILES || totalBytes > MAX_SOURCE_BYTES) {
          throw new CliError("Refresh source namespace exceeds bounded inventory limits", 73);
        }
        inventory.push({
          path: relative(root, path).split(sep).join("/"),
          size: info.size,
          sha256: sha256(await readFile(path)),
        });
      } else {
        throw new CliError(`Refresh source contains an unsupported entry: ${path}`, 73);
      }
    }
  }
  await visit(root);
  return {
    file_count: inventory.length,
    byte_count: totalBytes,
    tree_digest: sha256(stableStringify(inventory)),
  };
}

function validateNamespacePackage(namespace, packageVersion) {
  const match = VERSIONED_REFRESH_SOURCE.exec(namespace);
  if (
    match !== null
    && namespace === `v${packageVersion}`
    && (Number(match[1]) > 0 || Number(match[2]) >= 8)
  ) return "v0.8-source-export";
  throw new CliError(
    `Unsupported refresh source authority ${namespace}/${packageVersion}; use the existing unplug path`,
    73,
  );
}

function minimalLifecycle(value, namespace) {
  const lifecycle = objectValue(value, `refresh source ${namespace} lifecycle`);
  const runs = objectValue(lifecycle.runs, `refresh source ${namespace} lifecycle.runs`);
  const activeRunId = lifecycle.active_run_id === null
    ? null
    : requireText(lifecycle.active_run_id, "refresh source active_run_id", { max: 128, safeId: true });
  if (activeRunId !== null && !Object.hasOwn(runs, activeRunId)) {
    throw new CliError("Refresh source active run is absent from its lifecycle", 73);
  }
  return { raw: lifecycle, runs, active_run_id: activeRunId };
}

async function locateRefreshSourceSnapshot({ commonDir, namespace, runId }) {
  const common = resolve(commonDir);
  const root = sourceNamespaceRoot(common, namespace);
  await assertNoSymlinkComponents(common, root, "Refresh source namespace");
  const lifecycle = minimalLifecycle(await readJson(
    resolve(root, "runs", "lifecycle.json"),
    { guardRoot: common },
  ), namespace);
  const selectedRunId = requireText(runId, "source_run_id", { max: 128, safeId: true });
  const run = objectValue(lifecycle.runs[selectedRunId], `refresh source run ${selectedRunId}`);
  if (run.run_id !== selectedRunId) throw new CliError("Refresh source run identity is inconsistent", 73);
  const runtimeId = digestValue(run.runtime_id, "refresh source run.runtime_id");
  const runtimeContextDigest = digestValue(
    run.runtime_context_hash,
    "refresh source run.runtime_context_hash",
  );
  const contextPath = resolve(root, "contexts", `${runtimeId}.json`);
  const context = objectValue(await readJson(contextPath, { guardRoot: common }), "refresh source runtime context");
  if (context.runtime_id !== runtimeId) throw new CliError("Refresh source runtime context ID drifted", 73);
  const { runtime_id: ignoredRuntimeId, ...contextSeed } = context;
  if (
    sha256(stableStringify(contextSeed)) !== runtimeId
    || sha256(stableStringify(context)) !== runtimeContextDigest
  ) throw new CliError("Refresh source runtime context is not content-addressed to its run", 73);

  const repository = objectValue(context.repository, "refresh source runtime repository");
  const repositoryRoot = absoluteValue(repository.root, "refresh source runtime repository.root");
  const recordedCommon = absoluteValue(
    repository.common_dir,
    "refresh source runtime repository.common_dir",
  );
  if (recordedCommon !== common) throw new CliError("Refresh source runtime belongs to another repository", 73);
  const liveCommon = await realpath(runGit(
    repositoryRoot,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Refresh source repository authentication",
  ).stdout.trim());
  if (liveCommon !== await realpath(common)) {
    throw new CliError("Refresh source runtime repository attachment drifted", 73);
  }

  // Runtime bundle manifest v1 is the stable bootstrap ABI. Journal and task
  // semantics remain entirely owned by the authenticated source exporter.
  const contextBundle = validateRefreshBootstrapBundle(context.bundle);
  const manifestPath = resolve(root, "runtimes", contextBundle.bundle_sha256, "bundle.json");
  const manifest = validateRefreshBootstrapBundle(await readJson(manifestPath, { guardRoot: common }));
  if (stableStringify(manifest) !== stableStringify(contextBundle)) {
    throw new CliError("Refresh source runtime manifest does not match its context", 73);
  }
  const bundleRoot = resolve(root, "runtimes", manifest.bundle_sha256, "files");
  await loadRefreshBootstrapBundleDirectory({ bundleRoot, bundle: manifest });
  const adapter = validateNamespacePackage(namespace, manifest.package_version);
  const exporterPath = resolve(bundleRoot, "bin", "codex-flow-refresh-source.mjs");
  const exporterSha256 = manifest.files["bin/codex-flow-refresh-source.mjs"] ?? null;
  if (adapter === "v0.8-source-export" && exporterSha256 === null) {
    throw new CliError("Authenticated v0.8+ source snapshot lacks its refresh exporter", 73);
  }
  const locatorSeed = {
    schema_version: 1,
    namespace,
    run_id: selectedRunId,
    runtime_id: runtimeId,
    runtime_context_digest: runtimeContextDigest,
    bundle_sha256: manifest.bundle_sha256,
    package_version: manifest.package_version,
    exporter_sha256: exporterSha256,
  };
  return {
    root,
    lifecycle,
    run,
    context,
    manifest,
    bundle_root: bundleRoot,
    cli_path: resolve(bundleRoot, "bin", "codex-flow.mjs"),
    exporter_path: exporterPath,
    adapter,
    locator: { ...locatorSeed, locator_digest: sha256(stableStringify(locatorSeed)) },
  };
}

async function loadRuntimeAuthority({ commonDir, namespace, run }, sourceApi = CURRENT_SOURCE_API) {
  const root = sourceNamespaceRoot(commonDir, namespace);
  const contextPath = resolve(root, "contexts", `${run.runtime_id}.json`);
  const context = sourceApi.validateRuntimeContext(await sourceApi.readJson(
    contextPath,
    { guardRoot: commonDir },
  ));
  if (
    context.runtime_id !== run.runtime_id
    || sourceApi.runtimeContextHash(context) !== run.runtime_context_hash
    || context.repository.common_dir !== resolve(commonDir)
  ) throw new CliError("Refresh source runtime context does not match its run", 73);
  const binding = sourceApi.runtimeBindingFromContext(context);
  if (stableStringify({
    runtime_context_hash: binding.runtime_context_hash,
    bundle_hash: binding.bundle_hash,
    config_hash: binding.config_hash,
    policy_hash: binding.policy_hash,
    repository_hash: binding.repository_hash,
    host: binding.host,
    lineage: binding.lineage,
  }) !== stableStringify({
    runtime_context_hash: run.binding.runtime_context_hash,
    bundle_hash: run.binding.bundle_hash,
    config_hash: run.binding.config_hash,
    policy_hash: run.binding.policy_hash,
    repository_hash: run.binding.repository_hash,
    host: run.binding.host,
    lineage: run.binding.lineage,
  })) throw new CliError("Refresh source runtime binding does not match its run", 73);
  const manifestPath = resolve(root, "runtimes", context.bundle.bundle_sha256, "bundle.json");
  const manifest = sourceApi.validateRuntimeBundle(await sourceApi.readJson(
    manifestPath,
    { guardRoot: commonDir },
  ));
  if (stableStringify(manifest) !== stableStringify(context.bundle)) {
    throw new CliError("Refresh source runtime manifest does not match its context", 73);
  }
  const bundleRoot = resolve(root, "runtimes", manifest.bundle_sha256, "files");
  await sourceApi.loadRuntimeBundleDirectory({ bundleRoot, bundle: manifest });
  const adapter = validateNamespacePackage(namespace, manifest.package_version);
  return {
    context,
    manifest,
    bundle_root: bundleRoot,
    cli_path: resolve(bundleRoot, "bin", "codex-flow.mjs"),
    adapter,
  };
}

function taskSemanticBase(task) {
  return {
    title: task.title,
    execution_kind: task.execution_kind,
    mode: task.mode,
    fork_surface: task.execution_kind === "subagent" ? "bounded-native-subagent" : "visible-task",
    read_paths: task.read_paths,
    write_paths: task.write_paths,
    shared_resources: task.shared_resources,
    primary_outcome: task.primary_outcome,
    causal_question: task.causal_question,
    cheapest_safe_direct_attempt: task.cheapest_safe_direct_attempt,
    instrument_role: task.instrument_role,
    supporting_authorization: task.supporting_authorization,
  };
}

function taskSemanticSeed(task, sourceTasks) {
  let followUp = task.supporting_follow_up;
  if (followUp?.kind === "direct-attempt") {
    const target = sourceTasks.get(followUp.task_id);
    if (target === undefined) {
      throw new CliError(`Refresh semantic follow-up target is absent: ${followUp.task_id}`, 73);
    }
    followUp = {
      kind: "direct-attempt",
      target_semantic_digest: sha256(stableStringify(taskSemanticBase(target))),
    };
  }
  return {
    ...taskSemanticBase(task),
    supporting_follow_up: followUp,
  };
}

export function refreshTaskSemanticBrief(task, sourceTasks) {
  const byId = sourceTasks instanceof Map
    ? sourceTasks
    : new Map(sourceTasks.map((entry) => [entry.task_id, entry]));
  const seed = taskSemanticSeed(task, byId);
  return { ...seed, brief_digest: sha256(stableStringify(seed)) };
}

function isAncestor(repositoryRoot, ancestor, descendant) {
  return runGit(
    repositoryRoot,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    "Refresh integration ancestry inspection",
    { allow: [1] },
  ).status === 0;
}

function sourceTaskState({
  task,
  contractEntry,
  launches,
  integrations,
  dispositions,
  archives,
  subagents,
  baseline,
}) {
  const contract = contractEntry?.contract ?? null;
  const contractId = contract?.contract_id ?? null;
  const launch = contractId === null
    ? null
    : launches.find((entry) => entry.contract_id === contractId) ?? null;
  const taskIntegrations = contractId === null
    ? []
    : integrations.filter((entry) => entry.contract_id === contractId);
  const disposition = contractId === null
    ? null
    : dispositions.find((entry) => entry.contract_id === contractId) ?? null;
  const subagent = contractId === null
    ? null
    : subagents.find((entry) => entry.contract_id === contractId) ?? null;
  const archive = contractId === null
    ? null
    : archives.find((entry) => entry.contract_id === contractId && entry.state === "completed") ?? null;
  const safeIntegration = taskIntegrations.find((entry) => (
    entry.state === "reconciled"
    && ["ancestor", "patch-equivalent"].includes(entry.outcome)
    && isAncestor(baseline.root, entry.reconciled_main_tip, baseline.revision)
  )) ?? null;
  const completedNoChange = disposition?.state === "completed"
    && disposition.decision === "accepted-no-change";
  return {
    task,
    contract,
    claim: contractEntry?.claim ?? null,
    launch,
    integrations: taskIntegrations,
    disposition,
    archive,
    archived: archive !== null,
    subagent,
    embodied: safeIntegration !== null,
    completed_no_change: completedNoChange,
    integration: safeIntegration,
  };
}

async function deriveRefreshSourceAuthority(
  { commonDir, namespace, runId = null },
  sourceApi = CURRENT_SOURCE_API,
) {
  const common = resolve(commonDir);
  const root = sourceNamespaceRoot(common, namespace);
  const lifecycle = sourceApi.validateRunLifecycleState(await sourceApi.readJson(
    resolve(root, "runs", "lifecycle.json"),
    { guardRoot: common },
  ));
  const selectedRunId = runId ?? lifecycle.active_run_id;
  if (selectedRunId === null) {
    throw new CliError(`Refresh source ${namespace} has no active run; name an exact terminal run`, 73);
  }
  const run = lifecycle.runs[requireText(selectedRunId, "source_run_id", { max: 128, safeId: true })];
  if (!run) throw new CliError(`Unknown refresh source run: ${selectedRunId}`, 73);
  const runtime = await loadRuntimeAuthority({ commonDir: common, namespace, run }, sourceApi);
  const workflowRoot = resolve(root, "workflows", run.run_id, run.workflow_plan_id);
  const journal = sourceApi.validateWorkflowJournal(await sourceApi.readJson(
    resolve(workflowRoot, "journal.json"),
    { guardRoot: common },
  ));
  if (
    journal.run_id !== run.run_id
    || journal.plan_id !== run.workflow_plan_id
    || journal.revisions[0]?.revision_digest !== run.workflow_revision_digest
  ) throw new CliError("Refresh source workflow journal does not match its run", 73);
  const revision = sourceApi.validateWorkflowPlanRevision(await sourceApi.readJson(
    resolve(workflowRoot, "revisions", `${journal.current_revision_digest}.json`),
    { guardRoot: common },
  ));
  const contracts = [];
  for (const claim of journal.contract_claims) {
    const contract = sourceApi.validateGeneratedTaskContract(await sourceApi.readJson(
      resolve(workflowRoot, "contracts", `${claim.contract_id}.json`),
      { guardRoot: common },
    ));
    if (
      contract.contract_id !== claim.contract_id
      || contract.run_id !== run.run_id
      || contract.plan_id !== run.workflow_plan_id
    ) throw new CliError("Refresh source task contract does not match its workflow claim", 73);
    contracts.push({ claim, contract });
  }
  const allRecords = await Promise.all([
    boundedJsonRecords(resolve(root, "task-launches", "records"), sourceApi.validateTaskLaunchRecord, common, sourceApi.readJson),
    boundedJsonRecords(resolve(root, "integration-lifecycle", "records"), sourceApi.validateIntegrationRecord, common, sourceApi.readJson),
    boundedJsonRecords(resolve(root, "dispositions", "records"), sourceApi.validateDispositionRecord, common, sourceApi.readJson),
    boundedJsonRecords(resolve(root, "archives", "records"), sourceApi.validateArchiveOperation, common, sourceApi.readJson),
    boundedJsonRecords(resolve(root, "subagents", "records"), sourceApi.validateSubagentOperation, common, sourceApi.readJson),
  ]);
  const [launches, integrations, dispositions, archives, subagents] = allRecords
    .map((records) => records.filter((record) => record.run_id === run.run_id));
  const baselineSnapshot = gitSnapshot(runtime.context.repository.root);
  if (
    baselineSnapshot.commonDir !== common
    || baselineSnapshot.root !== runtime.context.repository.root
  ) throw new CliError("Refresh source runtime no longer identifies its exact coordinator worktree", 73);
  const baseline = {
    root: baselineSnapshot.root,
    common_dir: baselineSnapshot.commonDir,
    branch: baselineSnapshot.branch,
    revision: baselineSnapshot.revision,
    cleanliness: baselineSnapshot.cleanliness,
  };
  const currentContracts = new Map(contracts
    .filter((entry) => entry.claim.revision_digest === revision.revision_digest)
    .map((entry) => [entry.contract.task_id, entry]));
  const taskStates = revision.tasks.map((task) => sourceTaskState({
    task,
    contractEntry: currentContracts.get(task.task_id) ?? null,
    launches,
    integrations,
    dispositions,
    archives,
    subagents,
    baseline,
  }));
  const liveSubagent = taskStates.find((entry) => (
    entry.task.execution_kind === "subagent"
    && entry.subagent !== null
    && ![
      "selector-rejected-before-agent-identity",
      "accepted",
      "rejected",
    ].includes(entry.subagent.state)
  ));
  if (liveSubagent) {
    throw new CliError(
      `Active native subagent must complete and be disposed before refresh: ${liveSubagent.task.task_id}`,
      73,
    );
  }
  const tree = await refreshNamespaceTreeDigest({ commonDir: common, namespace });
  return {
    namespace,
    root,
    lifecycle,
    run,
    runtime,
    journal,
    revision,
    contracts,
    task_states: taskStates,
    archives,
    baseline,
    tree,
    source_digest: sha256(stableStringify({
      namespace,
      adapter: runtime.adapter,
      run,
      runtime_context_hash: sourceApi.runtimeContextHash(runtime.context),
      workflow_revision_digest: revision.revision_digest,
      tree_digest: tree.tree_digest,
    })),
  };
}

export async function exportRefreshSourceAuthority(options) {
  const locator = await locateRefreshSourceSnapshot(options);
  if (
    locator.adapter !== "v0.8-source-export"
    || options.protocol !== 1
    || options.runtimeId !== locator.locator.runtime_id
    || options.runtimeContextDigest !== locator.locator.runtime_context_digest
    || options.bundleSha256 !== locator.locator.bundle_sha256
    || options.locatorDigest !== locator.locator.locator_digest
  ) throw new CliError("Refresh source export request does not match its authenticated locator", 73);
  const source = await deriveRefreshSourceAuthority(options);
  if (
    source.runtime.adapter !== "v0.8-source-export"
    || source.runtime.manifest.package_version !== PACKAGE_VERSION
    || source.namespace !== `v${PACKAGE_VERSION}`
  ) {
    throw new CliError("Refresh source export must run through its own exact v0.8+ snapshot", 73);
  }
  return {
    schema_version: REFRESH_SOURCE_EXPORT_SCHEMA_VERSION,
    kind: REFRESH_SOURCE_EXPORT_KIND,
    protocol: 1,
    package_version: PACKAGE_VERSION,
    bundle_sha256: source.runtime.manifest.bundle_sha256,
    runtime_id: source.run.runtime_id,
    runtime_context_digest: source.run.runtime_context_hash,
    locator_digest: locator.locator.locator_digest,
    source,
  };
}

function validateSourceExportEnvelope(value, expected) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || value.schema_version !== REFRESH_SOURCE_EXPORT_SCHEMA_VERSION
    || value.kind !== REFRESH_SOURCE_EXPORT_KIND
    || value.protocol !== 1
    || value.package_version !== expected.packageVersion
    || value.bundle_sha256 !== expected.bundleSha256
    || value.runtime_id !== expected.runtimeId
    || value.runtime_context_digest !== expected.runtimeContextDigest
    || value.locator_digest !== expected.locatorDigest
    || typeof value.source !== "object"
    || value.source === null
  ) throw new CliError("Authenticated source snapshot returned an invalid refresh export", 73);
  if (
    value.source.namespace !== expected.namespace
    || value.source.run?.run_id !== expected.runId
    || value.source.root !== expected.root
    || value.source.runtime?.manifest?.package_version !== expected.packageVersion
    || value.source.runtime?.manifest?.bundle_sha256 !== expected.bundleSha256
    || value.source.runtime?.bundle_root !== expected.bundleRoot
    || value.source.runtime?.cli_path !== expected.cliPath
    || value.source.runtime?.adapter !== "v0.8-source-export"
  ) throw new CliError("Authenticated source snapshot refresh export does not match its authority", 73);
  return value.source;
}

export async function loadRefreshSourceAuthority(options) {
  const located = await locateRefreshSourceSnapshot(options);
  const exportedResult = spawnSync(process.execPath, [located.exporter_path], {
    cwd: located.context.repository.root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    input: stableStringify({
      protocol: 1,
      common_dir: resolve(options.commonDir),
      namespace: options.namespace,
      run_id: options.runId,
      runtime_id: located.locator.runtime_id,
      runtime_context_digest: located.locator.runtime_context_digest,
      bundle_sha256: located.locator.bundle_sha256,
      locator_digest: located.locator.locator_digest,
    }),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: MAX_SOURCE_EXPORT_BYTES,
  });
  if (exportedResult.error) {
    throw new CliError(
      `Authenticated source snapshot export failed: ${exportedResult.error.message}`,
      73,
    );
  }
  if (exportedResult.status !== 0) {
    throw new CliError(
      String(exportedResult.stderr || exportedResult.stdout).trim()
        || "Authenticated source snapshot cannot export refresh semantics",
      73,
    );
  }
  let exported;
  try {
    exported = JSON.parse(exportedResult.stdout);
  } catch {
    throw new CliError("Authenticated source snapshot returned malformed refresh semantics", 73);
  }
  return validateSourceExportEnvelope(exported, {
    namespace: options.namespace,
    runId: options.runId,
    packageVersion: located.manifest.package_version,
    bundleSha256: located.manifest.bundle_sha256,
    runtimeId: located.locator.runtime_id,
    runtimeContextDigest: located.locator.runtime_context_digest,
    locatorDigest: located.locator.locator_digest,
    root: located.root,
    bundleRoot: located.bundle_root,
    cliPath: located.cli_path,
  });
}

function cleanupTransferContract(packageVersion) {
  const version = requireText(packageVersion, "cleanup source package_version", { max: 128 });
  if (/^0\.8\./.test(version)) {
    return {
      kind: "codex-flow-v07-cleanup-plan",
      identity_kind: "operation",
      item_identity_field: "operation_id",
      blocking_identity_field: "blocking_operation_ids",
      rejected_item_identity_field: "launch_id",
      rejected_blocking_identity_field: "blocking_launch_ids",
    };
  }
  if (/^0\.9\./.test(version)) {
    return {
      kind: "codex-flow-v09-cleanup-plan",
      identity_kind: "launch",
      item_identity_field: "launch_id",
      blocking_identity_field: "blocking_launch_ids",
      rejected_item_identity_field: "operation_id",
      rejected_blocking_identity_field: "blocking_operation_ids",
    };
  }
  throw new CliError(`Unsupported cleanup transfer version ${version}`, 73);
}

function sourceCleanupPlan({ cliPath, repositoryRoot, packageVersion }, runId) {
  const safeRunId = requireText(runId, "cleanup source run_id", { max: 128, safeId: true });
  const contract = cleanupTransferContract(packageVersion);
  const result = spawnSync(process.execPath, [
    cliPath,
    "cleanup",
    "plan",
    "--run-id",
    safeRunId,
    "--json",
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new CliError(`Source cleanup inspection failed: ${result.error.message}`, 73);
  if (result.status !== 0) {
    throw new CliError(
      String(result.stderr || result.stdout).trim() || `Source cleanup inspection failed for ${safeRunId}`,
      73,
    );
  }
  let plan;
  try {
    plan = JSON.parse(result.stdout);
  } catch {
    throw new CliError("Authenticated source cleanup inspection returned malformed JSON", 73);
  }
  objectValue(plan, "source cleanup plan");
  if (
    plan.kind !== contract.kind
    || plan.run_id !== safeRunId
    || plan.mutation_performed !== false
    || !Array.isArray(plan.items)
    || !Array.isArray(plan[contract.blocking_identity_field])
    || Object.hasOwn(plan, contract.rejected_blocking_identity_field)
    || !Array.isArray(plan.unbound_branch_fences)
    || !Array.isArray(plan.blocking_branch_fences)
  ) throw new CliError("Authenticated source cleanup plan has an unsupported transfer shape", 73);
  objectValue(plan.counts, "source cleanup plan.counts");
  const items = plan.items.map((item, index) => {
    objectValue(item, `source cleanup plan.items[${index}]`);
    if (Object.hasOwn(item, contract.rejected_item_identity_field)) {
      throw new CliError("Authenticated source cleanup plan mixes executor identity generations", 73);
    }
    return {
      ...item,
      executor_id: requireText(
        item[contract.item_identity_field],
        `source cleanup plan.items[${index}].${contract.item_identity_field}`,
        { max: 128, safeId: true },
      ),
    };
  });
  const blockingExecutorIds = plan[contract.blocking_identity_field].map((identity, index) => (
    requireText(identity, `source cleanup plan.${contract.blocking_identity_field}[${index}]`, {
      max: 128,
      safeId: true,
    })
  ));
  return {
    identity_kind: contract.identity_kind,
    run_status: plan.run_status,
    items,
    blocking_executor_ids: blockingExecutorIds,
    unbound_branch_fences: plan.unbound_branch_fences,
    blocking_branch_fences: plan.blocking_branch_fences,
    counts: plan.counts,
  };
}

function assertTerminalRunCleanupComplete(plan, runId) {
  if (
    !["closed", "abandoned"].includes(plan.run_status)
    || plan.counts.close_blocked !== 0
    || plan.counts.cleanup_required !== 0
    || plan.blocking_executor_ids.length !== 0
    || plan.blocking_branch_fences.length !== 0
    || plan.items.some((item) => (
      item.classification !== "clean"
      || item.close_blocked !== false
      || item.cleanup_required !== false
    ))
    || plan.unbound_branch_fences.some((entry) => (
      entry.close_blocked !== false || entry.cleanup_required !== false
    ))
  ) throw new CliError(`Earlier source run is not cleanup-complete: ${runId}`, 73);
}

export async function assertOtherRefreshSourceRunsSafe(source) {
  for (const run of Object.values(source.lifecycle.runs)) {
    if (run.run_id === source.run.run_id) continue;
    if (!["closed", "abandoned"].includes(run.status)) {
      throw new CliError(`Non-selected source run must be independently terminal before refresh: ${run.run_id}`, 73);
    }
    const located = await locateRefreshSourceSnapshot({
      commonDir: source.baseline.common_dir,
      namespace: source.namespace,
      runId: run.run_id,
    });
    assertTerminalRunCleanupComplete(sourceCleanupPlan({
      cliPath: located.cli_path,
      repositoryRoot: located.context.repository.root,
      packageVersion: located.manifest.package_version,
    }, run.run_id), run.run_id);
  }
}

export async function assertRefreshNamespaceRemovalSafe({ source, handoff }) {
  await assertOtherRefreshSourceRunsSafe(source);
  const plan = sourceCleanupPlan({
    cliPath: source.runtime.cli_path,
    repositoryRoot: source.runtime.context.repository.root,
    packageVersion: source.runtime.manifest.package_version,
  }, source.run.run_id);
  if (plan.identity_kind !== "operation" && handoff.cleanup.length !== 0) {
    throw new CliError(
      "Refresh handoff v1 cannot represent launch-identity source discard cleanup",
      73,
    );
  }
  const discarded = new Map(handoff.cleanup.map((entry) => [entry.creation_operation_id, entry]));
  if (plan.blocking_branch_fences.length !== 0) {
    throw new CliError("Source branch fences must be cleanup-complete before namespace removal", 73);
  }
  for (const branch of plan.unbound_branch_fences) {
    if (branch.close_blocked !== false || branch.cleanup_required !== false) {
      throw new CliError(`Source branch fence remains live before refresh: ${branch.branch}`, 73);
    }
  }
  for (const item of plan.items) {
    const discard = discarded.get(item.executor_id) ?? null;
    if (discard !== null) {
      if (
        item.cleanup_required !== false
        || (discard.git_authority !== null
          && (discard.worktree_removed_at === null || discard.branch_deleted_at === null))
      ) throw new CliError(`Discarded executor Git residue remains before refresh: ${item.task_id}`, 73);
      continue;
    }
    if (
      item.classification !== "clean"
      || item.close_blocked !== false
      || item.cleanup_required !== false
    ) throw new CliError(`Waited executor cleanup is incomplete before refresh: ${item.task_id}`, 73);
  }
  const allowedBlocking = new Set(discarded.keys());
  if (plan.blocking_executor_ids.some((executorId) => !allowedBlocking.has(executorId))) {
    throw new CliError("Source cleanup contains a blocker outside exact discarded executors", 73);
  }
}

export async function refreshNamespaceCandidates({ commonDir, currentNamespace }) {
  const root = resolve(commonDir, "codex-flow");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const candidates = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if ([currentNamespace, "refresh-v1", "foreign-active-run.lock"].includes(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new CliError(`Refresh discovery rejected non-namespace entry: ${entry.name}`, 73);
    }
    const lifecyclePath = resolve(root, entry.name, "runs", "lifecycle.json");
    const info = await lstat(lifecyclePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (info === null) {
      throw new CliError(`Unsupported Codex Flow namespace blocks refresh: ${entry.name}`, 73);
    }
    if (!info.isFile()) throw new CliError(`Malformed Codex Flow namespace: ${entry.name}`, 73);
    const lifecycle = minimalLifecycle(
      await readJson(lifecyclePath, { guardRoot: resolve(commonDir) }),
      entry.name,
    ).raw;
    candidates.push({ namespace: entry.name, lifecycle });
  }
  return candidates;
}

export function refreshSourceSummary(source) {
  return {
    namespace: source.namespace,
    package_version: source.runtime.manifest.package_version,
    adapter: source.runtime.adapter,
    run_id: source.run.run_id,
    run_status: source.run.status,
    runtime_id: source.run.runtime_id,
    runtime_context_digest: source.run.runtime_context_hash,
    bundle_sha256: source.runtime.manifest.bundle_sha256,
    source_digest: source.source_digest,
    workflow_plan_id: source.run.workflow_plan_id,
    workflow_revision_digest: source.revision.revision_digest,
    coordinator: source.run.binding.lineage,
    baseline: source.baseline,
    tree: source.tree,
    executor_tasks: source.task_states.map((entry) => ({
      task_id: entry.task.task_id,
      execution_kind: entry.task.execution_kind,
      contract_id: entry.contract?.contract_id ?? null,
      operation_id: entry.launch?.launch_id ?? entry.creation?.operation_id
        ?? entry.subagent?.operation_id ?? null,
      ready_thread_id: entry.launch?.start_claim?.executor_thread_id
        ?? entry.creation?.ready?.thread_id ?? null,
      embodied: entry.embodied,
      completed_no_change: entry.completed_no_change,
      archived: entry.archived,
      integration_state: entry.integrations.at(-1)?.state ?? null,
      creation_status: entry.launch?.status ?? entry.creation?.status ?? null,
      subagent_state: entry.subagent?.state ?? null,
    })),
  };
}
