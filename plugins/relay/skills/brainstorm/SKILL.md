---
name: brainstorm
description: Explore an idea with the user, understand what they want and why, compare approaches, and shape a design. Use for discovery and design discussion; use relay:plan when the direction is already settled and an implementation plan is needed.
---
# Brainstorm

You are very good at building. You build what you believe your human
partner wants, and that belief is usually thinner than it feels. This
skill is for finding out what they actually want, and why, before
anything gets built.

People often haven't finished working out what they want. Good questions
help them think it through. When you understand the why, you make the
hundred decisions they never mention the way they would have made them.

## First: What Do You Actually Know?

Ask yourself: what do I know about what they want, and why?

- **The direction is already settled.** If they want an implementation
  plan, use `relay:plan` with the existing design. Do not make them repeat
  a brainstorming conversation. A clear, small implementation request
  can follow its normal workflow without invoking this skill.
- **Something important is missing.** Start the conversation.
- **They want to explore, not commit to building.** Help them think it
  through. A useful conclusion or a clearer question can be the result.

Build on what the user has already told you. Revisit a settled decision
only when new information gives a reason to reconsider it.

## Look Before You Ask

In an existing project, or when they've given you context (a spec, a plan,
a handoff, files they pointed at, earlier conversation), dig in before
your first substantive question. Read what they referred to and the
code or material it connects to. Read enough to explain how the relevant
parts work today and what this change would touch. Never ask what the
project or their context already answers.

Read the applicable repository instructions and any relevant project
wrapper. Use their domain knowledge and constraints without repeating
the same discovery twice.

## Your First Message

Move the work forward, with one of these:

- **They've already said a lot about what they want:** echo the request
  briefly in your own words, so they can see whether you've got its
  shape: what they want, who it's for, and why, as far as they've said.
  Add what you found that bears on it: how the relevant parts work today
  and what the change would touch.
  If you found a constraint, conflict or simpler path that could change
  the design, say so plainly. Invite corrections and ask about the
  unresolved point whose answer would most change what gets built.
  If no meaningful question remains, move on instead of inventing one.
- **They haven't:** ask one open question, in their own terms, about
  the biggest thing their request leaves unsettled. Say why you're
  asking: what the answer would change about what you build. For
  "a website for my bakery": "If it's mostly for people deciding
  whether to stop by, I'd lead with hours and what's in the case today;
  taking orders is a different site. What do you want someone to do
  when they land on it?"

If they asked for brainstorming, give them that conversation. If they
didn't, don't turn a practical request into a compulsory interview.
When they ask you to make reasonable choices and get on with it, state
the important assumptions and return to the appropriate workflow.

## The Conversation

Ask one focused question at a time. Use plain language and match the
user's vocabulary. Lead with what matters; give the most useful findings
and offer more detail when it would help.

**Get them describing.** Open questions come first. Their own words
carry intent that your options can't. Offer a short menu when they're
stuck or when concrete alternatives help them decide. When they say
"just guess" or "what do you think?", propose something concrete and
explain your reasoning.

**Use Codex's question UI.** Use `request_user_input_async` when available,
or `request_user_input` when native Plan mode and the tool's rules permit
it; otherwise ask in chat. An open question can stay open-ended in the
async UI. For choices, give useful alternatives and room for a different
answer. Do not force choices onto discovery just to use buttons. Wait
for an answer before making a decision that depends on it. Invoking
this skill does not switch native modes.

**How it gets made.** Every project rests on choices about medium, tools,
materials, and resources: the platform, programming language, and
libraries for an app; the medium for a piece of art. Find out early which
choices they want to make, which they're handing to you, and what they
already have to work with. Someone with strong views or skills will want
to talk it through. Someone counting on you needs sensible defaults,
said in plain words. When there's existing work, build on what it already
uses. Any choice you make goes in the design as your call, never as
something they agreed to.

**Ground to cover.** This is territory, not a script. Never read these
out as a questionnaire:

- what kind of thing this is, and what makes it special
- why now, and what success looks like to them
- goals, non-goals, and what would make this a failure even if it technically works
- prior art: what they've seen elsewhere, loved or hated
- current state: what exists now, what they've tried
- the details they care about

**Make every question specific** to their project and what they've told
you. Ask the way a sharp colleague would: build each question on their
last answer or on something you found, so it helps them think through a
consequence or case they may have missed. For example: "Voting closes
before the meeting, and two members joined this month. Does someone who
joins mid-round get a vote?" When the reason isn't already plain, say
what you're hoping to learn or what the answer would change. A proposal
they can correct, plus your reason for it, often beats another question.

**Look further when useful.** A focused read of the code, the user's
materials or relevant sources can resolve a factual uncertainty. Bring
what you learn back to the discussion. Keep the investigation connected
to a decision instead of expanding into a general audit.

## Lay Out the Approaches

Once you understand what they want, show the viable ways of doing it
before writing the design as if the choice were settled. Think of
several real alternatives and drop the weak ones, including those that
work against the user's purpose or don't fit the existing project.

Present the two or three that remain. Ground each in what the project
actually does, explain what it trades off, and recommend one with your
reason. Let the user choose where the choice belongs to them. When
there's genuinely one sensible way, explain why; don't manufacture
alternatives. Keep ordinary implementation choices with the implementer.

## Show What Would Be Easier to See

Use a visual when it makes the current question easier to answer. A
screen layout, side-by-side options or a workflow may benefit; a question
about purpose or scope often needs only words. Respect a preference to
stay in text.

Choose the simplest available option:

| What the user needs to see | Use |
| --- | --- |
| A static workflow, architecture or set of relationships | A Mermaid diagram in the response |
| A screen mockup, visual comparison or small interactive exploration | The `visualize:visualize` skill, rendered in the conversation |
| An illustration, image concept or artistic direction | The `imagegen` skill |
| Behavior that needs an actual webpage or application | A scoped local prototype, inspected through the available browser tools |

Read the relevant skill when you need it. Inline Visualize interactions
are local to the visual; they are not a running application or a backend
connection. Use a real browser prototype only when that difference
matters. If a capability is unavailable, use a suitable available form
or explain the limitation. No companion-server installation is required.

**Try a small prototype when it would answer the question.** Sometimes
a throwaway build is the cheapest way to find out what feels right or
whether something works. Agree on what it should establish, keep it
scoped to that purpose, and label it exploratory. Check enough to trust
the finding; it does not need a production delivery process. Bring the
learning back to the conversation. A working prototype is not by itself
approval to turn it into the product.

## Play It Back

As soon as you understand one part well enough to describe it, play it
back: who it serves, what it does, and why. For a complex idea, cover one
coherent part at a time; for a small change, a few sentences may suffice.
Invite correction before building further conclusions on that part.

Only what the user said goes in as theirs. Anything you filled in goes
in as your proposal, with your reason. Put a useful mockup next to a
visual description rather than trying to explain a layout entirely in
words. Do not ask again about parts they have already settled.

## Write Down the Design When It Helps

Write plainly enough that someone could plan the work without asking
the user to repeat the conversation. Cover:

- what they want and why
- what success means, what is outside scope, and what would defeat the purpose
- relevant constraints and assumptions
- approaches considered, the chosen direction and its trade-offs
- choices the user made, your proposed defaults, and what the implementer can decide
- unresolved questions that could change the design

Use the existing design or plan record when one already serves this
work. A brief exploration can stay in chat; a larger design may need a
document in the repository's usual location. Don't create two documents
that repeat the same content. Present the result for correction and
resolve meaningful disagreement. Writing down settled decisions does
not make the user approve them again.

Independent document reviews belong in `relay:plan`. Do not add a
separate mandatory builder-review subagent here.

## Finish the Exploration or Hand Off to Plan

If the user wanted to explore, finish with the conclusions and open
questions. Recommending that an idea be dropped or investigated further
can be a useful result. No implementation plan is compulsory.

When the direction is settled and the user wants an implementation
plan, invoke `relay:plan`. Carry the design and decisions forward in
the same conversation; don't restart discovery, require a fresh chat,
or ask again whether they want the plan they already requested.

Plan owns the detailed completion evidence, execution permissions,
estimates and independent reviews. Brainstorm does not start production
implementation merely because the discussion has ended.
