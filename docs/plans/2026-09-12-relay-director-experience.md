# Relay — available director and cheap clean start

Status: Approved for notification feasibility and bounded implementation by the
user's 2026-09-12 kickoff. Notification transport remains a feasibility gate, not
a promised capability. Current installed Relay and Plotloom are excluded from edits.

Update: the user subsequently authorized managed installation and two disposable
native test tasks. The bounded idle-wakeup/review/archive gate passed; successor
preparation passed without launching another task. See the
[native qualification record](../field-tests/2026-09-12-relay-0.2.0-native-wakeup.md).
Stable promotion changes metadata/documentation only, preserving tested runtime
bytes. A useful product delivery remains the next adoption observation, not a
claim made from the no-change canary. Plotloom source/state stay out of scope.

## Outcome

One connected experience: prepare a useful assignment, dispatch, return the
director to the user, notify completion through a supported host mechanism, read
the frozen report, review/accept or reject, archive exact finished tasks, and admit
the next assignment. No unattended subagents or director wait loop as the default.

## Scope and decisions

- Add one lean `relay:direct` entrypoint, using current public assignment commands.
  Explicit model/effort choices; optional cheaper sequential executors. Attended
  read-only subagents must finish before their owner returns idle.
- Notification is advisory, never receipt or acceptance. Preserve existing genuine
  capture, exact-recipient read/ack, semantic review and task-only normal retirement.
- Resolve host feasibility first. Prefer one bounded native notification over a
  daemon, private IPC, another agent layer, or polling architecture. Do not advertise
  idle-director resumption until observed. Supported Stop continuation is a candidate
  to inspect, not approval to create an unbounded reporting loop.
- Cheap unplug is a separate user-directed operator reset, not ordinary completion:
  stop writers, merge wanted verified work into main, archive exact finished
  executors then coordinators through the native App tool, remove obsolete clean merged
  local branches/worktrees, delete exact obsolete plugin state, then start fresh.
  No Flow-era audit/acceptance, mandatory backup or journal repair. Retain source,
  director task, main/current checkout, active/unrelated tasks, wanted work and
  existing backups. Identify finished task targets before registry disposal; do
  not replay already completed archival or repair old journals for it. Verify actual
  Git/filesystem boundaries. Extend to Relay state only with explicit reset intent;
  never confuse pending protocol status with lost product work.
- Keep scope bounded: no concurrent/cross-host delivery, Flow rewrite, framework,
  dashboard, automatic broad sweep, or remote branch deletion by default.

## Checkpoints and acceptance

1. Feasibility: official host docs + current tools/source, concrete causal sequence
   and failure handling. If no supported route fits, stop/replan rather than build
   an imitation wakeup service. Record the chosen contract concisely.
2. Source: direct skill and smallest notification addition; exact identity,
   duplicate/late notification, missing capture, busy recipient, interruption and
   archive ordering tests. Add cheap-unplug guidance with dirty/unmerged/active
   writer and wrong-target refusal examples. No new generic lifecycle state layer.
3. Disposable native journey: director genuinely idle at completion, notified once,
   frozen report read/acknowledged and reviewed, child-first task cleanup completed,
   successor admitted. Separate live facts from injected fixtures. No Plotloom probe.
4. Review exact diff and relevant tests, then package/relocated checks; candidate
   install only at a safe explicitly coordinated boundary. No installed-cache edits
   or live plugin replacement while Plotloom relies on the current version.

## Execution authority and escalation

### Feasibility checkpoint (2026-09-12)

Attended Terra-high read-only review completed and collected. Official Stop hooks
support `decision:block` continuation; the App tool exposes sending to an exact
task. Candidate: freeze the genuine report first, issue a single persisted advisory
action to the sender's continuation, then notify the frozen recipient to read its
report. Hook code must not call native tools itself. Do not reuse legacy `submit`,
which embeds full report bytes and receipt instructions. Continued Stop must not
recapture the final or create another notification loop. Crash/ambiguous sends must
not blindly retry or count as receipt. Recipient archival needs a fresh exact
sender-idle observation, since the notification may arrive before the sender stops.

This is source-level feasibility, not live-host qualification or authorization to
weaken capture/receipt contracts. Test this bounded path before widening the skill
surface or introducing any transport fallback. The current installed behavior is
unchanged. The review does not justify claims of guaranteed notification on crash.

Director owns scope, notification decision and acceptance. Start with an attended
bounded read-only feasibility review while recording this plan; no Flow activation
for developing Relay. Source implementation can proceed under the approved
source-only development pattern once the host route is settled. Do not silently
create visible tasks when host instructions do not authorize that operation.

Pause for unsupported host capability, a new transport/service or expanded trust,
unpreserved product work, ambiguous destructive targets, or required restart.
Otherwise continue within this slice without per-step confirmation. Version and
release claims follow actual qualification, not the existence of a director skill.

References: [personal adoption](../adr/0075-personal-flow-to-relay-adoption.md),
[existing native contract](../../plugins/relay/docs/decisions/0002-native-adapter.md),
[official hooks](https://learn.chatgpt.com/docs/hooks).
