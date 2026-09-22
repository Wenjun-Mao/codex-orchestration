import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  createPrivateArchiveSessionReader,
  observeCodexAppPrivateArchive,
  PRIVATE_ARCHIVE_OBSERVATION_SOURCE,
  validatePrivateArchiveObservation,
} from "../lib/adapters/codex-app/private-archive-observer.mjs";

const THREAD_ID = "01a-private-archive-task";
const READER_LIMITS = {
  chunkBytes: 64 * 1024,
  maxSessionBytes: 16 * 1024 * 1024 * 1024,
  maxSessionLines: 1_000_000,
  maxSessionRecordBytes: 32 * 1024 * 1024,
};

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

function eventBytes(payloadBytes = 64 * 1024) {
  return Buffer.from(`${JSON.stringify({
    type: "event",
    payload: { body: "x".repeat(payloadBytes) },
  })}\n`);
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    offset += bytesWritten;
  }
}

async function writeLargeSession(path, minimumBytes) {
  const handle = await open(path, "w");
  let written = 0;
  const digest = createHash("sha256");
  try {
    const metadata = Buffer.from(sessionBytes());
    await writeAll(handle, metadata);
    written += metadata.length;
    digest.update(metadata);
    const event = eventBytes();
    while (written <= minimumBytes) {
      await writeAll(handle, event);
      written += event.length;
      digest.update(event);
    }
  } finally {
    await handle.close();
  }
  return { digest: digest.digest("hex"), written };
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
  assert.equal(observed.session_digest, "ddc51724aa81566f9d387dcfed0b1709498182d1a7f2596b62853f22abf125ed");
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

test("private archive observation streams a valid history beyond the retired 32 MiB cap", async (t) => {
  const home = await fixture(t);
  const archived = resolve(home, "archived_sessions", `rollout-large-${THREAD_ID}.jsonl`);
  const { digest, written } = await writeLargeSession(archived, 32 * 1024 * 1024);
  assert.ok(written > 32 * 1024 * 1024);

  const observed = await observeCodexAppPrivateArchive({
    threadId: THREAD_ID,
    codexHome: home,
  });
  assert.equal(observed.session_digest, digest);
});

test("private archive observation accepts one near-maximum default record without quadratic assembly", async (t) => {
  const home = await fixture(t);
  const archived = resolve(home, "archived_sessions", `rollout-record-${THREAD_ID}.jsonl`);
  const metadata = Buffer.from(sessionBytes());
  const event = eventBytes((32 * 1024 * 1024) - 512);
  assert.ok(event.length <= READER_LIMITS.maxSessionRecordBytes);
  assert.ok(event.length > 31 * 1024 * 1024);
  await writeFile(archived, Buffer.concat([metadata, event]));

  const observed = await observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home });
  assert.equal(observed.session_digest, createHash("sha256").update(metadata).update(event).digest("hex"));
});

test("private archive observation reports configured stream, line, and record exhaustion distinctly", async (t) => {
  const home = await fixture(t);
  const archived = resolve(home, "archived_sessions", `rollout-limits-${THREAD_ID}.jsonl`);
  await writeFile(archived, `${sessionBytes()}${eventBytes(128)}`);

  await assert.rejects(
    () => observeCodexAppPrivateArchive({
      threadId: THREAD_ID,
      codexHome: home,
      resourceLimits: {
        chunkBytes: 16,
        maxSessionBytes: 32,
        maxSessionLines: 10,
        maxSessionRecordBytes: 1_024,
      },
    }),
    /streaming byte limit/,
  );
  await assert.rejects(
    () => observeCodexAppPrivateArchive({
      threadId: THREAD_ID,
      codexHome: home,
      resourceLimits: {
        chunkBytes: 16,
        maxSessionBytes: 1_024,
        maxSessionLines: 1,
        maxSessionRecordBytes: 1_024,
      },
    }),
    /non-empty line limit/,
  );
  await assert.rejects(
    () => observeCodexAppPrivateArchive({
      threadId: THREAD_ID,
      codexHome: home,
      resourceLimits: {
        chunkBytes: 16,
        maxSessionBytes: 1_024,
        maxSessionLines: 10,
        maxSessionRecordBytes: 32,
      },
    }),
    /record exceeding the configured byte limit/,
  );
});

test("private archive observation rejects conflicting metadata records", async (t) => {
  const home = await fixture(t);
  await writeFile(
    resolve(home, "archived_sessions", `rollout-conflict-${THREAD_ID}.jsonl`),
    `${sessionBytes()}${sessionBytes("01a-conflicting-task")}`,
  );
  await assert.rejects(
    () => observeCodexAppPrivateArchive({ threadId: THREAD_ID, codexHome: home }),
    /must contain one session_meta record/,
  );
});

for (const mutation of ["append", "replace", "truncate"]) {
  test(`private archive observation rejects ${mutation} during the streamed read`, async (t) => {
    const home = await fixture(t);
    const archived = resolve(home, "archived_sessions", `rollout-${mutation}-${THREAD_ID}.jsonl`);
    await writeLargeSession(archived, 256 * 1024);
    let changed = false;
    await assert.rejects(
      () => createPrivateArchiveSessionReader({
        onReadChunk: async () => {
          if (changed) return;
          changed = true;
          if (mutation === "append") {
            const handle = await open(archived, "a");
            try {
              await writeAll(handle, Buffer.from("\n"));
            } finally {
              await handle.close();
            }
          } else if (mutation === "replace") {
            const replacement = resolve(home, "archived_sessions", `replacement-${THREAD_ID}.jsonl`);
            await writeFile(replacement, sessionBytes());
            await rename(replacement, archived);
          } else {
            await writeFile(archived, sessionBytes());
          }
        },
      })(
        home,
        archived,
        "Codex App private archived task session",
        THREAD_ID,
        READER_LIMITS,
      ),
      /changed while it was being read/,
    );
    assert.equal(changed, true);
  });
}

test("private session reader rejects a path swap that is restored after descriptor open", async (t) => {
  const home = await fixture(t);
  const archived = resolve(home, "archived_sessions", `rollout-swap-${THREAD_ID}.jsonl`);
  const parked = resolve(home, "archived_sessions", `parked-${THREAD_ID}.jsonl`);
  await writeFile(archived, sessionBytes());
  let swapped = false;
  const reader = createPrivateArchiveSessionReader({
    openFile: async (...args) => {
      if (!swapped) {
        swapped = true;
        await rename(archived, parked);
        await writeFile(archived, sessionBytes());
        const handle = await open(...args);
        await rm(archived);
        await rename(parked, archived);
        return handle;
      }
      return await open(...args);
    },
  });
  await assert.rejects(
    () => reader(home, archived, "Codex App private archived task session", THREAD_ID, READER_LIMITS),
    /changed while it was being read/,
  );
  assert.equal(swapped, true);
});
