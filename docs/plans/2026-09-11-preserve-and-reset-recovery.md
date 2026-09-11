# Preserve-and-reset recovery

Status: Draft — requires user approval before implementation.
Target: next bounded release after v0.9.13; no pilot reset is authorized here.

## Outcome

A project director can recover from a failed or obsolete Flow workflow through
one understandable, explicitly authorized preserve-and-reset operation: protect
the work, quiesce the old workers, retire failed workflow authority honestly,
archive the selected workers, remove exact project-local Flow metadata, and
prepare fresh work. The user approves meaningful scope rather than repeatedly
navigating internal lifecycle transitions.

Reset is not successful delivery. Its evidence is preservation, quiescence and
bounded removal, not fabricated completion, compliance, or product acceptance.

## Evidence and diagnosis

Plotloom P0 committed `.env.example` and `docs/development.md` outside its admitted
envelope. v0.9.13 correctly refused completion, leaving a started correction
claim. Fresh P1 admission was blocked. Same-version refresh is unsupported;
abandonment and cancellation retain obligations; unplug refuses active runs.

The incident was ultimately recovered with existing public commands: verified
external backups, owning-coordinator abandonment, director cancellation after
report settlement, a new exact unplug plan, approved metadata-only apply, and
fresh preparation. Source, refs, tasks and worktrees were retained. This proves
the recovery building blocks, not a convenient end-to-end reset interface.

The initial scope omission and the disproportionate recovery cost are separate
problems. This checkpoint addresses recovery. Earlier scope checks remain a
named follow-up rather than a second implementation workstream.

## Scope and non-goals

Compose existing run, assignment, reporting, archive and unplug operations into
a concise repository-scoped recovery entrypoint. Prefer extending the existing
unplug workflow; do not create a parallel cleanup engine or generic framework.
Include a concise ADR, actionable status/recovery guidance, and connected tests.

Exclude same-version live scope amendment, replacement claim states, automatic
reset on failure, product acceptance, version bumps to unlock transitions,
global plugin removal, cross-host recovery, dashboards and background daemons.
Do not reset Plotloom or another pilot as part of implementation. Do not modify
already-published artifacts or retroactively certify historical writes.

## Consequential decisions

1. **Preservation first.** Inventory the exact Git common directory, refs,
   worktrees, committed work, uncommitted/untracked files, Flow records and
   pending assignments. Verify a recoverable external backup before retiring
   authority. A Git bundle alone is insufficient for working-tree files.
   Exclude unrelated/large ignored caches from copying by explicit inventory,
   not an assumption that ignored files are disposable. Store backups privately;
   environment files and reporting history may contain secrets. Never push them.
2. **Separate reset from Git cleanup.** Default to preserving all source,
   worktrees, branches and remote refs. Archive only the exact selected old
   worker tasks, never the director or unrelated tasks. Explain App-managed
   worktree reclamation effects before authorization; verify preservation first.
   Optional Git deletion requires explicit targets and existing cleanup checks.
3. **Quiesce before retirement.** No reset while selected workers, native
   subagents, or relevant tool/background operations can still write or report.
   Resolve provisional identities rather than guessing task membership from
   titles. Revalidate activity and repository facts at action boundaries.
4. **Truthful terminal states.** Reuse owning-run abandonment and assigned-director
   cancellation. A started claim remains historical failed/unfinished evidence,
   never completed merely to unblock reset. Reconcile every bound execution and
   pending report through supported paths. Queue acceptance is not product
   acceptance. Preserve ambiguous host/report outcomes; do not blindly replay.
5. **A bounded authorization, not blanket deletion.** Present preserved work,
   selected tasks, exact metadata roots, optional Git deletions and expected
   effects together. Existing unplug still validates its exact final plan/digest.
   Determine during design whether one parent authorization can safely cover
   the predictable abandonment/cancellation changes before that final digest is
   known. If current contracts require two approvals, say so; do not bypass the
   digest gate to promise one click. Unexpected scope/resource changes require
   renewed approval; ordinary planned transitions must not cause endless prompts.
6. **Reuse durable progress.** Resume from existing run/assignment/archive/unplug
   records. Keep backup manifests and returned transition receipts outside roots
   scheduled for removal. Do not add a second lifecycle journal unless a concrete
   interruption case proves a fact cannot be recovered from existing records.
7. **Fresh means fresh.** Verify unplug's actual postconditions and reporting
   retirement before preparation. Old run/assignment/preparation IDs must not be
   restored as live authority. Reusing an idle native task is allowed only if
   existing fresh-registration rules permit it; it does not reuse old authority.
   Retained worktrees/tasks are reported separately from zero Flow-state residue.

## Checkpoints

### 1. Minimal contract and interface

Map the actual public command sequence and role ownership, including archive
timing, pending reports, provisional tasks and interruption boundaries. Demonstrate
which steps can already be composed and name any missing fact or authorization
contract. Choose a concise skill-led workflow plus only the deterministic helper
needed for safe inventory/preservation/resume; command names are not prescribed.
Record the decision in one ADR. Stop for review if a new state machine, relaxed
safety contract or substantially broader helper is necessary.

### 2. Implementation and connected proof

Implement the bounded interface with existing validators and host operations.
Extend established fixtures instead of duplicating lifecycle engines or suites.
After this checkpoint, attempt the real user-visible reset journey next; do not
continue building instrumentation without exercising the outcome.

### 3. Isolated acceptance and release

In a disposable repository, reproduce a started claim blocked by an out-of-scope
commit. Preserve useful committed and uncommitted work, perform authorized reset
with real task/report/archive behavior, then admit and complete a useful fresh
assignment. Keep the controlling installed runtime stable while staging candidate
work separately. Coordinate any shared install/restart with active projects.
Promote one useful release after evidence review, without unnecessary interim
publishing or repeated full-suite runs.

## Acceptance evidence

- Failed claim stays honestly failed/unfinished in verified external evidence;
  no successful completion or product acceptance is manufactured.
- Exact committed, modified and untracked source survives; refs/remote refs and
  unrelated worktrees/projects are unchanged except explicitly approved effects.
- Selected workers are quiescent and archived; no stale reporting can reactivate
  retired assignments. Unknown membership/activity blocks only the unsafe action.
- Tested interruptions after abandonment, cancellation, host archival and unplug
  resume without duplicate host calls or lost evidence; source/plan drift stops.
- Missing backup, changed backup/source, unresolved reports, active workers and
  unapproved paths are rejected before the relevant destructive action.
- Public CLI end-to-end test covers failure → preservation → retirement → reset
  → corrected fresh admission; one isolated live exercise covers owning-host
  behavior. A read-only fresh inspect alone is not completion evidence.
- Report user-visible steps and intervention points against the Plotloom sequence.
  Demonstrate reduced coordination, not merely another wrapper over unchanged
  manual troubleshooting. Document any remaining approval boundary clearly.
- Focused tests first, one proportionate final suite; distinguish fixture, live
  and manually assisted evidence. Do not claim uninterrupted success after repair.

## Execution authority and escalation

After approval, director prepares this saved plan and dispatches one Sol-high
coordinator. Coordinator owns technical breakdown and bounded implementation;
use capable cheaper workers where useful. Native subagent results must be
collected before the owning turn ends. Director owns acceptance and exact live
reset authorization; no nested coordinator creation or unattended native work.

Escalate for unpreserved source, unknown/shared ownership, missing terminal/report
authority, unexpected deletion targets, forced Git operations, new durable state,
relaxed safeguards, or a changed acceptance journey. Stop for required user-owned
App restart. Ordinary implementation details do not require repeated approval.

## Deferred prevention

Keep intended-deliverable/write-path review and a staged-file scope check as the
next bounded prevention proposal. They can catch omissions earlier but cannot
replace a safe reset path for mistakes or legitimate changes already committed.
