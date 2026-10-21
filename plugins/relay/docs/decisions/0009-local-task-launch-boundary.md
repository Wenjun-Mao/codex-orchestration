# 0009 — Qualify Desktop execution ownership before adding a task launcher

Date: 2026-10-21. Status: accepted boundary; current candidate not adopted.

## Context

The user wants managers to apply standing model-choice guidance without repeated
dispatch questions. Native `create_thread` currently instructs callers to omit a
model unless the user explicitly requested a specific model. That is an observed
tool-instruction restriction, not a proven backend rejection or a known recent
regression. Stronger skill wording does not override the tool's contract.

The user authorized assessment, a harmless local compatibility proof, and narrow
implementation if viable. The
[bounded app-server probe](../field-tests/2026-10-21-local-launch-compatibility.md)
accepted and reported Luna/Max, ran in the correct read-only checkout, and delivered
a genuine Relay Stop final. However, it rejected the Desktop's existing project ID
and reported live task status inconsistent with the native Desktop interface.

## Decision

Do not add this app-server path as a Relay Desktop-task launcher on the current
evidence. Persisted UUIDs, discoverable history, configured model selectors, and
successful callbacks do not by themselves establish shared execution ownership
or correct Desktop project association. Keep the current reporting runtime and
native task workflow. No installed skill or global configuration changes follow
from this assessment.

A future launch integration needs an independently legitimate, user-authorized
contract for explicit model selection, accepted project/checkout identity, clear
permission handling, and a supported execution owner with observable control and
process lifetime. Keep selection judgment in the existing guide. Unsupported
settings must be surfaced, and uncertain creation must be observed rather than
blindly repeated or silently changed to a different model/project.

## Alternatives and consequences

Reject a wrapper that strips the native tool's restrictions, private Desktop IPC
or database edits, and a new persistent runner/daemon added merely to bridge the
observed mismatch. Those either lack a legitimate integration contract or expand
Relay beyond the authorized focused capability.

The original dispatch inconvenience remains unresolved. Reopen implementation
when a supported path can bind the intended Desktop project and establish live
ownership/control; the current probe narrows that question. Its successful
reporting test remains useful evidence, without claiming production readiness,
backend model telemetry, cancellation, or restart compatibility.
