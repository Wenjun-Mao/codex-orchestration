# Relay hook-owned reporting: transport feasibility

Date: 2026-09-12. Read-only host inspection; not a live wakeup qualification.

## Outcome and causal question

The desired outcome is direct hook-to-manager wakeup without a worker reporting
continuation. The question is whether a hook process can address the existing
Desktop-owned manager through a supported host interface.

The user approved testing the experimental dependency in the subsequent turn.
No supported stable direct route to Desktop has been established. This is
not proof that all possible routes are impossible.

## Evidence

- Installed CLI reports `codex-cli 0.154.0-alpha.6.2`.
- `codex app-server --help` labels the app-server experimental.
- `codex app-server proxy --help` describes proxying stdio to a running app-server
  control socket, with `--sock`. Its availability alone does not establish access
  to Desktop's owning host or permission to share its connection.
- Generated schemas in `/tmp/relay-hook-schema-xCpUzV` were produced both without
  and with `--experimental`. `thread/queue/add` occurs only in the experimental
  ClientRequest and aggregate schemas, not the stable output.
- Official [App Server documentation](https://learn.chatgpt.com/docs/app-server)
  documents experimental capability opt-in and stable `turn/start`, but does not
  document `thread/queue/add`. Starting a turn in another server is not evidence
  that Desktop's existing idle task was awakened.
- Flow's `lib/codex-app-report-adapter.mjs` starts a separate stdio app-server and
  opts into experimental capabilities for `thread/queue/add`. Reusing it would
  not establish the desired owning-host transport contract.
- Official [hook documentation](https://learn.chatgpt.com/docs/hooks) confirms
  that Stop `decision: block` creates a worker continuation. That explains the
  current behavior, but does not supply a direct manager-notification transport.

## Smallest proposed next step

With explicit acceptance of the experimental-host risk and an authorized
disposable target, test one bounded hook-process notification to an idle manager.
First establish legitimate owning-host access; do not open private storage,
bypass connection ownership, or substitute a second writer. Observe actual task
wakeup, not just an accepted queue response. Determine queue/idempotency behavior
from evidence; assume no safe retry until demonstrated.

If viable, keep this dependency in one small adapter with bounded process
lifetime, persisted ambiguous outcomes, no blind resend, and readable frozen
reports when notification fails. A host update may break the adapter; this risk
is separate from Relay result preservation and acceptance.

At the initial checkpoint, no queue message, task creation, source-runtime edit,
installation, or Plotloom operation was performed. Installed Relay 0.2.1 remains unchanged. No new daemon,
polling service, or hidden worker-continuation fallback is proposed.

## Approved follow-through

**Result: direct experimental queue wakeup passed.** This qualifies the small
transport mechanism on the observed App version, not the unimplemented Relay
hook/report lifecycle. The missing proxy socket is not a blocker for this route.

- The default proxy attempt exited 1: the control socket at
  `/Users/wjmao/.codex/app-server-control/app-server-control.sock` does not exist.
  Desktop's observed app-server process uses stdio, with no named Unix listener
  observed. No restart or listener reconfiguration was attempted.
- Flow already has genuine notification evidence, not merely a speculative API:
  [RC4 native queue gates](2026-09-06-v0.9.3-rc-live-app-acceptance.md#rc4-native-queue-gates)
  record hook capture and subsequent recipient turns. The task is narrow
  requalification and selective extraction, not rediscovery of hook reporting.
- One disposable task creation was requested: `Probe · Relay · Hook queue wakeup`,
  client ID `client-new-thread:28e2b8ae-5d38-4779-a342-8e5b1929bb8d`.
  The App allocated detached worktree `d049/relay-native-canary-20260912`, but has
  not returned a ready task ID through the task listing. Do not retry creation or
  infer that the task is idle/ready. No queue submission has been made.
- A bounded queue-only probe script is prepared outside source at
  `/tmp/relay-direct-hook-probe-QJbSmz/queue-probe.mjs`. It allows only queue list
  or queue add, never task resume, turn start, archive, or direct database writes.
  It has not run. A separate queue client must not be confused with a second
  task execution owner; actual Desktop wakeup still needs observation.

## Connected transport observation

The App's recent-task listing omitted the new task. Its exact session path was
used only to locate its ID; native `read_thread` then confirmed title, checkout,
idle state, and genuine initial final `READY FOR QUEUE PROBE`.

- Target: `01a09731-b719-74e0-835a-c0e42c9c9790`.
- Initial completed turn: `01a09731-b85d-73e2-bd4e-38bea566fb70`.
- Exactly one `thread/queue/add` invocation through the bounded temporary script.
- Initialize reported Desktop `0.154.0-alpha.6.2` and the expected Codex home.
- Client message ID: `relay-hook-probe-20260912-QJbSmz`.
- Accepted queue ID: `01a09734-b4fc-7df0-9857-6d248e8c614e`.
- The queue-only process exited after the response; no task resume, turn start,
  session writer, archive operation, or raw database edit was requested from it.
- Native cursor-based `wait_threads` observed a distinct completed turn
  `01a09734-d881-7df0-b3d6-b9d96fe16eda`, with final
  `OBSERVED RELAY-QUEUE-PROBE-20260912`, and the target returned idle.

No `send_message_to_thread`, worker reporting continuation, retry, or manual
target interaction was used. This was an external process transport probe, not
a genuine Relay Stop-hook event. Duplicate and crash behavior remains to be
tested in implementation; the client ID alone is not an idempotency guarantee.

Proceed with a small independent queue-only adapter. Preserve experimental API
risk, bounded subprocess cleanup, capture-before-send, and no blind retry. Do not
copy Flow's lifecycle engine or treat notification as acceptance.

Probe cleanup: native archival returned `archived: true`. The detached checkout
was clean at the unchanged main baseline, with no unique commits. Its exact
`d049/relay-native-canary-20260912` worktree was removed without force; no branch
or product work was deleted. The archived task retains the conversation evidence.
