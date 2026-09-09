import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  assignmentAuthority,
  assignmentStateRoot,
} from "../lib/assignment-authority.mjs";
import { prepareCoordinatorAssignment } from "../lib/assignment-preparation.mjs";
import { iterationStatus } from "../lib/iteration-registry.mjs";
import {
  registerCoordinatorReportRoute,
  reportRoute,
} from "../lib/report-routes.mjs";
import {
  bindRecipient,
  rebindRecipient,
  recipientPaths,
} from "../lib/recipients.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import { abandonRun } from "../lib/run-lifecycle.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { createWorkflowPlanRevision } from "../lib/workflow-plan.mjs";
import {
  assertSuccess,
  activateFixtureRun,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

const TIME = Date.parse("2026-09-07T16:00:00.000Z");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function coordinatorPlan(suffix) {
  return createWorkflowPlanRevision({
    schema_version: 1,
    plan_id: `shared-director-${suffix}`,
    revision: 1,
    parent_revision_digest: null,
    tasks: [{
      task_id: `coordinator-work-${suffix}`,
      title: `Complete coordinator work ${suffix}`,
      execution_kind: "coordinator",
      mode: "write",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      selector_rationale: "Terra-high is sufficient for the bounded routing fixture.",
      fork_turns: null,
      dependencies: [],
      read_paths: ["docs"],
      write_paths: [`docs/${suffix}.md`],
      shared_resources: [],
      primary_outcome: `Complete coordinator route fixture ${suffix}.`,
      causal_question: null,
      cheapest_safe_direct_attempt: `Register coordinator route ${suffix} once.`,
      instrument_role: "none",
      supporting_follow_up: null,
      supporting_authorization: null,
    }],
  });
}

async function coordinatorRun(root, suffix, index) {
  const lineage = {
    lineage_id: `coordinator-${suffix}-lineage`,
    thread_id: `coordinator-${suffix}-thread`,
    generation: 1,
  };
  const plan = coordinatorPlan(suffix);
  const activated = await activateFixtureRun({
    root,
    runId: `coordinator-${suffix}-run`,
    plan,
    lineage,
    now: TIME + index * 1_000,
  });
  return { ...activated, lineage, plan };
}

test("fresh coordinator fences preserve one shared director binding and recover partial registration", async (t) => {
  const root = await createGitFixture("codex-flow-shared-director-");
  t.after(() => removeFixture(root));
  const commonDir = await realpath(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const runtimeStateRoot = resolve(commonDir, "codex-flow", RUNTIME_DIRECTORY);
  const reportingStateRoot = assignmentStateRoot(commonDir);
  const planPath = resolve(root, "approved-plan.md");
  await writeFile(planPath, "# Shared director routing fixture\n", "utf8");

  const director = {
    lineage_id: "shared-director-lineage",
    thread_id: "shared-director-thread",
    generation: 1,
  };
  const preparedRecipient = {
    host_id: "fixture-host",
    ...director,
    binding_digest: recipientBindingDigest(director),
  };
  await bindRecipient({
    stateRoot: runtimeStateRoot,
    recipient: director,
    fenceToken: "runtime-director-fence",
  });
  await bindRecipient({
    stateRoot: reportingStateRoot,
    recipient: director,
    fenceToken: "shared-director-fence",
  });
  const recipientRecord = recipientPaths(reportingStateRoot, director.lineage_id).registry;
  const originalRecipientBytes = await readFile(recipientRecord, "utf8");

  const first = await coordinatorRun(root, "first", 1);

  const firstPreparation = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: planPath,
    recipient: preparedRecipient,
    iterationLabel: "Shared director first",
    purpose: "First route",
    outcome: "Register the first coordinator route.",
    scope: ["Register the first route."],
    acceptanceCriteria: ["The first route remains active."],
    constraints: [],
    reasons: [],
    now: TIME + 3_000,
  });
  const secondPreparation = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: planPath,
    recipient: preparedRecipient,
    iterationLabel: "Shared director second",
    purpose: "Second route",
    outcome: "Register the second coordinator route.",
    scope: ["Register the second route."],
    acceptanceCriteria: ["The shared recipient stays unchanged."],
    constraints: [],
    reasons: [],
    now: TIME + 4_000,
  });

  const register = (active, preparation, now) => registerCoordinatorReportRoute({
    stateRoot: runtimeStateRoot,
    runId: active.run.run_id,
    senderThreadId: active.lineage.thread_id,
    senderHostId: "fixture-host",
    recipient: preparation.preparation.recipient,
    approvedPlanPath: preparation.preparation.approved_plan.snapshot_path,
    approvedPlanDigest: preparation.preparation.approved_plan.digest,
    iterationLabel: preparation.preparation.iteration_label,
    purpose: preparation.preparation.purpose,
    repositoryRoot: root,
    repositoryBranch: "main",
    now,
  });

  const firstRegistration = await register(first, firstPreparation, TIME + 5_000);
  assert.equal(firstRegistration.status, "registered");
  assert.equal(await readFile(recipientRecord, "utf8"), originalRecipientBytes);

  await abandonRun({
    gitCommonDirectory: commonDir,
    runId: first.run.run_id,
    resume: first.run.binding,
    reason: "Finish the first sequential route-registration fixture.",
    abandonedAt: new Date(TIME + 5_500).toISOString(),
  });
  const second = await coordinatorRun(root, "second", 6);
  assert.notEqual(first.run.binding.fence_token, second.run.binding.fence_token);

  const secondRegistration = await register(second, secondPreparation, TIME + 7_000);
  assert.equal(secondRegistration.status, "registered");
  assert.equal(await readFile(recipientRecord, "utf8"), originalRecipientBytes);
  assert.equal((await reportRoute({
    stateRoot: reportingStateRoot,
    routeId: firstRegistration.route.route_id,
  })).state, "active");

  const replay = await register(second, secondPreparation, TIME + 8_000);
  assert.equal(replay.status, "already-registered");
  assert.equal(replay.route.route_id, secondRegistration.route.route_id);
  assert.equal(await readFile(recipientRecord, "utf8"), originalRecipientBytes);

  const routeRecord = resolve(
    reportingStateRoot,
    "reports",
    "routes",
    "records",
    `${secondRegistration.route.route_id}.json`,
  );
  await rm(routeRecord);
  const retainedAssignment = await assignmentAuthority({
    stateRoot: reportingStateRoot,
    assignmentId: secondRegistration.route.assignment.assignment_id,
  });
  const retainedIteration = await iterationStatus({
    commonDir,
    iterationId: retainedAssignment.iteration_id,
  });
  assert.equal(retainedIteration.assignment_id, retainedAssignment.assignment_id);

  const recovered = await register(second, secondPreparation, TIME + 9_000);
  assert.equal(recovered.status, "registered");
  assert.equal(recovered.route.route_id, secondRegistration.route.route_id);
  assert.equal(await readFile(recipientRecord, "utf8"), originalRecipientBytes);

  const mismatched = {
    ...preparedRecipient,
    thread_id: "different-director-thread",
    binding_digest: recipientBindingDigest({
      ...director,
      thread_id: "different-director-thread",
    }),
  };
  await assert.rejects(
    () => registerCoordinatorReportRoute({
      stateRoot: runtimeStateRoot,
      runId: second.run.run_id,
      senderThreadId: second.lineage.thread_id,
      senderHostId: "fixture-host",
      recipient: mismatched,
      approvedPlanPath: secondPreparation.preparation.approved_plan.snapshot_path,
      approvedPlanDigest: secondPreparation.preparation.approved_plan.digest,
      iterationLabel: secondPreparation.preparation.iteration_label,
      purpose: secondPreparation.preparation.purpose,
      repositoryRoot: root,
      repositoryBranch: "main",
      now: TIME + 10_000,
    }),
    /does not match an authoritative lineage binding/,
  );

  const nextDirector = {
    lineage_id: director.lineage_id,
    thread_id: "shared-director-next-thread",
    generation: 2,
  };
  await rebindRecipient({
    stateRoot: runtimeStateRoot,
    recipient: nextDirector,
    fenceToken: "runtime-director-fence",
    nextFenceToken: "runtime-director-next-fence",
  });
  await rebindRecipient({
    stateRoot: reportingStateRoot,
    recipient: nextDirector,
    fenceToken: "shared-director-fence",
    nextFenceToken: "shared-director-next-fence",
  });
  await assert.rejects(
    () => register(second, secondPreparation, TIME + 11_000),
    /generation is stale/,
  );

  const currentRecipient = {
    host_id: "fixture-host",
    ...nextDirector,
    binding_digest: recipientBindingDigest(nextDirector),
  };
  const generationTwoBytes = await readFile(recipientRecord, "utf8");
  await abandonRun({
    gitCommonDirectory: commonDir,
    runId: second.run.run_id,
    resume: second.run.binding,
    reason: "Finish the second sequential route-registration fixture.",
    abandonedAt: new Date(TIME + 12_000).toISOString(),
  });
  const third = await coordinatorRun(root, "third", 13);
  const thirdPreparation = await prepareCoordinatorAssignment({
    commonDir,
    approvedPlanPath: planPath,
    recipient: currentRecipient,
    iterationLabel: "Shared director third",
    purpose: "Current generation route",
    outcome: "Register through the actual CLI with current generation two.",
    scope: ["Register the generation-two route."],
    acceptanceCriteria: ["The CLI preserves the current recipient bytes."],
    constraints: [],
    reasons: [],
    now: TIME + 14_000,
  });
  const cliRequestPath = resolve(root, "coordinator-route-request.json");
  await writeFile(cliRequestPath, `${JSON.stringify({
    run_id: third.run.run_id,
    sender_thread_id: third.lineage.thread_id,
    preparation_id: thirdPreparation.preparation.preparation_id,
  })}\n`, "utf8");
  await writeFile(resolve(root, ".git", "codex-thread.json"), `${JSON.stringify({
    version: 1,
    ownerThreadId: third.lineage.thread_id,
  })}\n`, "utf8");
  const cliRegistration = runCli([
    "report", "route", "coordinator",
    "--run-id", third.run.run_id,
    "--file", cliRequestPath,
    "--json",
  ], {
    cwd: root,
    env: { CODEX_THREAD_ID: third.lineage.thread_id },
  });
  assertSuccess(cliRegistration, "generation-two coordinator route registration");
  assert.equal(JSON.parse(cliRegistration.stdout).status, "registered");
  assert.equal(await readFile(recipientRecord, "utf8"), generationTwoBytes);
});
