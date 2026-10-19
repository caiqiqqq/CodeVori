import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BOT_COMMANDS } from "@zcode/shared";
import { createBotsService } from "../src/bots/botsService.js";
import { BotsRepo } from "../src/bots/repo.js";
import { setDataBaseDir } from "../src/paths.js";

test("public Bot service persists preferences, protects Weixin targets and deduplicates two Hosts", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args.join(" ")));
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.join(" ")));
  const dir = await mkdtemp(join(tmpdir(), "bot-service-notifications-"));
  const originalFetch = globalThis.fetch;
  setDataBaseDir(dir);
  let token = "synthetic-token";
  const payloads: { msg: { to_user_id: string; context_token?: string } }[] = [];
  const deps = {
    credentialService: { load: async () => token, save: async () => {}, delete: async () => {} },
    zcodeTaskService: {} as never,
    modelSelectionService: {
      getView: async () => {
        throw Error("No Agent/model calls allowed");
      },
    },
    runStartupBackgroundTasks: false,
  };
  const services = [createBotsService(deps), createBotsService(deps)];
  const service = services[0]!;
  try {
    const bot = await service.saveBot({
      bot: {
        id: "one",
        name: "Synthetic Weixin",
        provider: "weixin",
        enabled: true,
        credentialRef: "synthetic",
        providerUserId: "bot-identity",
        allowedWorkspaces: ["*"],
        allowedCommands: DEFAULT_BOT_COMMANDS,
        currentOptions: {},
        replyMode: "summary_changes",
        taskNotifications: true,
      },
    });
    assert.equal((await services[1]!.getConfig()).bots[0]?.taskNotifications, true);
    const repo = new BotsRepo();
    const fingerprint = () => createHash("sha256").update(token).digest("hex");
    await repo.writeState({
      version: 3,
      bots: {
        one: {
          botId: "one",
          workspacePath: "/fixture",
          activeTaskId: null,
          mode: "draft",
          updatedAt: 1,
        },
      },
    });
    await repo.rememberNotificationRecipient(bot.id, {
      providerUserId: "private-recipient",
      providerContextToken: "current-context",
      credentialFingerprint: fingerprint(),
    });
    const publicState = (await service.getBotStates())[0]!;
    assert.equal(publicState.notificationRecipient?.providerContextToken, undefined);
    assert.equal(publicState.notificationRecipient?.providerUserId, "private-recipient");
    token = "rotated-synthetic-token";
    assert.equal((await service.getBotStates())[0]?.notificationRecipient, undefined);
    assert.equal((await service.testTaskNotification(bot.id)).ok, false);
    await repo.rememberNotificationRecipient(bot.id, {
      providerUserId: "private-recipient",
      providerContextToken: "new-context",
      credentialFingerprint: fingerprint(),
    });
    globalThis.fetch = async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    };
    const event = {
      workspacePath: "/fixture",
      source: "api" as const,
      taskId: "one",
      eventKey: "turn:one",
      status: "completed" as const,
      title: "Completed",
      body: "Synthetic task",
    };
    await Promise.all(services.map((host) => host.notifyTask(event)));
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.msg.to_user_id, "private-recipient");
    assert.equal(payloads[0]?.msg.context_token, "new-context");
    globalThis.fetch = async () => {
      throw Error("private credential must not leak");
    };
    await service.notifyTask({ ...event, eventKey: "turn:two" });
    const status = await service.getStatus();
    assert.match(status.botRuntime[0]?.deliveryError ?? "", /kind=unknown/);
    assert.equal(
      status.botRuntime[0]?.deliveryErrorMessageId,
      "bots.runtime.weixinDeliveryUnknown",
    );
    assert.doesNotMatch(JSON.stringify(status), /private credential/);
    for (const [payload, httpStatus, messageId] of [
      [{ ret: -14, errmsg: "private credential" }, 200, "bots.runtime.weixinLoginRequired"],
      [
        { ret: 1, errcode: 987, errmsg: "private credential" },
        200,
        "bots.runtime.weixinDeliveryRejected",
      ],
      [{ errmsg: "private credential" }, 503, "bots.runtime.weixinDeliveryNetwork"],
    ] as const) {
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        return new Response(JSON.stringify(payload), { status: httpStatus });
      };
      assert.equal((await service.testTaskNotification(bot.id)).ok, false);
      const failed = (await service.getStatus()).botRuntime[0]!;
      assert.equal(failed.deliveryErrorMessageId, messageId);
      assert.equal(failed.status, "idle", "delivery failure must not replace connection status");
      assert.equal(attempts, 1, "ambiguous delivery cannot be automatically resent");
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ ret: 0 }));
    assert.equal((await service.testTaskNotification(bot.id)).ok, true);
    const recovered = (await service.getStatus()).botRuntime[0]!;
    assert.equal(recovered.deliveryError, undefined);
    assert.equal(recovered.deliveryErrorMessageId, undefined);
    assert.match(logs.join("\n"), /errcode=987/);
    assert.match(logs.join("\n"), /bot delivery recovered/);
    assert.doesNotMatch(logs.join("\n"), /private credential|new-context|rotated-synthetic-token/);
  } finally {
    await Promise.all(services.map((host) => host.disposeAllAndWait()));
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
