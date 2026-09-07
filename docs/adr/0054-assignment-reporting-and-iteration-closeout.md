# ADR 0054: Assignment reporting and iteration closeout

- Status: accepted for v0.9.7
- Date: 2026-09-06
- Authority: approved v0.9.7 assignment-reporting and lean-closeout plan
- Refines: ADRs 0049–0051

## Context

Coordinator report routes were stored and authorized by an execution run. Run
closure therefore retired the route before a later final could be captured.
Closure accounting also required every workflow task to look like a launched
child, so successful zero-child coordinator work could only be abandoned.
Finally, task archival was a remembered follow-up instead of a consequence of
reviewing accepted work.

## Decision

Coordinator reporting authority lives for one assignment. It binds immutable
approved-plan bytes, repository identity, exact sender and recipient, and every
authenticated execution binding. Its route, locator, and minimal plan snapshot
live in bounded shared Git-common-directory state, independent of removable run
journals. Run closure cannot mutate that state. Each genuine idle final has its
own source-turn record; acceptance chooses one delivered report. Only accepted
work plus resolved iteration closeout retires the route.

Workflow tasks may declare `execution_kind: coordinator`. `workflow local
start` binds the real coordinator and clean baseline; `workflow local complete`
runs declared checks and records an exact mutation revision or no-change proof.
Closure audit treats that evidence as a normal claim and never fabricates native
task identity.

One assignment also owns a command-managed iteration. Dispatch registers exact
director, coordinator, and executor membership from assignment or launch
authority. The coordinator route supplies the role/iteration/purpose title for
each executor launch, and the registry records that exact host-requested title;
it must not synthesize a different display claim after dispatch. Titles remain
display data. Coordinator closeout handles accepted
children first; director acceptance records review and handles the disposable
coordinator, route retirement, and locator retirement. Native archive attempts
are persisted per member. Active, provisional, ambiguous, dirty, unintegrated,
or still-attached resources remain resumable pending work.

Coordinator briefs combine model-authored outcome, scope, acceptance, and
action-changing reasons with command-derived IDs, a readable saved-plan link,
route, title, and entry mechanics. `assignment prepare` derives the plan digest
and immutable snapshot from the approved path. Registration validates that
snapshot; models do not supply a checksum, commit, or manual byte-authentication
step. Existing v1 preparations remain readable and are not rewritten.

The director recipient lineage is shared assignment authority, not execution
authority owned by any one coordinator run. A new coordinator route resolves
the prepared recipient against the current exact lineage binding and preserves
that binding byte-for-byte. It never supplies the sender run's fence token as a
recipient token. Initial recipient binding and explicit generation advances
remain governed by the recipient registry; mismatched or stale identities are
rejected rather than rebound during route registration. Generation one remains
mandatory only when a registry is first created. A later registration may
preserve an exact already-current generation without converting that operation
into an initial bind or a rebind.

## Rejected alternatives

- Keep a terminal run namespace solely for reporting. This couples unrelated
  lifetimes and prevents exact run cleanup.
- Waive unclaimed workflow tasks or create a dummy executor. Both make closure
  evidence untruthful.
- Discover iteration members from titles or project history. Display metadata
  and fleet scans are not authority.
- Retry ambiguous native archive operations automatically. That risks duplicate
  effects after an uncertain host response.
- Require the director or coordinator to compute and transcribe a plan digest
  or Git commit. The command already owns immutable snapshot creation and can
  bind the content without model-managed ceremony.

## Consequences and guardrails

Assignment state is a current bounded root and is included in exact unplug
inventory. New assignments receive fresh identities even for the same sender.
Old run callbacks remain fenced and cannot gain mutation authority from a live
assignment route. Authenticated refresh appends the exact admitted target
execution under the assignment lock before marking the handoff consumed or
deleting the source namespace. It retains historical execution bindings, treats
an exact retry as already bound, and rejects a changed target or a transition
that branches from an older binding. The assignment locator remains unchanged
because it addresses shared assignment state and an immutable content-addressed
reporter, rather than either execution namespace. A v0.9.6 route does not
acquire these semantics retroactively; v0.9.7 creates the first assignment-lived
authority.

Refresh decisions cover unfinished coordinator claims as well as visible
executors. An unfinished coordinator claim can only be discarded for semantic
reissue; it carries its exact local-work operation identity but grants no child
archive, worktree, or branch cleanup authority. Completed coordinator work,
integrated executor work, and accepted no-change work remain in the baseline
and are not pulled into the replacement dependency closure. Empty decisions
therefore mean a true no-work clean start, not an implicit coordinator bypass.
Tests cover namespace removal before later finals, multiple finals, acceptance
ordering, archive activity/ambiguity, local mutation/no-change proof, exact
coordinator refresh and interrupted assignment rebinding, schema parity, and
adapter idempotence. They also cover consecutive coordinator runs with distinct
sender fences targeting the same director, exact recipient-byte preservation,
registration replay, partial-registration recovery, and stale identity
rejection, including actual CLI registration for an already-current generation
two. This closes the missed live gate where only a fresh sender entering an
already-populated shared recipient registry exposed fence conflation.

Archive dispatch is a single atomic claim persisted before the native host
boundary. Concurrent callers cannot issue the same archive operation, and an
ambiguous result requires exact private observation instead of replay. Closeout
captures each eligible member's clean branch tip before dispatch. After App
worktree reclamation it deletes that tip only when it remains an unattached
`codex/` task branch. A coordinator additionally requires one exact linked
worktree that is neither the caller nor primary checkout, and its tip must
already be an ancestor of the authenticated primary-checkout baseline before
archive dispatch and again after host reclamation. A coordinator registered as
detached must remain detached and clean at that exact path; closeout captures
its exact HEAD, proves source-checkout ancestry across the host boundary, and
archives the task without inventing a branch or branch-deletion authority.
Changing attachment after registration is drift and fails closed. Source,
caller, dirty, attachment-drifted, and unpreserved coordinator work remain
protected. This applies to disposable coordinators as well as accepted
executors. When a user already archived a named-branch coordinator and its
worktree is gone, exact private archive observation plus the same
source-ancestry proof completes closeout without replaying a native archive
call. A detached coordinator needs a tip captured before archival; closeout
cannot reconstruct that authority after an unobserved manual removal. The same
observation may replace a definitive blocked/no-archive attempt; accepted and
ambiguous attempts retain their stricter concurrency and no-replay guards.
