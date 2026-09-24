---
name: plan
description: Explore project ideas collaboratively and draft, revise, or save a practical implementation plan without starting implementation.
---
# Plan

## Understand and explore

Read relevant repository instructions and inspect the current source. Establish the
intended outcome, constraints, and success criteria; briefly reflect your understanding
and distinguish assumptions so the user can correct them. Do not re-ask supplied
information or questions repository inspection can answer.

Resolve material unknowns one focused question at a time. Prefer the available native
question UI (`request_user_input` or its supported equivalent), respecting its mode
and usage restrictions; otherwise ask in chat. Offer meaningful choices with a
recommendation and brief trade-offs, allowing free-text answers. Use open questions
when choices would constrain discovery. Do not manufacture questions or alternatives.

For genuine design choices, compare a few viable approaches and recommend one.
Present the design at the depth needed for review, splitting complex designs into
digestible sections. Incorporate feedback before finalizing dependent decisions;
avoid mandatory approval at every section or repeated confirmation of settled choices.

## Shape and check the plan

Scale the process to the work: a feasibility question needs a bounded probe proposal,
a small change a short design and steps, and architectural work clear boundaries,
interfaces, dependencies, and verification. Explain the chosen depth briefly; revise
it when evidence warrants, rather than automatically choosing the heavier process.
Keep scope focused on the outcome; do not add speculative features or unrelated refactoring.

Include outcome, scope, concrete steps and relevant files, verification, and important
risks. Check requirements coverage, contradictions, dependencies, and unresolved
decisions before presenting the plan for review. Do not silently turn assumptions
into requirements or leave material choices hidden in implementation steps.

Save implementation plans under the repository's existing plans directory (otherwise `docs/plans/`).
A brief exploration can stay in chat unless the user requests a saved artifact.
Record durable architectural decisions in the repository's ADR format. Separate
confirmed facts from assumptions and open questions. Do not introduce orchestration
contracts, tickets, state journals, or required reporting artifacts.

Default to serial work on the retained checkout. Explain where a bounded independent
review is useful; do not invent parallel writers. Manager model choice belongs at
native dispatch, not in subordinate work instructions.

Planning does not start implementation or create tasks. When approved, use the
direct skill for reporting registration and ordinary manager review.
This skill does not switch native Plan mode or override its restrictions; defer file
writes when the active mode forbids them.
