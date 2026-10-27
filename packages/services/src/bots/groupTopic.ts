import { createHash } from "node:crypto";
import type { BotActor } from "@zcode/shared";

export function groupTopicKey(
  actor: BotActor,
  credentialFingerprint: string,
  appId?: string,
): string | null {
  if (
    (actor.provider !== "feishu" && actor.provider !== "lark") ||
    actor.chatType !== "group" ||
    !actor.chatId?.trim() ||
    !actor.threadRootMessageId?.trim() ||
    !credentialFingerprint
  )
    return null;
  // Bot、凭据、真实发送者和话题均参与隔离，群成员不能借用其他人的工作区或审批状态。
  return `${actor.botId}::topic::${createHash("sha256")
    .update(
      JSON.stringify([
        actor.provider,
        appId ?? "",
        credentialFingerprint,
        actor.providerUserId,
        actor.chatId,
        actor.threadRootMessageId,
      ]),
    )
    .digest("hex")}`;
}

export function readFeishuGroupWake(text: string, mentions: unknown, botOpenId: string) {
  let mentionedBot = false;
  for (const mention of Array.isArray(mentions) ? mentions : []) {
    if (!mention || typeof mention !== "object") continue;
    if (botOpenId && mention.id?.open_id === botOpenId && typeof mention.key === "string") {
      mentionedBot = true;
      text = text.split(mention.key).join("");
    }
  }
  return { mentionedBot, text: text.trim() };
}
