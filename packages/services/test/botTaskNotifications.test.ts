import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotConfig, BotTaskNotification } from "@zcode/shared";
import { createBotTaskNotifier, testBotTaskNotification } from "../src/bots/taskNotifications.js";
import { BotNotificationReceipts } from "../src/bots/notificationReceipts.js";

const bot = (patch: Partial<BotConfig> = {}): BotConfig => ({
  id: "one",
  name: "Notifications",
  provider: "telegram",
  enabled: true,
  providerUserId: "recipient",
  allowedWorkspaces: ["remote:one"],
  allowedCommands: {
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
  },
  currentOptions: {},
  replyMode: "summary_changes",
  taskNotifications: true,
  ...patch,
});
const event = (patch: Partial<BotTaskNotification> = {}): BotTaskNotification => ({
  workspacePath: "/fixture",
  workspaceIdentity: "remote:one",
  remoteSessionId: "attachment:one",
  source: "api",
  taskId: "task",
  eventKey: "turn:one",
  status: "completed",
  title: "Completed",
  body: "Task title",
  ...patch,
});

async function fixture(
  run: (value: {
    config: { version: 3; bots: BotConfig[] };
    sent: unknown[];
    failures: (string | undefined)[];
    notify: ReturnType<typeof createBotTaskNotifier>;
    receipts: BotNotificationReceipts;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "bot-notifications-"));
  const receipts = new BotNotificationReceipts(join(dir, "receipts.json"));
  const config = { version: 3 as const, bots: [bot()] };
  const sent: unknown[] = [];
  const failures: (string | undefined)[] = [];
  const notify = createBotTaskNotifier({
    readConfig: async () => config,
    readState: async () => ({ version: 3, bots: {} }),
    claim: (key) => receipts.claim(key),
    credentialFingerprint: async () => "current",
    send: async (_bot, message) => {
      sent.push(message);
    },
    onDeliveryResult: (_bot, error) => {
      failures.push(error);
    },
  });
  try {
    await run({ config, sent, failures, notify, receipts });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cross-window concurrent edges and different attachments share one durable attempt", async () => {
  await fixture(async ({ notify, sent, receipts }) => {
    await Promise.all([notify(event()), notify(event({ remoteSessionId: "attachment:two" }))]);
    assert.equal(sent.length, 1);
    assert.equal(await receipts.claim("independent"), true);
    assert.equal(await receipts.claim("independent"), false);
    await notify(event({ eventKey: "turn:two" }));
    assert.equal(sent.length, 2);
    await notify(event({ workspaceIdentity: "remote:two" }));
    assert.equal(sent.length, 2);
  });
});

test("disabled, unbound, out-of-scope and unavailable channels cannot send", async () => {
  await fixture(async ({ config, notify, sent }) => {
    for (const patch of [
      { taskNotifications: undefined },
      { enabled: false },
      { providerUserId: undefined },
      { allowedWorkspaces: ["/fixture"] },
      { provider: "discord" as const },
      { provider: "webhook" as const, webhookUrl: undefined },
      { provider: "weixin" as const },
    ]) {
      config.bots = [bot(patch)];
      await notify(event());
    }
    assert.equal(sent.length, 0);
  });
});

test("a failing provider does not block another bot or retry an ambiguous attempt", async () => {
  await fixture(async ({ config, sent, receipts, failures }) => {
    config.bots = [bot(), bot({ id: "two" })];
    const notify = createBotTaskNotifier({
      readConfig: async () => config,
      readState: async () => ({ version: 3, bots: {} }),
      claim: (key) => receipts.claim(key),
      credentialFingerprint: async () => "current",
      send: async (target, message) => {
        sent.push(message);
        if (target.id === "one") throw Error("failed");
      },
      onDeliveryResult: (_bot, error) => {
        failures.push(error);
      },
    });
    await notify(event());
    await notify(event());
    assert.equal(sent.length, 2);
    assert.equal(
      failures.filter((value) => value === "Task notification delivery failed.").length,
      1,
    );
    assert.equal(failures.filter((value) => value === undefined).length, 1);
  });
});

test("test delivery uses the real send result and does not require enabling notifications", async () => {
  await fixture(async ({ config, sent, receipts }) => {
    config.bots = [bot({ taskNotifications: false })];
    let fail = false;
    const deps = {
      readConfig: async () => config,
      readState: async () => ({ version: 3 as const, bots: {} }),
      claim: (key: string) => receipts.claim(key),
      credentialFingerprint: async () => "current",
      send: async (_bot: BotConfig, message: unknown) => {
        if (fail) throw Error("token must not leak");
        sent.push(message);
      },
      onDeliveryResult() {},
    };
    assert.equal((await testBotTaskNotification("one", deps)).ok, true);
    fail = true;
    const result = await testBotTaskNotification("one", deps);
    assert.equal(result.ok, false);
    assert.equal(result.message.includes("token"), false);
    assert.equal(sent.length, 1);
    config.bots = [bot({ providerUserId: undefined })];
    assert.equal((await testBotTaskNotification("one", deps)).ok, false);
  });
});

test("new receipt repository instances retain prior claims without storing task text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bot-receipts-"));
  try {
    const path = join(dir, "receipts.json");
    assert.equal(await new BotNotificationReceipts(path).claim("private-title"), true);
    assert.equal(await new BotNotificationReceipts(path).claim("private-title"), false);
    const { readFile } = await import("node:fs/promises");
    assert.equal((await readFile(path, "utf8")).includes("private-title"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Weixin uses the activated private recipient and context, rejects old credentials", async () => {
  await fixture(async ({ config, sent, receipts }) => {
    config.bots = [bot({ provider: "weixin", providerUserId: "bot-identity" })];
    let fingerprint = "old";
    const notify = createBotTaskNotifier({
      readConfig: async () => config,
      readState: async () => ({
        version: 3,
        bots: {
          one: {
            botId: "one",
            workspacePath: "/fixture",
            mode: "draft",
            activeTaskId: null,
            updatedAt: 1,
            notificationRecipient: {
              providerUserId: "private-user",
              providerContextToken: "context",
              credentialFingerprint: "current",
            },
          },
        },
      }),
      claim: (key) => receipts.claim(key),
      credentialFingerprint: async () => fingerprint,
      send: async (_bot, message) => {
        sent.push(message);
      },
      onDeliveryResult() {},
    });
    await notify(event());
    assert.equal(sent.length, 0);
    fingerprint = "current";
    await notify(event());
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as { providerUserId: string }).providerUserId, "private-user");
    assert.equal((sent[0] as { providerContextToken: string }).providerContextToken, "context");
  });
});

test("Bot-bound tasks retain their existing reply without a second notification", async () => {
  await fixture(async ({ config, sent, receipts }) => {
    const notify = createBotTaskNotifier({
      readConfig: async () => config,
      readState: async () => ({
        version: 3,
        bots: {
          one: {
            botId: "one",
            workspacePath: "/fixture",
            workspaceIdentity: "remote:one",
            mode: "task",
            activeTaskId: "task",
            updatedAt: 1,
          },
        },
      }),
      claim: (key) => receipts.claim(key),
      credentialFingerprint: async () => "current",
      send: async (_bot, message) => {
        sent.push(message);
      },
      onDeliveryResult() {},
    });
    await notify(event());
    assert.equal(sent.length, 0);
  });
});
