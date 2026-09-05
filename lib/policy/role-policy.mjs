const ROLES = Object.freeze({
  director: "director",
  coordinator: "coordinator",
  executor: "executor",
});

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be nonempty text`);
  }
  return value;
}

function requiredTextArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty array`);
  }
  return Object.freeze(value.map((entry, index) => requiredText(entry, `${label}[${index}]`)));
}

function reportingTarget(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["path", "recipient"])) {
    throw new TypeError(`${label} must contain only recipient and path`);
  }
  return Object.freeze({
    recipient: requiredText(value.recipient, `${label}.recipient`),
    path: requiredText(value.path, `${label}.path`),
  });
}

export function selectFlowRole({
  ownsGoalsAndAcceptance,
  ownsDeliveryAndIntegration,
  ownsScopedExecution,
}) {
  const facts = [
    [requiredBoolean(ownsGoalsAndAcceptance, "ownsGoalsAndAcceptance"), ROLES.director],
    [requiredBoolean(ownsDeliveryAndIntegration, "ownsDeliveryAndIntegration"), ROLES.coordinator],
    [requiredBoolean(ownsScopedExecution, "ownsScopedExecution"), ROLES.executor],
  ];
  const selected = facts.filter(([active]) => active);
  if (selected.length !== 1) throw new RangeError("Role facts must select exactly one owner");
  return selected[0][1];
}

export function validateAssignmentBrief(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("assignment brief must be an object");
  }
  const keys = Object.keys(value).sort();
  const expected = ["acceptance", "constraints", "outcome", "reporting", "scope"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new TypeError(`assignment brief must contain only ${expected.join(", ")}`);
  }
  return Object.freeze({
    outcome: requiredText(value.outcome, "assignment.outcome"),
    scope: requiredTextArray(value.scope, "assignment.scope"),
    constraints: requiredTextArray(value.constraints, "assignment.constraints"),
    acceptance: requiredTextArray(value.acceptance, "assignment.acceptance"),
    reporting: reportingTarget(value.reporting, "assignment.reporting"),
  });
}

export function validateResultBrief(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("result brief must be an object");
  }
  const keys = Object.keys(value).sort();
  const expected = ["actual_results", "concerns", "evidence", "outcome", "reporting", "status"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new TypeError(`result brief must contain only ${expected.join(", ")}`);
  }
  if (!["complete", "blocked"].includes(value.status)) {
    throw new RangeError("result.status must be complete or blocked");
  }
  return Object.freeze({
    outcome: requiredText(value.outcome, "result.outcome"),
    status: value.status,
    actual_results: requiredTextArray(value.actual_results, "result.actual_results"),
    evidence: requiredTextArray(value.evidence, "result.evidence"),
    concerns: requiredTextArray(value.concerns, "result.concerns"),
    reporting: reportingTarget(value.reporting, "result.reporting"),
  });
}

export function mayRetireWorkingReportPath({
  replacementInstalled,
  replacementTrusted,
  exactSenderRecipientVerified,
}) {
  return requiredBoolean(replacementInstalled, "replacementInstalled")
    && requiredBoolean(replacementTrusted, "replacementTrusted")
    && requiredBoolean(exactSenderRecipientVerified, "exactSenderRecipientVerified");
}
