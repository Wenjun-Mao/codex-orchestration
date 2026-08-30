# ADR 0023: Codex App provisional and linked-executor authority

## Status

Accepted for the v0.6.1 development boundary.

## Context

Codex App may return a provisional task identity such as
`client-new-thread:<uuid>` before the ready task ID exists. The v0.6 journal
incorrectly validated that host-owned value with the repository's path-safe
internal-ID grammar, even though it is persisted only as JSON evidence and
compared for exact equality. A valid host response therefore could not be
recorded without changing or discarding the value.

Release acceptance also entered the same active-run mutation guard as
coordinator-owned operations. That guard required the caller's Git root to be
the coordinator checkout. A valid host-created linked executor worktree shares
the authenticated Git common directory but necessarily has a different root,
so the executor could not accept its release from the worktree it was assigned.

An executor can also load a plugin bundle different from the immutable bundle
captured by its run. The content-addressed snapshot is the intended recovery
authority, but the failure did not identify both bundle digests or give the
exact safe retry command.

## Decision

- Persist `provisional_client_thread_id` verbatim as nonempty bounded opaque
  host evidence. It is never used as a path, filename, branch, lock, or
  repository-owned identifier. Ready task IDs retain their existing grammar.
- Coordinator-owned mutations continue to require the exact coordinator Git
  root. Only `release accept` may enter the mutation guard from a linked root.
- Before accepting, `release accept` authenticates the exact worktree path
  persisted in host-observed creation evidence, the shared Git common
  directory, exact task baseline, pristine state, recorded executor branch,
  and active run branch reservation. Its cleanliness check forces complete
  untracked-file reporting instead of trusting repository Git configuration.
- Acceptance requires the run-bound runtime bundle. A differing executing
  bundle fails without recording acceptance and reports its digest, the bound
  digest, the runtime-context digest, and one shell-safe command that replays
  the same request through the immutable snapshot CLI.
- No release-record or terminal-receipt field is added. Existing creation,
  runtime, workflow, and Git evidence already carries the required authority.

## Rejected alternatives

- Normalize, hash, or invent a path-safe provisional ID. That destroys exact
  host evidence and weakens later correlation.
- Relax root equality for every active-run mutation. Executors do not gain
  coordinator authority merely because they share a Git common directory.
- Accept any linked worktree with the same common directory. It does not prove
  task ownership, baseline, cleanliness, or branch reservation.
- Trust the currently installed plugin when it differs from the run. Run
  semantics are fixed by the immutable content-addressed snapshot.
- Expand the release schema with duplicated worktree or bundle fields. The
  authoritative evidence is already linked by release operation and run ID.

## Consequences and guardrails

Canonical Codex App provisional IDs can be journaled without transformation.
Executors can accept from their real linked worktrees while all other mutation
surfaces keep coordinator-root authority. Focused regressions cover the host's
colon-bearing provisional syntax, wrong-checkout, wrong-branch, wrong-baseline,
configuration-hidden dirt, and coordinator-only mutation rejection. The
runtime regression executes the exact printed recovery command, including a
shell-sensitive request path, before successful snapshot-bound acceptance.

Existing v0.6.0 snapshots remain immutable and independently executable. This
source change begins `0.6.1-dev.0`; installation, publication, and migration
remain separate explicit checkpoints.
