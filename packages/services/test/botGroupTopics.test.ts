import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { groupTopicKey, readFeishuGroupWake } from "../src/bots/groupTopic.ts";
import type { BotActor } from "@zcode/shared";
import { DEFAULT_BOT_COMMANDS } from "@zcode/shared";
import { createFeishuBotProvider } from "../src/bots/providers/feishuProvider.ts";
import { BotsRepo } from "../src/bots/repo.ts";
import { setDataBaseDir } from "../src/paths.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("topic key separates credentials, users, groups, threads, provider and private sessions", () => {
  const actor: BotActor = {
    provider: "feishu",
    botId: "bot",
    providerUserId: "user",
    chatType: "group",
    chatId: "group",
    threadRootMessageId: "root",
  };
  const key = groupTopicKey(actor, "credential");
  assert.ok(key);
  for (const patch of [
    { providerUserId: "other" },
    { chatId: "other" },
    { threadRootMessageId: "other" },
    { provider: "lark" as const },
  ]) {
    assert.notEqual(groupTopicKey({ ...actor, ...patch }, "credential"), key);
  }
  assert.notEqual(groupTopicKey(actor, "rotated"), key);
  assert.notEqual(groupTopicKey(actor, "credential", "different-app"), key);
  assert.equal(groupTopicKey({ ...actor, threadRootMessageId: undefined }, "credential"), null);
  assert.equal(groupTopicKey({ ...actor, chatType: "private" }, "credential"), null);
});

test("provider resolves bot identity and replies/cards inside the originating topic", async (t) => {
  const requests: { url: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const body = String(url).includes("tenant_access_token")
      ? { code: 0, tenant_access_token: "group-test-token", expire: 7200 }
      : String(url).includes("/bot/v3/info")
        ? { code: 0, bot: { open_id: "ou_bot" } }
        : { code: 0, data: { message_id: "reply" } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const provider = createFeishuBotProvider({ loadCredential: async () => "group-test-secret" });
  const bot = {
    id: "group-test",
    name: "test",
    provider: "feishu" as const,
    feishuAppId: "cli_0000000000000001",
    credentialRef: "key",
    enabled: true,
    allowedWorkspaces: ["*"],
    allowedCommands: DEFAULT_BOT_COMMANDS,
    currentOptions: {},
    replyMode: "streaming_card" as const,
  };
  const payload = {
    botId: bot.id,
    event: {
      sender: { sender_type: "user", sender_id: { open_id: "ou_owner" } },
      message: {
        chat_type: "group",
        chat_id: "oc_group",
        message_id: "om_message",
        root_id: "om_root",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 /new" }),
        mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
      },
    },
  };
  const prepared = await provider.prepareCallbackPayload!(bot, payload);
  const [inbound] = provider.parseCallback(prepared);
  assert.equal(inbound?.actor.threadRootMessageId, "om_root");
  assert.equal(inbound?.actor.mentionedBot, true);
  assert.equal(inbound?.text, "/new");
  await provider.send(bot, {
    botId: bot.id,
    provider: "feishu",
    providerUserId: "oc_group",
    threadRootMessageId: "om_root",
    text: "test result",
  });
  await provider.createStreamingReplyCard!(bot, {
    providerUserId: "oc_group",
    threadRootMessageId: "om_root",
    status: "running",
    blocks: [],
  });
  for (const request of requests.filter((item) => item.url.includes("/messages/"))) {
    assert.ok(request.url.endsWith("/messages/om_root/reply"));
    assert.equal(request.body.reply_in_thread, true);
    assert.equal(request.body.receive_id, undefined);
  }
  assert.equal(provider.parseCallback({ ...payload, zcodeBotOpenId: undefined }).length, 0);
  await provider.send(bot, {
    botId: bot.id,
    provider: "feishu",
    providerUserId: "oc_group",
    threadRootMessageId: "om_root",
    text: "Approve",
    selection: {
      id: "permission",
      title: "Approve",
      action: "permission.respond",
      options: [{ id: "1", label: "Allow" }],
    },
  });
  const sentCard = JSON.parse(requests.at(-1)!.body.content);
  const values: any[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.value?.command) values.push(node.value);
    Object.values(node).forEach(visit);
  };
  visit(sentCard);
  assert.ok(values.length);
  assert.equal(values[0].zcodeThreadRootId, "om_root");
  const card = {
    botId: bot.id,
    event: {
      operator: { open_id: "ou_owner" },
      context: { open_chat_id: "oc_group", chat_type: "group" },
      action: { value: values[0] },
    },
  };
  assert.equal(provider.parseCallback(card)[0]?.actor.threadRootMessageId, "om_root");
  assert.equal(
    provider.parseCallback({
      ...card,
      event: { ...card.event, action: { behaviors: [{ value: values[0] }] } },
    })[0]?.actor.threadRootMessageId,
    "om_root",
  );
  assert.equal(
    provider.parseCallback({
      ...card,
      event: { ...card.event, action: { value: { command: "/approve id allow" } } },
    }).length,
    0,
  );
});

test("concurrent topic context writes persist both tasks without overwriting private state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "group-topic-state-"));
  setDataBaseDir(dir);
  try {
    const repo = new BotsRepo();
    const context = {
      botId: "bot",
      workspacePath: "/fixture",
      activeTaskId: null,
      mode: "draft" as const,
      updatedAt: 1,
    };
    await repo.updateContext(context);
    await Promise.all([
      repo.updateContext({
        ...context,
        conversationKey: "bot::topic::one",
        activeTaskId: "task-one",
      }),
      repo.updateContext({
        ...context,
        conversationKey: "bot::topic::two",
        activeTaskId: "task-two",
      }),
    ]);
    const state = await repo.readState();
    assert.equal(state.bots.bot?.activeTaskId, null);
    assert.equal(state.bots["bot::topic::one"]?.activeTaskId, "task-one");
    assert.equal(state.bots["bot::topic::two"]?.activeTaskId, "task-two");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only native bot identity mentions wake a group task; visible names cannot spoof it", () => {
  assert.deepEqual(readFeishuGroupWake("@Bot run", [], "ou_bot"), {
    mentionedBot: false,
    text: "@Bot run",
  });
  assert.equal(
    readFeishuGroupWake(
      "@_user_1 run",
      [{ key: "@_user_1", name: "Bot", id: { open_id: "ou_other" } }],
      "ou_bot",
    ).mentionedBot,
    false,
  );
  assert.deepEqual(
    readFeishuGroupWake(
      "@_user_1 /new",
      [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
      "ou_bot",
    ),
    { mentionedBot: true, text: "/new" },
  );
  assert.equal(
    readFeishuGroupWake("x", [{ key: "x", id: { open_id: "ou_bot" } }], "").mentionedBot,
    false,
  );
});

test("rotating a secret at the same credential ref obtains a new tenant token", async (t) => {
  let secret = "old-fixture-secret";
  const secrets: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("tenant_access_token")) {
      secrets.push(JSON.parse(String(init?.body)).app_secret);
      return new Response(
        JSON.stringify({ code: 0, tenant_access_token: "fixture-" + secrets.length, expire: 7200 }),
      );
    }
    return new Response(JSON.stringify({ code: 0, bot: { open_id: "ou_fixture" } }));
  });
  const provider = createFeishuBotProvider({ loadCredential: async () => secret });
  const bot = {
    id: "rotation",
    name: "fixture",
    provider: "feishu" as const,
    feishuAppId: "cli_0000000000000002",
    credentialRef: "rotation",
    enabled: true,
    allowedWorkspaces: ["*"],
    allowedCommands: DEFAULT_BOT_COMMANDS,
    currentOptions: {},
  };
  const payload = { event: { message: { chat_type: "group" } } };
  await provider.prepareCallbackPayload!(bot, payload);
  secret = "new-fixture-secret";
  await provider.prepareCallbackPayload!(bot, payload);
  assert.deepEqual(secrets, ["old-fixture-secret", "new-fixture-secret"]);
});

test("service isolates group tasks, private sessions, approval scopes and credential generations", async (t) => {
  const { createBotsService } = await import("../src/bots/botsService.ts");
  const dir = await mkdtemp(join(tmpdir(), "group-topic-service-"));
  setDataBaseDir(dir);
  const repo = new BotsRepo();
  let secret = "service-fixture-secret";
  const tasks: any[] = [];
  const sends: any[] = [];
  const approvals: any[] = [];
  const listeners = new Map<string, (event: any) => Promise<void>>();
  const taskService = {
    createTask: async (input: any) => {
      const task = { ...input, taskId: "task-" + (tasks.length + 1), status: "idle", title: "" };
      tasks.push(task);
      return task;
    },
    getTaskConfigOptions: async () => [],
    getTaskMeta: async ({ taskId }: any) => tasks.find((t) => t.taskId === taskId),
    getTaskSnapshot: async () => ({}),
    listDeletedTaskIds: async () => [],
    listTasks: async () => tasks,
    onDynamicStreamEvent: (taskId: string) => (listener: any) => {
      listeners.set(taskId, listener);
      return { dispose: () => listeners.delete(taskId) };
    },
    sendText: async (input: any) => {
      sends.push(input);
      return {};
    },
    respondPermission: async (input: any) => {
      approvals.push(input);
      return true;
    },
  };
  const service = createBotsService({
    credentialService: { load: async () => secret, save: async () => {}, delete: async () => {} },
    zcodeTaskService: taskService as never,
    modelSelectionService: {
      getView: async () => ({ preferredSelection: { providerId: "fixture", modelId: "fixture" } }),
    } as never,
    settingService: {
      get: async () => ({ lastWorkspaceSession: [{ kind: "local", workspacePath: "/fixture" }] }),
    } as never,
    runStartupBackgroundTasks: false,
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown) =>
      new Response(
        JSON.stringify(
          String(url).includes("tenant_access_token")
            ? { code: 0, tenant_access_token: "fixture-token", expire: 7200 }
            : String(url).includes("/bot/v3/info")
              ? { code: 0, bot: { open_id: "ou_bot" } }
              : { code: 0, data: { message_id: "fixture-card" } },
        ),
      ),
  );
  try {
    const bot = await service.saveBot({
      bot: {
        id: "service-group",
        name: "fixture",
        provider: "feishu",
        enabled: true,
        feishuAppId: "cli_0000000000000003",
        credentialRef: "group-service",
        providerUserId: "ou_owner",
        allowedWorkspaces: ["*"],
        allowedCommands: DEFAULT_BOT_COMMANDS,
        currentOptions: {},
        replyMode: "summary_changes",
      },
    });
    const actor: BotActor = {
      provider: "feishu",
      botId: bot.id,
      providerUserId: "ou_owner",
      chatType: "group",
      chatId: "oc_fixture",
      threadRootMessageId: "om_one",
      mentionedBot: true,
    };
    const inbound = (actor: BotActor, text: string) => ({
      botId: bot.id,
      actor,
      text,
      receivedAt: Date.now(),
    });
    assert.deepEqual(
      await service.handleInboundMessage(inbound({ ...actor, mentionedBot: false }, "ignored")),
      [],
    );
    assert.deepEqual(
      await service.handleInboundMessage(
        inbound({ ...actor, providerUserId: "ou_other" }, "ignored"),
      ),
      [],
    );
    assert.equal(tasks.length, 0);
    await service.handleInboundMessage(inbound(actor, "first topic task"));
    await service.handleInboundMessage(
      inbound({ ...actor, threadRootMessageId: "om_two" }, "second topic task"),
    );
    await service.handleInboundMessage(
      inbound(
        { ...actor, chatType: "private", chatId: undefined, threadRootMessageId: undefined },
        "private task",
      ),
    );
    assert.equal(tasks.length, 3);
    assert.equal(
      new Set(
        (await repo.readState()).bots &&
          Object.values((await repo.readState()).bots).map((x) => x.activeTaskId),
      ).size,
      3,
    );
    const one = groupTopicKey(
      actor,
      createHash("sha256").update(secret).digest("hex"),
      bot.feishuAppId,
    )!;
    const context = (await repo.readState()).bots[one]!;
    await repo.updateContext({
      ...context,
      pendingPermissionOptions: [
        {
          requestId: "permission-one",
          optionId: "allow",
          command: "approve",
          label: "Allow",
          response: { decision: "allow" },
        },
      ] as never,
    });
    await service.handleInboundMessage(
      inbound({ ...actor, threadRootMessageId: "om_two" }, "/approve permission-one allow"),
    );
    assert.equal(approvals.length, 0);
    await service.handleInboundMessage(inbound(actor, "/approve permission-one allow"));
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].taskId, "task-1");
    const callback = {
      botId: bot.id,
      event: {
        sender: { sender_type: "user", sender_id: { open_id: "ou_owner" } },
        message: {
          chat_type: "group",
          chat_id: "oc_fixture",
          message_id: "om_duplicate",
          message_type: "text",
          content: JSON.stringify({ text: "@_user_1 /help" }),
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        },
      },
    };
    const first = await service.handleProviderCallback("feishu", callback);
    assert.equal(first.length, 1);
    assert.deepEqual(await service.handleProviderCallback("feishu", callback), []);
    secret = "rotated-fixture-secret";
    const staleListener = listeners.get("task-1");
    assert.ok(staleListener);
    await staleListener({ type: "task_error", taskId: "task-1", error: "stale" });
    assert.equal(listeners.has("task-1"), false);
    assert.deepEqual(
      await service.handleInboundMessage(
        inbound({ ...actor, mentionedBot: false }, "old topic after rotation"),
      ),
      [],
    );
    assert.equal(tasks.length, 3);
    await service.handleInboundMessage(inbound(actor, "new generation task"));
    assert.equal(tasks.length, 4);
  } finally {
    await service.disposeAllAndWait();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
