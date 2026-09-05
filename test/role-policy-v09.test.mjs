import assert from "node:assert/strict";
import test from "node:test";
import {
  mayRetireWorkingReportPath,
  selectFlowRole,
  validateAssignmentBrief,
  validateResultBrief,
} from "../lib/policy/role-policy.mjs";

test("role selection keeps goals, delivery, and scoped execution with distinct owners", () => {
  assert.equal(selectFlowRole({
    ownsGoalsAndAcceptance: true,
    ownsDeliveryAndIntegration: false,
    ownsScopedExecution: false,
  }), "director");
  assert.equal(selectFlowRole({
    ownsGoalsAndAcceptance: false,
    ownsDeliveryAndIntegration: true,
    ownsScopedExecution: false,
  }), "coordinator");
  assert.equal(selectFlowRole({
    ownsGoalsAndAcceptance: false,
    ownsDeliveryAndIntegration: false,
    ownsScopedExecution: true,
  }), "executor");
  assert.throws(() => selectFlowRole({
    ownsGoalsAndAcceptance: true,
    ownsDeliveryAndIntegration: true,
    ownsScopedExecution: false,
  }), /exactly one owner/);
});

test("assignment and result briefs preserve one recipient and actual evidence", () => {
  const reporting = { recipient: "director task", path: "/tmp/result.md" };
  const assignment = validateAssignmentBrief({
    outcome: "Return a release-ready candidate.",
    scope: ["Role policy and skills"],
    constraints: ["Do not publish"],
    acceptance: ["Full validation passes"],
    reporting,
  });
  assert.deepEqual(assignment.reporting, reporting);

  const result = validateResultBrief({
    outcome: assignment.outcome,
    status: "complete",
    actual_results: ["Candidate committed"],
    evidence: ["npm test passed"],
    concerns: ["Live hook remains canary-only"],
    reporting,
  });
  assert.deepEqual(result.reporting, reporting);
  assert.equal(Object.hasOwn(result, "summary"), false);
  assert.throws(() => validateResultBrief({ ...result, summary: "second narrative" }), /must contain only/);
});

test("a working report path retires only after the exact replacement is ready", () => {
  const ready = {
    replacementInstalled: true,
    replacementTrusted: true,
    exactSenderRecipientVerified: true,
  };
  assert.equal(mayRetireWorkingReportPath(ready), true);
  for (const key of Object.keys(ready)) {
    assert.equal(mayRetireWorkingReportPath({ ...ready, [key]: false }), false);
  }
});
