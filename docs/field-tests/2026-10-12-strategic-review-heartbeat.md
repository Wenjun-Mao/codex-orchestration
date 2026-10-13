# Native heartbeat timing for strategic review

Test date: October 12, 2026, America/Toronto; October 13 UTC.
Status: bounded native probe complete; temporary reminders removed and probe chat
archived. No Relay runtime or installed skill changes.

Idle reminders worked, but no reminder became visible during the continuously
executing busy-turn or Goal cases. Work checkpoints must remain the primary review
opportunities; this heartbeat is a catch-up mechanism, not a guaranteed active-work
alarm.

## Question and scope

Can a temporary native same-chat heartbeat supply the elapsed-time reminder in
the [strategic review design](../plans/2026-10-12-planning-grilling-and-strategic-review-notes.md)
without interrupting ongoing work? The probe distinguishes receipt while idle,
receipt during an active turn, and receipt during an active native Goal. A separate
instruction-level check exercised skipping a redundant review after a recent
checkpoint; it cannot qualify a strategic-review skill that does not yet exist.

One disposable local chat used the retained checkout read-only, with requested
GPT-6 Luna / Max. It created no Relay route, worker tree, worktree, provider request,
or product change. The human separately approved creation of the temporary Goal.
No other project's tasks were used.

Environment: ChatGPT App `26.1007.30912`, build `20156`; bundled CLI
`0.162.0-alpha.17.2`.
Probe chat: **Probe · Strategic review · Native heartbeat**,
`01a1334d-eae6-7bf1-acf5-deef3ac767f0`, host `local`.

## Observations

All times below are UTC on October 13. Receipt means an actual native heartbeat
input appeared in the target chat and the target processed its unique marker;
automation creation or a worker's unsupported assertion alone is not receipt.

| Case | Observed behavior | Supported conclusion |
| --- | --- | --- |
| Idle chat | Reminder created at 03:29:16. Native heartbeat inputs began turns at 03:30:32 and 03:32:02, both completing normally with the expected marker. | Idle delivery worked. A nominal one-minute schedule did not yield exact one-minute execution spacing. |
| Busy chat | Reminder created at 03:34:05. The original turn stayed active from 03:34:05 to 03:37:17 and completed normally, reporting no heartbeat visible during it. The heartbeat input began a separate turn at 03:38:02 and completed at 03:38:04. | No interruption was observed. Receipt occurred only after the original turn completed; this does not distinguish internal skipping, deferral, or queueing. |
| Active Goal | Native Goal created and read back active at 03:38:46. First turn completed at 03:39:43; an automatic continuation began that second and read the Goal back active at 03:39:48. Goal marked complete and read back at 03:41:57; continuation completed at 03:42:03. No heartbeat was visible in either active-Goal turn. A heartbeat then began its own turn at 03:43:02 and completed at 03:43:08. | A completed turn did not pause the Goal. The heartbeat did not supply a review prompt during this continuously executing Goal interval; receipt occurred only afterward. |
| Recent review checkpoint | A substantive evidence/decision/next-action review recorded its checkpoint at 03:44:54 and completed at 03:45:08. A native heartbeat began a turn at 03:47:02. At 03:47:05 the target identified the checkpoint as 2m11s old, found no material change in its context, and skipped repeated analysis; the turn completed at 03:47:08. | The recent-review skip branch worked once with an actual delivered reminder. This is prompt-level behavior, not deterministic suppression or qualification of an installed skill. |

The busy workload was a roughly three-minute sequence of bounded sleeps and UTC
checks, not a production operation. No controller message, navigation, or explicit
turn interruption was used to make its scheduled reminder arrive.

## Trace references

| Evidence | Identifier |
| --- | --- |
| Initial idle baseline | Turn `01a1334d-ec8a-74f2-89fb-c5d628e9c69b` |
| First idle heartbeat | Turn `01a1334f-d3ed-7643-ad1a-8f5917dfd094` |
| Second idle heartbeat | Turn `01a13351-3380-7182-812a-886d048f93af` |
| Busy interval | Turn `01a13353-1449-7063-9005-4499277781d7` |
| Heartbeat after busy interval | Turn `01a13356-b1cb-70c1-9fc2-a43cb12a0977` |
| Goal creation and initial checkpoint | Turn `01a13357-4982-72c0-9c9f-f2b42ef3fe01` |
| Automatic Goal continuation and completion | Turn `01a13358-3f9a-7b43-87ad-41dba48098d9` |
| Heartbeat after Goal completion | Turn `01a1335b-45b5-7913-856f-9f564fe49864` |
| Substantive review checkpoint | Turn `01a1335c-0244-72f0-9051-c4056eea8d35` |
| Delivered reminder skipping repeated review | Turn `01a1335e-ef5c-79d2-af81-144acaf09462` |

Native chat history and the matching local session record retain the original
messages, Goal tool results, and turn timestamps. The document is a compact
evidence index, not a replacement report store.

## Design implications

- Check elapsed time and material evidence at safe work boundaries and resumptions,
  before another substantial work segment. The desired two-to-three-hour cadence
  may be late until the next safe boundary; this probe does not make it a hard timer.
- Use a native heartbeat only as an additional catch-up prompt. Do not add a Relay
  scheduler, force final responses, or interrupt unsafe work to make a reminder run.
- When a reminder arrives, recheck current run status, user instructions, and the
  latest review checkpoint. Ignore a stale prompt after completion or pause, and
  skip a redundant review if nothing material changed. Deleting a schedule was
  verified here; cancellation of any already-in-flight reminder was not.
- Review quality and evidence-based redirection remain instruction-level work.
  Neither a delivered marker nor a skipped duplicate establishes good strategic
  judgment across real projects.

## Cleanup and limits

Temporary reminders were managed only through native automation tools. All four
delete calls returned `deleteStatus: deleted`, and all four exact configuration
paths were subsequently verified absent:

- `temp-strategic-review-probe-idle`
- `temp-strategic-review-probe-busy`
- `temp-strategic-review-probe-goal`
- `temp-strategic-review-probe-recent-checkpoint`

The diagnostic Goal had already been completed with native readback. The probe was
idle with its last turn completed, then native archival returned `archived: true`
at 03:47:26. Native chat history remains recoverable. No probe worktree, branch,
Relay registration, or new installed package was created.

A single-occurrence schedule was rejected before creation. The actual probes used
temporary one-minute recurring reminders, removed by the controller. The rejected
schedule is not evidence of failed delivery.

These observations do not cover a human-paused Goal, app suspension/restart,
remote hosts, every concurrency race, production-length work, or the quality of
strategic reasoning. The recent-review check did not exercise material-change or
overdue branches, compaction recovery, or duplicate transport delivery. No invisible
reminder is counted as successful suppression. A user pause remains authoritative
but is not tested here.

The official [same-chat scheduling documentation](https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat)
describes review-loop reminders; it does not establish delivery during a running
turn. The timing observations above are local evidence, not an API guarantee.
