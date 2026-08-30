# ADR 0035: Detached host-worktree bind checkpoint

## Status

Accepted for the v0.7.5 development checkpoint.

## Context

v0.7.4 reconciles the path of a host-created detached worktree and can prepare
an at-most-once objective release from a `ready-unreleased` task. It does not
durably attach that worktree to the reserved executor branch. The first live
branch check is therefore `release accept`, after the objective may already
have been sent. ADR 0008 and the accepted v0.5.1 lifecycle require the opposite
ordering: journal exact bind intent, mutate Git, authenticate the result, and
only then permit objective release.

## Decision

Add the coordinator-owned `task create bind --run-id ... --file ...` transition.
Its request contains `operation_id` and optional `bound_at`. It is valid only
for a ready-unreleased host-worktree creation with an observed path and the
exact active run branch reservation.

The visible-task creation record gains a content-addressed
`worktree_binding`. Under the operation and reserved-branch locks, bind
authenticates the canonical observed path, Git common directory, pristine
baseline, linked-worktree inventory, active run/runtime coordinator repository
root, source-branch baseline, and absence of local or fetched remote branch
collisions. The observed executor path must differ from the exact coordinator
root even when the coordinator itself is a linked worktree; the primary source
checkout remains excluded independently. Bind persists immutable `prepared`
intent before `git switch --no-track -c`, then rereads the path, branch,
revision, cleanliness, and inventory before recording `completed` authority.

An interruption before the branch switch resumes from the same prepared
intent while the worktree remains detached. An interruption after the switch
resumes only when that exact intent names the now-attached branch, path,
common directory, and baseline. An already attached branch without the exact
prepared receipt is not adoption authority. Wrong branches, competing
attachments, collisions, dirt, and path/common-directory/baseline drift fail
closed. `prepared_at` remains the immutable intent time. `bound_at` and the
creation record's `updated_at` use the command time that actually completes or
recovers the transition, may not predate `prepared_at`, and remain unchanged on
an exact completed replay.

`release prepare` requires and live reauthenticates completed binding before
it can persist or expose a sendable release. The release identity anchors the
content-addressed binding ID. `release accept` retains its independent exact
worktree, branch, baseline, cleanliness, runtime, and common-directory checks
as defense in depth.

Editable authority advances to `0.7.5-dev.0` and the new state/runtime
namespace is `.git/codex-flow/v0.7.5/`. Existing v0.7.4 state and content-
addressed runtime snapshots remain immutable under `.git/codex-flow/v0.7.4/`;
the new source does not migrate, reinterpret, delete, or overwrite them.

## Rejected alternatives

- Keep binding implicit until release acceptance. This permits objective
  dispatch before lawful execution can be authenticated.
- Attach first and persist afterward. A crash creates an unreceipted named
  branch that cannot be distinguished from foreign mutation.
- Accept any exact attached branch as recovery. Without prepared intent it is
  ambiguous adoption, not idempotent replay.
- Reuse the v0.7.4 namespace. That would make changed runtime semantics appear
  under accepted snapshot authority.

## Consequences and guardrails

- Ready host tasks remain unreleasable until binding completes.
- Release preparation fails before record persistence on missing or drifted
  binding authority, so at-most-once dispatch cannot get ahead of Git binding.
- Archive and cleanup derive host-managed worktree paths from completed
  binding rather than raw selector observation.
- Focused real-Git regressions cover detached bind through prepare/accept,
  unbound release rejection, both interruption windows and their chronology,
  exact replay, linked-coordinator isolation, dirty, attached, colliding, and
  foreign worktrees, and post-bind drift.
