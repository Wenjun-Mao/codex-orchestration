# ADR 0072: Validate coordinator committed transitions

## Context

Coordinator completion previously authenticated a clean descendant and passing
checks, but did not compare committed paths with either the task write set or the
admitted run envelope. Endpoint tree diffs also miss add-then-revert history,
rename sources, and coordinator overwrites hidden by filename subtraction.

## Decision

One committed-write-scope validator is used before coordinator completion is
persisted and again by run audit, including completed records produced by older
runtimes. It walks every reachable committed transition from the immutable
activation revision to the authenticated terminal revision and checks both path
component boundaries and rename source/destination paths.

Exact reconciled integration authority attributes child commits. Patch-equivalent
commits require matching stable patch identity inside the exact prepared-main to
reconciled-main interval; a matching patch before integration preparation is not
child authority, and a matching main commit simultaneously claimed by coordinator
work is ambiguous rather than silently credited to the child. Child history
begins at the Git merge base of the prepared main
and executor tips. A merge is child-attributed only when its tree matches Git's
automatic merge result. All remaining commits
must belong to exactly one coordinator-work baseline/final interval and remain
inside that task's write paths. Every transition, including child transitions,
must remain inside the run envelope. Gaps before local start or between operations,
ambiguous ownership, and manual merge resolutions fail closed.

Verification commands run before the final snapshot. Completion then rechecks
clean repository identity and validates scope against that new snapshot, so a
check cannot commit an unexamined successor revision.

## Consequences

- A later revert, including one hidden on a merged side branch, does not authorize
  an earlier out-of-scope commit.
- Legitimate no-change, in-scope coordinator work, exact child integration and
  patch-equivalent preservation remain valid.
- The check covers reachable committed history only. It cannot certify transient
  uncommitted writes or commits removed by rewritten/unavailable history.
- Scope noncompliance blocks completion/audit but does not prevent truthful safe
  retirement of failed or abandoned work.
- A candidate may audit an exact historical state root, but historical close is
  explicitly read-only and remains owned by that immutable runtime.
