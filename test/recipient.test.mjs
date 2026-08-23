import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  bindRecipient,
  currentRecipient,
  recipientStatus,
  recipientStatuses,
  rebindRecipient,
  resolveRecipient,
} from "../lib/recipients.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

test("recipient registry fences rebinding and resolves only recorded lineage generations", async () => {
  const root = await createGitFixture("codex-flow-recipient-");
  try {
    const stateRoot = resolve(root, ".git", "codex-flow");
    const initial = await bindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-1",
        generation: 1,
      },
    });
    assert.equal(initial.status, "bound");
    assert.equal((await currentRecipient({ stateRoot, lineageId: "coordinator-lineage" })).thread_id, "coordinator-thread-1");
    const repeated = await bindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-1",
        generation: 1,
      },
    });
    assert.equal(repeated.status, "already-bound");
    assert.equal(repeated.recipient.fence_token, undefined);
    const replayWithToken = await bindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-1",
        generation: 1,
      },
      fenceToken: initial.recipient.fence_token,
    });
    assert.equal(replayWithToken.recipient.fence_token, initial.recipient.fence_token);

    const rebound = await rebindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-2",
        generation: 2,
      },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "coordinator-fence-2",
    });
    assert.equal(rebound.status, "rebound");
    const repeatedRebind = await rebindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-2",
        generation: 2,
      },
      fenceToken: initial.recipient.fence_token,
      nextFenceToken: "coordinator-fence-2",
    });
    assert.equal(repeatedRebind.status, "already-rebound");
    const status = await recipientStatus({ stateRoot, lineageId: "coordinator-lineage" });
    assert.equal(status.current.thread_id, "coordinator-thread-2");
    assert.equal(status.current.fence_token, undefined);
    assert.equal((await recipientStatuses({ stateRoot }))[0].binding_count, 2);
    const stale = await resolveRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-1",
        generation: 1,
      },
    });
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.recipient, {
      lineage_id: "coordinator-lineage",
      thread_id: "coordinator-thread-2",
      generation: 2,
    });
    await assert.rejects(
      rebindRecipient({
        stateRoot,
        recipient: {
          lineage_id: "coordinator-lineage",
          thread_id: "coordinator-thread-3",
          generation: 3,
        },
        fenceToken: initial.recipient.fence_token,
      }),
      /fence token does not match/,
    );
    await assert.rejects(
      resolveRecipient({
        stateRoot,
        recipient: {
          lineage_id: "coordinator-lineage",
          thread_id: "forged-thread",
          generation: 1,
        },
      }),
      /does not match an authoritative lineage binding/,
    );
    await assert.rejects(
      rebindRecipient({
        stateRoot,
        recipient: {
          lineage_id: "coordinator-lineage",
          thread_id: "coordinator-thread-3",
          generation: 4,
        },
        fenceToken: rebound.recipient.fence_token,
      }),
      /must advance generation 2 to 3/,
    );
    await assert.rejects(
      rebindRecipient({
        stateRoot,
        recipient: {
          lineage_id: "coordinator-lineage",
          thread_id: "coordinator-thread-2",
          generation: 3,
        },
        fenceToken: rebound.recipient.fence_token,
      }),
      /different thread/,
    );
  } finally {
    await removeFixture(root);
  }
});
