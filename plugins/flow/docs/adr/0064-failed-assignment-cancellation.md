# ADR 0064: Failed assignment cancellation is terminal without cleanup authority

Status: Accepted

## Context

An abandoned execution run leaves its assignment-owned report route, locator,
and iteration in shared state. Successful acceptance cannot describe a failed
canary, while a manual route close leaves an open assignment that blocks or
corrupts later assignment routing.

## Decision

Add a director-only `assignment cancel` transition. It authenticates every
execution binding recorded by the exact assignment, requires each run to be
closed or abandoned, and requires all disposable executor members to already
be archived. It then closes and retires the exact report route and locator,
records cancellation attribution plus terminal execution evidence, and marks
the iteration `cancelled`.

Cancellation neither accepts a result nor archives a coordinator, removes a
worktree, deletes a branch, or rewrites an execution receipt. A cancelled
iteration rejects owning-host closeout. Replays require the same director and
reason and complete only remaining reporting or iteration bookkeeping.

## Consequences

The same coordinator can receive a new assignment after a failed run is
retired by the existing refresh path, without an active route or open
assignment colliding with the new one. Its prior delivery branch and worktree
remain explicitly retained. A normal successful assignment continues to use
acceptance and closeout; cancellation is not an alternate success path.
