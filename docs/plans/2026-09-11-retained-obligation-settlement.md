# Retained-obligation settlement

Status: Approved — user approved the reviewed amendments on 2026-09-11.
Target: next bounded patch after v0.9.12. Pilot recovery remains separately authorized.

## Outcome

An accepted delivery with an abandoned execution can finish coordinator closeout
and admit a useful successor once every remaining obligation is demonstrably
settled. Preserve the abandoned outcome and original evidence. Do not require a
new plugin upgrade, repository unplug, or manual state edits merely to release
resolved ownership.

## Evidence and limits

Observed in `codex_usage`, assignment
`coordinator-assignment-v1-39f25e0f8b22aceef3057f65e03d6ee102fdd89566385180781a9503e8a3b1ff`:

- Run `usage-v260-3832` was abandoned after its immutable path fences omitted
  two necessary production files. Product delivery subsequently completed.
- Director acceptance is persisted; three executor members are archived;
  assignment iteration remains `closeout-pending` with retained execution obligations.
- The project director reports a current cleanup plan with no active runs,
  no cleanup candidates/blockers, and resolved bound/unbound branch fences.
  That report is diagnostic evidence, not sufficient authorization to release
  every path/resource obligation or delete the coordinator checkout.

Source-confirmed in v0.9.12:

- `lib/assignment-acceptance.mjs`: terminal reconciliation skips executions with
  an existing retirement; acceptance stops on retained obligations.
- `lib/assignment-authority.mjs`: `released` requires a closed execution;
  a persisted runtime retirement can transition through refresh, but has no
  ordinary post-abandonment settlement transition.
- Admission/ownership consumers also exist in `lib/compat/refresh-source.mjs`
  and `lib/iteration-registry.mjs`. Unblocking acceptance alone is insufficient.

Diagnosis: an immutable conservative retirement observation is treated as the
current answer to whether obligations remain. Ordinary consumers lack a shared
interpretation of subsequent resolution evidence. This does not require new
stored settlement state. Conditional no-replacement clean-start refresh exists,
but needs different package authority, eligible task dispositions and namespace
removal; it is not ordinary history-preserving same-authority settlement.

The separate Plotloom v0.9.12 incident reports an out-of-scope coordinator commit
despite a ready closure audit. Review of the completion/helper/audit path supports
a missing committed-write-scope check; a public CLI reproduction is still needed.
See `../research/2026-09-11-coordinator-write-scope-review-addendum.md` and
`../research/2026-09-11-retained-obligation-pro-review/disposition.md`.

## Scope and non-goals

Cover the exact retained-execution-to-settled transition, its use by acceptance,
coordinator closeout, and fresh/successor admission, including already-persisted
v0.9.12 records. Add concise recovery guidance and proportional regressions.
Include a separately bounded companion correction for coordinator committed
write-scope validation at completion and audit, including old completed records.

Exclude Plotloom's wrong-runtime-root case, arbitrary historical migrations,
changes to admission fence planning, routing policy, dashboards, daemons, broad
test refactoring, and general cleanup bypasses. No automatic pilot mutation.
Do not change published v0.9.12 bytes or require failed runs to become closed.
Exclude generic same-assignment replacement after mid-run replanning. Preserve
existing open-assignment historical handling, but do not add a new replacement
binding contract. This checkpoint resolves accepted-delivery retirement, not
every ordinary planning omission. The premature-finals observation is separate.

## Approved contract

1. Keep terminal outcome and original retirement evidence immutable. First prove
   a shared derived obligation assessment using existing durable records. Do not
   flip `retained` to `released`, add a global flag, or introduce a new journal.
   A supplemental immutable disposition requires a demonstrated missing durable
   fact and a reviewed design decision, including frozen-reader compatibility.
2. Prefer the existing explicit `assignment accept` path as composition and
   authorization owner; native evidence producers retain their responsibilities.
   Read-only status/cleanup inspection never silently releases authority.
3. Prove settlement against the exact assignment/run/runtime/repository and all
   obligations: active claims/launches, executor archive/no-active evidence,
   Git resource disposition, preservation of accepted results, reserved but
   unused branches, path/resource ownership, and conflicting/shared owners.
   Missing evidence, missing directories, or zero physical cleanup candidates
   alone do not establish settlement.
   Traverse the complete admitted reservation/operation graph, not caller-selected
   members or literal active/completed status filters. An unused reservation can
   be settled only with proof of no unresolved producer and terminal dispatch
   authority. Paths need not disappear. Resource strings are repository-local
   exclusive reservations under ADR 0017, not external leases. Preserve other
   owners' rights and existing patch-equivalent preservation rules.
4. Distinguish executor/run obligations from the coordinator resources that
   normal director closeout must subsequently retire. Avoid requiring the
   coordinator's own deletion as a prerequisite to issuing its archive action.
5. Reuse existing validators, locks, and evidence. Revalidate mutable facts
   before committing settlement; make retries idempotent and contradictory
   evidence fail closed. A crash must not release ownership without the durable
   evidence its consumers need.
   Document lock order. Recheck admission under its repository lock before target
   preparation, and Git facts at destructive boundaries; do not hold locks over
   host waits. Flow locks do not exclude arbitrary external Git writers.
6. Acceptance, closeout and successor/refresh classification must consume the
   same settlement meaning. Once coordinator reclamation is legitimate, later
   admission must validate durable settlement without requiring that deleted
   checkout to reappear. Unsettled abandoned runs remain blocked.
   Include CLI activation preflight, native `retainedFenceConflicts`/reporting,
   historical classification and sibling-source checks, not only acceptance.
   Execution settlement, coordinator reclaimability and historical admission
   have different stage prerequisites, not different settlement meanings.
   Preserve open-assignment history semantics. Proof must survive authorized
   archive/route/assignment updates; do not hash entire mutable records as a
   permanent settlement predicate. Reconstruct using surviving authority and
   Git objects, never an exporter that requires the removed checkout as cwd.

### Coordinator committed-write scope

Use one validator at completion and audit/close-time revalidation. Compare
coordinator-owned committed transitions to the exact task write set and cover
run-wide changes since admission against the immutable envelope. Changes before
local-work start or between operations cannot disappear behind a later baseline.

Attribute child integrations through exact existing integration authority, not
authors or subtraction of child filenames. Additional coordinator edits and
merge resolutions require their own authority; ambiguous attribution blocks with
a precise diagnostic. Cover rename source/destination, deletions and path-component
boundaries with unambiguous filename handling. Resnapshot after supplied checks
before publishing completion evidence.

The promised property covers reachable committed transitions: a later revert
does not authorize an earlier out-of-scope commit. It does not certify transient
uncommitted writes or unavailable/rewritten history. Preserve the distinction
between product acceptance, execution compliance and safe retirement. Failed or
noncompliant work may be safely retired without becoming compliant. Historical
PASS may retain identity/preservation value without proving scope compliance.

## Bounded checkpoints

### 1. Establish decisive failing cases

External review completed; originals and separate disposition are preserved in
`../research/2026-09-11-retained-obligation-pro-review/`. Neither reviewer ran
Flow. Three Git-only comparison probes were independently reproduced locally;
they are not lifecycle evidence. Build the smallest public-CLI failure cases and
valid controls before implementation, using existing real-Git fixtures.

### 2. Implement the agreed boundary

Map each obligation to its existing evidence producer and consuming gate.
Implement the shared derived interpretation and approved scope validator,
schema/runtime parity and concise ADR/recovery instructions. Preserve compatibility by reading old
records without editing their terminal histories. If safe interpretation of
v0.9.12 evidence is impossible, stop with the exact missing fact.

### 3. Prove the connected path

Use a disposable real-Git repository and public CLI operations to construct the
failure, not hand-authored terminal success. Demonstrate:

`abandoned retained run → accepted delivery → authenticated settlement → director
archive/reconcile → coordinator reclamation → route/locator retirement → useful
fresh successor under the same candidate package`.

Verify original terminal evidence stays unchanged and successor access does not
depend on reclaimed paths. Include a persisted v0.9.12 producer case; candidate
code must not need to replace the old immutable runtime.
The successor must perform a real write using previously retained path/resource
authority under the same candidate package. Inspection or a disjoint read-only
successor is not enough. Prove the assessment remains reconstructible before
and after coordinator reclamation without new state; escalate the exact missing
fact if it cannot. Include later stable historical consumption.

Negative/recovery coverage: active or unresolved work, unpreserved commits,
unresolved path/resource ownership, shared resources, incorrect identities,
tampered/missing/stale evidence, an intervening conflicting mutation, partial
failure/retry, and a no-op repeat after successful settlement. Preserve ordinary
closed-run and existing refresh behavior. Exercise emitted recovery commands.
Include existing no-replacement refresh controls (changed authority, identical
authority rejection, unfinished work requiring replacement), and preserve
cancelled-coordinator reuse/open-assignment controls. Interrupt at existing
archive/reclamation/route/locator/assignment durable boundaries; resume without
host replay or lost obligations. No low-level forced close or fabricated journals
substitute for the connected journey.

Scope tests: outside both envelopes; inside run but outside task; inherited
pre-activation file; pre-local-start and between-operation commits; add/revert;
rename/deletion/path-prefix cases; valid child integration versus unauthorized
child-path overwrite; authenticated merge versus coordinator resolution edits;
check commands changing Git state; old completed records. Keep valid mutation,
no-change, patch-equivalent and preservation controls. Repair unrelated test
fixture authorities so they still reach their intended assertion, not by
weakening the new check.

### 4. Review and release only the tested correction

Independent focused review, then one full suite on final candidate bytes plus
schema/source/package/plugin/skill validation and whitespace checks. Rerun only
affected checks for later isolated changes, reporting exact coverage honestly.
One isolated live owning-host closeout/admission segment must pass before stable
promotion; simulated archive fixtures alone are insufficient. Keep outer
delivery on its pinned stable runtime, stage the candidate separately, and make
any App update/reload boundary explicit.

Consolidate approved unreleased corrections into one immutable patch release.
Verify installed artifact equality and loaded authority after required restart.
Only then perform separately authorized pilot recovery using normal commands;
do not count a successful product release as successful Flow closeout.

## Authority and escalation

Director owns approval and acceptance. After approval, use one bounded Sol-high
coordinator for the interacting ownership/retirement contracts; it may use
explicitly selected cheaper workers for independent implementation or review.
Do not add a coordinator layer or repeated director waits. This approval covers
the bounded design; dispatch follows the direct skill rather than implementation
in the director task. Pilot recovery and scope expansion require separate authority.
Plotloom's already-approved source-only continuation remains valid: ordinary Git,
tests and director review, with blocked Flow records/resources preserved.

Pause for a decision if the fix needs broad migration, weakening preservation,
new host/private transport, manual registry edits, repository unplug, or a second
substantive lifecycle gap outside scope. A required App restart is user-owned.
Do not grow a succession of recovery mechanisms merely to finish the canary.

## Implementation decision gates

Approved follow-up: shared delegation guidance requires owners to collect native
subagent results before ending their turn. Work continuing after owner idle uses
a visible task with the plugin reporting route. This is instruction-only: no
wake-up alternatives, new watchdog, or notification/lifecycle mechanism.

- Identify existing evidence for every admitted obligation, including unused reservations.
- Prove derived assessment survives closeout without a supplemental receipt.
- Establish exact integration attribution; stop on genuinely unavailable authority.
- Verify frozen v0.9.12 and same-package overlapping successor paths separately.

## RC1 live-gate split-evidence follow-up

The first installed RC1 successor authenticated the retired v0.9.12 producer,
admitted the same path/resource authority, committed the exact useful successor
write, and passed coordinator completion. Its operator also supplied
`branch_fences: ["main"]` even though the coordinator checkout was detached and
the workflow contained no executor task. That unused reservation made the
public audit fail solely with `unbound-branch-fence-live` against the protected
primary checkout.

This is first an operator construction error. Cleanup and audit behaved
correctly by refusing to reinterpret, delete, or detach the live primary branch.
It also exposes a bounded prevention gap: admission rejects a branch fence equal
to the coordinator's recorded branch, but a detached coordinator records
`detached`, so the same check does not reject a branch already attached to the
authenticated primary checkout. Address that gap in a separately scoped future
change with one focused admission regression; do not widen this RC or duplicate
the committed-write-scope suite.

The user approved split evidence for RC1. Preserve and truthfully abandon/cancel
the failed run with its immutable fences. A fresh isolated supplementary run
must repeat the same one-line useful write from an exact producer-line baseline
with `branch_fences: []`, then pass normal audit, close, reporting, acceptance,
archive and reclamation. Its evidence complements the preserved live settlement
and overlapping-admission records; it is not an uninterrupted second
producer-to-successor journey.

The supplementary coordinator also manually invoked the report hook once with
a synthetic turn ID while still active. Preserve that record as negative
provenance only: it is not native-final or idle evidence and must not authorize
acceptance. The actual final was subsequently captured under its real native
turn identity and accepted only after independent idle verification. Follow up
through concise operator guidance; do not expand this release with a new report
transport or runtime change.
