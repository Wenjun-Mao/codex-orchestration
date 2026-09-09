# ADR 0062: Revalidate settled predecessors at fresh admission

- Status: accepted for v0.9.10
- Date: 2026-09-09

## Context

Refresh inspection could classify a precisely settled v0.9.7 coordinator as a
preserved predecessor and route a target runtime to `fresh`. Fresh `run
activate` then unconditionally rejected every foreign namespace, including that
same reconciled predecessor. The contradiction blocked installed operation and
suggested destructive unplugging despite valid preserved evidence.

## Decision

Refresh inspection and fresh admission share the existing exact
`reconcileSettledV097CoordinatorPredecessor` classification. Fresh admission
repeats that classification while holding the repository-wide run lock, before
it creates target runtime or workflow state. It permits only namespaces that
the existing proof reconciles; inactive, active, malformed, contradictory, or
unsupported predecessors remain blockers. The predecessor is read-only and is
not migrated, removed, or otherwise rewritten.

## Consequences and guardrails

There is no caller-supplied bypass or generic inactive-namespace exception.
The CLI regression proves `inspect=fresh` then `run activate` succeeds against
the exact settled fixture, preserves predecessor lifecycle and report bytes,
and fails closed when accepted-report evidence is missing. Existing missing
preserved-ref coverage continues to reject changed predecessor evidence.

