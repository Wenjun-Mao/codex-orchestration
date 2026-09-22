---
name: deliver
description: Carry out a manager's work brief with Relay forwarding the final response.
---
# Deliver with Relay

Follow the work brief and repository instructions. Relay is messaging, not source
authorization: coordinate serial writes with your manager, implement the work, and
run relevant checks. Your native identity is the host-provided `CODEX_THREAD_ID`.

Ask mid-work questions by direct native message to your manager. Resume work when
answered; do not invent a wait-for-reply protocol. If you end a turn while paused,
its final may be forwarded too: describe the situation truthfully.

When finished, state the outcome, verification, and remaining limitations in your
normal final response. Do not send a duplicate completion message, call `finish`,
save a report file, or invoke the hook manually. A registered Stop hook forwards
your actual final unchanged, preceded only by `From: <current task title>`.

The manager reviews work and handles native archival and route removal. Do not
self-archive, remove your route, or delete your own task checkout/worktree or its branch.
Leave them intact for final reporting; the manager cleans up after receiving the
final and confirming you are idle. Relay imposes no checks, Git baseline, contract,
or acceptance record. Use ignored project-local scratch only when actually needed.
Native subagents are attended read-only support: collect their results before ending.
