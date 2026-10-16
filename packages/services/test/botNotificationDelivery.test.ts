import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botConfigSchema, botTaskNotificationSchema, DEFAULT_BOT_COMMANDS } from "@zcode/shared";
import { BotsRepo } from "../src/bots/repo.js";
import { setDataBaseDir } from "../src/paths.js";
import { createWebhookBotProvider } from "../src/bots/providers/webhookProvider.js";

test("an authorized private target survives stale context writes and resets on unbind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bot-private-target-"));
  setDataBaseDir(dir);
  try {
    const repo = new BotsRepo();
    await repo.writeState({
      version: 3,
      bots: {
        one: {
          botId: "one",
          workspacePath: "/fixture",
          mode: "draft",
          activeTaskId: null,
          updatedAt: 1,
        },
      },
    });
    const stale = await repo.readState();
    await repo.rememberNotificationRecipient("one", {
      providerUserId: "recipient",
      providerContextToken: "current",
      credentialFingerprint: "credential",
    });
    await repo.writeState(stale);
    assert.equal(
      (await repo.readState()).bots.one?.notificationRecipient?.providerContextToken,
      "current",
    );
    const prior = await repo.readState();
    await repo.rememberNotificationRecipient("one", {
      providerUserId: "recipient",
      providerContextToken: "new",
      credentialFingerprint: "credential",
    });
    await repo.writeState(prior);
    assert.equal(
      (await repo.readState()).bots.one?.notificationRecipient?.providerContextToken,
      "new",
    );
    await repo.writeState({ version: 3, bots: {} });
    assert.equal((await repo.readState()).bots.one, undefined);
    await repo.writeState(prior);
    assert.equal((await repo.readState()).bots.one?.notificationRecipient, undefined);
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Webhook notifications make one bounded provider attempt on network errors", async () => {
  const original = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init ?? {});
    throw Error("synthetic network error");
  };
  try {
    const provider = createWebhookBotProvider({ loadCredential: async () => "synthetic" });
    const bot = botConfigSchema.parse({
      id: "one",
      name: "Webhook",
      provider: "webhook",
      enabled: true,
      webhookUrl: "https://example.invalid/notifications",
      allowedWorkspaces: ["*"],
      allowedCommands: DEFAULT_BOT_COMMANDS,
      currentOptions: {},
      replyMode: "summary_changes",
    });
    assert.equal(bot.taskNotifications, undefined);
    await assert.rejects(
      provider.send(bot, {
        botId: "one",
        provider: "webhook",
        providerUserId: "recipient",
        text: "Task completed",
        singleAttempt: true,
      }),
    );
    assert.equal(requests.length, 1);
    assert.ok(requests[0]?.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = original;
  }
});

test("the RPC notification contract rejects malformed and oversized events", () => {
  const value = {
    workspacePath: "/fixture",
    source: "api",
    taskId: "one",
    eventKey: "turn",
    status: "completed",
    title: "Done",
    body: "Task",
  };
  assert.equal(botTaskNotificationSchema.safeParse(value).success, true);
  for (const patch of [
    { source: "unknown" },
    { workspacePath: " " },
    { eventKey: "" },
    { status: "running" },
    { body: "x".repeat(2049) },
    { credential: "must not pass" },
  ]) {
    assert.equal(botTaskNotificationSchema.safeParse({ ...value, ...patch }).success, false);
  }
});
