# Retained-obligation settlement

Status: Draft — pending external diagnosis/design review and user approval.
Target: next bounded patch after v0.9.12; no release or implementation authorized by this draft.

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

Working diagnosis: execution outcome and subsequent obligation settlement are
coupled too tightly. External review must challenge this diagnosis and identify
any existing complete public path before recommending a new mechanism.

## Scope and non-goals

Cover the exact retained-execution-to-settled transition, its use by acceptance,
coordinator closeout, and fresh/successor admission, including already-persisted
v0.9.12 records. Add concise recovery guidance and proportional regressions.

Exclude Plotloom's wrong-runtime-root case, arbitrary historical migrations,
changes to admission fence planning, routing policy, dashboards, daemons, broad
test refactoring, and general cleanup bypasses. No automatic pilot mutation.
Do not change published v0.9.12 bytes or require failed runs to become closed.

## Proposed contract — subject to review

1. Keep terminal outcome and original retirement evidence immutable. Record an
   authenticated subsequent settlement separately or through the smallest
   existing compatible extension. Do not flip `retained` to `released` blindly.
   Exact schema/command spelling is a design decision, not fixed by this plan.
2. Prefer one explicit reconciliation operation within the existing assignment
   lifecycle over another independent lifecycle manager. A read-only status or
   cleanup inspection must never silently release authority.
3. Prove settlement against the exact assignment/run/runtime/repository and all
   obligations: active claims/launches, executor archive/no-active evidence,
   Git resource disposition, preservation of accepted results, reserved but
   unused branches, path/resource ownership, and conflicting/shared owners.
   Missing evidence, missing directories, or zero physical cleanup candidates
   alone do not establish settlement.
4. Distinguish executor/run obligations from the coordinator resources that
   normal director closeout must subsequently retire. Avoid requiring the
   coordinator's own deletion as a prerequisite to issuing its archive action.
5. Reuse existing validators, locks, and evidence. Revalidate mutable facts
   before committing settlement; make retries idempotent and contradictory
   evidence fail closed. A crash must not release ownership without the durable
   evidence its consumers need.
6. Acceptance, closeout and successor/refresh classification must consume the
   same settlement meaning. Once coordinator reclamation is legitimate, later
   admission must validate durable settlement without requiring that deleted
   checkout to reappear. Unsettled abandoned runs remain blocked.

## Bounded checkpoints

### 1. Review the diagnosis and transition

Give Pro this draft plus the relevant source revision and observed evidence.
Ask for the smallest sufficient alternative, evidence sufficiency, ownership
races, and connections across settlement → archive/reclaim → admission.
Keep unresolved questions explicit; revise and obtain approval before dispatch.

### 2. Implement the agreed boundary

Map each obligation to its existing evidence producer and consuming gate.
Implement the minimal shared contract, schema/runtime parity, public entrypoint,
and concise ADR/recovery instructions. Preserve compatibility by reading old
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

Negative/recovery coverage: active or unresolved work, unpreserved commits,
unresolved path/resource ownership, shared resources, incorrect identities,
tampered/missing/stale evidence, an intervening conflicting mutation, partial
failure/retry, and a no-op repeat after successful settlement. Preserve ordinary
closed-run and existing refresh behavior. Exercise emitted recovery commands.

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
Do not add a coordinator layer or repeated director waits. No implementation,
task dispatch, push, install, or pilot mutation is authorized by this draft.

Pause for a decision if the fix needs broad migration, weakening preservation,
new host/private transport, manual registry edits, repository unplug, or a second
substantive lifecycle gap outside scope. A required App restart is user-owned.
Do not grow a succession of recovery mechanisms merely to finish the canary.

## Open review questions

- Is an existing public complete recovery path overlooked?
- What proves path/resource obligations are settled, beyond a clean Git cleanup plan?
- Where can settlement live with minimum duplicated state and safe concurrent use?
- Can acceptance and successor admission share that proof without circular cleanup?
- What is the smallest safe compatibility rule for existing v0.9.12 abandonments?
