# Codex Orchestration: post-closeout upgrade boundary audit

## Recommendation

**Make a bounded consolidation of predecessor classification, not a new lifecycle framework and not an ENOENT exception.** Classify authenticated terminal history before selecting a live refresh source. Use the same classification for inspection, explicit refresh preparation, non-selected predecessor checks, and public fresh admission.

For the reported topology—all predecessor runs normally closed, assignments retired, resources reclaimed, results preserved—the preferred outcome is **fresh admission under the new package while leaving authenticated historical records untouched**. There is no unfinished execution to refresh. Do not manufacture a live source by substituting primary for a deleted coordinator checkout.

This is an architectural simplification implemented through a narrow change set: retire duplicate interpretations of “settled predecessor,” not the director/coordinator/executor arrangement or the existing run/assignment separation.

## Scope and evidence

- Exact inspected commit: `ee24c2382a20acb0d50ab4a7dd8a7981653ec163`.
- Exact tree: `2ac33f79f602c395f55123aa83bed70302de1f5d`.
- Parent/released source: `6292c7fcb25744417590ce955dc7388bc9726a46`.
- The inspected commit adds the requested research note only. Its executable source is unchanged from that parent. [S1, S2]

**Inspected:** the starting note; selected/live source loading and export; historical settlement and fresh-admission paths; public run activation; run audit/closure; assignment retirement; relevant worktree reclamation and locator-retirement code; the named refresh regressions.

**Reported, not independently reproduced:** the RC4 mixed delivery and useful successor successes, their exact local records, installed stable identity, the subsequent App failure, and 226/226 tests in approximately 338.5 seconds. The sanitized note records these claims and their limits. [S3]

**Tests executed by this reviewer: none.** GitHub connector reads succeeded. A container Git connectivity attempt failed with `Could not resolve host: github.com`, so there was no local checkout or executable repository test run. No implementation, GitHub mutation, App action, or historical-state change was performed.

## 1. Confirmed findings and their limits

| ID | Finding | Evidence / priority |
|---|---|---|
| F1 | The selected predecessor is forced through live-checkout authentication before terminal-history classification. | Confirmed source defect; reported live manifestation. P1 availability/reliability blocker. |
| F2 | Inspection and fresh admission only share the narrow v0.9.7 settlement exception, not the broader closed-run audit interpretation. | Confirmed source limitation; an inspection-only correction would leave an admission blocker. |
| F3 | Catching the first missing-cwd failure leaves additional live-root dependencies in exporter execution, baseline derivation, preparation, and cleanup inspection. | Confirmed source dependencies; this is why a loader fallback alone is insufficient. |
| F4 | The reclaimed non-selected-run audit helper proves a narrower fact than complete assignment settlement and present-day preservation. | Confirmed scope limitation; unsafe to reuse unchanged as blanket permission for fresh admission or namespace deletion. |
| F5 | The named regression and two related tests retain the selected checkout and do not complete a post-reclamation public successor activation. | Confirmed coverage gap; not evidence that the entire suite is ineffective. |

### F1: selection happens before the relevant authority distinction

In `lib/compat/refresh.mjs::inspectRefresh`, unresolved predecessor candidates are reduced to one namespace. It chooses its active run or the most recently updated terminal run, then invokes `loadRefreshSourceAuthority`, and only afterward invokes `assertOtherRefreshSourceRunsSafe`. [S4]

In `lib/compat/refresh-source.mjs::locateRefreshSourceSnapshot`, the run/context content-addressing checks precede a Git invocation whose cwd is `context.repository.root`. Bundle/exporter authentication follows that invocation. A legitimately absent coordinator root therefore prevents the terminal-history path from being reached. [S5]

The source supports the reported diagnosis. The local observation that Git worked in primary but failed with the removed cwd remains reported evidence, not a separate reproduction by this reviewer. Recreating the worktree or changing Git's executable path does not address the source ordering.

**Cheapest initial reproduction:** in the existing reclaimed-predecessor regression, remove the newer selected checkout too. This isolates the branch mismatch cheaply. It is not the final product regression because that fixture removes worktrees directly rather than producing the entire assignment closeout.

### F2: a successful inspection is not an admission contract

`classifyFreshStartPredecessors` invokes `reconcileSettledV097CoordinatorPredecessor` for every foreign namespace. That helper only applies to namespace `v0.9.7`, with exactly one closed run and no active run. Other namespaces remain unresolved. [S4, S6]

The public `run activate` path calls `assertFreshStartPredecessors` under `foreign-active-run.lock` **before** preparing target state and admitting the run. Consequently, simply returning `fresh` from inspection for an RC4 namespace does not make activation accept it. [S7]

The additional `assertNoForeignActiveRunCollision` is justified: it detects competing active execution. It is not another full settlement interpretation and should remain. Its narrower purpose must not be confused with proof that inactive history is fully settled. [S8]

**Cheapest verification:** invoke public activation directly against the same preserved predecessor state, as well as after inspection. Both must use the same eligibility decision; activation must revalidate rather than trust a previous inspection response.

### F3: changing the cwd moves the error instead of removing the false dependency

The selected-source path contains several live-root requirements:

- `loadRefreshSourceAuthority` launches the source exporter with the recorded repository root as cwd.
- `deriveRefreshSourceAuthority` obtains a fresh `gitSnapshot` from that root and derives task/baseline semantics.
- `prepareRefresh` requires the caller's clean baseline to exactly equal the source's live root, branch, and revision.
- `assertRefreshNamespaceRemovalSafe` invokes `sourceCleanupPlan` using the selected source's runtime CLI and recorded root. [S9, S10, S11]

These are sensible requirements for live semantic refresh. They are the wrong abstraction for an already-retired assignment whose checkout no longer exists.

**Do not make the live loader accept a fake primary-root baseline.** Terminal history needs a different result shape that cannot be passed accidentally to live execution or semantic-reissue consumers.

### F4: existing evidence is useful, but its current helpers are not interchangeable

`assertReclaimedClosedRunSettled` authenticates the runtime/bundle, matching workflow journal, and a uniquely matching terminal-ready closure audit. Its caller separately checks terminal status and zero unresolved fences. It does not itself join retired assignment, accepted report, closed iteration, locator retirement, or current Git preservation. [S12]

This is not a demonstrated data-loss bug in the existing helper's limited use. It is a **scope warning**: “execution was audited closed” is not identical to “every assignment/resource obligation is retired and current preservation still holds.”

Conversely, `reconcileSettledV097CoordinatorPredecessor` joins assignment/report/iteration and Git facts, but is restricted by release name and single-run cardinality. Its `preservedNonHostRef` predicate requires a ref to point exactly at the captured tip; legitimate descendant preservation is not accepted by that predicate. Do not generalize it unchanged. [S5, S6]

The correction should reuse the evidence and validations, not choose one incomplete helper as the universal truth.

### F5: the tests preserve the very prerequisite that live closeout removes

The named test creates and closes an older run in a detached checkout, removes that checkout, then creates the newer selected closed run in surviving primary. It exercises inspection and namespace-removal eligibility plus audit tampering. It does not remove the selected root or admit useful work under the next runtime. [S13]

The related coordinator-work and selector-replan regressions repeat the older-missing/newer-live topology. Their distinct semantic coverage is valuable, but their repeated setup does not test the missing post-closeout connection. [S14]

The successful same-package successor is not contradicted by the later upgrade failure: discovery excludes the current namespace, whereas the same records become foreign history under a new package namespace. That change in classification surface is exactly why the cross-package ending matters. [S3, S11]

## 2. Architecture judgment

**Selected-versus-non-selected is the immediate branching defect. The deeper issue is that discovery policy determines which interpretation of terminal authority is available.**

A run's `updated_at` position should choose neither its safety standard nor whether its evidence can be consumed. A temporary coordinator checkout is execution infrastructure; after legitimate retirement, it must not remain a prerequisite for recognizing historical settlement.

The existing ownership boundaries mostly provide the necessary facts. Public closure uses a current terminal-ready audit. Assignment acceptance now waits for execution retirement and rejects retained obligations before coordinator closeout. Worktree removal revalidates exact ownership, cleanliness, and preservation and removes without force. Final assignment retirement follows closed iteration and reporting/locator retirement. [S15, S16, S17]

I therefore do **not** recommend another redesign of those producers. The missing boundary is at their historical consumer: upgrade discovery still treats completed history as potentially resumable execution by default.

### Minimal authority map

| Layer | Fact it owns | Historical consumer should establish |
|---|---|---|
| Run/runtime | Immutable execution binding and terminal status/fences | Exact supported binding; normally closed; no unresolved execution authority |
| Closure audit/workflow | Evidence permitting that execution to close | Matching terminal-ready audit, journal and revision; valid timing and integrity |
| Assignment/reporting | Accepted outcome and assignment retirement | Exact assignment/run relationship, accepted report and retired reporting obligations |
| Iteration/archive | Exact cleanup intent and completed member reclamation | Closed iteration and settled disposable members with captured result identity |
| Surviving Git repository | Present preservation and resource attachment | Correct common directory; captured result still preserved; no conflicting attachment |
| New admission | Permission to begin a new run | Revalidated predecessor classification plus ordinary new-run and collision checks |

“Closed execution,” “retired assignment,” and “preserved result” stay distinct facts. The shared classifier combines the facts needed by each operation; it does not replace them with a universal `done` field.

## 3. Smallest durable correction

### A. Authenticate records before selecting the live path

Refactor the existing predecessor analysis into one read-only classification in the existing compatibility module. Use conceptual outcomes such as:

- **Settled history:** no execution or assignment transition remains to perform for the applicable operation.
- **Live-source required:** supported unfinished/retained work needs the existing source-runtime path and live ownership checks.
- **Blocked/unsupported:** contradictory, incomplete, unresolved, or unsupported evidence.

These are conceptual results, not a recommendation for another stored registry or broad schema system.

Classification should authenticate supported lifecycle/context/bundle records without first executing Git in a potentially retired checkout. The historical root remains immutable provenance. Live repository checks remain mandatory before active execution or semantic refresh.

For the reported all-settled namespace, classify **every run**, not just the newest. If every relevant obligation is settled, fresh admission can leave the old namespace untouched. Do not create a no-op refresh handoff solely to remove history.

If a namespace contains a legitimate live source plus settled siblings, select the live source and reuse the same historical proof for the siblings. Do not choose another convenient older/live checkout to hide an unresolved newer run.

### B. Join existing evidence at the correct scope

For this post-closeout case, require:

1. Exact supported runtime/context/run/bundle identity; normal closed status and empty unresolved fences.
2. A matching authenticated terminal-ready audit and workflow evidence. Recognize the audit-before-close ordering rather than attempting to re-audit from a deleted cwd or rehash a deliberately changed terminal record as if it were still active.
3. The exact assignment-to-execution binding, retired assignment, accepted report, closed iteration, and corresponding reporting retirement evidence. A closed run with unfinished assignment cleanup is not this fast path.
4. Captured result identity from existing cleanup evidence and present preservation in the authenticated surviving destination, checked from the surviving common directory/checkout. For coordinator work, retain the existing primary-preservation semantics; allow a descendant containing the exact captured commit, not just a ref pointing directly at it.
5. Consistent resource absence/attachment evidence. An absent path alone is not proof of lawful reclamation; a reappeared or conflicting attachment must not be silently accepted.

Use existing locator-retirement validation rather than equating a missing locator with completed reporting. [S18]

For older or unassigned execution records, preserve their explicitly supported contract and existing limits. Do not fabricate assignment evidence or infer absence from a missing assignment file. Validate known schema/capability contracts rather than mechanically changing the v0.9.7 condition to “all v0.9 versions.”

**Sufficiency judgment:** existing records appear sufficient for the reported RC4-to-stable topology. This is source-supported, conditional on the unavailable local records satisfying those joins. A new universal settlement certificate or registry is not justified. If a required fact is genuinely absent, report that specific missing fact before adding storage.

### C. Give every consumer the same interpretation

| Consumer | Bounded change | Existing work removed/replaced |
|---|---|---|
| `inspectRefresh` | Classify history before live-source selection; return `fresh` for fully settled history | Newest-terminal selection forcing a live loader |
| `classifyFreshStartPredecessors` / `assertFreshStartPredecessors` | Reuse the classifier under the current admission lock | Sole reliance on an exact v0.9.7, single-run exception |
| `prepareRefresh` | Use the same classification; settled history produces a non-mutating direction to fresh activation, not semantic reissue | Requiring a deleted source baseline for work that has already ended |
| `assertOtherRefreshSourceRunsSafe` | Delegate historical classification; retain strict live cleanup when needed | Separate selected/non-selected settlement semantics |
| `assertRefreshNamespaceRemovalSafe` | Reuse settlement facts for historical siblings, but retain stricter last-consumer/removal requirements | Repeated live-root checks for already-settled historical execution |
| Existing v0.9.7 compatibility path | Preserve its supported evidence contract through a thin reader/policy adapter | Parallel full settlement algorithm, where equivalent validation can be shared |

Classifying history as non-blocking for admission does **not** authorize its deletion. The recommended fast path does not delete it. Existing semantic refresh, pending handoff replay, and namespace removal retain their own authorization and lifetime requirements.

### D. Revalidate at mutation, without broadening locks

Inspection is advisory. Public activation must rerun the necessary proof under `foreign-active-run.lock` and retain the existing active-run collision sentinel. Do not treat a previous `fresh` response as a durable authorization ticket. [S7, S8]

Keep current resource-ownership locks and live checks. A repository admission lock does not magically serialize arbitrary external Git commands; preserve the existing final checks at the mutations they protect. No App call belongs inside a new long-held lock for this correction.

## 4. Nearby contradictions: bounded disposition

**Required now:** selected-source bootstrap; exporter/cleanup live-root dependencies; fresh-admission divergence; all-runs namespace classification. These are immediate producer/consumer connections of the reported failure.

**Relevant when reusing the old helper:** exact-ref-tip equality, one-run cardinality, exact v0.9.7 scope, and initial-binding-only matching. Use the exact matching execution binding and effective resource identity supported by existing records; do not turn the newest assignment or first execution into a guess. Detached/named worktree differences must remain explicit.

**Preserve rather than redesign:** strict ownership during live work, source-owned semantic export, content-addressed runtime snapshots, exact preservation before deletion, active/abandoned unresolved-work protection, and pending-handoff identity checks.

**Optional, not release blockers by themselves:** clearer missing-cwd diagnostics; reuse of immutable bundle verification within one inspection; test setup reuse; historical namespace-retention policy. Retaining history encounters existing inventory bounds, so it is not a promise of unlimited state retention. Do not add a collector or weaken those bounds during this correction.

## 5. Cheapest decisive verification

### Primary public-operation regression

Extend an existing public-command closeout journey rather than create a second harness:

1. Start with a frozen supported source package in a disposable Git repository and real coordinator linked worktrees.
2. Complete and verify real committed work, then normal public run closure, accepted reporting, director acceptance, archive reconciliation, and exact worktree/branch reclamation. Fake only external host transport/observations at the existing adapter seam.
3. Complete a second useful source-package assignment and reclaim its coordinator too. Prefer a real baseline advance so an older captured tip is an ancestor rather than the current ref tip.
4. Assert no predecessor coordinator checkout remains, no relevant disposable branch remains, assignments/reporting are retired, and historical namespaces remain intact.
5. Invoke the next package's authenticated `refresh inspect` from surviving primary. Then perform **public `run activate`**, normal assignment readiness, and a useful local operation that reads the preserved result and commits/verifies a small change. Use the new pinned runtime.
6. Reinspect while the new run is active and complete its normal ending. Assert historical bytes were not rewritten, no old worktree was recreated, and no prior host action was replayed.

The correct route for an all-settled source is preferably `fresh`; testing the exact route should follow the chosen design. The non-negotiable endpoint is successful, correctly authorized new work—not an inspection status or direct low-level `admitRun` call.

The full mixed A-to-B lifecycle is already relevant evidence. The post-closeout regression need not repeat every executor variant to test predecessor selection. Add the upgrade tail to the reusable public closeout fixture and retain one representative frozen RC4/released-source case to establish backward applicability.

### Necessary negative cases

| Negative condition | Required result |
|---|---|
| Selected **or non-selected** active run with missing checkout; abandoned missing checkout; retained fences | Block, with no new run or host action |
| Forged/mismatched context, bundle, audit, workflow revision, ordering, or ambiguous settlement | Block; no fallback to another run merely because it is readable |
| Run closed but assignment accepted-not-retired, iteration pending, route/locator retirement incomplete | Not the fully settled fresh path; name the actual remaining owner/action |
| Captured commit no longer preserved; wrong common directory; conflicting recreated attachment | Block; no path substitution or root recreation |
| Preserving destination advances to a legitimate descendant | Pass; still require exact captured-commit inclusion, not arbitrary reachable similarity |
| State changes after inspection but before activation | Activation revalidates and refuses invalidated authority; direct activation receives the same protection |

Test selected/non-selected permutations through a compact table where they share the same predicate; do not duplicate the complete journey for every negative. Use deterministic barriers for concurrency where necessary, not sleeps. Corrupt copies are valid negative fixtures; successful producer records must come from the public path.

### Consolidate rather than accumulate

- Replace the named older-reclaimed/newer-live-only regression with the all-reclaimed producer-to-next-consumer journey, retaining its blocked-audit-then-valid-audit and corruption assertions.
- Fold the reclaimed coordinator-work and selector-replan cases into focused variants of the shared evidence classifier. Retain those semantic distinctions without recreating the entire version transition twice more. [S13, S14]
- Retain one exact legacy v0.9.7 compatibility journey if that release remains supported. Do not reproduce it for every new release number.
- Keep active semantic refresh and interrupted deletion coverage. Those cases exercise different permissions and are not redundant with passive historical classification.
- Profile this test group before making performance claims. Reuse frozen package extraction only where it is genuinely immutable; some existing tests modify package copies. Keep mutable repositories and journals isolated.

No runtime or savings measurements were taken here. The note's 338.5-second full suite is a reported observation, not proof of waste. A potential local optimization is avoiding repeated bundle authentication for the same immutable digest within one operation; do not cache mutable Git preservation or admission decisions across operations.

### Release gate

After local source and frozen-predecessor regressions pass, use one scoped installed post-closeout upgrade check: normal closure/reclamation under the source artifact, load the next artifact, inspect, and perform useful new work. Reuse applicable mixed-delivery evidence rather than adding another full orchestration campaign.

If testing against the retained real canary is authorized, it can establish applicability without recreating history. That is separate from this review: no recovery action or installation is authorized here.

## 6. Why this prevents the family rather than relocating it

The proposed invariant is: **for every supported predecessor, its settlement meaning is independent of selection order and of whether the caller is inspection or admission.**

The implementation change removes the need to call any live-source loader for history that has already been authenticated as settled. It also prevents the next command from applying a contradictory interpretation. The old checkout path remains evidence of what ran; it is neither rewritten nor revived.

Existing facts keep their lifetimes and permissions. A successful historical check grants only the requested non-conflicting continuation. It does not resume an old run, authorize deletion, resolve abandoned work, or make a report equivalent to successful delivery.

## 7. Uncertainties and decision threshold

- Local evidence has not been inspected; source support is not an independent live reproduction.
- No test execution or timing attribution was performed.
- Every supported older-format terminal record may not contain the same facts. The first implementation decision must name the actual contracts reused, not assume uniformity from a version prefix.
- A fully settled history classifier may expose additional genuine residual obligations; that is a useful precise refusal, not reason to relax the checks.

I would broaden the design only if targeted reproductions show that the existing terminal, assignment, iteration, locator and preservation records cannot express the necessary settlement fact without reconstructing a vanished authority. At present, the code points more strongly to **duplicated consumption and premature live loading** than to missing storage or ownership producers.

**Decision:** consolidate the classifier and its consumers now. Do not reopen the whole lifecycle architecture. Require the correction to complete actual public successor work from the all-reclaimed topology before another release claim.

## Source references

All links below are pinned to the inspected commit except where explicitly noted.

[S1] Exact commit metadata: https://github.com/Wenjun-Mao/codex-orchestration/commit/ee24c2382a20acb0d50ab4a7dd8a7981653ec163

[S2] Commit diff: same link as S1; the only changed file is the research note.

[S3] Sanitized evidence note: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/docs/research/2026-09-10-v0.9.11-post-closeout-upgrade-review.md

[S4] Classification, inspection and fresh guard: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh.mjs#L920-L1035

[S5] Historical utilities and selected snapshot bootstrap: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh-source.mjs#L170-L595

[S6] Existing v0.9.7 settlement path: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh-source.mjs#L258-L432

[S7] Public activation and closure wiring: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/bin/codex-flow.mjs#L675-L921

[S8] Active-run sentinel: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/foreign-active-run-sentinel.mjs

[S9] Live export/derive and source cleanup: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh-source.mjs#L736-L1107

[S10] Refresh preparation: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh.mjs#L1270-L1385

[S11] Namespace-removal and discovery consumers: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh-source.mjs#L1240-L1388

[S12] Closed settlement audit and non-selected validation: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/compat/refresh-source.mjs#L1080-L1254

[S13] Named regression: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/test/refresh-v09.test.mjs#L2054-L2127

[S14] Related coordinator and selector-replan regressions: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/test/refresh-v09.test.mjs#L2129-L2238

[S15] Audited public closure: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/run-audit.mjs#L1924-L2070

[S16] Assignment acceptance, terminal eligibility and retirement: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/assignment-acceptance.mjs#L340-L473

[S17] Exact reclamation and preservation: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/iteration-registry.mjs#L1760-L1950

[S18] Locator-retirement matching: https://github.com/Wenjun-Mao/codex-orchestration/blob/ee24c2382a20acb0d50ab4a7dd8a7981653ec163/lib/report-locator-authority.mjs#L207-L281
