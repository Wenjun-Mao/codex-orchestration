# v0.3 orchestration coverage

This extends the v0.2 orchestration scorecard with installation compatibility
learned from the first UK Dev repository pilot.

## Covered

- All v0.2 task-kind, DAG, ownership, deadline, recipient-fencing, callback,
  operation-journal, lease, and audit-only cleanup contracts remain covered.
- Fresh initialization requires a deterministic read-only plan.
- Plans aggregate exact content changes, before/after hashes and line counts,
  activation roots, structured conflicts, and repository/package identity.
- Plan application recomputes and rejects stale IDs before mutation.
- Configuration, runtime, and AGENTS integration activate transactionally.
- Managed AGENTS blocks preserve unrelated repository instructions.
- External AGENTS ownership requires explicit, hash-bound human attestation.
- Doctor and sync checks reject external instruction drift.
- Managed repositories can transition to external ownership while removing only
  the package-managed block.
- Routine sync refuses legacy project configuration until it is migrated by an
  explicit v0.3 plan and matching apply.
- Git read-only probes disable optional locking to avoid index refresh writes.

## Partial

- Plans expose repository-policy inputs but do not execute arbitrary repository
  validators. A repository may inspect plan JSON before approving application.
- External equivalence is a human authority decision. Codex-flow validates the
  attestation identity and drift, not the semantic quality of arbitrary prose.
- `sync` validates the configured instruction mode but does not yet require a
  separate plan ID for routine package-runtime upgrades.
- Task send/archive/list operations still follow documented policy without
  dedicated portable operation record types.
- Revision staleness still uses explicit supersession rather than arbitrary
  remote-host ancestry queries.

## Host-dependent or unverified

- Role, skill, and file retention through compaction, resume, and fork.
- Host send/archive timeout reconciliation and sidebar visibility.
- The full UK Dev task creation and callback loop after v0.3 installation; the
  initial v0.2 pilot stopped correctly at the prewrite compatibility conflict.

## Intentionally excluded

- Automatic semantic approval of repository instructions.
- Arbitrary preinstall shell hooks.
- Daemon, MCP server, background secretary, cross-repository database, automatic
  thread deletion, worktree removal, or cleanup mutation.
