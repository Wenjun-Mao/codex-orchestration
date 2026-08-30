import { requireText } from "./core.mjs";

export const SELECTOR_RATIONALE_MAX_LENGTH = 512;

export function validateSelectorRationale(value, label = "selector_rationale") {
  return requireText(value, label, { max: SELECTOR_RATIONALE_MAX_LENGTH });
}
