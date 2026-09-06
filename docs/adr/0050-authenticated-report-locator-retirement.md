# ADR 0050: Authenticated report-locator retirement

- Status: accepted for the v0.9.5 reporting correction
- Date: 2026-09-06
- Refines: ADR 0049 durable planning and director dispatch

## Context

ADR 0049 makes route lifetime follow assignment and run lifetime, but the
repository sender locator was only installed. Closing a route left its locator
in shared Git state. A long-lived coordinator that completed an authenticated
refresh could therefore retain a pointer to a removed source namespace, while
the next route registration attempted recipient and route writes before
discovering the conflict. Missing source state alone could not prove that the
old report path had no pending or ambiguous delivery.

## Decision

Treat the repository sender locator as lifecycle authority. Registration and
retirement share one sender-scoped process lock. Registration preflights the
slot before launch, recipient, or route persistence. An existing locator is
acceptable only when it authenticates this installed reporter and native queue,
resolves to its exact active route in the current namespace, and can therefore
be resumed idempotently. A locator for another namespace fails before those
writes.

Normal retirement requires the exact closed route and report cleanup status.
Accepted reports are retained in the retirement record; pending, ambiguous,
conflicting, rejected, or manual-required records block removal. The adapter
persists a content-addressed retirement record before removing the active
locator. A crash after either boundary resumes from that record without
changing its identity or timestamp. Task disposition, explicit route closure,
run closure or abandonment, and refresh source retirement invoke this adapter
boundary after governance-core route closure.

One bounded compatibility recovery may retire the known v0.9.3 orphan only
after authenticating the full consumed refresh handoff, its retained source
tree digest, the exact active route bytes and locator digest, and an explicit
recovery disposition. The missing namespace is never sufficient authority.
This exception does not scan or migrate arbitrary predecessor state.

## Rejected alternatives

- Overwrite or delete a conflicting locator during registration. This loses
  delivery state and makes stale authority indistinguishable from a safe
  terminal transition.
- Infer retirement from a missing namespace. Refresh deletion proves only that
  namespace cleanup occurred; it does not prove report disposition.
- Keep the locator and teach each later caller to ignore it. That creates
  caller-specific divergence and leaves completion hooks pinned to dead state.
- Put host adapter state into governance core. Route and report records remain
  core authority; repository locator installation and retirement belong to the
  Codex App adapter layer.

## Consequences and guardrails

Same-sender re-registration is explicit and crash-safe. Concurrent registration
and retirement serialize through one slot. Retirement records remain outside a
versioned run namespace so refresh can remove that namespace only after the
pointer transition is durable. Focused tests cover successful and replayed
retirement, crash boundaries, stale namespace conflict, pending/ambiguous
blocking evidence, and refresh behavior. Live acceptance must still prove
actual incoming final text and identity; queue acceptance alone is insufficient.
