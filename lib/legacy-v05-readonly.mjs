import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { callbackStatus } from "./callbacks.mjs";
import { projectConfigPath, validateProjectConfig } from "./config.mjs";
import { CliError, readJson, requireObject, requireText } from "./core.mjs";
import { gitLifecycleAudit } from "./git-lifecycle.mjs";
import { leaseStatus } from "./leases.mjs";
import { inspectExternalAgents, inspectInstalledRuntime } from "./managed.mjs";
import { recipientStatuses } from "./recipients.mjs";
import { taskOperationStatus } from "./task-operations.mjs";
import { urgentSignalStatus } from "./urgent-signals.mjs";

export const LEGACY_V05_PACKAGE_VERSION = "0.5.1";
export const LEGACY_V05_STATE_NAMESPACE = "v0.5.1";

const CONTEXT_KIND = "codex-flow-legacy-v05-readonly-context";

const EMPTY_CALLBACK_STATUS = Object.freeze({
  pending: [],
  consumed_count: 0,
  superseded_count: 0,
  expired_count: 0,
});

const EMPTY_URGENT_STATUS = Object.freeze({
  pending: [],
  consumed_count: 0,
  superseded_count: 0,
  expired_count: 0,
  host_replay_count: 0,
  sender_attempt_duplicate_count: 0,
});

function requirePath(value, label) {
  return requireText(value, label, { max: 4096 });
}

function matchingManagedBlockVersion(contents) {
  const starts = [...contents.matchAll(/<!-- codex-flow:start v([^\s]+) -->/g)];
  const ends = (contents.match(/<!-- codex-flow:end -->/g) ?? []).length;
  if (
    starts.length === 1
    && ends === 1
    && starts[0].index < contents.indexOf("<!-- codex-flow:end -->")
  ) return starts[0][1];
  return null;
}

function legacyStateRoot(commonDir) {
  return resolve(commonDir, "codex-flow", LEGACY_V05_STATE_NAMESPACE);
}

function contextFrom(input) {
  if (input?.kind === CONTEXT_KIND) return input;
  return createLegacyV05ReadonlyContext(input);
}

function contextInput(input) {
  if (input && typeof input === "object" && "git" in input) return input;
  return { git: input };
}

/**
 * Builds the only context allowed to inspect predecessor records.  The state
 * root and package identity are deliberately fixed together so a v0.6 caller
 * cannot accidentally read its own namespace as v0.5.1 history.
 */
export function createLegacyV05ReadonlyContext(input) {
  const options = contextInput(input);
  requireObject(options, "Legacy v0.5.1 context options");
  requireObject(options.git, "Legacy v0.5.1 context git");

  const packageVersion = options.packageVersion ?? options.package_version ?? LEGACY_V05_PACKAGE_VERSION;
  if (packageVersion !== LEGACY_V05_PACKAGE_VERSION) {
    throw new CliError(`Legacy historical verification only accepts package version ${LEGACY_V05_PACKAGE_VERSION}`);
  }

  const root = requirePath(options.git.root, "Legacy v0.5.1 Git root");
  const commonDir = requirePath(options.git.commonDir, "Legacy v0.5.1 Git common directory");
  const expectedStateRoot = legacyStateRoot(commonDir);
  const requestedStateRoot = options.stateRoot === undefined && options.state_root === undefined
    ? expectedStateRoot
    : requirePath(options.stateRoot ?? options.state_root, "Legacy v0.5.1 state root");
  if (resolve(requestedStateRoot) !== expectedStateRoot) {
    throw new CliError(`Legacy historical verification state root must be ${expectedStateRoot}`);
  }

  const git = Object.freeze({
    ...options.git,
    root,
    commonDir,
    stateRoot: expectedStateRoot,
  });
  return Object.freeze({
    kind: CONTEXT_KIND,
    package_authority: Object.freeze({
      package: "@wjmao/codex-flow",
      package_version: LEGACY_V05_PACKAGE_VERSION,
    }),
    state_authority: Object.freeze({
      namespace: LEGACY_V05_STATE_NAMESPACE,
      state_root: expectedStateRoot,
    }),
    git,
  });
}

async function readProjectAuthority(context, errors) {
  try {
    const raw = await readJson(projectConfigPath(context.git.root), {
      allowMissing: true,
      guardRoot: context.git.root,
    });
    if (!raw) {
      errors.push("Project configuration is missing");
      return null;
    }
    return validateProjectConfig(raw);
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

async function readRuntimeAuthority(context, errors) {
  try {
    const runtime = await inspectInstalledRuntime(context.git.root);
    if (!runtime.installed) {
      errors.push("Pinned Codex Flow runtime is not installed");
    } else if (runtime.manifest.package_version !== LEGACY_V05_PACKAGE_VERSION) {
      errors.push(
        `Installed Codex Flow ${runtime.manifest.package_version} does not match accepted predecessor ${LEGACY_V05_PACKAGE_VERSION}`,
      );
    }
    if (runtime.drift.length > 0) errors.push("Pinned codex-flow runtime has managed-file drift");
    if (runtime.unexpected.length > 0) errors.push("Pinned codex-flow runtime contains unowned files");
    return {
      installed: runtime.installed,
      package_version: runtime.manifest?.package_version ?? null,
      drift: runtime.drift,
      unexpected: runtime.unexpected ?? [],
    };
  } catch (error) {
    errors.push(error.message);
    return {
      installed: false,
      package_version: null,
      drift: [],
      unexpected: [],
    };
  }
}

async function readAgentsAuthority(context, config, errors, warnings) {
  if (!config) return { mode: "unconfigured", status: "unknown" };
  if (config.agents_integration.mode === "external") {
    try {
      await inspectExternalAgents({
        gitRoot: context.git.root,
        integration: config.agents_integration,
      });
      return {
        mode: "external",
        status: "verified",
        path: config.agents_integration.path,
        contract_version: config.agents_integration.contract_version,
      };
    } catch (error) {
      errors.push(error.message);
      return {
        mode: "external",
        status: "drifted",
        path: config.agents_integration.path,
        contract_version: config.agents_integration.contract_version,
      };
    }
  }

  const agentsPath = resolve(context.git.root, "AGENTS.md");
  try {
    const contents = await readFile(agentsPath, "utf8");
    const version = matchingManagedBlockVersion(contents);
    if (version === LEGACY_V05_PACKAGE_VERSION) {
      return { mode: "managed", status: "verified", path: "AGENTS.md" };
    }
    if (version === null) {
      const hasMarker = contents.includes("<!-- codex-flow:start") || contents.includes("<!-- codex-flow:end -->");
      if (hasMarker) {
        errors.push("AGENTS.md codex-flow managed block is malformed");
        return { mode: "managed", status: "malformed", path: "AGENTS.md" };
      }
      warnings.push("AGENTS.md codex-flow managed block is absent");
      return { mode: "managed", status: "missing", path: "AGENTS.md" };
    }
    errors.push(`AGENTS.md codex-flow managed block is for ${version}, not ${LEGACY_V05_PACKAGE_VERSION}`);
    return { mode: "managed", status: "version-mismatch", path: "AGENTS.md" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      warnings.push("AGENTS.md is absent");
      return { mode: "managed", status: "missing", path: "AGENTS.md" };
    }
    errors.push(error.message);
    return { mode: "managed", status: "unreadable", path: "AGENTS.md" };
  }
}

async function statusFamily(label, fallback, errors, read) {
  try {
    return await read();
  } catch (error) {
    errors.push(`${label} state is invalid: ${error.message}`);
    return fallback;
  }
}

/**
 * Reads the accepted v0.5.1 authority and all legacy status families without
 * importing an installed runtime or calling any mutator.  Consumers can use
 * the returned context's explicit state root with the existing pure readers.
 */
export async function readLegacyV05ReadonlySummary(input, { inspectRemotes = false } = {}) {
  const context = contextFrom(input);
  const errors = [];
  const warnings = [];
  const project = await readProjectAuthority(context, errors);
  const runtime = await readRuntimeAuthority(context, errors);
  const agents = await readAgentsAuthority(context, project, errors, warnings);
  const [callbacks, urgentSignals, recipients, taskOperations, leases] = await Promise.all([
    statusFamily("Callback", EMPTY_CALLBACK_STATUS, errors, () => callbackStatus(context.git.stateRoot)),
    statusFamily("Urgent-signal", EMPTY_URGENT_STATUS, errors, () => urgentSignalStatus(context.git.stateRoot)),
    statusFamily("Recipient", [], errors, () => recipientStatuses({ stateRoot: context.git.stateRoot })),
    statusFamily("Task-operation", [], errors, () => taskOperationStatus({ stateRoot: context.git.stateRoot })),
    statusFamily("Lease", [], errors, () => leaseStatus({ stateRoot: context.git.stateRoot })),
  ]);
  const gitLifecycle = project
    ? await statusFamily("Git lifecycle", null, errors, () => gitLifecycleAudit({
      git: context.git,
      config: project,
      inspectRemotes,
    }))
    : null;

  return {
    ok: errors.length === 0,
    mutation_performed: false,
    package_authority: context.package_authority,
    state_authority: context.state_authority,
    repository_authority: {
      root: context.git.root,
      common_dir: context.git.commonDir,
      branch: context.git.branch ?? null,
      revision: context.git.revision ?? null,
      cleanliness: context.git.cleanliness ?? null,
    },
    project,
    runtime,
    agents,
    callbacks,
    urgent_signals: urgentSignals,
    recipients,
    task_operations: taskOperations,
    leases,
    git_lifecycle: gitLifecycle,
    errors,
    warnings,
  };
}

export const legacyV05ReadonlyContext = createLegacyV05ReadonlyContext;
export const legacyV05ReadonlySummary = readLegacyV05ReadonlySummary;
