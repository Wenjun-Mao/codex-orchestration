---
name: brainstorm-and-plan
description: Take an idea through exploration into a reviewed implementation plan by applying relay:brainstorm and relay:plan. Use when the user wants both; skip exploration when the design is already settled.
---
# Brainstorm and Plan

Help the user move from an idea to a reviewed plan. This is a convenient
entrypoint to two skills, not a third planning method.

1. If the purpose or approach is still unclear, read and apply
   `relay:brainstorm` to resolve it. When the direction is settled,
   continue into `relay:plan` without asking whether the user wants
   the plan they already requested.
2. If the user supplies a settled design, go directly to `relay:plan`.
   Ask only about missing details that would change the plan.
3. Read and apply `relay:plan` for the plan and its independent reviews.
   If Brainstorm already handed off to Plan, continue that same pass;
   do not run the planning workflow twice.

Carry forward decisions, existing documents and any project-specific
instructions from the calling wrapper. Do not repeat discovery,
duplicate documents or add another reviewer or approval stage.

If the user changes the request to exploration only, finish through
Brainstorm without producing a compulsory plan. For planning-only
requests, use Plan directly. Follow Plan's handoff for any separately
authorized execution; this wrapper grants no additional permission.
