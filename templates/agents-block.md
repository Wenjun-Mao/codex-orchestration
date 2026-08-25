<!-- codex-flow:start v0.4.0 -->
## Codex Orchestration

For work that creates, coordinates, or integrates other Codex tasks, invoke
`codex-orchestration:index` and run
`node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator`
before delegated planning. Executors must start from a validated task packet.
Create only the packet's explicit task kind and journal ambiguous host calls.
Use Steer only for true blockers, approvals, or high-risk drift; route ordinary
terminal completion through the journal with `codex-flow callback deliver`.
After a coordinator fork, rebind its recipient lineage before integration.
Bind each executor worktree to its observed operation, record integration, and
use only a reviewed `cleanup plan` / `cleanup apply` pair for Git deletion.
<!-- codex-flow:end -->
