# Stop Policy

Stop and preserve durable evidence when:

- product, repository, package, or release authority is absent;
- requested work crosses owned paths, retained fences, or active leases;
- a shared resource is held by another owner;
- an external or irreversible action lacks authorization;
- ready task identity lacks the exact launch nonce, selector evidence
  contradicts the request, or release delivery is ambiguous;
- a task would act before accepting its exact release;
- Git state is dirty outside the accepted `dirty-blocked` terminal path; or
- evidence disproves the workflow contract.

Before expanding diagnostics, harnesses, validators, or evidence, name the
primary outcome, causal question, and cheapest safe direct attempt they enable.
Report instrument progress separately. After one supporting-instrument
checkpoint, execute the named direct attempt next or pause/replan. Another
supporting-instrument run requires explicit authorization in a later workflow
revision. An instrument explicitly requested as the deliverable is the primary
outcome.

Urgent notification remains durable: persist the signal before one identified
interrupt attempt. Difficulty alone is not a stop condition. Continue safely
within the exact contract, but never weaken guards, substitute task surfaces,
clear user state, or rewrite history to make a gate pass.
