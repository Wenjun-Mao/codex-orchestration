import { requireText } from "./core.mjs";

export const SELECTOR_RATIONALE_MAX_LENGTH = 512;
export const REASONING_EFFORTS = Object.freeze([
  null, "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

export function validateSelectorRationale(value, label = "selector_rationale") {
  return requireText(value, label, { max: SELECTOR_RATIONALE_MAX_LENGTH });
}
