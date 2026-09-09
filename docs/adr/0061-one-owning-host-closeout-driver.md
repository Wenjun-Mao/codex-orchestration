# ADR 0061: One owning-host closeout driver

- Status: accepted for v0.9.10
- Date: 2026-09-08

## Context

`closeoutIterationWithOwningHost` is the production path used by CLI and
assignment acceptance. The separate `closeoutIteration` embedded a second host
archive/reclaim loop; repository search found it only in
`assignment-lifecycle-v097.test.mjs`. The private package has no declared
library export surface, while its declared integration surface is the CLI.

## Decision

Remove the unused runtime driver. Tests exercise the owning-host protocol's
explicit prepare → host result → archived observation → reclaim sequence. The
reporting-only fixture now creates a direct coordinator run and one coordinator
worktree, rather than also creating a live executor and its worktree.

The removed legacy cases map to retained coverage as follows:

| Legacy protection | Owning-host replacement |
| --- | --- |
| Child-first ordering, exact executor result and branch cleanup | `owning-host child closeout prepares one exact App action and completes the run archive` |
| Ambiguity/no replay and archive completion after interruption | `owning-host child closeout prepares one exact App action and completes the run archive`; `owning-host child closeout resumes archive completion before member completion` |
| Public/private archived observation and resumable reclamation | `owning-host child closeout reconciles already archived public and private observations`; `owning-host child closeout re-observes archive before resumed worktree removal` |
| Exact result preservation, including patch-equivalent integration | `authenticated patch-equivalent integration preserves exact executor reclamation` |
| Coordinator archive/reclaim before reporting retirement | `assignment acceptance reclaims an exact archived coordinator before retiring reporting` |
| Dirty worktree rejection | `owning-host closeout blocks dirty executor and coordinator work before any App action` |
| Concurrent closeout | `owning-host closeout reserves one exact action across concurrent callers` |
| Shared worktree and attachment drift rejection | `owning-host closeout rejects shared and drifted coordinator worktrees before reclamation` |

## Consequences and measurement

There is one runtime closeout transition implementation. The focused serial
file changed from the audit's 30 tests / 85.441 seconds of summed durations to
15 tests / 31.053 seconds wall time on Node v24.18.0 on the same local host.
This one implementation measurement is evidence of less repeated fixture work,
not a release performance guarantee. Real Git remains in every ownership,
integration, and reclamation test; no global cache, timeout change, or
concurrency increase was introduced.

## Addendum: automatic archive evidence establishes its own completion boundary

The same driver must not reuse entry-time state as the completion time after an
asynchronous archived observation. Automatic observation is validated and
reconciled against one clock sample taken after the observer resolves; this
keeps the record lifecycle ordered without treating an observed timestamp as a
clock source. Caller-supplied evidence retains the command-entry boundary.
Existing stale/future rejection, exact archive identity, no-replay and
reclamation authority remain unchanged. Deterministic executor and coordinator
regressions cover the shared path.
