# ADR 0028: Archive cleanliness excludes ignored generated output

## Status

Accepted in v0.6.5.

## Context

Archive preparation must keep worktrees visible when they contain source work
that could be lost. The v0.6.4 implementation requested Git's ignored-file
inventory as well as tracked and ordinary untracked changes. Normal executor
verification therefore made clean, integrated worktrees unarchivable whenever
it left ignored output such as dependency directories, build products, or test
caches. This differed from the shared Git snapshot used by release,
verification, integration, and run audit.

## Decision

Archive preparation uses complete ordinary untracked-file reporting but does
not request ignored files. Tracked changes and non-ignored untracked files
remain blocking source risk. Git-ignored output is treated as disposable build
state and may remain present while archive preparation records the worktree as
clean.

This decision is specific to archive admission. It does not weaken package
release-identity checks, alter task-result evidence, authorize forced worktree
removal, or change any future cleanup-deletion contract. Historical runtime
snapshots and journals remain immutable and independently auditable.

## Rejected alternatives

- Require executors to remove every ignored artifact before archive. That makes
  ordinary verification output an unrelated lifecycle blocker.
- Treat all untracked files as disposable. Non-ignored files can contain
  valuable source work and must keep the task visible.
- Add artifact inventories or cleanup callbacks. Git's ignore contract already
  supplies the required distinction without another evidence system.

## Consequences and guardrails

- Tested host worktrees can reach archive preparation without manual removal.
- Non-ignored untracked or tracked drift still fails closed.
- A focused regression leaves an ignored artifact present during preparation,
  while the existing untracked-drift regression remains authoritative.
