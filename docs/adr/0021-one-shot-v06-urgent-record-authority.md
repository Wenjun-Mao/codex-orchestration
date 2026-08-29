# ADR 0021: One-shot v0.6 urgent-record authority

## Status

Accepted for v0.6.

## Context

Urgent blocker, approval, and high-risk-drift delivery is the only plugin path
allowed to interrupt a working coordinator. The accepted v0.5 journal supports
multiple explicitly reasoned delivery attempts. The v0.6 mission and workflow
contract instead promise one persisted signal and one bounded native direct
attempt, with host replay suppressed against the same identity.

Reusing the retry-capable v0.5 record validator as v0.6 authority would permit
a stored second attempt even though the public v0.6 CLI always requested
attempt sequence one. Runtime guidance, public behavior, durable state, and run
closure would then disagree.

## Decision

- The stable urgent-signal payload schema is shared input authority for v0.5
  and v0.6. v0.6 adds a closed `urgent-record-v06` schema for its durable
  journal.
- A v0.6 urgent record contains at most one attempt. Its sequence is exactly
  one and `retry_reason` is null.
- v0.6 urgent operations validate the stored record before and after each
  transition. A retry-capable or malformed record fails closed.
- The public v0.6 CLI and terminal run audit use only the v0.6 facade and record
  validator. Historical v0.5 commands and the accepted v0.5.1 tag retain their
  existing retry-capable implementation.
- Replaying the same host delivery does not create another attempt. Recipient
  observation counts the replay and suppresses duplicate coordinator action.
- An ambiguous or rejected first host call never authorizes another direct
  attempt in v0.6.

## Rejected alternatives

- Rely on the CLI hardcoding attempt sequence one. Direct module use or retained
  retry-capable records would still bypass the durable contract.
- Remove retry support from the shared legacy module. That would silently
  rewrite accepted v0.5.1 behavior.
- Treat every host replay as a new attempt. Replay is transport duplication,
  not fresh user or workflow authority.

## Consequences and guardrails

- The active schema graph compiles both the shared signal payload and the
  v0.6 one-shot record.
- Schema/runtime parity, public CLI persistence-through-consumption, replay,
  ambiguity, and legacy-isolation tests guard the boundary.
- Any future retry policy requires a separately versioned record/decision; it
  cannot be introduced by adding another host call to the current journal.
