# 0002 — Purpose-built native actions with exact observations

Accepted and qualified for the bounded same-host shared-storage journey described
below; broader native and release gates remain pending.

The source contract previously accepted injected identity, final, delivery, and
archive observations. That was deterministic but left agents to translate native
tool outputs and provided no genuine final-event path. Reusing Flow's private queue
or recursively staged runtime would violate Relay's dependency boundary, while a
second App Server client would duplicate host lifecycle ownership.

Relay generates current purpose-built App actions and normalizes their unmodified
results. Creation binds exact task and host. A plugin-bundled Stop hook captures
only a bound, source-released sender's exact turn and final bytes. The hook does not
read unstable transcripts, submit messages, steer turns, or open host IPC. The
exact recipient retrieves that immutable report through public `read-report`, which
returns its exact final bytes and result association plus an acknowledgement command.
Acknowledgement revalidates the frozen assignment, event, final digest and complete
association digest, then records `shared-storage` transport. Read, acknowledgement
and semantic acceptance remain separate. Missing capture blocks retrieval.

Native `wait_threads` remains an optional completion notification. Even an exact
same-turn `final_answer` observation does not record receipt; missing message text
does not block shared-storage retrieval. The sender-only message path remains for
source compatibility, but the adapter does not reactivate or impersonate a stopped
sender to prepare it. Queue acceptance cannot stand in for receipt.

Constructing Relay and reading control are discovery operations and do not create
the `.git/relay` namespace. The Stop hook therefore leaves fresh, unrelated, and
Flow-only repositories outside Relay state. Only an explicit `prepare` with a valid
request contract, after the Flow exclusion check, initializes Relay storage.

Generated startup reads the invoking task identity from the host-provided
`CODEX_THREAD_ID` environment variable. Relay never substitutes the assignment's
stored owner for the caller: missing or conflicting runtime identity is refused,
and admission still compares the supplied identity with the exact observed native
binding. The explicit actor API remains available for deterministic fixtures and
other already-authenticated callers. The generated brief and delivery skill contain
the complete pre-READY procedure, so startup requires no status lookup, broad README
read, or runtime-source inspection.

Task archive is prepared once through `set_thread_archived`; only an affirmative
exact result or archived-task listing completes it. Background acknowledgement or
unknown output stays ambiguous. Existing child-first obligations preserve a parent
until its child archive duties are reconciled. All observations remain cooperative;
they authenticate association and identity, not hostile agents.

The packaged hook uses default `hooks/hooks.json` discovery. The package does not
add a manifest hook override, config layer, installer, daemon, marketplace entry,
or runtime dependency. Official host behavior requires plugin enablement and trust,
so source tests cannot promote themselves to native evidence. The director-owned
disposable journey used the exact installed candidate and separately recorded a
recovered mixed serial run plus a fresh useful successor. That qualifies same-host
shared receipt and task-only retirement. The successor self-corrected a rejected
wrong-actor start before writing, so three-call startup is not qualified. Native
failure/early-start, Flow coexistence, startup budget, restart-free upgrades, and a
product pilot remain open.
