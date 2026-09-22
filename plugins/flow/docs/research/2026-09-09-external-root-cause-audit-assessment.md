# Director assessment: external root-cause audit

Date: 2026-09-09

Status: Reviewed advisory input; not an implementation or release authorization.

## Evidence boundary

The original report is preserved unchanged in
[external-root-cause-audit.md](2026-09-09-external-root-cause-audit.md), byte-checked
against the supplied Downloads file. Its baseline is published v0.9.10
`21096a7ad7aca10221a90bcb1b404dbb0c89aacc`.

The director inspected the four cited implementation paths locally and the
source-only repair diff through `175f90328b6e618777c21b79057514792e38460f`.
Those repair commits change refresh classification and a reporter-version test,
not the four reported paths. No new failure-injection/concurrency tests, full
suite, browser consultation, or external model/cost-source verification was
performed for this assessment. Static support is not an executed reproduction.

## Disposition

| Insight | Decision | Local assessment |
| --- | --- | --- |
| Preserve Director/Coordinator/Executor responsibilities; optional workers | Use | Matches the valued availability outcome. Does not require another role or fixed staffing. |
| F1: local results missing from dependency consumption | Test | `workflow-journal.mjs` admits only disposition/subagent references and maps every non-task-thread dependency to subagent authority. Coordinator production exists but its consumer is missing. |
| F2: completion replay skips the second write | Test | `completeCoordinatorWork` writes completion before claim transition; completed-record return skips reconciliation and precedes coordinator identity checking. Test the public retry path, not only the helper. |
| F3: later-time start retry rejects unchanged authority | Test | `startCoordinatorWork` generates a fresh timestamp then compares the entire persisted record. Distinguish immutable identity, observations, and lawful progress. |
| F4: acceptance state read outside lock | Test | `acceptAssignmentResult` checks open state before a locked callback that unconditionally writes accepted; the updater validates shape/identity, not immutable accepted-report selection. Prove a deterministic interleaving. |
| Real producer-to-consumer journeys and successor admission | Use | Local-only, mixed delivery, and interrupted/failure journeys are acceptance boundaries, not a new harness. Fixtures must preserve meaningful execution-kind, topology, package-entrypoint, and temporal distinctions. |
| No wholesale state collapse or storage rewrite | Use | Different lifetimes are justified; duplicate decisions and unrecoverable dependent records are not. Choose one authoritative fact per transition and make other representations resumable. |
| New economic experiments/routing optimization | Park | Not needed to resolve reliability; do not restart frozen research or add measurement infrastructure during this checkpoint. |
| Treat four fixes alone as proof architecture is adequate | Discard | These are entry points, not a completeness guarantee. Review their immediate producers, consumers, replay, and ownership before staging a candidate. |

## Implication for the architecture decision

Favor a targeted redesign of transition ownership/replay inside existing
modules, not a role redesign or a new orchestration engine. Before implementation,
make a short transition map for the affected connections: authoritative durable
fact, dependent representation, lock boundary, supported replay, and authorized
next owner after resources are removed. Each proposed abstraction must remove a
concrete duplication or impossible state; do not add one merely for symmetry.

The map and failing journey tests should drive one consolidated delivery plan.
Retain the accepted source-only refresh repair as an unreleased input, not an
independently required installation. Keep the outer delivery authority stable
and candidates outside the watched marketplace; explicitly resolve the known
repair-execution restriction before dispatch rather than rediscovering it midway.

The external report predates our latest repair and the corrected verification
claim. Preserve the distinction between the original full run (193/194) and the
subsequent focused reporter-test pass. Actual terminal exit/summary is required
for future verification claims; no new status ledger is needed.

## Completion boundary and remaining limits

The reliability boundary is delivery through acceptance and authorized closeout
followed by a lawful next assignment, with an honest interrupted/failed case.
Retained abandoned RC5 fences remain a separate historical blocker. A fresh
successful fixture/canary does not retire them, and this assessment authorizes no
historical-state changes or release. Broader rollout remains withheld pending
verified reliability and applicable clean-start/refresh admission.
