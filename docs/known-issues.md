# Known issues — Flow and Relay

Last reviewed: 2026-09-12. Umbrella working checklist, not a complete bug inventory
or a new audit. Includes confirmed defects, observed usability limitations and
explicitly labelled design risks. Relay has an accepted source-only candidate;
native qualification and pilot remain open. The installed candidate has completed
a recovered mixed native journey and a one-turn successor with self-corrected
admission. See the [qualification checkpoint](field-tests/2026-09-12-relay-native-qualification.md)
for proven boundaries and remaining gates; installation is not broad acceptance.

## Relay source checkpoint — 2026-09-12

Accepted source slice: `71f75b22f09180016e723edb57e5e8ca8ddb108a`, branch
`codex/relay-connected-source`. It is not merged, published, installed or native
qualified. KI-01 through KI-09 have candidate coverage documented in that commit's
`plugins/relay/docs/acceptance.md`; the Relay bullets below describe remaining
closure requirements, not an assertion that source implementation is absent.

Director independently ran the original 19-test source suite and two relocated
package journeys successfully. The coordinator reported 20/20 source and 7/7
packed tests at `a1e3431`; after the final retirement correction, the director ran
all seven reporting/connected-journey tests at `71f75b2`: 7/7, 7.105s. The broader
suite and packed artifact were not rerun for that final predicate tightening.

Review found and corrected a KI-05/KI-06 boundary: parent archival must wait not
only for every sequential child's receipt, but also for child archive duties that
only that parent owns. The regression covers ambiguous archive observations,
multiple children, no-repeat actions and useful independent successor work.
This is source evidence with injected native observations, not real App archival.

All overall closure boxes stay open pending their applicable native/operational
gates. In particular, no actual hook/transport, startup-budget result or Flow/Relay
coexistence proof is claimed. Flow dispositions are unchanged.

## How to use

Capture new reports under **Needs triage** first: symptom/impact, evidence pointer
and the cheapest causal check. Promote an entry only after recording its cause
(or explicit unresolved hypothesis), category, fix location and closure test.
Confidence is **reported**, **source-confirmed**, or **reproduced**; attach it to
the specific claim, not the entire entry. Label design counterexamples separately.
Reuse an issue ID only when the causal mechanism matches, not merely the symptom.

Keep one entry per failure family. Check **each plugin separately** only after
relevant verification, adding a short dated closure comment with commit/test
evidence, verified version and remaining limits. Distinguish source verification
from release/installation. A planned fix, workaround or intentional deferral stays
unchecked. A Relay fix never means Flow is fixed. Do not erase old incident facts.
Add new entries only when evidence or a concrete design counterexample warrants it.

## Needs triage

- **Legacy suite cost:** one candidate's 254 tests took 430.021s. That timing is
  recorded, but the dominant cause is not diagnosed. Before claiming duplicate
  coverage, process startup or Git fixtures are responsible, inspect existing
  per-test timings and the few largest cases. No new profiling/audit effort is
  authorized here. Relay's narrower suite is not an equivalent-work speedup proof.

## Analyzed issues and labelled design risks

### KI-01 — Started task cannot retire after a scope violation

**Evidence: confirmed incident and source limitation.** A docs-only finalization
claim committed frontend test repairs. Completion correctly refused; started
coordinator work has no task-level failed/abandoned outcome. Replanning cannot
change that started contract; run abandonment retains fences. No work was lost.

**Category / cause:** execution mistake plus lifecycle/recovery gap. The coordinator
carried edits from a broad implementation scope into a docs-only claim; Flow's
started/completed-only work model cannot record failed task retirement. Both are
source-confirmed in the inspected case; the scope rejection is not the bug.
**Fix location / closure:** public scope-change guidance and failed-work retirement
contract. Verify out-of-scope work stays rejected, survives explicit disposition,
and permits an authorized successor without rewriting the failed claim.

- [ ] **Flow — open:** no narrow supported task-level retirement/reissue established.
- [ ] **Relay — prevention required:** distinguish failed source disposition from
  acceptance; require explicit quiescence and resolution before successor ownership.

Evidence: `coordinator-work.mjs` permits only started/completed;
`workflow-journal.mjs::assertHistoricalStartedTasksUnchanged`; the 2026-09-12
read-only incident check found the offending commit clean and preserved. See
[recovery contract](plans/2026-09-12-relay-design-assessment.md).

### KI-02 — Automatic stale-lock reclamation can admit two owners

**Evidence: confirmed static race; not reproduced or attributed to an incident.**
Two callers inspect a stale lock; one acquires its replacement, then the other
renames that new live lock based on its earlier observation.

**Category / cause:** synchronization defect; source-confirmed check/use race on
the lock pathname, not proven incident causation. **Fix location / closure:** lock
primitive/recovery contract; deterministic contention must never admit two owners.

- [ ] **Flow — open:** no fix made; a protective change needs separate scope.
- [ ] **Relay — prevention required:** do not copy automatic reclamation; verify
  transition exclusion and explicit quiescent lock recovery.

Evidence: [core.mjs](../lib/core.mjs)::withProcessLock and
[review synthesis](plans/2026-09-12-relay-design-review-synthesis.md).

### KI-03 — Never-started registration residue blocks new work

**Evidence: confirmed, narrowly repaired in an unreleased candidate.** Registration
can persist assignment authority before publication fails; abandonment retains
fences even when execution never began.

**Category / cause:** lifecycle/recovery gap; source-confirmed partial registration
has durable authority but no eligible unsuccessful-settlement path in installed
0.9.13. **Fix location / closure:** explicit never-enabled settlement, not a blanket
fence waiver. Test interruption, late starts and real overlapping successor work.

- [ ] **Flow — implemented, unreleased:** parked `18b1246` / 0.9.14-rc.1 adds narrow
  settlement. Recorded candidate verification: 254/254; bounded cross-version
  admission passed. It does not resolve started work or all historical blockers.
- [ ] **Relay — prevention required:** revoke never-write-enabled reservations
  without fabricating success; reject late starts and retain orphan-task facts.

Evidence: [ADR 0073](adr/0073-unstarted-assignment-settlement.md). The candidate is
not an installed Flow release or a general clean-start solution.

### KI-04 — Historical lifecycle checks obstruct retained-checkout successors

**Evidence: confirmed compatibility/architecture limitation.** Narrow historical
settlement repairs exist, but not every completed/cancelled retained-checkout case
admits a successor without namespace retirement. Do not generalize earlier passes.

**Category / cause:** historical/current-authority coupling, source-confirmed for
the inspected paths. Old completion is checked through obsolete live resource or
runtime requirements. **Fix location / closure:** admission's relevant-evidence
boundary; advancing retained HEAD and delayed old observations must coexist with
legitimate successors. Different legacy predicates may require different fixes.

- [ ] **Flow — partially addressed:** residual cases remain; no broad reset authorized.
- [ ] **Relay — prevention required:** current permission controls admission;
  historical outcomes do not require replay against old live HEAD or absent paths.

Evidence: [assessment](plans/2026-09-12-relay-design-assessment.md) and
[consultation synthesis](plans/2026-09-12-serial-architecture-consultation-synthesis.md).
Close with an accumulated-history journey, not an isolated classifier test.

The separately delivered v0.8 work case is KI-10: similar blocking symptom, but
a continuation-versus-retirement contract mismatch rather than stale-HEAD replay.

### KI-05 — Reporting completion and source completion can be confused

**Evidence: confirmed transport limitation; Relay safety risk.** Native queue
acceptance is not recipient receipt. Delayed/ambiguous finals need preserved exact
association after source release; this does not assert Flow always mislabels them.

**Category / cause:** transport evidence boundary, source-confirmed; native queue
acknowledgement establishes submission only. Confusing it with receipt is a design
risk, not an established universal Flow defect. **Fix location / closure:** report
obligation and recipient acknowledgement; test delayed/conflicting events and prove
exact receipt through the real native path without restoring source permission.

- [ ] **Flow — limitation retained:** existing safeguards do not make queue
  acknowledgement independent delivery proof.
- [ ] **Relay — prevention required:** capture-pending, queued, received and accepted
  facts remain distinct; delayed/duplicate/conflicting events cannot regain ownership.

Evidence: [native adapter](../lib/codex-app-report-adapter.mjs) and
[reporting gates](plans/2026-09-12-relay-design-assessment.md). Require real final
capture and exact recipient receipt in addition to synthetic interruption tests.

2026-09-12 live qualification: structured native final objects required a parser
correction (`c08dec4`, installed candidate). Genuine Stop capture subsequently
succeeded, but public wait/read APIs returned a completed turn without message
content. This host observation is not evidence of message loss. The distinct
post-Stop submission ordering defect is KI-11. Shared-storage receipt is now an
approved amendment, not an implemented or accepted fix.

### KI-06 — Task retirement is coupled to Git-resource reclamation

**Evidence: confirmed serial-workflow mismatch, not universally wrong for Flow.**
Flow archive authority can require worktree disappearance and historical source
checks. Relay's normal resource is a retained, advancing checkout.

**Category / cause:** resource-ownership mismatch, source-confirmed. A contract for
disposable worktrees is unsuitable for shared retained source. **Fix location /
closure:** task-only retirement and its actor-owned obligations; prove child-first
archival while successor source advances, with neither source deletion nor stranded
child reporting/archive duties.

- [ ] **Flow — intentionally retained/deferred:** no serial archival redesign planned.
- [ ] **Relay — prevention required:** exact task-only archival; delayed observation
  must not delete source or require an obsolete HEAD. No guessed archive retries.

Evidence: [archive lifecycle](../lib/archive-lifecycle.mjs),
[native feasibility limits](field-tests/2026-09-11-serial-native-feasibility.md).

### KI-07 — Startup makes agents reconstruct mechanical protocol inputs

**Evidence: observed startup activity and source-confirmed incomplete brief.**
Startup involved internal reads and mechanical JSON reconstruction. The >100K
context estimate is unverified; the separate suite-cost question needs triage.

**Category / cause:** public-interface gap plus execution inefficiency. The prepared
brief requests activation/registration without supplying the mechanical activation
request; repeated agent reads contribute but are not all protocol requirements.
**Fix location / closure:** generated preparation/start interface; a fresh agent
must use no internal code or handwritten protocol data. Measure the whole startup,
including director preparation, rather than claiming savings from shorter output.

- [ ] **Flow — deferred:** no new general optimization effort planned.
- [ ] **Relay — improvement required:** generated public startup, zero internal
  reads/mechanical JSON; measure both preparation and worker costs. Use focused
  tests plus a small connected acceptance suite, not the whole Flow suite.
  Fresh successor used public instructions only, but its actor placeholder led to
  a rejected director-ID start, status lookup and corrected start: five total
  admission protocol calls instead of three. No source write occurred before READY.
  Token ceiling and complete startup latency remain unmeasured.

Evidence: [startup note](field-tests/2026-09-12-coordinator-startup-overhead.md) and
[plan acceptance](plans/2026-09-11-serial-first-delivery.md). Targets are not results.

### KI-08 — Reporting extraction can silently retain the legacy engine

**Evidence: confirmed dependency/packaging coupling, not a standalone runtime bug.**
Flow routes depend on lifecycle authority and reporter staging includes all `lib`.

**Category / cause:** extraction/packaging coupling, source-confirmed. Staging follows
the legacy library tree rather than a small independent runtime manifest; this does
not mean all staged code executes. **Fix location / closure:** Relay package boundary;
run the relocated packed public CLI and eventual hook with Flow unavailable.

- [ ] **Flow — intentional architecture:** no extraction change planned.
- [ ] **Relay — prevention required:** independent package/runtime manifest;
  relocated packed CLI/hook tests must run with Flow unavailable.

Evidence: [dependency assessment](plans/2026-09-12-relay-design-assessment.md).
Small entrypoints alone do not prove a small or independent artifact.

### KI-09 — Ownership transfer and native binding need connected proof

**Evidence: Relay design risk, not an observed Relay defect.** Separate release
and verification writes can expose an ownership gap; early/provisional tasks can
start before identity binding. Existing native probes do not prove these rules.

**Category / cause:** ownership/host-boundary design risk. Separate release/reserve
operations would expose an unowned gap, while creation response timing can precede
ready identity binding. These are concrete counterexamples, not a reproduced Relay
incident. **Fix location / closure:** one ownership commit point plus exact native
binding; test every transition interruption locally and the actual early-start
behavior on the host. Idle or dead lock process does not establish writer quiescence.

- [ ] **Flow — no new blanket defect claim:** existing behavior is not re-audited here.
- [ ] **Relay — prevention required:** one ownership commit point, exact verification
  reservation, no provisional write permission, explicit interrupted-start recovery.

Evidence: [review synthesis](plans/2026-09-12-relay-design-review-synthesis.md).
Verify crash boundaries locally, then qualify actual native identity/report/archive
behavior and separate-repository Flow coexistence before installation.

### KI-10 — Refresh requires continuation of intentionally obsolete work

**Evidence: source-confirmed compatibility limitation; product completion reported
by the project director, not independently accepted here.** Mafinance reported
three abandoned v0.8 task-thread nodes with no ready tasks while equivalent product
work had been delivered separately.

**Category / cause:** continuation-versus-retirement contract mismatch. Frozen
`refresh-source-v08.mjs` derives `embodied` from exact reconciled task integration,
not general commits on main. `requiredReplacementTasks` and replacement validation
require equivalent work for discarded unfinished nodes. No-object creation avoids
invented archive targets but does not waive that replacement requirement.

- [ ] **Flow — limitation retained:** inspect preservation-first `unplug plan` for
  intentional retirement, then separately approve exact safe targets; this is not
  evidence that unplug is currently eligible or that a reset occurred.
- [ ] **Relay — prevention required:** explicit failed/obsolete assignment retirement
  and source-baseline approval must not fabricate accepted task results or require
  replay of obsolete product work. This precise case has not been separately tested.

**Fix location / closure:** explicit retirement/adoption boundary, not weakening
integration evidence. Verify separately delivered source can be approved as an
independent baseline while old work remains failed/cancelled and cannot satisfy
accepted-result dependencies. Relay is not required to import v0.8 journals.

Evidence: 2026-09-12 read-only inspection of Mafinance's frozen v0.8.3 source;
current [refresh contract](../lib/compat/refresh.mjs) enforces exact replacement
coverage and semantic equivalence. No journal edits, replacement tasks, product
acceptance or destructive cleanup were performed for this diagnosis.

### KI-11 — Post-Stop capture has no non-reactivating sender submission path

**Evidence: source-confirmed Relay ordering gap, exposed during live qualification.**
The trusted hook captured executor turn `01a09424-1117-75d1-bc5f-7d0edfb04d65`.
Wait/read observations omit the final text, so the alternative submission path was
inspected: `submit` requires a captured final and the exact sender actor, but the
sender has already stopped. Reactivation emits a conflicting later Stop event.
No spoofed actor, fabricated delivery key or injected receipt was used.

**Category / cause:** reporting ownership/order mismatch, not failed product work.
Submission depends on an actor whose reporting turn must already have finished.
**Fix location / closure:** same-host public report retrieval and explicit recipient
acknowledgement of the frozen capture, labelled `shared-storage`. Prove receipt
without reactivating the sender or requiring native API message text; retain exact
association, separate semantic acceptance and child-first archival. No transport
service is required. The precise reason for the host's missing message is unresolved.

- [ ] **Flow — not assessed:** no new legacy defect claim or fix authorized.
- [x] **Relay — same-host receipt closure verified:** `0cae260` adds public frozen
  report retrieval and explicit shared-storage acknowledgement. Director verified
  15/15 reporting/native/CLI tests (8.729s). Installed candidate
  `0.1.0+codex.20260912061058` completed child receipt/retirement, then coordinator
  receipt/retirement after a report-only post-reload recovery. A fresh dependent
  successor completed one turn, genuine capture, shared receipt, acceptance and
  task retirement without reporting repair; it self-corrected one rejected actor
  choice before admission (KI-07). This closes the receipt-ordering issue, not the
  unresolved host reload diagnosis or broad rollout qualification. No native
  message-delivery proof is claimed.

Evidence: Relay `lib/reports.mjs` capture/submit/receive contracts at `c08dec4`;
the canary's preserved `director-empty-final-wait.json`; approved
[receipt amendment](plans/2026-09-11-serial-first-delivery.md#3a-approved-amendment--shared-storage-receipt-2026-09-12).
