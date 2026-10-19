import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BOT_COMMANDS, type BotConfig, type BotRuntimeInfo } from "@zcode/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createWeixinChannelRuntime } from "../src/bots/weixinChannelRuntime.js";
import { createWeixinBotProvider } from "../src/bots/providers/weixinProvider.js";
import { formatWeixinDiagnostic, WeixinProviderError } from "../src/bots/providers/weixinErrors.js";

const bot: BotConfig = {
  id: "synthetic-bot",
  name: "Fixture",
  provider: "weixin",
  enabled: true,
  credentialRef: "synthetic",
  providerUserId: "synthetic-bot-user",
  allowedWorkspaces: ["*"],
  allowedCommands: DEFAULT_BOT_COMMANDS,
  currentOptions: {},
  replyMode: "summary_changes",
};
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });
async function until(condition: () => boolean) {
  for (let i = 0; i < 2_000; i++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected asynchronous state transition");
}

test("Weixin provider retains safe codes while discarding server text and request secrets", async () => {
  const originalFetch = globalThis.fetch;
  const provider = createWeixinBotProvider({ loadCredential: async () => "synthetic-secret" });
  try {
    for (const [payload, status, login] of [
      [{ ret: -14, errmsg: "synthetic-secret context-token private text" }, 200, true],
      [{ errcode: -14, errmsg: "synthetic-secret" }, 200, true],
      [{ ret: 1, errcode: 987, errmsg: "synthetic-secret" }, 200, false],
      [{ errmsg: "synthetic-secret" }, 401, true],
      [{ errmsg: "synthetic-secret" }, 403, true],
      [{ errmsg: "synthetic-secret" }, 503, false],
    ] as const) {
      globalThis.fetch = async () => response(payload, status);
      await assert.rejects(
        provider.send(bot, {
          botId: bot.id,
          provider: "weixin",
          providerUserId: "private-recipient",
          providerContextToken: "context-token",
          text: "private text",
        }),
        (error: unknown) => {
          assert.ok(error instanceof WeixinProviderError);
          assert.equal(error.requiresLogin, login);
          assert.equal(error.httpStatus, status);
          assert.doesNotMatch(
            String(error),
            /synthetic-secret|context-token|private text|private-recipient/,
          );
          if ("errcode" in payload)
            assert.match(String(error), new RegExp(`errcode=${payload.errcode}`));
          return true;
        },
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed synthetic-secret", {
        cause: { code: "ENOTFOUND", hostname: "synthetic-secret" },
      });
    };
    await assert.rejects(
      provider.send(bot, {
        botId: bot.id,
        provider: "weixin",
        providerUserId: "private-recipient",
        text: "private text",
      }),
      (error: unknown) => {
        assert.ok(error instanceof WeixinProviderError);
        assert.equal(error.kind, "network");
        assert.equal(error.code, "ENOTFOUND");
        assert.doesNotMatch(String(error), /synthetic-secret/);
        return true;
      },
    );
    assert.equal(
      formatWeixinDiagnostic(Object.assign(new Error("synthetic-secret"), { code: "EACCES" })),
      "kind=io code=EACCES",
    );
    assert.equal(
      formatWeixinDiagnostic(
        Object.assign(new Error("synthetic-secret"), { code: "synthetic-secret" }),
      ),
      "kind=unknown",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stopping during a callback does not acknowledge the old batch or publish recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weixin-stale-callback-"));
  const originalFetch = globalThis.fetch;
  setDataBaseDir(dir);
  let entered = false;
  let finish!: () => void;
  let writes = 0;
  const statuses: BotRuntimeInfo[] = [];
  const runtime = createWeixinChannelRuntime({
    credentialService: {
      load: async () => "synthetic-secret",
      save: async () => {},
      delete: async () => {},
    },
    logger: { debug() {}, info() {}, warn() {} },
    statusSink: {
      getRuntimeStatus: () => statuses.at(-1),
      setRuntimeStatus: (value) => {
        statuses.push(value);
      },
    },
    ensureBotStorageMigrated: async () => {},
    readConfig: async () => ({ version: 3, bots: [bot] }),
    readWeixinGetUpdatesBuf: async () => undefined,
    writeWeixinGetUpdatesBuf: async () => {
      writes++;
    },
    processProviderCallback: async () => {
      entered = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: true, replies: [] };
    },
  });
  globalThis.fetch = async () =>
    response({
      ret: 0,
      get_updates_buf: "next",
      msgs: [
        {
          message_id: "inbound",
          from_user_id: "recipient",
          message_type: 1,
          item_list: [{ type: 1, text_item: { text: "hello" } }],
        },
      ],
    });
  try {
    await runtime.refresh();
    await until(() => entered);
    const disposing = runtime.dispose();
    finish();
    await disposing;
    assert.equal(writes, 0);
    assert.equal(
      statuses.some((value) => value.messageId === "bots.runtime.weixinLongPollingRunning"),
      false,
    );
  } finally {
    finish?.();
    await runtime.dispose();
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stalled Weixin response body retains its timeout category and is attempted once", async (t) => {
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let reading = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return {
      ok: true,
      status: 200,
      text: () => {
        reading = true;
        return new Promise<string>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("synthetic-secret", "AbortError")),
            { once: true },
          ),
        );
      },
    } as Response;
  };
  try {
    const provider = createWeixinBotProvider({ loadCredential: async () => "synthetic-secret" });
    const sent = provider.send(bot, {
      botId: bot.id,
      provider: "weixin",
      providerUserId: "recipient",
      text: "text",
    });
    const rejected = assert.rejects(sent, (error: unknown) => {
      assert.ok(error instanceof WeixinProviderError);
      assert.equal(error.kind, "timeout");
      assert.doesNotMatch(String(error), /synthetic-secret/);
      return true;
    });
    await until(() => reading);
    t.mock.timers.tick(15_000);
    await rejected;
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    t.mock.timers.reset();
  }
});

test("polling reconnects only after a successful batch and dispose interrupts backoff", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "weixin-reconnect-"));
  const originalFetch = globalThis.fetch;
  setDataBaseDir(dir);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const delays: number[] = [];
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    if (ms !== 90_000) delays.push(ms ?? 0);
    return timer(callback, ms, ...args);
  });
  let current: BotRuntimeInfo | undefined;
  const logs: string[] = [];
  let calls = 0;
  let fail = true;
  let callbackFails = true;
  let writes = 0;
  const runtime = createWeixinChannelRuntime({
    credentialService: {
      load: async () => "synthetic-secret",
      save: async () => {},
      delete: async () => {},
    },
    logger: {
      debug() {},
      info: (_trace, text) => logs.push(text),
      warn: (_trace, text) => logs.push(text),
    },
    statusSink: {
      getRuntimeStatus: () => current,
      setRuntimeStatus: (value) => {
        current = { ...current, ...value };
      },
    },
    ensureBotStorageMigrated: async () => {},
    readConfig: async () => ({ version: 3, bots: [bot] }),
    readWeixinGetUpdatesBuf: async () => undefined,
    writeWeixinGetUpdatesBuf: async () => {
      writes++;
    },
    processProviderCallback: async () => ({ ok: !callbackFails, replies: [], status: 503 }),
  });
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (fail) throw new TypeError("network synthetic-secret");
    if (writes === 0)
      return response({
        ret: 0,
        get_updates_buf: "next",
        msgs: [
          {
            message_id: "inbound",
            from_user_id: "recipient",
            message_type: 1,
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          },
        ],
      });
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
    );
  };
  try {
    await runtime.refresh();
    await until(() => delays.length === 1);
    assert.equal(delays[0], 5_000);
    assert.equal(current?.messageId, "bots.runtime.weixinReconnecting");
    assert.equal(calls, 1);
    fail = false;
    t.mock.timers.tick(5_000);
    await until(() => delays.length === 2);
    assert.equal(delays[1], 10_000);
    assert.equal(writes, 0, "failed callback cannot acknowledge the batch");
    assert.equal(current?.status, "error");
    assert.equal(
      logs.some((x) => x.includes("polling recovered")),
      false,
    );
    callbackFails = false;
    t.mock.timers.tick(10_000);
    await until(() => writes === 1 && current?.status === "polling");
    assert.ok(logs.some((x) => x.includes("polling recovered")));
    await runtime.dispose();
    fail = true;
    await runtime.refresh();
    await until(() => delays.length === 3);
    assert.equal(delays[2], 5_000, "a recovered connection resets backoff");
    for (const [index, delay] of [10_000, 20_000, 40_000, 60_000, 60_000].entries()) {
      t.mock.timers.tick(delays.at(-1)!);
      await until(() => delays.length === index + 4);
      assert.equal(delays.at(-1), delay);
    }
    const beforeDispose = calls;
    await runtime.dispose();
    t.mock.timers.tick(60_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, beforeDispose);
    assert.doesNotMatch(logs.join("\n"), /synthetic-secret|private-recipient/);
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
    t.mock.timers.reset();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("expired polling credentials stop requests and a credential refresh starts a new owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weixin-expired-"));
  const originalFetch = globalThis.fetch;
  setDataBaseDir(dir);
  let credential = "old-synthetic-secret";
  let calls = 0;
  let current: BotRuntimeInfo | undefined;
  const logs: string[] = [];
  const runtime = createWeixinChannelRuntime({
    credentialService: {
      load: async () => credential,
      save: async () => {},
      delete: async () => {},
    },
    logger: {
      debug() {},
      info: (_trace, text) => logs.push(text),
      warn: (_trace, text) => logs.push(text),
    },
    statusSink: {
      getRuntimeStatus: () => current,
      setRuntimeStatus: (value) => {
        current = { ...current, ...value };
      },
    },
    ensureBotStorageMigrated: async () => {},
    readConfig: async () => ({ version: 3, bots: [bot] }),
    readWeixinGetUpdatesBuf: async () => undefined,
    writeWeixinGetUpdatesBuf: async () => {},
    processProviderCallback: async () => ({ ok: true, replies: [] }),
  });
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (credential === "old-synthetic-secret")
      return response({ ret: -14, errmsg: "old-synthetic-secret" });
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
    );
  };
  try {
    await runtime.refresh();
    await until(() => current?.messageId === "bots.runtime.weixinLoginRequired");
    assert.equal(calls, 1);
    assert.match(logs.join("\n"), /ret=-14/);
    credential = "new-synthetic-secret";
    await runtime.refresh();
    await until(() => calls === 2);
    assert.doesNotMatch(logs.join("\n"), /old-synthetic-secret|new-synthetic-secret/);
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
