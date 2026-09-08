---
name: coordinate
description: Deliver one approved Codex Flow assignment, with optional child tasks, owning integration, verification, reporting, and release.
---

# Deliver an Assignment

Follow `codex-orchestration:refresh` once before actionable coordination.
Use its authenticated runtime and read the prepared plan snapshot.
Refine the technical breakdown without rewriting intent; return material changes
to scope, acceptance, risk, or external authority to the director.

Prefer capable, lower-cost executors for substantial, separable implementation,
verification, or review. Keep small or tightly coupled work local when
delegation overhead outweighs the benefit. Reconsider delegation as work
boundaries become clearer. Own delivery even with zero children.

For delegation, read [parallel execution](../../templates/references/parallel-execution.md)
and obtain explicit selectors from the package's selector policy.

## Admit and execute

Activate the run and persist the workflow through the runtime commands. Use
their structured output for authority disclosure rather than transcribing IDs,
digests, or selector evidence into another narrative. Keep requested, accepted,
configured, observed, and unavailable evidence distinct.

Register the [reporting route](../../templates/references/assignment-and-reporting.md)
from the initial prompt's preparation ID before substantive work; retain the
returned assignment identity for closeout. Registration validates the saved
plan automatically.

Represent local work and child work with their actual ownership and execution
kind. A task begins only after its dependencies have accepted durable evidence.
For coordinator-owned nodes, run `workflow local start --run-id ID --file
request.json` before source mutation and `workflow local complete --run-id ID
--file request.json` with verification evidence afterward. Inspect an existing
claim with `workflow local status --run-id ID --local-work-id ID`; do not relabel
an executor contract as local work.
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

Routine results use the quiet journal and native queue;
only a genuinely urgent risk uses the persisted one-shot interrupt described
in the [communication loop](../../templates/references/communication-loop.md).

After verified local and child results, run `assignment closeout --assignment-id
ID --file request.json` with phase `coordinator` for child-first cleanup before
normal run closure. Perform any returned host archive action through the owning
Codex App tool and reconcile its exact bounded result as described in
[host operations](../../templates/references/host-operations.md). Use
`codex-orchestration:cleanup` for pending resources;
do not abandon a successful run to bypass missing evidence. Director acceptance
handles the coordinator's remaining closeout after reviewing its final.

Return one complete final with actual results, verification, artifacts, and
remaining decisions. Keep assignment reporting usable through restart requests
and cleanup finals; closing an execution run does not finish the assignment.
