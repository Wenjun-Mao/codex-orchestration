# ADR 0008: Host-provisioned worktree launch

## Status

Accepted for v0.4 pending held-out replay.

## Context

Codex Desktop creates a worktree during `create_thread(worktree)` and does not
reveal its path beforehand. The first v0.4 UK Dev pilot therefore could not
satisfy both prepare-before-host and the old requirement to name the executor
worktree before creation. Using the saved checkout as a placeholder would bind
and later clean the wrong branch.

## Decision

Replace ambiguous `worktree` packets with two explicit modes:

- `local` names an existing exact worktree and keeps strict pre-dispatch `HEAD`
  and cleanliness authentication.
- `host-worktree` names a saved repository plus an exact local starting branch.
  Prepare and attempt authenticate the branch tip, not the saved checkout's
  current branch or dirt.

A host-worktree launch is two-phase. The first host call receives a generated
bootstrap that contains no objective and forbids repository work. The
coordinator rereads the actual execution path, reconciles it as host-observed,
and binds Git ownership. Binding requires an exact pristine linked worktree in
the same common Git directory, on a named branch distinct from the source
branch and checkout, at the authenticated starting revision. Only then may the
coordinator generate and send the released full packet. Release repeats the
path, branch, revision, cleanliness, packet-hash, and ownership checks.

The package adds no daemon, reservation API, activation state, or compatibility
reader. Bootstrap and release are stateless authorization gates over the
existing operation and Git records. No host call runs while a filesystem journal
lock is held.

## Consequences

- Desktop can allocate its own worktree without weakening source or cleanup
  authority.
- A created task may remain idle if path observation or binding fails; doctor
  and cleanup audit report observed host worktrees without ownership for manual
  review.
- The saved checkout may contain unrelated user work because it is not the
  executor. The named starting branch and target worktree remain exact and
  clean.
- Task packet schema 3, task-operation schema 4, host capability schema 2, and
  host observation schema 2 intentionally reject the superseded shapes.

## Guardrails

Tests cover premature or replayed bootstrap/release, branch drift, missing path
support, source-checkout reuse, unrelated repositories, pre-bind dirt, and
post-bind drift. A fresh real Desktop pilot is still required before default
adoption.
