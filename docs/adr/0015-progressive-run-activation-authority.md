# ADR 0015: Progressive run activation authority

## Status

Accepted for v0.6.

## Context

Through v0.5.1 the router requires a tracked `.codex/orchestration/` runtime
before delegation. That protects package authority, but it makes a first
orchestration request begin with repository adoption even when the user only
wants one bounded run. It also makes tracked setup appear to be the execution
engine, although the durable operational state already belongs to the Git
common directory.

Codex App supplies native task, model, worktree, message, wait, Handoff, and
archive primitives. Codex Orchestration still needs one exact runtime and one
repository-wide authority for cross-task identity, callbacks, branch claims,
leases, integration, and cleanup. A silent fallback, a second daemon, or
implicit reuse of retained v0.5 state would create competing authorities.

## Decision

v0.6 uses progressive activation backed by one execution engine.

- Questions and explanations remain read-only.
- An explicit actionable orchestration request may automatically activate one
  run after disclosing the exact runtime, Git-common operational state, plan,
  task/model routing, and separate external-action approvals.
- Run-scoped activation writes no tracked setup. It snapshots the exact runtime
  under `.git/codex-flow/v0.6.0/runtimes/<bundle-sha256>/` and binds the run to
  its runtime/configuration digests, repository instance and common directory,
  host, coordinator lineage/generation, and immutable plan revision.
- Every operational command names an explicit run ID. No command infers the
  newest run.
- Exactly one coordinator run may be active per clone/common directory. The
  active pointer and path, resource, branch, operation, callback, urgent,
  recipient, lease, archive, and cleanup ledgers are repository-wide within
  the exact-version namespace.
- A normal close requires terminal reconciled state. Explicit abandonment
  releases the active slot but retains every unresolved fence. A later plan is
  admitted only when disjoint from those fences.
- Active and closed runtime evidence survives restart, compaction, plugin
  upgrade, and plugin removal. v0.6 performs no runtime pruning.
- Permanent tracked adoption remains an explicit plan/apply choice for team
  policy, portable clones, and headless use. It stores the same exact runtime,
  configuration/policy, and reviewed AGENTS instructions; it does not introduce
  a second engine.
- A tracked v0.5 authority must be explicitly retired before v0.6 adoption or
  self-host activation can govern the repository. Its files, exact-version
  state, tag, cache, and audit evidence remain byte-preserved and are never
  imported as v0.6 operational state.

Live v0.6 runs are limited to one host, one clone, and one Git common directory.
Cross-host journal transfer is not part of this decision.

## Rejected alternatives

- Keep tracked setup as the mandatory entry gate. It preserves onboarding
  friction without adding cross-task safety.
- Use an ephemeral plugin cache directly. It cannot survive plugin removal or
  prove which runtime authorized an executor.
- Add a daemon or secretary task. It duplicates native lifecycle and introduces
  another availability and identity authority.
- Read or migrate v0.5 state. Breaking-version isolation is safer and leaves
  accepted evidence independently auditable.

## Consequences and guardrails

- Router behavior becomes intent-sensitive: explanation is read-only;
  actionable orchestration activates with disclosure.
- Run-scoped and adopted modes must pass the same contract tests.
- Conflicting tracked authority, runtime/configuration drift, wrong host,
  wrong clone/common directory, or a second active run fails closed.
- Closed evidence and abandoned fences are retained until a later explicitly
  designed pruning release.

