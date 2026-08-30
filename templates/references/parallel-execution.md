# Parallel Execution

Parallelism is an evidence-backed optimization. Use the smallest concurrency
that shortens the critical path.

One immutable workflow revision must prove:

- a concrete common baseline and coordinator/run/runtime authority;
- an acyclic dependency graph, including transitive ordering;
- disjoint unordered read/write ownership and exclusive-resource gates;
- an admitted path/resource reservation envelope that covers every workflow
  write/resource claim, plus an exact branch reservation checked when each
  host-worktree task is created;
- actual native surface plus requested model/reasoning and a selector rationale
  for each task;
- one direct follow-up or pause/replan after supporting instrumentation; and
- serial integration and combined verification gates.

Visible tasks are the primary independent/mutating lanes. Native subagents are
read-only supporting lanes with bounded `fork_turns`; the v0.6 contract forbids
Ultra, full-history selector overrides, nested spawning, and any Git/callback
lifecycle. Never silently substitute one for the other.

Only accepted terminal authority unblocks a dependency: a completed visible
task disposition or an accepted native-subagent operation. Task final text,
wait status, or the existence of a branch does not. A workflow revision may
change only unstarted tasks and edges; started/released contracts remain
immutable. An exact selector rejection before native-object identity is terminal
for that contract but may be replanned only as a new content-addressed revision.
