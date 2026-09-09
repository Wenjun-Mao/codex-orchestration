import { realpath } from "node:fs/promises";
import { readJson, requireExactFields, requireText, CliError } from "../../core.mjs";
import { gitOutput, gitSnapshot } from "../../git.mjs";
import { resolve } from "node:path";

/**
 * Confirms that the checkout about to persist coordinator cleanup authority is
 * owned by the current Codex task.  `CODEX_THREAD_ID` alone only identifies a
 * process; the host-created worktree administration is the binding between
 * that task and the checkout it is allowed to register.
 */
export async function assertCodexAppCoordinatorWorktree({
  repositoryPath,
  commonDir,
  coordinatorThreadId,
}) {
  const expectedCommonDir = await realpath(resolve(requireText(commonDir, "common_dir", { max: 2048 }))).catch(() => (
    resolve(commonDir)
  ));
  const expectedThreadId = requireText(coordinatorThreadId, "coordinator_thread_id", {
    max: 256,
    safeId: true,
  });
  const snapshot = gitSnapshot(repositoryPath);
  const observedCommonDir = await realpath(snapshot.commonDir).catch(() => resolve(snapshot.commonDir));
  if (observedCommonDir !== expectedCommonDir) {
    throw new CliError("Coordinator report route checkout belongs to a different Git repository", 73);
  }
  const gitDir = resolve(gitOutput(snapshot.root, [
    "rev-parse", "--path-format=absolute", "--git-dir",
  ]));
  const metadata = await readJson(resolve(gitDir, "codex-thread.json"), {
    allowMissing: true,
    guardRoot: expectedCommonDir,
  });
  if (metadata === null) {
    throw new CliError(
      "Coordinator report route requires Codex App worktree ownership evidence; run it from the exact coordinator worktree",
      73,
    );
  }
  requireExactFields(metadata, { required: ["version", "ownerThreadId"] }, "Codex coordinator worktree metadata");
  if (metadata.version !== 1) {
    throw new CliError("Codex coordinator worktree metadata has an unsupported version", 73);
  }
  const ownerThreadId = requireText(metadata.ownerThreadId, "Codex coordinator worktree owner", {
    max: 256,
    safeId: true,
  });
  if (ownerThreadId !== expectedThreadId) {
    throw new CliError("Coordinator report route checkout is owned by a different Codex task", 73);
  }
  return {
    source: "codex-app-private",
    owner_thread_id: ownerThreadId,
    worktree_path: snapshot.root,
    common_dir: snapshot.commonDir,
    branch: snapshot.branch,
    revision: snapshot.revision,
  };
}
