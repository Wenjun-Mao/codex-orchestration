# v0.9.12 rollout consultations — local disposition

Assessment recorded after final stable acceptance. This is review, not approval
of a new implementation or pilot. Original reports are preserved unchanged as
`pro-1-report.md`, `pro-1-direct.md`, and `pro-2-direct.md`.

## Evidence boundary

Both Pros inspected release `f61b39faefb31ff7f70f111248928a28dc7bd108`
and final documentation `2e8738222028f169a4c59dc9d2b1b11736fc659a`.
Neither executed tests or accessed local App/journal evidence. Local checks here
used the documentation checkout after confirming no `lib/` or `test/` diff
against the release. No installed package, release tag, or lifecycle was changed.

## Findings and decisions

| Insight | Disposition | Evidence and boundary |
| --- | --- | --- |
| One restricted ordinary-project trial is justified; broad rollout is not | Use | Both reviews support this, but agreement is not proof. The installed coordinator-only ending passed; another project's mixed executor path remains unobserved. |
| Starting branch can disagree with the contract baseline | Use | Source confirms `validateRequestedWorktree` compares the declared revision to the contract, while `taskLaunchView` sends only the starting branch to the App. Reservation checks concern the executor branch. The existing mixed CLI fixture names `main` but creates the executor at the exact later baseline directly. Start-time validation fails closed; native manifestation has not been reproduced here. |
| Two refresh tests use a target identity equal to stable producer identity | Use | Locally reproduced: `node --test --test-name-pattern='applyRefresh retires an assigned' test/refresh-v09.test.mjs`: 0/2 pass, 4230.56675 ms; both receive `resume-source`, expect `refresh-ready` at line 1354. This is a test-scenario defect, not proof of a production upgrade failure. |
| Historical successor fixture writes predetermined output rather than deriving it from predecessor bytes | Test | Source confirms `produceSettledCoordinatorRun` writes `expectedResult`. Admission and retirement are exercised; input consumption is not established by that assertion. Existing live A/B verification is separate evidence. |
| Versioned namespace digests do not cover old shared assignment/reporting/iteration records | Test | Narrow the immutability claim. Later strengthen with byte comparisons of exact pre-existing records, not entire directories that legitimately gain records. No historical mutation demonstrated. |
| Connected fixture bypasses some reporting orchestration | Use | Imported report-record APIs complement, but do not equal, a frozen producer's native Stop-hook journey. Actual coordinator report delivery is separate live evidence. |
| Reclaimed open-assignment sibling test constructs state instead of proving a lawful public producer journey | Park | Treat as a classifier test, not complete mid-assignment upgrade acceptance. Do not exercise in-flight upgrades in the first pilot. |
| More broad audits or a new architecture reset before a trial | Discard | Neither review establishes that need. |

## Proposed next step

Settle the narrow test-identity and host-request-fidelity checks first. Do not
claim the earlier 230/230 run passed on the exact stable tag: these two scenarios
changed meaning at promotion. Preserve the successful installed-stable gate as
valid evidence for its actual scope.

A trial on unchanged v0.9.12 can contain the launch issue with a disclosed
read-only pre-dispatch equality check: the emitted starting branch resolves to
the contracted baseline, and stays there until authenticated executor start.
This is temporary trial guidance, not the durable product fix. The durable
follow-up belongs at the existing launch boundary before first host dispatch,
retaining start-time checks for subsequent drift. Correct the fake host to honor
the emitted selector; do not move primary ahead just to make the test pass.

No new release is intrinsically needed for test-only corrections. Any production
correction requires a new immutable version; never change v0.9.12 in place.

Then use one small reversible ordinary-project change with one coordinator and
one dependent executor, on the supported local host with eligible Flow state.
Require real input consumption, actual report delivery at both levels, accepted
integration and complete child/director closeout, followed by useful successor
verification. Freeze the package during the assignment. Stop on unsupported
recovery, ambiguous host actions, or repeated director protocol reconstruction;
do not turn the trial into another patch/restart campaign.

## Approved focused checks — completed

The user authorized the narrow checks before trying one or two projects.
Only the two test files were changed; no executable, schema, skill, hook,
manifest, installed package, or tag changed.

- Refresh tests now derive a synthetic next-patch consumer from the actual
  producer version. The genuine frozen historical producer remains unchanged.
  `node --test --test-name-pattern='applyRefresh retires an assigned' test/refresh-v09.test.mjs`
  passed **2/2 in 12.467 s**.
- The mixed CLI fixture leaves main behind local A, requests the coordinator
  branch, and creates the fake host worktree using the emitted branch rather
  than substituting the contract commit. Its explicit trial guard rejects the
  stale-main selector without changing worktree inventory, then admits the
  correct selector. The existing remainder verifies dependent work and lifecycle
  completion. `node --test --test-name-pattern='v0.9 CLI activates a clean run through current launch-era wiring' test/cli-v09.test.mjs`
  passed **1/1 in 12.169 s**.
- Both focused commands ran concurrently in independent temporary fixtures.
  `git diff --check` passed. Released production paths match `f61b39f` exactly.
  No full-suite rerun was needed or claimed, and no new live canary was created.

The wrong-branch guard is explicitly test/trial-side, not a claim that v0.9.12
now performs an automatic production preflight. Product follow-up remains open.
The real App executor-backed project trial is still to be performed.

### Trial handoff

Use installed v0.9.12 for one small reversible assignment on the same supported
local host. Inspect prior Flow state; stop on unresolved history rather than
cleaning it away. Keep the package fixed throughout the assignment. Pass this
restriction to the coordinator: before the native executor creation call,
resolve the emitted starting branch to a commit and require exact equality with
the generated contract's current baseline. After local work, use the named
coordinator delivery branch rather than assuming main is current. Do not advance
that starting branch until the executor authenticates its start. Stop on mismatch
before host creation. Complete normal reporting, acceptance, and cleanup; do not
silently convert a failure into a repair/restart campaign.
