# One-Shot Host Operations

The portable CLI journals intent and reconciliation. It does not invoke private
in-session Codex tools. The coordinator performs one bounded host call around
that journal; no daemon, MCP server, or background secretary is required.

For task creation:

1. Validate the task packet and its absolute launch deadline. For a local or
   worktree task, derive the absolute Git worktree root, exact full `HEAD`, and
   current cleanliness from Git rather than transcribing them manually.
2. Record a stable, nonsecret host-session marker and capability evidence for
   the requested kind, model, and reasoning. Also record whether filtered
   discovery works or which bounded fallback is available.
3. Run `task operation prepare`, `task operation preflight`, then
   `task operation attempt`. Preparation and attempt fail closed on baseline
   mismatch; unsupported or unverified required selectors stop before dispatch.
4. Call the host creation capability exactly once with the requested
   `execution_kind`, environment, resolved model, and reasoning effort.
5. List/read the resulting host object. A task thread must be user-visible and
   its title must be independently reread. If the host used the delegation
   envelope, perform one bounded title update, reread the exact requested title,
   and record `bounded-host-write`. A subagent may have no title field; keep its
   host nickname separate.
6. Reconcile the attempt as `observed` with field-level provenance for title,
   visibility, model, reasoning, and host label.

When a host advertises filtered thread listing but rejects the filter at
runtime, make one bounded recent-list call without that filter and match only
the expected operation by exact returned ID, title, kind, and visibility. Record
the rejected query and selected fallback in preflight evidence. Do not search
an unbounded history or infer identity from title alone. If the host does not
expose model or reasoning in list/read results, report those fields as
host-accepted or role-derived, not independently observed. Likewise, an
archive setter response proves the bounded archive operation, but does not
prove archived-list visibility when no such host capability exists.

If any host call times out or returns an indeterminate result, reconcile the
attempt as `ambiguous` and inspect host state before retrying. If the exact
object exists, reconcile it as observed. If inspection proves it was not
created, reconcile `not-created`, then start a new attempt only before the
launch deadline. Never infer failure from a local timeout or create a different
kind as fallback.

If dispatch fails before creation with a serializer, adapter, backend,
schema-runtime, or host-control error, reconcile `host-session-blocked` with a
specific reason code. Do not retry in that host session. After a reboot or
host-generation change, record a new compatible preflight; only then may a new
attempt start. Permanent selector incompatibility and transient session failure
are different states.

Archive and send operations remain host capabilities. Apply the same
operation-ID, bounded-wait, inspect-before-retry, and duplicate-safe principles,
but the current portable journal directly models creation only. Cleanup never
auto-archives or auto-deletes tasks.

There is an unavoidable narrow gap between a successful pre-dispatch check and
the private host call. Keep that call immediate and one-shot; the executor must
still authenticate the baseline it receives before changing repository state.
