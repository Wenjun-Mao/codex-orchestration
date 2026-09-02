import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  observeCodexAppPrivateArchive,
  PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
  validatePrivateArchiveObservation,
} from "../lib/codex-app-private-archive-v07.mjs";

const THREAD_ID = "01a-private-archive-task";

function sessionBytes(threadId = THREAD_ID) {
  return `${JSON.stringify({
    timestamp: "2026-09-02T12:00:00.000Z",
    type: "session_meta",
    payload: {
      id: threadId,
      cwd: "/tmp/private-archive-repository",
      thread_source: "agent_created_thread",
      cli_version: "0.152.0",
    },
  })}\n`;
}

async function fixture(t) {
  const home = await mkdtemp(resolve(tmpdir(), "codex-flow-private-archive-"));
  await mkdir(resolve(home, "sessions", "2026", "09", "02"), { recursive: true });
  await mkdir(resolve(home, "archived_sessions"), { recursive: true });
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test("private archive observation binds one canonical archived session and no active counterpart", async (t) => {
  const home = await fixture(t);
  await writeFile(
    resolve(home, "archived_sessions", `rollout-2026-09-02T12-00-00-${THREAD_ID}.jsonl`),
    sessionBytes(),
  );
  const observed = await observeCodexAppPrivateArchive({
    threadId: THREAD_ID,
    codexHome: home,
    now: Date.parse("2026-09-02T12:05:00.000Z"),
  });
  assert.equal(observed.source, PRIVATE_ARCHIVE_OBSERVATION_SOURCE);
  assert.equal(observed.thread_id, THREAD_ID);
  assert.equal(observed.active_session_absent, true);
  assert.equal(observed.app_version, null);
  assert.equal(observed.host_cli_version, "0.152.0");
  assert.equal(observed.observed_at, "2026-09-02T12:05:00.000Z");
  assert.deepEqual(validatePrivateArchiveObservation(observed), observed);
  assert.doesNotMatch(JSON.stringify(observed), /archived_sessions|private-archive-repository/);
});

test("private archive observation rejects an active counterpart and ambiguous archive files", async (t) => {
  const home = await fixture(t);
  const archived = resolve(home, "archived_sessions", `rollout-a-${THREAD_ID}.jsonl`);
  await writeFile(archived, sessionBytes());
  const active = resolve(home, "sessions", "2026", "09", "02", `rollout-active-${THREAD_ID}.jsonl`);
  await writeFile(active, sessionBytes());
  await assert.rejects(
    () => observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home }),
    /still retains the exact task in active sessions/,
  );
  await rm(active);
  await writeFile(resolve(home, "archived_sessions", `rollout-b-${THREAD_ID}.jsonl`), sessionBytes());
  await assert.rejects(
    () => observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home }),
    /missing or ambiguous/,
  );
});

test("private archive observation rejects matching symlinks and metadata drift", async (t) => {
  const home = await fixture(t);
  const target = resolve(home, "target.jsonl");
  await writeFile(target, sessionBytes());
  await symlink(
    target,
    resolve(home, "archived_sessions", `rollout-link-${THREAD_ID}.jsonl`),
  );
  await assert.rejects(
    () => observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home }),
    /symbolic link/,
  );
  await rm(resolve(home, "archived_sessions", `rollout-link-${THREAD_ID}.jsonl`));
  await writeFile(
    resolve(home, "archived_sessions", `rollout-wrong-${THREAD_ID}.jsonl`),
    sessionBytes("01a-different-task"),
  );
  await assert.rejects(
    () => observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home }),
    /metadata does not match/,
  );
});
