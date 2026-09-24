---
name: brainstorm-and-plan
description: Explore project ideas collaboratively and draft, revise, or save a practical implementation plan without starting implementation.
---
# Brainstorm and Plan

Turn the user's idea into a shared understanding, a reviewed design, and an actionable
plan. Start with what they want to achieve—not with a proposed solution or a file-reading ritual.

## 1. Understand the goal

- Identify the problem, who the change serves, constraints, and what success means.
- If purpose is missing, ask about it before proposing features. If already supplied,
  reflect it briefly rather than asking again. Separate the user's intent from your assumptions.
- Explain the appropriate depth: a feasibility question needs a bounded probe proposal;
  a small change needs a short design and steps; architectural work needs explicit
  boundaries, interfaces, and dependencies. Adjust depth as evidence changes.

## 2. Ground the discussion in the project

- Read applicable repository instructions before repository work.
- Locate the workflow being changed: its entrypoints, implementation, tests, and relevant
  plans or decisions. Establish how it works today, what can be reused, and what must change.
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

- Include outcome, scope, concrete steps and relevant files, dependencies, verification,
  and important risks. Distinguish confirmed facts, assumptions, and open questions.
- Check coverage of the agreed requirements, contradictions, missing dependencies, and
  hidden decisions. Resolve material choices rather than burying them in implementation steps.
- Save implementation plans in the existing plans directory (otherwise `docs/plans/`).
  Brief exploration can stay in chat unless a saved artifact is requested. Record durable
  architecture decisions in the repository's ADR format; avoid extra contracts or journals.
- Default to serial work on the retained checkout. Explain any useful bounded independent
  review; do not invent parallel writers. Model choice belongs at native dispatch, not in worker briefs.

Present the plan for review; planning does not authorize implementation or task creation.
After implementation approval, use `direct` when managing delegated work. This skill
does not switch native Plan mode or override its restrictions; defer file writes when prohibited.
