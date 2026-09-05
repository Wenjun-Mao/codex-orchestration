const SURFACES = Object.freeze({
  coordinator: "coordinator-task",
  subagent: "native-subagent",
  visible: "visible-task",
});

const POLICY_BY_LANE = Object.freeze({
  scoped_execution: Object.freeze({
    model: "gpt-5.6-luna",
    reasoning_effort: "xhigh",
    selector_rationale: "Substantive, well-scoped execution with clear acceptance criteria.",
  }),
  bounded_implementation: Object.freeze({
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Bounded nontrivial implementation or review.",
  }),
  root_cause: Object.freeze({
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    selector_rationale: "Difficult root-cause analysis or integration work.",
  }),
  coordination: Object.freeze({
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    selector_rationale: "Director work or bounded coordination, delivery, and integration decisions.",
  }),
  consequential_judgment: Object.freeze({
    model: "gpt-6-astra",
    reasoning_effort: "high",
    selector_rationale: "Optional support for a consequential director judgment.",
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

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function nonEmptyText(value, label, max = 512) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(`${label} must be nonempty and at most ${max} characters`);
  }
  return value;
}

export function selectExecutionSurface({
  sharedEvolvingState,
  boundedReadOnlySupport,
  independentMutation,
}) {
  const shared = requiredBoolean(sharedEvolvingState, "sharedEvolvingState");
  const support = requiredBoolean(boundedReadOnlySupport, "boundedReadOnlySupport");
  const mutation = requiredBoolean(independentMutation, "independentMutation");
  if ([shared, support, mutation].filter(Boolean).length !== 1) {
    throw new RangeError("Surface facts must select exactly one execution shape");
  }
  if (shared) return SURFACES.coordinator;
  if (support) return SURFACES.subagent;
  return SURFACES.visible;
}

function validateOverride(surface, override, exceptionalVisibleTask) {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    throw new TypeError("selector override must be an object");
  }
  const actual = Object.keys(override).sort();
  const expected = ["model", "reasoning_effort", "selector_rationale"];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError("selector override must contain only model, reasoning_effort, and selector_rationale");
  }
  const model = nonEmptyText(override.model, "override.model", 128);
  const reasoning = nonEmptyText(override.reasoning_effort, "override.reasoning_effort", 16);
  const rationale = nonEmptyText(override.selector_rationale, "override.selector_rationale");
  if (!EFFORTS.has(reasoning)) throw new RangeError("override.reasoning_effort is unsupported");
  if (surface === SURFACES.subagent && reasoning === "ultra") {
    throw new RangeError("Ultra is forbidden for native subagents");
  }
  if (surface === SURFACES.visible && reasoning === "ultra" && exceptionalVisibleTask !== true) {
    throw new RangeError("Ultra visible tasks require an explicit exceptional-task declaration");
  }
  if (model === "gpt-5.6-sol" && ["xhigh", "max", "ultra"].includes(reasoning)
    && rationale.length < 24) {
    throw new RangeError("Higher Sol effort requires a substantive stated need");
  }
  return Object.freeze({ model, reasoning_effort: reasoning, selector_rationale: rationale });
}

export function routeWork({
  surfaceFacts,
  lane,
  override = null,
  exceptionalVisibleTask = false,
}) {
  const surface = selectExecutionSurface(surfaceFacts);
  const recommendation = selectSelectorPolicy(lane);
  const selector = override === null
    ? recommendation
    : validateOverride(surface, override, exceptionalVisibleTask);
  if (surface === SURFACES.subagent && selector.reasoning_effort === "ultra") {
    throw new RangeError("Ultra is forbidden for native subagents");
  }
  return Object.freeze({
    surface,
    model: selector.model,
    reasoning_effort: selector.reasoning_effort,
    selector_rationale: selector.selector_rationale,
    policy_lane: lane,
    overridden: override !== null,
  });
}
