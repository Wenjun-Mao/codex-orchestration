# Relay 0.4 reporting-only source checkpoint

Source candidate only. No marketplace update, installation, migration, production
task creation, or external-project mutation occurred.

## Verified

- New routing/CLI/hook and retained transport suite: 9/9, 1.342 seconds.
- Relocated tarball suite: 9/9, 1.177 seconds; packaging check 1.491 seconds.
- Plugin manifest and all three skill validators passed; git diff check passed.
- Read-only independent review found no functional blocker. Its requested atomic
  write-failure regression, no-report-files assertion and model-instruction
  correction were incorporated before the final suite.
- Register replay/conflict, expected-manager unregister, UUID/self-route rejection,
  lock contention/recovery, atomic replacement failure, malformed/legacy state,
  hierarchy, detached/dirty source independence, shared worktrees and exact
  transport text/title validation are covered.

## Size

Compared with the preceding committed 0.3.5 source:

| Measure | Before | Candidate |
|---|---:|---:|
| Runtime JS lines (bin + lib) | 1,003 | 263 |
| Three skill entrypoints, bytes | 7,687 | 5,238 |
| Packaged files | 31 | 16 |
| Unpacked package bytes | 133,424 | 32,649 |

Removed lifecycle tests are not claimed as passing; their product contract was
removed. This is not a like-for-like test performance comparison. Token savings
have not been measured in comparable live tasks.

## Remaining

Installed 0.3.5 is unchanged. Before switching: establish a quiet boundary for
old assignments, preserve wanted work and perform explicitly scoped legacy-state
retirement. Then qualify native delivery; mock transport/real Git tests do not
prove a genuine installed Stop hook or recipient-visible live delivery.
