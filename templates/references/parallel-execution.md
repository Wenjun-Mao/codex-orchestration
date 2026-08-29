# Parallel Execution

Parallelism is an evidence-backed optimization. Use the smallest concurrency
that shortens the critical path.

One immutable workflow revision must prove:

- a concrete common baseline and coordinator/run/runtime authority;
- an acyclic dependency graph, including transitive ordering;
- disjoint unordered read/write ownership and exclusive-resource gates;
- explicit path, resource, branch, operation, and lease boundaries;
- actual native surface plus requested model/reasoning for each task;
- one direct follow-up or pause/replan after supporting instrumentation; and
- serial integration and combined verification gates.

Visible tasks are the primary independent/mutating lanes. Native subagents are
read-only supporting lanes with explicit `fork_turns`, no Ultra, and no Git or
callback lifecycle. Never silently substitute one for the other.

Only a completed accepted durable disposition unblocks a dependency. Task
final text, wait status, or the existence of a branch does not. A workflow
revision may change only unstarted tasks and edges; started/released contracts
remain immutable.
