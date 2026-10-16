import {
  botTaskNotificationSchema,
  type BotConfig,
  type BotNotificationRecipient,
  type BotOutboundMessage,
  type BotsConfigFile,
  type BotsStateFile,
  type BotTaskNotification,
} from "@zcode/shared";
import { isWorkspaceAllowed } from "./workspaceHelpers.js";

interface BotTaskNotifierDeps {
  readConfig(): Promise<BotsConfigFile>;
  readState(): Promise<BotsStateFile>;
  credentialFingerprint(bot: BotConfig): Promise<string>;
  claim(key: string): Promise<boolean>;
  send(bot: BotConfig, message: BotOutboundMessage): Promise<void>;
  onDeliveryResult(bot: BotConfig, error: string | undefined): void;
}

export function supportsBotTaskNotifications(bot: BotConfig): boolean {
  return ["telegram", "feishu", "lark", "weixin", "webhook"].includes(bot.provider);
}

async function resolveRecipient(
  bot: BotConfig,
  state: BotsStateFile,
  deps: BotTaskNotifierDeps,
): Promise<Pick<BotNotificationRecipient, "providerUserId" | "providerContextToken"> | null> {
  if (!bot.enabled || !supportsBotTaskNotifications(bot)) return null;
  if (bot.provider === "webhook")
    return bot.webhookUrl ? { providerUserId: bot.providerUserId ?? "notification" } : null;
  if (bot.provider === "weixin") {
    const target = state.bots[bot.id]?.notificationRecipient;
    // 扫码的 providerUserId 是 Bot 身份；只有当前凭据激活过的私聊才是安全投递目标。
    return target && target.credentialFingerprint === (await deps.credentialFingerprint(bot))
      ? target
      : null;
  }
  return bot.providerUserId ? { providerUserId: bot.providerUserId } : null;
}

export function createBotTaskNotifier(deps: BotTaskNotifierDeps) {
  return async (input: BotTaskNotification): Promise<void> => {
    const event = botTaskNotificationSchema.parse(input);
    const [config, state] = await Promise.all([deps.readConfig(), deps.readState()]);
    const workspaceKey = event.workspaceIdentity?.trim() || event.workspacePath;
    await Promise.all(
      config.bots.map(async (bot) => {
        if (!bot.taskNotifications || !isWorkspaceAllowed(workspaceKey, bot.allowedWorkspaces))
          return;
        const context = state.bots[bot.id];
        if (
          event.source === "api" &&
          context?.activeTaskId === event.taskId &&
          context.workspacePath === event.workspacePath &&
          (context.workspaceIdentity?.trim() || context.workspacePath) === workspaceKey
        )
          return;
        try {
          const target = await resolveRecipient(bot, state, deps);
          if (!target) return;
          const key = JSON.stringify([
            bot.id,
            bot.provider,
            target.providerUserId,
            workspaceKey,
            event.workspacePath,
            event.source,
            event.taskId,
            event.eventKey,
            event.status,
          ]);
          if (!(await deps.claim(key))) return;
          await deps.send(bot, {
            botId: bot.id,
            provider: bot.provider,
            ...target,
            singleAttempt: true,
            text: `${event.title}\n${event.body}`,
          });
          deps.onDeliveryResult(bot, undefined);
        } catch {
          // Provider 错误可能含 URL/token，状态只暴露固定错误，不记录 payload 或凭据。
          deps.onDeliveryResult(bot, "Task notification delivery failed.");
        }
      }),
    );
  };
}

export async function testBotTaskNotification(
  botId: string,
  deps: BotTaskNotifierDeps,
): Promise<{ ok: boolean; message: string }> {
  const [config, state] = await Promise.all([deps.readConfig(), deps.readState()]);
  const bot = config.bots.find((item) => item.id === botId);
  if (!bot) return { ok: false, message: "Bot is unavailable." };
  try {
    const target = await resolveRecipient(bot, state, deps);
    if (!target)
      return {
        ok: false,
        message: "Bind or activate a private recipient before sending notifications.",
      };
    await deps.send(bot, {
      botId: bot.id,
      provider: bot.provider,
      ...target,
      singleAttempt: true,
      text: "ZCode · 测试通知 / Test notification",
    });
    deps.onDeliveryResult(bot, undefined);
    return { ok: true, message: "Test notification delivered." };
  } catch {
    deps.onDeliveryResult(bot, "Task notification delivery failed.");
    return { ok: false, message: "Task notification delivery failed." };
  }
}
