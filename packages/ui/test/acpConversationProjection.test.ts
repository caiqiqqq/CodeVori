import assert from "node:assert/strict";
import { ChannelClient, ChannelServer, createQueuePair, ProxyChannel } from "@zcode/rpc";
import type { IAcpService } from "@zcode/services";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acpSessionSchema } from "@zcode/shared";
import {
  createAcpService,
  type AcpConnectionFactory,
} from "../../services/src/acp/acpServiceImpl.js";
import { ConversationProjectionStore } from "../src/v4/conversationProjectionStore.js";
import { acquireAcpConversationProjection } from "../src/v4/acpConversationDataLayer.js";
import { createAcpConversationTransport } from "../src/v4/acpConversationTransport.js";

(
  globalThis as typeof globalThis & { __ZCODE_RENDERER_DISABLE_LOGGING__: boolean }
).__ZCODE_RENDERER_DISABLE_LOGGING__ = true;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "acp-v4-"));
  const workspace = { workspacePath: "/synthetic/v4", workspaceIdentity: "projection:a" };
  const saved = acpSessionSchema.parse({
    ...workspace,
    id: "11111111-1111-4111-8111-111111111111",
    agent: "codex",
    acpSessionId: "native",
    title: "synthetic",
    revision: 1,
    status: "idle",
    pendingPermission: null,
    error: null,
    entries: Array.from({ length: 3440 }, (_, index) => ({
      id: `${index % 2 ? "assistant" : "user"}:${index}`,
      kind: index % 2 ? "assistant" : "user",
      text: "合成历史".repeat(400),
      createdAt: index + 1,
    })),
  });
  await writeFile(join(directory, `${saved.id}.json`), JSON.stringify(saved));
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  let finish!: () => void;
  const turn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const service = createAcpService({
    directory,
    connect: async (input) => {
      update = input.onUpdate;
      return {
        sessionId: "native",
        configOptions: [],
        modeState: null,
        setConfigOption: async () => [],
        setMode: async () => {},
        prompt: () => turn,
        cancel: async () => finish(),
        close: finish,
      };
    },
  });
  const target = { ...workspace, id: saved.id };
  return {
    directory,
    workspace,
    target,
    service,
    update: (text: string) => update({ kind: "text", text }),
    finish,
    async cleanup() {
      finish();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function until(predicate: () => boolean, store: ConversationProjectionStore) {
  if (predicate()) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error("projection did not settle"));
    }, 5000);
    const off = store.subscribe(() => {
      if (predicate()) {
        clearTimeout(timeout);
        off();
        resolve();
      }
    });
  });
}

test("large-history command returns a small ACK and repairs a completely silent projection without resending", async () => {
  const f = await setup();
  const transport = createAcpConversationTransport(f.service, f.workspace, f.target.id, () => {});
  const store = new ConversationProjectionStore(`conversation/${f.target.id}`, transport);
  let silent = false;
  const off = transport.onFrame((frame, context) => {
    if (!silent || context?.deliveryKind !== "online") store.handleFrame(frame, context);
  });
  try {
    await store.connect();
    await f.service.refresh(f.target);
    silent = true;
    const accepted = await f.service.sendConversationCommand({
      ...f.target,
      commandId: "silent",
      type: "sendText",
      payload: { text: "PRIVATE CURRENT INPUT" },
    });
    const wire = JSON.stringify(accepted);
    assert.ok(wire.length < 1024, `ACK was ${wire.length} chars for 3440 entries`);
    assert.ok(!wire.includes("PRIVATE CURRENT INPUT"));
    assert.ok(!wire.includes("entries"));
    assert.ok(store.getState().snapshot!.seq < accepted.ack.revisionAtDecision);
    store.reconcileCommittedRevision(accepted.ack.revisionAtDecision);
    await until(() => store.getState().snapshot!.seq >= accepted.ack.revisionAtDecision, store);
    assert.ok(
      store
        .getState()
        .snapshot!.rows.window.some(
          (row) => row.kind === "userInput" && row.sourceCommandId === "silent",
        ),
    );
    assert.equal(
      (await f.service.read(f.target)).entries.filter((entry) => entry.id === "user:silent").length,
      1,
    );
    await store.loadOlder();
    assert.ok(store.getState().snapshot!.rows.window.length > 60);
  } finally {
    off();
    await store.close();
    transport.dispose();
    await f.cleanup();
  }
});

test("real ACP Host, V4 store and transport apply small deltas, page history and repair a lost frame", async () => {
  const f = await setup();
  const observed: number[] = [];
  const transport = createAcpConversationTransport(f.service, f.workspace, f.target.id, (change) =>
    observed.push(change.session.revision),
  );
  const store = new ConversationProjectionStore(`conversation/${f.target.id}`, transport);
  let drop = false;
  let duplicate = false;
  const off = transport.onFrame((frame, context) => {
    if (drop && context?.deliveryKind === "online") {
      drop = false;
      return;
    }
    store.handleFrame(frame, context);
    if (duplicate) store.handleFrame(frame, context);
  });
  try {
    await store.connect();
    assert.equal(store.getState().snapshot?.rows.window.length, 60);
    assert.equal(store.getState().snapshot?.rows.totalCount, 5160);
    await store.loadOlder();
    assert.equal(store.getState().snapshot?.rows.window.length, 120);
    const summaries = await f.service.listSummaries(f.workspace);
    assert.ok(JSON.stringify(summaries).length < 3000);
    await f.service.refresh(f.target);
    await f.service.submitPrompt({ ...f.target, commandId: "new", text: "新问题" });
    await f.update("首");
    const initialSeq = store.getState().snapshot!.seq;
    duplicate = true;
    await f.update("字");
    const reply = () =>
      store.getState().snapshot!.rows.window.findLast((row) => row.kind === "assistantText");
    assert.equal(reply()?.kind === "assistantText" && reply()!.text, "首字");
    assert.ok(store.getState().snapshot!.seq > initialSeq);
    drop = true;
    await f.update("丢帧");
    await f.update("恢复");
    await until(() => reply()?.kind === "assistantText" && reply()!.text === "首字丢帧恢复", store);
    assert.equal(
      store.getState().snapshot!.rows.window.length,
      60,
      "gap repair uses bounded authoritative snapshot",
    );
    await store.loadOlder();
    assert.equal(store.getState().snapshot!.rows.window.length, 120);
    await assert.rejects(
      f.service.readConversation({
        ...f.target,
        workspaceIdentity: "projection:b",
        subscriptionId: "foreign",
      }),
      /does not belong/,
    );
    assert.ok(observed.length > 0);
    await f.service.stop(f.target);
    assert.equal(store.getState().status, "live");
  } finally {
    off();
    await store.close();
    transport.dispose();
    await f.cleanup();
  }
});

test("notification before initial RPC ACK cannot replace its base or duplicate text", async () => {
  const f = await setup();
  await f.service.refresh(f.target);
  await f.service.submitPrompt({ ...f.target, commandId: "early", text: "新问题" });
  const wrapped = Object.create(f.service) as typeof f.service;
  wrapped.readConversation = async (input) => {
    const initial = await f.service.readConversation(input);
    await f.update("早到");
    return initial;
  };
  const transport = createAcpConversationTransport(wrapped, f.workspace, f.target.id, () => {});
  const store = new ConversationProjectionStore(`conversation/${f.target.id}`, transport);
  const off = transport.onFrame((frame, context) => store.handleFrame(frame, context));
  try {
    await store.connect();
    const rows = store.getState().snapshot!.rows.window;
    assert.equal(
      rows.filter((row) => row.kind === "assistantText" && row.text === "早到").length,
      1,
    );
    assert.equal(store.getState().status, "live");
  } finally {
    off();
    await store.close();
    transport.dispose();
    await f.cleanup();
  }
});

test("split panes reuse the existing data layer lease and one physical ACP subscription", async () => {
  const f = await setup();
  let subscriptions = 0;
  let releases = 0;
  const wrapped = Object.create(f.service) as typeof f.service;
  wrapped.onDynamicConversationChanged = (input) => (listener) => {
    subscriptions++;
    const subscription = f.service.onDynamicConversationChanged(input)(listener);
    return {
      dispose() {
        releases++;
        subscription.dispose();
      },
    };
  };
  const first = acquireAcpConversationProjection(wrapped, f.workspace, f.target.id, () => {});
  const second = acquireAcpConversationProjection(wrapped, f.workspace, f.target.id, () => {});
  try {
    assert.equal(first.store, second.store);
    await until(() => first.store.getState().snapshot !== null, first.store);
    assert.equal(subscriptions, 1);
    first.release();
    assert.equal(releases, 0);
    assert.equal(second.store.getState().status, "live");
    second.release();
    assert.equal(releases, 1);
    second.release();
    assert.equal(releases, 1);
  } finally {
    first.release();
    second.release();
    await f.cleanup();
  }
});

test("invalid online payload repairs the same saved revision without mutating the applied base", async () => {
  const f = await setup();
  const wrapped = Object.create(f.service) as typeof f.service;
  let corrupt = false;
  wrapped.onDynamicConversationChanged = (input) => (listener) =>
    f.service.onDynamicConversationChanged(input)((change) => {
      if (
        corrupt &&
        change.wire.kind === "complete" &&
        change.wire.frame.payload.kind === "deltas"
      ) {
        corrupt = false;
        const invalid = structuredClone(change);
        if (invalid.wire.kind === "complete")
          invalid.wire.frame.payload = { kind: "deltas", deltas: [{ op: "invalid" }] } as never;
        listener(invalid);
      } else listener(change);
    });
  const transport = createAcpConversationTransport(wrapped, f.workspace, f.target.id, () => {});
  const store = new ConversationProjectionStore(`conversation/${f.target.id}`, transport);
  const off = transport.onFrame((frame, context) => store.handleFrame(frame, context));
  try {
    await store.connect();
    await f.service.refresh(f.target);
    await f.service.submitPrompt({ ...f.target, commandId: "invalid", text: "问题" });
    await f.update("首");
    corrupt = true;
    await f.update("恢复");
    await until(
      () =>
        store
          .getState()
          .snapshot!.rows.window.some(
            (row) => row.kind === "assistantText" && row.text === "首恢复",
          ),
      store,
    );
    assert.equal(store.getState().status, "live");
  } finally {
    off();
    await store.close();
    transport.dispose();
    await f.cleanup();
  }
});

test("Channel RPC serializes small summary and selected conversation events for long history", async () => {
  const f = await setup();
  const [serverProtocol, clientProtocol] = createQueuePair();
  const server = new ChannelServer(serverProtocol, "fixture");
  const channels = new ChannelClient(clientProtocol);
  server.registerChannel("acp", ProxyChannel.fromService(f.service));
  const client = ProxyChannel.toService<IAcpService>(channels.getChannel("acp"));
  const sizes: number[] = [];
  const wireTap = clientProtocol.onMessage((buffer) => sizes.push(buffer.byteLength));
  const received: unknown[] = [];
  let resolveFrame = () => {};
  const summary = client.onDynamicSessionSummaryChanged(f.workspace)((change) =>
    received.push(change),
  );
  const body = client.onDynamicConversationChanged({ ...f.target, subscriptionId: "rpc" })((
    change,
  ) => {
    received.push(change);
    resolveFrame();
  });
  try {
    await client.refresh(f.target);
    await client.submitPrompt({ ...f.target, commandId: "rpc", text: "新问题" });
    await client.readConversation({ ...f.target, subscriptionId: "rpc" });
    sizes.length = 0;
    received.length = 0;
    const nextFrame = new Promise<void>((resolve) => {
      resolveFrame = resolve;
    });
    // A direct synthetic Agent update must cross the actual serialized Channel event boundary.
    await f.update("字");
    await nextFrame;
    assert.ok(received.length >= 2);
    assert.ok(Math.max(...sizes) < 15000, `stream event serialized ${Math.max(...sizes)} bytes`);
    assert.ok(received.every((value) => !JSON.stringify(value).includes("合成历史")));
    const listed = await client.listSummaries(f.workspace);
    assert.equal(listed[0]!.history.entryCount, 3442);
  } finally {
    summary.dispose();
    body.dispose();
    wireTap.dispose();
    channels.dispose();
    server.dispose();
    await f.cleanup();
  }
});
