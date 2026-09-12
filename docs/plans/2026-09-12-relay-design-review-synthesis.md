# Relay minimal-design review synthesis

Status: amendments approved and incorporated; connected source implementation
approved, delivery dispatch still pending. Supplements
the [canonical plan](2026-09-11-serial-first-delivery.md) and
[assessment](2026-09-12-relay-design-assessment.md); not another execution plan.

Both reviewers state they inspected `816c575072a97d0b8a8903a2fa22de14eb3c4e6b`.
The first supplied report covers interface/extraction; the second covers lifecycle
and recovery. Original reports remain unchanged in the user's attachments.
This note records interpretation separately. Neither review ran tests or native
operations. Agreement supports a design decision, not runtime acceptance.

## Recommendation

Keep the independent serial successor. Revise the public journey and transition
rules once, then seek approval for the connected implementation slice. No further
broad architecture audit, legacy repair campaign or general framework is needed.

## Insight disposition

| Disposition | Finding | Proposed action |
| --- | --- | --- |
| Use | Prepared assignment must be sufficient for startup | Specify public inputs/outputs from preparation through identity binding, READY, handoff, verification, reporting and retirement. Every pending response names actor, permitted activity and exact next action. Expose saved-project prerequisites without building project management. |
| Use | One ownership commit point | Persist supporting result/report facts before atomic replacement of the current control record. Executor ownership transfers directly to the coordinator's exact verification reservation, never through an available slot. |
| Use | Never-write-enabled and possibly-write-enabled failures differ | Revoke a never-enabled reservation so late starts reject it; preserve orphan-task obligations. A possible writer requires quiescence and explicit source resolution. A clean rejected commit is not automatically an approved new baseline. |
| Use | Reporting must outlive source release without following current HEAD | Seal sender/recipient/result association before release; genuine final bytes may remain capture-pending. Keep queue acknowledgement, recipient receipt and acceptance distinct. Same event/different bytes conflicts; ambiguity never causes an automatic resend. |
| Use | Obligations govern only affected operations | Pending source/verification blocks another writer; pending capture blocks necessary sender archival; delivery/archival delay does not globally block unrelated safe work. An unaccepted result still blocks work explicitly dependent on its acceptance. |
| Use | Independent package and current authority | Relay-only manifest, no legacy runtime imports or broad staging. Stable control location; read current authority and relevant dependencies, not every historical runtime/checkout. |
| Use | Budget must count both sides of startup | Include director preparation, native-result binding, coordinator/executor startup, repetitions and helper work. Retain provisional 6,000 visible-token ceiling and at most three ordinary admission protocol calls; native calls/waits separately visible. Measure in required native journeys, not a new benchmark program. |
| Test | Exact native identity, final event and recipient receipt | Qualify in the connected disposable journey. An early/provisional start remains write-disabled with a bounded next action; do not invent general reconciliation infrastructure. |
| Test | Safe transition exclusion and crash reconciliation | Add deterministic lock/contention and interrupted-transfer tests alongside real-Git verification-drift and accumulated-history tests. |
| Park | Upgrade while old obligations depend on old runtime | Prefer deferring upgrade until such obligations drain; do not block ordinary successor work. Qualify runtime staging only if needed, using Relay's explicit manifest. |
| Park | Extra 3,000-token design aim | No second metric is needed initially. The existing provisional ceiling plus actual per-journey measurements is sufficient. |
| Discard | Reuse all of core as proven safe primitives | Curate each mechanism. In particular, do not transplant automatic stale-lock reclamation. |

## Consequential source checks

The director rechecked the new lock finding in
[core.mjs](../../lib/core.mjs)::withProcessLock. It reads a dead owner's lock and
later renames the current lock path without an atomic identity condition. Two
callers can observe stale S; A replaces S and enters, then B renames A's new live
lock using B's earlier observation and also enters. This confirms a static race
in the proposed reuse candidate; it is not an executed reproduction or evidence
that this caused any observed product incident.

Relay should initially refuse an existing transition lock and use explicit
quiescent recovery, or use a separately justified tested lock primitive. Merely
reading the token again before rename is not atomic. Recovering a command lock
never establishes that an agent's source-writing tools have stopped. Do not
change installed Flow as part of this design review; any protective legacy fix
requires a separately scoped decision and validation.

The director also rechecked all-of-lib staging in
[report-runtime.mjs](../../lib/adapters/codex-app/report-runtime.mjs), queue use in
[codex-app-report-adapter.mjs](../../lib/codex-app-report-adapter.mjs), and the
package-version state namespace in [git.mjs](../../lib/git.mjs). These support the
assessment's extraction boundary. Staging all files does not mean executing them
all; verification-module coupling does not mean every call invokes dispositions.

## Reconciliation of the reviews

Prefer the lifecycle review's ordering: required reporting setup is persisted
before write enablement. The interface review's interrupted-start example must
distinguish a reservation from actual permission; a READY flag alone cannot erase
permission already granted before a crash.

Receipt need not add another agent ceremony: a public recipient operation may
record exact receipt and its separate accept/reject decision together when both
are known. It must also support receipt without acceptance. Test success remains
separate from semantic acceptance.

Do not overpromise hostile-command detection. Verification commands must not
modify tracked source, index or refs; run fixers as work. Before/after snapshots
detect endpoint drift, not every transient write. Keep cooperative enforcement
explicit rather than adding filesystem surveillance.

## Next gate

The existing assessment/plan now contains the complete public walkthrough, single
ownership transition, two failure-release predicates, operation-specific gates
and conditional utility reuse. The next action is delivery of the approved
bounded source slice, not another assessment.
Native compatibility, Flow coexistence and pilot success remain later evidence
gates. No source changes, tests, installation, push or active-project operations
were performed for this synthesis.
