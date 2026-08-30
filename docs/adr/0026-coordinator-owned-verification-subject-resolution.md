# ADR 0026: Coordinator-owned verification subject resolution

## Status

Accepted for v0.6.3.

## Context

A native Codex project worktree can leave the coordinator checkout detached.
An accepted no-change receipt, however, names the executor's reserved branch.
v0.6.2 passed the coordinator checkout itself to combined verification, so its
exact-branch guard correctly rejected the detached checkout. Running the same
command from the executor worktree also correctly failed because ADR 0023
reserves lifecycle-journal mutation for the coordinator, apart from narrowly
authenticated release acceptance and callback delivery.

The result was a deadlock: both executor lanes could pass and the quiet
callback could be authentic, but no caller could persist the required
no-change verification record.

## Decision

- The coordinator remains the sole authority that invokes and persists
  combined verification. `verification run` does not gain linked-worktree
  mutation authority.
- For a no-change receipt, the coordinator resolves the verification subject
  through the accepted release and its matching visible-task creation record.
  The subject is the exact persisted host-observed executor worktree, not the
  coordinator checkout and not a caller-supplied path.
- Subject resolution authenticates release/receipt identity, ready task,
  operation, contract, coordinator binding, Git common directory, and exact
  persisted worktree path. The existing verifier still requires the receipt's
  exact final revision, named executor branch, and clean state before and after
  running checks.
- Integration-scoped verification keeps its existing reconciled-main subject
  contract. This checkpoint changes only accepted no-change verification.
- No receipt, release, creation, disposition, or verification schema field is
  added. Existing content-addressed evidence already identifies the subject.

## Rejected alternatives

- Permit `verification run` from any linked worktree sharing the Git common
  directory. Shared storage does not grant coordinator mutation authority.
- Weaken or ignore the receipt branch check for detached coordinators. That
  would verify a different checkout than the executor result names.
- Move or attach the coordinator checkout to the executor branch. That mutates
  host-managed Git topology and conflates coordination with execution.
- Add a caller-provided verification path or duplicate it into the terminal
  receipt. The authoritative host-observed path already exists in creation
  evidence and must not be overridden downstream.

## Consequences and guardrails

A detached coordinator can finalize an accepted no-change result while checks
run in the exact pristine executor worktree. Direct linked-worktree
verification remains rejected. Regression coverage proves the successful
detached-coordinator path and fails closed for missing, alternate, dirty, or
wrong-branch subjects before a verification record is written.
