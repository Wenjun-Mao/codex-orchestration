# ADR 0048: Director, coordinator, and reporting boundaries

- Status: accepted for v0.9.2 development
- Date: 2026-09-05
- Refines: ADR 0005 callback authority and ADR 0043 native-first architecture

## Context

The v0.9 coordinator role combined strategic ownership with delivery. That
made it hard to delegate a complete implementation while keeping the user's
goal, tradeoffs, and acceptance in one stable task. Reporting language also
risked treating native final text or an experimental hook as a replacement for
the working explicit collection path before exact routing was proven.

Current OpenAI guidance says reasoning effort should rise with task complexity
and selectors should be explicit rather than inherited. Superpowers' model
selection guidance likewise chooses the least capable sufficient tier, states
the selector explicitly, and scales review to complexity and risk. These
sources support explicit, task-shaped routing; they do not establish an
empirical optimum for Codex Flow's named models.

Sources:

- https://learn.chatgpt.com/docs/models
- https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md#model-selection

## Decision

Add three exclusive ownership roles. The director owns goals, strategic
conversation, tradeoffs, assignments, and acceptance. A coordinator owns one
bounded delivery, including delegation, integration, verification, and a
complete result to the director. An executor owns only assigned implementation
and evidence; it cannot appoint a coordinator or broaden scope. The director
may do bounded direct work, and delegation never implies a fixed task count.

Assignment briefs name outcome, scope, constraints, acceptance, and one
reporting recipient/path. Result briefs return actual results, evidence, and
concerns to that same target and are the report, not input to a second summary.
Delivery of a result or receipt is not acceptance.

A working explicit collection path may retire only after its replacement is
installed and trusted, where applicable, and verified for the exact
sender-recipient mapping. Routine delivery must not Steer an active recipient;
`wait_threads` is active coordination work, not an idle delivery boundary. The
quiet callback and rare persisted urgent path remain unchanged. The current
hook remains experimental, uninstalled, and canary-only.

Routing defaults become Luna-xhigh for substantive well-scoped executor work,
Terra-high for bounded implementation/review, Terra-xhigh for difficult
root-cause work, and Sol-high for coordination or director work. Astra-high is
optional for consequential director judgments. Luna-xhigh is a user preference,
not an empirical optimum; trivial work may use a lower-effort override with a
reason. Every call keeps an explicit selector and rationale, with no probe,
inheritance, silent escalation, or fallback.

An optional advisor may answer one bounded question with independent analysis.
It cannot issue commands, accept work, appoint or direct a coordinator, or form
a coordinator-to-coordinator channel. The contract has no browser, MCP, tunnel,
installation, or personal-skill dependency.

## Rejected alternatives

- Keep strategy and delivery in one coordinator role. This obscures who owns
  acceptance and makes complete delegation less legible.
- Require three or more tasks. Staffing is an execution choice, not a product
  contract.
- Remove manual collection when a hook exists in source. Presence is not
  installed, trusted, exact-routing evidence.
- Copy Superpowers' complete loop or its quantitative anecdotes. Its bounded
  model-selection principle is useful; its workflow and measurements are not
  evidence for this package's models.

## Consequences and guardrails

The router exposes one `direct` skill and the existing `coordinate` and
`execute` skills retain their lifecycle roles. Small reusable briefs reference
Flow mechanics instead of restating them. Behavioral tests cover exclusive role
ownership, brief shape, reporting-path retirement, explicit routing defaults,
and justified lower-effort override. Package/runtime identity remains the
selector-policy authority; no independent policy-version constant remains.
Schemas, receipt authority, refresh, archive, and lifecycle state semantics are
unchanged.
