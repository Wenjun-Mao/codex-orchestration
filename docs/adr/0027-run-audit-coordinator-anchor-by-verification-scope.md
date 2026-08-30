# ADR 0027: Run-audit coordinator anchor by verification scope

## Status

Accepted for v0.6.4.

## Context

v0.6.3 correctly moved accepted no-change verification from the coordinator
checkout to the exact persisted executor worktree. After that task was
archived, the host correctly removed its managed worktree. The terminal run
audit nevertheless selected the latest PASS verification as the expected live
coordinator Git state, regardless of verification scope. It therefore compared
the detached coordinator checkout with an archived executor path and reported
`repository-drift`, even though both roles had completed their contracts at the
same clean revision.

This was a projection error in run closure. No-change verification proves the
executor's terminal result. Integration-scoped verification proves the exact
coordinator repository candidate that the integration lifecycle may reconcile.
Those proofs must remain authoritative without being treated as
interchangeable Git subjects.

## Decision

- Every authoritative PASS verification remains part of the task lifecycle,
  disposition, archive, and closure source evidence.
- Only a PASS verification with a non-null `integration_scope` may advance the
  run audit's expected live coordinator Git anchor.
- When no integration-scoped PASS verification exists, the coordinator remains
  anchored to the immutable activation repository root, revision, branch, and
  Git common directory.
- No schema, receipt, verification, archive, or cleanup record changes.

## Rejected alternatives

- Keep the archived executor worktree present until run closure. Archive owns
  host-managed worktree retirement and must be able to prove it absent.
- Compare only revisions while ignoring root or branch. That would weaken real
  coordinator drift detection.
- Copy the no-change verification onto the coordinator checkout. That would
  misrepresent which repository subject the checks actually exercised.
- Add another closure receipt or evidence state machine. Existing verification
  scope already distinguishes the two authorities.

## Consequences and guardrails

An archived no-change task can close while its executor worktree is absent and
its exact cleanup plan is complete. Coordinator dirt, revision drift, root
drift, or branch drift still blocks closure against the activation baseline.
Integration-scoped verification continues to anchor the coordinator at the
reconciled main state. Regression coverage keeps no-change and integration
paths distinct and preserves exact cleanup and archive gates.
