---
name: coordinate
description: Deliver one approved Codex Flow assignment, with optional child tasks, owning integration, verification, reporting, and release.
---

# Deliver an Assignment

Follow `codex-orchestration:refresh` once before actionable coordination.
Use its authenticated runtime and verify the approved plan bytes/digest.
Refine the technical breakdown without rewriting intent; return material changes
to scope, acceptance, risk, or external authority to the director.

Own delivery even with zero children. Delegate only for a concrete independent
benefit. For delegation, read [parallel execution](../../templates/references/parallel-execution.md)
and obtain explicit selectors from the package's selector policy.

## Admit and execute

Activate the run and persist the workflow through the runtime commands. Use
their structured output for authority disclosure rather than transcribing IDs,
digests, or selector evidence into another narrative. Keep requested, accepted,
configured, observed, and unavailable evidence distinct.

Represent local work and child work with their actual ownership and execution
kind. A task begins only after its dependencies have accepted durable evidence.
Use the [stop policy](../../templates/references/stop-policy.md) when work drifts
or an authority check fails.

For visible tasks, follow [host operations](../../templates/references/host-operations.md):
one prepared attempt, one native creation call, the full first-turn assignment,
and exact result reconciliation. Never substitute a new task for an ambiguous
creation. Native subagents remain bounded read-only support.

## Results and closeout

Use native waits for executor liveness, not director monitoring. `wait_threads`
is active work, not an idle reporting boundary. Use
`codex-orchestration:integrate` for durable executor results.

Establish the [reporting route](../../templates/references/assignment-and-reporting.md)
before work can finish. Routine results use the quiet journal and native queue;
only a genuinely urgent risk uses the persisted one-shot interrupt described
in the [communication loop](../../templates/references/communication-loop.md).

Finalize through the runtime's command-managed closeout. It accounts for local
and child work, verification, eligible executor archival, and remaining fences
before normal run closure. Use `codex-orchestration:cleanup` for pending work;
do not abandon a successful run merely to bypass missing evidence.

Return one complete final with actual results, verification, artifacts, and
remaining decisions. Keep assignment reporting usable through restart requests
and cleanup finals; closing an execution run does not finish the assignment.
