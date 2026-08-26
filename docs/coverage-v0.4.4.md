# Codex Flow v0.4.4 coverage

v0.4.4 closes two field-discovered coordinator ambiguities without adding a
new callback state or cleanup journal. It retains v0.4.3 active waiting and the
v0.4 ordinary callback authority.

## Covered

- `callback status` is discovery-only; branch authentication and independent
  review occur while the receipt remains persisted.
- Observation selects one exact receipt for integration or durable rejection
  and closes sequence supersession for that run.
- Corrections after observation require a fresh task operation and `run_id`,
  preserving the observed checkpoint.
- Cleanup apply still exits nonzero on failure but emits a structured result
  with the requested plan ID, completed actions, stopping action, and bounded
  nonempty reason.
- Thrown non-Error values, including `undefined`, cannot produce an undefined
  cleanup error message.
- Recovery remains audit-first: partial mutation invalidates the old plan and
  requires a fresh deterministic plan for what remains.

## Not claimed

- No review scheduler, callback reservation state, correction queue, cleanup
  event journal, daemon, or compatibility layer.
- No automatic retry or resume of a partially applied cleanup plan.
- No change to callback identity, journal schemas, Git cleanup plan identity,
  or mutation ordering.

## Verification boundary

Focused Git lifecycle tests inject an interruption after an observed worktree
removal, including an `undefined` thrown value, and prove structured partial
progress plus stale-plan rejection and fresh-plan recovery. The full package
suite and validators cover callback immutability and packaged guidance.
