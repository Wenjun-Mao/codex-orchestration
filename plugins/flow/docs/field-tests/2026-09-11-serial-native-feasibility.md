# Serial native feasibility

Status: Native local-surface feasibility PASS on this host. Not a Flow lifecycle
or writer-permission acceptance result. Preparation history below is preserved.

- Repository: `/Users/wjmao/projects/utility_projects/codex-serial-native-probe.FqJGUm`
- Independent Git common directory: that repository's `.git` (not linked to a pilot).
- Branch: `main`; clean initial commit `e8ac9a0316fd798bd831d620903028c12bcf67a2`.
- Exactly one worktree and no remote configured.
- Sentinel SHA-256: `6821d51e28167b1754df3c5398cc7b70f638eb1e456043fe73d821373a049e75`.
- Native task API requires a saved project for local same-checkout creation.
  Project inventory did not contain this new repository. UI access to Codex was
  refused by the computer-use surface; no alternate UI/control bypass attempted.
- App version is not yet recorded: the initial `/Applications/Codex.app` lookup
  found no bundle there. This is a lookup limitation, not a runtime defect.

Planned at preparation: user adds this folder, then resolve its project ID and create native local
tasks C and E with explicit low-cost selectors. Schedule source changes strictly
sequentially, verify distinct identities at the same checkout, archive E, verify
C still works, archive C, and create useful successor C2. Save exact native
results and Git/sentinel observations before and after archival. These are host
feasibility observations, not Flow receipts or a successful Flow lifecycle.

No Plotloom task/files, installed plugin, marketplace, shared settings, or App
restart were touched. Runtime implementation has not begun.

## Executed journey

User added project `serial native probe`, ID
`4a25db5a-499c-47af-b184-586102cdd038`. All three native creation requests used
`environment: {type: local}` with explicit `gpt-5.6-luna`, `xhigh`. Each returned
a real thread ID directly; no provisional reconciliation or creation retry.

| Task | Exact native ID | Verified outcome |
| --- | --- | --- |
| C | `01a0923f-f3c8-72a2-932d-1944c7a4406e` | Initial commit; received E's message; verified read-only; committed again after E archive |
| E | `01a09240-f73a-7441-80bb-adf7cac9bd4d` | Sequential same-checkout commit; native message to C; archived once |
| C2 | `01a09243-6025-7a61-aab9-8bec1c353aea` | Fresh task after C/E archive, verified prior bytes and committed successor; archived once |

All reported actual CODEX_THREAD_ID matching the returned IDs and the same
canonical root/common directory. Writer turns were scheduled serially; C's
message-triggered verification was explicitly read-only. Native waits observed
completed idle turns before the next writer or archive action. No task created
children or reported outstanding tool processes. This scheduling is not a
machine-enforced Flow ownership protocol.

Exact commit chain on `main`:

1. Initial: `e8ac9a0316fd798bd831d620903028c12bcf67a2`.
2. C: `7c0bf6d955394c44be8ca84a09d679d57076ec5a`.
3. E: `e0d1c59e7c0661470aa59ae0ec5e270494c2bc25`.
4. C after E archival: `b35cbb701d4f60ab9420cdc5ac0c8a5a1d376d60`.
5. C2 after C archival: `59087e200dcec9df58d41d3b51f901ab1eecd17b`.

Final `journey.txt` is exactly four newline-terminated lines:

```text
C checkpoint
E follow-up
C after E archive
C2 successor
```

Director shell checks before and after each archive confirmed expected HEAD,
clean `main`, one worktree and unchanged sentinel hash. Final branch inventory
contains only `refs/heads/main`; no merge, cherry-pick, extra worktree or executor
branch was used. Final `.git/codex-flow` is absent. No Flow route or manual hook
was created: E-to-C notification used native messaging, with a distinct C
verification turn `01a09241-d79a-7e72-b831-a8baa5f1a495`.

## Archive observations and limitations

Each exact native archive call returned `archived: true`, once, in order E, C,
C2. Public archived-list output initially omitted the new records. No archive
was replayed. A read-only exact-ID query of the App's local thread database
independently found all three `archived=1` at the same retained cwd, with observed
model/effort `gpt-5.6-luna`/`xhigh` and CLI version `0.153.4`:

- E archived_at: `1789160211`.
- C archived_at: `1789160283`.
- C2 archived_at: `1789160387`.

The initial App bundle lookup remained unresolved; no specific App build claim
is made. These observations establish successful native local creation,
same-path task identity/messaging, sequential usability and task-only archival
for this host/session. They do not certify future App builds, delayed host
reclamation guarantees, Flow reporting, direct dispositions, concurrent-writer
exclusion, stale activation rejection, or interruption recovery.

The probe required no manual repair, additional user approval after project
addition, install, restart or permission-setting change. All probe tasks are
archived; the disposable project/repository remains deliberately retained as
evidence. No project deletion was attempted. Plotloom was not accessed or changed.

## Architectural implication

The native surface does not currently disqualify shared-checkout executors.
Recommend keeping both slices A/B in the implementation target, subject to the
planned ownership/direct-result/retained-history connected proof. A separate
implementation dispatch/inclusion decision remains outstanding.
