# ADR 0044: Monotonic terminal selector evidence

- Status: accepted for v0.9 implementation
- Date: 2026-09-04
- Refines: ADR 0024 terminal callback admission authority

## Context

The v0.9 live RC canary proved that first-turn execution can finish before the
coordinator records a provisional Codex App creation result. Callback admission
correctly accepted a terminal receipt whose configured and requested selectors
matched launch authority and whose accepted and observed fields were null. The
later one-shot App reconciliation enriched the launch with accepted selectors.
Disposition then compared the immutable receipt with the enriched launch
byte-for-byte and deadlocked a valid result.

The failure was in Flow's temporal provenance rule, not App identity recovery.
The executor start claim had already authenticated the real task and Git
activation. Rewriting the receipt or weakening creation identity would hide the
race instead of fixing it.

## Decision

Terminal selector evidence is monotonic across callback admission and later
revalidation:

- configured and requested selectors must always exactly match task and launch
  authority;
- a null accepted or observed terminal value means that evidence was unavailable
  to the executor and remains valid if the one-shot App reconciliation later
  adds matching authority;
- a non-null terminal value requires the same non-null value in launch authority;
  terminal evidence may never lead or contradict authoritative evidence; and
- App reconciliation remains restricted to selectors compatible with the
  original request.

No receipt correction path, mutable callback, retry, or evidence state machine
is introduced.

## Consequences and guardrails

Callback admission remains fail-closed against invented or contradictory model
claims, while a lawful later evidence enrichment cannot invalidate an immutable
receipt. The full lifecycle suite must exercise callback delivery before App
result reconciliation and then complete disposition. A separate negative check
proves that a receipt cannot claim accepted evidence while launch authority is
still null.
