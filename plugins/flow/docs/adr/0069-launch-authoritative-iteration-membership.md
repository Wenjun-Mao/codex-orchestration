# ADR 0069: Derive executor membership from launch authority

Status: Accepted for the September 10 v0.9.11 source amendment

Date: 2026-09-10

Refines: ADR 0061, ADR 0063, ADR 0068

## Context

Executor iteration members were keyed by a digest of a returned task-launch
view. That view includes lifecycle observations and presentation fields, so one
launch could acquire another logical member identity as it progressed. Creation
replay also compared timestamp-bearing selector and creation evidence byte for
byte. In the observed provisional-result-first ordering, authenticated start
completed but the iteration retained a provisional identity and cleanup rejected
that cache before consulting the persisted launch.

## Decision

The persisted task launch is authoritative for live executor identity and Git
activation. The iteration retains a stable reference to that launch plus its own
durable cleanup state.

New executor member IDs are derived from the member role and canonical launch
reference (`state_root` plus `launch_id`); host observations, timestamps, returned
views, and lifecycle progress are excluded. Publication and consuming operations
share one resolver that rereads exact assigned launches, validates their run,
runtime, configuration, plan, revision, coordinator, title, and namespace
bindings, and merges the cached member projection monotonically. It publishes
after supported start and creation reconciliation and converges before cleanup or
cancellation. Read-only status reports absent, stale, current, or duplicate
projection state without writing.

Refresh reconciles launch obligations before host/Git cleanup. After its existing
typed archive observation and exact worktree/branch retirement complete, it
transfers that result into the matching iteration member's archive attempt before
source retirement or deletion. This preserves a lawful cancellation path after
the launch and disposition files retire; it cannot replace an in-progress archive
attempt or retire a member without exact task, thread, host, worktree, and branch
agreement. Opaque creation evidence whose host is deliberately `unknown` uses the
authenticated source-run host for refresh cleanup; a known creation host remains
exact and conflicting known hosts still fail.

Authenticated start identity supersedes provisional or opaque creation identity.
Known host conflicts fail; an `unknown` observation cannot erase an existing
owning host. Member registration time, existing member ID and digest provenance,
accepted archive attempts, and cleanup progress are preserved. Multiple legacy
members for one stable launch reference block rather than being merged or ranked.

Equivalent creation replay compares semantic result and selector facts while
preserving the first populated observations and timestamps. A different ready,
provisional, opaque, selector, or known-host fact remains a conflict. A later
ready result is not treated as an equivalent rewrite of original provisional
provenance.

Completed activation may authenticate an exact same-executor, same-nonce,
same-worktree start replay after the launch deadline or legitimate branch
advance. That continuation does not rerun activation or grant a fresh launch
window. Initial activation retains its deadline, nonce, identity, repository,
and pristine-baseline checks.

## What this replaces

- Mutable full-view membership digests are replaced by a stable launch reference.
- Cleanup-specific provisional rejection is replaced by shared authoritative
  resolution before eligibility is decided.
- Timestamp-sensitive same-result replay is replaced by semantic idempotence.
- Start replay as the sole repair path is replaced by consumer-side convergence.

## Rejected alternatives

- A coordinator ready-confirmation command would duplicate identity authority.
- Rekeying existing members would destroy historical IDs and cleanup progress.
- Selecting the newest duplicate would guess across conflicting authority.
- A registry migration or generic synchronization engine would exceed the local
  launch-to-iteration defect.

## Consequences and guardrails

The reader accepts the prior member format only as preserved provenance. Runtime
resolution must authenticate a unique exact launch reference before advancing
that projection; it never compares a historical view digest with the current
launch view or rewrites the historical ID. Completed cleanup remains usable after
legal launch retirement because its exact member and archive evidence persist.

Connected public-command coverage must include provisional-first start,
timestamp-stable replay, one logical member, and no repeated activation. Focused
coverage must include missing first publication after completed work, duplicate
legacy references, late start replay after Git advance, stale projections, and
conflicting identities or selectors. Refresh coverage must prove that a recovered
launch obligation becomes durably archived before source deletion and remains
lawfully cancellable afterwards. Archival continues to require the existing
result, verification, preservation, host-observation, and Git checks.
