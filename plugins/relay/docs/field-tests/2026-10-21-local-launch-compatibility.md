# Local task creation through app-server: bounded compatibility probe

Date: 2026-10-21, America/Toronto. Protocol timestamps below are UTC.
Status: bounded probe complete; genuine Stop report received, client closed,
probe archived, and route removed. No launcher implemented or installed.
Source baseline: `a7d57b9aacb155e751d911b9fa48e9be003a5482`.

## Purpose and authority

The user authorized Relay's owning director to assess a local task-creation
integration, run a harmless compatibility proof, and implement it only if viable.
The immediate motivation is a native `create_thread` instruction requiring a
specific user model request even when the user has supplied standing model-choice
guidance. No runtime rejection established that original restriction; its origin
date is unknown. This probe does not reinterpret or call around that tool's
contract. It evaluates the separately documented app-server integration surface.

Keep the pending planning/approval proposal separate. No UK Dev source or worker,
global model defaults, installed Relay runtime, active assignment migration, or
daemon restart is authorized here. Repository publication must not knowingly
trigger CI. At inspection, the repository had no tracked workflow files and the
GitHub Actions workflows API returned `total_count: 0`.

## Environment and sources

- Desktop App `26.1013.40934`, build `20770`.
- Bundled CLI `0.163.0-alpha.10.2` at
  `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`.
- Enabled installed Relay `0.4.2+codex.20261013135438`; `hooks/list` reported its
  Stop command enabled and `trusted`, with no discovery errors.
- Read-only current `configRequirements/read` returned `requirements: null`.
  That does not waive account or tool restrictions.
- [Official app-server documentation](https://learn.chatgpt.com/docs/app-server)
  describes initialization, model discovery, thread/turn creation, permission
  settings, steering, interruption, history, and archive operations. It also
  labels the app-server command and WebSocket transport experimental and not
  supported for production workloads. Generated installed-version schemas are
  capability evidence, not a stable Desktop integration guarantee.
- [Official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
  describes explicit model configuration, inherited settings, and permissions.
  Native subagents do not establish separate Desktop-task compatibility.

The generated schema includes `thread/start` model, cwd, projectId, config,
sandbox, and approvalPolicy fields; `turn/start` includes model and effort.
Thread metadata explicitly describes its model/effort as configured values,
**not per-turn execution telemetry**. No backend-level model telemetry was exposed.

## Observations

1. `codex app-server daemon version` failed because the default control socket
   did not exist. No daemon was started or reconfigured to make the test pass.
2. A bounded `app-server --listen stdio://` process initialized with the expected
   `Codex Desktop/` user agent and default `/Users/wjmao/.codex` home. It could read
   the existing director's stored identity and enumerate models/hooks.
3. That process read the running director as `notLoaded`; the native Desktop
   `read_thread` tool read it as active, including the current diagnostic turn.
   A Desktop-looking user agent and shared history therefore do not prove shared
   live execution ownership.
4. Native `list_projects` identified the local owning repository project as
   `7c98955d-aa0e-4fda-9cff-c38458c2602f`. The first `thread/start` request supplied
   that project and was rejected with `project not found`. It returned no task ID
   or `thread/started` notification. This is a recorded creation rejection, not
   an uncertain creation followed by a blind retry.
5. An explicitly separate diagnostic request omitted projectId to test the
   documented cwd-only path. It created exactly one real task:
   `01a15ca5-08ba-74a3-a76c-56fd10a52615`, named through `thread/name/set` as
   **Probe · Relay · Local task launcher**. This is diagnostic narrowing, not an
   acceptable automatic product fallback after a project-binding failure.
6. `thread/start` accepted `gpt-6-luna`, config
   `model_reasoning_effort = max`, `sandbox = read-only`, `approvalPolicy = never`,
   and `allowProviderModelFallback = false`. Its response and later `thread/read`
   reported the requested model/effort and exact owning checkout. The account's
   `model/list` included Luna/Max. No global configuration was edited.
7. The probe had no canonical project ID. Native `read_thread` could read it;
   after its first prompt it also appeared in native `list_threads`, with the
   correct title/cwd but `projectId: null` and status `notLoaded`.
8. The controller registered only the probe's Relay route to this director:
   manager `01a04b13-a1ef-7731-a63b-819b7f8cb150`, route
   `cf3a7cc5-7893-47bf-a2c0-c79aef6706dc`. Initial routes were empty.
9. `turn/start` explicitly requested Luna/Max. Turn
   `01a15ca5-aee8-7c20-81b6-057eca08f787` ran from `04:08:44` to `04:09:11`,
   completing in 26,838 ms. Its only command was `sleep 20` in the owning checkout.
   A `turn/steer` request with the exact expected turn ID was accepted during
   the turn. This qualifies steering through its own app-server connection only.
10. During that running turn, native `read_thread` reported `notLoaded` and its
    persisted turn as `interrupted`, while the originating app-server still
    reported it active. No interrupt had been sent. The originating connection
    subsequently emitted normal completion. The disagreement is observed; its
    internal cause was not established and must not be masked with a second
    execution owner or private Desktop interfaces.
11. The normal final was exactly:

    ```text
    Relay local-launch probe — 4d8a51ec-7677-4bac-a291-9068f1f95e9f, exact text, 雪.
    ```

12. Genuine `hook/started` and `hook/completed` events at `04:09:11` identified
    the installed trusted Relay Stop hook. It completed in 276 ms with no entries
    or errors. Neither the worker nor controller manually invoked a hook or
    forwarded the final.
13. A read-only `thread/queue/list` for the manager returned the exact final under
    `From: Probe · Relay · Local task launcher`, followed by a blank line.
    Queue item `01a15ca6-17ca-78d1-83ce-7f48ff005a2a` had client message ID
    `46bde35b-4b46-412c-803e-98d459eb2642`. This proves queue presence, not receipt.
14. The real incoming message subsequently appeared in this director's conversation
    with that exact sender title, token, Unicode, and final body. This separately
    establishes recipient receipt; it was not recovered by copying `read_thread`
    output or manually resending the final. It arrived while the controller was
    still handling the probe, so this result does not justify assuming delivery
    must always wait for an idle director on this App version.
15. `thread/unsubscribe` returned `unsubscribed`. After EOF, the diagnostic transport
    exited with code 0. Native `read_thread` then showed the task `notLoaded` and
    its sole turn completed, with the same final.
16. Native `set_thread_archived` returned `archived: true`; the exact ID appeared
    in native `list_archived_threads`. Installed Relay `unregister` removed only
    the diagnostic route, and `status` returned the original empty route set.
    No worktree, branch, replacement task, or daemon was created.

The protocol capture and generated schemas are local diagnostic artifacts under
`/tmp/relay-launch-probe.cqHzI2/`. They are not a new report store or packaged runtime.
This note records the relevant sanitized facts; private runtime/session files
were not edited or used as a control interface.

## Compatibility assessment

| Requirement | Current evidence |
| --- | --- |
| Explicit authorized model and effort | Accepted and reported as configured Luna/Max; backend execution telemetry unavailable. |
| Correct checkout and limited permissions | Exact cwd and read-only/network-disabled settings; command ran in that cwd. |
| Canonical Desktop project association | Failed for the Desktop-supplied project ID; diagnostic task has no project. |
| Desktop discoverability | Native list/read can find the persisted task after its first prompt. |
| Shared Desktop live status and control | Not qualified: simultaneous active/notLoaded views and conflicting turn status. |
| Owning app-server steering | Accepted with exact active turn ID. Desktop steering/interruption not tested. |
| Genuine trusted Stop hook | Observed normal hook start/completion and exact queued body. |
| Actual manager receipt | Exact genuine incoming report observed in the manager conversation. |
| Client release and native archival/route cleanup | Transport exited 0; task completed/unloaded, archived with native readback, and route removed. |

This is insufficient to add a Desktop worker launcher to Relay. A launcher would
need a defined execution owner, accepted project binding, meaningful Desktop
control, and an understood process lifetime. Adding a persistent runner or private
IPC discovery solely to bridge these gaps would materially expand Relay beyond
the authorized narrow implementation. No production launcher or skill fallback
should be shipped on this evidence.

The bounded cleanup is complete. Cancellation, mid-start process loss, duplicate
creation recovery, remote hosts, restart, and production work remain unqualified.
They need no new tests for a candidate rejected at this compatibility boundary.
Configured selectors are not a substitute for backend execution telemetry, and a
working Stop callback does not resolve the ownership/project failures. See the
[launch boundary decision](../decisions/0009-local-task-launch-boundary.md).
