import { z } from "zod";
import {
  acpSessionSchema,
  acpSessionChangedSchema,
  acpStreamDiagnosticSchema,
  acpSessionActivity,
  acpWorkspaceSchema,
  acpPromptInputSchema,
  type AcpSession,
} from "./zcode-protocol/acp.js";
import {
  conversationTopicWireFrameSchema,
  v4ConversationRowsRangeParamsSchema,
} from "./zcode-protocol-v4/transport.js";
import { commandAckSchema } from "./zcode-protocol-v4/command.js";

/** ACP capability adapter: same command/ACK boundary as native V4, Agent-specific input blocks. */
export const acpConversationCommandSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    commandId: z.string().trim().min(1),
    type: z.literal("sendText"),
    payload: acpPromptInputSchema.omit({ commandId: true }),
  })
  .strict();
export type AcpConversationCommand = z.input<typeof acpConversationCommandSchema>;
export const acpCommandQuerySchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    commandId: z.string().trim().min(1),
  })
  .strict();
export type AcpCommandQuery = z.infer<typeof acpCommandQuerySchema>;
/** No message, queue contents, tool output or history may escape in an admission receipt. */
export const acpCommandReceiptSchema = acpCommandQuerySchema
  .extend({
    ack: commandAckSchema,
    disposition: z.enum(["started", "queued", "discarded"]),
    sessionStatus: acpSessionSchema.shape.status,
  })
  .strict();
export type AcpCommandReceipt = z.infer<typeof acpCommandReceiptSchema>;

/** 显示摘要保留最近用户行的身份；entries 不能当成完整历史或全局下标。 */
export const acpSessionSummarySchema = acpSessionSchema.extend({
  entries: acpSessionSchema.shape.entries.max(1),
  history: z
    .object({
      entryCount: z.number().int().nonnegative(),
      lastUserEntryIndex: z.number().int(),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .strict(),
});
export type AcpSessionSummary = z.infer<typeof acpSessionSummarySchema>;

export function summarizeAcpSession(session: AcpSession): AcpSessionSummary {
  // 修复依据：长会话全文只应显式读取；列表和状态观察不能随 token 重发历史。
  const lastUserEntryIndex = session.entries.findLastIndex((entry) => entry.kind === "user");
  const user = session.entries[lastUserEntryIndex];
  return {
    ...session,
    entries:
      user?.kind === "user"
        ? [
            {
              id: user.id,
              kind: "user",
              text: user.text.slice(0, 512),
              ...(user.createdAt === undefined ? {} : { createdAt: user.createdAt }),
              ...(user.endedAt === undefined ? {} : { endedAt: user.endedAt }),
              ...(user.stopReason === undefined ? {} : { stopReason: user.stopReason }),
            },
          ]
        : [],
    history: {
      entryCount: session.entries.length,
      lastUserEntryIndex,
      ...acpSessionActivity(session),
    },
  };
}

export const acpSessionSummaryChangedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updated"), session: acpSessionSummarySchema }),
  acpSessionChangedSchema.options[1],
]);
export type AcpSessionSummaryChanged = z.infer<typeof acpSessionSummaryChangedSchema>;

export const acpConversationTargetSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    subscriptionId: z.string().min(1),
  })
  .strict();
export type AcpConversationTarget = z.infer<typeof acpConversationTargetSchema>;
export const acpConversationChangeSchema = z
  .object({
    session: acpSessionSummarySchema,
    wire: conversationTopicWireFrameSchema,
    streamDiagnostics: acpStreamDiagnosticSchema.optional(),
  })
  .strict();
export type AcpConversationChange = z.infer<typeof acpConversationChangeSchema>;
export const acpConversationReadSchema = acpConversationTargetSchema
  .extend({
    recovery: z.boolean().optional(),
  })
  .strict();
export type AcpConversationRead = z.infer<typeof acpConversationReadSchema>;
export const acpConversationRowsRangeSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    beforeRowId: v4ConversationRowsRangeParamsSchema.shape.beforeRowId,
    limit: v4ConversationRowsRangeParamsSchema.shape.limit,
  })
  .strict();
export type AcpConversationRowsRange = z.infer<typeof acpConversationRowsRangeSchema>;
