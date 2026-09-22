# 0008 — Reporting-only Relay

Status: accepted; supersedes lifecycle enforcement in decisions 0001–0007.

## Problem
The worker-to-manager reporting relationship was embedded in a source lifecycle
controller. Managers already reviewed work, while contracts, baselines, immutable
records and recovery commands imposed additional setup and failure boundaries.
The existing hook already forwarded text independently of result verification,
but still had to load the controller to discover its recipient.

## Decision
Replace the controller with one atomic worker-to-manager routing registry in the
Git common directory. Keep the existing bounded native queue transport unchanged.
Register real task IDs, preserve registration identity on replay, and require the
expected manager to unregister. Stop finals are messages, not success evidence.
Models, scope, tests, Git ownership, acceptance and archival remain manager work,
not registry fields or runtime gates. No report bodies or delivery journals persist.

## Alternatives and consequences
A lite mode or retained optional verifier would preserve two contracts and their
maintenance burden. Automatic legacy conversion could strand active old workers.
Instead, reject old control state and transition explicitly at a quiet checkpoint.
Reporting does not prevent concurrent edits or guarantee delivery after a transport
error. Skills require serial coordination and truthful review; ambiguous sends are
not retried. The native client ID provides stable deduplication identity, not a new
local exactly-once protocol. In-flight sends may complete after route removal.

## Guardrails
Serial dispatch explicitly selects the retained checkout where authorized, rather
than inheriting a worktree default. Isolation needs a stated reason or user request.
Workers never delete their own task directory or branch; managers clean up after
final receipt and idle confirmation. A Codex Usage worker deleted its worktree
before its final, preventing all Stop hooks from launching. This is a workflow
ordering correction, not a new reporting gate.

Workers register at startup using their native ID and the manager ID in the brief.
Manager registration remains an idempotent fallback. In ADE, a worker ran to
completion while the manager's task-list lookups did not expose it; no route was
registered. Registration belongs on the side that already knows both IDs, not
behind provisional-ID discovery. No discovery poller, handshake, or runtime change
is needed. Missing/conflicting IDs are reported rather than guessed; already-ended
unregistered finals are read natively, never replayed through a synthetic Stop.

Test routing replay/conflicts, locks/atomicity, malformed and legacy state, shared
worktrees, unchanged source, exact forwarding and native response validation.
Package only routing dependencies. Keep historical decisions outside the runtime.
