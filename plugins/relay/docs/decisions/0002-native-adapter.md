# 0002 — Purpose-built native actions with exact observations

Accepted for the staged adapter candidate; native installation and proof remain
pending.

The source contract previously accepted injected identity, final, delivery, and
archive observations. That was deterministic but left agents to translate native
tool outputs and provided no genuine final-event path. Reusing Flow's private queue
or recursively staged runtime would violate Relay's dependency boundary, while a
second App Server client would duplicate host lifecycle ownership.

Relay generates current purpose-built App actions and normalizes their unmodified
results. Creation binds exact task and host. A plugin-bundled Stop hook captures
only a bound, source-released sender's exact turn and final bytes. The hook does not
read unstable transcripts, submit messages, steer turns, or open host IPC. The
recipient confirms the same task/host/turn/bytes through a read-only `wait_threads`
result, so a stopped sender need not reactivate. Optional message queue acceptance
remains a separate transport fact and cannot stand in for receipt.

Task archive is prepared once through `set_thread_archived`; only an affirmative
exact result or archived-task listing completes it. Background acknowledgement or
unknown output stays ambiguous. Existing child-first obligations preserve a parent
until its child archive duties are reconciled. All observations remain cooperative;
they authenticate association and identity, not hostile agents.

The packaged hook uses default `hooks/hooks.json` discovery. The package does not
add a manifest hook override, config layer, installer, daemon, marketplace entry,
or runtime dependency. Official host behavior requires plugin enablement and trust,
so source tests cannot promote the adapter to native evidence. The next gate is one
director-owned disposable journey against the exact enabled/trusted commit.

