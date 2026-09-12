# Serial architecture consultation synthesis

Status: discussion note; not an approved architecture or implementation mandate.
Reviewed source: `e5f22b6c54c413e1188c9d184d584848e6a8a0ef` (v0.9.13 runtime).
Original consultant reports remain unchanged in the user's attachments. This note
records interpretation separately; consultant recommendations are not test evidence.

Subsequent user direction: prefer the serial-first successor, named **Relay**,
without feature parity or two equally maintained products. Freeze legacy Flow
for existing obligations. The revised [successor plan](2026-09-11-serial-first-delivery.md)
is the current planning authority; the working recommendation below records the
earlier consultation synthesis, not a competing implementation plan.

## What the three reviews establish

- A recommends adaptation: reuse existing lifecycle owners, but remove isolation
  obligations from serial delivery rather than fabricate integration/cleanup proof.
- B recommends a serial-only successor: selectively extract proven primitives and
  replace the lifecycle, conditional on a bounded reporting extraction.
- C finds both conditionally feasible, modestly preferring adaptation operationally.
  Neither option has demonstrated safe installation/coexistence with active projects.

These are different weightings of the same trade-off, not a vote. Adaptation has
lower reporting/deployment uncertainty; a successor can shed isolated-resource and
historical-compatibility obligations, at the cost of rebuilding their necessary
serial equivalents and qualifying a new reporting boundary.

## Source checks supporting this synthesis

- `lib/report-routes.mjs` imports task-launch, run-lifecycle, iteration-registry and
  assignment-authority. Copying the reporting layer wholesale is not small reuse.
- `lib/adapters/codex-app/report-runtime.mjs::runtimeSourceFiles` recursively stages
  all of `lib`. A narrow source import alone would not produce a narrow artifact.
- `lib/codex-app-report-adapter.mjs` imports Node built-ins and core utilities, a
  plausible extraction boundary. It also pins a native binary path and CLI version:
  source isolation does not establish host compatibility.
- Accepted-result semantics occur in disposition, verification, dependency, audit,
  archive and cleanup consumers. Direct mutation is a connected contract change.
- `assertArchivedCoordinatorIterationSettled` explicitly requires an absent
  coordinator worktree/branch. Task archival with retained source is a new resource
  contract, not merely skipping deletion or setting existing member `retained`.
- Runtime state and repository locators use the Git common directory. Different
  linked worktrees or product names alone do not establish independence.

No runtime tests, installation changes or native coexistence experiments were run
for this synthesis. The earlier native probe establishes only its recorded native
same-checkout journey, not Flow ownership or reporting correctness.

## Insight disposition

| Status | Insight |
| --- | --- |
| Use | Full serial delivery includes shared-checkout executors, task-only archival and useful successor work. |
| Use | One current writer/verification reservation; historical task identity never restores current write permission. |
| Use | Failed work can become safely retired without becoming accepted or unblocking dependencies. |
| Use | Keep source ownership separate from outstanding reporting obligations. |
| Use | Preserve old runtime/state meanings; switch at completed assignment boundaries, not by live journal translation. |
| Test | Can reporting and direct verification be extracted without legacy lifecycle imports or packaging inclusion? |
| Test | Interrupted transfers, stale resumes and verification that advances clean HEAD inside allowed scope. |
| Test | Foreign-hook no-ops and old reporting compatibility on the intended native host. |
| Park | Mixed serial/isolated execution in one assignment, same-repository dual-product control, live migration and feature parity. |
| Discard | Renaming a plugin proves isolation; copying modules inherits their test proof; majority recommendation settles the architecture. |

## Working recommendation and decision boundary

Lean toward a selectively extracted serial-only successor for the user's stated
98% serial workload. This is a long-term product-fit judgment, not a demonstrated
delivery-cost advantage. Preserve Flow for existing obligations; avoid committing
to two permanently feature-matched products.

Before authorizing a build, do one bounded source-only dependency-cut assessment:
show exactly what direct verification/reporting reuse, what must be replaced, and
what the candidate package would contain. Compare that with the existing adaptation
consumer map. No new daemon, common framework, broad audit or repeated native
archive probe is needed to answer this question.

Choose the successor only if its boundary genuinely excludes legacy launch/run/
workflow/iteration/integration/cleanup/compatibility machinery. If extraction largely
recreates or imports Flow, reconsider adaptation before implementation. A small
module count alone is not sufficient evidence.

After the architecture decision, test one connected success journey and one honest
failure/reconciliation journey, including interruption and stale-owner checks.
Do not make a broad validation framework the first deliverable.

Development can remain source-only in independent disposable repositories. Native
installation/coexistence remains a later explicit gate; neither this note nor the
reports authorize changing Plotloom, the installed plugin, hooks or App settings.
