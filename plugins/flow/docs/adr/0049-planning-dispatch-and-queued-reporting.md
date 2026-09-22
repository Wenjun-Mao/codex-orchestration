# ADR 0049: Durable planning and director dispatch

- Status: accepted for v0.9.3 implementation
- Date: 2026-09-06
- Refines: ADR 0048 director, coordinator, and reporting boundaries

## Context

ADR 0048 separated strategic ownership from bounded delivery, but the package
still lacked a named planning contract. A director could settle intent in
conversation without leaving an authenticated plan that a linked coordinator
could read, and “Implement the plan” could pull the director into local
implementation or progress monitoring. The result boundary was similarly
underspecified: a coordinator could return through an assignment path without
one explicit complete report for review.

The v0.9.3 plan also establishes a same-local-host queued-reporting boundary.
That transport must preserve a complete final and avoid interrupting a busy
recipient, while remaining distinct from terminal receipts and acceptance.

## Decision

Add `codex-orchestration:plan` as the durable project-plan contract. The
director and user settle one plan containing outcome, scope and non-goals,
important decisions, checkpoints and dependencies, acceptance evidence,
execution authority, and escalation conditions. The plan is saved before
dispatch, marked as an approved revision, and bound to exact content through a
digest or immutable snapshot. Its readable source path is retained for
navigation, but the path alone is not authority. A linked worktree receives
the authenticated approved bytes or an immutable snapshot; it must not depend
on an uncommitted director checkout.

The plan skill may write planning documents in ordinary mode but does not
implement product changes. Native Plan mode remains optional. There is one
approved project plan, not separate director, coordinator, and executor plans.
The coordinator may add technical detail without changing approved intent; a
material change to intent, acceptance, risk, scope, or external authority
requires a new director/user approval.

The director contract for “Implement the plan” is persist/bind the approved
plan, dispatch one coordinator, report the bounded dispatch state once, and
return to strategic conversation. It does not repeatedly wait, inspect
progress, retry a provisional creation result, or narrate implementation. The
coordinator receives the real approved assignment in its initial prompt, owns
delivery, and returns one complete result brief to exactly one named
recipient/path. The coordinator may orchestrate executors; an executor remains
bound to its own implementation and evidence assignment.

Automatic full-final reporting is a thin same-local-host native-queue adapter
boundary. A registered route binds exact sender and recipient task/host
identities, assignment identity, and applicable runtime/generation authority
before work is armed. The completion hook captures the task's complete final text
once, submits a bounded untrusted report envelope to the native queue, and
deduplicates by assignment, turn, recipient binding, and final digest. Queue
acceptance is only submission evidence, not recipient delivery, review, or
acceptance. Busy recipients are not Steered; pending or ambiguous submissions
are retained for manual recovery and are never blindly retried. Cross-host
delivery remains manual and out of scope for this release.

The native `clientUserMessageId` is the SHA-256 digest of the persisted report
record ID. The report state machine keeps its readable prefixed ID, while the
adapter receives the exact digest-shaped idempotency key its boundary requires.
Tests must exercise this caller-to-adapter mapping rather than only substituting
a queue function that accepts arbitrary keys.

Visible-task activation registers the executor route before the start command
returns. Coordinator first-turn acceptance registers a distinct active-run
route bound to the approved-plan digest and director generation. A
repository-local sender locator pins immutable reporter hashes and the exact
supported native configuration so a `Stop` or thread-spawn `SubagentStop` hook
can resolve its route from the sender worktree without a global task scan or an unavailable hook-only
environment variable. The adapter owns that locator; repository route and
delivery records remain the sole governance state machines.

The executable reporter has the same lifetime as that locator. Route
registration stages a complete content-addressed reporter runtime under the
sender's repository-local locator state and binds its digest into reporter
authority. Session and subagent start hooks install one immutable v1 launcher
in writable `PLUGIN_DATA`; completion hooks always enter through that stable
launcher, which authenticates the sender locator and every staged runtime byte
before execution. The installed plugin cache is package-discovery authority,
not an active route's executable store: Codex may remove an old version during
upgrade while an already-loaded task still has a pending final. Runtime state
is sender-scoped, is removed with exact locator retirement, and remains covered
by existing repository unplug ownership. No mutable latest pointer, daemon, or
global route registry is introduced.

Pinned execution-runtime bundles include the package metadata required to stage
that reporter runtime. Route registration is locally resumable after partial
assignment, iteration, or route persistence: replay preserves the original
iteration timestamps and completes the missing locator transition.

Route lifetime follows assignment lifetime. Completing a task disposition
closes that launch's route, and closing or abandoning a run closes every
remaining route owned by the run. A closed route cannot be re-armed, so late
completion events cannot revive terminal reporting authority. Codex App tasks
created through the native task surface are thread-spawn sessions and therefore
complete through `SubagentStop`; independently opened root tasks complete through
`Stop`. Both events share the same exact final fields, sender fencing, and one-shot
report path, while `SubagentStop.agent_id` must equal the routed session identity.

## Rejected alternatives

- Keep the approved plan only in conversation or a mutable director path. A
  linked coordinator cannot authenticate or reliably read either one.
- Require three rewritten plans. Rewriting duplicates approval authority and
  makes ordinary technical refinement look like a change of intent.
- Let “Implement the plan” mean local director implementation or open-ended
  babysitting. That collapses the ownership boundary and prevents strategic
  continuity.
- Steer a recipient or poll for idle state when a final is available. Native
  queue scheduling owns the turn boundary; polling creates a second scheduler.
- Treat queue acceptance as delivery or acceptance. Transport evidence does
  not prove a recipient reviewed the result or that the work satisfies the
  approved plan.
- Execute completion directly from `$PLUGIN_ROOT`. Its versioned cache path can
  disappear during a supported plugin upgrade before an already-loaded task
  emits the restart-needed final.
- Fall back to a mutable current package. A newer reporter cannot satisfy the
  immutable hashes bound by an older active route.

## Consequences and guardrails

The router exposes `plan` for durable planning, `direct` for director-owned
dispatch and acceptance, and `coordinate` for bounded delivery. The reusable
assignment/result brief keeps the role boundary small and consistent. Focused
contract tests cover exact approved-plan handoff, dispatch-and-return ordering,
forbidden director waiting/implementation loops, coordinator-first-turn
assignments, one complete result report, cache-independent staged execution,
harmless unregistered completion, and terminal route/runtime closure. Existing lifecycle, receipt,
disposition, integration, verification, archive, cleanup, and refresh
authority remain unchanged.

The supported automatic-reporting boundary is same-local-host only and is
opt-in through new registered assignments. Manual collection remains until the
native queue adapter is installed, trusted, and live-verified for the exact
sender-recipient mapping. Report transport never replaces terminal receipts,
callback admission, disposition, integration, verification, or director
acceptance.
