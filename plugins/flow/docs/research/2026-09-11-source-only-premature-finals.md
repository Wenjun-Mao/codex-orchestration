# Source-only continuation: premature finals

Status: reported observation; root cause unconfirmed. Not part of the current
retained-obligation/write-scope correction plan.

Plotloom's director reports that its existing coordinator repeatedly ends a
turn with partial progress despite instructions to continue until the complete
correction package or a genuine external blocker. Reported examples include an
acknowledgment-only final, an adapter checkpoint, and Python/Playwright results
with frontend checks explicitly still outstanding. Director follow-ups resume
the work, adding coordination overhead.

Evidence boundary: this is a director report, not an independently inspected
set of turns. It occurred under the user-approved source-only exception, outside
normal Flow lifecycle execution. No hook-delivery failure or plugin runtime
cause is established. Do not classify it as a confirmed v0.9.12 defect.

Desired behavior: progress is commentary; terminal reporting identifies full
completion or the exact external blocker. An idle task alone does not prove
the assignment is finished. Existing authorization should not need repeated
renewal for remaining in-scope work.

Before changing prompts or machinery, inspect a representative actual dispatch,
final and remaining checklist. Distinguish ambiguous instructions, conflicting
stop rules, model behavior and host interruption. Keep this as a bounded later
review item; do not add a daemon, watchdog, new completion state, or another
instruction layer based solely on this report.
