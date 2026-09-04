---
name: cleanup
description: Audit retained Codex Flow run state and derive an exact read-only cleanup plan for eligible task branches and worktrees.
---

# Audit and Plan Cleanup

Name the exact `run_id`. Use `cleanup plan --run-id ...` as a read-only
operation. It re-derives each launch, terminal receipt, disposition,
integration/no-change proof, verification, archive result, local ref, upstream,
worktree attachment, and admitted reservation fence.

Missing evidence, exact-tip drift, upstream mismatch, unmerged work, attached
branches, ordinary untracked files, or ambiguous task identity fail closed.
Ignored build artifacts are reported separately and do not fabricate source
dirtiness.

Ordinary cleanup exposes no apply command. Resolve only the exact host/Git
actions returned by the plan, then rerun it and `run audit`. Closing requires a
fresh terminal audit. Abandonment keeps the admitted fence envelope durable.
