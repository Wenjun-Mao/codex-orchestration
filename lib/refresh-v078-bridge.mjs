import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function requireExport(module, name, sourcePath) {
  if (typeof module[name] !== "function") {
    throw new Error(`Exact v0.7.8 source module ${sourcePath} lacks ${name}`);
  }
  return module[name];
}

// This is the only nonliteral module-loading boundary in the active package.
// The caller first verifies every byte in bundleRoot against the exact v0.7.8
// runtime manifest; this bridge then delegates legacy parsing to those frozen
// source validators instead of interpreting v0.7.8 journals with v0.8 code.
export async function exactV078SourceApi(bundleRoot) {
  const importSource = async (path) => import(pathToFileURL(resolve(bundleRoot, path)).href);
  const paths = {
    archive: "lib/archive-lifecycle.mjs",
    core: "lib/core.mjs",
    dispositions: "lib/dispositions.mjs",
    integration: "lib/integration-v07.mjs",
    release: "lib/release-lifecycle.mjs",
    lifecycle: "lib/run-lifecycle.mjs",
    runtime: "lib/runtime-context.mjs",
    subagents: "lib/subagent-operations-v07.mjs",
    creation: "lib/task-creation-v07.mjs",
    journal: "lib/workflow-journal-v07.mjs",
    workflow: "lib/workflow-plan.mjs",
  };
  const modules = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => (
    [key, await importSource(path)]
  ))));
  return {
    readJson: requireExport(modules.core, "readJson", paths.core),
    validateArchiveOperation: requireExport(modules.archive, "validateArchiveOperation", paths.archive),
    validateDispositionRecord: requireExport(modules.dispositions, "validateDispositionRecord", paths.dispositions),
    validateGeneratedTaskContract: requireExport(modules.workflow, "validateGeneratedTaskContract", paths.workflow),
    validateIntegrationRecordV07: requireExport(modules.integration, "validateIntegrationRecordV07", paths.integration),
    validateReleaseRecord: requireExport(modules.release, "validateReleaseRecord", paths.release),
    validateRunLifecycleState: requireExport(modules.lifecycle, "validateRunLifecycleState", paths.lifecycle),
    validateSubagentOperation: requireExport(modules.subagents, "validateSubagentOperation", paths.subagents),
    validateVisibleTaskCreationRecord: requireExport(
      modules.creation,
      "validateVisibleTaskCreationRecord",
      paths.creation,
    ),
    validateWorkflowJournal: requireExport(modules.journal, "validateWorkflowJournal", paths.journal),
    validateWorkflowPlanRevision: requireExport(
      modules.workflow,
      "validateWorkflowPlanRevision",
      paths.workflow,
    ),
    loadRuntimeBundleDirectory: requireExport(
      modules.runtime,
      "loadRuntimeBundleDirectory",
      paths.runtime,
    ),
    runtimeBindingFromContext: requireExport(modules.runtime, "runtimeBindingFromContext", paths.runtime),
    runtimeContextHash: requireExport(modules.runtime, "runtimeContextHash", paths.runtime),
    validateRuntimeBundle: requireExport(modules.runtime, "validateRuntimeBundle", paths.runtime),
    validateRuntimeContext: requireExport(modules.runtime, "validateRuntimeContext", paths.runtime),
  };
}
