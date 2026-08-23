import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validatePlan } from "../lib/plan.mjs";
import { applyTaskDefaults, renderTaskPacket, validateTaskPacket } from "../lib/task-packet.mjs";
import { packageRoot } from "./helpers.mjs";

test("example plan validates into deterministic parallel waves", async () => {
  const raw = JSON.parse(await readFile(resolve(packageRoot, "examples/parallel-plan.json"), "utf8"));
  const plan = validatePlan(raw, { projectMaxConcurrency: 2 });
  assert.deepEqual(plan.waves, [["contract"], ["slice-a", "slice-b"], ["integration"]]);
});

test("plan rejects unordered overlapping write ownership", () => {
  assert.throws(() => validatePlan({
    schema_version: 1,
    plan_id: "conflict",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      { id: "a", title: "A", mode: "write", dependencies: [], write_paths: ["src"], shared_resources: [], serial_gate: false },
      { id: "b", title: "B", mode: "write", dependencies: [], write_paths: ["src/b"], shared_resources: [], serial_gate: false },
    ],
  }), /overlapping write paths/);
});

test("plan rejects dependency cycles and unordered exclusive resources", () => {
  assert.throws(() => validatePlan({
    schema_version: 1,
    plan_id: "cycle",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      { id: "a", title: "A", mode: "write", dependencies: ["b"], write_paths: ["a"], shared_resources: [], serial_gate: false },
      { id: "b", title: "B", mode: "write", dependencies: ["a"], write_paths: ["b"], shared_resources: [], serial_gate: false },
    ],
  }), /cycle/);
  assert.throws(() => validatePlan({
    schema_version: 1,
    plan_id: "resource",
    baseline_revision: "abc",
    max_concurrency: 2,
    tasks: [
      { id: "a", title: "A", mode: "read", dependencies: [], write_paths: [], shared_resources: ["browser"], serial_gate: false },
      { id: "b", title: "B", mode: "read", dependencies: [], write_paths: [], shared_resources: ["browser"], serial_gate: false },
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
