---
name: index
description: Route Codex Flow setup, delegation, parallel-task, callback, integration, and cleanup requests to the appropriate orchestration workflow. Use when the user asks to install or use Codex Flow, or when work may span separate Codex task threads. Do not invoke merely because an ordinary task has several local steps.
---

# Codex Orchestration Router

Use orchestration only when separate task threads would materially improve
throughput, isolation, or continuity and the user or repository permits
delegation.

- For first-time repository setup or adoption, use
  `codex-orchestration:setup` before delegated work.
- For decomposition, task creation, parallel ownership, and monitoring, use
  `codex-orchestration:coordinate`.
- For a bounded executor task packet, use `codex-orchestration:execute`.
- For callbacks, branch integration, and combined reproof, use
  `codex-orchestration:integrate`.
- For stale operational state, leases, or completed-task housekeeping, use
  `codex-orchestration:cleanup`.

If `.codex/orchestration/` exists, run its pinned `codex-flow doctor` before
delegated work. A missing host capability is a routing fact: render a task
packet for a capable session instead of silently replacing a task thread with
a subagent.
