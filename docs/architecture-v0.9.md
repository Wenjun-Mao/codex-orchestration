# v0.9 selector-policy boundary

## Purpose

v0.9 separates a replaceable model-routing recommendation from the durable
Flow governance and Codex App evidence contracts. The new pure module,
[`lib/policy/selector-policy.mjs`](../lib/policy/selector-policy.mjs), maps a
bounded work lane to `model`, `reasoning_effort`, and `selector_rationale`.
It has no repository, App, task, journal, or network dependency.

```text
work lane -> selector policy -> immutable task contract -> native creation
                                                       -> requested / accepted / observed evidence
                                                       -> release, callback, integration
```

The policy owns only the first arrow. A caller copies its recommendation into a
task contract; existing lifecycle code remains responsible for validating that
contract and preserving selector provenance. In particular, an unavailable
host observation remains `null`, and requested or accepted values must never
be relabelled as observed.

## Stable interface

`selectSelectorPolicy(lane)` returns a fresh immutable recommendation for one
of four explicit lanes: `mechanical`, `bounded_implementation`, `integration`,
or `governance`. `selectorPolicyLanes()` exposes the supported set. Unknown
lanes fail closed. The policy does not infer a lane, inspect task contents, or
perform automatic model selection.

The initial values preserve the current rubric: Luna-medium for mechanical
work, Terra-high for bounded implementation, Terra-xhigh for integration, and
Sol-high for governance. Those values are policy data, not a permanent product
contract; a future evidence-backed revision can replace them without altering
the task identity, release, callback, or evidence schemas.

## Boundary guardrails

- Flow governance continues to bind selectors and rationale into the
  content-addressed workflow and generated task contract.
- Codex App remains the native source of requested, accepted, and observed
  selector evidence; the policy neither fabricates nor normalizes it.
- A policy replacement must keep its output explicit and bounded, retain a
  rationale suitable for contract validation, and add focused tests for each
  supported lane.
- Automatic dynamic routing is out of scope until held-out evaluation supports
  it. Current routing evidence classifies per-task routing as a hypothesis to
  test, not a proven optimization.

This boundary follows the model-routing and provenance rules in the
[README](../README.md) and the evidence limits in
[the routing research record](research/2026-08-30-orchestration-routing-evidence.md).
