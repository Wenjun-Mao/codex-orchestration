# Parallel execution

Represent work as an acyclic dependency graph. Every node has one outcome,
bounded ownership, exclusive resources, verification, and an execution
surface. Dependencies authorize start only after their durable terminal
evidence is accepted.

## Surfaces

- **Coordinator task:** sequential decisions and shared evolving state.
- **Native subagents:** bounded read-only research or review that returns to
  the current task. They never own task branches, callback journals,
  integration, archive, or cleanup.
- **Visible tasks:** independent mutating work that needs a user-visible task,
  isolated worktree, branch ownership, durable callback, and Git lifecycle.

Two nodes may run concurrently only when their path and resource envelopes do
not overlap and neither depends on the other. Serialize shared configuration,
generated artifacts, integration, and combined verification.

Choose each model and reasoning effort deliberately after choosing the
surface. Never inherit selectors or silently replace one surface with another.
