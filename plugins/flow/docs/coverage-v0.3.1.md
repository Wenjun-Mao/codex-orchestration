# v0.3.1 orchestration coverage

This extends the v0.3 scorecard with lessons from the first complete UK Dev
installation, task creation, callback, and cleanup pilot.

## Covered

- All v0.3 installation planning, external-instruction attestation, task-kind,
  DAG, deadline, recipient, callback, lease, and audit contracts remain covered.
- Local and linked-worktree task packets require an absolute Git worktree root.
- Preparation authenticates exact full `HEAD`, cleanliness, worktree-root
  identity, and shared Git common-directory ownership before journaling.
- Attempt creation repeats baseline authentication and records no attempt on
  revision or cleanliness drift.
- Legacy v0.3 operation records remain readable and require authenticated
  re-preparation before launch.
- Branch-first installation is the documented workflow because plan IDs bind
  branch, revision, and cleanliness.
- Host adapters have a bounded recent-list fallback when advertised filtering
  is rejected at runtime.
- Requested model/reasoning and archive-setter results are distinguished from
  independently observable host facts.

## Partial

- `dirty-authorized` authenticates the exact revision and dirty state, not a
  digest of every uncommitted byte.
- Task send/archive/list operations still follow documented policy without
  dedicated portable operation record types.
- Revision supersession remains explicit; codex-flow does not query arbitrary
  remote-host ancestry.
- Installation plans do not invoke arbitrary repository policy validators.

## Host-dependent or unverified

- Host list/read responses may not expose selected model or reasoning effort.
- Some hosts advertise filtered thread listing but reject the filter; bounded
  unfiltered inspection is the tested fallback.
- Archived-list visibility is unverified when only an archive setter exists.
- Role, skill, and file retention through compaction, resume, and fork.
- Urgent Steer, recipient rebind after a real fork, ambiguous host timeout
  recovery, and cleanup mutation remain outside the completed UK Dev pilot.

## Intentionally excluded

- Daemon, MCP server, background secretary, cross-repository database,
  automatic thread deletion, worktree removal, or cleanup mutation.
- Automatic semantic approval of repository instructions.
- Automatic host retry after an ambiguous create operation.
