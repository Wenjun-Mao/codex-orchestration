#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_INPUT_BYTES = 128 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function isContained(root, target) {
  const child = relative(root, target);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function assertRegularTree(root) {
  const lexicalRoot = resolve(root);
  const rootInfo = await lstat(lexicalRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Report runtime root is not a real directory");
  const realRoot = await realpath(lexicalRoot);
  const files = [];
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      if (!isContained(lexicalRoot, path) || entry.isSymbolicLink()) throw new Error("Report runtime contains an unsafe entry");
      const actual = await realpath(path);
      if (!isContained(realRoot, actual)) throw new Error("Report runtime resolves outside its root");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(lexicalRoot, path).split(sep).join("/"));
      else throw new Error("Report runtime contains an unsupported entry");
    }
  };
  await visit(lexicalRoot);
  return files.sort();
}

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) throw new Error("Stop hook input exceeds its limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function pluginDataRoot() {
  const value = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA ?? "";
  if (!isAbsolute(value)) throw new Error("Plugin data path is unavailable");
  return resolve(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function optionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function gitCommonDirectory(cwd) {
  if (!isAbsolute(cwd)) return null;
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function validateLocator(value, sessionId) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schema_version !== 1
    || value.kind !== "codex-flow-report-route-locator-v1"
    || value.sender_thread_id !== sessionId
    || !isAbsolute(value.state_root)
    || value.reporter === null
    || typeof value.reporter !== "object"
    || Array.isArray(value.reporter)
    || !DIGEST.test(value.reporter.runtime_sha256)
  ) throw new Error("Report route locator does not contain valid runtime authority");
  return value;
}

async function resolveLocator(event, dataRoot) {
  const senderDigest = sha256(Buffer.from(event.session_id));
  const dataLocator = await optionalJson(resolve(dataRoot, "report-hooks", "locators", `${senderDigest}.json`));
  if (dataLocator !== null) return { locator: validateLocator(dataLocator, event.session_id), senderDigest, scope: "data" };
  const commonDir = gitCommonDirectory(
    typeof event.cwd === "string" && isAbsolute(event.cwd) ? event.cwd : process.cwd(),
  );
  if (commonDir === null) return null;
  const path = resolve(commonDir, "codex-flow", "report-locators", "records", `${senderDigest}.json`);
  const locator = await optionalJson(path);
  if (locator === null) return null;
  const checked = validateLocator(locator, event.session_id);
  if (resolve(checked.state_root, "..", "..") !== commonDir) {
    throw new Error("Report route locator is outside the current repository");
  }
  return { locator: checked, senderDigest, scope: "repository", commonDir };
}

function runtimeRootFor({ resolved, dataRoot }) {
  const storage = resolved.scope === "repository"
    ? resolve(resolved.commonDir, "codex-flow", "report-locators", "runtimes")
    : resolve(dataRoot, "report-hooks", "runtimes");
  return resolve(storage, resolved.senderDigest, resolved.locator.reporter.runtime_sha256);
}

async function validateRuntime(root, expectedDigest) {
  const manifest = await readJson(resolve(root, "runtime.json"));
  if (
    manifest === null
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || manifest.schema_version !== 1
    || manifest.kind !== "codex-flow-report-runtime-v1"
    || manifest.runtime_sha256 !== expectedDigest
    || manifest.files === null
    || typeof manifest.files !== "object"
    || Array.isArray(manifest.files)
  ) throw new Error("Staged report runtime manifest is invalid");
  const seed = {
    schema_version: 1,
    kind: manifest.kind,
    package_version: manifest.package_version,
    files: manifest.files,
  };
  if (sha256(Buffer.from(stableStringify(seed))) !== expectedDigest) {
    throw new Error("Staged report runtime identity does not match its manifest");
  }
  const expectedFiles = [...Object.keys(manifest.files), "runtime.json"].sort();
  const actualFiles = await assertRegularTree(root);
  if (stableStringify(expectedFiles) !== stableStringify(actualFiles)) {
    throw new Error("Staged report runtime inventory does not match its manifest");
  }
  for (const [path, digest] of Object.entries(manifest.files)) {
    if (!DIGEST.test(digest) || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => ["", ".", ".."].includes(part))) {
      throw new Error("Staged report runtime manifest contains an unsafe file");
    }
    if (sha256(await readFile(resolve(root, path))) !== digest) {
      throw new Error("Staged report runtime file digest does not match");
    }
  }
  return resolve(root, "bin", "codex-flow-report-hook.mjs");
}

async function run() {
  const input = await readInput();
  if (input.length === 0) {
    process.stdout.write("{}\n");
    return;
  }
  let event;
  try {
    event = JSON.parse(input.toString("utf8"));
  } catch {
    process.stdout.write("{}\n");
    return;
  }
  if (
    !["Stop", "SubagentStop"].includes(event?.hook_event_name)
    || event?.stop_hook_active === true
    || typeof event?.session_id !== "string"
    || event.session_id === ""
  ) {
    process.stdout.write("{}\n");
    return;
  }
  const dataRoot = pluginDataRoot();
  const resolved = await resolveLocator(event, dataRoot);
  if (resolved === null) {
    process.stdout.write("{}\n");
    return;
  }
  const runtimeRoot = runtimeRootFor({ resolved, dataRoot });
  const entrypoint = await validateRuntime(runtimeRoot, resolved.locator.reporter.runtime_sha256);
  const child = spawn(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.stdin.end(input);
  const result = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => accept({ code, signal }));
  });
  if (result.signal !== null) throw new Error(`Staged report runtime exited from signal ${result.signal}`);
  process.exitCode = result.code ?? 1;
}

await run();
