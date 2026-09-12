# Relay — hook-owned completion reporting

Status: Draft. The user agreed to the architectural direction; this implementation
plan awaits approval. Planning only: no dispatch, runtime change or installation.

## Outcome

A coordinator or executor finishes normally. Its Stop hook freezes the final and
directly notifies the assignment's exact manager, without another worker model
turn or a reminder to report. The manager reads the frozen report, reviews it,
records acceptance/rejection and completes child-first retirement.

The hook is the primary automatic path, not a second sender trying to determine
whether the worker forgot. Explicit human/agent discussion remains possible but
does not substitute for receipt or trigger another automatic completion send.
The accepted boundary is [ADR 0076](../adr/0076-relay-collaboration-and-completion.md):
direct messages for collaboration; hook-owned reporting for completion.

## Diagnosis and scope

Relay 0.2.1 captures the final in `lib/final-hook.mjs`, but `lib/notification.mjs`
returns `decision: block` so the same worker calls the App messaging tool. The
native test proved wakeup works, not that reporting is independent of the worker.
The mismatch originates at the transport boundary, not final storage or review.

Flow's `lib/codex-app-report-adapter.mjs` opens a subprocess connection with
experimental capabilities and calls `thread/queue/add`. Its existence is useful
prior evidence, not proof that this mechanism is currently supported or suitable
for Relay. Assess a small independent adapter; do not import Flow lifecycle,
registries, versioned runtimes, or its entire transport implementation.

In scope: same-host direct hook transport, capture/send ordering, failure visibility,
duplicate protection, manager routing, lean instruction cleanup, and connected tests.
Out of scope: daemon, polling service, generic event bus, cross-host delivery,
guaranteed exactly-once delivery, Flow fixes, or changes to product repositories.
Keep installed 0.2.1 working until a replacement is qualified.

## Decisions and invariants

- Preserve existing exact sender/assignment/result association, final bytes and
  shared-storage read/acknowledge semantics. Notification is never acceptance.
- Persist capture and the one send-attempt identity before external side effects.
  Release the state lock before contacting the host; the awakened manager must be
  able to read. Record the outcome in a short subsequent transition.
- Notify only the recorded recipient and host: executor to coordinator,
  coordinator to director. No guessed recipient, global broadcast or report-text
  instruction following. Prefer a small availability notice with exact report
  reference, not a second independently authoritative copy of the final.
- Bound subprocess lifetime, output and cleanup. A hook timeout, unavailable
  transport or ambiguous response must preserve the report and expose a concise
  diagnostic plus persisted status when possible. No worker continuation as a
  hidden fallback, no false queued status and no blind resend.
- Duplicate Stop events do not cause duplicate sends. A crash between capture and
  send can lose the wakeup; disclose this and retain manual retrieval. Add retries
  only if the selected host API proves idempotency and the plan is revised.
- Do not infer sender idle from a successful send: the hook may still be running.
  Preserve fresh native idle observation and child-retirement duties before archive.
- An early stop without a sealed result remains distinct from completion. Do not
  fabricate successful reporting or expand this slice into automatic failure
  recovery. Document that case and any needed future blocked-work notification.
- Freeze the mode for each assignment. Existing continuation-mode assignments may
  complete through their original path; new ones use the qualified hook path.
  Never emit both modes for one result. Keep compatibility limited to records that
  need it, rather than adding a permanent transport-selection framework.

## Checkpoints and acceptance

1. **Transport feasibility before implementation.** Check current official host
   documentation and the installed host interface. Identify a concrete callable
   hook-to-host route, permissions, queue semantics, deduplication guarantees and
   process ownership. Perform one bounded disposable hook-process-to-idle-task
   probe once exact targets are authorized. A shell fixture or successful queue
   response alone is not proof of wakeup. If only private/experimental behavior is
   available, present its exact dependency and maintenance risk for approval before
   adopting it; do not quietly reverse the previous no-private-transport boundary.
2. **Small implementation.** Use one isolated adapter and existing report records.
   Replace new-assignment continuation instructions, preserve retrieval and review,
   and amend decision 0003 with the chosen transport and rejected alternatives.
   Remove redundant completion-send instructions from worker briefs/skills. Keep
   truthful final-response and direct mid-work question/blocker guidance. Verify
   the supported answer/resume mechanism; do not prescribe a completion-wait tool
   as a generic message mailbox.
   No source ownership, integration or unplug redesign.
3. **Focused regression and package checks.** Exercise genuine event parsing,
   capture-before-send, concurrent duplicate events, wrong recipient/host,
   unavailable/timeout/ambiguous transport, crash windows, continued events,
   old-mode compatibility, early unsealed stop and manager-read races. Verify no
   blocking feedback or worker send action is returned for the new mode. Run the
   existing connected suite and relocated package tests; separate fixtures from
   actual host evidence.
4. **Connected native acceptance.** In a disposable retained checkout, observe
   executor → coordinator and coordinator → idle director. Workers contain no
   manual reporting instructions and receive no reporting continuation. Verify
   frozen exact reports, one send attempt per final, genuine manager wakeup,
   explicit read/ack/review, sender-idle-gated archival, and a useful successor.
   Record task/turn identities and any setup intervention; do not relabel a repaired
   sequence as uninterrupted success. Keep useful work tiny and reuse the test
   project, not a new project per attempt.
   Include question → manager answer → worker resume → finish in the journey:
   an intermediate stop must not emit a completion notice or trigger cleanup.
5. **Release and cleanup.** Review the exact diff, package and install only at a
   quiescent boundary; archive finished test tasks and remove disposable merged
   resources. Do not replace the runtime controlling an active self-hosted run.
   Update known-issue status only to the level actually demonstrated.

## Execution authority and escalation

The director owns transport choice, scope, approval and result acceptance. After
approval, use `relay:direct` with this plan for a bounded assignment; do not create
another nested director layer. Explicit task creation must meet host authorization
rules. Optional independent review is attended; no unattended subagents.

Continue ordinary scoped work without per-step confirmation. Stop for an unproven
host route, private/experimental dependency needing acceptance, broader permissions,
conflicting active runtime use, lost/unpreserved work, or a required App restart.
If feasibility fails, preserve the working 0.2.1 behavior and report the concrete
tradeoff instead of implementing a differently named worker continuation.

References: [current decision](../../plugins/relay/docs/decisions/0003-director-notification.md),
[prior live qualification](../field-tests/2026-09-12-relay-0.2.0-native-wakeup.md),
[director-experience plan](2026-09-12-relay-director-experience.md).
