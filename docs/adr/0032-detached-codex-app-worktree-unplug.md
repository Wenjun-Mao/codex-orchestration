# ADR 0032: Detached Codex App worktrees in unplug

## Status

Accepted for v0.7.2.

## Context

Codex App task worktrees commonly remain registered after archival but are
detached at their exact task commit. Requiring every `unplug` worktree resource
to name a local `codex/*` branch incorrectly rejects that normal host state,
even though path, Git common directory, HEAD, cleanliness, and registration
remain independently verifiable.

## Decision

An `unplug` worktree resource may set `branch: null` only when the currently
registered same-common-directory worktree is detached. It remains bound to its
exact path and expected HEAD, and that HEAD must already be an ancestor of the
authenticated repository base so removing the worktree cannot discard the
only durable reference to unintegrated work. It must still pass every existing
protection, cleanliness, lock, prunable, and registration check. If attached,
its branch must exactly be the planned local `codex/*` branch. Branch removal
remains a separate exact branch resource with its own ancestry, remote-ref,
and attachment checks. Apply refreshes and re-authenticates the controller
checkout immediately before every local worktree or branch removal.

## Consequences

Clean archived Codex App task worktrees can be unplugged without weakening
local Git authority. A plan cannot use a null branch to mask an attached,
different, unregistered, or unintegrated worktree.
