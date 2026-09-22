## Assessment: sufficient for one bounded trial, not a general reliability claim

**Yes. The available evidence justifies a supervised, bounded rollout to one other project. I would not require another release, broad audit, or canary campaign before that trial.**

The evidence is materially stronger at the previously failing connection: **normally completed and reclaimed history → next-package inspection → actual admission → another completed lifecycle**. The main regression no longer leaves the selected predecessor’s checkout conveniently alive, and its successful ending uses real audited closure and real reclamation rather than fabricated terminal records.

However, three qualifications matter:

* The main fixture proves less about **consuming preserved results and preserving every historical record byte** than its surrounding narrative suggests.
* Its reporting segment is not entirely a frozen-producer/public-hook journey.
* The special open-assignment sibling test is a constructed classification test, not proof of that complete public lifecycle.

These are **evidence limitations, not demonstrated dangerous defects in v0.9.12**. The largest practical uncertainty for another project is the ordinary native **executor-backed** journey, because the latest live gates were coordinator-only.

**No further pre-trial engineering is justified for an ordinary, closely supervised trial that excludes mid-assignment upgrades and historical recovery.** Use that trial to obtain the missing executor-path evidence.

### Exact revisions and limits

I verified that the annotated `v0.9.12` tag resolves to **`f61b39faefb31ff7f70f111248928a28dc7bd108`**. Code and test references below are pinned to that commit.

I read the final plan at **`2e8738222028f169a4c59dc9d2b1b11736fc659a`**. The comparison confirms that this later commit adds only the stable live-ending documentation to the plan. I did not substitute `main`.

**I did not execute tests or inspect private journals, native App state, or installed artifact/cache comparisons.** I verified what the source and test assertions contain. The documented live results remain delivery-team evidence. Similarly, the reported **230/230 in 382.254 seconds** is an earlier full-suite result followed by affected reruns—not a fresh full-suite result against every subsequent revision.

## Claim → evidence → remaining gap

| Claim                                                                                         | Supporting evidence I inspected                                                                                                                                                                                                                                                                      | Remaining gap                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reclaimed predecessors can permit actual successor work across package identities.            | The three-generation test produces two v0.9.11 assignments, reclaims both, admits and retires candidate work, then admits and retires a stable consumer with both earlier namespaces retained.                                                                                                       | The candidate and stable packages are generated from the test checkout with different identities; this is not itself an installed-artifact test. Successor input consumption is also weaker than advertised. |
| Inspection, settled preparation, and ordinary admission use compatible historical facts.      | Shared classification feeds inspection and admission. Settled `refresh prepare` returns `fresh-start-required` without creating a handoff. Ordinary admission revalidates under the repository lock before target preparation.                                                                       | This supports the reviewed cross-version path, not every possible lifecycle combination or recovery sequence.                                                                                                |
| Cancellation and interrupted refresh consumption do not silently become standalone admission. | The revised assignment-bound test cancels after apply and checks activation refusal before target state. It also interrupts after target binding is persisted and checks that cancellation cannot erase the pending target obligation.                                                               | These are specific controlled interruption points, not exhaustive native crash/concurrency acceptance.                                                                                                       |
| Missing or contradictory historical evidence fails closed.                                    | Modern settlement joins runtime, audit, released execution retirement, retired assignment, accepted report, route/locator retirement, iteration absence, and preservation. Tests include corrupt report evidence, missing assignment authority, and unrelated-history drift at refresh-ID admission. | The inspected tests establish representative refusals, not every negative listed in the plan.                                                                                                                |
| Historical eligibility does not authorize deleting history.                                   | The settled preparation path is non-mutating; namespace removal still has separate source-cleanup and handoff requirements. The positive journey compares retained namespace digests.                                                                                                                | Those digests do not cover all shared assignment/reporting/iteration records.                                                                                                                                |
| The installed stable lifecycle worked in the actual App.                                      | The final documentation reports matched delivery/report digests, audited closure, director acceptance, one native coordinator archive, reclamation, and locator retirement.                                                                                                                          | Private evidence is unavailable to me; the latest gates did not create executors or test another project’s native placement and reporting.                                                                   |

## 1. The main lifecycle producer is substantially faithful—but two assertions are weaker than the claim

### What it genuinely exercises

In `test/refresh-v09.test.mjs`, `extractTaggedPackage` obtains the historical package through `git archive("v0.9.11")`; it does not disguise candidate code as the old execution producer. `produceSettledCoordinatorRun` then uses public commands for activation, assignment preparation, coordinator route/readiness, local work, verification, audit, audited closure, and director acceptance. Its successful closeout invokes the real reclamation path and checks that the coordinator checkout and branch are gone.

That is meaningful evidence for the risky lifecycle connection. The `--force` cleanup in the test’s teardown should not be confused with the successful producer path: the latter obtains removal through public acceptance and reclamation.

### Coverage limitation A: the “consumer” does not derive its output from predecessor bytes

The helper writes the supplied `expectedResult` directly into `historical-result.txt`, commits it, and verifies that the file equals that same supplied string. Later strings contain labels such as `frozen-first+frozen-second+candidate`, but the helper does not first read and validate the predecessor result to construct them. See **`test/refresh-v09.test.mjs:260–430`**, `produceSettledCoordinatorRun`, and the three-generation test beginning around line 2596.

**Concrete counterexample to the coverage claim:** after predecessor retirement, make a clean primary commit that changes the result file unexpectedly while retaining the captured predecessor commit in primary’s ancestry. Start the candidate. The helper overwrites the unexpected input with its predetermined string and can still pass.

That is **not an admission defect**: preserving an exact commit in the authorized destination does not require every current file to remain unchanged forever. It means the test proves “successor work can execute and retire,” not “the successor actually consumed the required preserved bytes.”

The smallest improvement is to make the successor read an input whose expected identity is checked before writing, then derive its output from that input. This can be done in the existing fixture—or demonstrated naturally in the proposed project trial.

### Coverage limitation B: “unchanged namespace” is narrower than “all history unchanged”

The positive test compares `refreshNamespaceTreeDigest` for the versioned predecessor namespaces. That function walks `.git/codex-flow/<namespace>`. Shared assignment, reporting, iteration, and locator authorities are outside those versioned roots.

**Concrete counterexample to the assertion:** a reader accidentally rewrites the formatting of an old shared assignment record without changing its parsed values. Subsequent validation could still succeed, and both versioned namespace digest assertions could remain unchanged.

I found **no such write in the inspected historical-classification path**. This is a gap in the immutability assertion, not evidence of an actual mutation.

The smallest extension is to snapshot the bytes of the **specific pre-existing shared records** belonging to the retired assignments, alongside the namespace digests. Do not hash the entire shared directories and reject legitimate new records created by successors.

Neither weakness warrants another release before a bounded trial.

## 2. Host simulation does not bypass the main cleanup owner—but it does bypass part of reporting

The main helper simulates host ownership by creating `codex-thread.json` and supplying thread identities. It supplies idle/archive observations and an accepted result tied to the emitted archive attempt. The production CLI still performs assignment acceptance and real Git reclamation. It does **not** simply stub `retireLocator`, call unaudited `closeRun`, or write a finished lifecycle journal.

But the reporting segment calls imported:

```text
captureReport
→ beginReportSubmission
→ acceptReportSubmission
```

Those imports come from the test checkout’s `report-records.mjs`, rather than sending a native final through the frozen producer’s installed hook and queue. The fixture uses the real record APIs, but skips the reporting orchestration that would normally decide when and where those APIs are called.

Consequently, **“fake only external host behavior” is an approximation, not a literal description of every connection in this fixture**.

### Concrete failure sequence invisible to this fixture

A native task finishes, but its Stop event does not reach the staged reporter—or resolves the wrong route. No valid report reaches the director. The main fixture can nevertheless pass because it directly captures and accepts the report record before invoking director acceptance.

This is a **missing integrated observation**, not a demonstrated hook defect. Separate hook tests exercise exact final text, duplicate suppression, identity mismatch, and a staged reporter surviving removal of its registering package, using simulated queue transport. Those tests provide useful complementary coverage.

The reported live coordinator gates provide another complementary piece: delivered final digests matched persisted reports, followed by actual acceptance and retirement. That narrows the uncertainty for the tested installation and coordinator route, although I cannot independently inspect those records.

### What remains unestablished for ordinary executors

The latest coordinator-only live gates do not newly establish the complete native sequence:

**executor creation and identity reconciliation → exact worktree/start authority → committed-input consumption → final delivery to the coordinator → disposition/integration/verification → executor archival and reclamation → coordinator closure and director acceptance.**

Executor component coverage exists. For example, `test/lifecycle-v09.test.mjs` exercises launch through callback, disposition, verification, archive, cleanup, and terminal audit; the hook tests cover executor final-output routing. But those fixtures use simulated host evidence, imported lifecycle APIs, and, in the cited lifecycle test, explicit Git resource removal. They are not equivalent to observing the entire installed executor journey in another project.

**This is the most useful uncertainty for the bounded trial to resolve.** Another coordinator-only rehearsal would add much less information.

## 3. The open-assignment sibling test does not establish its public producer-to-consumer connection

The test named **“live semantic refresh accepts a reclaimed closed sibling owned by its open assignment”**, at **`test/refresh-v09.test.mjs:817–970`**, explicitly:

* deletes the prior coordinator recipient registry;
* creates another execution using the same coordinator lineage;
* appends its assignment binding through imported `bindAssignmentRefreshExecution`;
* manually removes the old worktree and branch;
* stops after asserting `resume-source` and `refresh-ready` inspection responses.

This is useful as a constructed classification test. It demonstrates that the reader need not require a still-open outer assignment to be fully retired before accepting an earlier settled execution.

It is **not evidence that those records arise through the intended public operations, or that the same topology completes preparation, application, target admission, and eventual assignment retirement**.

### Concrete connection skipped by the setup

Without the registry deletion, a fresh public activation reusing an already-bound coordinator lineage is rejected by the CLI. The release retains that check in **`bin/codex-flow.mjs:630–692`**. The fixture removes the obstacle before constructing its next execution, rather than exercising whatever lawful transition is intended to supersede that identity.

This does not prove that legitimate semantic refresh is broken: an authorized refresh can use a different lineage and its own binding rules. It proves that **this particular test cannot certify the producer connection**.

The separate assignment-lived refresh test is stronger at consumption: it uses public prepare/apply/activation, tests cancellation and unrelated-history drift, and resumes after an interrupted binding write. But it does not make the specially constructed reclaimed-sibling test into a complete public journey.

**Rollout consequence:** do not make mid-assignment package upgrades a feature exercised or assumed reliable in the first project trial. Before relying on that specific topology operationally, extend the existing sibling test through a lawful producer transition and actual consumption. No broader redesign follows from this coverage gap.

## Are the operation-specific permissions preserved?

**For the paths inspected, yes.** The release does not simply introduce a universal “settled means allow everything” flag.

Modern reclaimed-history admission requires the execution evidence and the later assignment/reporting/resource-retirement evidence to agree. The iteration reader separately checks preservation of the captured archive tip and the exact audited result in authenticated primary. Missing modern assignment authority does not become proof of standalone execution.

At the consumer boundaries:

**Ordinary admission** checks pending handoff precedence and reclassifies predecessors under the repository lock. Target preparation also checks current Git identity and cleanliness before persisting runtime/workflow authority.

**Refresh-ID admission** checks unrelated retained namespaces while preserving source-specific continuation rules. Assignment-backed target binding is persisted under the assignment lock before preparation/admission, so a cancelled assignment cannot simply disappear from an open-only lookup and become standalone continuation.

**Cleanup** retains separate authority. A `fresh-start-required` preparation result does not authorize namespace deletion; removal still invokes the source cleanup/handoff checks.

The targeted tests contain meaningful refusal assertions for cancellation, changed unrelated history, tampered accepted-report evidence, and interruption after assignment binding. They check more than an inspection string: representative cases require no target namespace and an unchanged handoff.

**I found no demonstrated released-code sequence in this bounded review that incorrectly grants new-work or deletion permission through those checked cases.** That is not a claim that all missing-record combinations or replay interleavings have been proved. In particular, preserving a pending obligation after interruption establishes safety against forgetting it; it does not guarantee effortless recovery from every interruption.

The deliberately unresolved source-repository history is also not contradictory evidence. Successful handling of authenticated retired history does not imply permission to reinterpret unrelated abandoned history as complete. The final documentation explicitly preserves that limitation.

## Smallest next check that could change the rollout decision

Proceed with **one ordinary real-project trial**, not another artificial release-upgrade campaign.

**Choose one small useful change with one coordinator and one executor.** Pin the installed package to the released identity and use a project with no unresolved Flow state, or only supported settled history. Let the executor consume an actual committed input and produce a verifiable result; record the required input commit or content hash rather than relying on a predetermined output label.

**Observe the normal ending without bypasses.** Require the native executor’s exact final to reach its intended coordinator through the real reporting path, then complete disposition, integration where applicable, verification, child archival/reclamation, audited run closure, director acceptance, coordinator reclamation, and locator retirement. A passing unit test, accepted host call, or missing directory alone is not the ending.

**Then perform one useful successor operation under the same stable package.** Verify the preserved result and actually begin the next task after reclamation. No additional package version is needed. Preserve the predecessor namespace and relevant shared historical records. Stop and retain evidence if continuation requires manual journal edits, checkout recreation, or an unplanned recovery loop.

That single trial addresses the largest remaining deployment uncertainty while also strengthening the “useful consumer” evidence. The small fixture improvements—reading predecessor inputs and comparing exact old shared-record bytes—are worthwhile, but **they do not need to become pre-trial release engineering**.

**Bottom line:** v0.9.12 has enough source-backed and reported acceptance evidence to leave the disposable project for one supervised trial. It does not yet justify describing the ordinary native executor lifecycle, every semantic-refresh topology, or general recovery reliability as fully accepted.
