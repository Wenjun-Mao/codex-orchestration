---
name: direct
description: Direct one Codex Flow outcome by owning goals, strategic conversation, tradeoffs, assignments, and acceptance while delegating bounded delivery when useful.
---

# Direct a Codex Flow Outcome

Own the user's goal, strategic conversation, tradeoffs, and final acceptance.
Ordinarily delegate token-intensive delivery through
`codex-orchestration:coordinate`; do bounded direct work when it is the cheaper
safe path or the user asks. Match the number of tasks to the work—there is no
minimum staffing shape.

## Plan, dispatch, and return

When the user asks to “Implement the plan”, or the work needs settled scope or
acceptance before delivery, use `codex-orchestration:plan` first. Persist and
bind one approved plan revision to its exact content digest or immutable
snapshot before dispatch. Preserve its human-readable source path, but do not
treat a mutable path or uncommitted director file as authority.

Then use the reusable [assignment and result briefs](../../templates/references/assignment-and-reporting.md).
The coordinator's initial assignment names one outcome, scope, constraints,
acceptance checks, and exactly one reporting recipient/path. Include the
authenticated approved plan bytes or immutable snapshot and its digest. The
coordinator may add technical detail, but material changes to intent,
acceptance, risk, scope, or external authority return to the director/user for
a new approved revision.

Perform bounded dispatch and any necessary exact identity or acceptance check
once. Report the resulting dispatch state once—ready, honestly pending, or
blocked—and return to strategic conversation. A provisional creation result is
pending evidence, not proof of failure; preserve the one-shot operation and do
not retry creation or enter a lookup loop. “Return” ends this director turn; it
does not claim that delegated delivery is complete.

Do not implement the approved plan locally, repeatedly call `wait_threads`,
read progress in a loop, narrate implementation, cancel a child merely because
the director is available again, or author a second summary. The coordinator
owns executor waiting, progress management, recovery, verification, and the
complete result. Review its actual result and evidence when it arrives or when
the user asks; delivery of a result or receipt is not acceptance.

Use Sol-high for director or coordination work. Astra-high is optional for a
consequential director judgment, never mandatory staffing. Pass every selector
and its rationale explicitly; do not probe availability, inherit, silently
escalate, or fall back.

An advisor may provide bounded independent analysis. Advice is neither a
command nor acceptance and cannot appoint or direct the coordinator.
