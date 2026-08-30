import { requireText } from "./core.mjs";

export const SELECTOR_RATIONALE_MAX_LENGTH = 512;
export const REASONING_EFFORTS = Object.freeze([
  null, "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

export const MODEL_ROUTING_RUBRIC = Object.freeze({
  luna_medium: "Mechanical, local, or read-only work with clear acceptance criteria.",
  terra_high: "Bounded nontrivial implementation or review.",
  terra_xhigh: "Multi-module root-cause or integration work.",
  sol_high: "Coordination and systemic decisions.",
  elevated_sol: "Sol xhigh or max requires a stated need; Ultra is exceptional for visible tasks.",
  native_subagent_ultra: "Ultra is forbidden for native subagents.",
});

export function validateSelectorRationale(value, label = "selector_rationale") {
  return requireText(value, label, { max: SELECTOR_RATIONALE_MAX_LENGTH });
}
