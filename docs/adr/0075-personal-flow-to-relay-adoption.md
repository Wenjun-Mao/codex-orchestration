# ADR 0075 — Personal Flow-to-Relay adoption by operator disposal

Status: accepted, 2026-09-12. Scope: the maintainer's own projects when adopting
Relay; not automatic migration or blanket cleanup of other repositories.

## Decision

The user approved operator disposal as the default after Plotloom's successful
reset. When adoption is requested, do not require old Flow lifecycle reconciliation,
successful acceptance, refresh, a new backup, or a move to an archive location.

The project director performs these minimum steps:

1. Confirm old source writers are stopped. Deleting a registry does not stop them.
2. Confirm a clean checkout and wanted work preserved on the approved baseline
   (normally `main`). Resolve dirty or unmerged wanted work first.
3. Resolve the Git common directory and verify its exact `codex-flow` target is a
   real directory, not a symlink. Delete only that directory. Preserve source,
   refs, worktrees, existing backups, `.git/relay`, and shared host registries.
   Do not create a new backup unless requested.
4. Verify target absence and unchanged HEAD, refs, worktree inventory and source
   status. Report operator disposal, never normal Flow success.
5. Prepare the next approved Relay assignment normally. Source availability alone
   is not admission proof; normal Relay preparation still enforces its guards.

No additional per-step confirmation is needed for this bounded default. Pause for
unclear ownership, active writers, unpreserved work, or broader deletion. Task
archival is separate housekeeping, not a requirement to repair Flow journals.
Never restart an old writer after disposal.

## Why and consequences

Plotloom's archived coordinator checkout was absent; abandonment and refresh
required unavailable historical authority. Reconstructing it only to discard its
records added cost without protecting product work. Direct namespace deletion
preserved clean `ae75e52`, refs and worktrees; Relay reported `SOURCE_AVAILABLE`.
A full subsequent Relay implementation was not part of that reset verification.

Rejected defaults: repairing obsolete history, importing it into Relay, mandatory
new backups, and broad deletion. Existing Plotloom backups remain available;
future deletion may be unrecoverable without a backup. This intentionally discards
orchestration history, not Git history.

This is user-authorized operator policy, not a new Flow command or a weakened
Relay guard. Installed plugin bytes remain unchanged.
