---
name: index
description: Route Codex Flow questions, run-scoped orchestration, permanent adoption, result integration, and cleanup. Use when the user asks about or wants to use Codex Flow, or when work may benefit from multiple separate Codex tasks. Do not invoke merely because one task has several local steps.
---

# Codex Orchestration Router

Route by intent before inspecting or changing repository state.

- For a question, explanation, audit, or proposed plan, answer read-only. A
  repository does not need `.codex/orchestration/` to discuss or plan Codex
  Flow.
- For an authorized actionable orchestration request, use
  `codex-orchestration:coordinate`. It may progressively activate one v0.6 run
  without tracked setup, after disclosing the exact runtime, Git-common state,
  workflow revision, model routing, and proposed external task creation.
- For permanent tracked team/headless policy, use
  `codex-orchestration:setup` only when the user explicitly asks to adopt,
  install, or retire Codex Flow, including an accepted v0.5.1-to-setup-free
  transition.
- Inside a released visible executor task, use
  `codex-orchestration:execute`.
- For durable results, dispositions, integration or no-change proof, combined
  verification, and task archival, use `codex-orchestration:integrate`.
- For retained reservation fences, worktrees, branches, or other completed-run
  state, use `codex-orchestration:cleanup`.

Visible Codex tasks are the primary surface for independently running,
heterogeneous-model work. Native subagents are a distinct, read-only supporting
lane: never substitute one surface for the other or give a subagent task-branch,
callback, integration, archive, or cleanup ownership.
