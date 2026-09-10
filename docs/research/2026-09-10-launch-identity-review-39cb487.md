# Codex Orchestration: launch identity and iteration closeout review

**Review date:** September 10, 2026  
**Exact source:** `39cb487dfe5ae53f11aa67f5283f402121a5ca74`  
**Branch supplied for review:** `codex/v0.9.11-assignment-boundary-consolidation`  
**Source package version:** `0.9.11-rc.3`  
**Decision:** Proceed with a bounded simplification of launch-to-iteration authority before another candidate. Do not reopen the whole assignment architecture.

## Recommendation

**The proposed correction is substantially right, but adding a member-promotion call is not sufficient. Make the launch the authority for live executor identity; make the iteration a stable reference to that launch plus its own durable cleanup progress.**

This is both a missing connection and unnecessary duplicated authority. The launch already supports authenticated start independently of provisional creation provenance. The iteration keeps a second identity snapshot, keys membership partly by changing data, and can reject cleanup before consulting the authoritative launch. Correct that representation and its consumers together, rather than adding another ready-confirmation stage. [S2][S3][S4]

The required intervention is local: stable membership, authoritative identity resolution, replay-safe creation evidence, and connected verification. It does not justify removing the role structure, rewriting storage, or undoing the readiness/execution-retirement consolidation.

### Evidence boundary

GitHub confirmed the exact commit above and tree `4ba6f9909c82b9421bc1939c96cc5f3246609d68`. The source package declares RC3; this does not independently authenticate any installed artifact. [S1]

I inspected source, relevant tests, the current plan, ADR 0068, and host-operation instructions. **No repository tests were executed and no live behavior was independently reproduced.** The local Git access attempt failed on DNS resolution; connector source reads succeeded. No repository changes were made. The reported canary ordering, blocker delivery, and 219/219 result remain supplied observations, not my execution evidence. [U]

The current plan/ADR introduce assignment-owned readiness and retained execution-retirement facts. I am not carrying the previous revision's findings forward as unresolved by assumption; this review addresses the separate launch-to-member connection. [S10]

## 1. Findings and diagnosis

All source locations below are pinned to the review commit.

| Finding | Evidence status | Source and conclusion |
| --- | --- | --- |
| **F1 — Authenticated start does not publish executor membership** | Confirmed in source; live manifestation reported | `bin/codex-flow.mjs::commandTaskLaunchV09()` starts the launch and installs reporting. Membership registration occurs only after coordinator-side `reconcile`. The start branch returns first. [S2] |
| **F2 — Logical membership depends on a changing launch view** | Confirmed in source | `iteration-registry.mjs::registerExecutorIterationMember()` hashes the entire supplied launch into `authority_digest`; `memberFor()` includes that authority in `member_id`. The same launch at another stage becomes another member identity. [S3] |
| **F3 — Equivalent creation-result retries are timestamp-sensitive twice** | Confirmed in source; specific selector error reported | The CLI generates new observation timestamps. `normalizeSelectorUpdate()` compares complete selector evidence, and `reconcileTaskLaunch()` separately compares complete creation evidence. Fixing just one comparison leaves the other. [S2][S4] |
| **F4 — Provisional creation provenance should not be rewritten as ready** | Diagnosis confirmed; existing protection is justified | `creation_evidence` records the creation result. `start_claim` plus completed `git_activation` independently make the launch active. A later “ready” creation reconciliation is a different assertion, not merely an equivalent retry. [S4][S5] |
| **F5 — Start replay is not a sufficient general projection-recovery path** | Additional source-supported limitation; operational reproduction needed | `startTaskLaunch()` checks the current launch deadline and pristine original baseline before its completed-activation return. Late bookkeeping cannot rely solely on replaying start after a commit or expired window. [S6] |

**None of the four supplied diagnosis points is contradicted by the inspected code.** The important qualification is that a new ready reconciliation is not the right repair. It attempts to repurpose creation-result recording to update a downstream identity projection.

There is another detail inside F2: the supplied object is a **view**, not just the persisted record. `taskLaunchView()` adds `dispatch_permitted`, `activation_performed`, `execution_permitted`, and `host_request`. A digest of that object can depend on which command returned it. Merely preserving timestamps or excluding `status` would not make membership stable. [S5]

The present provisional cleanup refusal is appropriate for an unresolved identity. The architectural defect is that `assertMemberEligible()` rejects the cached null `thread_id` **before** resolving archive authority, even though that authority subsequently rereads and checks the launch. A stale projection therefore vetoes an authenticated fact. [S3]

## 2. Authority map: what to retain and what to derive

| Fact or decision | Recommended owner | Iteration's role |
| --- | --- | --- |
| Which launch belongs to which run, contract, and coordinator | Existing immutable launch identity and authenticated assignment execution binding | Stable, validated reference |
| What native creation actually returned | Original `creation_evidence` | No competing creation classification |
| Which executor claimed the launch | Authenticated `start_claim`; any known ready creation ID must agree | Derived identity; optional cached display fields |
| Which worktree/branch was activated | Completed `git_activation` and existing Git checks | Derived binding, later checked against cleanup evidence |
| Whether work is accepted/integrated/verified | Existing receipt, disposition, integration, and verification records | References, not another success decision |
| Which cleanup action was reserved and how far it progressed | Existing archive operation and iteration cleanup records, according to their current roles | Retain durable attempt/progress and child-first accounting |

This preserves necessary lifetimes. **Do not make the entire iteration a transient view:** durable cleanup attempts and reclamation progress must survive retries. Conversely, they do not require a second authoritative account of which executor the launch created. Existing cleanup already consults launch-backed archive authority, so using the launch for live identity does not introduce a new dependency at that boundary. [S3][S9]

The desired relationship is:

```text
Immutable launch reference
        ├── original creation provenance
        └── authenticated start + completed Git activation
                            ↓
                 effective executor identity
                            ↓
         iteration cleanup obligation and archive progress
```

A crash can still leave a stale stored projection. The improvement is that the projection is no longer competing authority: supported consumers resolve the fact and can reconcile the cache without inventing an identity.

## 3. Smallest coherent design

### A. Key members by the stable launch reference

Identify a logical executor member by the owning assignment and canonical launch reference: its authenticated state root/namespace and `launch_id`, with run/contract/coordinator binding validated. The existing `launchIdFor()` already hashes immutable launch intent rather than lifecycle observations. Reuse that identity instead of hashing the whole returned view again. [S5]

For new records, neither timestamps, accepted-selector observations, lifecycle status, presentation flags, nor newly discovered worktree paths should change logical member identity. Preserve one original `registered_at` and independent cleanup progress.

Also stabilize **host ownership**. Registration currently chooses `creation_evidence.host_id` when present and otherwise the assignment sender's host. The opaque-result CLI tests explicitly admit creation evidence with host `unknown`. That observation must not replace the already-authenticated owning host or produce a different member after start-first ordering. A genuinely contradictory known host must still fail. [S3][S7]

**Replaces:** full-view identity hashing, lookup solely by a changing member ID, and new-member creation caused by ordinary launch progress.

### B. Use one authoritative member resolver across publication and consumption

Use the existing locked registration/reconciliation path to resolve the exact persisted launch. Invoke it after authenticated start and supported start replay, and after creation reconciliation. Do not trust an older caller-supplied view as the current truth.

The important addition to the proposal is **consumer-side convergence**: status should expose the effective identity and incomplete projection; cleanup must resolve/reconcile the same authoritative link before deciding that membership is still provisional. This must also handle interruption before the first member is written—not only promotion of an existing provisional member.

Bind to the assignment through the launch's coordinator and exact execution binding, not the executor caller's thread ID. Preserve assignment readiness, current terminal-state restrictions, worktree exclusivity, and existing lock ordering. A replay may advance known identity; it must not resurrect a cancelled assignment, append an unrelated launch, reset archive progress, or downgrade ready back to provisional.

A ready creation ID is not completed branch activation. For ordinary execution/cleanup, require the existing start and activation authority and the usual result/host/Git checks. Keep the explicitly bounded stalled-provisional archival-recovery path separate. [S3][S8]

**Replaces:** the registry's independent live-identity decision and any need for the coordinator to “confirm ready” a second time. It adds no new public ready command or registry.

### C. Make creation-result replay idempotent without changing provenance

For replay of the **same recorded creation result**, compare its semantic facts: classification, known host identity, ready/provisional ID or opaque-result digest/length, and applicable selector values. Retain the original accepted/observed timestamps rather than generating replacement event evidence.

Apply this policy to **both** selector evidence and creation evidence. Preserve existing observations when a retry supplies no new observation; never erase a known value. Reject conflicting populated selectors, another task ID, another provisional ID, different opaque payload evidence, or inconsistent known host identity.

Do not classify a provisional-to-ready rewrite as equivalent replay. The launch already becomes active from its independent start evidence, while its original creation result remains provisional. `expectedStatus()` explicitly implements that separation. [S4][S5]

This is not permission to ignore timestamps generally: fresh host-activity evidence used for deletion has a different freshness contract. Nor should a later observation be silently relabelled as the original creation response.

**Replaces:** timestamp-sensitive whole-object equality for same-result replay, not immutable creation provenance or fresh cleanup observations.

### D. Separate activation replay from projection reconciliation

The proposed “publish on start replay” needs a bounded recovery definition. At this commit, start checks the current deadline, exact task baseline, and pristine checkout before returning an already-completed activation. [S6]

For a launch whose start/activation has already completed, identity reconciliation must read that persisted authority—not rerun Git activation or require resetting completed work to its baseline. If the public start retry is used to finish bookkeeping, distinguish that continuation from a new claim: preserve the original claim time and operation, authenticate the same actor, and do not grant a new activation window.

Consumer-side resolution is still needed for a completed executor whose work has already advanced. Keep fresh-start nonce, deadline, identity, and pristine-baseline protections; do not broadly relax them to make projection repair convenient.

**Replaces:** using a first-execution command as the only repair route for downstream bookkeeping.

### Alternatives

| Alternative | Assessment |
| --- | --- |
| Add the start-to-registration call only | Insufficient: mutable IDs, timestamp conflicts, and crash gaps remain. |
| Stable reference + derived live identity + durable cleanup state | **Recommended.** Removes duplicate identity authority while retaining necessary cleanup evidence. |
| Derive the whole iteration solely from current launches | Too broad: would discard or relocate cleanup history and must solve post-retirement evidence lifetimes. |
| Add ready-confirmation, another synchronization record, or a migration engine | Unnecessary: authenticated start already establishes the missing identity. |

## 4. Adjacent transitions to cover in the same correction

| Boundary | Required behavior |
| --- | --- |
| Provisional result first, then start | Update one logical member; retain original creation evidence. |
| Start first, then ready/provisional/opaque result | Identity comes from start; late evidence cannot create another member or replace known ownership with `unknown`. |
| Repeated reconciliation at a later time | Same result is idempotent, with original evidence times; genuine changes conflict. |
| Crash after start persistence, before membership/reporting completion | Resume from durable launch authority with no new task or branch activation. A partial cross-file publication is recoverable. |
| Late resolution after executor commits | Resolve identity without rerunning pristine-baseline activation; retain independent preservation checks. |
| Cancellation or refresh during incomplete publication | Count the actual assigned launch obligation, not merely currently materialized members. Do not infer “no executor” from an absent projection. |
| Cleanup and subsequent source retirement | Resolve pending identity while its evidence exists; completed cleanup retains the exact identity/action needed after legal source retirement. Do not add an indefinite live-file dependency. |

The cancellation/refresh rows are **required checks, not newly reproduced defects**. Current cancellation already blocks on unarchived iteration members and requires execution-terminal evidence. The additional question is whether those consumers remain complete when a member is missing or stale. [S11]

Likewise, do not make a stale read write back over a newer member. Matching a stable key is necessary but not enough: the merge must preserve monotonic identity and cleanup progress under existing synchronization.

## 5. Why tests and rehearsal missed this

The supplied explanation is supported by the inspected tests:

- `createActiveTaskLaunch()` constructs **start → ready creation reconciliation**. [S12]
- `acceptedChildFixture()` receives that active launch and registers membership once; it does not exercise the provisional-member transition. [S13]
- The provisional/opaque launch test ends after asserting that start made the launch active. It has no iteration/cleanup consumer. [S7]
- The assignment-bound CLI test ends after asserting the provisional member's title and provisional ID; it never starts that executor. [S14]

There is more coverage than “only happy-path unit tests”: the runtime-CLI test exercises multiple creation/reporting orderings and a partial start. But its fixture has no assignment-bound iteration, so it cannot validate the missing connection. [S7]

**The gap is at the intersection of supported ordering, public commands, and assignment-owned cleanup.** Broad lifecycle names or a large pass count do not establish that intersection.

The actual local rehearsal logs are unavailable. I cannot establish whether the rehearsal was skipped or exactly which commands ran. The source demonstrates that the cited tests do not prove the incident sequence. Separately, the supplied account says the live coordinator initially received a handwritten brief without its preparation ID. That is reported execution drift from the planned generated handoff—not an explanation for the executor membership defect, and not an uninterrupted first-turn coordinator pass. [U][S10]

## 6. Minimal verification and release checks

### One strengthened public-command journey

Extend the existing assignment-bound CLI/mixed journey, rather than adding a new harness:

```text
Director prepares the real coordinator brief
→ assignment registration/readiness
→ committed local A
→ derive genuinely dependent visible B
→ prepare/attempt B; fake only the native creation response as provisional
→ public reconcile persists that original response
→ executor's pinned public start establishes identity and branch
→ replay the original reconciliation later
→ B commits; receipt, integration, and verification
→ status/closeout resolves identity after that Git advance
→ owning-host closeout with typed fake host results
→ correct run/report/acceptance and actual local locator retirement
→ useful successor operation
```

Assert one logical member per launch, original creation evidence/times unchanged, real identity from start, and preservation of A and B. For executor B, count **one creation, one branch activation, one archive action**, and no repeats during retries; account for coordinator/successor actions separately. The coordinator cannot be cleaned up prematurely. Unknown or contradictory identity authorizes zero archive/removal calls.

Use narrow variants for the other distinct risks instead of repeating the whole journey:

| Variant | Decisive assertion |
| --- | --- |
| Start-first, including late opaque evidence | No second member, host downgrade, or loss of ready identity |
| Interruption after completed start but before projection write | Ordinary retry/consumer convergence; zero repeated creation/activation |
| Reconciliation after deadline and legitimate Git advance | Already-authenticated identity remains resolvable without resetting work |
| Wrong task/nonce/host/selector/reference; stale provisional snapshot after ready | Conflict blocks before side effects; stale data cannot downgrade state |
| Duplicate legacy references, pending archive, cancellation/refresh boundary | No guessed winner, lost obligation, rewritten attempt, or false completion |

Use explicit clock seams or synchronization barriers where needed, not arbitrary sleeps. These are proposed tests; none was executed in this review.

### Two lean release checks

**First: an ordering-aware local command gate.** Run the generated coordinator handoff and public launch chain through provisional-first and start-first cases, with at least the known failing ordering reaching its cleanup consumer. Rehearse the actual request shapes, not hand-assembled intermediate records. Existing focused negative/recovery tests carry the rest.

**Second: one scoped installed canary after the source gate passes.** Use the tool-generated brief containing its preparation ID, record the actual App ordering, and complete delivery through cleanup and useful successor work. Do not manufacture a provisional result if the App returns ready; state which live ordering was observed and which ordering is supported by automated evidence. A changed candidate requires its own immutable artifact identity, not silently replaced RC3 bytes.

The gate should not add a manual ready-confirmation step. That would hide the defect rather than verify the intended workflow.

## 7. Compatibility and the current failed canary

**Existing persisted members require an explicit reader policy, not necessarily a migration.** Their member IDs were derived from historical launch-view digests; changing that calculation can invalidate their identity or cause a second member to be created. [S3]

Prefer preserving existing member IDs, original digest provenance, timestamps, and archive progress while resolving logical membership through the stable launch reference. New members use the stable identity contract. Do not require an old view digest to equal the current launch digest: it described different bytes, and a digest alone cannot reconstruct the old snapshot.

Any supported legacy reconciliation must authenticate the existing record format, exact assignment/run/namespace/launch relationship, original provisional evidence where present, and completed start/Git binding. Require uniqueness by the stable reference and reject conflicting ready IDs, ownership, or archive evidence. Do not select the newest of duplicate members or silently merge attempts. An identity-format change must be explicit rather than a blanket bypass of member validation.

The compatibility boundary should name the known prior format/producers and an exit condition: remove its active-normalization behavior when no supported nonterminal members of that format remain. Preserve historical evidence rather than rekeying every archived record. If the exact reference or required provenance is missing, block instead of deriving identity from title, recency, or a similar path.

**This is separate from recovering today's failed canary.** The supplied account says no archive call occurred and completed work remains retained. Preserve that evidence. A correction in newer source does not authorize hot-switching a pinned active run or editing its journals. Recovery requires a supported, explicitly authorized transition; disposal of a test repository is neither necessary proof of this correction nor a normal prescription for real projects. [U]

## 8. Remaining uncertainties and decision criteria

The live record contents, installed artifact equality, 219/219 result, and actual rehearsal remain reported evidence. The late-start and legacy-projection consequences are source-supported but unexecuted. I have not established that every cancellation/refresh path currently handles an absent member incorrectly; that is a targeted verification obligation.

The cheapest decisive check is the exact provisional-first public-command journey, extended through cleanup, plus a fault between completed start and member publication. Add a delayed replay after real committed work to distinguish identity resolution from reactivation.

**Proceed with the bounded simplification—not a broad redesign—if those checks pass with one authoritative live identity, no manual ready confirmation, no special journal repairs, and unchanged safety gates.** If different consumers still need separate identity repairs after that change, consolidate those consumers around the same resolver before another installation.

The root correction is: **one launch establishes executor identity; iteration records track what must be cleaned up, not a competing version of who executed the work.**

## Source references

All repository references below point to `39cb487dfe5ae53f11aa67f5283f402121a5ca74`. References support source inspection, not claims that tests were executed.

- **[S1]** [Commit identity](https://github.com/Wenjun-Mao/codex-orchestration/commit/39cb487dfe5ae53f11aa67f5283f402121a5ca74); [package version](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/package.json#L1-L25).
- **[S2]** [Public launch start/reconciliation wiring](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/bin/codex-flow.mjs#L1055-L1260).
- **[S3]** [Member identity, registration, and eligibility](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/iteration-registry.mjs#L184-L570).
- **[S4]** [Selector and creation-result reconciliation](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/core/task-launch.mjs#L970-L1155).
- **[S5]** [Immutable launch seed and derived status](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/core/task-launch.mjs#L365-L520); [returned view fields](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/core/task-launch.mjs#L1317-L1435).
- **[S6]** [Live activation facts and start replay](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/core/task-launch.mjs#L1149-L1328).
- **[S7]** [Launch-order, runtime-CLI, provisional, and crash tests](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/test/task-launch-v09.test.mjs#L257-L540).
- **[S8]** [Host-operation contract](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/templates/references/host-operations.md); [parallel-execution contract](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/templates/references/parallel-execution.md).
- **[S9]** [Owning-host closeout and durable progress](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/iteration-registry.mjs#L1814-L2010).
- **[S10]** [Current consolidation plan](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/docs/plans/2026-09-09-v0.9.11-assignment-boundary-consolidation.md); [ADR 0068](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/docs/adr/0068-assignment-readiness-and-execution-retirement.md).
- **[S11]** [Execution retirement and cancellation eligibility](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/lib/assignment-acceptance.mjs#L1-L245).
- **[S12]** [Active-launch fixture](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/test/v09-lifecycle-fixture.mjs).
- **[S13]** [Accepted-child fixture](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/test/assignment-lifecycle-v097.test.mjs#L465-L675).
- **[S14]** [Assignment-bound CLI provisional registration test](https://github.com/Wenjun-Mao/codex-orchestration/blob/39cb487dfe5ae53f11aa67f5283f402121a5ca74/test/cli-v09.test.mjs#L200-L425).
- **[U]** Supplied review brief, `Pasted text(20260910-124301).txt`, especially lines 19–25, 34–76, and 89–99. This is the user's incident account, not independently inspected live journals.
