import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  closeReportRoute,
  registerCoordinatorReportRoute,
  registerReportRoute,
  reportRoute,
  reportRoutes,
} from "../lib/report-routes.mjs";
import { bindRecipient } from "../lib/recipients.mjs";
import { recipientBindingDigest } from "../lib/task-results.mjs";
import { sha256 } from "../lib/core.mjs";
import { createActiveTaskLaunch } from "./v09-lifecycle-fixture.mjs";
import { createGitFixture } from "./helpers.mjs";

const TIME = Date.parse("2026-09-06T04:30:00.000Z");

async function destroy(context) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", context.executorPath], { cwd: context.root });
  } catch {
    // The fixture may already be removed by a failing-path assertion.
  }
  await rm(context.root, { recursive: true, force: true });
}

async function activeRoute(t, suffix) {
  const root = await createGitFixture(`codex-flow-report-route-${suffix}-`);
  const context = await createActiveTaskLaunch(root, suffix);
  t.after(() => destroy(context));
  const created = await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
    now: TIME,
  });
  return { context, created };
}

test("report route binds exactly one active launch sender to its current same-host coordinator", async (t) => {
  const { context, created } = await activeRoute(t, "exact");
  assert.equal(created.status, "registered");
  assert.equal(created.route.sender.thread_id, context.executorThreadId);
  assert.equal(created.route.recipient.thread_id, context.coordinator.thread_id);
  assert.equal(created.route.assignment.launch_id, context.launch.launch_id);
  assert.equal(created.route.sender.host_id, created.route.recipient.host_id);

  const replay = await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
    now: TIME + 1_000,
  });
  assert.equal(replay.status, "already-registered");
  assert.equal((await reportRoutes({ stateRoot: context.stateRoot, state: "active" })).length, 1);
});

test("report routes reject cross-host and preserve closure as a late-report fence", async (t) => {
  const root = await createGitFixture("codex-flow-report-route-host-");
  const context = await createActiveTaskLaunch(root, "host");
  t.after(() => destroy(context));
  await assert.rejects(
    () => registerReportRoute({
      stateRoot: context.stateRoot,
      launchId: context.launch.launch_id,
      senderHostId: "local",
      recipientHostId: "remote",
      now: TIME,
    }),
    /same sender and recipient host/,
  );

  const created = await registerReportRoute({
    stateRoot: context.stateRoot,
    launchId: context.launch.launch_id,
    senderHostId: "local",
    recipientHostId: "local",
    now: TIME,
  });
  const closed = await closeReportRoute({
    stateRoot: context.stateRoot,
    routeId: created.route.route_id,
    reason: "terminal",
    now: TIME + 1_000,
  });
  assert.equal(closed.status, "closed");
  assert.equal((await reportRoute({ stateRoot: context.stateRoot, routeId: created.route.route_id })).state, "closed");
  assert.equal(closed.route.lifecycle.closure_reason, "terminal");
  await assert.rejects(
    () => registerReportRoute({
      stateRoot: context.stateRoot,
      launchId: context.launch.launch_id,
      senderHostId: "local",
      recipientHostId: "local",
      now: TIME + 2_000,
    }),
    /Closed report route cannot be re-armed/,
  );
});

test("a coordinator delegation binds the active run and exact approved plan back to a director", async (t) => {
  const root = await createGitFixture("codex-flow-report-route-director-");
  const context = await createActiveTaskLaunch(root, "director");
  t.after(() => destroy(context));
  const director = {
    lineage_id: "director-lineage",
    thread_id: "director-thread",
    generation: 1,
  };
  await bindRecipient({ stateRoot: context.stateRoot, recipient: director });
  const result = await registerCoordinatorReportRoute({
    stateRoot: context.stateRoot,
    runId: context.launch.run_id,
    senderThreadId: context.coordinator.thread_id,
    senderHostId: "fixture-host",
    recipient: {
      host_id: "fixture-host",
      ...director,
      binding_digest: recipientBindingDigest(director),
    },
    approvedPlanPath: resolve(root, ".gitkeep"),
    approvedPlanDigest: sha256("fixture\n"),
    now: TIME,
  });
  assert.equal(result.status, "registered");
  assert.equal(result.route.assignment.kind, "coordinator-delegation");
  assert.equal(result.route.sender.thread_id, context.coordinator.thread_id);
  assert.equal(result.route.recipient.thread_id, director.thread_id);
  assert.equal((await reportRoute({ stateRoot: context.stateRoot, routeId: result.route.route_id })).route_id, result.route.route_id);

  await assert.rejects(
    () => registerCoordinatorReportRoute({
      stateRoot: context.stateRoot,
      runId: context.launch.run_id,
      senderThreadId: context.coordinator.thread_id,
      senderHostId: "fixture-host",
      recipient: {
        host_id: "fixture-host",
        ...director,
        binding_digest: recipientBindingDigest(director),
      },
      approvedPlanPath: resolve(root, ".gitkeep"),
      approvedPlanDigest: "0".repeat(64),
      now: TIME,
    }),
    /Approved plan digest/,
  );
});
