# ADR 0031: Clean-start and unplug boundary

## Status

Accepted for v0.7.1.

This refines ADR 0029's post-acceptance local-journal cleanup boundary without
restoring predecessor runtime authority.

## Context

v0.7 intentionally refuses activation when incompatible retained Flow state is
present. That preserves the clean authority boundary, but a user may need to
retire local state after its tasks are finished. Treating that need as ordinary
cleanup or a predecessor migration would either risk deleting live task
evidence or reintroduce old schemas and runtime behavior.

## Decision

- `unplug` is automatically discoverable and operates on exactly one named
  repository and its Git common directory.
- It creates a read-only, exact local plan first. The plan identifies owned
  Flow paths and tasks that must be reconciled and archived through the App.
- Applying the unchanged plan requires explicit user approval. Archive
  reconciliation precedes local deletion and is bound as structured evidence
  to every exact task ID; ambiguity or a changed plan blocks application.
- Before any local Git mutation, apply persists an exact phase journal under
  the Git common directory but outside `.git/codex-flow`. New activation is
  blocked while that marker exists. Resume proves every completed action's
  postcondition and every pending action's exact precondition.
- Apply may remove only exact planned Flow state, an authenticated registered
  tracked-clean linked worktree in the same Git common directory, and an exact
  unprotected local `codex/*` branch already ancestral to the authenticated
  base. Ignored artifacts are allowed; dirty or ordinary-untracked worktrees,
  unmerged or attached branches, protected resources, remote state, and drift
  block. Only namespaces bound by the plan may be removed. All `codex-flow`
  state is deleted last; both it and the crash journal must have zero residue.
- It does not parse or migrate predecessor workflows, execute predecessor
  code, create a new run, delete remote refs or tags, or change source history.
  App-plugin uninstallation is optional and separately authorized after
  repository cleanup succeeds.

## Rejected alternatives

- Automatically delete incompatible state during run activation. Activation
  does not establish ownership of retained state and cannot authorize its
  removal.
- Reuse historical retirement commands. They depend on version-specific
  schemas and turn a clean-start operation into predecessor compatibility.
- Treat task completion or a successful archive setter response as enough to
  delete state. Local cleanup waits for reconciled archived observation.
- Remove a branch or worktree by name alone. Exact authenticated registration,
  current Git proof, and the local eligibility checks are all required.
- Uninstall the App plugin as part of repository cleanup. Plugin scope and
  repository scope are different user decisions.

## Consequences

The current package remains predecessor-free while users have an explicit path
to a clean start. The operation is deliberately approval-gated, local-only,
and evidence-preserving until its exact deletion step.
