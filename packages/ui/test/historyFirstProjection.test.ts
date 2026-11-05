import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createInitialConversationSnapshot,
  type ConversationTopicFrame,
} from "@zcode/shared/zcode-protocol-v4";
import { ConversationProjectionStore } from "../src/v4/conversationProjectionStore.js";
import type { ConversationProjectionTransport } from "../src/v4/transport.js";

(
  globalThis as typeof globalThis & { __ZCODE_RENDERER_DISABLE_LOGGING__: boolean }
).__ZCODE_RENDERER_DISABLE_LOGGING__ = true;

test("history-first projection keeps history on failure and retries the exact attempt", async () => {
  const topic = "conversation/history";
  const attemptId = "attempt-1";
  let store!: ConversationProjectionStore;
  let subscription = 0;
  const subscribeCalls: unknown[] = [];
  const subscribe = async (params: unknown) => {
    subscribeCalls.push(params);
    return {
      ack: {
        subscriptionId: `sub-${++subscription}`,
        mode: "snapshot" as const,
        logEpoch: "epoch-1",
      },
    };
  };
  const transport = {
    subscribe,
    activate(subscriptionId: string) {
      const snapshot = createInitialConversationSnapshot("history", "epoch-1");
      snapshot.seq = subscription;
      snapshot.revision = subscription;
      snapshot.runtimeInitialization = {
        status: subscription === 1 ? "initializing" : "ready",
        attemptId,
      };
      snapshot.rows = {
        window: [
          {
            kind: "userInput",
            rowId: 1,
            turnId: "turn-1",
            createdAt: 1,
            createdAtSeq: 1,
            text: "durable history",
            origin: "realUser",
          },
        ],
        totalCount: 1,
        firstRowId: 1,
      };
      store.handleFrame(
        {
          topic,
          subscriptionId,
          fromSeq: 0,
          toSeq: subscription,
          sentAt: Date.now(),
          payload: { kind: "snapshot", snapshot },
        } satisfies ConversationTopicFrame,
        { deliveryKind: "initial" },
      );
    },
    unsubscribe: async () => undefined,
    onAssemblyFault: () => () => undefined,
    onRuntimeRestart: () => () => undefined,
  } as unknown as ConversationProjectionTransport;
  store = new ConversationProjectionStore(topic, transport);
  await store.connect();
  assert.equal(store.getState().snapshot?.rows.window[0]?.kind, "userInput");
  assert.equal(store.getState().snapshot?.runtimeInitialization?.status, "initializing");
  store.handleFrame(
    {
      topic,
      subscriptionId: "sub-1",
      fromSeq: 1,
      toSeq: 2,
      sentAt: Date.now(),
      payload: {
        kind: "deltas",
        deltas: [
          {
            op: "state.updated",
            patch: {
              runtimeInitialization: {
                status: "failed",
                attemptId,
                reasonCode: "fault.subscribe.resumeFailed",
                message: "runtime unavailable",
              },
            },
          },
        ],
      },
    },
    { deliveryKind: "online" },
  );
  assert.equal(store.getState().status, "live");
  assert.equal(store.getState().snapshot?.rows.window[0]?.kind, "userInput");
  assert.equal(store.getState().snapshot?.runtimeInitialization?.status, "failed");
  await store.retry();
  assert.equal(
    (subscribeCalls.at(-1) as { retryInitialization?: string }).retryInitialization,
    attemptId,
  );
  assert.equal(store.getState().snapshot?.runtimeInitialization?.status, "ready");
  await store.close();
});
