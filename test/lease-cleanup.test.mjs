import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertSuccess, createGitFixture, initializeFixture, removeFixture, runCli } from "./helpers.mjs";
import { PACKAGE_VERSION } from "../lib/core.mjs";

test("exclusive leases prevent competing owners and release idempotently", async () => {
  const root = await createGitFixture("codex-flow-lease-");
  try {
    initializeFixture([], { cwd: root });
    const acquired = runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-a", "--ttl-seconds", "60", "--json",
    ], { cwd: root });
    assertSuccess(acquired, "lease acquire");
    const lease = JSON.parse(acquired.stdout).lease;
    assert.equal(lease.state, "active");
    assertSuccess(runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-a", "--ttl-seconds", "60",
    ], { cwd: root }), "same-owner idempotent acquire");

    const conflict = runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-b", "--ttl-seconds", "60",
    ], { cwd: root });
    assert.equal(conflict.status, 73);
    assert.match(conflict.stderr, /owned by executor-a/);

    const wrongRelease = runCli([
      "lease", "release", "--resource", "browser", "--owner", "executor-b",
    ], { cwd: root });
    assert.equal(wrongRelease.status, 73);
    const missingToken = runCli([
      "lease", "release", "--resource", "browser", "--owner", "executor-a",
    ], { cwd: root });
    assert.equal(missingToken.status, 73);
    assert.match(missingToken.stderr, /acquisition token/);
    assertSuccess(runCli([
      "lease", "release", "--resource", "browser", "--owner", "executor-a", "--token", lease.token,
    ], { cwd: root }), "lease release");
    assertSuccess(runCli([
      "lease", "release", "--resource", "browser", "--owner", "executor-a",
    ], { cwd: root }), "idempotent absent release");
  } finally {
    await removeFixture(root);
  }
});

test("an expired holder token cannot release a replacement lease with the same owner name", async () => {
  const root = await createGitFixture("codex-flow-lease-fence-");
  try {
    initializeFixture([], { cwd: root });
    const first = runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-a", "--ttl-seconds", "60", "--json",
    ], { cwd: root });
    assertSuccess(first, "first lease");
    const firstLease = JSON.parse(first.stdout).lease;
    const leasePath = resolve(root, ".git", "codex-flow", `v${PACKAGE_VERSION}`, "leases", "browser", "lease.json");
    const stored = JSON.parse(await readFile(leasePath, "utf8"));
    stored.expires_at = "2000-01-01T00:00:00.000Z";
    await writeFile(leasePath, JSON.stringify(stored), "utf8");

    const replacement = runCli([
      "lease", "acquire", "--resource", "browser", "--owner", "executor-a",
      "--ttl-seconds", "60", "--break-expired", "--json",
    ], { cwd: root });
    assertSuccess(replacement, "replacement lease");
    const replacementLease = JSON.parse(replacement.stdout).lease;
    assert.notEqual(replacementLease.token, firstLease.token);

    const staleRelease = runCli([
      "lease", "release", "--resource", "browser", "--owner", "executor-a", "--token", firstLease.token,
    ], { cwd: root });
    assert.equal(staleRelease.status, 73);
    assert.match(staleRelease.stderr, /token does not match/);
    const status = runCli(["lease", "status", "--resource", "browser", "--json"], { cwd: root });
    assertSuccess(status, "replacement lease status");
    assert.equal(JSON.parse(status.stdout)[0].owner, "executor-a");
    assert.equal(JSON.parse(status.stdout)[0].state, "active");
  } finally {
    await removeFixture(root);
  }
});

test("cleanup is audit-only and reports repository-scoped state", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    assertSuccess(runCli([
      "lease", "acquire", "--resource", "creator", "--owner", "executor-a", "--ttl-seconds", "60",
    ], { cwd: root }));
    const audit = runCli(["cleanup", "audit", "--json"], { cwd: root });
    assertSuccess(audit, "cleanup audit");
    const report = JSON.parse(audit.stdout);
    assert.equal(report.mutation_performed, false);
    assert.equal(report.leases.length, 1);
    assert.ok(report.state_root.endsWith(`/.git/codex-flow/v${PACKAGE_VERSION}`));
  } finally {
    await removeFixture(root);
  }
});
