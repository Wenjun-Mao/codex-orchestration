# Relay 0.4 — Reporting-only replacement

Status: Source implementation and package verification complete; native delivery and quiet-checkpoint installation remain pending.

## Outcome and boundaries

Relay registers who reports to whom and forwards a registered worker's actual
Stop final. It does not control source work or certify completion. Replace the
existing controller rather than maintaining a second lite mode. Director and
coordinator are both managers when supervising another task.

Preserve `From: <current task title>`, a blank line, and the unchanged final body.
Keep deterministic forwarding without LLM calls, report-body storage, extra
status decorations, receipt protocols, automatic retries or worker continuations.
Same-host Git projects remain the supported boundary; no remote transport expansion.

## Minimal interface and registry

- CLI: `register --repo PATH --worker TASK --manager TASK`,
  `unregister --repo PATH --worker TASK --manager TASK`, and `status --repo PATH`.
- Store one versioned JSON routing file at `<git-common-dir>/relay/routes.json`,
  mapping exact real worker IDs to manager IDs and a stable route UUID. Local host
  is implicit. Do not store model, scope, checks, Git baseline or task titles.
- Validate real task IDs and reject self-routing. Identical registration is a
  no-op. A conflicting manager fails; changing it requires explicit unregister
  then register. Unregister checks the expected manager; an absent route is a no-op.
- Reuse a minimal atomic-write/short-lock mechanism for registry mutations. Hook
  reads do not write or lock. Retain explicit stale-lock recovery only if needed
  by that reused mechanism; no automatic stale-lock deletion.
- A Stop reads the worker route and uses the existing transport/title lookup.
  Derive the native message ID from route UUID, worker and turn ID. Preserve exact
  queue-response validation, time/output limits and no retry after uncertain send.
- Missing registry/route is a quiet no-op; malformed state or transport failures
  produce concise diagnostics, not fabricated success or a notification loop.
- A Stop is a message, not a claim of successful completion. Unsealed/failed work
  can report normally. Managers interpret its contents.

## Workflow and removal

- Manager chooses model/reasoning at native task creation, not in the worker brief
  or registry. Brief contains actual work, constraints and expected checks.
- Register after the native task has a real ID; resolve provisional creation to
  the same task, never create a replacement simply to obtain an ID. Manager checks
  registration before returning idle. If a worker finished before registration,
  read its existing final directly; do not synthesize a Stop or claim hook delivery.
- Mid-work collaboration uses direct messages. Final reporting uses the hook.
  No claim that waiting for chats prevents all Stop events.
- Workers run appropriate tests and summarize results. Managers review and rerun
  checks selectively. Serial edits and source safety are agent responsibilities,
  not permissions granted by Relay. Working on main is a default, not a guarantee
  against concurrent edits.
- Managers archive finished actual tasks through native tools after reviewing
  results, then unregister their routes. Resolve uncertain archival by observation,
  not blind retries. Preserve the director; finish child duties before retiring
  a coordinator as ordinary workflow guidance, not a Relay state machine.
- Remove prepare/start/handoff/finish/verify/accept/reject/recover/adopt/dispose
  commands, assignments, permissions, verification engine, immutable fact storage
  and lifecycle archival gates. Old commands give a concise unsupported-version
  error, not an automatic state conversion.
- Rewrite direct/deliver skills around this small workflow and make plan skill
  independent of assignments. Keep project-local ignored scratch only where a
  native operation actually needs a file; no compulsory scratch artifacts.
- Update README, hook description, runtime manifest, tests and decision records.
  Mark superseded decisions as historical; do not misrepresent their old behavior.

## Transition and execution

Implement/test/package separately from the installed 0.3.5. Do not replace the
personal marketplace source while active tasks depend on its installed runtime.
No Plotloom source, worktrees, branches or registry changes during development.

Before installing 0.4, confirm affected Relay tasks are stopped and wanted work is
preserved. Finish/archive real old tasks as appropriate, then use the approved
project-scoped cheap unplug to discard obsolete Relay control/fact state. Do not
claim discarded history completed normally. Never delete `.git`, Flow state or
unrelated project data. A legacy control file causes 0.4 registration to refuse
with transition guidance; there is no silent import, reset or dual runtime.

Resume with fresh routing registrations. No automatic home-directory cleanup or
mass migration. Escalate conflicting writers, uncertain native creation/archive,
unpreserved work or an inability to establish a quiet install boundary.

Implementation may proceed only after this plan is approved. Use permitted
delegation tools without inventing extra manager layers or native tasks. Keep any
subagent work attended and bounded. Release target is 0.4.0.

## Acceptance

- Unit/CLI: exact registration, no-op replay, conflicting manager, expected-manager
  unregister, self-route rejection, malformed state, atomic updates and lock
  contention. Reads do not initialize state; legacy state is not changed.
- Hook/transport: director-coordinator and coordinator-executor routing, exact
  Unicode/newline body and title attribution, ID fallback, unregistered workers,
  repeated-turn deterministic IDs, failures, compatible App versions and no retries.
- Verify forwarding is independent of Git cleanliness, branch, source check results
  and all old lifecycle records. No report-body files are written.
- Relocated package: only routing/runtime dependencies; no imports of the old
  controller or Flow. Check skill guidance does not require removed commands.
- One isolated native sender-to-manager demonstration with recipient-visible
  exact text; distinguish transport proof from a genuine Stop-hook test. Do not
  create production work just for qualification.
- Run full new Relay suite, packaging and plugin/skill validation. Report elapsed
  time, removed runtime LOC and instruction-size changes; token savings remain an
  estimate unless measured in comparable tasks.

Success: a manager can register a real task, receive its final, review/archive it
and remove the route without any source-control contract or recovery ceremony.
