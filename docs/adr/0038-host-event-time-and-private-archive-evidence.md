# ADR 0038: Host event time and private archive evidence

## Status

Accepted for the v0.7.8 development checkpoint.

## Context

Visible-task creation had one reconciliation deadline but treated the
coordinator's processing time as though it were the host event time. A ready
task whose nonce-bearing initial turn and selector evidence were observed
inside that deadline could be rejected solely because the coordinator processed
the evidence later. Status polling could also replace that eligible record with
an irreversible timeout ambiguity.

Codex App's public archived-task index can lag an accepted archive operation.
The v0.7.8 private session observer can prove one exact archived session and
the absence of an active counterpart, but the run archive lifecycle still
required public-index visibility. Unplug had the same availability gap.

## Decision

Creation keeps the bounded window as an event-evidence admission rule. Exact
host timestamps for accepted selectors, observed selectors, and the
nonce-bearing initial turn must fall within the window. Reconciliation and
private-resolution processing may occur later, provided those persisted facts
remain valid. Status reports that the ordinary window is closed but does not
rewrite an unresolved operation; an explicit ambiguous result remains the
fail-closed terminal outcome when qualifying host evidence is unavailable.

`archive observe-private` is a read-only, run-bound observer for a dispatched
archive with an accepted or ambiguous setter result. It emits a task
observation carrying the authenticated private archive record. Archive
reconciliation accepts that source only when its exact thread ID, no-active
counterpart, session digest, binding digest, and observation timestamp agree.
It remains subject to the existing worktree reclamation gate.

`unplug observe-private` produces the same private provenance for every task in
an exact unplug plan. `unplug apply` accepts it only when the plan and resource
IDs, task ID, timestamp, and private binding all agree. No private paths or
session contents are persisted.

This supersedes ADR 0037's processing-time-only deadline rule.

## Rejected alternatives

- Extend the reconciliation timeout. It does not distinguish a timely host
  event from late coordinator processing.
- Treat status polling as proof that no task was created. A delayed public
  catalog cannot establish that negative fact.
- Accept a bare `archived: true` private claim. It would not bind archive truth
  to the exact session or rule out an active counterpart.
- Bypass worktree reclamation after private archive proof. Task visibility and
  managed worktree lifecycle remain independent facts.

## Consequences and guardrails

- Late evidence is admissible only from the existing exact host evidence paths;
  title, recency, and timing correlation remain forbidden.
- A host event at or after the deadline still fails closed.
- Archive and unplug private observations are explicit read-only commands, not
  automatic fallbacks from public host APIs.
- Focused tests cover late success, deadline rejection, private archive and
  unplug completion, and forged private binding rejection.
