import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECTOR_POLICY_VERSION,
  selectSelectorPolicy,
  selectorPolicyLanes,
} from "../lib/policy/selector-policy.mjs";

test("v0.9 policy maps each bounded work lane to an explicit selector", () => {
  assert.equal(SELECTOR_POLICY_VERSION, "v0.9");
  assert.deepEqual(selectorPolicyLanes(), [
    "mechanical",
    "bounded_implementation",
    "integration",
    "governance",
  ]);
  assert.deepEqual(selectSelectorPolicy("mechanical"), {
    lane: "mechanical",
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Mechanical, local, or read-only work with clear acceptance criteria.",
  });
  assert.deepEqual(selectSelectorPolicy("bounded_implementation"), {
    lane: "bounded_implementation",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Bounded nontrivial implementation or review.",
  });
  assert.deepEqual(selectSelectorPolicy("integration"), {
    lane: "integration",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Multi-module root-cause or integration work.",
  });
  assert.deepEqual(selectSelectorPolicy("governance"), {
    lane: "governance",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    selector_rationale: "Coordination and systemic decisions.",
  });
});

test("v0.9 policy has no App-evidence input or output", () => {
  const policy = selectSelectorPolicy("bounded_implementation");
  assert.deepEqual(Object.keys(policy), ["lane", "model", "reasoning_effort", "selector_rationale"]);
  assert.equal(Object.hasOwn(policy, "requested"), false);
  assert.equal(Object.hasOwn(policy, "accepted"), false);
  assert.equal(Object.hasOwn(policy, "observed"), false);
});

test("v0.9 policy returns immutable values and rejects unknown lanes", () => {
  const first = selectSelectorPolicy("governance");
  const second = selectSelectorPolicy("governance");
  assert.notStrictEqual(first, second);
  assert.throws(() => {
    first.model = "gpt-5.6-luna";
  }, TypeError);
  assert.equal(second.model, "gpt-5.6-sol");
  assert.throws(() => selectSelectorPolicy("automatic"), /Unknown selector policy lane/);
});
