# Parallel execution

Use an acyclic dependency graph with bounded paths, resources, and verification.
A dependent node starts only after accepted durable results. Serialize shared
state and integration; parallelize only independent ownership.

Choose the surface first:

- **Coordinator task:** sequential decisions or shared evolving state; no
  mandatory children.
- **Native subagents:** bounded read-only support, without branch ownership or
  independent Git lifecycle.
- **Visible tasks:** independent work requiring durable task/worktree ownership.

Obtain delegated selectors from `lib/policy/selector-policy.mjs` in the
authenticated package: `selectCoordinatorDelivery` for coordinator staffing,
`routeWork` for other delegated work. Apply a deliberate override only with a
replacement rationale. Pass explicit model, effort, and supported bounded fork
history; never inherit, probe availability, silently escalate, or substitute a
different surface. Ultra is forbidden for native subagents.

For the delivery owner, choose the selector by the hardest expected judgment;
the presence or absence of child tasks affects staffing, not that selector.
