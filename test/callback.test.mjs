import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { callbackIdFor, validateTerminalReceipt } from "../lib/callbacks.mjs";
import { cli } from "./helpers.mjs";
import { assertSuccess, createGitFixture, packageRoot, removeFixture, runCli } from "./helpers.mjs";

function receipt(executorId = "fixture-executor") {
  return {
    source_thread_id: "fixture-coordinator",
    executor_id: executorId,
    classification: "PASS",
    branch: `codex/${executorId}`,
    commit: "0123456789abcdef",
    upstream: `origin/codex/${executorId}`,
    cleanliness: "clean",
    result_or_blocker: "Bounded result complete.",
    next_decision: "Integrate once.",
    accounting: { PRODUCT: 1, CROSS_CUTTING_PRODUCT_FIX: 0, ENVIRONMENT: 0, PROOF_HARNESS: 1 },
  };
}

test("callback delivery persists, avoids duplicate normal retries, consumes once, and rejects unsafe receipts", async () => {
  const root = await createGitFixture("codex-flow-callback-");
  try {
    const capture = resolve(root, "calls.ndjson");
    const fake = resolve(root, "fake-codex.mjs");
    await writeFile(fake, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
if (process.argv[2] === "--version") process.exit(0);
appendFileSync(process.env.FAKE_CAPTURE, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.FAKE_MODE === "fail") process.exit(19);
`, "utf8");
    await chmod(fake, 0o700);
    const env = { CODEX_FLOW_CODEX_BIN: fake, FAKE_CAPTURE: capture };
    const receiptPath = resolve(root, "receipt.json");
    await writeFile(receiptPath, JSON.stringify(receipt()), "utf8");

    const first = runCli(["callback", "deliver", "--file", receiptPath, "--json"], { cwd: root, env });
    assertSuccess(first, "first callback delivery");
    const delivered = JSON.parse(first.stdout);
    assert.equal(delivered.status, "accepted");
    const calls = (await readFile(capture, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ["queue", "--thread", "fixture-coordinator"]);
    assert.match(calls[0][4], new RegExp(delivered.callback_id));

    assertSuccess(runCli(["callback", "deliver", "--file", receiptPath], { cwd: root, env }), "idempotent delivery");
    assert.equal((await readFile(capture, "utf8")).trim().split("\n").length, 1);

    const consume = runCli([
      "callback", "consume",
      "--callback-id", delivered.callback_id,
      "--source-thread-id", "fixture-coordinator",
      "--executor-id", "fixture-executor",
      "--json",
    ], { cwd: root });
    assertSuccess(consume, "callback consume");
    assert.equal(JSON.parse(consume.stdout).status, "consumed");
    assertSuccess(runCli([
      "callback", "consume",
      "--callback-id", delivered.callback_id,
      "--source-thread-id", "fixture-coordinator",
      "--executor-id", "fixture-executor",
    ], { cwd: root }), "idempotent consume");
    assertSuccess(runCli(["callback", "deliver", "--file", receiptPath], { cwd: root, env }), "post-consume retry");
    assert.equal((await readFile(capture, "utf8")).trim().split("\n").length, 1);

    const unknown = runCli(["callback", "deliver", "--no-queue"], {
      cwd: root,
      input: { ...receipt("unsafe-unknown"), raw_log: "forbidden" },
    });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /not allowed/);
    const secret = runCli(["callback", "deliver", "--no-queue"], {
      cwd: root,
      input: { ...receipt("unsafe-secret"), result_or_blocker: "token sk-abcdefghijklmnopqrstuv" },
    });
    assert.notEqual(secret.status, 0);
    assert.match(secret.stderr, /secret-like/);
  } finally {
    await removeFixture(root);
  }
});

test("callback consumption cannot overtake an in-flight queue delivery", async () => {
  const root = await createGitFixture("codex-flow-callback-race-");
  try {
    const capture = resolve(root, "queue-started");
    const fake = resolve(root, "slow-codex.mjs");
    await writeFile(fake, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") process.exit(0);
writeFileSync(process.env.FAKE_CAPTURE, "started\\n");
setTimeout(() => process.exit(0), 600);
`, "utf8");
    await chmod(fake, 0o700);
    const receiptPath = resolve(root, "receipt.json");
    const payload = receipt("race-executor");
    await writeFile(receiptPath, JSON.stringify(payload), "utf8");
    const callbackId = callbackIdFor(validateTerminalReceipt(payload));

    const child = spawn(process.execPath, [cli, "callback", "deliver", "--file", receiptPath, "--json"], {
      cwd: root,
      env: { ...process.env, CODEX_FLOW_CODEX_BIN: fake, FAKE_CAPTURE: capture },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await readFile(capture);
        break;
      } catch {
        await delay(20);
      }
    }
    await readFile(capture);

    const earlyConsume = runCli([
      "callback", "consume",
      "--callback-id", callbackId,
      "--source-thread-id", "fixture-coordinator",
      "--executor-id", "race-executor",
    ], { cwd: root });
    assert.equal(earlyConsume.status, 75);
    assert.match(earlyConsume.stderr, /already in progress/);

    const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
    assert.equal(exitCode, 0, stderr || stdout);
    assert.equal(JSON.parse(stdout).status, "accepted");
    const consume = runCli([
      "callback", "consume",
      "--callback-id", callbackId,
      "--source-thread-id", "fixture-coordinator",
      "--executor-id", "race-executor",
    ], { cwd: root });
    assertSuccess(consume, "post-delivery consume");
  } finally {
    await removeFixture(root);
  }
});

test("queue failure exits temporarily while retaining the durable receipt", async () => {
  const root = await createGitFixture();
  try {
    const fake = resolve(root, "fake-codex.mjs");
    await writeFile(fake, "#!/usr/bin/env node\nif (process.argv[2] === '--version') process.exit(0); process.exit(19);\n", "utf8");
    await chmod(fake, 0o700);
    const result = runCli(["callback", "deliver"], {
      cwd: root,
      env: { CODEX_FLOW_CODEX_BIN: fake },
      input: receipt("failed-queue"),
    });
    assert.equal(result.status, 75);
    const common = resolve(root, ".git", "codex-flow", "callbacks", "sources", "fixture-coordinator", "terminal", "failed-queue.json");
    await readFile(common);
  } finally {
    await removeFixture(root);
  }
});
