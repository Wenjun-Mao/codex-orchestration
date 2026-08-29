#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ACCEPTED_TAG = "v0.5.1";
const ACCEPTED_COMMIT = "d03cabfffb612ad8f33853896b15deee3ad66698";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: options.encoding ?? "utf8",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      ...options.env,
    },
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout).trim();
    throw new Error(detail || `${command} ${args.join(" ")} failed`);
  }
  return result;
}

const repositoryRoot = run("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
}).stdout.trim();
const resolvedCommit = run("git", ["rev-parse", `${ACCEPTED_TAG}^{commit}`], {
  cwd: repositoryRoot,
}).stdout.trim();
if (resolvedCommit !== ACCEPTED_COMMIT) {
  throw new Error(
    `${ACCEPTED_TAG} resolves to ${resolvedCommit}; expected accepted commit ${ACCEPTED_COMMIT}`,
  );
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "codex-flow-v05-suite-"));
const archivePath = resolve(temporaryRoot, "source.tar");
const sourceRoot = resolve(temporaryRoot, "source");
try {
  await mkdir(sourceRoot);
  run("git", ["archive", "--format=tar", `--output=${archivePath}`, ACCEPTED_TAG], {
    cwd: repositoryRoot,
  });
  run("tar", ["-xf", archivePath, "-C", sourceRoot]);
  run("npm", ["test"], {
    cwd: sourceRoot,
    stdio: "inherit",
    encoding: undefined,
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
