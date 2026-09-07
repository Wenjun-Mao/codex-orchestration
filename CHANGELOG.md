# Changelog

This file records concise user-facing changes. Immutable tags and the linked
decision records remain the detailed release evidence.

## 0.9.7 - 2026-09-06

- Keep coordinator reporting valid for its assignment after execution-run
  closure or namespace removal, while preserving per-turn deduplication and
  fail-closed native queue semantics.
- Let assignment preparation derive and validate immutable approved-plan
  snapshots from a readable source path, including uncommitted approved plans,
  without model-supplied hashes or commits.
- Add truthful coordinator-local workflow claims with executed verification
  for both mutations and verified no-change results.
- Add command-managed iteration membership, generated coordinator briefs, and
  acceptance-triggered, resumable native task archival. Executor launches use
  the same role/iteration/purpose title recorded by the registry; child-first
  closeout atomically claims each native call, consumes exact Git authority,
  deletes authenticated disposable executor and coordinator branches after host
  worktree reclamation, rejects coordinator work not yet preserved in the
  protected source checkout, observes already-archived coordinators without a
  duplicate host call (including after a blocked/no-archive result), and never
  replays an ambiguous archive call.
- Bind an assignment's exact replacement execution during authenticated refresh
  before consuming the handoff or deleting the source namespace; exact retries
  are idempotent and conflicting or stale transitions fail closed.
- Preserve one director recipient binding across sequential coordinator
  assignments instead of conflating a fresh sender run's execution fence with
  the recipient lineage fence, including exact current recipient generations
  beyond the initial generation.
- Close out host-created detached coordinator worktrees by preserving their
  exact commit and archiving the task without fabricating branch-deletion
  authority; attachment drift, dirt, protected paths, and unpreserved commits
  still fail closed.

## 0.9.6 - 2026-09-06

- Allow an authenticated terminal direct-coordinator source with no launch
  resources to refresh into a replacement run without inventing cleanup
  authority; malformed or resource-bearing launch evidence still fails closed.
- License the source under MIT and add public contribution and security entry
  points.
- Document current coordinator routing, authenticated quiet reporting, reload
  requirements, and same-local-host limits.

## 0.9.5 - 2026-09-06

- Added authenticated report-locator retirement and recovery.
- Added a lean Terra-high route for settled bounded coordinator delivery while
  preserving Sol-high for systemic coordination.

Earlier release history is available in the repository's immutable tags and
`docs/adr/`.
