# Codex Flow v0.5.1 coverage

v0.5.1 keeps the v0.5 plugin-first setup model and closes two host-lifecycle
gaps found by the first same-project UK Dev pilot.

## Covered

- Task creation persists exact same-project, cross-project, projectless, or
  inherited placement intent before the host call.
- Host preflight proves that the requested placement can be expressed.
- Reconciliation distinguishes host-observed placement from a target merely
  accepted by the creation call.
- Exact host-accepted placement is allowed with partial evidence when list/read
  omit the selected project; an observed or accepted mismatch fails closed.
- Projectless and inherited operations cannot acquire a saved-project target.
- An observed, unbound task may be recorded as rejected before release only
  after archival and, for host-created worktrees, verified path removal.
- Rejected operations remain auditable but no longer appear as unresolved
  unbound worktrees. Unresolved observed operations still warn.
- Schema changes are breaking; no compatibility reader or migration is added.

## Not claimed

- Host-accepted placement is not independent observation.
- Codex Flow does not repair or infer a saved-project assignment.
- No daemon, MCP server, background service, or private host adapter is added.
- A pre-v0.5.1 task journal is not upgraded in place.

## Verification boundary

Source acceptance requires focused placement and rejection regressions, the
complete dependency-free Node suite, source validation, package dry run, and
diff checks. Release acceptance additionally requires a fresh UK Dev
same-project Terra/xhigh host-worktree pilot proving exact placement intent,
partial or complete evidence, Git bind/release, ordinary callback integration,
deterministic cleanup, and task archival.
