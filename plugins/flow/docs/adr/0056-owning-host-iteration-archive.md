# ADR 0056: Owning-host iteration archival

- Status: accepted for v0.9.7
- Date: 2026-09-07
- Authority: approved owning-host archival correction
- Refines: ADRs 0054–0055

## Context

Assignment closeout opened a second App server and asked it to archive a task
whose session writer belonged to the running Desktop host. The request schema
was correct, but the second server could not acquire that live writer. Closeout
persisted only an ambiguous summary, so repeating the command could neither
recover the exact host error nor safely decide whether to replay the setter.

Accepted patch-equivalent integration exposed a second mismatch: serial
integration authenticated the executor tip, the cherry-pick-equivalent primary
tip, and combined verification, while iteration reclamation accepted ancestry
alone. Correctly accepted work could therefore remain unreclaimable.

## Decision

Assignment closeout never opens a second App server to archive a task. Fresh
typed host evidence must prove the exact visible task is idle; active, stale,
or unknown activity remains visible. Closeout then prepares exactly one
child-first action, persists its attempt before the host
boundary, and returns `set-thread-archived` to the owning role. That role calls
the Codex App archive tool and returns a bounded result containing the exact
attempt, thread, outcome, and optional safe reason/error code. Flow reconciles
the result, obtains exact archived/no-active observation, reclaims the worktree
without force, and completes the same run-level archive operation. A prepared
action replay reports `call_required: false`; accepted or ambiguous delivery is
never reissued merely because observation or reclamation remains pending.

Run archive completion precedes iteration-member completion. If worktree
reclamation succeeds and the process stops, resume uses the persisted archived
observation to complete the same run archive before marking the member archived.
If the worktree is still present, persisted archive proof is not current
deletion authority: resume must obtain a fresh archived/no-active observation
before reclamation. A fresh active observation stops removal and leaves the
operation pending.
An exact task already observed archived may seed that operation directly with
no invented active evidence and no setter call.

Executor closeout reuses the existing disposition-bound archive lifecycle.
Disposable coordinator closeout uses the iteration's existing archive attempt,
because coordinators have no executor disposition. No additional archive or
cleanup registry is introduced.

Reclamation normally requires captured-tip ancestry. For an accepted executor,
it may instead consume the exact reconciled integration when its outcome is
`patch-equivalent`, its authenticated executor tip equals the captured tip, and
the current primary checkout still descends from the integration's verified
reconciled primary tip. Recomputed patch similarity without that authority is
insufficient.

## Rejected alternatives

- Add another App-server fallback, private IPC client, or daemon. These widen
  infrastructure without transferring ownership of the Desktop session writer.
- Treat the archive setter as safely repeatable after an unknown response. The
  lifecycle preserves ambiguity until the postcondition is observed.
- Permit deletion whenever Git currently reports patch equivalence. That loses
  the authenticated disposition, integration, and verified-primary binding.

## Consequences and guardrails

The owning role, not the CLI, performs the one external archive mutation. Flow
continues to derive identity, eligibility, order, and cleanup authority. Host
diagnostics remain bounded and non-sensitive. Regressions cover idle/activity
gating, interruption before and after worktree removal, re-observation before a
resumed deletion, exact attempt matching, ambiguity without replay,
public/private already-archived reconciliation, schema/runtime observation
parity, run-level archive completion, child-first cleanup, dirty-state
rejection, and a real cherry-pick-to-reclamation path.
