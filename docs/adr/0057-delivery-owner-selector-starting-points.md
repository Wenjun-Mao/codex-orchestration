# ADR 0057: Delivery-owner selector starting points

- Status: accepted for v0.9.7
- Date: 2026-09-07
- Authority: approved delivery-owner starting choices
- Refines: ADR 0051

## Context

Coordinator selection previously collapsed all non-routine delivery into one
Sol lane and allowed staffing complexity to dominate the choice. That obscured
the useful middle case: demanding but bounded implementation or diagnosis.

## Decision

Choose a delivery owner's starting selector by the hardest expected judgment
in the assignment, independently of title or child count:

- settled routine delivery with established checks: Terra-high;
- bounded demanding implementation or diagnosis: Terra-xhigh; and
- unsettled architecture, interacting authority, or difficult integration
  decisions: Sol-high.

These are recommendations, not capability claims or hard restrictions. An
explicit override remains valid with a replacement rationale. Executor routing
is unchanged.

## Rejected alternatives

- Select from coordinator title or expected number of children. Staffing shape
  does not determine the owner's hardest judgment.
- Add availability probes, fallback escalation, a model registry, or a new
  lifecycle record. Selection remains an explicit planning decision.

## Consequences and guardrails

The package selector policy is the canonical rubric. Role skills refer to it
instead of copying the table. Tests cover all three starting choices and prove
that changing child use does not change the delivery-owner selector.
