---
name: deliver
description: Carry out a manager's work brief with Relay forwarding the final response.
---
# Deliver with Relay

Carry out the manager's brief, follow repository instructions, and run
relevant checks. Coordinate writes with your manager so you do not edit
at the same time. Relay forwards your final response; permission to
change source comes from the brief and applicable instructions.

## Register Before Starting

Your native identity is the host-provided `CODEX_THREAD_ID`. Use it and
the manager's real task ID from the brief to register your reporting
route before starting work:

```sh
node <plugin-root>/bin/relay.mjs register --repo <repo> --worker "$CODEX_THREAD_ID" --manager <manager-id>
```

Confirm success. Identical registration by your manager is harmless.
Do not wait for the manager to discover your ID in the task list.

If the manager ID is missing or registration fails, report the problem
directly to the manager when known; otherwise ask the user. Do not
invent an ID or assume hook delivery is established.

## Do the Work and Ask When Needed

Ask mid-work questions by direct native message to your manager, and
resume when answered. Do not invent a wait-for-reply protocol. If you
end a turn while paused, its final may also be forwarded, so describe
the situation truthfully.

Follow the brief's checks and acceptance requirements. Relay adds no
extra checks, Git baseline, contract or acceptance record. Use ignored
project-local scratch only when it is useful.

### Using Native Subagents

Native subagents are attended, read-only support. Collect their results
before ending your turn; Relay does not forward their completions.

Choose every subagent's model explicitly. Never rely on a default,
inherit the parent's model, or use a spawn mode that forces inheritance.
Set supported, authorized reasoning effort explicitly as well. If you
select GPT-6 Luna, use Max unless the user overrides it. Before spawning,
announce the purpose and requested model and effort.

If explicit model selection is unavailable or restricted, ask the user
directly for guidance on this settings decision. Use
`request_user_input_async`, or `request_user_input` where permitted; use
chat if neither is available. Wait before starting that work. Do not
silently substitute an inherited subagent or do the work yourself.
Explain whether the selector is missing or a native restriction prevents
its use; user guidance does not bypass native restrictions. Treat
effective settings as unverified unless the host confirms them.

Tell the manager which assigned work is waiting for that settings
decision. Continue independently useful assigned work where permitted;
keep the waiting work visible as unfinished. That progress does not
replace any evidence required for the agreed result.

## Report the Result and Leave Cleanup to the Manager

Finish with a concise account of what you accomplished, where the
changes and evidence are, which checks passed, and any failures, skips
or limitations. Full logs and a work transcript are unnecessary.

The registered Stop hook forwards this final unchanged, prefixed with
`From: <current task title>`. There is no fixed template, duplicate
completion message, `finish` command, report file or manual hook call.

The manager reviews the work, archives the task and removes the route.
Leave your route, checkout or worktree, and branch intact for final
reporting. Do not self-archive or remove them yourself. The manager
cleans up after receiving the final and confirming you are idle.
