# Observed coordinator startup overhead

Status: user-supplied activity-summary evidence, not independently measured usage.
Purpose: preserve a concrete public-interface failure for Relay's design review.

The user supplied a coordinator startup activity list for an ordinary assignment
using installed Flow 0.9.13. The original attachment remains unchanged in the
user's local attachments. This note omits project/task IDs and local paths.

## Observed

- Read coordination/refresh skills, several lifecycle references and README.
- Re-read reporting, parallel-execution, stop-policy and host-operation references.
- Search documentation/schemas and read CLI, workflow-plan, lifecycle,
  runtime-context, coordinator-work and task-launch implementation.
- Construct a 153-line activation JSON and a separate five-line reporting request;
  invoke activation and route registration.
- End with run/reporting registration, before product implementation.

The generated preparation brief names plan/preparation/recipient and instructs
activation/registration, but does not supply the mechanical activation request
(`preparedAssignmentText` in `lib/assignment-preparation.mjs`).

## Interpretation and limits

Startup leaves too much protocol discovery to the agent. Repeated reads also
reflect avoidable execution inefficiency; not every observed operation was
necessarily required by the plugin. Large JSON can be appropriate internal data;
making the model reconstruct its schema is the problem. Shorter instructions
alone do not solve this.

The user estimated more than 100K context consumed. The attachment is a 5,738-byte
activity summary, without full outputs or before/after token measurements. That
estimate and attribution are unverified; do not report measured plugin overhead
or infer billing from it.

## Relay acceptance use

Ordinary startup must work from the approved brief and public interface without
implementation-code reads or handwritten mechanical authority records. Measure
plugin-added context, calls and elapsed time separately from ambient App context
and product reading. Use a fresh coordinator, not only the implementation author.
Set a small useful startup budget at design approval and verify the connected
journey against it.
