---
name: unplug
description: Plan and, with explicit approval, apply a repository-scoped clean start that archives known Codex Flow tasks and removes exact local Flow state. Use when incompatible retained Flow state blocks activation or the user asks to unplug a repository; do not use for ordinary run cleanup.
---

# Clean-start and unplug

Use the installed plugin's `unplug` commands only for the one repository the
user placed in scope. This is a local reset of Flow operational state, not a
predecessor migration, ordinary generic Git cleanup, or way to bypass an active run.
It never reads `AGENTS.md` or creates an instruction authority.

## Plan before changing anything

Run `unplug plan` first and present the repository root, Git common directory,
exact local paths, state digest, and every known task that must be archived.
The plan is read-only. Do not substitute a branch-name heuristic or delete a
parent directory because it appears to contain only Flow data.

Build the plan request from authenticated retained records and current App/Git
observation. Each resource carries `provenance: "state-derived"` or
`"user-bound"`, the exact Git common directory, and all kind-specific fields:

- a worktree has its absolute path, local `codex/*` branch, expected tip, and
  `thread_id: null`;
- a branch has null path, its local `codex/*` name and expected tip, and
  `thread_id: null`;
- a task has null Git fields and its exact visible `thread_id`.

Never invent a resource or task identity. An empty `resources` array is valid
when only opaque Flow state remains. Keep request JSON outside the repository
when zero repository residue is the user's outcome.

Archive every task named by the plan through the App and reconcile its observed
archived state before local cleanup. If a task cannot be archived, its state is
ambiguous, or the plan changes, stop and report the blocker; do not remove
state that may still authorize work.

For apply, bind each planned task resource to exact structured App evidence:
`{thread_id, archived: true, observed_at, source: "codex-app"}`. The evidence
map must cover every planned task ID and no other entry. A successful setter
call without reconciled archive observation is not enough.

## Apply only an approved exact plan

Ask for explicit approval of the unchanged repository-specific plan before
`unplug apply`. Re-read the plan immediately before applying it. Apply may
remove exact local Flow paths plus only these authenticated registered local
resources:

- a same-common-directory linked worktree at the planned path, branch, and
  tip, when it is tracked-clean; Git-ignored artifacts may remain;
- an unprotected local `codex/*` branch at its planned tip, only after it is
  an ancestor of the authenticated base and no worktree still attaches it.

Dirty or ordinarily untracked worktrees, unmerged or attached branches,
protected resources, remote state, and any path or tip drift block apply. Do
not delete remote refs, tags, source files, or another repository's state.
Delete every `.git/codex-flow` path last and require zero-residue confirmation.
It does not delete Codex tasks; task archival is a separate host action
completed first.

## Optional App removal

After successful zero-residue confirmation, offer App-plugin uninstallation
only when it would help the user's stated outcome. Uninstallation requires its
own explicit request and must not be bundled into the repository cleanup.
