# Codex Orchestration: Reliability, Workflow, and Root-Cause Audit

**For:** the project’s Director agent and maintainer  
**Repository:** `Wenjun-Mao/codex-orchestration`  
**Report date:** September 9, 2026  
**Audited baseline:** `v0.9.10`, commit `21096a7ad7aca10221a90bcb1b404dbb0c89aacc`  
**Purpose:** consolidate the architecture review, v0.9.10 source findings, and historical release-candidate evidence into a bounded improvement plan.  
**Authority:** advisory report only. This document does not authorize implementation, installation, historical-state repair, deletion, publishing, or release promotion.

> **Recommendation: keep the Director → Coordinator → Executor architecture, make executors optional, and repair the connections and recovery behavior of the existing lifecycle. Do not add another orchestration layer.**

## 1. Executive assessment

The project has a useful objective: preserve an available, well-informed strategic partner while bounded delivery proceeds elsewhere, preferably at lower total usage. That is a stronger justification than assuming a strong supervisor and cheaper workers will universally reproduce flagship performance at half the cost.

The immediate problem is not primarily insufficient model intelligence. The source audit and recorded release history show repeated failures where one stage produces legitimate evidence or completes legitimate work, but the next stage cannot consume it correctly. The Director then has to diagnose state, arrange recovery, and revisit release completion. This spends the context, attention, and expensive-model usage the architecture was intended to protect.

**Working diagnosis:** the lifecycle has more states, representations, and transitions than its end-to-end verification and recovery behavior currently handle consistently. Necessary safety distinctions coexist with avoidable duplication and incomplete connections. These are interacting causes, not two unrelated explanations.

The strongest evidence is specific: fixtures that equated the primary checkout with the delivery branch; a “direct coordinator” test that actually created an executor-shaped task; a runtime bundle tested from a source checkout rather than its installed entrypoint; and timestamp-sensitive retries appearing in more than one subsystem. The repository’s own lessons document already recognizes much of this pattern. The next step should be executable corrections, not another essay of general rules. [R03] [R12] [R13] [R15]

### Recommended decisions

| Decision | Recommendation |
| --- | --- |
| Role structure | Keep the three responsibility names; do not require three active agents. |
| Immediate engineering priority | Reproduce and resolve the four v0.9.10 static findings in Section 4. |
| Verification priority | Prove real producer-to-consumer paths, replay after interrupted writes, and closure followed by the next assignment. |
| Simplification priority | Reduce duplicated decisions and model-managed bookkeeping inside existing mechanisms. Preserve safety evidence and authorization. |
| Cost optimization | Measure total usage per accepted outcome after eliminating avoidable recovery loops. Do not tune routing around a broken lifecycle. |
| Scope discipline | Use one bounded reliability checkpoint. Defer new roles, generalized recovery frameworks, storage migrations, and elaborate telemetry. |

**Success is not “the agents eventually closed the release.” Success is that delivery, acceptance, and authorized closeout complete without turning the Director into the release-plumbing debugger.**

## 2. Scope, evidence, and corrections to earlier conclusions

The baseline is the exact commit above. The annotated `v0.9.10` tag was created on September 9, 2026; the changelog labels the release September 8. Use the commit and tag object for identity rather than treating these two dates as interchangeable. This report does not claim that every subsequent branch or installed copy has the same defects. Recheck each finding against the implementation being changed. [R01] [R02]

Four evidence categories are used:

- **Recorded incident:** a repository field-test report or audit describes a live failure. Its underlying local session and `.git` evidence were not independently replayed here.
- **Static finding:** a concrete code path supports a defect or race. The proposed reproduction still needs execution in the project’s test environment.
- **Implemented correction:** source, tests, commits, or release notes show a historical issue was addressed. This is not a claim that every variant is proven.
- **Hypothesis/recommendation:** a reasoned proposal, not measured project performance.

The review covers selected implementation, skills, tests, release notes, ADRs, historical commits, and representative RC records. It is not an exhaustive audit of every commit, candidate, security property, or private Director conversation. Candidate counts alone would not identify unnecessary work or establish how often the Director intervened.

The earlier audit’s downloadable evidence contains five passing isolated routing tests, including 256 delivery-fact combinations and 128 staffing-independence pairs. Its policy copy was checked against Git blob `3d45a8ae2331eeee06a4e6612cdca3ac39e95743`. Those are policy-behavior checks, **not** the repository’s full suite, a live-host test, or a demonstration of savings. The evidence archive was inspected during consolidation. No full `npm test`, `validate`, `pack:check`, or live Codex App canary was executed for this report. Direct container access to GitHub was unavailable; repository reading used the connected GitHub tool.

### Carry these corrections forward

1. **The earlier zero-child-path finding is partly resolved.** By v0.9.10, coordinator-local work is implemented. Do not reopen “there is no direct-work path” as though nothing changed. Its dependency and recovery connections remain the concern. [R02] [R06]
2. **Missing established verification no longer automatically means Sol.** The three-band coordinator policy separates model selection from child staffing and uses Terra-xhigh for bounded demanding work. Treat its efficiency as unmeasured, not its implementation as absent. [R09]
3. **The project already has integration, real-Git, recovery, and live-canary testing.** The problem is fidelity and completeness of important connections, not simply “only unit tests.” [R03] [R10]
4. **Historical preservation and reporting failures are evidence of a pattern, not all open v0.9.10 bugs.** Keep them separate from Section 4. [R02]
5. **Do not infer project-wide CI absence from the earlier workflow query.** The available commit-workflow wrapper is limited to pull-request-triggered runs and first-page results; local evidence is separate.
6. **Do not carry forward precise model benchmark or subscription-saving claims as evidence for this plugin.** This review does not establish those claims. Research and operating preferences are discussed separately in Section 9.

## 3. What the history actually shows

This is a representative causal history, not a count of all RC attempts. A planned gate is not a passing result, and a static trace is not a second observed incident.

| Release / evidence | What happened | Root issue and lesson | Treatment now |
| --- | --- | --- | --- |
| v0.9.0 RC3 → RC4 | Callback evidence could precede later host-result enrichment; isolated launch coverage did not prove the complete downstream order. | Temporal evidence was compared as though all fields existed simultaneously. Test the actual event order through disposition and closure. | Historical correction; retain monotonic-evidence regression. [R03] [R10] |
| v0.9.3 RC1–RC4 | Wrong completion event, obsolete manifest field, and an incompatible delivery-key format surfaced through live use. Later busy-recipient and `wait_threads` gates delivered the final on a separate turn. | Host contracts and caller/adapter connections, not a need for smarter workers. Local module correctness did not establish installed behavior. | Historical corrections; retain targeted installed-host tests. [R11] |
| v0.9.7 reporting/local-work additions | Reporting originally ended with the shorter execution-run lifetime; policy allowed local work before accounting could close it truthfully. | Lifetimes and supported execution shapes were not represented consistently across the whole workflow. | Assignment-lived reporting and coordinator-work records now exist. [R02] [R03] [R18] |
| v0.9.7 RC7 | The pinned runtime lacked `package.json` required by reporter staging. A retry then conflicted because regenerated iteration timestamps differed. | Tests used a package checkout instead of the runtime bundle; retry compared mutable observations rather than stable identity. | Recorded fixes. The analogous local-work timestamp issue in Section 4 shows the principle needs to be applied across the affected seam. [R12] |
| v0.9.7 RC8 / RC10 gate | Refresh admitted replacement execution without joining assignment history. A later gate exposed that a real coordinator task was omitted from refresh decisions. | A transition updated one durable model but not another. A test named “direct coordinator” retained `task-thread` defaults and never ran local-work start. | Recorded fixes; assert fixture shape, not merely descriptive test names. [R13] |
| v0.9.8 | A long archived history exceeded whole-file observation assumptions. | Small transcript fixtures missed realistic scale. Streaming memory is a host-side issue distinct from LLM context selection. | Historical correction; retain a bounded generated large-history test. [R02] [R03] |
| v0.9.9 closeout | Legitimate cleanup removed a coordinator checkout that later refresh still tried to execute from; wrong initial checkout bindings and pre-archive resource loss also needed precise recovery. | A later stage depended on already-reclaimed resources or weak initial ownership identification. | Recorded corrections, not permission to infer authority from arbitrary surviving Git refs. [R14] |
| v0.9.10 RC1 → RC2, commit `1d55956` | Refresh could classify a predecessor as settled while fresh activation rejected it. | Inspection and mutation used conflicting admission logic. The correction shares classification and revalidates under the admission lock. | Corrected in the audited baseline. This commit is a useful example of fixing the shared contract rather than bypassing the rejecting caller. [R17] |
| v0.9.10 RC2 preservation audit | Executor archive succeeded, but cleanup checked the older primary instead of the authenticated launch source. The integrated-result path also dropped the named integration target. | Producer-to-consumer evidence lost ownership. Fixtures made primary, launch source, and integration target all `main`, concealing the supported delivery-branch topology. | Outcome-aware ownership is recorded as corrected in v0.9.10. Keep paired positive/negative real-Git tests. [R02] [R15] |
| v0.9.10 failed-assignment exit | Abandoning a run left assignment, route, locator, and iteration lifetimes unresolved. | “Run terminal” was mistaken for sufficient evidence that the whole assignment could terminate. | Explicit cancellation was added; cancellation intentionally retains coordinator resources. [R07] [R15] |
| v0.9.10 RC5 gate plan | A cancelled RC2 iteration also recorded an older coordinator’s worktree path, leaving reclamation pending. A fresh coordinator was selected for the gate. | Historical resource membership and current ownership can differ. A clean fresh gate does not prove the old blocked state is repaired. | Known retained-state limitation. The plan explicitly says the previous empty gate was abandoned, not successful. Do not infer a completed live result from the plan. [R16] |

### Most important synthesis

**The test environment repeatedly removed the exact distinction the product needed to preserve.** Examples include delivery branch versus primary, runtime bundle versus source checkout, coordinator versus executor, run lifetime versus assignment lifetime, and a retry at a later time versus a byte-identical record.

The repository’s lessons already describe this. Strengthen the small number of tests that represent the product’s real shapes; do not respond by creating another large checklist or a universal workflow simulator. [R03]

## 4. Remaining v0.9.10 static findings

All four require focused reproductions before declaring a fix complete. **P1** denotes a supported workflow or recovery path that can be blocked; **P2** denotes a narrower retry or concurrency defect. These priorities are this report’s triage, not historical incident severity labels.

| ID | Priority | Finding | First verification target |
| --- | --- | --- | --- |
| F1 | P1 | Completed coordinator work is missing from downstream dependency consumption. | Local task A → dependent task B, using actual persisted A evidence. |
| F2 | P1 | Completion record and workflow claim can diverge after interruption; retry does not reconcile. | Interrupt between the two writes; repeat completion. |
| F3 | P2 | Repeating local-work start with a new timestamp is rejected. | Same contract and clean baseline, advanced clock. |
| F4 | P2 | Acceptance’s state check occurs outside the assignment update lock. | Deterministically interleave two different report acceptances. |

### F1 — Coordinator-owned work is not fully connected to dependencies

**Evidence:** `lib/workflow-journal.mjs`, `dependencyAuthorityReferences()` and `resolvePersistedDependencyRecords()`. The accepted reference kinds are only `task-disposition` and `subagent-operation`. The resolver maps a non-`task-thread` dependency to `subagent-operation` and searches for a `started` claim. A terminal coordinator record instead has `coordinator-work` authority and a `completed` claim. The current coordinator skill nevertheless supports local and child nodes with real dependencies. [R04] [R05]

**Consequence:** a legitimate local preparation step can complete while its dependent executor, subagent, or local task cannot receive a valid generated contract through the ordinary path. Deleting the dependency would hide, not fix, the missing connection.

**Smallest coherent repair:** consume the existing completed coordinator-work evidence through the dependency path. Validate its exact contract, operation, run/runtime, repository, task, accepted workflow relationship, and passing verification. Trace the same evidence through contract generation and any downstream validation; adding one enum value is insufficient if the next consumer still rejects it.

**Regression:** local A performs a verified mutation; generate and start dependent B using A’s actual persisted output. Repeat with verified no-change A and B as another local node. Exercise additional supported consumers where they use different code paths. Wrong-task, wrong-runtime, nonterminal, and failed-verification evidence must not unblock B. Do not fabricate a native ID or relabel A as a worker.

### F2 — Completed work can remain journal-incomplete after a crash

**Evidence:** `completeCoordinatorWork()` writes the completed coordinator-work record, then calls `transitionWorkflowOperationClaim()`. Its early return for an already completed record skips the missing transition on replay. [R06]

```text
write completed work record
    ↓ interruption
workflow claim still says started
    ↓ ordinary retry
completed-record shortcut returns without reconciling the claim
```

**Smallest coherent repair:** in the completed-record branch, authenticate the caller and the exact persisted terminal record, then reconcile its claim through the existing transition mechanism before returning. Preserve original completion time, result, and verification. Do not rerun checks to manufacture replacement evidence or allow general unauthenticated repair.

**Regression:** inject a failure after the completed record is durable but before the claim update. Repeat the public completion path. It must converge to the same terminal evidence, invoke no additional verification command, and pass normal status/audit. A conflicting record must fail, not be normalized away. Review lock ordering and interaction with run closure when implementing this.

This is a multi-record recovery problem. Individual atomic JSON writes do not make the combined transition atomic.

### F3 — Start replay confuses timestamp changes with authority changes

**Evidence:** `startCoordinatorWork()` generates a new `started_at` and compares the entire generated record with an existing one. An otherwise matching retry at a later time can fail with `Existing coordinator-work start has different authority`. [R06]

**Smallest coherent repair:** look up the deterministic operation first; validate its immutable authority and lawful resume state; preserve the original record’s timestamps and progress. Reconcile its existing claim where legitimate. Reject genuine identity or repository conflicts, not a newly generated clock value. Distinguish a fresh-start baseline check from an authenticated resume check rather than weakening either globally.

**Regression:** two calls with the same contract and unchanged clean baseline at different timestamps return the same legitimate operation and original timestamp. Cover partial start persistence separately from completed-state replay. Test changed contract/baseline rejection.

**Historical connection:** RC7 already recorded and repaired this failure pattern for iteration creation. Reuse the semantic principle, not necessarily a new generic abstraction. [R12]

### F4 — Acceptance can be overwritten by concurrent requests

**Evidence:** `acceptAssignmentResult()` reads `assignment.state` before calling `updateAssignmentAuthority()`. The open-state callback unconditionally writes an accepted record. The updater locks and validates record shape, but does not itself enforce accepted-report immutability. Two callers can both observe `open`; the second then replaces the first accepted report. [R07] [R08]

**Smallest coherent repair:** perform the state/report comparison inside the existing locked update callback. Accept from the permitted open state; return idempotently for the same accepted report; reject a different report or incompatible terminal state. Preserve the original acceptance timestamp. Keep external host actions outside a long-held assignment lock. Check retirement and cancellation transitions for the same stale-read pattern while touching this seam, without declaring untested adjacent paths defective.

**Regression:** use a deterministic barrier so two requests read the same open assignment before lock acquisition. Different valid reports yield one accepted identity and one rejection. Same-report concurrent retries converge without changing the original timestamp. Verify behavior when terminal state changes before the update.

## 5. Root causes to address—not just symptoms

### 5.1 Evidence is lost or reinterpreted between stages

The preservation incident is the clearest example: integration knew its named target, but later cleanup used a different proxy. The coordinator-dependency finding follows the same structural pattern: a valid producer exists without an adequate consumer. [R05] [R15]

For each changed connection, answer in the existing test or focused review: **what does the producer prove, what must the consumer retain, and who may act on it?** Pass the real output through; do not reconstruct a “convenient” intermediate record in the test.

### 5.2 Several durable records can disagree about one transition

Assignment, run, workflow claim, operation, report, and iteration records have legitimately different lifetimes. Collapsing them into one `done` flag would lose safety information. But every update spanning records needs a defined replay path. [R03] [R06] [R13]

Choose the authoritative evidence for each specific transition and reconcile the dependent representation from it. Prefer a narrow repair using current storage and locks. A new event-sourcing system or database migration is not justified merely because two writes exist.

A known partial local write and an ambiguous external action are **not the same retry problem**. The former may be repairable from exact persisted evidence; the latter must not authorize duplicate task creation or archival without the supported reconciliation evidence.

### 5.3 Tests verify labels and local stages more readily than real compositions

The “direct coordinator” fixture that instantiated `task-thread` is especially instructive. Require tests to assert the actual execution kind, entrypoint, branch topology, operation record, and authority path that make the case significant. Assertions should prove those distinctions before checking success. [R13]

Likewise, a test reaching a low-level registration function does not prove that the installed public activation path admits the same state. Commit `1d55956` shows why shared classification plus mutation-time revalidation was necessary. [R17]

### 5.4 State lifetimes are partly understood but not consistently completed

Run closure, assignment acceptance, reporting retirement, task archival, and Git reclamation are different events. Keeping the distinctions is correct. The question is whether every required successor transition has an available owner and supported action. [R03] [R14] [R15]

Before deleting a runtime or checkout, prove that the remaining assignment operations either no longer need it or have an exact supported source of authority elsewhere. Test the next assignment, not just the absence of the old worktree.

### 5.5 The Director becomes an operator when mechanical recovery is unclear

Distinguish a project decision from a plumbing failure:

| Director involvement | Assessment |
| --- | --- |
| Changed scope, unacceptable behavior, a new security/release risk, or genuinely missing authorization | Appropriate Director/user decision. |
| Working out which already-persisted digest, report, or branch satisfies an existing contract | Prefer deterministic derivation and a concise result. |
| Repeating the same acceptance because an unrelated bookkeeping stage failed | Recovery defect or usability problem to investigate. |
| Approving destructive recovery not covered by the original authority | Keep explicit approval; do not hide it in “automatic closure.” |

The target is fewer **unnecessary** interventions, not removal of legitimate acceptance and approval gates.

### 5.6 Self-hosting combines product delivery with changing the delivery machinery

A self-hosted release exercises upgrades, immutable runtimes, assignment continuity, reporter installation, and cleanup simultaneously. This amplifies failures but does not excuse ordinary replay bugs. The changelog also records that replacing the watched marketplace source can act as an installation event. [R02]

Use the authenticated stable runtime for the outer delivery episode and stage the candidate separately. Exercise the candidate and upgrade boundary deliberately in isolation. A clean candidate run does not repair historical state, and a planned canary is not its result.

## 6. The target workflow and simplification boundary

### Preserve the role contract

| Role | Ownership | Recommended context/lifetime |
| --- | --- | --- |
| Director | Intent, consequential decisions, user conversation, acceptance | Long-lived project relationship; current goals, decisions, assumptions, and unresolved strategic questions. |
| Coordinator | Bounded delivery, useful delegation, integration, verification, authorized release and closeout | One coherent delivery episode; preserve necessary state between episodes without automatically carrying all history. |
| Executor | One scoped assignment and evidence of its outcome | Task-specific source context and acceptance checks; no new authority over siblings or project intent. |

These lifetimes are operating recommendations, not measured optima. The names describe ownership, not intelligence rank. A difficult worker task may need the strongest model without taking the Director away from the user.

For cohesive work, prefer **Director + a coordinator that implements directly**. Add an executor for a concrete benefit: independent work, expensive exploratory context that can be kept separate, or a cheaper bounded implementation lane. Parallelism is not required to justify one worker, but the coordinator must not then repeat the worker’s entire investigation.

### Simplify mechanisms, not safety claims

**Retain:** exact ownership and repository identity; saved approved intent; truthful requested/accepted/observed evidence; quiet routine reporting; separate urgent interruption; verified integration; guarded deletion; and no blind replay of ambiguous external actions.

**Combine or thin:** duplicated implementations of the same decision, repeated manual copying of machine-derived fields, redundant narrative reports, and code paths that independently decide an identical admission rule. v0.9.10’s removal of the unused closeout driver is a useful precedent. [R02] [R17]

**Do not add now:** a permanent release manager agent, another coordinator layer, a new closeout engine, a universal compatibility reader, a learned router, a new telemetry service, or a general audit-mode lifecycle merely for an exceptional read-only review.

The desired behavior of the **existing** closeout mechanism is:

```text
Consume authenticated state.
Advance only the steps already authorized.
Reconcile known completed work without duplicating external actions.
Return complete, one exact host action, or one actionable blocker.
```

This is not a request for an unbounded polling loop. Unknown active-host state remains pending; conflicting authority remains blocked. Diagnose once and return the missing fact or decision rather than repeating the same failing command without new evidence.

A useful blocker identifies the failed connection, the exact object or operation, the evidence missing or conflicting, whether an external action may already have occurred, and the one authorized next step or required approval. Expose detail in structured output; reserve prose for the consequence and decision. Extend existing errors only where a real case needs it.

## 7. Minimal verification plan

**Use the existing test files and fixture helpers.** The following is a test plan, not a proposal for a new harness. Cover risk-bearing variants rather than the Cartesian product of every state.

### Three end-to-end journeys

| Journey | Required path | Important assertions |
| --- | --- | --- |
| J1: local-only delivery | Prepare approved assignment → register → activate → real coordinator-local mutation → executed checks → ordinary run close/report → Director acceptance → authorized preservation in primary → coordinator closeout/retirement → start next assignment | Zero child tasks; actual `coordinator` record; final captured after its shorter-lived run where supported; result preserved; no fabricated native identity. |
| J2: mixed delivery | Local A → dependent executor B → receipt/disposition → integration to the coordinator’s delivery branch → verification → child-first closeout → report/acceptance → authorized preservation in primary → coordinator closeout → next assignment | Primary deliberately behind delivery; dependency uses A’s actual output; named preservation owner survives; no archive replay. |
| J3: failure and resumption | Interrupt one existing transition at a time; resume via its supported public path; finish or cancel safely; exercise lawful successor admission | Original identities/evidence preserved; no duplicate external action; failed/cancelled never relabeled successful; unresolved resources remain explicitly retained. |

Make the product-state distinctions deliberate: named versus detached coordinator checkout where supported; mutation versus verified no-change; `ancestor` versus exact verified `patch-equivalent` integration; installed/runtime entrypoint versus source checkout. Keep the broader permutations in small targeted tests rather than multiplying live canaries.

### Focused failure cases

At minimum, reproduce F1–F4. Retain focused coverage for callback-before-creation-result, post-run final capture, refresh assignment binding before source deletion, archive accepted before physical reclamation, and admission after legitimate predecessor cleanup. These are known historical seams, not speculative new failure classes. [R03] [R10] [R12] [R13] [R15]

Inject failures around the writes that actually constitute the changed transition. A completed-record write followed by process loss is different from an exception caught before persistence. Assert verification-call and host-action counts, not just final JSON shape.

Negative cases should fail **before unsafe effects**: missing/diverged preservation owner, disposable branch used as its own owner, wrong task/runtime/recipient, conflicting accepted report, active/unknown task, dirty/shared/protected worktree, or unsupported predecessor. Preserve exact failure evidence.

### Layered release gate

Run focused seam tests during implementation. Once the source settles, run the repository’s existing full release checks against the exact candidate:

```bash
npm test
npm run validate
npm run pack:check
git diff --check
```

Those commands alone do not establish installed-host behavior. For changed App-facing behavior, perform one appropriately scoped installed/loaded canary, including the real owning-host action, observation, and continuation. Keep candidate identity, source commit, artifact, runtime bundle, and installed entrypoint distinguishable. Reuse accepted evidence only when its subject bytes and relevant assumptions are unchanged. [R10]

**The gate ends after safe closure and a demonstrated next assignment—not after implementation tests pass.** A skipped or abandoned canary is reported as such. If a new substantive contract failure appears, stop promotion, add the smallest isolated reproduction, and inspect the immediately connected consumers before installing another candidate.

## 8. Bounded implementation sequence

### Checkpoint A — Confirm and repair the current four seams

Use one coordinator initially; separate review only where it has a concrete benefit. Establish the current baseline, reproduce F1–F4, and record whether each is confirmed, already fixed, or not reproduced with an explanation. Repair coordinator dependencies and local replay together where they share actual contracts; make acceptance’s locked transition correct without holding locks across host work.

**Exit:** each confirmed defect has a failing-before/passing-after regression, affected negative cases remain safe, and no new product subsystem was introduced. A source finding disproved by a valid supported path should be corrected in the audit, not forced into a patch.

### Checkpoint B — Prove the complete delivery path

Run J1–J3 at the appropriate local/host layers, including real branch topology and successor admission. Check that the public command wiring consumes the same contracts exercised by lower-level tests. Remove test scaffolding that silently repairs a product gap between stages.

**Exit:** authorized work completes or reaches one genuine actionable blocker; the Director is not required to reconstruct protocol state to make a normal successful path finish.

### Checkpoint C — One stable-candidate validation and explicit release decision

Stage the candidate outside the watched live source. Run settled-source checks and the scoped live gate. Keep the outer delivery runtime stable unless the approved work specifically tests refresh. Present one decision-ready result, including any retained historical resource blockers separately from candidate acceptance.

**Exit:** an explicitly authorized release decision on exact evidence. Do not mutate old journals, silently discard old ownership, or use a fresh successful canary to declare historical recovery complete.

### After reliability: optimize context and routing

Do not combine economic experiments with the reliability patch unless required to execute its acceptance tests. Keep a brief manual record of interventions and usage. Avoid changing a frozen experiment after inspecting outcomes.

## 9. Context, model routing, and cost

### Separate the four hypotheses

| Hypothesis | Present assessment | Suitable measurement |
| --- | --- | --- |
| Separate Director improves availability | Strong product rationale; exact benefit not quantified. | Strategic response correctness/latency while delivery is active; delivery interruption. |
| Cleaner Director context improves judgment | Plausible, not demonstrated for this setup. | Same model, same project decision and evidence access; accumulated history versus a relevant current-state brief. |
| Bounded coordinator episodes reduce irrelevant history | Reasonable design hypothesis, not solved by merely adding a Director. | Repeated exploration, prompt volume, missing-state errors, handoff/reconstruction cost. |
| Mixed models preserve acceptance at lower total cost | Plausible and workload-dependent. | Entire accepted workflow, including supervision, repair, verification, closeout, and failures. |

Anthropic’s context-engineering guidance supports selective context, compaction, persistent notes, and separating extensive exploration from a lead agent’s distilled view. It does not demonstrate superior strategic judgment for this plugin or justify discarding inconvenient implementation evidence. [W02]

The Director should receive **decision-changing facts, not execution transcripts**: the actual outcome, changed assumptions, consequential deviations, verification results, unresolved risks, and evidence pointers. Modify the existing complete report rather than adding a second summary. A few hundred words is a starting usability target, not a truncation rule. Keep the underlying evidence available.

Treat brainstorms as proposals, not silent amendments to active assignments. Changes to intent, scope, risk, or acceptance require the existing approved-revision process. The Director should remain informed about evidence that invalidates the plan, without continuously polling implementation.

End a coordinator episode at a meaningful completion boundary. Do not reset mid-investigation solely because a context meter is high, and do not repurpose version-refresh machinery into a general memory-reset system. Historical decisions and current state matter; obsolete logs need not automatically travel with them.

### Research supports experimentation, not a guaranteed ratio

A repository-level study reported equivalent strong-model performance at roughly 40% lower generation cost in one evaluated configuration. Its setting was SWE-bench Lite with older models; its “Strong LM First” strategy starts with a strong model’s actual code attempt and uses a weaker model for refinement. It does not test an always-available strategic Director plus this plugin’s governance, host, and cleanup overhead. [W01]

Therefore keep the original “above 95% at about half cost” idea as motivation, not a release claim or acceptance threshold. The repository’s existing research note and small retrospective protocol already distinguish routing, orchestration, quality, time, and cost; preserve that distinction. [R19] [R20]

The current three-band coordinator policy and Luna/Terra/Sol/Astra choices are explicit operating preferences, not empirically optimal assignments. Staffing and model choice should stay separate. Use stronger delivery capability when the hard judgment is inside implementation rather than forcing every difficult task through a weaker worker. [R09]

OpenAI’s current Codex guidance says usage varies with the model, task complexity, context, reasoning, speed, tools, and execution surface. Included subscription allowance and API billing are not interchangeable. This report deliberately avoids a fixed conversion from visible tokens or waiting time to dollars. [W03]

The optimization target is:

```text
Total usage for an accepted outcome
= direction + delivery + worker usage + verification
  + rework + handoffs + closeout/recovery
```

Use observed billing/usage units where available. Keep cached input, uncached input, output, latency, and subscription usage distinct. Do not equate time in `wait_threads` with continuous billable reasoning. Raw context length is not by itself a cost estimate.

### A small practical evaluation

After reliability stabilizes, use a handful of fixed representative tasks: cohesive implementation, log-heavy debugging, and independent slices. Compare a strong solo task, a cheaper solo task, and the preferred directed configuration under the same repository snapshot and acceptance criteria. Repeat enough to detect obvious instability; a small pilot informs personal practice but cannot establish a precise 95% quality guarantee.

Evaluate Director availability separately: delivering code plus useful strategic discussions is more output than delivering code alone. Do not treat all additional usage as waste, or credit a configuration for extra outputs absent from the baseline. For context comparisons, keep the model and evidence access constant, and score correctness and constraint retention rather than prose polish.

Use existing evidence plus a small local results file. Capture acceptance, rework, integration defects, human interventions, Director protocol-recovery turns, time from verified implementation to safe closure, and authoritative usage when exposed. Missing usage remains unknown. This does not require a telemetry platform.

## 10. Practical instructions for the Director agent

The following is a proposed working brief to apply **only within separately approved implementation authority**:

> Preserve the current role boundaries and native-host execution model. Start by verifying the four baseline findings against the current commit; do not assume an old audit remains current. Prefer one bounded reliability assignment, optional executors, and existing lifecycle code and tests.
>
> Reproduce supported user journeys through real producer outputs, public command wiring, exact execution kinds, and realistic Git topology. Repair the source of each mismatch, including its immediate consumer and replay path. Do not remove dependencies, weaken preservation checks, hand-edit authority records, duplicate external actions, or add a generalized recovery engine to make tests pass.
>
> Keep the Director available after bounded dispatch. Coordinator-owned technical recovery stays with the coordinator while it remains within approved intent and authority. Escalate consequential decisions or genuinely missing authorization, not already-derivable bookkeeping. A new systemic defect beyond scope should produce one evidence-backed decision request rather than another improvised repair loop.
>
> Once code is settled, validate the exact candidate, run the scoped live-host gate, and prove lawful next-assignment admission. Return one complete result with evidence, retained limitations, and any decision required. Do not describe an abandoned attempt, pending cleanup, or a planned gate as success. Release and destructive recovery retain their explicit approval requirements.

### Acceptance checklist for this reliability checkpoint

- [ ] F1–F4 are each confirmed and fixed, already fixed with evidence, or disproved with a supported reproduction.
- [ ] Actual coordinator work can feed its supported downstream consumers without fabricated identities.
- [ ] Interrupted local completion and later-time start retries converge without changing valid evidence or rerunning completed effects.
- [ ] Acceptance is atomic and idempotent for the same report; conflicting reports cannot overwrite acceptance.
- [ ] Local-only and mixed workflows reach safe closure and next-assignment admission through real product paths.
- [ ] Legitimate dirty/active/ambiguous/ownership/preservation blockers still stop unsafe effects.
- [ ] Installed/runtime packaging and changed host-facing behavior are validated against the exact candidate.
- [ ] Historical retained resources are reported separately; no unapproved cleanup, migration, or archive replay occurred.
- [ ] The normal path required no Director protocol reconstruction beyond legitimate acceptance/authorization.
- [ ] No unnecessary new role, service, framework, duplicate report, or speculative abstraction was added.

## 11. Final judgment

The project’s strategic separation remains worth preserving. The current source also shows real progress: local coordinator work exists, routing no longer equates staffing with model expense, reporting outlives execution where necessary, and cleanup preserves results through the appropriate owner.

The repeated difficulty closing releases is nevertheless a product signal. The most defensible explanation is **incomplete lifecycle connections and replay semantics, amplified by multiple representations, unrealistic fixture defaults, and self-hosted upgrade complexity**. The record does not support an exact split between “over-complication” and “testing,” nor a conclusion that the role architecture should be abandoned.

The best next improvement is a small, provable reliability correction—not a more elaborate orchestration design. Protect the safety distinctions, make the existing stages compose and recover, and then measure whether the workflow delivers more accepted work with less expensive-model usage and fewer unnecessary Director interruptions.

---

## Evidence index

Repository links below use the audited commit unless an earlier commit is explicitly identified. Function names in the findings identify the relevant logic; the links remain useful outside this conversation. Underlying private `.git` evidence referenced by repository reports was not independently accessed here.

| Ref | Source | What it supports |
| --- | --- | --- |
| [R01] | Annotated v0.9.10 tag object | Exact release commit and tag creation date. |
| [R02] | Baseline changelog | Implemented corrections and release-level scope. |
| [R03] | Lessons carried into v0.9 | Repeated failure patterns, missed realistic test shapes, and existing engineering guidance. |
| [R04] | Coordinator skill | Supported local/child work, dependencies, reporting, and closeout responsibilities. |
| [R05] | Workflow journal | F1 dependency grammar/consumption and claim-state transitions. |
| [R06] | Coordinator work | F2 split-write completion replay and F3 timestamp-sensitive start. |
| [R07] | Assignment acceptance | F4 acceptance path; cancellation’s retained-resource semantics. |
| [R08] | Assignment authority | Locked update helper and assignment transition validation boundary. |
| [R09] | Selector policy | Three-band model policy and independent staffing choice. |
| [R10] | v0.9 coverage map | Existing automated/live evidence and release commands; not a fresh execution result. |
| [R11] | v0.9.3 live RC acceptance | Hook/manifest/key failures and later non-interrupting delivery evidence. |
| [R12] | v0.9.7 RC7 failure record | Runtime-package omission and timestamp-sensitive iteration retry. |
| [R13] | v0.9.7 RC8/RC10 refresh record | Assignment binding omission and executor-shaped “direct coordinator” fixture. |
| [R14] | ADR 0059 | Missing-checkout, wrong-binding, and exact resource-absence recovery boundaries. |
| [R15] | v0.9.10 RC2 stage-connection audit | Lost preservation owner, fixture topology, failed-assignment exit, and bounded corrective scope. |
| [R16] | RC5 fresh-coordinator gate plan | Retained historical membership conflict; planned gate, not a passing result. |
| [R17] | Commit `1d55956` | Shared settled-predecessor classification and admission-time locking correction. |
| [R18] | Commit `011fe03` | Introduction of assignment reporting and lean closeout, including coordinator-work source. |
| [R19] | August 30 research note at the earlier audited commit | Research/architecture distinctions and unproven efficiency claims. |
| [R20] | August 30 preregistration at the earlier audited commit | Small retrospective comparison, limited claims, and measurement discipline. |
| [W01] | Gandhi et al., arXiv:2505.20182v1 | Specific strong–weak coding research; limited transfer to this setup. |
| [W02] | Anthropic context-engineering guidance | Selective context and separate exploration; not project-specific proof. |
| [W03] | OpenAI Codex plan guidance | Usage determinants and distinction from API billing; checked September 9, 2026. |

[R01]: https://api.github.com/repos/Wenjun-Mao/codex-orchestration/git/tags/aaae48d090bb8ca52b7cf488be53b455f893ce08
[R02]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/CHANGELOG.md
[R03]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/lessons-learned-v0.8.md
[R04]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/skills/coordinate/SKILL.md
[R05]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/lib/workflow-journal.mjs
[R06]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/lib/coordinator-work.mjs
[R07]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/lib/assignment-acceptance.mjs
[R08]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/lib/assignment-authority.mjs
[R09]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/lib/policy/selector-policy.mjs
[R10]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/coverage-v0.9.md
[R11]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/field-tests/2026-09-06-v0.9.3-rc-live-app-acceptance.md
[R12]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/field-tests/2026-09-07-v0.9.7-rc7-runtime-bundle-report-staging-failure.md
[R13]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/field-tests/2026-09-07-v0.9.7-rc8-refresh-assignment-binding-gap.md
[R14]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/adr/0059-settled-coordinator-closeout-admission.md
[R15]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/research/2026-09-09-stage-connection-audit.md
[R16]: https://github.com/Wenjun-Mao/codex-orchestration/blob/21096a7ad7aca10221a90bcb1b404dbb0c89aacc/docs/plans/2026-09-09-rc5-fresh-coordinator-live-gate.md
[R17]: https://github.com/Wenjun-Mao/codex-orchestration/commit/1d5595621f1b6d5afaf3daa3f38cb359fa3f8759
[R18]: https://github.com/Wenjun-Mao/codex-orchestration/commit/011fe039218c658c9303f48cad357cd38cf9e52b
[R19]: https://github.com/Wenjun-Mao/codex-orchestration/blob/ef78c35ef9e35afe722e317f9d89026b75941040/docs/research/2026-08-30-orchestration-routing-evidence.md
[R20]: https://github.com/Wenjun-Mao/codex-orchestration/blob/ef78c35ef9e35afe722e317f9d89026b75941040/docs/research/2026-08-30-routing-evaluation-preregistration.json
[W01]: https://arxiv.org/html/2505.20182v1
[W02]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[W03]: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
