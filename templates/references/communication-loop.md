# Communication loop

## Routine completion

Routine completion is quiet. The executor writes one authenticated terminal
receipt into the repository journal. Native task finals and waits provide
liveness only; they are not result authority and must not interrupt a working
coordinator.

`wait_threads` is active coordination work, not an idle delivery boundary.
Never remove a working manual or explicit collection path until a replacement
is installed and trusted, where applicable, and verified for the exact
sender-recipient mapping through a live test. Automated full-final reporting is
experimental and is neither provided nor guaranteed by this Flow release.

At a safe boundary, the coordinator reads callback status, observes the chosen
receipt, and performs disposition, integration or no-change reconciliation,
combined verification, archival, and cleanup.

## Urgent interruption

An urgent interruption is reserved for a blocker, approval request, ownership
collision, or high-risk drift whose delay would materially endanger the work.
Persist the urgent signal before one bounded direct delivery attempt. Reconcile
that exact attempt and never retry an ambiguous delivery.

This split protects coordinator continuity without hiding urgent risk.
