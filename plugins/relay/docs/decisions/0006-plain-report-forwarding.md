# 0006 — Plain report forwarding

Status: accepted. Supersedes reporting portions of decisions 0002–0005.

Problem: a wake-up hint plus retained report/receipt machinery turned simple
communication into a lifecycle dependency. It also duplicated messages on disk.

Decision: the Stop hook reads the bound manager address and sends the final text
unchanged. No message persistence, preamble, verification gate, retrieval,
acknowledgement, LLM continuation, delayed capture, or automatic retry belongs in
this path. The native client-message ID is derived from the assignment/task/turn.
No local delivery journal is needed.

Product checks and task retirement remain separate. The manager reviews worker
text as data, checks the source outcome, and retires only an idle finished task.
The worker must await actual command completion before stating its result.

Rejected: storage pruning, pending-payload queues, and richer status notices;
these retain responsibilities that reporting should not own.

Consequences: a failed send is visible in hook stderr; the original task remains
the place to read its output. Existing historical records are not deleted by an
upgrade. No crash-proof or exactly-once delivery claim is made.

Tests: exact Unicode/newline forwarding, zero disk writes, unsealed/failed source,
old routes, unrelated/archived tasks, native response handling, and independent
product-review/retirement journeys.

User-approved 0.3.3 amendment: add only `From: <current task title>` and a blank
line before the unchanged body. Fetch `thread.name` using metadata-only
`thread/read` on the existing native connection; use the sender ID when no title
is available. Do not infer a role, store titles/messages, or load conversation
history. Collapse line breaks in a title so attribution remains one line.
