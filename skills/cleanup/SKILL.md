---
name: cleanup
description: Audit and explicitly clean completed Codex task branches and worktrees using source-bound ownership, integration proof, exact Git tips, and deterministic plans. Use for stale-state or disk-hygiene review after integration.
---

# Audit Orchestration State

Start read-only:

```bash
node .codex/orchestration/bin/codex-flow.mjs cleanup audit
```

Classify callback lifecycle records, ambiguous task operations, recipient
lineages, active or expired leases, managed-runtime drift, Git ownership,
linked worktrees, exact local/remote tips, and disk use. Audit performs no
mutation. Task-thread archiving remains coordinator or human work because host
capabilities and retention value vary.

For records proven merged, patch-equivalent, or superseded, create an explicit
`cleanup plan` from clean pushed main. Review its operation IDs and actions,
then apply that exact plan ID. Drift invalidates the plan. If apply is
interrupted, audit again and create a fresh plan for the remaining state. Never
delete from a branch-name pattern, and never
remove dirty, active, protected, unmerged, or ambiguous state. Do not remove
repositories, Cocos projects, ignored authority, generated evidence, or user
files through this workflow.
