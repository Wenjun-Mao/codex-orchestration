export const SELECTOR_POLICY_VERSION = "v0.9";

const POLICY_BY_LANE = Object.freeze({
  mechanical: Object.freeze({
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    selector_rationale: "Mechanical, local, or read-only work with clear acceptance criteria.",
  }),
  bounded_implementation: Object.freeze({
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Bounded nontrivial implementation or review.",
  }),
  integration: Object.freeze({
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Multi-module root-cause or integration work.",
  }),
  governance: Object.freeze({
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    selector_rationale: "Coordination and systemic decisions.",
  }),
});

export function selectorPolicyLanes() {
  return Object.freeze(Object.keys(POLICY_BY_LANE));
}

export function selectSelectorPolicy(lane) {
  if (typeof lane !== "string" || !Object.hasOwn(POLICY_BY_LANE, lane)) {
    throw new RangeError(`Unknown selector policy lane: ${String(lane)}`);
  }

  // Return a fresh immutable value so callers cannot alter future selections.
  return Object.freeze({ lane, ...POLICY_BY_LANE[lane] });
}
