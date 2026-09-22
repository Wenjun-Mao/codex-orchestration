# ADR 0029: v0.7.0 clean authority cutover

## Status

Accepted for v0.7.0.

This supersedes the live adoption and predecessor-transition mechanisms in
ADRs 0020, 0022, and 0025. Those records remain historical evidence for the
versions they governed.

## Context

v0.6.5 proved the current task-thread, callback, integration, verification,
archive, and cleanup contracts. It still carried isolated predecessor readers,
retirement commands, tracked-adoption code, schemas, skills, tests, and package
documentation. Keeping those paths in the next breaking release would preserve
dual conceptual authority, enlarge the active package, and make an old
repository transition a permanent responsibility of the new runtime.

The approved consumers were retired before this cutover, no executor work was
running, and immutable tags and Git history already preserve the old code.
v0.7 therefore does not need an operational bridge. It does need to prevent a
new run from silently starting beside a still-active run owned by another
version namespace.

## Decision

- v0.7 uses only `codex-flow-v07-*` persisted identities and the exact
  `.git/codex-flow/v0.7.0/` state namespace.
- The active package contains no predecessor reader, verifier, mutator,
  migration, retirement, tracked-adoption, setup-skill, or plugin-managed
  instruction path. It never reads or writes `AGENTS.md`.
- Predecessor code, schemas, tests, examples, and field evidence remain
  accessible through immutable source tags and Git history, not through the
  v0.7 artifact.
- Admission uses one bounded foreign-active-run sentinel. It examines only
  sibling namespace `runs/lifecycle.json` files, accepts a null
  `active_run_id`, and blocks a non-null active run. Symlinks, malformed or
  oversized lifecycle files, and more than the bounded namespace limit fail
  closed.
- The shared sentinel lock makes v0.7 admissions internally serial. It cannot
  make predecessor binaries participate retroactively, so a cross-version race
  remains fail-closed operationally: finish or abandon the predecessor run
  before v0.7 activation.
- Deleting retained local predecessor journals is not a v0.7 command. It is a
  separate exact, user-approved post-acceptance action.

## Rejected alternatives

- Retain read-only predecessor verification and retirement. Immutable tags
  already provide exact old authority; packaging the bridge keeps the old
  protocol live.
- Retain tracked adoption without legacy support. Git-common runtime snapshots
  already survive task restart and plugin upgrade, while adoption reintroduces
  tracked setup and policy duplication.
- Silently ignore sibling namespaces. That could admit overlapping coordinators
  against one Git common directory.
- Parse or migrate complete predecessor journals. The causal question is only
  whether another version owns an active run; broader interpretation would
  create a migration system.
- Delete old journals automatically during activation. Destruction is neither
  required for v0.7 correctness nor authorized by a new run.

## Consequences and guardrails

- v0.7 is intentionally incompatible with predecessor operational commands and
  state records.
- A repository can use the plugin without tracked setup, adoption, or
  `AGENTS.md` changes.
- Tests and source validation enforce the current-only schema, example, skill,
  CLI, and package inventory, plus bounded foreign-run collision behavior.
- Release artifacts include current documentation and ADRs but exclude
  predecessor coverage and field-test directories.
- Historical recovery uses the exact immutable tag that created the old state;
  v0.7 neither weakens nor impersonates that authority.
