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
