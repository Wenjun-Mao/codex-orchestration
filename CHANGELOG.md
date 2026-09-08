# Changelog

This file records concise user-facing changes. Immutable tags and the linked
decision records remain the detailed release evidence.

## 0.9.8 - 2026-09-08

- Read private archived JSONL evidence incrementally rather than retaining an
  entire task transcript, while preserving exact full-stream SHA-256 evidence
  and one canonical `session_meta` record.
- Bound archive observation by explicit byte, record-count, and record-size
  ceilings; descriptor and pathname identity checks now reject replacement,
  truncation, append, and swap-and-restore races during observation.

## 0.9.7 - 2026-09-07

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
- Reclaim an exact accepted iteration worktree after fresh archived/no-active
  evidence when the App leaves it registered. Closeout revalidates canonical
  path, exclusive membership, attachment, cleanliness, captured result tip, and
  primary preservation under the iteration lock, uses non-force Git removal,
  resumes safely after interruption, and never replays accepted archival.
- Prepare assignment closeout as an exact owning-host Codex App archive action,
  require fresh typed idle evidence, reconcile its bounded result without
  opening a competing App server, and complete the executor's existing run
  archive before member completion after reclamation. Already-archived tasks
  reconcile without an invented active state or setter replay. Exact
  verified patch-equivalent integration now preserves eligible executor cleanup
  without weakening the normal ancestry rule.
- Route delivery owners by the hardest expected judgment: Terra-high for
  settled routine delivery, Terra-xhigh for bounded demanding work, and Sol-high
  for unsettled architecture or difficult authority/integration decisions,
  independently of child count.
- Allow an authenticated executor start to register its report route before
  the one-shot App creation result is reconciled, or when that result carries
  opaque host information, while still rejecting known conflicting host
  evidence.
- Treat replacement of the live personal-marketplace source as an installation
  event because the local marketplace watcher may synchronize its cache
  immediately; stage release candidates outside the watched source path and
  retain an exact rollback copy.

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
