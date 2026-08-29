# ADR 0019: Read-only cleanup planning and terminal fence release

## Status

Accepted for v0.6.

## Context

Archive reconciliation proves the native task lifecycle and, for a managed
worktree, whether the originally observed worktree path is absent. It does not
prove that an executor branch, another worktree attachment, or an expected
upstream is safe to remove. Earlier closure logic could also clear the admitted
branch envelope without reloading live Git state. That would make a passing
lifecycle journal stronger than the repository it describes.

v0.5 contains a separate cleanup-apply mechanism. Carrying that mutating path
into v0.6 while its identity and reservation model is being redesigned would
create dual cleanup authority and make the breaking boundary harder to audit.

## Decision

- A visible `host-worktree` task may be created only when its exact executor
  branch is already present in the active run's admitted branch envelope. One
  admitted executor branch may be claimed by only one task-creation contract
  across retained v0.6 state. Activation preflights retained claims before
  acquiring runtime/workflow state, while exact same-run replay remains valid.
- v0.6 exposes `cleanup plan --run-id ...` as a deterministic, read-only
  operation. The plan binds the exact run/runtime/repository identity,
  lifecycle records, terminal Git receipt, local branch ref, configured and
  expected upstream, and every current worktree attachment. The public command
  derives that view twice and refuses output when the journal or Git inventory
  changes between derivations.
- The plan reports candidates and blockers but performs no mutation. A live or
  mismatched ref, attached or still-present original worktree, incomplete proof
  chain, unsafe terminal disposition, unresolved upstream, or unbound live
  branch fence fails closed.
- A normal run close derives cleanup evidence again as part of its current
  content-addressed audit. It cannot rely on a previously generated plan after
  Git or journal state changes.
- Eligible executor branches must already be absent before normal close. A
  completed rejected, retained-blocked, or cancelled visible task remains a
  closure blocker because it still needs explicit user attention or a later
  cleanup decision.
- Explicit abandonment preserves the complete admitted path/resource/branch
  envelope. It does not release individual reservations or authorize deletion.
- The v0.6 cleanup lifecycle has no apply API and never deletes a branch,
  worktree, remote ref, or retained v0.5 state. Separate tracked-v0.6 adoption
  retirement remains an explicit reviewed plan/apply operation.

## Rejected alternatives

- Treat archive completion as Git cleanup proof. Native archive and repository
  ref/worktree state are different authorities.
- Clear branch fences when lifecycle records become terminal. Terminal task
  state does not prove the corresponding Git objects are absent or safe.
- Import the v0.5 cleanup apply path. Its inputs and state belong to the
  accepted v0.5 namespace and would bypass v0.6 run/workflow identity.
- Add automatic deletion to the first v0.6 checkpoint. Read-only planning and
  closure guards establish the causal safety boundary without an irreversible
  operation.

## Consequences and guardrails

- Cleanup application, if later admitted, requires a separate decision and
  exact-state plan/apply contract with drift handling and protected-ref rules.
- The current planner may conservatively keep a completed run active until the
  user or native host resolves eligible Git state outside this v0.6 workflow.
- Cleanup plans are evidence views, not durable mutation tokens. Re-run the
  plan after any lifecycle or Git change.
- Executor branch names are lifetime-unique while their v0.6 claim records are
  retained. A later run must choose a fresh branch rather than reusing closed
  provenance.
- Tests prove deterministic output, zero state/ref/worktree mutation, unique
  branch claims, live-state blockers, and closure staleness.
