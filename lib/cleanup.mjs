import { callbackStatus } from "./callbacks.mjs";
import { projectConfigPath, validateProjectConfig } from "./config.mjs";
import { directorySize, formatBytes, readJson } from "./core.mjs";
import { gitLifecycleAudit } from "./git-lifecycle.mjs";
import { leaseStatus } from "./leases.mjs";
import { inspectInstalledRuntime } from "./managed.mjs";
import { recipientStatuses } from "./recipients.mjs";
import { taskOperationStatus } from "./task-operations.mjs";

export async function cleanupAudit(git) {
  const config = validateProjectConfig(await readJson(projectConfigPath(git.root)));
  const callbacks = await callbackStatus(git.stateRoot);
  const leases = await leaseStatus({ stateRoot: git.stateRoot });
  const operations = await taskOperationStatus({ stateRoot: git.stateRoot });
  const recipients = await recipientStatuses({ stateRoot: git.stateRoot });
  const runtime = await inspectInstalledRuntime(git.root);
  const gitLifecycle = await gitLifecycleAudit({ git, config });
  const bytes = await directorySize(git.stateRoot);
  const recommendations = [];
  const oldPending = callbacks.pending.filter((item) => item.age_seconds > 24 * 60 * 60);
  if (oldPending.length) recommendations.push(`${oldPending.length} callback record(s) have been pending for more than 24 hours`);
  const callbacksDueForExpiry = callbacks.pending.filter((item) => item.effective_integration === "expired-due");
  if (callbacksDueForExpiry.length) recommendations.push(`${callbacksDueForExpiry.length} callback record(s) have reached their explicit expiry and may be marked expired`);
  const ambiguousOperations = operations.filter((operation) => ["ambiguous", "ambiguous-due", "dispatching"].includes(operation.effective_status));
  if (ambiguousOperations.length) recommendations.push(`${ambiguousOperations.length} task creation operation(s) require host inspection or bounded-wait review`);
  const blockedHostSessions = operations.filter((operation) => operation.status === "host-session-blocked");
  if (blockedHostSessions.length) {
    recommendations.push(`${blockedHostSessions.length} task creation operation(s) require a new host-session preflight before retry`);
  }
  const incompatibleHosts = operations.filter((operation) => operation.status === "host-incompatible");
  if (incompatibleHosts.length) {
    recommendations.push(`${incompatibleHosts.length} task creation operation(s) require compatible selector evidence before dispatch`);
  }
  const partialObservations = operations.filter(
    (operation) => operation.observation_evidence?.quality === "partial",
  );
  if (partialObservations.length) {
    recommendations.push(`${partialObservations.length} observed task operation(s) retain explicitly partial host evidence`);
  }
  const expired = leases.filter((lease) => lease.state === "expired");
  if (expired.length) recommendations.push(`${expired.length} exclusive-resource lease(s) are expired and require owner review`);
  if (runtime.drift.length) recommendations.push("Pinned runtime has managed-file drift; review before sync");
  if (runtime.unexpected?.length) recommendations.push("Pinned runtime contains files not owned by codex-flow; review before sync");
  if (callbacks.superseded_count || callbacks.expired_count) {
    recommendations.push("Terminal callback journal contains superseded or expired records; cleanup remains audit-only");
  }
  if (gitLifecycle.eligible_count) {
    recommendations.push(`${gitLifecycle.eligible_count} task Git record(s) are eligible for an explicit cleanup plan`);
  }
  if (gitLifecycle.blocked) {
    recommendations.push("Git cleanup reconciliation has reached the configured task-wave block threshold");
  }
  return {
    mutation_performed: false,
    state_root: git.stateRoot,
    state_bytes: bytes,
    state_size: formatBytes(bytes),
    callbacks,
    task_operations: operations,
    recipients,
    leases,
    runtime: {
      installed: runtime.installed,
      package_version: runtime.manifest?.package_version ?? null,
      drift: runtime.drift,
      unexpected: runtime.unexpected ?? [],
    },
    git_lifecycle: gitLifecycle,
    recommendations,
  };
}
