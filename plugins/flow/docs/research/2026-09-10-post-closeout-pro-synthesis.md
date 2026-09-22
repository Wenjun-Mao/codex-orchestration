# Post-closeout Pro reviews: local synthesis

Status: review recommendation, not an implementation plan or release acceptance.
Source checked: `ee24c2382a20acb0d50ab4a7dd8a7981653ec163`.

## Inputs and limits

Two consultations, not three: the existing Pro supplied a direct output and a
Markdown report; the new Pro supplied one output. Originals are preserved
byte-for-byte alongside this note:

- `2026-09-10-post-closeout-pro-existing-report.md`
- `2026-09-10-post-closeout-pro-existing-output.txt`
- `2026-09-10-post-closeout-pro-new-output.txt`

Both reviewed the same source and supplied diagnosis. Their convergence is useful
corroboration, not independent reproduction. Neither ran tests or inspected local
App/Flow journals. Local review here checked the consequential source assertions;
no runtime tests, source changes, installation, or lifecycle mutation occurred.

## Checked findings

1. Selected terminal runs enter live-root loading before sibling settlement
   checks (`inspectRefresh`, `locateRefreshSourceSnapshot`). Confirmed.
2. Fresh admission's shared entry point still delegates only to the exact
   v0.9.7/single-run settlement recipe. Public activation calls it under the
   repository lock before target preparation. Confirmed.
3. `assertReclaimedClosedRunSettled` validates runtime/workflow/audit evidence,
   not subsequent assignment/reporting retirement or current preservation.
   It cannot be promoted unchanged into complete admission authority. Confirmed.
4. `preservedNonHostRef` requires direct/peeled ref equality. Coordinator
   reclamation's `assertIterationTipPreserved` accepts ancestry in authenticated
   primary. The recovery test explicitly expects rejection after removing a
   preservation tag and advancing primary. Confirmed policy difference; choose
   the supported preservation contract explicitly rather than silently broadening
   an immutable legacy contract.
5. Public audited close validates the selected audit, but passes no audit ID
   into `closeRun`; closed terminal records contain no audit ID. Confirmed
   structure, not a demonstrated additional failure.
6. Legacy recovery fixtures use direct `closeRun` and stub locator retirement.
   Useful component fixtures, insufficient unchanged as the decisive public
   lifecycle proof. Confirmed.

## Disposition

| Insight | Decision | Scope |
|---|---|---|
| Classify settled history before choosing executable source | Use | One transient read-side interpretation; replace competing algorithms, not add a fourth |
| Same decision for inspection and actual admission | Use | Revalidate under existing lock; retain active-run collision guard |
| Join execution, assignment retirement, and preservation facts | Use | Reuse owners' validations; no fabricated assignment for legitimately standalone runs |
| Fully settled history permits fresh work without deletion | Use | No synthetic handoff; deletion retains separate authority and inventory limits remain |
| Exact result preserved in authorized primary ancestry | Use as proposed policy | Explicitly settle legacy-format scope; not arbitrary reachability in any ref |
| Existing records suffice for this real predecessor | Test | Verify exact local joins before promising applicability; stop on a concrete missing fact |
| Coordinator-only two-predecessor public journey | Use | Frozen old package; true closeout/reclamation; next-package admission, assignment/reporting registration, useful work and normal ending |
| Compact negative cases and consolidated repeated fixtures | Use | Preserve selector-replan, earlier-blocked-audit, unresolved-work and tamper distinctions |
| Closure stores accepted audit ID prospectively | Park | Optional future simplification; no schema expansion needed for current unique evidence |
| Ephemeral verification reuse / clearer errors | Park | Only optimize after profiling; no persisted cache or new authority |
| ENOENT fallback, root substitution, broad lifecycle rewrite | Discard for this correction | Misstates ownership or expands beyond demonstrated need |

## Recommended next checkpoint

Write a bounded plan for historical-settlement classification and its consumers.
Require an explicit list of old predicates replaced and preserved legacy reader
contracts. Start with the real retained state and the smallest reproducible
source failure; do not begin another broad canary campaign.

Use the new Pro's coordinator-only test economy with the existing Pro's explicit
consumer map. The decisive endpoint is useful authorized next-package work after
all predecessor coordinator checkouts are reclaimed, with old records unchanged.
An inspection response alone is not completion. Keep live execution and pending
cleanup on their existing strict paths, and keep namespace deletion separate.

This is a bounded architectural consolidation, not a trivial line fix. Broaden
it only if the required existing evidence cannot express a specific necessary
fact. No implementation or publication is authorized by receipt of these reviews.
