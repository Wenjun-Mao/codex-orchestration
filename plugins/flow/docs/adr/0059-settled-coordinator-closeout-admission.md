# ADR 0059: Settled coordinator closeout admission

- Status: accepted for v0.9.9
- Date: 2026-09-08
- Authority: approved v0.9.9 coordinator closeout recovery plan
- Refines: ADR 0054, ADR 0055, ADR 0058

## Context

A v0.9.7 coordinator completed director acceptance and archived closeout, so
the exact disposable worktree and branch were removed. Its accepted report,
retired assignment, closed iteration, and release tag remained. Refresh still
tried to execute the historical source from that absent checkout and reported
`undefined` when Git could not spawn. Separately, route registration trusted
the caller checkout after checking only `CODEX_THREAD_ID`.

Two additional reported recovery cases belong to the live iteration registry,
not to refresh: a coordinator binding was already recorded from the primary
checkout, and another accepted coordinator removed both its own worktree and
branch before the director could invoke native archival.

## Decision

Coordinator route registration reads the host-created `codex-thread.json`
owner record from the candidate worktree's Git administration and requires it
to equal the active coordinator identity before persisting the initial cleanup
binding.

An already accepted coordinator can issue `assignment reconcile-binding` only
from its actual Codex App worktree. The registry retains the initially recorded
path and branch and appends the App-owner-authenticated replacement binding;
later cleanup reads the replacement. It never overwrites the original
assignment identity.

After the exact director-accepted report, `assignment accept` may carry the
explicit `resources-absent` recovery. The registry records the director, exact
accepted report, effective binding, and authenticated result-tip authority
only after it confirms that both that worktree and its disposable branch are
absent. The supplied tip is a replay fence, not a director choice. It must
equal either the ordinary pre-archive capture or one completed coordinator-work
record that is uniquely bound to the assignment's run, runtime, configuration,
repository, plan revision, coordinator task, and effective checkout. The
latter records its exact final revision and passing verification evidence; it
is the authority for the pre-capture-loss case, not an inference from primary
HEAD. The reconciliation persists that record's namespace, local-work ID, and
evidence digests for later revalidation. The ordinary closeout then emits and
reconciles the existing native archive action. If neither authenticated source
exists, recovery remains a manual director disposition. A missing resource, an
arbitrary ancestor, a second matching local-work record, or an accepted report
from another route cannot authorize recovery.

Refresh has one evidence-only exception for an absent v0.9.7 source checkout.
It recognizes the predecessor only when there is one closed run and one exact
retired coordinator assignment; the approved-plan bytes, closed archived route,
accepted report, archived closed iteration, absent registered worktree, absent
disposable `codex/` branch, and non-host Git ref at the captured tip must all
agree. The exception makes no state mutation and never treats absence alone as
preservation. Every other predecessor continues through normal source
authentication; incomplete or conflicting evidence blocks refresh.

## Rejected alternatives

- Recreate or reopen the archived coordinator worktree: this would invent live
  authority after accepted closeout.
- Generalize to all terminal predecessors: older source shapes need their own
  authenticated contracts and cannot inherit v0.9.7 assumptions.
- Rewrite the wrong initial execution binding: that would hide the original
  ownership error and change immutable assignment identity.
- Infer a vanished coordinator tip from the primary head: a caller may only
  repeat an exact pre-archive capture or uniquely bound completed
  coordinator-work result, which the source checkout then reauthenticates.
- Keep the source-runtime failure path and tell operators to inspect Git:
  source authentication must report the actual missing-process error.

## Consequences and guardrails

The closeout-recovery regression uses the exact v0.9.7 tag for the read-only
predecessor admission, and separately exercises the live registry paths. It
proves that wrong primary binding stays recorded while only the authenticated
worktree is removed; it also proves resource loss rejects when no result record
matches, rejects an unrelated ancestor even when one does match, records the
completed local-work authority for a pre-capture loss, emits the normal native
archive request, closes, and starts a new run in the same release namespace.
CLI coverage writes a matching worktree-owner record; mismatched ownership
rejects before route registration persists cleanup authority.
