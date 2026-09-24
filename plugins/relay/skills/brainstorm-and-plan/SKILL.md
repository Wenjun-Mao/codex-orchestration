---
name: brainstorm-and-plan
description: Explore project ideas collaboratively and draft, revise, or save a practical implementation plan without starting implementation.
---
# Brainstorm and Plan

Turn the user's idea into a shared understanding, a reviewed design, and an actionable
plan. Start from the requested activity and existing agreement. These sections are
checks, not mandatory conversational rounds: revisit only missing or changed information,
and stop when the requested exploration, revision, or saved plan is complete.

## 1. Understand the goal

- Identify the problem, who the change serves, constraints, and what success means.
- If purpose is missing, ask about it before proposing features. If already supplied,
  reflect it briefly rather than asking again. Separate the user's intent from your assumptions.
- Scale depth to uncertainty and consequences, not just code size: propose a bounded
  probe for feasibility questions, brief steps for straightforward changes, and explicit
  boundaries/interfaces for architectural work. For broad ideas, agree on the next useful
  deliverable before detailed planning; keep the larger direction brief.

## 2. Ground the discussion in the project

- Read applicable repository instructions before repository work.
- Reuse established project context; inspect only enough to verify assumptions relevant
  to this decision. Locate affected entrypoints, implementation, tests, and plans/decisions
  to establish current behavior, reusable parts, and necessary changes—not repeat broad discovery.
- For a new project, establish the starting constraints instead of searching for nonexistent code.
  Do not ask the user factual questions that this inspection can answer.

## 3. Clarify meaningful choices

- Ask one focused question at a time, prioritizing unknowns that change scope or design.
- Prefer native question UI (`request_user_input` or a supported equivalent) when permitted
  by its mode and usage rules; otherwise ask in chat.
- Offer meaningful choices with your recommendation and brief trade-offs, allowing a
  free-text answer. Ask an open question when options would constrain discovery.
- Incorporate answers before settling dependent decisions. Do not invent questions,
  repeat settled choices, or treat an unanswered recommendation as the user's selection.

## 4. Compare approaches

For a genuine design choice, present two or three viable approaches, their trade-offs,
and your recommendation. Explain why it fits the agreed goal and project constraints.
If only one approach is sensible, explain it without manufacturing alternatives.
Exclude speculative features and unrelated refactoring.

## 5. Review the design

Present the proposed behavior, affected components, important failure cases, and how
success will be verified. Split complex designs into digestible sections; keep small
changes brief. Invite correction and resolve material disagreement before finalizing
the plan. Do not require separate approval for every section or reconfirm settled decisions.

## 6. Write and check the plan

- A handoff-ready plan makes outcome, scope/exclusions, observable acceptance criteria,
  ordered deliverables, relevant files, dependencies, and material risks clear. Distinguish
  facts from assumptions; check requirement coverage and contradictions.
- Resolve choices that change agreed behavior or scope; identify technical decisions left
  to the implementer. Put unresolved feasibility investigations before dependent implementation.
  The implementer should not guess user intent, but should still exercise engineering judgment;
  do not require prewritten implementation/test code for every step.
- Maintain one plan for the same scope, updating it rather than creating overlapping versions.
  Save it in the existing plans directory (otherwise `docs/plans/`); brief exploration can stay
  in chat. Record durable decisions as repository conventions require, linking ADRs rather
  than duplicating rationale. Do not add documents merely because another stage was reached.
- Default to serial work on the retained checkout. Explain any useful bounded independent
  review; do not invent parallel writers. Model choice belongs at native dispatch, not in worker briefs.

Present the result for review; planning does not authorize implementation or task creation.
After implementation approval, use `direct` when managing delegated work. This skill
does not switch native Plan mode or override its restrictions; defer file writes when prohibited.
