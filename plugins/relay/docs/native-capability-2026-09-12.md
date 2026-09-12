# Native capability checkpoint — 2026-09-12

Status: source adapter corrected against one genuine completed native snapshot;
the connected disposable journey and release qualification remain incomplete.

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
phase, and `text`. A read-only replay of that saved result passes the
corrected normalizer. The canary remains paused before executor creation.

## Minimum adapter

Relay now stages only these native boundaries:

1. Generate `create_thread` arguments and normalize its unmodified `threadId` or
   `clientThreadId` result. Ready binding stores exact thread and host. Unknown or
   error output stays ambiguous and never causes a creation retry.
2. After source release, a plugin-bundled `Stop` command captures the exact bound
   task, turn, and final bytes. It ignores unbound tasks and unsealed results and
   never reads a transcript, sends a message, continues a turn, or calls private IPC.
3. The exact recipient obtains a read-only `wait_threads` action. Receipt is recorded
   only when thread, host, error-free completed turn, and a matching-ID same-turn
   `final_answer` message's exact text bytes equal the hook capture.
   Nonterminal pending snapshots can repeat this read observation with their cursor;
   a completed mismatch is reread without advancing it.
4. An optional `send_message_to_thread` action keeps queue acknowledgement separate
   from recipient receipt. It persists an attempt before exposing the request.
5. `set_thread_archived` is prepared once. A background acknowledgement remains
   ambiguous until an exact `list_archived_threads` result affirmatively contains
   the task. No Git resource is deleted.

Adapter tests use the observed native result shape and injected Stop events in
disposable repositories. The saved genuine result proves the completed-result
parser boundary; it does not complete Stop capture, delegation, archival, successor,
coexistence, or release qualification.

## Exact blocker

The director owns staging the corrected exact commit into the already managed
candidate and resuming the paused journey in
[native-disposable-journey.md](native-disposable-journey.md). This source correction
does not install, enable, trust, or restart anything. Full qualification still
requires authentic Stop capture, executor delegation and receipt, child-first
archival, successor admission, and separate-repository Flow coexistence. Starting a
second App Server client or using the running app's private control socket remains
outside the approved adapter shape.
