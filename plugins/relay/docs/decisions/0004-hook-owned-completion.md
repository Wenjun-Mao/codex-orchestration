# 0004 — Direct collaboration, hook-owned completion

Accepted; RC1's connected native lifecycle qualified as a recovered journey.
Supersedes 0003's worker continuation only for newly prepared assignments. Existing
assignment modes remain frozen. Installed 0.2.1 is unchanged until release.

## Why

0003 solved manager wakeup but required another worker model turn to perform
reporting. Automatic completion depended on the worker again. The missing
abstraction was a hook-owned transport, not another source lifecycle or receipt engine.

## Decision

Direct messages handle collaboration. Only a sealed result and genuine Stop event
authorize automatic completion capture. Capture and a unique attempt are committed
together; external notification happens outside the lock. A fresh transaction records
the outcome without overwriting concurrent recipient review.

Use one bounded queue-only subprocess calling the App's experimental
`thread/queue/add`. It never resumes a task, starts a turn, archives, or writes host
storage directly. A disposable process-to-idle-task probe qualified App CLI
`0.154.0-alpha.6.2`; other versions fail without sending until requalified. This
revises 0002's blanket rejection of a second client: a queue-only client does not
become a second task execution owner. No Flow runtime engine is imported.

The user accepted experimental transport testing on 2026-09-12. The direct proxy
route had no listener in the running Desktop. A daemon, polling service, private
session writer, and another worker continuation were rejected.

## Boundaries and consequences

- Exact frozen manager/host only; availability hint, never acceptance. Shared
  read/ack/review remains separate.
- One attempt, no retry even after a crash or uncertain queue response. Reports
  remain readable; delivery is not guaranteed or exactly-once.
- Fresh sender-idle and child-first duties still precede archive. Notification does
  not establish idle; manager review may race a still-finishing hook.
- Old continuation assignments remain supported; new assignments cannot manually
  submit a second completion notification through Relay.
- Mid-work questions must not seal completion. A direct reply is real input, while
  `wait_threads` is not a generic answer mailbox. No polling workaround is added.
- Version drift, subprocess errors, timeout and bounded-output failure remain
  visible as uncertainty. Installed runtime changes only at a quiescent boundary.

Regressions cover capture/send ordering, duplicates/crashes, manager review races,
exact routing, continued/unsealed Stops, old-mode compatibility and retirement.
Release still requires genuine Stop → queue → manager review and useful successor
delivery, including collaboration. Transport-only success is insufficient.

Generated worker briefs name `relay:deliver` at their own package-relative resolved
path for both roles. The RC1 executor selected Flow's similarly named executor
workflow when the brief omitted that reference. Bind routing at generation rather
than relying on callers to remember a separate skill hint. The generated startup
command remains unchanged and must be passed verbatim, not reconstructed.
