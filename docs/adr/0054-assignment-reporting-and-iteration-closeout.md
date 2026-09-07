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
assignment route. A v0.9.6 route does not acquire these semantics retroactively;
v0.9.7 creates the first assignment-lived authority. Tests cover namespace
removal before later finals, multiple finals, acceptance ordering, archive
activity/ambiguity, local mutation/no-change proof, schema parity, and adapter
idempotence.

Archive dispatch is a single atomic claim persisted before the native host
boundary. Concurrent callers cannot issue the same archive operation, and an
ambiguous result requires exact private observation instead of replay. Closeout
captures each eligible member's clean branch tip before dispatch. After App
worktree reclamation it deletes that tip only when it remains an unattached
`codex/` task branch. A coordinator additionally requires one exact linked
worktree that is neither the caller nor primary checkout, and its tip must
already be an ancestor of the authenticated primary-checkout baseline before
archive dispatch and branch deletion. Source, caller, dirty, detached, and
unpreserved coordinator work remain protected. This applies to disposable
coordinators as well as accepted executors. When a user already archived the
coordinator and its worktree is gone, exact private archive observation plus
the same source-ancestry proof completes closeout without replaying a native
archive call.
