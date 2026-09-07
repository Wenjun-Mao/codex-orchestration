# ADR 0055: Exact archived-worktree reclamation

- Status: accepted for v0.9.7
- Date: 2026-09-07
- Authority: approved v0.9.7 exact-worktree-reclamation addendum
- Supersedes in part: ADR 0036's host-only reclamation rule
- Refines: ADR 0054

## Context

The v0.9.7 zero-child canary completed useful work, reported through the real
hook, and was accepted and archived through the native App boundary. Exact
private observation proved one canonical archived session and no active
session. Its clean detached worktree and captured commit nevertheless remained
registered after App restart. The App contains a separate old-worktree pruner,
but neither its protocol nor public documentation establishes archival or
elapsed time as a reclamation trigger.

Iteration closeout therefore had sufficient exact authority to identify and
preserve the work but no operation that could complete physical reclamation.
Waiting was not a correctness mechanism, and manual deletion would bypass the
persisted closeout contract.

## Decision

An accepted iteration archive attempt is also the persisted cleanup intent for
that exact member, path, attachment, and captured tip. When the worktree is
still present, command-managed closeout obtains fresh authenticated
archived/no-active evidence, then re-reads the unchanged intent under the
iteration lock before crossing the Git mutation boundary.

Flow may run non-force `git worktree remove` only after it verifies:

- one exact non-retained assignment or launch member and no other persisted
  iteration member sharing the canonical worktree;
- a canonical live path in the same Git common directory, with one unchanged
  registered attachment;
- a clean worktree, including no untracked files, at the captured commit and
  expected named branch or truthful detached state;
- the accepted executor result when applicable, and captured-tip ancestry in
  the authenticated primary checkout;
- separation from the primary and command caller checkouts; and
- one exact archived task session with no active session immediately before
  reclamation.

Git refusal remains a failure; Flow never adds `--force`. After verified
worktree absence it may delete only an unchanged, unattached local `codex/`
branch at the captured tip. Detached membership grants no branch authority.
Remote refs and unrelated resources are never mutated.

Unrelated Git worktree records marked `prunable` are not live attachments and
are excluded from moved-owner detection. Closeout neither enters nor removes
those stale paths; their maintenance remains outside iteration authority.

If interruption occurs after worktree removal, the persisted accepted attempt
allows the next closeout call to reconcile absence and finish exact branch
cleanup without replaying archival. Reporting is retired only after the
iteration actually reaches closed.

## Rejected alternatives

- Continue waiting for an undocumented App cleanup trigger. No bounded event
  was established that would make waiting causal.
- Change the global App auto-delete setting or add a polling daemon. Both widen
  authority and still fail to make archival and reclamation one transaction.
- Add a second cleanup registry. The iteration member and accepted archive
  attempt already contain the exact durable identity needed at the boundary.
- Force-remove dirty or drifted worktrees. Refusal is evidence that the saved
  authority no longer matches, not permission to discard state.
- Re-run the native archive setter. Accepted or ambiguously delivered archive
  calls retain their at-most-once contract.

## Consequences and guardrails

Archive visibility, worktree reclamation, and branch cleanup remain distinct
facts, but host reclamation is no longer the only lawful source of physical
absence for an accepted iteration member. Historical archive records and
non-iteration cleanup retain their original semantics.

Real-Git regressions cover named executor/coordinator cleanup, detached
coordinator cleanup without branch deletion, shared-path, caller/source,
dirty, attachment-drift, captured-tip and preservation rejection, host-already-
removed state, interruption after removal, unrelated prunable records left
untouched, and archive no-replay. The accepted zero-child and child-first App
canaries remain release gates.
