# ADR 0045: Already-terminal refresh recognition

- Status: accepted for v0.9 implementation
- Date: 2026-09-04
- Refines: ADR 0040 long-lived coordinator refresh

## Context

Refresh may select a source that was already closed or abandoned before the
handoff is prepared. Treating that source as if refresh had abandoned it
required the refresh-specific abandonment reason and reused the source's old
terminal timestamp as `source_retirement.retired_at`. The latter violates the
handoff chronology, which correctly requires a refresh transition to occur at
or after preparation.

## Decision

The authenticated source status captured in the immutable handoff decides the
retirement method. An `active` source must remain unchanged until refresh
abandons it through the source snapshot, and its terminal evidence must carry
the exact refresh reason. A source captured as `closed` or `abandoned` is not
abandoned again; it is recorded with method `already-terminal` only after its
source namespace and terminal status are revalidated unchanged.

`source_retirement.retired_at` records when this refresh recognizes and
records retirement, not when the source originally became terminal. The
source snapshot remains authoritative for its original terminal timestamp and
reason. This keeps handoff chronology honest without rewriting predecessor
evidence.

## Consequences and guardrails

Terminal-source identity or tree drift after preparation fails closed. A
terminal source's pre-existing abandonment reason is accepted only for the
`already-terminal` method; the refresh-specific reason remains mandatory for
`snapshot-abandon`. Focused refresh tests cover a selected pre-abandoned
source and source-state drift before apply.
