# Known issues — Flow and Relay

Last reviewed: 2026-09-12. Umbrella working checklist, not a complete bug inventory
or a new audit. Includes confirmed defects, observed usability limitations and
explicitly labelled design risks. Relay is not yet implemented.

## How to use

Keep one entry per failure family. Check **each plugin separately** only after
relevant verification, adding a short dated closure comment with commit/test
evidence, verified version and remaining limits. Distinguish source verification
from release/installation. A planned fix, workaround or intentional deferral stays
unchecked. A Relay fix never means Flow is fixed. Do not erase old incident facts.
Add new entries only when evidence or a concrete design counterexample warrants it.

### KI-01 — Started task cannot retire after a scope violation

**Evidence: confirmed incident and source limitation.** A docs-only finalization
claim committed frontend test repairs. Completion correctly refused; started
coordinator work has no task-level failed/abandoned outcome. Replanning cannot
change that started contract; run abandonment retains fences. No work was lost.

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

- [ ] **Flow — open:** no fix made; a protective change needs separate scope.
- [ ] **Relay — prevention required:** do not copy automatic reclamation; verify
  transition exclusion and explicit quiescent lock recovery.

Evidence: [core.mjs](../lib/core.mjs)::withProcessLock and
[review synthesis](plans/2026-09-12-relay-design-review-synthesis.md).

### KI-03 — Never-started registration residue blocks new work

**Evidence: confirmed, narrowly repaired in an unreleased candidate.** Registration
can persist assignment authority before publication fails; abandonment retains
fences even when execution never began.

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

- [ ] **Flow — partially addressed:** residual cases remain; no broad reset authorized.
- [ ] **Relay — prevention required:** current permission controls admission;
  historical outcomes do not require replay against old live HEAD or absent paths.

Evidence: [assessment](plans/2026-09-12-relay-design-assessment.md) and
[consultation synthesis](plans/2026-09-12-serial-architecture-consultation-synthesis.md).
Close with an accumulated-history journey, not an isolated classifier test.

### KI-05 — Reporting completion and source completion can be confused

**Evidence: confirmed transport limitation; Relay safety risk.** Native queue
acceptance is not recipient receipt. Delayed/ambiguous finals need preserved exact
association after source release; this does not assert Flow always mislabels them.

- [ ] **Flow — limitation retained:** existing safeguards do not make queue
  acknowledgement independent delivery proof.
- [ ] **Relay — prevention required:** capture-pending, queued, received and accepted
  facts remain distinct; delayed/duplicate/conflicting events cannot regain ownership.

Evidence: [native adapter](../lib/codex-app-report-adapter.mjs) and
[reporting gates](plans/2026-09-12-relay-design-assessment.md). Require real final
capture and exact recipient receipt in addition to synthetic interruption tests.

### KI-06 — Task retirement is coupled to Git-resource reclamation

**Evidence: confirmed serial-workflow mismatch, not universally wrong for Flow.**
Flow archive authority can require worktree disappearance and historical source
checks. Relay's normal resource is a retained, advancing checkout.

- [ ] **Flow — intentionally retained/deferred:** no serial archival redesign planned.
- [ ] **Relay — prevention required:** exact task-only archival; delayed observation
  must not delete source or require an obsolete HEAD. No guessed archive retries.

Evidence: [archive lifecycle](../lib/archive-lifecycle.mjs),
[native feasibility limits](field-tests/2026-09-11-serial-native-feasibility.md).

### KI-07 — Startup and verification cost are too heavy

**Evidence: observed interface burden and a recorded slow candidate suite.**
Startup required internal reads and mechanical JSON reconstruction. The >100K
context estimate is unverified. One candidate's 254-test suite took 430.021s;
that is not a universal Flow timing baseline or proof all tests are unnecessary.

- [ ] **Flow — deferred:** no new general optimization effort planned.
- [ ] **Relay — improvement required:** generated public startup, zero internal
  reads/mechanical JSON; measure both preparation and worker costs. Use focused
  tests plus a small connected acceptance suite, not the whole Flow suite.

Evidence: [startup note](field-tests/2026-09-12-coordinator-startup-overhead.md) and
[plan acceptance](plans/2026-09-11-serial-first-delivery.md). Targets are not results.

### KI-08 — Reporting extraction can silently retain the legacy engine

**Evidence: confirmed dependency/packaging coupling, not a standalone runtime bug.**
Flow routes depend on lifecycle authority and reporter staging includes all `lib`.

- [ ] **Flow — intentional architecture:** no extraction change planned.
- [ ] **Relay — prevention required:** independent package/runtime manifest;
  relocated packed CLI/hook tests must run with Flow unavailable.

Evidence: [dependency assessment](plans/2026-09-12-relay-design-assessment.md).
Small entrypoints alone do not prove a small or independent artifact.

### KI-09 — Ownership transfer and native binding need connected proof

**Evidence: Relay design risk, not an observed Relay defect.** Separate release
and verification writes can expose an ownership gap; early/provisional tasks can
start before identity binding. Existing native probes do not prove these rules.

- [ ] **Flow — no new blanket defect claim:** existing behavior is not re-audited here.
- [ ] **Relay — prevention required:** one ownership commit point, exact verification
  reservation, no provisional write permission, explicit interrupted-start recovery.

Evidence: [review synthesis](plans/2026-09-12-relay-design-review-synthesis.md).
Verify crash boundaries locally, then qualify actual native identity/report/archive
behavior and separate-repository Flow coexistence before installation.
