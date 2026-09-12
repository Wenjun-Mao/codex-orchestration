# 0003 — One advisory after genuine capture

Source candidate, 2026-09-12. Native qualification pending; installed 0.1.0 remains
unchanged. This amends 0002's capture-only hook policy for newly prepared assignments.

## Problem and decision

The old Stop hook saved the result but did not notify an idle recipient. Directors
waited through implementation to finish acceptance and cleanup. Existing `submit`
is a compatibility receipt protocol, not an advisory; it is not reused here.

For new assignments, capture persists exact final bytes and one advisory attempt in
the same transaction. The hook returns the documented Stop continuation decision
once. The same sender invokes the generated native send action to the frozen
recipient; no hook-side IPC, server, background worker or sender impersonation.
The continuation has no source permission and ends after observing the send result.
It never forwards untrusted product text. Continued Stop records the notification
ending, not another product final or continuation.

The recipient uses the existing shared-storage read/ack and semantic decision.
Notification success is not receipt; missing notification is not missing result.
After child retirement duties, archival for an advisory sender requires a fresh
exact sender-idle native observation. That observation prepares the archive in
the same transition rather than granting a reusable idle permission. The caller
must invoke the generated action promptly; external reactivation cannot be locked
by Relay. Native observations remain a cooperative adapter boundary.
Generated archive listing is host-scoped. Explicit wrong-host send/archive results
are refused; omitted host echoes remain compatible with the App's existing response
shape and rely on the exact generated tool request, not invented host evidence.

## Failure boundaries

Duplicate original Stop events cannot reissue the advisory. A crash after persistence
but before returning/sending may lose the wake-up; never blindly resend an uncertain
action. Public report retrieval and sender-idle observation still allow manual
follow-through without rewriting history. No claim of guaranteed unattended recovery.
Old assignments without notificationMode stay capture-only; no historical import.

Reject private messaging queues, recurring polling by default, pre-capture messages
that race report availability, and full result forwarding as a receipt shortcut.
Tests cover frozen bytes, exact target, duplicate/continued Stop, failed or lost
send, recipient identity, active/wrong-host sender observations, legacy records
and successor admission. Genuine idle-director wakeup/archival is a separate live gate.

Host reference: [official Stop hook contract](https://learn.chatgpt.com/docs/hooks).
