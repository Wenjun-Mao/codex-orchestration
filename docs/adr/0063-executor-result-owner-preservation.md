# ADR 0063: Preserve executor results through their authenticated owner

- Status: accepted for v0.9.10 correction
- Date: 2026-09-09

## Context

Executor archive/reclamation previously required every executor tip to be an
ancestor of the inventory primary checkout. That applies the coordinator's
final delivery rule too early: a clean no-change executor is already preserved
by its launch source branch, and a mutating executor is already preserved by
its reconciled integration target. The RC2 live gate exposed the no-change
case after a successful host archive; the same archive projection discarded
the named integration target for both accepted integration outcomes.

## Decision

Keep the one owning-host closeout driver and select one exact preservation
owner at its existing archive-to-iteration boundary:

- An accepted no-change executor requires its launch `starting_branch` to
  descend from the recorded starting/baseline/final revision.
- An accepted `ancestor` or `patch-equivalent` executor requires the exact
  reconciled integration `main_branch` to descend from its reconciled target
  tip. Archive authority carries that persisted branch name forward.
- A coordinator still requires primary-checkout preservation.

The owner must be a present local ref, distinct from the disposable executor
branch. Missing, rewound, divergent, self-owned, dirty, shared, or drifted
state fails closed. Existing selector, receipt, verification, archive,
child-first, worktree, and non-force deletion guards remain unchanged.

## Consequences

Cleanup can finish a correctly archived executor on a newer coordinator
delivery branch without moving primary or replaying the host archive. The
existing run-independent closeout command remains the only RC2 recovery path;
no migration, predecessor reader, or special journal editor is introduced.

The correction is covered by real-Git no-change, ancestor, and
patch-equivalent delivery-branch topologies; missing/rewound owner refs,
executor-as-owner rejection, and an RC2-shaped completed-archive recovery.
The supporting rationale is the approved preservation-owner addendum and
stage-connection audit.
