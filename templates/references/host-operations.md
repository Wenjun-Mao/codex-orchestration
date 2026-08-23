# One-Shot Host Operations

The portable CLI journals intent and reconciliation. It does not invoke private
in-session Codex tools. The coordinator performs one bounded host call around
that journal; no daemon, MCP server, or background secretary is required.

For task creation:

1. Validate the task packet and its absolute launch deadline. For a local or
   worktree task, derive the absolute Git worktree root, exact full `HEAD`, and
   current cleanliness from Git rather than transcribing them manually.
2. Run `task operation prepare`, then `task operation attempt`. Both fail
   closed on baseline mismatch; the attempt rechecks immediately before the
   host call.
3. Call the host creation capability exactly once with the requested
   `execution_kind`, environment, resolved model, and reasoning effort.
4. If creation succeeds, set the exact requested title when the host creation
   API does not accept one directly.
5. List/read the resulting host object and verify its ID, exact title, kind,
   and visibility. A task thread must be user-visible; a subagent must be
   hidden.
6. Reconcile the attempt as `observed` with those facts.

When a host advertises filtered thread listing but rejects the filter at
runtime, make one bounded recent-list call without that filter and match only
the expected operation by exact returned ID, title, kind, and visibility. Do
not search an unbounded history or infer identity from title alone. If the host
does not expose model or reasoning in list/read results, report those fields as
requested and accepted by creation, not independently observed. Likewise, an
archive setter response proves the bounded archive operation, but does not
prove archived-list visibility when no such host capability exists.

If any host call times out or returns an indeterminate result, reconcile the
attempt as `ambiguous` and inspect host state before retrying. If the exact
object exists, reconcile it as observed. If inspection proves it was not
created, reconcile `not-created`, then start a new attempt only before the
launch deadline. Never infer failure from a local timeout or create a different
kind as fallback.

Archive and send operations remain host capabilities. Apply the same
operation-ID, bounded-wait, inspect-before-retry, and duplicate-safe principles,
but the current portable journal directly models creation only. Cleanup never
auto-archives or auto-deletes tasks.

There is an unavoidable narrow gap between a successful pre-dispatch check and
the private host call. Keep that call immediate and one-shot; the executor must
still authenticate the baseline it receives before changing repository state.
