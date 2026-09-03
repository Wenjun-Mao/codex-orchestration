# ADR 0040: Long-lived coordinator refresh

## Status

Accepted for the v0.8.0 development checkpoint.

## Context

An activated Flow run is intentionally bound to an immutable runtime snapshot.
That protects executor contracts and callback identity across App restarts,
plugin upgrades, and coordinator compaction. It also meant a long-lived
coordinator task could see a newly installed skill only by treating any active
source run as incompatible, even when it could safely retain integrated work
and reissue only unfinished assignments.

Changing an active run to a newly loaded package would make source task,
release, callback, and cleanup semantics unclear. Broad predecessor readers or
journal migration would recreate the compatibility surface deliberately removed
at the v0.7 clean-authority cutover.

## Decision

v0.8 adds one coordinator-owned, repository-local refresh handoff. The App
reloads installed skills; Flow neither reloads itself nor treats catalog
metadata as an active-run upgrade. On the next actionable invocation,
`refresh inspect` authenticates the invoking skill against its package and
returns exactly one route: `fresh`, `resume-source`, `refresh-ready`, or
`blocked`.

An active source run always continues under its own immutable snapshot. When
it is refresh-ready, the same coordinator may choose for each visible executor
task:

- **Wait**, then disposition and integrate its result under the source runtime.
- **Discard**, recording a rationale and archiving the exact unintegrated task
  before removing only its authenticated local worktree and local branch. The
  caller cannot assert archival with booleans: refresh binds the existing
  private App archived-session observation to the exact handoff, archive intent,
  task, and host, then re-observes that session before deletion.

Before deletion, `refresh prepare` stores exactly one content-addressed
`.git/codex-flow/refresh-v1/` handoff. It contains source and target runtime
identity, coordinator and baseline bindings, source task/contract/cleanup
evidence, and semantic replacement briefs. Briefs preserve outcome, ownership,
resources, instrument role, and dependency topology; they exclude old run,
operation, Git, selector, and runtime identities.

The handoff is stateful only as `prepared`, `archive-observed`,
`source-retired`, and `consumed`. Every transition reauthenticates it under the
repository-wide lock. Worktree removal precedes local branch deletion; source
retirement precedes target activation; source namespace and handoff removal are
last. A replacement activation consumes the handoff atomically, creates a fresh
lineage at generation 1, and records only minimal source/replacement digests.
When every source executor was waited and no work requires replacement, apply
instead records a `clean-start` consumption with no target run before removing
the same residue. Old callbacks remain fenced to the old run and generation.

Every replacement is a fresh executor task contract with a deliberately chosen
model, reasoning effort, selector rationale, operation, branch, worktree, and
runtime. No selector or Git identity is inherited. Integrated work remains in
the repository baseline; only discarded assignments and dependencies not
embodied in that baseline are reissued.

v0.8 and later snapshots expose a stable refresh-source export. A target first
authenticates only the source run's content-addressed runtime locator and bundle,
then invokes that source snapshot to parse its own journals and emit the stable
semantic transfer. This prevents a newer target parser from becoming accidental
authority over older source records. v0.8.0 also provides one target-side
adapter for exact v0.7.8 snapshot authority. That bridge may locate and
orchestrate the legacy projection, but raw v0.7.8 JSON is read and validated
only by modules dynamically loaded from the byte-authenticated v0.7.8 runtime
bundle. The sole nonliteral module load is isolated to that exact bridge and is
enforced by source validation. The adapter does not migrate journals or
interpret arbitrary predecessor versions. Unsupported, malformed, or
ambiguous predecessor state remains blocked and uses the existing explicit
`unplug` lifecycle.

## Rejected alternatives

- Hot-switch the source run to the loaded plugin. This loses immutable contract
  authority for already-created executor tasks.
- Start a background coordinator registry or daemon. A one-time handoff is the
  smallest mechanism for an explicit user action and remains crash-resumable.
- Require every unintegrated executor to be labelled disposable up front. The
  integration record is the real boundary: before it, the coordinator may make
  the wait/discard choice; after it, discard authority ends.
- Migrate or tolerate all predecessor journals. That expands a narrow v0.7.8
  bridge into an unbounded compatibility framework.
- Reissue all source tasks. That duplicates work already integrated into the
  post-integration baseline.

## Consequences and guardrails

- Installing a release does not interrupt active tasks; an App reload is needed
  before the coordinator can invoke the refreshed skill.
- Refresh occurs once at the next actionable coordination request, not as a
  recurring preflight.
- Native subagents must finish or be disposed by their existing read-only
  lifecycle; they never enter worktree discard.
- Waited executors must finish ordinary archive and local Git cleanup before
  cutover. Before whole-namespace removal, every non-selected run must be
  independently closed and cleanup-complete; abandoned or retained run residue
  blocks refresh.
- Remote refs and external side effects are never removed or reversed.
- Provisional identity, archive disagreement, path/attachment drift, protected
  or remote refs, prior integration, stale callbacks, and tampered snapshots
  fail closed.
- This supersedes ADR 0029's exact-version clean-start behavior only for the
  bounded same-coordinator exact-v0.7.8-to-v0.8 adapter and successive v0.8+
  source-export refreshes. Ordinary activation and all other predecessor state
  remain subject to the clean-start and `unplug` boundaries.
