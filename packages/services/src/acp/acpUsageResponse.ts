import { z } from "zod";
import {
  acpTokenUsageSchema,
  type AcpAgent,
  type AcpUsageReport,
  type AcpModelTokenUsage,
} from "@zcode/shared";
import type { Implementation, PromptResponse } from "@agentclientprotocol/sdk";

const count = z.number().int().nonnegative();
const claudeUsageSchema = acpTokenUsageSchema.extend({
  cachedReadTokens: count.nullish(),
  cachedWriteTokens: count.nullish(),
});
const claudeModelUsageSchema = z
  .array(
    z.object({
      model: z.string().trim().min(1).max(256),
      token_count: acpTokenUsageSchema.extend({
        cachedInputTokens: count,
        cachedWriteTokens: count.optional(),
      }),
    }),
  )
  .max(256);

/** Experimental ACP usage is adapter-specific; never infer a scope from increasing numbers. */
export function projectAcpPromptUsage(
  agent: AcpAgent,
  agentInfo: Implementation | null | undefined,
  response: PromptResponse,
): AcpUsageReport | null {
  // 修复原因：Codex 1.13.1 的 usage 与 quota 仅含最后一次模型请求；CLAUDE
  // 同名字段才是整轮。未知适配器不能套用 schema 文档的会话累计描述。
  if (agent !== "claude" || agentInfo?.name !== "@agentclientprotocol/claude-agent-acp")
    return null;
  const parsed = claudeUsageSchema.safeParse(response.usage);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const usage = {
    totalTokens: raw.totalTokens,
    inputTokens: raw.inputTokens + (raw.cachedReadTokens ?? 0) + (raw.cachedWriteTokens ?? 0),
    outputTokens: raw.outputTokens,
  };
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) return null;

  const quota = response._meta?.quota;
  const rows = claudeModelUsageSchema.safeParse(
    quota && typeof quota === "object" && "model_usage" in quota ? quota.model_usage : undefined,
  );
  const models: AcpModelTokenUsage[] = rows.success
    ? rows.data.map(({ model, token_count: row }) => ({
        modelId: model,
        totalTokens: row.totalTokens,
        inputTokens: row.inputTokens + row.cachedInputTokens + (row.cachedWriteTokens ?? 0),
        outputTokens: row.outputTokens,
      }))
    : [];
  const completeRows =
    models.length > 0 &&
    models.every((row) => row.totalTokens === row.inputTokens + row.outputTokens);
  const modelTotal = models.reduce((sum, row) => sum + row.totalTokens, 0);
  if (completeRows && modelTotal >= usage.totalTokens) {
    // 子 Agent 与内部调用可能令模型行比主循环的 usage 更大：采用较完整的一份，
    // 不再把主循环加一次，也不把差额归给配置中的模型。
    return {
      scope: "turn",
      usage: {
        totalTokens: modelTotal,
        inputTokens: models.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: models.reduce((sum, row) => sum + row.outputTokens, 0),
      },
      models,
    };
  }
  return { scope: "turn", usage, models: [] };
}
