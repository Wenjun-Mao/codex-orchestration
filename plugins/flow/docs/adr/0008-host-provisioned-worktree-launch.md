# ADR 0008: Host-provisioned worktree launch

## Status

Accepted for v0.4 pending held-out replay.

## Context

Codex Desktop creates a worktree during `create_thread(worktree)` and does not
reveal its path beforehand. It also creates that worktree detached at the
selected revision. The first two v0.4 UK Dev pilots exposed these facts in
sequence: pre-dispatch path ownership could not name a future path, and the
first two-phase bind could not require Desktop to supply a named branch. Using
the saved checkout or manually attaching an unrecorded branch would weaken
later ownership and cleanup.

## Decision

Replace ambiguous `worktree` packets with two explicit modes:

- `local` names an existing exact worktree and keeps strict pre-dispatch `HEAD`
  and cleanliness authentication.
- `host-worktree` names a saved repository, an exact local starting branch, and
  a distinct executor branch that is absent locally and from fetched
  remote-tracking state. Prepare and attempt authenticate both the source tip
  and branch-name availability, not the saved checkout's current branch or dirt.

A host-worktree launch is two-phase. The first host call receives a generated
bootstrap that contains no objective and forbids repository work. The
coordinator rereads the actual execution path, reconciles it as host-observed,
and binds Git ownership. Binding requires an exact pristine linked worktree in
the same common Git directory at the authenticated starting revision. A
detached worktree is attached under the exclusive bind lock to the
packet-declared executor branch only after the branch is rechecked as available
and an immutable operation/path/branch/baseline claim receipt is persisted.
Every unreceipted named branch is rejected. If binding is interrupted after the
Git mutation, only that exact receipt can authorize recovery. Binding then rereads the
path, branch, revision, cleanliness, canonical inventory, packet hash, and
ownership before the coordinator may send the released full packet.

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
- An incomplete branch claim blocks the next task wave until binding is safely
  resumed or the coordinator explicitly reconciles the retained evidence.
- The saved checkout may contain unrelated user work because it is not the
  executor. The named starting branch and target worktree remain exact and
  clean.
- Task packet schema 4, task-operation schema 5, host capability schema 2, and
  host observation schema 2 intentionally reject the superseded shapes.
- The two packet schemas carry the `x-codex-flow-distinct-properties`
  annotation for branch inequality. Codex Flow runtime/source validation is the
  enforcement authority because standard JSON Schema cannot compare sibling
  string values.

## Guardrails

Tests cover premature or replayed bootstrap/release, branch drift and
collisions, detached claim, unexpected named branches, missing path
support, source-checkout reuse, unrelated repositories, pre-bind dirt,
post-claim interruption recovery, and post-bind drift. A fresh real Desktop
pilot is still required before default adoption.
