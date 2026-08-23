import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  initializeFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

async function snapshotFiles(root) {
  const snapshot = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await lstat(path, { bigint: true });
        const contents = await readFile(path);
        snapshot[relative(root, path)] = {
          hash: createHash("sha256").update(contents).digest("hex"),
          mtime_ns: info.mtimeNs.toString(),
        };
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("init preserves a Python repository and installs a pinned runtime idempotently", async () => {
  const root = await createGitFixture("codex-flow-python-");
  try {
    const originalAgents = "# Python Conventions\n\nUse uv and pytest.\n";
    await writeFile(resolve(root, "AGENTS.md"), originalAgents, "utf8");
    await writeFile(resolve(root, "pyproject.toml"), "[project]\nname = \"fixture\"\nversion = \"0.0.0\"\n", "utf8");

    const first = initializeFixture([
      "--model", "gpt-5.5",
      "--reasoning-effort", "high",
      "--max-concurrency", "3",
    ], { cwd: root }).applied;
    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith(originalAgents.trimEnd()));
    assert.equal((agents.match(/codex-flow:start/g) ?? []).length, 1);
    assert.equal((agents.match(/codex-flow:end/g) ?? []).length, 1);
    const config = JSON.parse(await readFile(resolve(root, ".codex/orchestration/project.json"), "utf8"));
    assert.equal(config.default_model, "gpt-5.5");
    assert.equal(config.default_reasoning_effort, "high");
    assert.equal(config.max_parallel_executors, 3);
    await readFile(resolve(root, ".codex/orchestration/bin/codex-flow.mjs"));
    await assert.rejects(readFile(resolve(root, "package.json")), { code: "ENOENT" });

    const beforeCheck = await snapshotFiles(root);
    assertSuccess(runCli(["init", "--check"], { cwd: root }), "init check");
    assert.deepEqual(await snapshotFiles(root), beforeCheck);
    const second = initializeFixture([], { cwd: root }).applied;
    assert.equal(JSON.parse(second.stdout).changed, false);

    const doctor = runCli(["doctor", "--json"], {
      cwd: root,
      env: { CODEX_FLOW_CODEX_BIN: resolve(root, "missing-codex") },
    });
    assertSuccess(doctor, "doctor");
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.project.project_id, root.split("/").at(-1));
    assert.equal(report.thread_creation, "runtime-probe-required");
  } finally {
    await removeFixture(root);
  }
});

test("sync removes obsolete manifest-owned files and preserves project configuration", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture(["--project-id", "obsolete-fixture"], { cwd: root });
    const runtimeRoot = resolve(root, ".codex/orchestration");
    const obsoletePath = resolve(runtimeRoot, "lib/obsolete.mjs");
    const obsoleteContents = "export const retired = true;\n";
    await writeFile(obsoletePath, obsoleteContents, "utf8");
    const manifestPath = resolve(runtimeRoot, "version.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["lib/obsolete.mjs"] = createHash("sha256")
      .update(obsoleteContents)
      .digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const configBefore = await readFile(resolve(runtimeRoot, "project.json"), "utf8");

    assertSuccess(runCli(["sync"], { cwd: root }), "obsolete-file sync");
    await assert.rejects(readFile(obsoletePath), { code: "ENOENT" });
    assert.equal(await readFile(resolve(runtimeRoot, "project.json"), "utf8"), configBefore);
    assertSuccess(runCli(["sync", "--check"], { cwd: root }), "post-upgrade check");
  } finally {
    await removeFixture(root);
  }
});

test("sync refuses locally modified managed runtime files", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    const managed = resolve(root, ".codex/orchestration/lib/core.mjs");
    await writeFile(managed, "// local drift\n", "utf8");
    const refused = runCli(["sync"], { cwd: root });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /local drift/);
    assertSuccess(runCli(["sync", "--force"], { cwd: root }), "forced reviewed sync");
    assert.doesNotMatch(await readFile(managed, "utf8"), /local drift/);
  } finally {
    await removeFixture(root);
  }
});

test("init fails closed on malformed AGENTS managed markers", async () => {
  const root = await createGitFixture();
  try {
    await writeFile(resolve(root, "AGENTS.md"), "<!-- codex-flow:start v0.0.1 -->\n", "utf8");
    const result = runCli(["init", "--plan"], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /malformed or duplicate/);
  } finally {
    await removeFixture(root);
  }
});

test("init fails closed when AGENTS managed markers are reversed", async () => {
  const root = await createGitFixture();
  try {
    await writeFile(resolve(root, "AGENTS.md"), [
      "# Existing guidance",
      "<!-- codex-flow:end -->",
      "keep this text",
      "<!-- codex-flow:start v0.0.1 -->",
      "",
    ].join("\n"), "utf8");
    const before = await readFile(resolve(root, "AGENTS.md"), "utf8");
    const result = runCli(["init", "--plan"], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /malformed or duplicate/);
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), before);
  } finally {
    await removeFixture(root);
  }
});

test("project defaults can be changed after initialization and resolved per task", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    const changed = runCli([
      "config", "set",
      "--model", "gpt-5.6-luna",
      "--reasoning-effort", "medium",
      "--max-concurrency", "4",
      "--json",
    ], { cwd: root });
    assertSuccess(changed, "config set");
    assert.deepEqual(JSON.parse(changed.stdout), {
      schema_version: 2,
      project_id: root.split("/").at(-1),
      max_parallel_executors: 4,
      callback_transport: "codex-queue",
      default_model: "gpt-5.6-luna",
      default_reasoning_effort: "medium",
      agents_integration: { mode: "managed" },
    });

    const packetPath = resolve(root, "packet.json");
    const packet = JSON.parse(await readFile(resolve(import.meta.dirname, "../examples/task-packet.json"), "utf8"));
    packet.model = null;
    packet.reasoning_effort = null;
    await writeFile(packetPath, JSON.stringify(packet), "utf8");
    const rendered = runCli(["task", "packet", "render", packetPath, "--json"], { cwd: root });
    assertSuccess(rendered, "resolved task packet");
    assert.equal(JSON.parse(rendered.stdout).model, "gpt-5.6-luna");
    assert.equal(JSON.parse(rendered.stdout).reasoning_effort, "medium");
    const perTaskHostDefault = runCli([
      "task", "packet", "render", packetPath,
      "--model", "host-default",
      "--reasoning-effort", "host-default",
      "--json",
    ], { cwd: root });
    assertSuccess(perTaskHostDefault, "per-task host default");
    assert.equal(JSON.parse(perTaskHostDefault.stdout).model, null);
    assert.equal(JSON.parse(perTaskHostDefault.stdout).reasoning_effort, null);

    assertSuccess(runCli([
      "config", "set", "--model", "host-default", "--reasoning-effort", "host-default",
    ], { cwd: root }), "host-default config");
    const shown = runCli(["config", "show", "--json"], { cwd: root });
    assertSuccess(shown, "config show");
    assert.equal(JSON.parse(shown.stdout).default_model, null);
    assert.equal(JSON.parse(shown.stdout).default_reasoning_effort, null);
  } finally {
    await removeFixture(root);
  }
});
