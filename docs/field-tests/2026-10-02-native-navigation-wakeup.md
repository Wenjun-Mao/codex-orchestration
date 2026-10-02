# Native navigation can wake an unloaded chat's queued work

Status: verified in a disposable local desktop probe; reusable workaround, not
a Relay feature or default workflow requirement.

## Finding and use

`thread/queue/add` can save a message without loading its destination chat.
In this probe, the native `navigate_to_codex_page` action opened the unloaded
chat and its existing queued message then ran without being resent.

When an authorized assignment is already queued but its chat remains unloaded,
opening that existing chat is a practical workaround:

```text
navigate_to_codex_page({threadId: existingTaskId})
```

This is a native Codex app tool, not a shell command or an external bridge API.
It changes the visible chat. Do not resend the assignment to wake the worker,
or use `send_message_to_thread`, steering, or interruption as a substitute for
opening an already queued assignment.

## Observed evidence

Tested October 1, 2026 (America/Toronto), at October 2, 03:54–03:56 UTC.
Codex app: `26.928.40906`, build `12694`; bundled CLI: `0.159.2`.
Reused chat: **Plotloom isolated queue wake probe**,
`01a0faab-a4c9-7c70-9b88-05b23c25161f`.

| Case | Observation |
|---|---|
| Unloaded with pending work | One CLI queue call saved the message. After five seconds, `read_thread` still reported `notLoaded` and no new turn. One native-open call was followed by the exact expected final. |
| Busy with pending follow-up | During a native 30-second sleep, one follow-up was queued. Navigating away and back left the same turn `inProgress`. It completed normally, then the follow-up ran as a separate turn. |
| Completion and cleanup | Exactly three test turns were added to the original two; all completed, with no interrupted or duplicate turns. Read-only `thread/queue/list` returned an empty queue. The probe was restored to archived/`notLoaded`, and navigation returned to the originating chat. |

Trace identifiers retained in the recoverable probe:

| Test | Queued message | Completed turn / exact final |
|---|---|---|
| Unloaded wake | `01a0fabf-8735-7ae2-b5f7-5a335b9c02db` | `01a0fabf-cecd-7303-8a4c-815ade6ccd7e` / `NATIVE_NAVIGATE_WAKE_ACK_20261001` |
| Busy turn | `01a0fac0-90f1-7752-ad41-adcb6df59113` | `01a0fac0-a5b0-7b51-8f4e-c4ac20edfcbf` / `NATIVE_BUSY_TURN_ACK_20261001` |
| Busy follow-up | `01a0fac1-12ff-7d82-b9d5-1a2c19df00c7` | `01a0fac1-33c2-7bc0-9022-ef663d4b5aba` / `NATIVE_BUSY_FOLLOWUP_ACK_20261001` |

The busy turn completed at `03:56:00Z`; the follow-up started at `03:56:00Z`
and completed at `03:56:03Z`. No explicit `thread/queue/start` call was made.

## Boundaries

- One unloaded case and one busy case were tested, not all concurrency races,
  restart/crash recovery, remote hosts, or future app versions.
- No ImageGen call was made. Successful desktop wake-up is not proof of image
  generation or every specialist tool's availability.
- This does not establish a background-only wake endpoint or an externally
  callable Plotloom bridge integration.
- No Plotloom source, service, real specialist, or image request was changed.
  No Relay runtime, skill, hook, or installed package was changed.

The distinction is useful beyond this probe: queue acceptance and desktop
execution readiness are separate. Official [app-server documentation](https://learn.chatgpt.com/docs/app-server#api-overview)
also distinguishes reading a stored chat, resuming it, and starting a turn.
Retain this as host knowledge; do not broaden Relay's responsibilities based
on this bounded test.
