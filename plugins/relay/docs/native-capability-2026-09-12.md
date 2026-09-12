# Native capability checkpoint — 2026-09-12

Status: stable 0.1.0 release candidate completed a bounded same-host pilot;
remaining provisional-ID, startup-budget, coexistence limits, and broader release
gates are below.

## Current host

- macOS `26.6.2` build `25G83`, arm64.
- ChatGPT `26.908.40834`, bundle build `8881`.
- Bundled executable: `/Applications/ChatGPT.app/Contents/Resources/codex`.
- `codex-cli 0.154.0-alpha.6.2`.
- `codex features list` reports `hooks` as stable and enabled. The older
  `plugin_hooks` feature is removed and disabled.
- The earlier `codex-cli 0.153.4` checkpoint ran
  `codex app-server generate-json-schema` in
  `/tmp/relay-app-server-schema.9VK69y`. That stable schema includes
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

## Corrected startup replay

Source `f627eef` was packaged and installed as
`0.1.0+codex.20260912163617`; all 20 source/cache files matched apart from the
distribution version suffix. The package artifact SHA-256 was
`198ed3b1b1e96b295d8bd274b089ec4efc13954900b3982c898611362379c3e8`.

A fresh Terra-high task used the generated `--actor-env CODEX_THREAD_ID` command.
Preparation, creation-result binding, and start were the intended three protocol
calls. The task performed no identity lookup, worker README read, runtime-source
inspection, rejected start, or mechanical JSON authoring before READY. It reached
READY 22.374 seconds after preparation, committed one scoped change, passed its
check, and completed genuine Stop capture, shared receipt, separate acceptance, and
one affirmative archive without another restart.

A separate native task ran the same generated command before its ready result was
bound. Relay returned `BINDING_PENDING` with no source activity. After the original
result was recorded, the same task and command reached READY under the exact native
ID and completed a no-change finish, genuine report, acceptance, and retirement.
The host returned ready IDs in both cases, so provisional-ID reconciliation remains
source-regression evidence rather than an observed native path.

## Product pilot and Flow observation

The `pdf_extract` pilot changed only its README on clean `main`, producing commit
`7e0568e2c5501967363a904cf9243e62b8a362f8`. Six existing tests passed with two
pre-existing `/run/secrets` warnings. No runtime, dependency, rendering, or push
operation occurred. Genuine final capture, recipient acknowledgement, acceptance,
one task-only archive, and public `RETIRED` status completed.

A fresh dependent no-change successor then verified the same README command and six
tests on retained clean `main` at `7e0568e2c5501967363a904cf9243e62b8a362f8`.
It changed no source, commit, or ref and completed genuine final capture, recipient
acknowledgement, acceptance, one exact archive, and public retirement. Neither pilot
task needed an executor, extra branch, worktree, injected report, retry, or restart.

Existing reports in a separate Flow repository remained available after Relay was
installed. The recipient director attested exact digest
`c934b1602d4ad27faa1ef9c4c6e80a50377ace3125ba5a663035c829be6fa991` without
resuming a product task. Relay's hook/report module bytes were unchanged by the
startup correction. This is bounded observational coexistence, not stress testing
or same-repository dual control.

## Startup correction accounting

The original canary evidence under `.git/relay-native-evidence/` declared nine
content components and an `o200k_base` proxy. Its 8,974-token baseline is retained.
The earlier source-only projection was 3,819 tokens, but that figure assumes
skill-only director instructions and is not the native result.

The conservative corrected accounting keeps the same nine categories and the
director's full skill/README read. It totals **6,106 proxy tokens**, down 2,868
(32.0%) from the baseline. The worker's requests and outputs fell from 4,008 to
1,065 tokens. The provisional 6,000-token ceiling is therefore missed by **106
tokens (1.8%)**. This is a target miss, not a PASS or exact billing measurement.

The accounting excludes ambient history and host framing, and the intent and host
differ from the baseline. The bounded product pilot and retained-project successor
passed. The 106-token gap does not justify additional token-accounting machinery.

## Exact blocker

Failure/recovery, the normal three-call path, exact ready-ID early binding, and one
restart-free candidate transition have bounded native evidence. Native provisional-ID
reconciliation remains open. Separate-repository Flow reporting has bounded
observational evidence, while stress and same-repository dual control remain open.
The startup token target misses by 106. Final acceptance, release, and broader
rollout remain director-owned.
Starting a second App Server client or using the running app's private control
socket remains outside the approved adapter shape.
