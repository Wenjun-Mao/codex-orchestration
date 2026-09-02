# ADR 0039: Runtime-owned visible-task clocks

## Status

Accepted for v0.7.8.

## Context

The public `task create` CLI accepted optional caller-authored timestamps for
prepare, attempt, reconciliation, and worktree binding. Those values became
authoritative lifecycle boundaries even though the caller could not know the
exact time at which each runtime transition would complete.

The v0.7.8 live candidate exposed the failure directly: a coordinator rounded
an attempt time into the future, the real Codex App `create_thread` event then
preceded the persisted attempt boundary, and the private resolver correctly
rejected otherwise matching host evidence. Static CLI tests had supplied fixed
phase clocks, so they proved deterministic serialization without exercising
real host-event ordering.

## Decision

The visible-task creation runtime owns its prepare, attempt, reconciliation,
and binding clocks. Public `task create` requests reject `prepared_at`,
`attempted_at`, `reconciled_at`, and `bound_at`; each transition records the
runtime wall clock when it executes. The lower-level library retains explicit
`now` injection for deterministic module tests, not as public coordinator
authority.

Private resolution continues to carry exact authenticated host-event
timestamps. Its emitted reconciliation request omits a transition
`reconciled_at`, so the documented instruction to submit that request unchanged
cannot reintroduce a caller-owned lifecycle clock.

This decision is limited to visible-task creation, where the attempt clock is a
security-relevant admission boundary for a subsequent native host event. It
does not weaken or replace exact host-event timestamps and does not broaden the
private resolver.

This supersedes only ADR 0035's allowance for a caller-supplied optional
`bound_at`; its durable worktree-binding intent, recovery, and verification
contract remains unchanged.

## Rejected alternatives

- Document that coordinators should use the current time. A valid request could
  still encode a future or stale boundary, and static tests would not prevent
  recurrence.
- Permit bounded clock skew. Any allowed forward skew can still place the real
  host event before the attempt boundary.
- Accept but ignore caller clocks. Silent reinterpretation would conceal a
  contract error and make persisted evidence harder to audit.
- Relax the resolver's event-window check. That would admit events that did not
  occur during the one-shot attempt and undermine the creation contract.

## Consequences and guardrails

- Callers that submit any removed phase-clock field fail before mutation.
- A native creation call necessarily follows the persisted runtime attempt
  boundary; delayed processing remains safe because host-event time is separate
  evidence under ADR 0038.
- Run-bound predecessor runtimes and their persisted records are unchanged.
- CLI tests exercise real transition ordering and reject all four removed
  fields; module tests retain deterministic injected clocks.
