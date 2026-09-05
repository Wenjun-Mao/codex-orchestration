# ADR 0046: Operation and branch authority joins

- Status: accepted for post-v0.9 development
- Date: 2026-09-04
- Refines: ADR 0043 native-first modular architecture

## Context

Two accepted v0.9 states exposed missing authority joins. A later workflow
revision could not consume a completed task disposition because dependency
resolution compared its historical claim with a nonexistent disposition
`operation_id`; task-thread terminal authority identifies the operation as
`launch_id`. Separately, run admission accepted the coordinator checkout branch
as an executor branch fence. Cleanup then had to delete that branch while the
combined verification required it to remain checked out exactly.

## Decision

Dependency resolution maps terminal authority to its owning execution surface:
a task disposition authenticates against `launch_id`, while a native subagent
operation authenticates against `operation_id`. The remaining run, workflow,
task, contract, and coordinator identities must still match exactly.

The runtime repository branch is coordinator authority, not executor cleanup
authority. Run admission rejects any branch fence equal to the runtime
context's coordinator branch. Cleanup and verification remain strict; neither
may tolerate branch deletion or branch-name drift.

## Consequences and guardrails

Positive and negative lifecycle regressions cover historical task-disposition
dependencies and launch drift. Admission coverage proves an invalid
coordinator/executor branch overlap leaves no active run. Previously admitted
contradictory runs require explicit terminal disposition and clean-start
handling; their immutable plans and runtime snapshots are never rewritten.
