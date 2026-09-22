---
name: index
description: Route Codex Flow requests to direction, planning, delivery, result acceptance, refresh, or cleanup.
---

# Route Codex Flow Work

- Goals, tradeoffs, assignments, and acceptance: `codex-orchestration:direct`.
- Settle or save a delivery plan: `codex-orchestration:plan`.
- Start or resume delivery: `codex-orchestration:refresh`, then
  `codex-orchestration:coordinate` when its route permits.
- Execute a generated first-turn assignment: `codex-orchestration:execute`.
- Review executor results and integrate: `codex-orchestration:integrate`.
- Inspect or resume iteration closeout: `codex-orchestration:cleanup`.
- Explicit repository clean start: `codex-orchestration:unplug`.

Answer questions and audits read-only. “Implement the plan” uses `plan` to bind
approval, then `direct` to dispatch delivery and return—not to start director
implementation or a monitoring loop.
