import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validatePlan } from "../lib/plan.mjs";
import {
  applyTaskDefaults,
  isLaunchExpired,
  renderTaskPacket,
  validateLaunchDeadline,
  validateTaskPacket,
} from "../lib/task-packet.mjs";
import { packageRoot } from "./helpers.mjs";

const FUTURE_LAUNCH_DEADLINE = {
  at: "2099-01-01T09:00:00-05:00",
  timezone: "America/Toronto",
};

function planTask(value) {
  return {
    role: "executor",
    execution_kind: "subagent",
    launch_deadline: FUTURE_LAUNCH_DEADLINE,
    ...value,
  };
}

test("example plan validates into deterministic parallel waves", async () => {
  const raw = JSON.parse(await readFile(resolve(packageRoot, "examples/parallel-plan.json"), "utf8"));
  const plan = validatePlan(raw, { projectMaxConcurrency: 2 });
  assert.deepEqual(plan.waves, [["contract"], ["slice-a", "slice-b"], ["integration"]]);
});

test("plan rejects unordered overlapping write ownership", () => {
  assert.throws(() => validatePlan({
    schema_version: 2,
    plan_id: "conflict",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      planTask({ id: "a", title: "A", mode: "write", dependencies: [], write_paths: ["src"], shared_resources: [], serial_gate: false }),
      planTask({ id: "b", title: "B", mode: "write", dependencies: [], write_paths: ["src/b"], shared_resources: [], serial_gate: false }),
    ],
  }), /overlapping write paths/);
});

test("plan rejects dependency cycles and unordered exclusive resources", () => {
  assert.throws(() => validatePlan({
    schema_version: 2,
    plan_id: "cycle",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      planTask({ id: "a", title: "A", mode: "write", dependencies: ["b"], write_paths: ["a"], shared_resources: [], serial_gate: false }),
      planTask({ id: "b", title: "B", mode: "write", dependencies: ["a"], write_paths: ["b"], shared_resources: [], serial_gate: false }),
    ],
  }), /cycle/);
  assert.throws(() => validatePlan({
    schema_version: 2,
    plan_id: "resource",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      planTask({ id: "a", title: "A", mode: "read", dependencies: [], write_paths: [], shared_resources: ["browser"], serial_gate: false }),
      planTask({ id: "b", title: "B", mode: "read", dependencies: [], write_paths: [], shared_resources: ["browser"], serial_gate: false }),
    ],
  }), /share exclusive resources/);
});

test("task packets resolve Terra xhigh defaults and preserve per-task overrides", async () => {
  const raw = JSON.parse(await readFile(resolve(packageRoot, "examples/task-packet.json"), "utf8"));
  raw.model = null;
  raw.reasoning_effort = null;
  const resolved = applyTaskDefaults(raw, {
    default_model: "gpt-5.6-terra",
    default_reasoning_effort: "xhigh",
  });
  assert.equal(resolved.model, "gpt-5.6-terra");
  assert.equal(resolved.reasoning_effort, "xhigh");
  assert.match(renderTaskPacket(resolved), /Model: `gpt-5\.6-terra`/);
  const override = validateTaskPacket({ ...resolved, model: "gpt-5.5", reasoning_effort: "high" });
  assert.equal(override.model, "gpt-5.5");
  assert.equal(override.reasoning_effort, "high");
});

test("task packets reject broad ownership and callback identity drift", async () => {
  const raw = JSON.parse(await readFile(resolve(packageRoot, "examples/task-packet.json"), "utf8"));
  assert.throws(() => validateTaskPacket({
    ...raw,
    ownership: { ...raw.ownership, write_paths: ["."] },
  }), /bounded repository-relative path/);
  assert.throws(() => validateTaskPacket({
    ...raw,
    callback: { ...raw.callback, executor_id: "different" },
  }), /must equal task_id/);
  assert.throws(() => validateTaskPacket({
    ...raw,
    ownership: { ...raw.ownership, write_paths: ["src", "src/feature"] },
  }), /overlapping paths/);
  assert.throws(() => validateTaskPacket({
    ...raw,
    ownership: { ...raw.ownership, exclusions: [raw.ownership.write_paths[0]] },
  }), /overlaps an explicit exclusion/);
});

test("v2 contracts fail closed on v1 and unknown or ambiguous execution kinds", async () => {
  const packet = JSON.parse(await readFile(resolve(packageRoot, "examples/task-packet.json"), "utf8"));
  const plan = JSON.parse(await readFile(resolve(packageRoot, "examples/parallel-plan.json"), "utf8"));
  assert.throws(() => validateTaskPacket({ ...packet, schema_version: 1 }), /Unsupported task packet schema_version/);
  assert.throws(() => validatePlan({ ...plan, schema_version: 1 }), /Unsupported plan schema_version/);
  assert.throws(() => validateTaskPacket({ ...packet, role: "coordinator-or-executor" }), /role must be one of/);
  assert.throws(() => validateTaskPacket({ ...packet, execution_kind: "task-thread-or-subagent" }), /execution_kind must be one of/);
  assert.throws(() => validatePlan({
    ...plan,
    tasks: [{ ...plan.tasks[0], execution_kind: "unknown" }, ...plan.tasks.slice(1)],
  }), /execution_kind must be one of/);
});

test("launch deadlines require explicit instants and report expiry without rejecting history", async () => {
  const deadline = validateLaunchDeadline({
    at: "2024-02-29T12:34:56.123+05:30",
    timezone: "America/Toronto",
  });
  assert.deepEqual(deadline, {
    at: "2024-02-29T12:34:56.123+05:30",
    timezone: "America/Toronto",
  });
  assert.equal(isLaunchExpired(deadline, Date.parse("2024-02-29T07:04:56.122Z")), false);
  assert.equal(isLaunchExpired(deadline, Date.parse("2024-02-29T07:04:56.123Z")), true);
  assert.throws(() => validateLaunchDeadline({
    at: "2024-02-29T12:34:56",
    timezone: "America/Toronto",
  }), /explicit UTC offset/);
  assert.throws(() => validateLaunchDeadline({
    at: "2024-02-29T12:34:56Z",
    timezone: "Invalid/Zone",
  }), /valid IANA timezone/);

  const raw = JSON.parse(await readFile(resolve(packageRoot, "examples/parallel-plan.json"), "utf8"));
  const historical = validatePlan(raw, {
    projectMaxConcurrency: 2,
    now: Date.parse("2100-01-01T00:00:00Z"),
  });
  assert.equal(historical.launch_expired, true);
  assert.ok(historical.tasks.every((task) => task.launch_expired));
});
