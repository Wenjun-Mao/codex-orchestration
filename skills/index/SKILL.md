---
name: index
description: Route Codex Flow questions, run-scoped orchestration, result integration, and cleanup. Use when the user asks about or wants to use Codex Flow, or when work may benefit from multiple separate Codex tasks. Do not invoke merely because one task has several local steps.
---

# Codex Orchestration Router

Route by intent before inspecting or changing repository state.

- For a question, explanation, audit, or proposed plan, answer read-only. A
  repository does not need `.codex/orchestration/` to discuss or plan Codex
  Flow.
- For an authorized actionable orchestration request, use
  `codex-orchestration:coordinate`. It may progressively activate one v0.7 run
  without tracked setup, after disclosing the exact runtime, Git-common state,
  workflow revision, model routing, and proposed external task creation. Every
  native model choice must include a durable selector rationale.
- v0.7 has no tracked setup, adoption, predecessor-retirement, or `AGENTS.md`
  mutation route. Ordinary actionable use activates only explicit Git-common
  run state through the coordinate skill.
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
