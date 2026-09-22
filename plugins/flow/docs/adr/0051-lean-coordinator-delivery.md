# ADR 0051: Lean coordinator delivery

- Status: accepted for v0.9.5
- Date: 2026-09-06
- Authority: approved v0.9.5 lean-delivery addendum

## Context

The coordinator role owns bounded delivery, but prior guidance coupled that
responsibility to Sol-high and repeatedly described executor orchestration. For
a settled assignment with established verification, that wording could create
an unnecessary child task while leaving no explicit selector recommendation
for a coordinator that performs the work directly.

## Decision

Coordinator is an ownership boundary, not a mandatory model or child count.
Add a `bounded_coordination` recommendation of Terra-high for settled bounded
delivery with established verification. Keep Sol-high for substantial
uncertainty, systemic decisions, or complex multi-executor coordination. These
are policy recommendations, not empirical-optimality claims; every assignment
still records its explicit selector and rationale.

A coordinator may complete the full assignment with zero children. It delegates
only when a separate bounded lane has a concrete independent benefit. In both
shapes the coordinator retains delivery, integration, verification, reporting,
release, and cleanup responsibility. Director goals, strategic tradeoffs, and
acceptance remain unchanged. No direct-executor protocol, automatic escalation,
or availability probe is introduced.

## Rejected alternatives

- Require every coordinator to create an executor. This adds latency and a
  lifecycle without an independent ownership benefit.
- Replace Sol-high for all coordination. Unsettled and systemic work still
  benefits from the stronger governance recommendation.
- Return verification or release work to the director for solo delivery. That
  breaks the established dispatch-and-return boundary.

## Consequences and guardrails

The routing policy exposes the two coordinator workload lanes and an explicit
staffing result. Tests prove that settled work can remain solo, complex work can
recommend a bounded child for a stated benefit, and both retain the same closure
responsibilities. Live acceptance must exercise a Terra-high zero-child
coordinator through the corrected quiet report route.
