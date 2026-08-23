<!-- codex-flow:start v0.1.0 -->
## Codex Orchestration

For work that creates, coordinates, or integrates other Codex tasks, invoke
`codex-orchestration:index` and run
`node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator`
before delegated planning. Executors must start from a validated task packet.
Use Steer only for true blockers, approvals, or high-risk drift; route ordinary
terminal completion through `codex-flow callback deliver`.
<!-- codex-flow:end -->
