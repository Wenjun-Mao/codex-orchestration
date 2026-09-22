# Codex Orchestration: follow-up architecture and delivery-process audit

**Decision:** Pause candidate promotion for a focused correction of the assignment lifecycle and its run-retirement boundary. Keep the director/coordinator/executor architecture. Do not start a rewrite, add a recovery framework, or install another candidate merely to discover the next missing local transition.

**Repository:** `Wenjun-Mao/codex-orchestration`  
**Requested branch:** `codex/v0.9.11-lifecycle-reliability`  
**Inspected commit:** `fa2b548b0310603a359539bf5b25f2bfbfa06695`  
**Inspected tree:** `fc422db04a5113d765c71e9b9ecc0d806372898e`  
**Comparison baseline:** released v0.9.10, `21096a7ad7aca10221a90bcb1b404dbb0c89aacc`  
**Review date:** September 9, 2026

## 1. Assessment and evidence boundary

The earlier corrections are substantive. Coordinator-work can now be consumed as dependency authority; persisted local start/completion can be reconciled without manufacturing new timestamps or repeating successful checks; assignment acceptance and cancellation select their terminal state under the assignment lock. The latest ownership correction also properly distinguishes a repository/run snapshot from stable coordinator ownership. These are improvements to the existing design, not cosmetic additions. [S4], [S5], [S6], [S10], [S21], [S22]

What remains structurally wrong is that **several locally valid records collectively represent a workflow state for which no ordinary command owns the next transition**. Registration can publish an open assignment before its required dependents exist. Cancellation can depend on execution evidence that refresh has deleted. Coordinator reclamation can proceed without establishing that the associated Flow run has stopped. The system consequently has both false blockers and insufficient cross-stage eligibility checks. [S6], [S7], [S8], [S9], [S11], [S12], [S13]

This is more specific than “overengineering” and more consequential than missing a few assertions. The smallest useful redesign is to make the existing assignment lifecycle own **registration readiness, terminal execution evidence needed after retirement, and coordinator-closeout eligibility**. Its dependent records should consume those decisions rather than independently assume that another stage already made them.

### Versions must remain distinct

| Evidence surface | What can be concluded |
| --- | --- |
| Released v0.9.10 at `21096a7…` | Historical baseline. Do not attribute subsequent corrections to this release. |
| Installed v0.9.11 RC2 | The user and tracked incident note report the defective snapshot-equality classifier and the stranded registration. I did not inspect the installed artifact, caches, sessions, or live state. |
| Source at `fa2b548…` | Directly inspected. Contains the ownership/snapshot correction and expanded tests. `package.json` still says `0.9.11-rc.2`; that label does not make these bytes identical to installed RC2. A future packaged candidate needs a new immutable identity. |

The exact commit was accessible through GitHub; `main` was not substituted. The tracked incident note explicitly distinguishes the installed candidate from source-only corrections. [S1], [S2], [S3]

### Evidence labels used below

- **Inspected:** a fact visible in source, test code, a plan, or an ADR at the exact review commit.
- **Reported:** an account of an App incident or test result supplied by the user or recorded in the repository; not independently reproduced here.
- **Static inference:** a consequence traced through inspected code, with an executable verification proposed.
- **Hypothesis:** an optimization or design expectation requiring measurement.

**Execution limits:** No repository tests, benchmarks, App canaries, installations, or state mutations were executed in this audit. A container download attempt failed because the network proxy could not be resolved; connector source inspection remained available. Reported suite results are not relabeled as reviewer-run results. No repository files were changed. This is a targeted architecture audit, not an exhaustive security review.

## 2. Most consequential stage connections

“Authority” here means the record that permits a particular next action, not simply any copy of an identifier.

| Connection | Current authoritative records and owner | Assessment |
| --- | --- | --- |
| Approved intent → delivery preparation | Immutable approved-plan snapshot and assignment preparation; director owns intent | Keep. Preparing intent does not prove that a run or reporting route is ready. |
| Run activation → assignment registration | Run/runtime binding; then assignment, iteration, route, recipient bindings, and locator | **Incomplete registration boundary.** The assignment is persisted as open before its required iteration/route/locator chain finishes. |
| Local work → dependent work | Coordinator-work result and checks; workflow claim; generated dependent contract | Improved. The completed local record is now a legitimate producer, and the consumer checks its identity and presence in the current baseline. |
| Executor result → integration → preservation | Receipt/disposition, integration-scoped verification, named preservation owner | Keep the distinctions. A delivery branch can legitimately be ahead of primary. Preserve the exact authenticated owner, not an arbitrary surviving ref. |
| Report transport → acceptance | Assignment-lived route/locator and report record; director's acceptance in assignment authority | Transport acceptance is not execution completion or product acceptance. Locked terminal selection improved; coordinator cleanup still needs execution-terminal eligibility. |
| Refresh → later cancellation | Assignment execution-binding history survives; old execution namespaces and consumed handoff are removed | **Lifetime mismatch.** Cancellation still rereads every historical namespace's lifecycle file. |
| Acceptance → archive/reclamation → next assignment | Assignment decision, iteration members, host archive evidence, exact Git preservation; run state remains separate | **Incomplete join.** Host-idle and Git-preserved do not establish that a Flow run has stopped. Test the next public consumer, not just “worktree absent.” |

Source basis: registration and CLI [S7], [S8], [S9]; local work [S4], [S5]; preservation/reclamation [S11], [S12]; refresh/cancellation [S6], [S13], [S14].

The presence of multiple records is not by itself waste. Run execution, report delivery, user acceptance, host archival, and physical reclamation genuinely have different lifetimes and permissions. The defect is **duplicated or implicit transition decisions without a shared completion rule**, not necessarily the number of files.

## 3. Prioritized findings

### F1 — P1: assignment registration has no coherent incomplete-state contract

**Classification:** inspected write order; reported RC2 manifestation; high-confidence static risk remains in the reviewed source.

**Relevant code at `fa2b548…`:**
- `lib/report-routes.mjs`: `registerCoordinatorReportRoute()`.
- `lib/assignment-authority.mjs`: `createAssignmentAuthority()`.
- `bin/codex-flow.mjs`: `commandReportV09()` and the assignment `status` branch.
- `lib/assignment-acceptance.mjs`: `cancelAssignmentResult()` and `assertIterationCancellationEligible()`.

`registerCoordinatorReportRoute()` creates assignment authority, then iteration membership, then the route. The CLI installs the repository report locator afterward. The assignment's initial state is already `open`. The sender registration lock and individual record locks protect concurrent access, but do not turn this multi-file sequence into one crash-atomic operation. [S7], [S8], [S9]

**Concrete failure sequence:**
1. The coordinator activates an authenticated run.
2. Registration persists an open assignment with its route and iteration identifiers.
3. Iteration creation rejects an ownership condition, or the process interrupts before route/locator completion.
4. Assignment lookup sees an open assignment, although reporting/iteration state is incomplete.
5. `assignment status` reads the iteration unconditionally; cancellation also requires iteration and route records. Neither provides the ordinary incomplete-registration exit.
6. A new installed implementation cannot simply take over run-scoped registration without violating the pinned runtime boundary.

The tracked RC2 incident reports this shape. Correcting the classifier removes one trigger, but does not remove the partial-persistence class. The source-only test that manually creates assignment authority before retrying registration demonstrates a useful library replay case, not recovery of the installed pinned RC2 execution. [S3], [S7], [S8], [S9], [S22]

**Cheapest verification:** In a disposable repository, invoke the public registration command through the acquired runtime. Interrupt after assignment persistence, after iteration persistence, and before/after locator installation. Restart that same runtime and exercise status, exact retry, and the supported abort path. Assert that no extra task/route/assignment is created and preserved work remains unchanged. Separately test a deterministic ownership rejection before publication.

**Needed correction:** Give registration one owner and one publication point. Validate predictable failures first, but also represent and reconcile interruption. Preflight alone is not a transaction. Do not weaken ownership checks or teach agents to edit JSON to complete the sequence.

### F2 — P1: refresh removes evidence needed by a later cancellation of the same assignment

**Classification:** high-confidence static inference; not reproduced in this audit.

**Relevant code:**
- `lib/assignment-acceptance.mjs`: `terminalExecutionEvidence()`, `cancelAssignmentResult()`.
- `lib/compat/refresh.mjs`: `consumeRefreshActivation()` and source-retirement handling.
- `lib/assignment-authority.mjs`: `bindAssignmentRefreshExecution()`.

Cancellation iterates over `assignment.execution_bindings` and reads each binding's `codex-flow/<namespace>/runs/lifecycle.json`. It requires the exact run to be terminal. Successful refresh appends a target execution binding to the same open assignment, then removes the old source namespace and consumed handoff. The historical binding remains, but the lifecycle file required by cancellation does not. [S6], [S8], [S13], [S14]

**Concrete failure sequence:**
1. Register assignment A on source run R1.
2. Refresh unfinished work into R2 while preserving assignment A.
3. Consume the handoff; the R1 namespace is legitimately removed.
4. R2 later fails and is lawfully stopped with its remaining obligations accounted for.
5. Cancel assignment A.
6. Cancellation attempts to reopen R1's deleted lifecycle file before it can record cancellation.

This differs from the new frozen-RC test: that test cancels the predecessor assignment **before** refresh, then creates a different successor assignment. It does not exercise cancellation of one assignment spanning the deleted namespace. [S16]

**Cheapest verification:** Extend an existing open-assignment refresh test through source deletion, target-run termination, and cancellation of that same assignment. No live App is required. Assert that completed source work survives, remaining ownership obligations are retained, and the next permitted assignment can proceed.

**Needed correction:** Before deleting an execution namespace, retain the finite authenticated terminal/retirement evidence its longer-lived assignment will need. Store it with the existing execution binding or another already-owning record, not a new general evidence registry. A digest alone is insufficient if every byte needed to validate its meaning is discarded.

An alternative is to retain source evidence until the assignment terminates. That reduces summary design but retains more state and interacts with foreign-namespace admission. Whichever approach is chosen, deletion must follow the last required consumer; missing files must never be interpreted as successful termination.

### F3 — P1: coordinator acceptance can reclaim a worktree while its Flow run remains active

**Classification:** inspected missing cross-stage condition and a test path that permits it; operational consequence is a static inference.

**Relevant code:**
- `lib/iteration-registry.mjs`: `assertMemberEligible()`, `coordinatorGitAuthority()`, `closeoutIterationWithOwningHost()`, `reclaimableIterationWorktree()`.
- `lib/assignment-acceptance.mjs`: `acceptAssignmentResult()`.
- `test/assignment-lifecycle-v097.test.mjs`: frozen RC1 → current successor journey, approximately lines 1650–1870.

The coordinator eligibility branch permits closeout when `allowCoordinator` is set; Git authority verifies a clean disposable checkout and primary preservation. The path also requires appropriate host-idle/archive evidence. It does not establish terminal status of the corresponding Flow execution before removing the coordinator worktree. [S10], [S11], [S12], [S26]

The frozen-RC public-CLI test activates its successor run, registers its assignment, injects a report through the reporting helper, merges the preserved branch, accepts, and reclaims the coordinator. It does not start/complete the successor's planned local task or close the successor run before reclamation. It finishes by asserting worktree absence, not terminal run state and subsequent admission. [S16]

**Concrete failure sequence:**
1. A coordinator is idle at an App turn boundary but its Flow run is still active.
2. The director accepts a report; the current Git result is already preserved in primary.
3. Owning-host archival and exact worktree reclamation succeed.
4. Assignment/iteration reach terminal closeout while active execution authority still refers to the removed checkout.
5. The next assignment or an attempt to close/resume the old run encounters contradictory state.

This is not evidence of lost committed work—the preservation guard remains important. It is evidence that **App idleness, acceptance, and run termination are different facts**.

**Cheapest verification:** Extend that existing CLI test. Assert the run is active before acceptance; require coordinator archive/reclamation to wait for a legitimate execution-terminal transition; then complete the correct run path and admit the next assignment. Assert no archive action is emitted merely because an App task is idle. Include an explicitly approved failed-run exit separately from successful completion.

**Needed correction:** Use the assignment's exact execution binding and authoritative terminal evidence as closeout eligibility. Acceptance may record the director's decision before cleanup finishes, but must not implicitly stop execution or authorize deletion of an active run's checkout. Reuse the same terminal-evidence contract needed by cancellation rather than invent another independent status check.

### F4 — P2: the connected tests still bypass some of the connections they are intended to prove

**Classification:** inspected verification gap; not a claim that the suite is generally poor or unit-only.

The mixed journey now genuinely exercises local A, dependent visible B, integration on a non-primary delivery branch, audit, reporting, coordinator reclamation, and successor registration. This deserves credit. But it calls lower-level library operations, supplies `retireLocator: async () => ({ status: "retired" })`, and starts its successor through `activateFixtureRun()` followed by direct route registration. It therefore does not establish real locator retirement plus the public activation/registration entrypoint under the successor's host-owned worktree identity. [S15], [S17]

The common activation helper acquires a runtime and admits a run; it does not itself produce every record the normal CLI produces. This is appropriate for isolated core tests, but too weak as the final proof of an ordinary supported command journey. The frozen-RC test improves entrypoint fidelity, yet terminates too early as described in F3. [S16], [S17]

**Cheapest correction:** Upgrade one existing successful journey rather than create a parallel framework. Use the packaged/pinned CLI for activation, registration, final run closure, assignment closeout and successor admission. Use the real local locator installation/retirement code. Fake only the genuinely external App observations/transport at the typed adapter boundary. Then execute one useful successor operation.

Keep direct-library tests for focused state and concurrency cases. Test-only corruption is legitimate in negative tests; it is not legitimate evidence that the product itself can produce or repair a success-path intermediate state.

### F5 — P2: agents still have to compose machine-level protocol details that commands could derive or check earlier

**Classification:** reported planning mistakes plus inspected ergonomics; not evidence that the corresponding rejection guards are wrong.

The coordinate skill says to activate a run, register reporting, represent ownership and dependencies, launch work, close children, close the run, and return a final. The refresh skill already says completed coordinator work must not be reissued. The canary's two planning mistakes therefore should not be reclassified as product acceptance bugs. [S23], [S24]

However, branch reservations, task branches, successor baselines, and exact replacement semantics are still assembled across multiple requests. Even the test activation builders derive path/resource fences while taking branch fences separately. A small product change can therefore require substantial protocol reconstruction around it. [S19]

**Smallest improvement:** Derive planned launch reservations and activation requests from one existing planned-task representation, or validate them together before activation commits. Do not silently enlarge authority after launch fails. Refresh output should clearly separate completed work preserved in the baseline from unfinished work eligible for reissue, and supply canonical replacement facts where already derivable. Let the model choose the allowed disposition, not recreate unchanged machine facts.

Replace duplicated request construction and repeated explanatory instructions; do not add a new planner agent, reservation service, or model-routing system.

## 4. Smallest coherent intervention

### Recommended scope: one assignment-lifecycle boundary correction

The current role design is not the redesign target. Nor is the result-preservation model, which correctly distinguishes executor result owners from final coordinator preservation.

Use the existing assignment record as the control point for the following three transitions:

**A. Registration: prepared → registering → open, or a lawful cancelled/aborted outcome.**

`registerCoordinatorReportRoute()` currently owns more than reporting. Move that coordination responsibility into the existing assignment lifecycle; reporting becomes a dependent operation. The existing assignment record can express incomplete registration instead of being published as `open` immediately. Do not add a second registration ledger.

Preflight owner/recipient/runtime conflicts before publishing readiness. Stage immutable payloads where useful. Reconcile deterministic iteration, route and locator records from the same assignment/preparation identity. Publish readiness only when the complete local chain is usable. Preserve original timestamps and progress on retry.

Status must distinguish an expected unfinished registration from a missing record belonging to a previously ready assignment. The first can resume or abort; the second remains corruption/ambiguity requiring investigation. Do not broadly make all missing records acceptable.

The existing assignment cancellation/abort path should understand incomplete registration, after any associated execution is stopped through its lawful runtime. It must preserve work and historical failure evidence, and must not claim absent resources were archived. This is a future product transition—not permission to hot-switch the already failed RC2 run or write a version-specific rescue command.

**B. Execution retirement: preserve the required terminal fact before deleting its source.**

Record a bounded, validated execution-terminal/retirement fact with the existing assignment execution binding before source namespace deletion. Include the identity and disposition information needed by cancellation, successful closeout and successor checks. Carry unresolved or transferred obligations explicitly; an abandoned run is not equivalent to zero remaining obligations.

This replaces later attempts to reconstruct terminal authority by reopening deleted source paths. Reuse source-runtime authentication and the existing refresh ordering. Do not preserve a bare “closed” flag or infer success from absence.

**C. Coordinator closeout: one execution-terminal eligibility rule.**

Acceptance records the director's decision; physical coordinator archival/reclamation waits for the bound execution-terminal condition plus the existing host and Git guards. Cancellation consumes the same evidence. This removes the implicit assumption that an accepted final or an idle App task proves that the run has stopped.

### What this replaces or removes

| Current mechanism or burden | Replace/consolidate with |
| --- | --- |
| Publishing an open assignment and hoping iteration/route/locator finish | One registration owner and an explicit readiness publication point in existing assignment state |
| Reporting code creating broader assignment/resource authority as a hidden side effect | Assignment-owned registration invoking narrower reporting/resource functions |
| Cancellation reopening every historical run namespace | Assignment-lived authenticated terminal/retirement evidence captured before deletion |
| Independent assumptions about whether coordinator deletion is safe | One bound execution-terminal eligibility rule consumed by acceptance/cancellation/cleanup |
| Model-authored duplicate branch/activation/replacement facts | Generated or jointly validated requests from existing task/refresh state |
| “Connected journey” success with stubbed local retirement and a lower-level next-run shortcut | One existing journey upgraded through the real command consumers |

Do not merge transport acceptance with human acceptance, host archival with Git reclamation, or failed cancellation with successful delivery. Those are genuine distinctions. Do not remove immutable runtime snapshots merely to let newer code mutate an old active run.

### Why not merge every file or introduce a database?

A single assignment/iteration document could reduce local multi-file states, but would also couple report history, resource membership and host progress, require broader schema changes, and leave external actions non-atomic. The current evidence does not justify that larger migration first.

Conversely, retaining all current records is acceptable only if their roles are clear: one record owns the transition decision; dependents are reconciled from it. Several `atomicWriteJson()` calls under mutexes are not one crash-atomic commit. The proposed publication/replay semantics solve that without pretending the filesystem or App participates in a global transaction.

Stop the bounded redesign if it starts requiring a generic transaction engine, a second ownership registry, or a new version-specific recovery layer. Reassess the representation then, rather than stacking more exceptions.

## 5. Failure attribution and process changes

| Incident or risk | Primary classification | Correct response |
| --- | --- | --- |
| Missing executor branch reservation | Reported planning error; command ergonomics contribute | Keep rejection; derive/check planned reservations before activation. |
| Reissuing completed work or changing replacement scope | Reported planning error | Keep semantic guard; surface preserved work and canonical permitted reissue. |
| Cancelled same-path membership blocking a lawful successor | Product ownership-model defect; latest source correction is appropriate | Keep one classifier at admission and reclamation; retain exact cancelled predecessor evidence. |
| Revision-bearing digest treated as stable repository identity | Product data-model misuse; corrected in reviewed source | Keep snapshot checks within their execution; use actual stable owner/repository identity across assignments. |
| Assignment-only registration with no ordinary exit | Product lifecycle defect | Fix future registration/cancellation semantics; disposable canary reset is not the fix. |
| New code cannot hot-switch installed RC2 | Intended runtime protection exposing an earlier product defect | Preserve the boundary; separate source repair, candidate validation, and old-state disposition. |
| Repeated RC installs discovering local prerequisites | Verification/release sequencing issue | Complete local command journeys and failure exits before installing a new candidate. |

The isolated canary and source-only outer development episode are improvements. Self-hosting should remain a deliberate upgrade test, not a requirement that an unfinished candidate govern its own implementation. But registration, cancellation and active-run cleanup defects can affect ordinary projects; self-hosting is not an excuse for them.

The existing v0.9.11 plan already specifies most of the right goals. Writing another broad plan is unlikely to help. Convert its exit criteria into a small set of executable consumer checks and use those checks to decide when a candidate is ready. [S20]

## 6. Lean verification and release plan

### 6.1 Retain, extend, combine, and remove

**Retain** the focused coordinator dependency/replay tests, deterministic terminal-state races, real-Git preservation-owner cases, dirty/wrong-owner/active-host rejection, no-replay archive cases, and narrowly relevant frozen-source compatibility tests. These protect distinct behavior. [S4], [S5], [S6], [S12], [S16], [S21]

**Extend one ordinary journey** through the real packaged/pinned CLI and local registration/retirement code: prepare → activate/register → actual local commit and verification → optional dependent executor/integration → audited run closure → reporting/acceptance → real locator retirement and exact coordinator cleanup → public successor activation/registration → useful successor work. Keep primary behind delivery until the legitimate preservation step. Use local-only and mixed variants only where the different producer/consumer paths matter. [S15], [S20]

**Add two bounded failure endings to existing fixtures:**
- Registration interrupted at each local persistence boundary, then exact replay or lawful abort and successor admission.
- One still-open assignment refreshed across source deletion, then its target run terminates and that same assignment cancels successfully.

**Correct the active-run reclamation test path:** the current frozen-RC successor test should not regard worktree disappearance as completion while leaving an active run behind. Make the missing run-terminal condition explicit; finish with next-consumer assertions. [S16]

**Remove or replace success-path shortcuts only from the final journey proof.** Keep library-level fixtures for unit tests. Keep manually damaged state in tests specifically proving rejection or interruption recovery. Do not forbid all constructed fixtures or force every validation predicate through an expensive whole-system setup.

The existing preservation outcome matrix can remain focused; do not multiply every result kind by every host state, every predecessor version and every crash point.

### 6.2 Where test cost plausibly comes from

The four-to-five-minute duration is reported, not measured here. The inspected code identifies concrete costs worth profiling:

| Inspected source | Cost mechanism | Low-risk optimization to test |
| --- | --- | --- |
| `package.json` test script | All matched test files run with `--test-concurrency=1` | Measure before changing. Consider parallelizing only independently isolated file groups; do not globally flip concurrency around shared environment/host paths. |
| `test/helpers.mjs` | Fresh Git initialization/configuration/commit subprocesses; runtime-bundle acquisition per fixture | Keep mutable repositories independent. Cache only immutable test package inputs where safe. |
| `lib/runtime-bundle-source.mjs` called by fixtures | Walks, reads and hashes the entire runtime source inventory on each call | Test-only memoization of unchanged source bytes by exact package identity; bypass it for tamper/packaging tests. |
| `test/refresh-v09.test.mjs` and frozen-RC fixture | Repeated `git archive`/tar extraction, package-tree copying, and Node CLI subprocesses | Share read-only extracted source packages within an appropriate test scope; preserve independent runtime state and copy before mutation. |
| Large lifecycle fixtures used for narrow policy checks | Full setup repeated to reach a small predicate | Move equivalent pure assertions to small fixtures while keeping a representative connected test for each distinct wiring path. |

Sources: [S2], [S17], [S18], [S19]. These are candidates, not measured savings. Record existing runner durations for affected files and a few setup phases before changing them. Optimize the slowest repeated setup that actually dominates; do not set an arbitrary speed or test-count goal.

### 6.3 Avoid serial discovery through RC installs

1. **Finish the three boundary decisions together in source:** registration readiness/abort, terminal evidence lifetime, and coordinator closeout eligibility. Resolve genuine scope changes once, not in a succession of installations.
2. **Run focused tests while editing.** Before packaging, run the exact generated canary command sequence in an independent Git repository with typed fake host results. Assert planned branch reservations, actual changing commits, and the next consumer. A test name is not proof of its runtime/worktree shape.
3. **Freeze a new candidate identity.** The reviewed source still declares RC2; do not overwrite the installed RC2 artifact or claim its old canary evidence validates changed bytes. Record source commit, payload identity and loaded runtime separately.
4. **Run the settled-candidate suite and packaging checks.** Reuse evidence only where later changes have not invalidated it. No unfinished test response counts as a pass.
5. **Run one scoped App journey for the changed host boundary.** Verify loaded identity, actual task/worktree ownership, completion-hook/queue delivery, owning-host archival observation, cleanup and successor admission. Crash/concurrency/JSON persistence variants belong in automated tests, not repeated App restarts. If upgrade behavior is changed and remains advertised, use a separately scoped exact-predecessor gate; do not entangle it with ordinary delivery.
6. **Promote only from completed evidence.** A deliberately failed disposable test may be preserved and disposed under explicit authorization, but its replacement does not establish that ordinary projects can recover from the same partial state. Report retained-history support separately from fresh-project support.

This process adds no new framework or standing agent. It makes the existing release plan's conditions operational.

## 7. Uncertainties and evidence that would change the decision

**Unverified here:** installed RC2 byte identity and exact live state; successful execution of tests at `fa2b548…`; actual per-file/setup timings; the full live canary; and whether any uninspected caller imposes a stronger invariant than the traced public paths. The new F2 and F3 sequences need executable confirmation. They are not claims that those failures occurred in the user's sessions.

Evidence that would narrow the recommendation back to ordinary bounded repairs:

- A public registration journey showing every partial state can be queried, resumed or lawfully cancelled, without direct journal edits, new identities or a hot-switched runtime.
- An open-assignment refresh followed by cancellation after source deletion, demonstrating a preserved authoritative terminal source that this trace missed.
- Acceptance/cleanup demonstrably rejecting an active Flow execution, followed by proper closure and successful next assignment admission.
- Packaged/pinned CLI journeys with actual commits, real local locator retirement and no hidden fixture repairs.

Evidence favoring a broader focused consolidation:

- The same assignment decision continues to require independent repair in several records after the proposed publication/replay model is applied.
- More than one component must independently decide execution termination or resource ownership from competing snapshots.
- Safe cancellation still requires version-specific rescue code for newly produced ordinary states.

A larger redesign should then remove a demonstrated duplicated authority or combine a genuinely inseparable local control record. It should not be justified by line count, frustration, or a desire for architectural novelty.

## Final engineering decision

**Keep the roles and the core safety distinctions. Pause the release-install loop. Redesign the small assignment/run handoff boundary now, using existing records and commands, and prove it through the next real consumer.**

The acceptance criterion is not that a determined director eventually closes the release. It is that ordinary work reaches a legitimate terminal state, its necessary evidence survives until the last consumer, and the next assignment can begin without the director reconstructing protocol state.

---

## Source references

All source links below are pinned to the review commit unless explicitly marked baseline. Line ranges identify inspected regions, not a claim of exhaustive file review.

[S1]: https://github.com/Wenjun-Mao/codex-orchestration/commit/fa2b548b0310603a359539bf5b25f2bfbfa06695 "Exact review commit"
[S2]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/package.json "Candidate label and serial test command"
[S3]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/docs/field-tests/2026-09-09-v0.9.11-rc2-assignment-only-registration-failure.md "Tracked reported incident; source versus installed evidence"
[S4]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/coordinator-work.mjs#L240-L535 "Coordinator-work start and completion replay"
[S5]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/workflow-journal.mjs#L1380-L1535 "Completed coordinator dependency consumption"
[S6]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/assignment-acceptance.mjs "Acceptance, cancellation, and terminal execution evidence"
[S7]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/report-routes.mjs#L460-L755 "Coordinator registration write order"
[S8]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/assignment-authority.mjs "Assignment publication and execution bindings"
[S9]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/bin/codex-flow.mjs#L1240-L1565 "Pinned registration, locator installation, status and acceptance CLI"
[S10]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/iteration-registry.mjs#L350-L935 "Iteration creation, eligibility, and ownership classifier"
[S11]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/iteration-registry.mjs#L1820-L2215 "Owning-host closeout"
[S12]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/iteration-registry.mjs#L1260-L1555 "Preservation and reclamation guards"
[S13]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/compat/refresh.mjs#L1880-L2180 "Refresh assignment binding and namespace removal"
[S14]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/compat/refresh.mjs#L1560-L1885 "Source retirement and origin evidence"
[S15]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/test/assignment-lifecycle-v097.test.mjs#L590-L855 "Mixed connected journey and its successor shortcut"
[S16]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/test/assignment-lifecycle-v097.test.mjs#L1650-L1895 "Frozen RC1 cancellation and current successor CLI journey"
[S17]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/test/helpers.mjs "Fixture activation and Git/runtime setup"
[S18]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/runtime-bundle-source.mjs "Full source inventory read and hashing"
[S19]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/test/refresh-v09.test.mjs#L1-L190 "Refresh fixture activation, extraction and package copying"
[S20]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/docs/plans/2026-09-09-v0.9.11-lifecycle-reliability.md "Approved delivery and release plan"
[S21]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/docs/adr/0066-lifecycle-transition-authority-and-replay.md "Transition authority and replay design"
[S22]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/docs/adr/0067-cancelled-coordinator-worktree-rebinding.md "Ownership versus snapshot correction"
[S23]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/skills/coordinate/SKILL.md "Coordinator workflow instructions"
[S24]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/skills/refresh/SKILL.md "Refresh and completed-work instructions"
[S25]: https://github.com/Wenjun-Mao/codex-orchestration/compare/21096a7ad7aca10221a90bcb1b404dbb0c89aacc...fa2b548b0310603a359539bf5b25f2bfbfa06695 "Released baseline comparison"
[S26]: https://github.com/Wenjun-Mao/codex-orchestration/blob/fa2b548b0310603a359539bf5b25f2bfbfa06695/lib/iteration-registry.mjs#L960-L1135 "Coordinator Git authority and preservation"
