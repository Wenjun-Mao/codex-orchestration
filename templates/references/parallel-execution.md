# Parallel Execution

Parallelism is an evidence-backed optimization, not the default.

A task may run concurrently only when the plan proves:

- an authenticated common baseline;
- an acyclic dependency graph;
- disjoint write ownership or explicit dependency ordering;
- ordering for every exclusive shared resource;
- independent verification that does not mutate sibling-owned state;
- a serial merge and combined reproof gate.

Read-only exploration can fan out more freely. Mutating work should use the
smallest concurrency that shortens the critical path. Do not use concurrency
to bypass unresolved product authority or to create multiple competing owners
of the same editor, browser, simulator, device, account session, or build root.
