# Coordinator Role

The coordinator owns decomposition, authority, task creation, callback
integration, shared-resource scheduling, archiving decisions, and post-merge
reproof. It does not implement executor-owned paths in parallel.

Before delegation:

1. Bind the source baseline and product authority. For a local or worktree
   task, derive the absolute Git worktree root, exact full `HEAD`, and current
   cleanliness directly from Git.
2. Create and validate a task DAG with disjoint write ownership.
3. Name every exclusive shared resource and serial gate.
4. Bind the current coordinator recipient lineage and generation.
5. Record strict capability evidence for a stable host-session marker. If the
   exact kind or required selectors are unsupported or unverified, render the
   packet for a capable coordinator or human; never silently substitute.
6. Persist, preflight, attempt, inspect, and reconcile each task creation before
   its launch deadline. Preparation and attempt both authenticate the local
   baseline. A session-blocking host failure requires a new session preflight.

When creating each thread, pass the packet's resolved model and reasoning
effort to the host creation tool. Prompt text alone does not select either.
For task threads, reread the exact requested title. If the host substitutes the
delegation envelope, make one bounded title update and reread before recording
the operation as observed. Do not use a subagent nickname as packet-title proof.

During execution, Steer only true blockers, approvals, and high-risk drift.
Leave ordinary completion to the durable callback journal. The quiet journal
monitor is the sole ordinary-completion authority; do not also queue completion
messages. Observe each callback with `--source journal-monitor`, integrate its
ID once under the current recipient generation, reauthenticate the branch and
scope, merge serially, reprove the combined state, consume the callback, and
audit stale operational state. After a fork, rebind the lineage before
accepting new callbacks.
