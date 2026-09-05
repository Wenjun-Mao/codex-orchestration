import assert from "node:assert/strict";
import test from "node:test";
import {
  routeWork,
  selectExecutionSurface,
  selectSelectorPolicy,
  selectorPolicyLanes,
} from "../lib/policy/selector-policy.mjs";

test("routing policy maps each bounded work lane to an explicit selector", () => {
  assert.deepEqual(selectorPolicyLanes(), [
    "scoped_execution",
    "bounded_implementation",
    "root_cause",
    "coordination",
    "consequential_judgment",
  ]);
  assert.deepEqual(selectSelectorPolicy("scoped_execution"), {
    lane: "scoped_execution",
    model: "gpt-5.6-luna",
    reasoning_effort: "xhigh",
    selector_rationale: "Substantive, well-scoped execution with clear acceptance criteria.",
  });
  assert.deepEqual(selectSelectorPolicy("bounded_implementation"), {
    lane: "bounded_implementation",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Bounded nontrivial implementation or review.",
  });
  assert.deepEqual(selectSelectorPolicy("root_cause"), {
    lane: "root_cause",
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Difficult root-cause analysis or integration work.",
  });
  assert.deepEqual(selectSelectorPolicy("coordination"), {
    lane: "coordination",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    selector_rationale: "Director work or bounded coordination, delivery, and integration decisions.",
  });
  assert.deepEqual(selectSelectorPolicy("consequential_judgment"), {
    lane: "consequential_judgment",
    model: "gpt-6-astra",
    reasoning_effort: "high",
    selector_rationale: "Optional support for a consequential director judgment.",
  });
});

test("v0.9 chooses the execution surface before model selectors", () => {
  assert.equal(selectExecutionSurface({
    sharedEvolvingState: true,
    boundedReadOnlySupport: false,
    independentMutation: false,
  }), "coordinator-task");
  assert.equal(selectExecutionSurface({
    sharedEvolvingState: false,
    boundedReadOnlySupport: true,
    independentMutation: false,
  }), "native-subagent");
  assert.equal(selectExecutionSurface({
    sharedEvolvingState: false,
    boundedReadOnlySupport: false,
    independentMutation: true,
  }), "visible-task");
  assert.throws(() => selectExecutionSurface({
    sharedEvolvingState: true,
    boundedReadOnlySupport: true,
    independentMutation: false,
  }), /exactly one/);
});

test("v0.9 routes explicitly and requires a replacement rationale for overrides", () => {
  assert.deepEqual(routeWork({
    surfaceFacts: {
      sharedEvolvingState: false,
      boundedReadOnlySupport: false,
      independentMutation: true,
    },
    lane: "bounded_implementation",
  }), {
    surface: "visible-task",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Bounded nontrivial implementation or review.",
    policy_lane: "bounded_implementation",
    overridden: false,
  });
  assert.throws(() => routeWork({
    surfaceFacts: {
      sharedEvolvingState: false,
      boundedReadOnlySupport: true,
      independentMutation: false,
    },
    lane: "scoped_execution",
    override: {
      model: "gpt-5.6-sol",
      reasoning_effort: "ultra",
      selector_rationale: "Use inherited settings.",
    },
  }), /Ultra is forbidden/);
  assert.throws(() => routeWork({
    surfaceFacts: {
      sharedEvolvingState: false,
      boundedReadOnlySupport: false,
      independentMutation: true,
    },
    lane: "coordination",
    override: {
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      selector_rationale: "Needed.",
    },
  }), /substantive stated need/);
});

test("a trivial task may deliberately override Luna-xhigh with a lower effort and rationale", () => {
  assert.deepEqual(routeWork({
    surfaceFacts: {
      sharedEvolvingState: false,
      boundedReadOnlySupport: false,
      independentMutation: true,
    },
    lane: "scoped_execution",
    override: {
      model: "gpt-5.6-luna",
      reasoning_effort: "low",
      selector_rationale: "Trivial one-file transcription with exact expected output.",
    },
  }), {
    surface: "visible-task",
    model: "gpt-5.6-luna",
    reasoning_effort: "low",
    selector_rationale: "Trivial one-file transcription with exact expected output.",
    policy_lane: "scoped_execution",
    overridden: true,
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
  const first = selectSelectorPolicy("coordination");
  const second = selectSelectorPolicy("coordination");
  assert.notStrictEqual(first, second);
  assert.throws(() => {
    first.model = "gpt-5.6-luna";
  }, TypeError);
  assert.equal(second.model, "gpt-5.6-sol");
  assert.throws(() => selectSelectorPolicy("automatic"), /Unknown selector policy lane/);
});
