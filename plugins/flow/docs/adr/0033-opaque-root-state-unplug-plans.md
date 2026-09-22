# ADR 0033: Opaque root state in unplug plans

## Status

Accepted for v0.7.3.

This refines ADR 0031 without making retained predecessor evidence readable as
current runtime authority.

## Context

Some repositories legitimately retain bounded Flow evidence files directly
under `.git/codex-flow/` alongside versioned namespace directories. The v0.7.2
unplug planner assumed every root entry was a directory and therefore failed
before it could produce a reviewable plan. Manual deletion or a tolerant v0.7
activation reader would weaken the clean-start boundary. Replacing the plan
format without an apply-only compatibility path would also strand an approved
v0.7.2 plan or its crash-resume journal.

## Decision

- New unplug plans use schema v2 and bind ordered `state_entries`. A
  `namespace-directory` carries its exact root-child path and authenticated
  tree digest. An `opaque-file` carries its exact root-child path, byte length,
  and byte digest.
- Opaque files are never parsed, imported, migrated, or treated as current
  runtime authority. Only namespace directories receive the minimal
  `runs/lifecycle.json` active-run check.
- One aggregate bound covers root entries, descendant files, bytes, and depth.
  Unsafe names, non-root paths, symlinks, special files, duplicate identities,
  type substitutions, content drift, and unplanned additions fail closed.
- Apply removes only the unchanged authenticated entry kind: regular files
  non-recursively and namespace directories recursively. The state root is
  removed last and must be empty. Global state and active-run authority are
  rechecked immediately before every entry deletion; the existing approval,
  archive, Git-safety, journal, and zero-residue requirements remain unchanged.
- v0.7.3 emits only v2 plans. It retains exact v1 validation, directory-only
  inventory, re-plan, apply, and resume behavior so an already approved v0.7.2
  operation can finish under the upgraded package. V1 cannot admit opaque root
  files or authorize a v2 plan. The shared journal remains safe because it
  binds the exact plan ID and state digest.
- Activation remains strict and does not learn this opaque inventory format.
  Retained incompatible root entries still require a clean start through
  `unplug`.

## Rejected alternatives

- Ask each repository to delete or rename retained evidence manually. That
  bypasses exact path and digest review.
- Treat opaque files as task, worktree, or branch resources. They have no App
  or Git lifecycle and belong only to local state deletion.
- Parse legacy JSON to classify or migrate it. Unplug needs deletion authority,
  not predecessor protocol authority.
- Accept changed entry types or arbitrary root residue during apply. That would
  broaden an approved deletion after the fact.

## Consequences

Repositories with mixed historical Flow layouts can obtain a fail-closed,
user-approvable clean-start plan. The current runtime remains predecessor-free,
and interrupted v0.7.2 unplug operations remain lawfully resumable.
