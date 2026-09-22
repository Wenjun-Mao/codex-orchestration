# ADR 0034: Host-managed turn-diff refs in unplug identity

## Status

Accepted for v0.7.4.

This refines ADR 0031's exact repository identity without weakening its
source, resource, state, or deletion authority.

## Context

Codex App records turn-diff captures under `refs/codex/turn-diffs/`. A new
capture can be created while an approved unplug plan moves through another App
turn. v0.7.3 included every Git ref in the plan's repository digest, so this
host evidence changed the regenerated plan ID even when HEAD, branch, status,
worktrees, cleanup resources, and all planned Flow state were unchanged. The
approved apply consequently failed before any mutation and could not become
stable across App turns.

These capture refs are neither user source refs nor cleanup targets. Treating
them as repository authority made the exact-plan gate depend on host activity
that the operation does not inspect, preserve, or remove.

## Decision

- Unplug excludes only the case-sensitive namespace
  `refs/codex/turn-diffs/` from the authoritative ref inventory used by the
  repository digest and plan ID.
- The excluded refs remain host-managed observations. They are not persisted
  in the plan, interpreted as Flow state, or admitted as cleanup resources.
- Every other ref remains authoritative, including local heads, `codex/*`
  branches, remotes, tags, other `refs/codex/*` namespaces, case variants, and
  lookalike prefixes. Changes to those refs continue to invalidate a newly
  approved plan before mutation.
- HEAD, branch, status, registered worktrees, primary-worktree identity,
  planned resource tips, Git common directory, and exact Flow-state bytes keep
  their existing independent checks. Planned worktree and branch resources
  continue to be revalidated during apply and crash resume.
- Regression coverage proves that adding an exact host turn-diff ref preserves
  the plan and permits apply, while ordinary and lookalike refs still cause
  exact-plan drift.

## Rejected alternatives

- Ask users or pilots to delete Codex App capture refs. Those refs are
  host-managed and may be recreated by the next turn.
- Exclude all `refs/codex/*` or pattern-match `turn-diffs` loosely. That could
  hide unrelated or user-controlled refs from the approved repository identity.
- Accept any changed Git digest when other summary fields look unchanged. That
  would tolerate source or cleanup-resource drift instead of classifying one
  known non-authoritative namespace.
- Add capture refs to the unplug plan as cleanup resources. Unplug neither owns
  nor deletes them, so doing so would invent authority over host evidence.

## Consequences

An exact unplug plan can survive ordinary Codex App approval turns without
losing fail-closed protection for source refs, cleanup resources, worktrees, or
state. The exception is intentionally narrow and does not make arbitrary Git
ref drift acceptable.
