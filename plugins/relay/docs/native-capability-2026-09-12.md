# Native capability checkpoint — 2026-09-12

Status: recovered mixed same-host journey and fresh useful successor completed;
remaining native, coexistence, startup-budget, pilot, and release gates are below.

## Current host

- macOS `26.6.2` build `25G83`, arm64.
- ChatGPT `26.903.71938`, bundle build `8576`.
- Bundled executable: `/Applications/ChatGPT.app/Contents/Resources/codex`.
- `codex-cli 0.153.4`.
- `codex features list` reports `hooks` as stable and enabled. The older
  `plugin_hooks` feature is removed and disabled.
- `codex app-server generate-json-schema` completed against that exact binary in
  `/tmp/relay-app-server-schema.9VK69y`. Its stable schema includes
  `thread/start`, `item/completed`, `turn/completed`, `thread/archive`, and
  `thread/archived`. No experimental schema was requested.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
states that clients initialize once, then receive streamed item/turn notifications.
Final `agentMessage` items carry accumulated text and a `final_answer` phase;
`turn/completed` carries the terminal turn status. It also documents
`thread/archive` and one `thread/archived` notification per task actually archived.
An archive request may attempt descendants and still succeed without affirming
every descendant, so Relay continues to require exact task observations.

The [official Hooks documentation](https://learn.chatgpt.com/docs/hooks) documents
`Stop` input with `session_id`, `turn_id`, `stop_hook_active`, and
`last_assistant_message`. It says transcript paths are convenient but unstable,
so Relay does not parse transcripts. The same page documents default discovery of
`hooks/hooks.json` in an enabled plugin and provides `PLUGIN_ROOT`. It also states
that plugin hooks are skipped until the exact definition is reviewed and trusted.

The current Codex task surface exposes purpose-built `create_thread`,
`wait_threads`, `send_message_to_thread`, `set_thread_archived`, and
`list_archived_threads` actions. A read-only `wait_threads` snapshot of the director
confirmed the current result shape: exact wake thread/turn/host plus per-thread
cursor, status, latest completed turn, and a structured latest assistant message
with message ID, turn ID, phase, and text when available.
That observation did not create, modify, archive, or resume a task.

The director-owned canary later captured a genuine completed snapshot for task
`01a0940c-49d3-73c1-909d-bd00decda2c8`, turn
`01a0940c-4b40-7130-8f26-0dc4984127e3`. It established `schemaVersion: 1`, a
completed turn with `error: null`, `latestAssistantMessageId`, and a structured
`latestAssistantMessage` containing matching `id`, `turnId`, a `final_answer`
phase, and `text`. A read-only replay of that saved result passes the corrected
normalizer. Later executor wait/read calls returned completed turns with null message
content, motivating the approved shared-storage receipt contract.

## Minimum adapter

Relay now stages only these native boundaries:

1. Generate `create_thread` arguments and normalize its unmodified `threadId` or
   `clientThreadId` result. Ready binding stores exact thread and host. Unknown or
   error output stays ambiguous and never causes a creation retry.
2. After source release, a plugin-bundled `Stop` command captures the exact bound
   task, turn, and final bytes. It ignores unbound tasks and unsealed results and
   never reads a transcript, sends a message, continues a turn, or calls private IPC.
3. The exact recipient reads the immutable captured report from shared Relay state.
   The read is non-mutating and returns the result association and exact final plus
   a command whose event, final digest and association digest are rechecked before
   recording `shared-storage` acknowledgement.
4. `wait_threads` can provide optional completion notification but does not retrieve
   or prove receipt. The older sender-only message action remains a compatibility
   path; it is not prepared through sender reactivation or actor impersonation.
5. `set_thread_archived` is prepared once. A background acknowledgement remains
   ambiguous until an exact `list_archived_threads` result affirmatively contains
   the task. No Git resource is deleted.

Adapter tests use the observed native result shape and injected Stop events in
disposable repositories. Live evidence separately establishes recovered coordinator
and child completion plus a fresh useful successor, including genuine Stop capture,
same-host shared receipt, separate acceptance, and exact task archival. The
successor self-corrected one rejected wrong-actor start before any write.

## Exact blocker

The remaining native gates are failure/recovery, provisional or early start, and
separate-repository Flow coexistence. End-to-end startup tokens, calls and elapsed
time remain unmeasured; the observed 52.364-second successor turn is narrower and
the wrong-actor retry prevents a three-call startup claim. Restart-free upgrades,
product pilot, release and broader rollout are also unqualified. Starting a second
App Server client or using the running app's private control socket remains outside
the approved adapter shape.
