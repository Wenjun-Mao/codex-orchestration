# Codex Orchestration v0.9.12 — rollout-readiness review

## Decision

**Ready with specific restrictions for one supervised ordinary-project trial; not ready for broad rollout.**

The release has enough connected implementation and evidence to justify trying a small real deliverable. I would not reopen lifecycle architecture. However, I found a launch-request consistency gap and a release-specific test identity defect. Resolve the narrow verification issues below, use the exact supported host, and freeze the package during each assignment.

## Review boundary

- Released executable source inspected: `f61b39faefb31ff7f70f111248928a28dc7bd108` (tag `v0.9.12`).
- Final documentation inspected: `2e8738222028f169a4c59dc9d2b1b11736fc659a`, especially `docs/plans/2026-09-10-v0.9.12-historical-settlement.md`.
- Code was read at the release commit, not older `main` and not the documentation branch as a substitute for released code.
- GitHub connector reads succeeded. Container access to raw GitHub failed DNS resolution. No repository tests or live App operations were executed in this review. No repository or installed artifacts were changed.
- Installed RC/stable outcomes are delivery-team observations preserved in documentation, not my independent reproduction. The reported gates were coordinator-only.

## What now supports a trial

### Preparation and readiness

`skills/direct/SKILL.md` requires the director to use the generated assignment preparation and first prompt. `commandAssignmentV097()` authenticates the director's thread when preparing the assignment. `commandReportV09()` resolves the preparation, authenticates the coordinator's App worktree ownership, installs reporting, and publishes readiness after its registration stages.

This is a real ordinary-project path. The source-only development exception described in the plan is not a substitute for normal trial registration.

### Local work, executor identity, and verification

The released `test/cli-v09.test.mjs` contains a connected local-A/dependent-B journey. It commits A, generates B's contract from A's completed authority, exercises provisional creation followed by authenticated start, checks stable iteration identity and replay, integrates B, verifies it, retires the child, performs audited run closure and director acceptance, and starts useful successor work.

`commandTaskLaunchV09()` now reconciles executor membership after authenticated start and creation reconciliation. `startTaskLaunch()` distinguishes completed activation replay from fresh activation: replay authenticates the same worktree/branch without requiring its HEAD still to equal the original baseline or rerunning branch creation. These are substantive corrections to earlier findings.

Integration names its target explicitly: the public `integration prepare` requires `main_branch`; it does not silently default to `main`. `canonicalContext()` requires a clean checkout of that exact branch, and integration verification binds callback, receipt, contract, launch, branch, and reconciled revision.

The mixed test has a host-checkout fidelity defect described below. It also simulates external report submission and host observations. It is useful connected evidence, not live proof of every edge.

### Historical settlement and upgrades

The new reader joins execution/runtime/audit authority with the exact retired assignment, ready registration, report, route, iteration, locator retirement, and current preservation. `assertArchivedCoordinatorIterationSettled()` uses effective resource identity and separately checks preservation of both the archive capture and the audited result. It does not require those observations to be equal.

`classifyFreshStartPredecessors()` is used by inspection and the fresh-admission guard. Pending authenticated handoffs still prevent unrelated ordinary activation. Reclaimed modern runs without an exact retired assignment do not become standalone merely because an assignment search returns nothing.

The final documentation reports successful RC and installed stable coordinator-only endings, including reporting, acceptance, archival/reclamation and locator retirement, with predecessor digests unchanged. That supports the historical admission change. It does not establish that a newly dispatched executor works in an unrelated project.

## Finding 1 — starting branch and contracted baseline can disagree

**Classification:** confirmed source-level launch-contract gap and fixture-fidelity defect. Its exact live App manifestation was not reproduced here. Existing start checks prevent silent execution on the wrong baseline.

### Relevant released functions

- `lib/core/task-launch.mjs::validateRequestedWorktree()`
- `lib/core/task-launch.mjs::assertBranchReservation()`
- `lib/core/task-launch.mjs::prepareTaskLaunch()`
- `lib/core/task-launch.mjs::taskLaunchView()`
- `lib/core/task-launch.mjs::liveActivationFacts()`
- `test/cli-v09.test.mjs`, test `v0.9 CLI activates a clean run through current launch-era wiring`

### Trigger

1. Primary `main` remains at R0.
2. A disposable coordinator branch commits local A at R1.
3. B's generated contract correctly requires baseline R1.
4. Requested selectors say `starting_revision: R1` but `starting_branch: main`.
5. Preparation validates the declared revision against the contract and the executor-branch reservation, but does not validate that the starting branch resolves to R1.
6. The emitted App request specifies a branch-based starting state using `main`; it does not include the exact starting revision as the host checkout selector.
7. A host honoring that branch creates the executor at R0. `liveActivationFacts()` then rejects it because it is not at the exact task baseline.

This causes avoidable failed dispatch and retained task/recovery work after creation. It is not evidence of unverified code execution: the start-time equality check is valuable and should remain.

### Why the connected test does not settle it

The test uses a separate coordinator branch and commits A there. Its requested `starting_branch` is nevertheless `main`. The fake host then executes `git worktree add --detach ... baseline`, bypassing the emitted branch selector and placing the executor at R1 directly. Primary is only merged later.

Thus, this part of the fixture supplies the checkout the contract needs rather than the checkout the emitted host request asks for.

### Smallest action

For an unchanged-v0.9.12 supervised trial, require a read-only pre-dispatch equality check:

`tip(requested starting branch) == task contract current_baseline.revision`.

Use the named coordinator delivery branch when that is where A resides. Reserve a distinct executor branch, and do not advance the starting branch between contract generation and the child's authenticated start. This is a launch precondition, not manual journal repair.

For the next code correction, add that check at the owning launch boundary before authorizing the first native creation call. Keep start-time validation for drift occurring later. Do not add another registry or weaken the executor's exact-baseline requirement.

Correct the existing fixture so its fake host materializes the actual emitted starting branch. Keep primary behind the coordinator. The positive control should use the right branch; the wrong-branch variant should establish the intended rejection point and side-effect count. A pristine fixture that moves primary early would hide the issue again.

**Trial status:** manageable by an explicit pre-dispatch restriction. I would not allow unassisted mixed dispatch without it.

## Finding 2 — a refresh test's fixed target version collides with this release

**Classification:** confirmed test-identity defect in the source; resulting assertion failure is a static prediction, not an executed test result. This is not a demonstrated production upgrade failure.

### Relevant released paths

- `test/refresh-v09.test.mjs`: loop over `provisional` and `opaque`, tests named `applyRefresh retires an assigned ${creationOutcome}-first launch whose iteration projection is absent`
- `test/v09-lifecycle-fixture.mjs::createActiveTaskLaunch()`
- `test/helpers.mjs::activateFixtureRun()`
- `lib/core.mjs::PACKAGE_VERSION`
- `lib/runtime-context.mjs::RUNTIME_DIRECTORY`
- `lib/compat/refresh.mjs::inspectRefresh()`

The test creates its producer through the current package fixture, but sets its target with `copyCurrentPackage({ version: "0.9.12" })`. The released producer is now also 0.9.12, and its namespace is `v${PACKAGE_VERSION}`.

With an active source run in `v0.9.12`, that target's inspection takes the current-active-namespace branch. If authentication succeeds, it returns `resume-source`, not the test's expected `refresh-ready`. Any earlier authentication failure likewise would not establish the intended cross-version test.

These tests are included by the package's normal `test:v09` glob. Successful pre-promotion results cannot automatically be treated as a successful execution of this test at the stable tag.

### Smallest action

Run this exact focused group at the release before drawing conclusions from inherited test counts:

```sh
node --test --test-name-pattern='applyRefresh retires an assigned' test/refresh-v09.test.mjs
```

Use a test-only target identity that is deterministically later than and distinct from the producer. Preserve the genuine frozen-v0.9.11 producer in the separate historical-admission journey. Run corrected tests against unchanged released executable bytes; do not rewrite the immutable release tag or relabel candidate code as an authentic older producer.

**Trial status:** resolve this small verification defect before starting the trial. It does not by itself require a new production architecture or invalidate the reported installed stable gate.

## Operational restrictions and plausible risks

### Supported host is narrow

`lib/codex-app-report-adapter.mjs` fixes:

- binary: `/Applications/ChatGPT.app/Contents/Resources/codex`
- expected version: `codex-cli 0.153.4`
- data root: the current user's `~/.codex`

`validateNativeQueueConfiguration()` deliberately requires these exact values. The hooks also rely on `$PLUGIN_ROOT`, `$PLUGIN_DATA`, `node`, and the App's completion events. Normal coordinator registration requires App-created `codex-thread.json` ownership metadata.

This is an inspected support boundary, not a claim that the user's current host has these values. A different OS, binary placement, custom data home, or App CLI change can break automatic reporting independently of Git workflow success.

The trial should use the already-supported same local App host with real worktree-backed tasks. Confirm the new project's actual sender/recipient delivery mapping. Queue acceptance alone is not delivery. The documented manual-reporting fallback remains honest fallback, not proof of automatic-reporting success.

### Existing state must be genuinely eligible

A project with no Flow state is the simplest trial starting point. An existing project is suitable when supported prior assignments really completed and the exact v0.9.12 inspection reports `fresh`; activation still revalidates.

Do not use unrelated abandoned runs, pending handoffs, missing assignment state, or reclaimed standalone histories as onboarding test material and then remove them to force admission. The classifier intentionally refuses such unsupported or unresolved histories. Live-source-required histories use the existing source-owned path and are outside the first trial.

The plugin's own blocked source repository therefore does not prove ordinary projects are unusable, but it does disprove any blanket claim that every existing Flow project upgrades automatically.

### Transfer of evidence remains unproven

The new live gates verify coordinator-only work in the retained canary. The mixed CLI fixture gives stronger executable-path coverage, but simulates the host and has the starting-branch mismatch above. Fresh-project first-turn preparation, actual executor-to-coordinator delivery, project-specific verification, and the whole mixed ending on the target App remain the useful trial questions.

This is a bounded evidence gap, not a reason to add another broad audit or many canaries.

## Smallest useful ordinary-project trial

Choose one reversible, low-risk improvement in one ordinary repository with existing automated checks. No deployment, dependency-system migration, or unrelated project cleanup. Use the exact released package for the entire assignment.

Before dispatch, settle the two focused verification checks above, authenticate host/package/skill identity, preserve a normal Git recovery point, and inspect existing Flow state without modifying it. Keep primary and task worktrees free of unrelated concurrent changes.

The director prepares the actual plan through `assignment prepare`, uses its complete generated first prompt, and dispatches one coordinator in a disposable worktree. Establish a named delivery branch before run authority is bound; do not activate on one branch and change its identity afterward. Pass explicit model/effort and saved-project placement.

The coordinator registers reporting and commits a small useful A under its local-work contract. One executor receives a genuinely dependent task B. Before the one native creation call, confirm the emitted starting branch resolves exactly to A's contracted commit. Hold it stable until authenticated start. B should change actual project behavior or meaningful tests, not just create sentinel files.

The executor returns its exact receipt; the coordinator observes it, integrates into its named delivery branch, performs project-level checks and finalizes the result. `main_branch` means the explicitly named integration target; do not substitute primary accidentally. Complete child closeout through the normal owning-host operations.

Close the run through its current audit, preserve the delivered result in primary under the approved integration policy, and ensure the final reaches the actual director. The director accepts that exact report and completes coordinator archival/reclamation and locator retirement. Record both child and coordinator terminal states; a queue acknowledgment or missing directory alone is insufficient.

Finally, one fresh successor coordinator verifies the delivered behavior using the public path and completes its own normal ending. Use a fresh disposable worktree rather than converting protected primary into a cleanup target.

For a project with supported prior-version history, beginning this trial on v0.9.12 already exercises upgrade admission. For a clean project, do not invent a future package version or downgrade the project merely to claim a live upgrade test. Keep the release's reported upgrade evidence distinct and repeat the post-closeout successor check at the next real package change. Avoid in-flight upgrades in this first trial.

## Stop conditions

| Observation | Required response |
| --- | --- |
| Starting branch cannot resolve to the exact task baseline; runtime/project/task identity disagrees | Stop before native creation when possible. Preserve the command output; do not silently choose another identity. |
| Creation/report/archive outcome is ambiguous, the recipient is wrong, or completed work cannot be verified in its authorized destination | Stop dependent work and destructive cleanup. Do not retry a potentially completed host action. |
| A supported continuation requires editing journals, recreating an old checkout, forcing worktree deletion, unplugging unrelated history, or installing another RC | End the trial as incomplete and preserve the failed segment. Do not convert it into a rescue campaign. |
| Director repeatedly reconstructs protocol state rather than deciding scope/acceptance | Record intervention and stop expansion after the bounded assignment; eventual recovery is not an unattended-readiness pass. |

## Before trial versus later

| Item | Timing |
| --- | --- |
| Exact starting-branch/baseline check and faithful mixed-fixture rehearsal | Before mutating executor dispatch |
| Distinct producer/consumer identities in the implicated refresh tests; focused rerun against release bytes | Before relying on release regression evidence for this trial |
| Supported host, disposable coordinator placement, prepared first prompt, route readiness, eligible prior state | Before work starts |
| Automatic early starting-branch validation in product code | Next bounded code correction; before broad/unassisted mixed rollout |
| Real mixed trial evidence on one ordinary project | Required before recommending wider rollout |
| Broader platform compatibility, historical-state repair, large performance work, more agent roles | Defer; not prerequisites for this restricted trial |

## Bottom line

The historical-settlement correction is materially stronger and the core mixed workflow merits a controlled real-project test. The remaining launch gap is fail-closed but can cause precisely the recovery work the product aims to avoid. Test evidence also needs to remain valid after release identity changes.

**Proceed with one supervised trial under the stated restrictions. Do not call v0.9.12 broadly rollout-ready, do not bypass blocked history, and do not spend another release cycle on a general redesign.**

## Commit-pinned source index

All executable and test links below refer to the release commit.

- [Final delivery plan and reported gates](https://github.com/Wenjun-Mao/codex-orchestration/blob/2e8738222028f169a4c59dc9d2b1b11736fc659a/docs/plans/2026-09-10-v0.9.12-historical-settlement.md)
- [Director skill](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/skills/direct/SKILL.md)
- [Coordinator skill](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/skills/coordinate/SKILL.md)
- [Assignment/reporting contract](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/templates/references/assignment-and-reporting.md)
- [Public CLI](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/bin/codex-flow.mjs)
- [Launch authority and host request](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/core/task-launch.mjs)
- [Mixed public CLI test](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/test/cli-v09.test.mjs)
- [Refresh tests](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/test/refresh-v09.test.mjs)
- [Lifecycle fixture](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/test/v09-lifecycle-fixture.mjs)
- [Fixture runtime acquisition](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/test/helpers.mjs)
- [Package version and test scripts](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/package.json)
- [Core version](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/core.mjs)
- [Runtime namespaces](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/runtime-context.mjs)
- [Integration](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/integration.mjs)
- [Historical classifier](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/compat/refresh-source.mjs)
- [Refresh and admission guard](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/compat/refresh.mjs)
- [Iteration, preservation and reclamation](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/iteration-registry.mjs)
- [App reporting adapter](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/codex-app-report-adapter.mjs)
- [Coordinator worktree authentication](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/lib/adapters/codex-app/coordinator-worktree.mjs)
- [Completion hooks](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/hooks/hooks.json)
- [ADR 0070](https://github.com/Wenjun-Mao/codex-orchestration/blob/f61b39faefb31ff7f70f111248928a28dc7bd108/docs/adr/0070-read-side-historical-settlement.md)
