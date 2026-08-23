import { execFileSync, spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { CliError } from "./core.mjs";

export function gitOutput(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim();
    throw new CliError(detail || `Git command failed: git ${args.join(" ")}`);
  }
}

export function discoverGit(cwd = process.cwd()) {
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  const absoluteCommon = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  });
  const rawCommon = absoluteCommon.status === 0
    ? absoluteCommon.stdout.trim()
    : gitOutput(cwd, ["rev-parse", "--git-common-dir"]);
  const commonDir = isAbsolute(rawCommon) ? rawCommon : resolve(cwd, rawCommon);
  return {
    root,
    commonDir,
    stateRoot: resolve(commonDir, "codex-flow"),
  };
}

export function gitSnapshot(cwd = process.cwd()) {
  const context = discoverGit(cwd);
  const branchResult = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: context.root,
    encoding: "utf8",
  });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : "detached";
  const revisionResult = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: context.root,
    encoding: "utf8",
  });
  const revision = revisionResult.status === 0 ? revisionResult.stdout.trim() : "unborn";
  const porcelain = gitOutput(context.root, ["status", "--porcelain=v1"]);
  let upstream = null;
  const upstreamResult = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
    cwd: context.root,
    encoding: "utf8",
  });
  if (upstreamResult.status === 0) upstream = upstreamResult.stdout.trim();
  return {
    ...context,
    branch,
    revision,
    upstream,
    cleanliness: porcelain === "" ? "clean" : "dirty",
  };
}
