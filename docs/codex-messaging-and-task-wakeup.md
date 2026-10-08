# Codex messaging, task wakeup, and CLI execution

Reference checked October 7, 2026. These are different operations, not interchangeable
ways to send the same assignment. No new Relay behavior is introduced here.

## Choose the operation

| Need | Method | Important distinction |
|---|---|---|
| Queue a report for an existing manager without disturbing its current turn | `thread/queue/add` — used by Relay | Queue acceptance is not proof of receipt or execution. |
| Run already-queued work in an unloaded Desktop chat | Native `navigate_to_codex_page({threadId})` | Opens the visible chat; the existing queue ran in our bounded probe, without resending. |
| Give an existing chat an ordinary follow-up | Native `send_message_to_thread({threadId, prompt})` | A higher-level messaging tool, not Relay's queue transport. Do not use it to resend already-queued work. |
| Deliberately start, steer, or cancel execution | App-server `turn/start`, `turn/steer`, `turn/interrupt` | Execution controls; Relay does not call them. |
| Run a bounded task from a script or terminal | `codex exec` / `codex exec resume` | CLI execution, not an in-place Desktop queue wakeup. |

## 1. Queue a message: Relay's method

Relay's installed Stop hook reads the worker-to-manager route, captures the actual
final, and calls `submitQueueNotification` in the
[queue adapter](../plugins/relay/lib/queue-notification.mjs). It prefixes the unchanged
body with `From: <current task title>` (sender UUID if title lookup is unavailable).

The adapter resolves the bundled Codex executable, starts one bounded
`app-server --listen stdio://` transport process, and initializes with
`capabilities: {experimentalApi: true}`. It checks the Desktop host/default Codex
home before sending this request shape:

```json
{
  "id": 2,
  "method": "thread/queue/add",
  "params": {
    "threadId": "RECIPIENT_UUID",
    "clientUserMessageId": "MESSAGE_UUID",
    "input": [{"type": "text", "text": "From: worker title\n\nexact report body"}]
  }
}
```

This is an experimental host API in the current implementation, not a stable
public queue contract established by the official API overview. See the
[transport qualification](../plugins/relay/docs/field-tests/2026-09-12-relay-hook-transport-feasibility.md#connected-transport-observation).
Starting that transport process is not starting a worker's generation turn.

Relay checks the exact `queuedSubmission` response, then closes the transport.
It never starts, steers, interrupts, or navigates a chat, and never retries an
ambiguous send. Its stable client message ID is not a guarantee of native duplicate
suppression. A busy manager can finish its current turn and process the queue later;
an unloaded chat can retain the message without starting. Actual incoming receipt
or a new target turn is separate evidence from a queue acknowledgement.

## 2. Wake already-queued work: open its existing Desktop chat

When authorized work is already queued but the destination remains `notLoaded`,
and opening that chat is authorized, use the native Codex app tool:

```javascript
await tools.mcp__codex_app__navigate_to_codex_page({ threadId: existingTaskId });
```

This changes the most recently focused main App window. It is not a shell command
or a background-only wake endpoint. Do not send the assignment again to wake it.

The [October 1 navigation probe](field-tests/2026-10-02-native-navigation-wakeup.md)
verified an unloaded chat starting its exact queued message after navigation.
In a second case, navigating away and back while the chat was busy left its current
turn uninterrupted; the pending follow-up ran after completion. No explicit
`thread/queue/start` call was made. This is bounded field evidence, not a guarantee
for every race, remote host, restart, or future App version.

Use read-only native status/history to establish the situation and observe the
result. With no pending work there is nothing to wake for. Do not infer readiness
from queue acceptance alone, or treat `thread/read` / `read_thread` as wake actions.
If navigation does not start the expected work, preserve that uncertainty rather
than blindly resending or substituting steering/interruption.

The official [app-server API overview](https://learn.chatgpt.com/docs/app-server#api-overview)
distinguishes `thread/read` (read without resuming), `thread/resume` (reopen for later
execution), `turn/start` (begin generation), `turn/steer` (append input to an active
turn), and `turn/interrupt` (request cancellation). Merely finding those methods
does not qualify a second process to control Desktop's existing execution owner.

## 3. Run scripted work: `codex exec`

Use this for a new bounded CLI task, not to deliver a report or activate an existing
Desktop queue. For example, with an explicit repository and read-only sandbox:

```sh
codex exec --cd /absolute/repo --sandbox read-only --ephemeral "Review the latest change; do not edit files."
```

Ordinary progress goes to stderr and the final response to stdout. `--json` changes
stdout to a JSONL event stream; `--output-last-message FILE` saves the final response.
`--ephemeral` avoids persisted session files, not every possible filesystem effect.
Choose execution permissions for the actual task; these options do not grant new
authority to change source or contact another chat.

For intentional continuation of a previous CLI session, use its exact ID rather
than relying on whichever session happens to be latest:

```sh
codex exec --sandbox read-only resume SESSION_UUID "Continue the review; do not edit files."
```

This resumes work through a CLI runner; it is not a queue-only message or a native
Desktop navigation action. Do not launch it as a second execution owner against a
chat or checkout already being worked on. Cross-runner continuation of a Desktop
chat is not qualified by our queue/navigation probe.

See official [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [`codex exec` reference](https://learn.chatgpt.com/docs/developer-commands#codex-exec).
The examples' option placement was checked against the bundled CLI help; no live
CLI generation or cross-runner wake test was performed for this document.

## Keep the boundaries lean

Relay remains report forwarding only. Navigation is an optional native workaround;
CLI execution is a separate workflow. This reference adds no watchdog, daemon,
automatic wake policy, retry loop, or new reporting contract.
