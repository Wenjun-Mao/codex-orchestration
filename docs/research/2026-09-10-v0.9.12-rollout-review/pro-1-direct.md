# Verdict: ready for a restricted, supervised trial—not broad rollout

**v0.9.12 has earned a bounded trial in another ordinary development project. I would not reopen the lifecycle architecture before doing that.** However, I found **one concrete launch-contract gap and one release-specific test defect** that should shape the trial and its preliminary checks.

The launch gap fails safely rather than silently executing against the wrong baseline, so a precise pre-dispatch restriction can contain it. The test defect needs a focused correction and rerun before earlier test results are treated as evidence for the exact stable release.

[**Download the Markdown rollout-readiness report**](sandbox:/mnt/data/Codex_Orchestration_v0.9.12_Rollout_Readiness.md)

## 1. Scope and evidence

I inspected executable source at **`f61b39faefb31ff7f70f111248928a28dc7bd108`**, and confirmed that annotated tag **`v0.9.12`** resolves to it. I inspected the final delivery documentation at **`2e8738222028f169a4c59dc9d2b1b11736fc659a`**. I did not substitute older `main` or use documentation-branch code as a substitute for the release.

**This was source and test-definition inspection, not executed verification.** GitHub connector access succeeded; container access to raw GitHub failed DNS resolution. I did not run the repository suite, reproduce App behavior, or modify the repository.

The final documentation records successful RC and installed-stable coordinator-only endings: useful verification, report delivery, acceptance, archival/reclamation, locator retirement, and unchanged predecessor digests. Those remain **delivery-team observations**, not experiments I independently performed. They support the upgrade boundary, but do not establish a newly dispatched executor’s behavior in another project.

## 2. What now supports a real-project trial

The released code is materially stronger at the previously troublesome connections.

| Stage                                     | What I verified in this release                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Director → coordinator**                | Preparation authenticates the director and produces the saved-plan handoff. Coordinator registration resolves that preparation, checks App worktree ownership, installs reporting, and publishes readiness. |
| **Local A → executor B**                  | The mixed CLI test commits A and generates B’s contract using A’s completed authority.                                                                                                                      |
| **Executor start → membership/reporting** | Public start now reconciles iteration membership before returning its reporting setup. Completed activation replay does not repeat Git activation or require HEAD to remain at the original baseline.       |
| **Result → integration/verification**     | The target branch is explicitly supplied; verification binds the receipt, launch, contract, integration, branch, and reconciled revision.                                                                   |
| **Closeout → successor**                  | The mixed test reaches child cleanup, audited run closure, director acceptance, real locator retirement, and useful successor work.                                                                         |
| **Reclaimed history → next package**      | The historical reader joins execution, assignment, reporting, cleanup, and preservation facts; inspection and fresh-admission checks share classification.                                                  |

These are supported by the released command wiring, integration code, and connected tests—not merely by the plan.

The earlier adversarial preservation concern also received a real code correction. `assertArchivedCoordinatorIterationSettled()` separately checks the archive capture’s preservation and that primary contains the **audited result** passed by the historical reader. It uses effective coordinator resource identity rather than overwriting the original historical binding.

**I therefore would not carry the earlier findings forward as though they were all still unresolved.** But the mixed test contains an important host-checkout shortcut.

## 3. Confirmed launch gap: the requested starting branch can disagree with the contracted commit

**Classification:** source-confirmed contract and fixture-fidelity gap. The live App manifestation was not reproduced here.

### Concrete triggering sequence

Suppose primary `main` is at **R0**, while the coordinator’s disposable branch commits local work A at **R1**.

B’s generated contract correctly requires R1. Its requested selectors nevertheless contain:

```text
starting_revision: R1
starting_branch:   main
```

`validateRequestedWorktree()` verifies that the declared `starting_revision` matches the contract. `assertBranchReservation()` checks the **executor branch’s** reservation and availability. Neither establishes that the **starting branch resolves to R1**.

`taskLaunchView()` then emits a native App request whose starting state names the branch. It does not use the exact revision as the host checkout selector. A host honoring that request starts from `main` at R0.

The executor subsequently reaches `liveActivationFacts()`, which correctly rejects it:

> “Executor worktree is not at the exact task baseline”

**Impact:** the system can authorize a creation request that cannot satisfy its own start contract. The failure occurs after native task creation, creating avoidable retained-task and recovery work.

This is **not** evidence that the executor silently works against the wrong revision. The start guard is valuable and must remain.

### Why the connected test does not catch it

The released test `v0.9 CLI activates a clean run through current launch-era wiring` creates a separate coordinator branch and commits A there. Its requested `starting_branch` is still `main`.

But its fake host creates the executor using:

```text
git worktree add --detach <executor-path> <exact-baseline>
```

—not the emitted starting branch. Primary is merged only later. Thus the fixture gives the executor the checkout the contract **needs**, rather than the checkout the host request **asks for**.

This limits the claimed end-to-end coverage at a consequential boundary.

### Smallest action

For a supervised trial using **unchanged v0.9.12**, require this check before the native creation call:

> **The emitted starting branch must resolve exactly to the task contract’s `current_baseline.revision`.**

Usually that means using the coordinator’s named delivery branch after A is committed—not assuming `main` is current. Keep that branch stable until B authenticates its start. This is a read-only launch precondition, not journal repair.

For the next bounded code correction, validate that relationship before authorizing first creation, while preserving the start-time check against later drift.

Correct the existing fixture so the fake host materializes the **actual emitted branch selector**. Keep primary behind the coordinator. The positive case should use the correct branch; the wrong-branch variant should check the rejection point and side-effect count.

**Trial disposition:** manageable with the explicit pre-dispatch restriction. **Broad or unassisted mixed rollout:** automate the check first.

## 4. Confirmed test defect: a fixed “next version” is now the current release

**Classification:** source-confirmed test-identity defect. Its resulting assertion failure is a static prediction, not an executed test result. It does not demonstrate a production upgrade failure.

In `test/refresh-v09.test.mjs`, the provisional/opaque variants named:

```text
applyRefresh retires an assigned …-first launch
whose iteration projection is absent
```

create their source using `createActiveTaskLaunch()` from the current package, but create the target with:

```javascript
copyCurrentPackage({ version: "0.9.12" })
```

The test then expects inspection to return `refresh-ready`.

At this release, the producer is also **0.9.12**. `activateFixtureRun()` acquires the current package bundle, and `RUNTIME_DIRECTORY` is derived from `PACKAGE_VERSION`, now `"0.9.12"`.

The target therefore finds an active run in its **current namespace**. If authentication succeeds, `inspectRefresh()` returns `resume-source`, not the expected `refresh-ready`. An earlier authentication failure would likewise not establish the intended upgrade test.

These tests are included by the normal `test:v09` glob. **Pre-promotion test results cannot automatically be transferred to the stable tag when the version change alters the scenario itself.**

### Smallest action

First run the exact focused group at the released source:

```sh
node --test --test-name-pattern='applyRefresh retires an assigned' test/refresh-v09.test.mjs
```

Then correct the test-only target identity so it is deterministically distinct from and later than its producer. Keep the genuine frozen-v0.9.11 producer in the separate historical-settlement journey.

A test-only correction can exercise the **unchanged released executable bytes**. Do not rewrite the release tag or relabel candidate code as an authentic old producer.

**Trial disposition:** resolve this small verification defect before relying on inherited regression evidence. It does not require another production architecture or invalidate the reported installed-stable gate.

## 5. Supported-environment restrictions and remaining risks

### Automatic reporting has a deliberately narrow host contract

`lib/codex-app-report-adapter.mjs` fixes the supported configuration to:

| Setting          | Required by the inspected adapter                    |
| ---------------- | ---------------------------------------------------- |
| Binary           | `/Applications/ChatGPT.app/Contents/Resources/codex` |
| Expected version | `codex-cli 0.153.4`                                  |
| Data root        | Current user’s `~/.codex`                            |

`validateNativeQueueConfiguration()` enforces exact equality. The completion hooks also depend on App-provided `$PLUGIN_ROOT`, `$PLUGIN_DATA`, completion events, and `node`. Coordinator registration requires matching App-created worktree ownership metadata.

This is a **support boundary**, not a newly discovered defect, and not a claim that your current installation matches it.

For the first trial, use the already-supported same local App host. Confirm actual delivery for the new project’s sender/recipient mapping. A changed App binary, custom data home, or other platform can break automatic reporting independently of successful Git operations.

The documented manual fallback is honest fallback, but **manual forwarding does not count as automatic-reporting success**. Likewise, queue acceptance is not actual delivery.

### Existing projects require eligible history—not merely inactive history

A project with no Flow state is the simplest starting point. An existing project is suitable when its supported prior assignments actually completed and the exact v0.9.12 inspection reports `fresh`; admission then revalidates.

The released classifier intentionally refuses reclaimed modern runs without an exact retired assignment, and missing-root abandoned executions do not become settled merely because their fences are empty. Pending handoffs retain precedence over ordinary activation.

**Do not use unresolved history as trial onboarding material and then unplug it to make the trial pass.** A `live-source-required` or `refresh-ready` result is a different transition, outside the first trial’s simplest scope.

The deliberately blocked plugin source repository does not prove ordinary-project use is broken. It does establish that **“upgrade every existing Flow project automatically” is not an appropriate rollout claim**.

### Real-project transfer is still the main untested question

The live v0.9.12 gates were coordinator-only in the retained canary. The mixed CLI test is substantially more connected than earlier tests, but uses simulated host behavior and contains the starting-branch shortcut above.

Consequently, first-turn dispatch, actual executor-to-coordinator reporting, project-specific verification, and complete mixed retirement in an ordinary project remain **plausible integration risks requiring the trial**, not established current defects.

That is a reason for a small supervised trial—not another broad audit.

## 6. The smallest useful trial

Choose **one reversible, low-risk improvement in one ordinary repository with existing automated checks**. Avoid deployments, dependency-system migrations, and unrelated cleanup. Keep the exact released package fixed throughout the assignment.

### Before dispatch

Complete the two focused verification checks above. Confirm package/skill and host compatibility, preserve a normal Git recovery point, and inspect existing Flow state without modifying it.

Use a **real disposable coordinator worktree** and a named delivery branch established before run authority is bound. Keep unrelated edits and concurrent branch manipulation out of the trial. The director must use the generated preparation and complete first prompt—not the plugin-development source-only exception.

### One mixed delivery

The coordinator registers reporting, then commits useful local work **A**. One bounded executor performs **B**, which genuinely depends on A’s committed contents.

Immediately before creation, verify that B’s emitted starting branch resolves **exactly** to its contracted baseline. Hold it stable until authenticated start.

B should change actual project behavior or meaningful tests, not just create a sentinel file. Integrate into the coordinator’s explicitly named delivery branch and run the project’s relevant checks. The public `main_branch` field is mandatory and names the integration target; it is not an instruction to switch prematurely to primary.

### Complete the real ending

Retire the executor through owning-host closeout. Close the coordinator run through its current audit, preserve the delivered result in primary under the approved integration policy, and confirm that the final actually reaches the director.

The director accepts that exact result and completes coordinator archival/reclamation and locator retirement. Check **recorded terminal state and preserved work**, not just disappearance of a worktree. The released cleanup path uses non-force removal and exact branch-tip deletion checks; do not bypass those protections.

Then dispatch **one fresh successor coordinator** to verify the delivered behavior through the public path and complete its own normal ending.

For an existing project with supported prior-version history, beginning this trial on v0.9.12 already exercises upgrade admission. For a clean project, do not invent a future version or downgrade the real project merely to manufacture an upgrade test. Keep the release’s upgrade evidence distinct and repeat the post-closeout successor check at the next real package change.

**Do not test an in-flight package upgrade in this first trial.**

## 7. Stop conditions

| Observation                                                                                                                          | Response                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Starting branch/baseline, project, task, or runtime identity disagrees                                                               | Stop before creation where possible. Preserve the mismatch; do not silently choose another identity.       |
| Creation, reporting, or archival is ambiguous; the recipient is wrong; preservation cannot be established                            | Stop dependent work and destructive cleanup. Do not repeat a potentially completed host action.            |
| Progress requires journal editing, recreating old checkouts, forced deletion, unplugging unrelated history, or installing another RC | End the trial as incomplete and preserve the failed segment. Do not turn it into a rescue campaign.        |
| The director repeatedly reconstructs protocol state instead of deciding scope and acceptance                                         | Record that as a trial failure for low-babysitting delivery, even if someone eventually completes cleanup. |

A small manual record of substantive decisions, protocol-recovery interventions, and completed lifecycle outcomes is enough. No telemetry platform is needed.

## 8. What must happen now, and what can wait

| Item                                                                                                      | Timing                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Faithful checkout-request rehearsal and exact starting-branch/baseline check                              | **Before mutating executor dispatch**                              |
| Correct producer/consumer identities in the implicated refresh tests; focused rerun against release bytes | **Before relying on stable regression evidence for the trial**     |
| Supported host, generated handoff, route readiness, disposable placement, eligible prior state            | **Before work begins**                                             |
| Automatic early starting-branch validation in product code                                                | Next bounded correction; **before broad/unassisted mixed rollout** |
| Successful mixed trial in an ordinary project                                                             | Required before recommending wider rollout                         |
| More platforms, general historical-state repair, large test-performance work, more agent roles            | Defer; not prerequisites for this restricted trial                 |

## Bottom line

**Proceed toward one supervised ordinary-project trial after the two narrow verification checks. Do not declare broad rollout readiness yet.**

The historical-settlement change is substantive, and the earlier launch-membership and assignment-boundary fixes are present. The remaining production gap is a **missing consistency check between a generated contract and its host request**, not evidence that the entire lifecycle needs redesigning.

The trial should now answer the practical question the canaries cannot: **can the plugin deliver a modest real change, with one dependent executor, and finish without recruiting the director into another protocol-recovery project?**
