<!-- codex-flow:start v0.3.0 -->
## Codex Orchestration

For work that creates, coordinates, or integrates other Codex tasks, invoke
`codex-orchestration:index` and run
`node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator`
before delegated planning. Executors must start from a validated task packet.
Create only the packet's explicit task kind and journal ambiguous host calls.
Use Steer only for true blockers, approvals, or high-risk drift; route ordinary
terminal completion through `codex-flow callback deliver`. After a coordinator
fork, rebind its recipient lineage before integration.
<!-- codex-flow:end -->
