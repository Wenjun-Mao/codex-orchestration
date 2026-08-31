# ADR 0036: Asynchronous archive worktree reclamation

## Status

Accepted for the v0.7.6 development checkpoint.

## Context

Codex App archive is a background host operation. In a held-out v0.7.4 run,
the archive calls succeeded and both tasks appeared in the archived-task
surface while their Codex-managed worktrees remained registered. The host
removed those worktrees later. The Flow archive record could represent either
an accepted setter awaiting any observation or a completed archive with an
absent worktree, but not the valid interval between them. Reconciliation
therefore failed with a claim that the already archived task had to remain
visible.

The worktree-absence gate itself is sound. Cleanup and run closure must not
advance while the exact host-managed path remains. The defect is the missing
intermediate state, not an overly strict terminal postcondition.

## Decision

Add `archived-awaiting-worktree-reclamation` to the existing archive lifecycle.
It durably records independently observed archived task visibility together
with `worktree_state: present`. The state reports `keep_visible: false` and
never authorizes another archive host call.

The same archive attempt and setter outcome may be reconciled again with the
same archived task observation. If the exact persisted worktree path remains,
the replay is idempotent. Once that path is absent, reconciliation advances to
`completed` with `worktree_state: absent`. Local tasks without a host-managed
worktree continue to complete with `not-applicable`.

Accepted and ambiguous setter outcomes may reach the pending state after exact
archived visibility. Rejected delivery, changed outcomes, mismatched task
identity, and a reappearing path after completion remain fail-closed. Run audit
and cleanup continue to require a completed archive and exact absence; neither
may delete or reclaim the worktree.

Editable authority advances to `0.7.6-dev.0` under
`.git/codex-flow/v0.7.6/`. Earlier runtime snapshots and journals remain
immutable and are neither migrated nor reinterpreted.

## Rejected alternatives

- Complete archive reconciliation while the managed worktree remains. This
  would weaken cleanup and closure authority.
- Replay `set-thread-archived`. Host acceptance is already authoritative and
  the external call remains at most once.
- Treat the task as visible until reclamation. Archived visibility and
  worktree presence are separate host facts.
- Add polling, a daemon, or a separate cleanup receipt. One state in the
  existing archive record represents the observed host transition directly.

## Consequences and guardrails

- Background host reclamation is a normal pending state rather than an error.
- Status distinguishes task visibility from worktree lifecycle truthfully.
- Reconciliation is explicit and idempotent; no retry loop or deletion power
  is introduced.
- Focused tests cover accepted and ambiguous delivery, repeated pending
  reconciliation, eventual absence, run-audit and cleanup blocking, and
  reappearance after completion.
