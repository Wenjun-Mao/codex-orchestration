# ADR 0037: Explicit private task-ID resolution

## Status

Accepted for the v0.7.7 development checkpoint.

## Context

Codex App `26.831.20005` can accept a visible-task creation request, create the
task and worktree, and return only a provisional `clientThreadId`. The current
public task catalog may omit the new task, and no public operation resolves the
provisional ID to the ready task ID. A second create would violate Flow's
one-shot contract, while title, recency, worktree, and timing are not unique
identity evidence.

The local App state currently persists the exact provisional-to-ready binding
in two directions. The ready task's session also records its task ID, initial
selector context, and the exact `create_thread` delegation containing Flow's
canonical nonce-bearing bootstrap. The App delivers that bootstrap as a
delegation payload rather than the ordinary initial user-turn shape assumed by
the prior host guidance.

## Decision

v0.7.7 adds the explicitly invoked, read-only
`task create resolve-private` compatibility adapter. It is available only for
an already journaled provisional creation and only while that operation's
reconciliation window remains strictly open.

The adapter:

- reads, but never modifies, the current Codex home global-state and session
  files;
- requires the exact reverse mapping and canonical forward mapping to agree;
- requires one matching ready-task session, matching task ID, baseline,
  requested model and effort, coordinator source task, and first task turn;
- accepts only the exact `codex_app.create_thread` delegation wrapper whose
  embedded input equals the generated bootstrap byte for byte;
- emits a complete ready-reconciliation request and labels its bootstrap source
  `codex-app-private-delegation-v1`;
- persists only compact mapping/session digests and bounded host metadata, not
  private paths or private file contents; and
- records exact App version as unavailable when the inspected state does not
  provide it. The changelog release family and bundled CLI version remain
  separately labelled observations.

Ready reconciliation requires private binding and delegation evidence together,
binds both to the recorded provisional and recovered ready IDs, and keeps the
normal selector mismatch and later live Git worktree-binding gates. First
provisional or ready reconciliation at or after `reconcile_by` is rejected;
exact replay of an already accepted ready record remains idempotent.

This adapter is not a silent fallback. The coordinator must disclose its use.
Missing, changing, malformed, duplicated, or contradictory private evidence
fails closed and does not authorize another create. It cannot recover an
expired, abandoned, ambiguous, or otherwise terminal operation.

## Rejected alternatives

- Retry creation after a provisional response. That can create a duplicate task
  and breaks the one-shot operation.
- Correlate by title, recency, path, or timing. Those observations are not
  unique identity authority.
- Relabel the App delegation as a host-observed user turn. That would conceal a
  real host-contract change and produce false provenance.
- Parse private state implicitly inside ordinary reconciliation. That makes a
  brittle compatibility dependency invisible to users and audit records.
- Extend the reconciliation timeout. More time does not create a missing public
  correlation primitive.

## Consequences and exit condition

The adapter is intentionally host-private and may stop working after another
App update; such drift fails closed. Focused fixtures bind the current mapping
and session shapes, exact bootstrap, selector checks, provenance, and deadline.

Retire the adapter when Codex App exposes a public operation that resolves an
exact `clientThreadId` and returns authenticated bootstrap/task correlation.
That later checkpoint must preserve one-shot creation and migrate no historical
Flow state.
