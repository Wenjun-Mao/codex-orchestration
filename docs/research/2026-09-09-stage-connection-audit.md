# Stage-connection audit — v0.9.10 RC2

Status: decision-ready audit only. This report does not accept the release,
resume RC2, replay archival, or authorize an implementation.

## Scope and evidence boundary

Audited source is `1d5595621f1b6d5afaf3daa3f38cb359fa3f8759`
(`fix: admit exact settled predecessors`) in the clean release worktree
`/Users/wjmao/.codex/worktrees/fd80/codex-orchestration`. The primary checkout
is deliberately different: it is at `67f33358016a3102bcb7587d816c4edb65d40e7d`
on `codex/v0.9.7-skill-pruning`; `1d55956` is not its ancestor. The release
worktree and all Flow state were inspected read-only.

The observed RC2 evidence is
`.git/codex-release-evidence/v0.9.10-rc.2/1d55956/live-owning-host-closeout-pause.md`
plus the exact persisted launch, callback, disposition, verification, archive,
and iteration records under `.git/codex-flow/`. In particular, the launch
started from `codex/v0.9.10-identity-closeout` at `1d55956`; both that
coordinator branch and the retained executor branch currently name that tip.
The retained runtime context
`.git/codex-flow/v0.9.10-rc.2/contexts/3cfc6c889920374bfae5f7fc04bce552f606cc597702a4c90e16304fb02a814d.json`
and its bundle prove
that the installed/loaded RC2 package authenticated `0.9.10-rc.2`, the exact
102-file bundle `1bb657…edf`, local host/session, coordinator checkout, and
real `run activate` state. The same release evidence records real ready-task
creation and `task launch start`; it is positive RC2 evidence, not a test this
audit failed to repeat.

One selected existing test was run because its fixtures are disposable
`mkdtemp` Git repositories and it directly checks the settled-predecessor
contract: `node --test test/coordinator-closeout-recovery-v09.test.mjs` passed
8/8 in 13.0 seconds. No full suite, new harness, live App action, installation,
restart, state mutation, or source/test/schema/skill/config/package/journal
edit was performed; absence of a rerun does not negate the retained RC2 live
activation and start evidence.

## Connection and ownership map

| Connection | Classification | Producer → consumer and decision owner | Authoritative evidence and retained safety property | Existing coverage / explicit gap |
| --- | --- | --- | --- | --- |
| Plan → assignment → run/launch | Consistent for normal Flow dispatch; unsupported for the approved no-run audit exception | `assignment prepare` snapshots plan and recipient; the active coordinator registers the assignment/route; launch reconciliation adds the executor member. Director owns approved intent and acceptance; coordinator owns run/launch. | `lib/assignment-preparation.mjs:106`, `lib/report-routes.mjs:503`, `lib/assignment-authority.mjs:211`, `bin/codex-flow.mjs:1256`, and `:1137` bind plan bytes, sender/recipient, run, branch selectors, and iteration membership. This retains one approved plan and prevents the sender fence becoming the director fence. | `test/planning-contract-v093.test.mjs:33`, `test/coordinator-recipient-routing-v097.test.mjs:85`, and `test/assignment-lifecycle-v097.test.mjs:403` cover ordinary dispatch/replay. `preparedAssignmentText` at `lib/assignment-preparation.mjs:154` hard-codes activation and route registration, so it cannot itself represent this audit's explicit manual-report/no-run exception. The exception is currently carried only by the approved-plan constraint that supersedes the generated Start text. |
| Loaded distribution → refresh inspection → activation | Consistent; RC2 installed/loaded activation is evidenced | Distribution identity authenticates the loaded package/skill; refresh classifies source state; fresh activation repeats the classification while holding the admission lock. The loaded package and activation command own fresh checks. | `lib/distribution-identity.mjs:10`, `lib/compat/refresh.mjs:804`, `:902`, and `bin/codex-flow.mjs:595` now share bounded cachebuster identity and exact settled-predecessor classification. This retains strict source metadata, bundle/skill hashes, and rejection of unrelated inactive namespaces. The retained RC2 runtime context/bundle and active lifecycle record authenticate package `0.9.10-rc.2`, bundle `1bb657…edf`, source checkout, and real activation. | `test/release-identity.test.mjs:20`, `test/cli-v09.test.mjs:67`, and the selected `test/coordinator-closeout-recovery-v09.test.mjs:453` cover cachebuster admission, `inspect=fresh → activate`, preserved predecessor bytes, and missing-report rejection. A *new corrected candidate* will still need its own installed/loaded smoke; that is future-candidate evidence, not a missing RC2 fact. |
| Launch → first-turn start → result | Consistent | A prepared launch emits one complete first turn; the executor claims its nonce and binds its exact worktree; host reconciliation supplies ready/provisional evidence. Launch owns identity/branch attachment; executor owns the terminal result. | `lib/core/task-launch.mjs:430`, `:821`, `:1029`, and `:1232`; CLI wiring at `bin/codex-flow.mjs:1056`; and `templates/references/host-operations.md` reject a second prompt, invented ready identity, selector drift, and branch drift. | `test/task-launch-v09.test.mjs:189`, `:257`, `:304`, `:401`, and `:444` cover full first turn, ready/provisional ordering, partial start, and crash recovery. RC2 itself is a real ready-after-start case: the start claim precedes creation evidence and both bind the same executor thread. No live App creation was repeated in this audit. |
| Result → disposition → integration/no-change → verification | Consistent inside the result contract; its named target is lost by later cleanup | Terminal callback feeds a single disposition. Coordinator chooses no-change or integration; verification binds the exact receipt. Integration owns a named, clean current `main_branch`, not necessarily inventory entry zero, and records its reconciled target tip. | `lib/task-results.mjs:232`, `lib/dispositions.mjs:376`, `:549`, `lib/integration.mjs:332`, `:525`, `:674`, and `bin/codex-flow.mjs:1822` preserve receipt, selector, repository, target branch, and result identity. This retains the distinction between report, callback receipt, verification, disposition, and integration. | `test/lifecycle-v09.test.mjs:55`, `:181`, `:306`, and `:466` cover no-change, exact identity, integration, and selector enrichment. RC2 independently proves the no-change segment: callback final/baseline `1d55956`, PASS verification, and completed `accepted-no-change` disposition with no integration. Existing integration fixtures target primary `main`; none carries an integrated result through cleanup when a coordinator delivery branch is the named target. |
| Accepted result → archive → reclamation → iteration/run closure | Contradictory — observed for no-change; established static risk for both integrated outcomes | Executor disposition authorizes archive; owning host archives once; iteration owns physical reclamation and branch deletion. The exact non-disposable preservation owner is the launch `starting_branch` for no-change, or integration's named `main_branch` and reconciled tip for a mutating executor; primary owns the coordinator result later. | `lib/iteration-registry.mjs:1161`, `:1254`, `:1338`, and `:1603` retain child-first order, fresh archived observation, clean/unshared worktree checks, non-force removal, and no replay. `lib/archive-lifecycle.mjs:578` authenticates a reconciled integration but projects only outcome, executor tip, and reconciled tip at `:660`; cleanup then compares every executor to inventory primary. RC2 archive `archive-v1-e714…` is completed and its worktree is absent, yet the later predicate consults only old primary. | `test/assignment-lifecycle-v097.test.mjs:676`, `:776`, `:827`, `:875`, `:909`, `:967`, and `:998` cover archive/reclaim safety, including patch-equivalent integration. Its no-change and integration fixtures start and integrate at primary `main` (`test/v09-lifecycle-fixture.mjs:56` and `:108`; `test/assignment-lifecycle-v097.test.mjs:307`), so they cannot expose a newer coordinator delivery branch than primary. No test covers either integrated outcome in that topology. |
| Closure → reporting/acceptance → route retirement → next assignment | Consistent after closeout; RC2 is pending because connection five cannot finish | Queue acceptance preserves a report; director acceptance records review; resolved iteration closure retires the route and locator. Assignment owns report lifetime; run owns only runtime routes. Director owns acceptance and coordinator/executor closeout phases own their members. | `lib/assignment-acceptance.mjs:13`, `lib/report-routes.mjs:671`, `lib/run-lifecycle.mjs:790`, and `templates/references/assignment-and-reporting.md` retain the distinction between queue acceptance, review, archive, deletion, and route retirement. | `test/assignment-lifecycle-v097.test.mjs:367` proves coordinator reporting survives normal run close and removal of its execution namespace; `:621` proves route retirement waits for exact coordinator reclamation; `test/report-lifecycle-v093.test.mjs:51` and `:139` cover one accepted final and late-final fencing. RC2 has not reached this stage, by design: its iteration is `closeout-pending`, so retirement and next-assignment admission must remain blocked. |

## RC2 preservation chain and root cause

The paused state is not an archive retry condition.

1. The persisted launch requested executor branch
   `codex/live-owning-host-rc2-executor` from the coordinator delivery branch
   `codex/v0.9.10-identity-closeout`, both at `1d55956`.
2. The accepted terminal receipt says `unchanged`, with baseline and final
   revision both `1d55956`. PASS verification and the completed
   `accepted-no-change` disposition bind that fact to the exact launch.
3. The owning-host archive was accepted and then independently observed
   archived; the executor worktree is absent. Its iteration member correctly
   remains `archive-pending` until Git reclamation finishes.
4. `cleanupIterationGit` / `reclaimableIterationWorktree` call
   `assertIterationTipPreserved` (`lib/iteration-registry.mjs:1161`). Apart
   from an authenticated patch-equivalent integration, it requires the
   expected executor tip to be an ancestor of `authenticatedPrimaryWorktree`.
   That function unconditionally selects `git worktree list` entry zero
   (`lib/iteration-registry.mjs:681`). In RC2 that is the unrelated older
   primary at `67f3335`.
5. The result is rejected after the archive lifecycle has legitimately
   completed, even though the exact launch-bound coordinator delivery branch
   still preserves the no-change baseline. The code ignores that launch
   evidence and treats a checkout topology as the preservation owner.

This is a preservation-owner mismatch, not an archive retry condition or an
unsupported test topology alone. The test topology hid it because it made
`main` simultaneously the launch source and primary; RC2 proves a supported
coordinator-on-newer-delivery-branch state is not equivalent.

### Mutating-executor trace

The same mismatch exists for accepted mutating executors. This is a complete
static trace through the production binding, rather than a second live RC2
incident: RC2 itself is no-change and therefore supplies no integrated
counterexample.

1. `codex-flow integration` takes the caller's clean checkout and requested
   `main_branch` (`bin/codex-flow.mjs:1822`). `canonicalContext`
   (`lib/integration.mjs:332`) authenticates that checkout against the shared
   Git common directory and requires it to be on that *named* branch; it does
   not choose worktree-inventory entry zero.
2. `prepareSerialIntegration` records that `main_branch`, its prepared tip,
   the exact executor tip, and the bound receipt (`lib/integration.mjs:525`).
   Verification and reconciliation require forward history from the prepared
   target and persist the named target's `reconciled_main_tip` plus either an
   `ancestor` or `patch-equivalent` outcome (`:617`, `:674`). Thus a
   coordinator delivery branch newer than primary is a valid integration
   target.
3. `resolvedTaskArchiveAuthority` re-authenticates the reconciled integration
   but projects only outcome, executor tip, and reconciled target tip into
   `integrationPreservation` (`lib/archive-lifecycle.mjs:620`). It drops the
   persisted `main_branch` that identifies the preservation owner.
4. Cleanup then accepts an `ancestor` result only if the executor tip reaches
   inventory primary. For `patch-equivalent` it also requires the reconciled
   target tip to reach that primary (`lib/iteration-registry.mjs:1161`). Both
   fail when the named, authenticated coordinator delivery branch is ahead of
   a non-descendant primary, even though that named branch remains the actual
   integration target.

The integration contract therefore cannot retain a primary-only policy merely
because current cleanup says so. The authenticated named target is already the
owner inside integration; the archive-to-cleanup projection loses it. The
audit has not executed this topology against a real App/host, and the existing
fixtures all integrate at primary `main`; that is the remaining empirical
boundary, not a reason to retain the conflicting policy.

### Preservation ownership recommendation

Use one outcome-aware preservation rule at the archive-to-iteration boundary,
rather than a primary-only proxy:

- **Accepted no-change executor:** the exact launch's `starting_branch` is
  the initial preservation owner. It may authorize executor branch cleanup
  only when the receipt/verification prove `final_revision ==
  starting_revision == captured_tip`, the named starting ref still descends
  from that tip, and the source branch is distinct from the disposable
  executor branch. The coordinator delivery branch in RC2 satisfies this
  rule.
- **Accepted integrated executor (`ancestor` or `patch-equivalent`):** retain
  the exact reconciled integration and its completed verification, including
  matching executor tip and outcome. Preserve the integration's named
  `main_branch` in archive authority, require the current named ref to still
  descend from `reconciled_main_tip`, and require that target ref to be
  distinct from the executor branch before deleting the latter. For
  `ancestor`, the existing reconciliation already proves executor-tip
  ancestry; for `patch-equivalent`, retain the existing exact verification
  rather than inventing a fresh similarity calculation.
- **Coordinator:** retain primary ancestry before its own worktree/branch can
  be reclaimed. Once its delivery result is preserved in primary, coordinator
  closeout transfers the final responsibility to that primary ref.

The transfers are consequently explicit: launch binds the coordinator source
ref; a no-change receipt and verification prove the executor introduced no
new Git result; integration transfers a mutating executor result to its
reconciled **named target**; coordinator closeout finally transfers the
delivery branch's result to primary. The executor branch is evidence during
archive/reclamation, not the sole long-lived owner of a revision the same
cleanup is supposed to delete.

For either named owner, harmless movement is a forward ref update: the
persisted ref name remains present and its current tip is a descendant of the
captured source/reconciled target tip. It still preserves the necessary
object/result. The ref is unsafe if it is absent, rewound, reset, or diverges
such that that recorded tip is no longer its ancestor. This is not permission
to search for a different surviving ref. Integration currently does not
enforce `main_branch != executor_branch`; coordinator ownership guidance
implies that separation, but cleanup must not rely on guidance. Treating the
executor's own branch as an integration target must be rejected before it can
become its own alleged preservation owner.

## Ranked findings

1. **P0 / observed for no-change; statically established for integration /
   release-blocking — primary-only executor preservation.** RC2 demonstrates
   that `assertIterationTipPreserved` applies the coordinator's final primary
   rule to an executor no-change baseline. The end-to-end source trace shows
   it also discards the already-authenticated named integration target for
   both safe integrated outcomes. It blocks after a correct host archive and
   cannot be repaired by replaying that archive. User impact is immediate:
   iteration closure, route retirement, and release completion stop whenever
   the relevant coordinator delivery branch is newer than primary.

2. **P1 / demonstrated coverage gap — outcome-specific closeout lacks the
   delivery-branch-versus-primary topology.** The focused owning-host tests
   have broad lifecycle coverage, but their no-change and integration
   fixtures use primary `main` as the source/target. They do not exercise
   no-change, `ancestor`, or `patch-equivalent` cleanup against a coordinator
   delivery branch newer than primary.

3. **P1 / unverified recovery compatibility — a corrected package has not
   completed an RC2-shaped pending child through the existing closeout path.**
   The documented run-independent `assignment closeout` operation already
   resumes the same authenticated assignment/iteration phase and revalidates
   persisted authority; it is the bounded recovery path to assess, not a
   reason to introduce generalized recovery machinery. What remains
   unproven is compatibility with RC2's older state namespace, already
   archived/missing executor worktree, and retained delivery source ref.

4. **P2 / unsupported exception shape — manual audit dispatch.** Normal
   direct-dispatch guidance (`skills/direct/SKILL.md`) and preparation text
   correctly require active-run route registration for ordinary work. This
   audit is intentionally outside that contract, and its approved constraints
   override the generated Start line. Do not silently fabricate a route or
   weaken normal route admission. Add a represented manual/audit execution
   mode only if such approved exceptions will recur; it is not required to
   unblock RC2.

## Smallest coherent implementation checkpoint

Implement one narrow preservation-owner correction across the existing
archive-authority projection and iteration cleanup, not an archive workaround,
a global ref search, or a new recovery subsystem.

1. Extend `integrationPreservation` to carry the reconciled integration's
   immutable `main_branch` alongside its existing outcome, executor tip, and
   reconciled tip. At cleanup, select the owner by role and accepted outcome:
   the exact launch source for no-change; the exact integration target for
   safe integrated results; inventory primary only for the coordinator.
2. Resolve only that persisted local ref and require a current tip descending
   from its recorded preservation tip. Keep the exact callback,
   disposition/verification, archive, selector, worktree, child-first,
   non-force, and no-replay gates. Reject `main_branch == executor_branch`;
   preserve the existing patch-equivalent verification rather than recomputing
   it or accepting a merely similar arbitrary branch.
3. Add a parameterized real-Git closeout matrix in the existing owning-host
   lifecycle test file: (a) no-change with primary old and launch source
   forward-preserved; (b) `ancestor` integration to a named coordinator
   delivery branch newer than primary; (c) `patch-equivalent` integration in
   the same topology. Each should complete. Add paired negative checks where
   the exact source/target ref is absent or non-descendant, and where the
   integration target equals the executor branch; each must fail before
   executor branch deletion. Keep current primary/coordinator tests.
4. Add one compatibility checkpoint using persisted RC2-shaped state (or an
   exact minimized fixture): after the correction, the existing
   run-independent `assignment closeout` must be able to finish the archived,
   worktree-absent executor phase without a second host archive action. Then
   run the affected lifecycle/recovery tests and, once source settles, final
   candidate checks. A new candidate still needs its own installed/loaded
   smoke and actual-owning-host topology before promotion.

### RC2 recovery implications

No recovery action is authorized by this audit. No new generalized recovery
entry point is currently justified: the documented run-independent
`assignment closeout` command is already the bounded owner-phase recovery
operation. A future, separately approved RC2 recovery must first prove that a
corrected authenticated package can apply that existing operation to the
existing records. Its safe shape is:

- re-read and authenticate the exact RC2 launch, unchanged receipt, PASS
  verification, completed disposition/archive, iteration member, source ref,
  and current worktree absence;
- apply the corrected outcome-aware preservation rule only to that exact
  persisted authority, then complete pending executor branch reclamation
  without calling `set-thread-archived` again;
- use the original run's lawful close/audit path only after the iteration and
  archive state are coherent; and
- fail closed if the coordinator source ref or any recorded identity drifted.

It must not move the primary checkout, delete either retained ref in advance,
recreate the executor worktree, manufacture a new route/receipt, or activate a
competing run. If the compatibility checkpoint fails, preserve RC2 evidence
and make a separate decision on a narrowly version-compatible operation; do
not infer that a generalized recovery system is needed.

## Retain, combine, remove, and deferrals

- **Retain:** separate report queue acceptance, terminal receipt, combined
  verification, disposition, integration, archive observation, iteration
  member state, and assignment acceptance. Their lifetimes and safety claims
  differ; merging them would make the RC2 diagnosis less precise.
- **Combine:** the executor preservation predicate at the cleanup boundary.
  It should consume already-authenticated outcome-specific evidence, with the
  archive projection retaining the named integration target, instead of
  applying an unconditional current-primary ancestry proxy.
- **Remove:** the primary-only executor branch of that predicate for all
  accepted executor outcomes. Retain primary ancestry for coordinator
  results; retain exact integration evidence and its named target for both
  safe integration outcomes.
- **Defer:** a general manual-reporting assignment mode, a generic legacy
  migration/recovery facility, global ref discovery, test-harness redesign,
  live installation/reload, and any retry or cleanup of RC2. Each needs a
  separate authority decision.

## Verification gaps

- This audit did not rerun an installed/loaded-App smoke or live owning-host
  action. That is a reviewer non-rerun: the retained RC2 runtime context and
  release evidence already authenticate installed/loaded RC2, real activation,
  ready-task creation, and start. A corrected candidate needs fresh evidence
  of its own; the existing RC2 evidence cannot authenticate new code.
- The integrated delivery-branch topology and its cleanup are statically
  traced but not yet observed through a real App/host execution. The proposed
  focused real-Git matrix is the smallest direct guard before that candidate
  validation.
- Compatibility of the existing run-independent `assignment closeout` command
  with the old RC2 state root, already archived executor, and absent worktree
  is not tested product behavior.
- No external consumer audit was performed for a new recovery entry point;
  none should be introduced unless the compatibility checkpoint demonstrates
  a concrete need.
