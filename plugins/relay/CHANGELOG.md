# 0.4.0

- Rename `relay:plan` to `relay:brainstorm-and-plan`, with explicit intent-to-plan stages
  and native question UI preference; no duplicate legacy skill.
- Replace lifecycle controller with register/unregister/status routing.
- Preserve exact Stop forwarding, sender attribution and bounded native transport.
- Remove source contracts, verification, acceptance, baseline and retirement commands.
- Legacy state requires explicit quiet-checkpoint retirement; no automatic migration.

# Changelog

## 0.3.5

- Keep report forwarding working across compatible App updates; validate actual
  handshake and exact queue responses instead of pinning a CLI release number.
- Preserve account checks, bounded execution, unchanged message bodies and no retries.

## 0.3.4

- Dispose explicitly never-invoked revoked creations without fake archival or null native targets.
- Adopt explicit clean same-branch forward baselines while idle, preserving cleanup duties.
- Default scratch requests/results to project-local Git-ignored `.local/relay/`.

## 0.3.3

- Prefix forwarded finals with `From: <current task title>` and a blank line;
  leave the report body unchanged. Use the task ID if its title is unavailable.
- Read title metadata through the existing native connection; no report storage.

## 0.3.2

- Send worker final text unchanged from the Stop hook, without report persistence,
  status decorations, retrieval/acknowledgement commands, or worker continuations.
- Keep product verification and task retirement independent of message delivery.
- Remove the old report/receipt implementation and its superseded tests.
- Require workers to await the actual finish result before describing it.


## 0.3.1 — Stop reporting independent of acceptance

- Notify the manager of unsealed worker Stops with exact text and separate system
  status, without granting source release, acceptance or cleanup.
- Persist finite verification failure details; identify changed snapshot fields
  without leaking command output. No LLM classification or reporting continuation.
- One attempt per distinct unsealed turn; later sealed completion remains separate.
- Role-prefixed task naming is not changed by this reporting correction.

## 0.3.0 — Hook-owned completion

- New assignments use one direct hook-owned queue notification, without a worker
  continuation. Existing assignment modes retain their original behavior.
- Capture precedes notification outside the storage lock; ambiguous sends never
  retry. Fresh idle observation, shared receipt and child-first acceptance remain.
- Keep direct messages for mid-work collaboration. Add bounded queue transport
  and regression coverage for failure, duplicate and manager-review races.
- Experimental transport qualified on App CLI 0.154.0-alpha.6.2. A recovered native
  coordinator/executor journey completed question/reply, hook-owned reports,
  explicit review, child-first retirement and useful successor delivery.
- Generated coordinator/executor briefs explicitly select their own package's
  Relay delivery skill. Preserve generated commands verbatim.

## 0.2.1 — Planning entrypoint

- Add `relay:plan`, adapted from Flow's concise planning guidance, with Relay's
  actual plan-reference semantics and handoff to `relay:direct`.
- Planning remains document-only and does not authorize implementation. No runtime,
  hook, reporting, ownership or cleanup behavior changed.

## 0.2.0 — Available director and cheap unplug

- Add a lean director entrypoint and user-directed cheap unplug guidance, including
  finished-task archival and preserved-work branch/worktree cleanup.
- New assignments can issue one native advisory through a post-capture Stop
  continuation. Advisory is not receipt or acceptance; uncertain sends never retry.
- Require fresh sender-idle observation before advisory-sender archival. Existing
  assignments without notification mode retain capture-only behavior.
- A real same-host idle director was awakened, read/acknowledged and accepted the
  captured result, then archived the worker after a fresh idle observation.
  Post-retirement successor preparation passed; no new successor worker was run.
  Guaranteed crash recovery is not claimed.

## 0.1.0 — Same-host serial source coordination

- Independent Relay package and generated public serial workflow.
- Atomic current source permission, direct verification transfer and explicit
  recovery.
- Frozen reporting with exact receipt/decision and task-only archival observations.
- Coordinator retirement preserves the recipient until every sequential child's
  report and archival are complete.
- Purpose-built App result normalization, exact Stop capture, optional wait
  notification, and affirmative archive observation.
- Read-only hook discovery leaves fresh, unrelated, and Flow-only repositories
  unmodified.
- Native receipt normalization requires an exact same-turn `final_answer` message
  object.
- Exact recipients can read and explicitly acknowledge frozen reports through shared
  storage; native wait is optional notification.
- Generated startup uses the host's `CODEX_THREAD_ID`, refuses missing or conflicting
  identity, and needs no actor lookup or broad README read.
- Disposable Git/CLI, crash, scope/drift, reporting and packed isolation tests.
- Native same-host journeys qualify normal three-call startup, ready-ID early binding,
  failed-check recovery, genuine Stop capture, shared receipt, separate acceptance,
  task-only retirement, and one restart-free candidate transition.
- A README-only product pilot and retained-project no-change successor passed their
  existing tests and full Relay report/retirement lifecycle; existing
  separate-repository Flow reports remained available after Relay installation.
- The conservative startup proxy is 6,106 tokens, 106 above the provisional target;
  provisional native-ID output, Flow coexistence stress/same-repository coverage,
  and broader release remain open.
