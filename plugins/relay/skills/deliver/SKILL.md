---
name: deliver
description: Carry out a manager's work brief with Relay forwarding the final response.
---
# Deliver with Relay

Follow the work brief and repository instructions. Relay is messaging, not source
authorization: coordinate serial writes with your manager, implement the work, and
run relevant checks. Your native identity is the host-provided `CODEX_THREAD_ID`.

Before starting work, register your reporting route using your own native ID and
the manager's real task ID supplied in the brief:
`node <plugin-root>/bin/relay.mjs register --repo <repo> --worker "$CODEX_THREAD_ID" --manager <manager-id>`.
Confirm success; identical registration by your manager is harmless. Do not wait
for the manager to discover your ID through the task list. If the manager ID is
missing or registration fails, report that directly to the manager when known
(otherwise ask the user); do not assume hook delivery is established or invent an ID.

Ask mid-work questions by direct native message to your manager. Resume work when
answered; do not invent a wait-for-reply protocol. If you end a turn while paused,
its final may be forwarded too: describe the situation truthfully.

When finished, make your normal final useful for review: summarize the outcome and
relevant changes, point to commits/files when applicable, identify checks run and
their results, and disclose failures, skipped checks, and remaining limitations.
Prefer concise evidence pointers and relevant error excerpts over raw logs or a
transcript of your work. No fixed template or extra report artifact is required.
Do not send a duplicate completion message, call `finish`,
save a report file, or invoke the hook manually. A registered Stop hook forwards
your actual final unchanged, preceded only by `From: <current task title>`.

The manager reviews work and handles native archival and route removal. Do not
self-archive, remove your route, or delete your own task checkout/worktree or its branch.
Leave them intact for final reporting; the manager cleans up after receiving the
final and confirming you are idle. Relay imposes no checks, Git baseline, contract,
or acceptance record. Use ignored project-local scratch only when actually needed.
Native subagents are attended read-only support: collect their results before ending.
