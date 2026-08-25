# ADR 0007: Git lifecycle and breaking operational state

## Status

Accepted for v0.4.

## Context

Repository callbacks and leases could be healthy while completed Codex
worktrees and local/remote task branches accumulated indefinitely. A branch
name or task age cannot prove that deletion is safe. The same package also
carried readers and migrations for several pre-release record schemas plus an
unused experimental queue adapter, increasing code and leaving two ordinary
completion models in one runtime.

## Decision

v0.4 has one ordinary-completion authority: the repository journal monitor. It
does not enqueue host turns and contains no queue adapter. Project configuration
is schema 4, task packets are schema 4, task-operation records are schema 5,
Git branch-claim records are schema 1, and callback records are schema 4. Older
operational state is rejected rather than migrated. A user may
preserve old files as evidence, but a v0.4 runtime starts in the independent
`.git/codex-flow/v0.4/` namespace and never reads or deletes older records.
Replacing an older pinned runtime requires a dedicated branch and explicit
retirement of its tracked `.codex/orchestration/` tree before fresh v0.4
planning and installation.
While this package remains private and pre-stable, this replacement policy is
the default for future contract changes. Backward compatibility requires a new
explicit product decision; it is not added defensively.

Every local executor may bind one immutable ownership record to an observed
task operation, exact canonical worktree, named branch, initial revision, and
the task ref plus a hash of its intended remote destination when the controller
repository has an upstream.
After serial integration, the coordinator records the latest exact executor
tip, integrating main revision, upstream ref, and one disposition:

- `ancestor`
- `patch-equivalent`
- `superseded`
- `unmerged`

The read-only audit joins this source-owned record with task-operation state,
active leases, worktree inventory, local refs, and direct remote-ref tips. It
never infers ownership from a branch-name pattern.

Mutation requires a deterministic plan made from clean, pushed main and an
explicit operation-ID list. Apply recomputes the plan before starting, rejects
drift, and performs only its clean worktree removal, local-ref deletion, and
remote-ref deletion, in that order. Worktree cleanliness includes ignored and
normally hidden untracked files. Remote identity is pinned at ownership time.
Remote mutation supports only one fetch URL and one identical push URL; split
or fan-out destinations are rejected.
An interrupted apply is never resumed from stale state: the coordinator audits
again and creates a new plan for remaining resources. Both local branch and
upstream ref are checked against the protected-branch set. The local CLI is not
an authentication boundary and cannot prove the caller's Codex role; process
policy assigns cleanup commands only to the coordinator, never an executor.

Task preparation checks configurable warning and block thresholds using cheap
local evidence. Crossing the block threshold stops a new wave until the
coordinator reconciles its local backlog. Exact remote cleanup remains an
explicit networked audit/plan operation.

## Rejected alternatives

- Infer completed work from `codex/*` names. Names do not prove ownership,
  integration, cleanliness, or retained value.
- Automatically delete on callback consumption. Consumption precedes combined
  reproof and does not prove Git integration.
- Keep legacy state readers indefinitely. This is a private pre-release tool;
  explicit reset is cheaper and safer than permanent compatibility branches.
- Add a daemon, provider API, or GitHub SDK. Direct bounded Git commands are
  sufficient and keep the package dependency-free.
- Store an append-only integration event stream. Only the latest exact proof is
  needed for cleanup; older operational attempts do not justify more machinery.

## Consequences

- v0.3 repositories require an explicit evidence-retention decision, retirement
  of the old pinned runtime on a dedicated branch, and fresh v0.4 initialization.
- Cleanup can remove remote branches, but only when the user selects
  `--include-remote` and the fetched remote tip exactly matches the plan.
- Dirty, active, protected, drifted, orphaned, unmerged, or ambiguous state is
  preserved and reported.
- The runtime becomes smaller despite adding Git cleanup because legacy and
  queue paths are removed.
