import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  bindRecipient,
  currentRecipient,
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
    assert.equal(
      (await bindRecipient({
        stateRoot,
        recipient: {
          lineage_id: "coordinator-lineage",
          thread_id: "coordinator-thread-1",
          generation: 1,
        },
      })).status,
      "already-bound",
    );

    const rebound = await rebindRecipient({
      stateRoot,
      recipient: {
        lineage_id: "coordinator-lineage",
        thread_id: "coordinator-thread-2",
        generation: 2,
      },
      fenceToken: initial.recipient.fence_token,
    });
    assert.equal(rebound.status, "rebound");
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
  } finally {
    await removeFixture(root);
  }
});
