# Codex Flow v0.4 coverage

## Covered

- Journal-monitor-only ordinary completion with strict receipts, recipient
  rebinding, deterministic IDs, supersession, expiry, and exactly-once consume.
- Explicit rejection of pre-v0.4 project, task-operation, and callback state.
- Fresh `.git/codex-flow/v0.4/` operational state that leaves retained older
  evidence untouched and unread.
- Local executor ownership bound to an observed operation and exact canonical
  worktree in the same Git common directory.
- Host-created worktree launch split into source-branch authentication,
  bootstrap-only creation, host-observed path reconciliation, pristine Git
  binding, and full-packet release.
- Rejection of guessed, replayed, source-checkout, unrelated-repository,
  detached, dirty, or revision-drifted host worktrees before task release.
- Integration classification as ancestor, patch-equivalent, superseded, or
  unmerged.
- Read-only classification of active/protected, dirty, unmerged, merged,
  patch-equivalent, superseded, missing, orphaned, local/remote drift, and
  linked-worktree state.
- Deterministic cleanup plan/apply with pushed-main proof, exact local/remote
  tips, pinned remote identity, protected branches, active-lease exclusion,
  ignored/untracked-aware worktree proof, and drift invalidation.
- Preservation-first mutation ordering and mandatory fresh planning after any
  interrupted apply.
- Remote-only branch cleanup eligibility through explicit networked audit;
  task-wave warning/block thresholds remain local and network-free.
- Canonicalization of packet-owned symlink aliases before worktree ownership.
- Protected local branches and protected upstream refs are never cleanup candidates.
- Existing host preflight, title normalization, baseline authentication,
  instruction attestation, leases, and external-AGENTS behavior.

## Not claimed

- No automatic task-thread archive or deletion.
- No deletion of whole repositories, product projects, generated evidence,
  ignored authority, or user files.
- No migration or automatic deletion of v0.3 operational state.
- No daemon, MCP server, GitHub API client, or experimental host queue adapter.
- No accepted held-out end-to-end host-worktree lifecycle yet. The first UK Dev
  pilot proved installation and fail-closed local gates, then exposed the
  pre-dispatch-path contract that ADR 0008 replaces.

## Held-out gate

Before making v0.4 the default in the consultant repository, restart the UK Dev
pilot from fresh v0.4 state. Exercise one real Terra/xhigh `host-worktree`
executor through bootstrap, observed-path binding, packet release, callback
consume, serial integration, Git integration record, read-only audit, and exact
cleanup plan/apply. Preserve existing v0.3 state as inert evidence; do not
attempt a mixed-version migration.
