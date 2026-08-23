---
name: cleanup
description: Audit Codex callback journals, task operations, recipient bindings, leases, pinned runtime drift, and completed-task housekeeping without deleting repositories or task threads. Use for stale-state or disk-hygiene review after integration.
---

# Audit Orchestration State

Start read-only:

```bash
node .codex/orchestration/bin/codex-flow.mjs cleanup audit
```

Classify callback lifecycle records, ambiguous task operations, recipient
lineages, active or expired leases, legacy callback state, managed-runtime
drift, and disk use. Operational state is not an evidence archive, and the
current command intentionally performs no deletion. Task-thread archive and deletion are
coordinator or human actions because host capabilities and retention value
vary.

Do not remove worktrees, repositories, Cocos projects, ignored authority,
generated evidence, or user files based only on age or size. Require an
explicit later cleanup contract or user authorization for mutation.
