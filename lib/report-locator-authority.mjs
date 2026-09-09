import { dirname, resolve } from "node:path";
import {
  CliError,
  readJson,
  requireExactFields,
  requireText,
  sha256,
  stableStringify,
} from "./core.mjs";
import { gitCommonDirectoryForState } from "./git.mjs";

export const REPORT_LOCATOR_KIND = "codex-flow-report-route-locator-v1";
const REPORT_LOCATOR_RETIREMENT_KIND = "codex-flow-report-locator-retirement-v1";
const DIGEST = /^[0-9a-f]{64}$/;

function requiredText(value, label, options = {}) {
  return requireText(value, label, { max: 256, safeId: true, ...options });
}

function requiredDigest(value, label) {
  const result = requireText(value, label, { max: 64 });
  if (!DIGEST.test(result)) throw new CliError(`${label} must be a lowercase SHA-256 digest`, 73);
  return result;
}

function absolutePath(value, label) {
  const result = requireText(value, label, { max: 2048 });
  if (!result.startsWith("/")) throw new CliError(`${label} must be an absolute path`, 73);
  return resolve(result);
}

function safeChild(directory, filename) {
  const path = resolve(directory, filename);
  if (dirname(path) !== directory) throw new CliError("Unsafe report locator authority path", 73);
  return path;
}

export function validateReportLocatorEnvelope(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "sender_thread_id", "state_root", "route_id", "route_sha256",
      "reporter", "native_queue",
    ],
  }, "Report route locator");
  if (value.schema_version !== 1 || value.kind !== REPORT_LOCATOR_KIND) {
    throw new CliError("Unsupported report route locator", 73);
  }
  return {
    schema_version: 1,
    kind: REPORT_LOCATOR_KIND,
    sender_thread_id: requiredText(value.sender_thread_id, "report locator sender_thread_id"),
    state_root: absolutePath(value.state_root, "report locator state_root"),
    route_id: requiredText(value.route_id, "report locator route_id"),
    route_sha256: requiredDigest(value.route_sha256, "report locator route_sha256"),
    reporter: value.reporter,
    native_queue: value.native_queue,
  };
}

export function repositoryLocatorPath(commonDir, senderThreadId) {
  return safeChild(
    resolve(commonDir, "codex-flow", "report-locators", "records"),
    `${sha256(senderThreadId)}.json`,
  );
}

export function repositoryLocatorLockPath(commonDir, senderThreadId) {
  return safeChild(
    resolve(commonDir, "codex-flow", "report-locators", "locks"),
    `${sha256(senderThreadId)}.lock.json`,
  );
}

export function repositoryLocatorRetirementPath(commonDir, senderThreadId, routeId) {
  return safeChild(
    resolve(commonDir, "codex-flow", "report-locators", "retirements"),
    `${sha256(stableStringify({ sender_thread_id: senderThreadId, route_id: routeId }))}.json`,
  );
}

export function activeRouteDigestForClosedRoute(route) {
  if (
    route?.state !== "closed"
    || route.lifecycle?.opened_at === undefined
    || route.lifecycle.closed_at === null
    || route.lifecycle.closure_reason === null
  ) throw new CliError("Report locator retirement requires a closed route", 73);
  return sha256(stableStringify({
    ...route,
    state: "active",
    lifecycle: {
      opened_at: route.lifecycle.opened_at,
      closed_at: null,
      closure_reason: null,
    },
  }));
}

function retirementIdFor(value) {
  return `report-locator-retirement-v1-${sha256(stableStringify({
    sender_thread_id: value.sender_thread_id,
    state_root: value.state_root,
    route_id: value.route_id,
    locator_sha256: value.locator_sha256,
    active_route_sha256: value.active_route_sha256,
    closed_route_sha256: value.closed_route_sha256,
    accepted_report_ids: value.accepted_report_ids,
    reason: value.reason,
    recovery: value.recovery,
    ...(value.reporter_runtime_sha256 === undefined ? {} : {
      reporter_runtime_sha256: value.reporter_runtime_sha256,
    }),
  }))}`;
}

export function validateReportLocatorRetirement(value) {
  requireExactFields(value, {
    required: [
      "schema_version", "kind", "retirement_id", "sender_thread_id", "state_root",
      "route_id", "locator_sha256", "active_route_sha256", "closed_route_sha256",
      "accepted_report_ids", "reason", "recovery", "retired_at",
    ],
    optional: ["reporter_runtime_sha256"],
  }, "Report locator retirement");
  const retirement = {
    schema_version: value.schema_version,
    kind: value.kind,
    retirement_id: requiredText(value.retirement_id, "report locator retirement_id"),
    sender_thread_id: requiredText(value.sender_thread_id, "report locator retirement sender_thread_id"),
    state_root: absolutePath(value.state_root, "report locator retirement state_root"),
    route_id: requiredText(value.route_id, "report locator retirement route_id"),
    locator_sha256: requiredDigest(value.locator_sha256, "report locator retirement locator_sha256"),
    active_route_sha256: requiredDigest(value.active_route_sha256, "report locator retirement active_route_sha256"),
    closed_route_sha256: requiredDigest(value.closed_route_sha256, "report locator retirement closed_route_sha256"),
    accepted_report_ids: Array.isArray(value.accepted_report_ids)
      ? value.accepted_report_ids.map((entry, index) => requiredText(entry, `report locator retirement accepted_report_ids[${index}]`)).sort()
      : (() => { throw new CliError("Report locator retirement accepted_report_ids must be an array", 73); })(),
    reason: requireText(value.reason, "report locator retirement reason", { max: 32, safeId: true }),
    recovery: value.recovery,
    retired_at: requireText(value.retired_at, "report locator retirement retired_at", { max: 64 }),
  };
  if (value.reporter_runtime_sha256 !== undefined) {
    retirement.reporter_runtime_sha256 = requiredDigest(
      value.reporter_runtime_sha256,
      "report locator retirement reporter_runtime_sha256",
    );
  }
  if (retirement.schema_version !== 1 || retirement.kind !== REPORT_LOCATOR_RETIREMENT_KIND) {
    throw new CliError("Unsupported report locator retirement", 73);
  }
  if (!Number.isFinite(Date.parse(retirement.retired_at))) {
    throw new CliError("Report locator retirement retired_at must be a timestamp", 73);
  }
  if (retirement.recovery !== null) {
    requireExactFields(retirement.recovery, {
      required: ["kind", "refresh_id", "handoff_digest", "source_tree_digest", "disposition_id"],
    }, "Report locator recovery");
    retirement.recovery = {
      kind: requireText(retirement.recovery.kind, "report locator recovery kind", { max: 64, safeId: true }),
      refresh_id: requiredText(retirement.recovery.refresh_id, "report locator recovery refresh_id"),
      handoff_digest: requiredDigest(retirement.recovery.handoff_digest, "report locator recovery handoff_digest"),
      source_tree_digest: requiredDigest(retirement.recovery.source_tree_digest, "report locator recovery source_tree_digest"),
      disposition_id: requiredText(retirement.recovery.disposition_id, "report locator recovery disposition_id"),
    };
  }
  if (retirement.retirement_id !== retirementIdFor(retirement)) {
    throw new CliError("Report locator retirement identity is invalid", 73);
  }
  return retirement;
}

export function reportLocatorRetirementFor({ locator, route, cleanup, reason, recovery, retiredAt }) {
  const seed = {
    schema_version: 1,
    kind: REPORT_LOCATOR_RETIREMENT_KIND,
    sender_thread_id: locator.sender_thread_id,
    state_root: locator.state_root,
    route_id: locator.route_id,
    locator_sha256: sha256(stableStringify(locator)),
    active_route_sha256: locator.route_sha256,
    closed_route_sha256: sha256(stableStringify(route)),
    accepted_report_ids: cleanup.accepted_reports,
    reason,
    recovery,
    retired_at: new Date(retiredAt).toISOString(),
    ...(locator.reporter?.runtime_sha256 === undefined ? {} : {
      reporter_runtime_sha256: locator.reporter.runtime_sha256,
    }),
  };
  return validateReportLocatorRetirement({ ...seed, retirement_id: retirementIdFor(seed) });
}

export function assertReportLocatorRetirementMatches({ retirement, route, stateRoot }) {
  if (
    route?.state !== "closed"
    || retirement.sender_thread_id !== route.sender?.thread_id
    || retirement.state_root !== resolve(stateRoot)
    || retirement.route_id !== route.route_id
    || retirement.active_route_sha256 !== activeRouteDigestForClosedRoute(route)
    || retirement.closed_route_sha256 !== sha256(stableStringify(route))
  ) throw new CliError("Report locator retirement does not match the exact closed route", 73);
  return retirement;
}

/** Read one exact repository locator retirement without changing reporting state. */
export async function repositoryReportLocatorRetirement({ stateRoot, routeId, successorRouteId }) {
  const { assertActiveReportRoute, reportRoute } = await import("./report-routes.mjs");
  const route = await reportRoute({ stateRoot, routeId });
  if (route.state !== "closed") throw new CliError("Report locator retirement requires a closed route", 73);
  const commonDir = gitCommonDirectoryForState(stateRoot);
  const active = await readJson(repositoryLocatorPath(commonDir, route.sender.thread_id), {
    allowMissing: true,
    guardRoot: commonDir,
  });
  if (active !== null) {
    const locator = validateReportLocatorEnvelope(active);
    if (
      locator.sender_thread_id !== route.sender.thread_id
      || locator.state_root !== resolve(stateRoot)
    ) throw new CliError("Active report locator conflicts with retired sender authority", 73);
    if (locator.route_id !== successorRouteId) {
      throw new CliError("Unexpected report locator remains active after route closure", 73);
    }
    const successorRoute = await assertActiveReportRoute({ stateRoot, routeId: locator.route_id });
    if (
      successorRoute.sender.thread_id !== locator.sender_thread_id
      || sha256(stableStringify(successorRoute)) !== locator.route_sha256
    ) throw new CliError("Active report locator does not resolve to its exact successor route", 73);
  }
  const persisted = await readJson(
    repositoryLocatorRetirementPath(commonDir, route.sender.thread_id, route.route_id),
    { allowMissing: true, guardRoot: commonDir },
  );
  if (persisted === null) throw new CliError("Report locator retirement evidence is absent", 73);
  return assertReportLocatorRetirementMatches({
    retirement: validateReportLocatorRetirement(persisted),
    route,
    stateRoot,
  });
}
