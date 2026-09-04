import { isAbsolute, resolve } from "node:path";
import {
  CliError,
  isPlainObject,
  PACKAGE_VERSION,
  requireText,
} from "./core.mjs";
import { resolvePrivateVisibleTaskCreationRecord } from "./task-creation-v07.mjs";

export const V081_PRIVATE_RESOLUTION_RECOVERY_KIND =
  "codex-flow-v081-private-resolution-recovery";
export const V081_PRIVATE_RESOLUTION_SOURCE_NAMESPACE = "v0.8.1";
export const V081_PRIVATE_RESOLUTION_SOURCE_VERSION = "0.8.1";

function requireTargetPackage() {
  if (!/^0\.8\.(?:2|3)(?:-|$)/.test(PACKAGE_VERSION)) {
    throw new CliError("The exact v0.8.1 private-resolution recovery adapter is unavailable in this package version");
  }
}

function requireSourceAuthority(source, runId, operationId, coordinatorThreadId) {
  if (
    !isPlainObject(source)
    || !isPlainObject(source.runtime)
    || !isPlainObject(source.runtime.manifest)
    || !isPlainObject(source.run)
    || !isPlainObject(source.lifecycle)
    || !Array.isArray(source.task_states)
    || source.task_states.some((entry) => !isPlainObject(entry))
  ) {
    throw new CliError("Exact v0.8.1 private-resolution source authority is malformed", 73);
  }
  if (
    source?.namespace !== V081_PRIVATE_RESOLUTION_SOURCE_NAMESPACE
    || source.runtime?.manifest?.package_version !== V081_PRIVATE_RESOLUTION_SOURCE_VERSION
    || source.runtime.adapter !== "v0.8-source-export"
    || source.run?.run_id !== runId
    || source.run.status !== "active"
    || source.lifecycle?.active_run_id !== runId
    || source.run.binding?.lineage?.thread_id !== coordinatorThreadId
  ) {
    throw new CliError("Exact v0.8.1 private-resolution source authority does not match the active coordinator run", 73);
  }
  const matches = source.task_states.filter((entry) => (
    entry.creation?.operation_id === operationId
  ));
  if (matches.length !== 1) {
    throw new CliError("Exact v0.8.1 source has no unique visible-task creation for this operation", 73);
  }
  const selected = matches[0];
  const creation = selected.creation;
  if (
    !isPlainObject(selected.task)
    || !isPlainObject(selected.contract)
    || !isPlainObject(creation)
    || selected.task.execution_kind !== "task-thread"
    || !isPlainObject(source.run.binding)
    || !isPlainObject(source.run.binding.lineage)
    || creation.run_id !== runId
    || creation.runtime_context_digest !== source.run.runtime_context_hash
    || creation.coordinator_binding?.thread_id !== coordinatorThreadId
    || creation.contract_id !== selected.contract.contract_id
  ) {
    throw new CliError("Exact v0.8.1 visible-task creation is inconsistent with its source authority", 73);
  }
  return creation;
}

export async function recoverV081PrivateTaskResolution({
  source,
  runId,
  operationId,
  coordinatorThreadId,
  codexHome,
  now = Date.now(),
}) {
  requireTargetPackage();
  const safeRunId = requireText(runId, "run_id", { max: 128, safeId: true });
  const safeOperationId = requireText(operationId, "operation_id", { max: 128, safeId: true });
  const currentThreadId = requireText(coordinatorThreadId, "coordinator_thread_id", {
    max: 128,
    safeId: true,
  });
  const creation = requireSourceAuthority(
    source,
    safeRunId,
    safeOperationId,
    currentThreadId,
  );
  const resolved = await resolvePrivateVisibleTaskCreationRecord({
    record: creation,
    codexHome,
    now,
  });
  if (
    resolved.run_id !== safeRunId
    || resolved.operation_id !== safeOperationId
    || resolved.reconcile_request?.run_id !== safeRunId
    || resolved.reconcile_request?.operation_id !== safeOperationId
  ) {
    throw new CliError("Recovered reconcile request does not match its exact v0.8.1 operation", 73);
  }
  const sourceCliPath = requireText(source.runtime.cli_path, "source runtime CLI path", {
    max: 2048,
  });
  if (!isAbsolute(sourceCliPath)) {
    throw new CliError("Exact v0.8.1 source runtime CLI path must be absolute", 73);
  }
  return {
    schema_version: 1,
    kind: V081_PRIVATE_RESOLUTION_RECOVERY_KIND,
    source_authority: {
      namespace: source.namespace,
      package_version: source.runtime.manifest.package_version,
      bundle_sha256: source.runtime.manifest.bundle_sha256,
      runtime_id: source.run.runtime_id,
      runtime_context_digest: source.run.runtime_context_hash,
      run_id: source.run.run_id,
      operation_id: safeOperationId,
      coordinator_thread_id: currentThreadId,
      source_cli_path: resolve(sourceCliPath),
    },
    target_package_version: PACKAGE_VERSION,
    reconcile_request: resolved.reconcile_request,
  };
}
