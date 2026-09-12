# Unsealed Stop communication correction

User approved deterministic delivery independent of verification on 2026-09-12.

## Observed failure

Plotloom assignment `bcc7a040-0341-465d-b713-5b6534d387df`, worker
`01a09772-da48-7d43-ad6c-14a5202d7dbc`, committed `87e9e6d`. Its finish command
refused verification with changed source/index/refs; its final nevertheless claimed
release succeeded. Public state retained write permission and null outcome,
association, final and receipt. The old hook ignored that unsealed Stop.
No check rerun or product-state changes were made during diagnosis. Which original
snapshot field differed remains unknown; current clean state does not resolve it.

## Source correction

Candidate `0.3.1-rc.1` captures unsealed hook-mode worker messages per real turn,
freezes separate system status and queues one notice using the existing transport.
`read-report --event-id` reads that exact informational report without acceptance
or cleanup commands. Existing sealed-result review remains unchanged. Later
completion is separately reportable; an old unsealed turn cannot become completion
when replayed after sealing. No LLM inference or reporting continuation is used.

Checks persist finite verification errors and changed snapshot field names without
command output. This does not weaken the source check or infer that worker prose
is true. Legacy notification modes remain unchanged.

42/42 runtime tests passed in 39.164s; 27/27 relocated package tests in 8.538s.
Skills, plugin validation and whitespace checks passed. A further exact-event CLI
read assertion was added to the focused hook suite after that full run.
Native delivery and installation of this candidate remain pending; installed
0.3.0 and Plotloom's active assignment are untouched. The existing frozen native
0.3.0 canary is not relabeled as proof of this changed behavior.

Separate finding: task roles remain director/coordinator/sequential executor,
but generated creation arguments omit a role-prefixed title. The Plotloom worker
was a coordinator despite its role-free title. No naming change is included here.

## Direct 0.3.1 release

User selected a direct patch release instead of an RC cycle. Annotated tag
`relay/v0.3.1` points to `206df2b`; runtime correction is `1f245d3`.
Final 0.3.1 verification: 42/42 runtime tests in 40.958s, 27/27 relocated package
tests in 9.827s, plugin validation and whitespace checks passed.

Artifact `.git/codex-release-evidence/relay/0.3.1/relay-0.3.1.tgz`, SHA-256
`19a7fbca3e5791800a762d9ae80caa6a4d7f4f007d92c57ac8fd5834e82747a6`.
Managed installation: `0.3.1+codex.20260912213530`. Artifact, personal source and
installed cache match all 29 files except the permitted plugin-manifest cachebuster.
Installed CLI reports 0.3.1; App CLI remains qualified `0.154.0-alpha.6.2`.
Rollback source: `/Users/wjmao/plugins/relay.before-0.3.1-206df2b`.

Plotloom worker and director were observed idle before update. Their assignment
records, source and missed old event were not changed or replayed. Updating does
not retroactively persist an old verification error or send an old Stop report.
No npm publication. Desktop reload/trust pickup and new-behavior live observation
remain unverified; automated fixtures are not represented as native delivery.
