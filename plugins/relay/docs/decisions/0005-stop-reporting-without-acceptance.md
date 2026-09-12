# 0005 — Communication does not require source acceptance

Accepted 2026-09-12. Supersedes 0004's suppression of unsealed Stop reports for
hook-queue assignments; legacy notification modes remain unchanged.

Plotloom's worker claimed finish succeeded after the command refused verification.
The assignment had no sealed result, so the hook suppressed communication. This
coupled manager visibility to successful source verification. The check also
discarded its failure detail when the transaction threw.

Capture each genuine unsealed worker Stop as an immutable per-turn message with
separate deterministic system status. Notify the recorded manager once, through
the existing bounded queue adapter, after committing capture and releasing the
lock. Read via `read-report --event-id`; no acknowledgement/acceptance machinery
is attached to these informational reports. Preserve the sealed-result path for
actual source review and retirement. Duplicate turn bytes cannot change or resend;
later genuine completion remains separately reportable.

Checks retain finite failure codes, check index, exit code, revision and changed
snapshot field names. Never put command output or arbitrary exception text in the
notification. A last verification result is historical evidence, not a new check.
Unknown status stays unknown; message prose never overrides it.

No LLM intent classifier, worker reporting turn, ownership transfer, implicit
acceptance, cleanup authorization, automatic retry or relaxation of Git checks.
Questions that end a turn may yield both their direct collaboration message and
an informational Stop notice; truthful bounded duplication is preferable to
silently hiding an unsuccessful attempt. Ordinary continued-hook events are ignored.

Tests cover failed checks and state mutations, misleading success text, unsealed
questions, duplicate turns, delayed old turns after sealing, later completion,
foreign readers, transport ambiguity and unchanged source authority.
