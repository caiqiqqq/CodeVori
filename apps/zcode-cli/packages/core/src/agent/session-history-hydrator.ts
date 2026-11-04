import { STREAM_RECOVERY_DISCARDED_ERROR_NAME } from "@zcode/contracts";
import {
  isProviderExecutedToolPartMetadata,
  withCompactGroupKey,
} from "../runtime/provider-tool-rounds/contract.js";
import { buildUserMessageEntries, type UserMessageAttachment } from "./user-message-entries.js";
import { runtimeInputMetadata } from "./runtime-input-presentation.js";
// ============================================================
// Session History Hydration - rebuild provider-visible context
// ============================================================

import { modelMessageContentToText, selectActiveConversationBranch } from "@zcode/contracts";
import type {
  MessagePart,
  MessageWithParts,
  ModelMessageContentBlock,
  ModelReasoningContentBlock,
  MessageId,
  ToolArtifactStorePort,
  ToolPart,
} from "@zcode/contracts";
import {
  getSystemReminderDescriptor,
  wrapSystemReminderForSource,
  type SystemReminderSource,
} from "../system-reminder/source.js";
import { persistedTokenUsageBaseline } from "./message-history-usage.js";
import {
  createRuntimeAssistantEntry,
  createRuntimeToolResultEntry,
  isKnownSystemReminderSource,
  legacySyntheticRuntimeMetadata,
  realUserRuntimeMetadata,
  systemReminderAttachmentEntry,
  systemReminderRuntimeMetadata,
  todoReminderRuntimeMetadata,
  type MessageHistory,
  type RuntimeMessageEntry,
  type RuntimeMessageMetadata,
  type RuntimeMessageSource,
  type ToolCallInput,
} from "./message-history.js";
import { compactActiveSessionMessages, isActiveCompactionBoundaryPart } from "./compact-session.js";
import { filePartToContentBlock, projectPersistedToolMediaContent } from "./file-part-hydration.js";
import { selectToolPartsForHistory } from "./tool-part-order.js";

const INTERRUPTED_TOOL_RESULT = "[Tool execution was interrupted before resume]";

export interface SessionHistoryHydrationResult {
  appliedMessageCount: number;
  interruptedToolCount: number;
  messageCount: number;
  partCount: number;
}

export async function hydrateMessageHistoryFromSession(input: {
  artifactStore?: ToolArtifactStorePort;
  branchCutAfterMessageId?: MessageId;
  history: MessageHistory;
  messages: MessageWithParts[];
  rewindCreatedMessageId?: MessageId;
  rewindKeptMessageIds?: readonly MessageId[];
  rewindTargetMessageId?: MessageId;
}): Promise<SessionHistoryHydrationResult> {
  const activeMessages = activeSessionMessages(input.messages, {
    branchCutAfterMessageId: input.branchCutAfterMessageId,
    rewindCreatedMessageId: input.rewindCreatedMessageId,
    rewindKeptMessageIds: input.rewindKeptMessageIds,
    rewindTargetMessageId: input.rewindTargetMessageId,
  });
  let appliedMessageCount = 0,
    interruptedToolCount = 0,
    partCount = 0;

  for (const message of activeMessages) {
    const parts = dedupeParts(message.parts);
    partCount += parts.length;

    if (message.info.role === "user") {
      const sharedContextStatus =
        message.info.source === "shared_context" &&
        message.info.metadata &&
        typeof message.info.metadata === "object"
          ? (message.info.metadata as Record<string, unknown>).sharedContextStatus
          : undefined;
      if (
        message.info.source === "shared_context" &&
        sharedContextStatus !== undefined &&
        sharedContextStatus !== "attached"
      ) {
        // Share handover 的 pending/reserved context 只是本地候选，不能在用户首次
        // 发送前偷偷进入 provider history；attach 后由 runtime 显式注入一次。
        continue;
      }
      // session 持久化的是 raw synthetic notice，hydrate 阶段若提前包成
      // user <system-reminder>，后续 mid-conversation system projection 会失去 attachment source。
      const syntheticAttachment = syntheticSystemReminderAttachmentFromParts(parts);
      if (syntheticAttachment) {
        input.history.addAttachment(syntheticAttachment.source, syntheticAttachment.content);
        appliedMessageCount++;
        continue;
      }

      const entries = await userEntriesFromParts(parts, input.artifactStore);
      if (entries.length === 0) continue;
      const presentation = runtimeInputMetadata(
        (message.info.metadata as Record<string, unknown> | undefined)?.inputPresentation,
      );
      input.history.addEntries(
        presentation
          ? entries.map((entry) =>
              entry.kind === "attachment" ? entry : { ...entry, metadata: presentation },
            )
          : entries,
      );
      appliedMessageCount++;
      continue;
    }

    // 断流重试 / 执行模型回退作废的 attempt：正文、思考和服务端内置工具轮次从不进入 live history
    // （服务端轮次在流中提前落盘），冷恢复必须同样剔除；退回前已结算的本地工具调用与结果
    // 已提交到 live history，继续保留。不能靠「作废消息恰好没有这些 part」的隐式前提。
    const assistantParts =
      message.info.error?.name === STREAM_RECOVERY_DISCARDED_ERROR_NAME
        ? parts.filter(
            (part) =>
              part.type !== "text" &&
              part.type !== "reasoning" &&
              !(isToolPart(part) && isProviderExecutedToolPartMetadata(part.metadata)),
          )
        : parts;

    const assistantModel =
      message.info.modelId && message.info.providerId
        ? { modelId: message.info.modelId, providerId: message.info.providerId }
        : undefined;
    // 服务端内置工具在流中按顺序落盘：工具 part 之前的 reasoning/text 属于同一轮。
    // 与 live history 一致，每轮回放为 assistant(text, [工具]) + tool(结果)，剩下的走原逻辑。
    const { rounds: providerRounds, remainingParts } = splitProviderToolRoundParts(assistantParts);
    // 这条消息拆出的所有 assistant entry 共用分组键：compact 按数据库消息定持久化边界，两边组数才一致。
    const compactGroupKey = providerRounds.length > 0 ? message.info.id : undefined;
    input.history.addEntries(
      withCompactGroupKey(
        providerRounds.flatMap((round) => {
          const toolPart = round.toolPart;
          return [
            createRuntimeAssistantEntry(
              assistantTextFromParts(round.parts),
              [{ id: toolPart.callID, input: toolPart.state.input, name: toolPart.tool }],
              assistantReasoningFromParts(round.parts),
              assistantModel,
            ),
            createRuntimeToolResultEntry(
              toolPart.callID,
              toolPart.tool,
              toolPart.state.status === "completed"
                ? toolPart.state.output
                : toolPart.state.status === "error"
                  ? toolPart.state.error
                  : INTERRUPTED_TOOL_RESULT,
              toolPart.state.status === "error",
            ),
          ];
        }),
        compactGroupKey,
      ),
    );

    const text = assistantTextFromParts(remainingParts);
    const reasoning = assistantReasoningFromParts(remainingParts);
    const toolParts = selectToolPartsForHistory(remainingParts.filter(isToolPart));
    // 有服务端内置工具轮次时，持久化 usage 是服务端多轮请求的合计，不能当上下文估算锚点；
    // 与 live 一致不挂 tokens，也不为它保留空 assistant。
    const contextUsage = compactGroupKey ? undefined : message.info.tokens;
    // live history 会保留带合法 provider usage 的空 assistant 作为估算锚点，
    // 旧 hydration 却无条件丢弃它，导致重启前后的 context estimate 不一致。
    if (
      text.trim().length === 0 &&
      reasoning.length === 0 &&
      toolParts.length === 0 &&
      !persistedTokenUsageBaseline(contextUsage)
    ) {
      if (providerRounds.length > 0) appliedMessageCount++;
      continue;
    }

    const finalToolCalls = toolParts.map(
      (part): ToolCallInput => ({
        id: part.callID,
        input: part.state.input,
        name: providerToolNameFromPart(part),
      }),
    );
    input.history.addEntries(
      withCompactGroupKey(
        [
          createRuntimeAssistantEntry(
            text,
            finalToolCalls,
            reasoning,
            assistantModel,
            contextUsage,
          ),
        ],
        compactGroupKey,
      ),
    );
    appliedMessageCount++;

    for (const part of toolParts) {
      const providerToolName = providerToolNameFromPart(part);
      if (part.state.status === "completed") {
        // live tool result 使用结构化媒体，但旧恢复只读取 output 摘要，
        // 导致模型切换或冷恢复后丢失 Read/MCP 产生的真实媒体。
        const attachmentBlocks = part.state.attachments
          ? await Promise.all(
              part.state.attachments.map((attachment) =>
                filePartToContentBlock(attachment, input.artifactStore),
              ),
            )
          : [];
        // 旧 completed part 也可能有 attachments；只有完整有效的 layout 才能证明
        // 它们属于新的 provider-visible 媒体内容，缺失或损坏时必须保留 legacy output。
        const projectedMediaContent =
          attachmentBlocks.length > 0
            ? projectPersistedToolMediaContent(
                part.state.metadata?.modelContentLayout,
                attachmentBlocks,
              )
            : undefined;
        const content = projectedMediaContent ?? part.state.output;
        input.history.addToolResult(part.callID, providerToolName, content, true);
        continue;
      }

      if (part.state.status === "error") {
        const persistedModelContent = part.state.metadata?.modelContent;
        // 实时链路使用 ToolExecutionResult.modelContent，但旧恢复逻辑只重放
        // 面向 UI / 日志的 state.error；优先使用持久化字符串并兼容旧 session。
        input.history.addToolResult(
          part.callID,
          providerToolName,
          typeof persistedModelContent === "string" ? persistedModelContent : part.state.error,
          false,
        );
        continue;
      }

      interruptedToolCount++;
      input.history.addToolResult(part.callID, providerToolName, INTERRUPTED_TOOL_RESULT, false);
    }
  }

  return {
    appliedMessageCount,
    interruptedToolCount,
    messageCount: activeMessages.length,
    partCount,
  };
}

export function activeSessionMessages(
  messages: MessageWithParts[],
  options: {
    branchCutAfterMessageId?: MessageId;
    includeCompactPreservedSegment?: boolean;
    rewindCreatedMessageId?: MessageId;
    rewindKeptMessageIds?: readonly MessageId[];
    rewindTargetMessageId?: MessageId;
  } = {},
): MessageWithParts[] {
  if (!options.branchCutAfterMessageId) {
    // 旧数据没有 branch cut，继续使用 compact-first/createdMessageID 兼容语义；不能把
    // 历史上非法的 compact 前 kept IDs 解释成新式 branch，从而改变既有冷恢复结果。
    let legacyCompactIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]!.parts.some(isActiveCompactionBoundaryPart)) {
        legacyCompactIndex = index;
        break;
      }
    }
    const compactActiveMessages =
      legacyCompactIndex >= 0
        ? compactActiveSessionMessages(
            messages,
            legacyCompactIndex,
            options.includeCompactPreservedSegment !== false,
          )
        : messages;
    if (options.rewindKeptMessageIds && legacyCompactIndex >= 0) {
      const postCompactIds = new Set(
        messages.slice(legacyCompactIndex).map((message) => message.info.id),
      );
      if (!options.rewindKeptMessageIds.some((messageId) => postCompactIds.has(messageId))) {
        return compactActiveMessages;
      }
    }
    return selectActiveConversationBranch(compactActiveMessages, options);
  }

  // 最后一个 compact boundary。顺序相反会让 compact 前 kept prefix 永远无法恢复。
  const branchActiveMessages = selectActiveConversationBranch(messages, options);
  let lastCompactionIndex = -1;
  for (let index = branchActiveMessages.length - 1; index >= 0; index--) {
    if (branchActiveMessages[index]!.parts.some(isActiveCompactionBoundaryPart)) {
      lastCompactionIndex = index;
      break;
    }
  }
  return lastCompactionIndex >= 0
    ? compactActiveSessionMessages(
        branchActiveMessages,
        lastCompactionIndex,
        options.includeCompactPreservedSegment !== false,
      )
    : branchActiveMessages;
}

function dedupeParts(parts: MessagePart[]): MessagePart[] {
  const byId = new Map<string, MessagePart>();
  for (const part of parts) {
    byId.set(part.id, part);
  }
  return [...byId.values()];
}

async function userEntriesFromParts(
  parts: MessagePart[],
  artifactStore: ToolArtifactStorePort | undefined,
): Promise<RuntimeMessageEntry[]> {
  const attachments: UserMessageAttachment[] = [];
  const promptBlocks: ModelMessageContentBlock[] = [];
  const syntheticAttachmentEntries: RuntimeMessageEntry[] = [];

  for (const part of parts) {
    if (part.type === "text" && !part.ignored) {
      const syntheticAttachment = syntheticSystemReminderAttachmentFromTextPart(part);
      if (syntheticAttachment) {
        syntheticAttachmentEntries.push(
          systemReminderAttachmentEntry(syntheticAttachment.source, syntheticAttachment.content),
        );
        continue;
      }
      promptBlocks.push({ type: "text", text: textPartToProviderText(part) });
      continue;
    }

    if (part.type === "file") {
      attachments.push({
        ...part,
        contentBlock: await filePartToContentBlock(part, artifactStore),
      });
      continue;
    }

    if (part.type === "agent") {
      promptBlocks.push({ type: "text", text: `[Selected agent: ${part.name}]` });
    }
  }

  // 首发与恢复共用消息历史的组装规则，不能按 MIME 再次重排或把失败引用当成功附件。
  const prompt =
    attachments.length > 0
      ? promptBlocks
      : promptBlocks
          .map((block) => (block.type === "text" ? block.text : ""))
          .filter(Boolean)
          .join("\n\n");
  const [userEntry, ...promptAttachmentEntries] = buildUserMessageEntries(prompt, attachments);
  const content = userEntry.message.content;
  const hasUserContent = modelMessageContentToText(content).trim().length > 0;
  const userMetadata = metadataFromUserParts(parts);
  // 文本附件从原始 file part 恢复为 prompt_attachment 后，空正文的
  // real_user envelope 曾被 trim 判空丢弃，导致 live 与 resume 的 provider history 不一致。
  // 这里只恢复 Agent 内存锚点；bare-empty 和纯 synthetic/meta user 仍不生成空消息。
  const shouldRestoreRealUserEnvelope =
    hasUserContent || (userMetadata.source === "real_user" && promptAttachmentEntries.length > 0);
  if (
    !shouldRestoreRealUserEnvelope &&
    syntheticAttachmentEntries.length === 0 &&
    promptAttachmentEntries.length === 0
  ) {
    return [];
  }
  return [
    ...(shouldRestoreRealUserEnvelope
      ? [
          {
            message: { role: "user" as const, content },
            metadata: userMetadata,
          },
        ]
      : []),
    ...syntheticAttachmentEntries,
    ...promptAttachmentEntries,
  ];
}

function textPartToProviderText(part: Extract<MessagePart, { type: "text" }>): string {
  if (!part.synthetic) {
    return part.text;
  }
  if (isProviderWrappedSystemReminderText(part.text)) {
    return part.text;
  }

  const runtimeMetadata = runtimeMessageMetadataFromPartMetadata(part.metadata);
  if (runtimeMetadata?.source === "task_status" && part.metadata?.source !== "background_task") {
    return wrapSystemReminderForSource("task_status", part.text);
  }
  if (
    runtimeMetadata?.source === "queued_system_notification" ||
    part.metadata?.source === "subagent"
  ) {
    // subagent notification 同样只在 provider history 恢复时包外层，避免改动 session/UI raw transcript。
    return wrapSystemReminderForSource("queued_system_notification", part.text);
  }
  return part.text;
}

interface SyntheticSystemReminderAttachment {
  source: SystemReminderSource;
  content: string;
}

function syntheticSystemReminderAttachmentFromParts(
  parts: MessagePart[],
): SyntheticSystemReminderAttachment | undefined {
  const visibleParts = parts.filter((part) => !(part.type === "text" && part.ignored));
  if (visibleParts.length !== 1) return undefined;

  const part = visibleParts[0]!;
  if (part.type !== "text" || !part.synthetic) return undefined;
  return syntheticSystemReminderAttachmentFromTextPart(part);
}

function syntheticSystemReminderAttachmentFromTextPart(
  part: Extract<MessagePart, { type: "text" }>,
): SyntheticSystemReminderAttachment | undefined {
  if (!part.synthetic) return undefined;
  if (part.text.trim().length === 0) return undefined;
  if (isProviderWrappedSystemReminderText(part.text)) return undefined;
  const metadata = metadataFromSyntheticTextPart(part);
  if (!isRestorableSystemReminderAttachmentSource(metadata.source)) return undefined;

  return {
    source: metadata.source,
    content: part.text,
  };
}

function isRestorableSystemReminderAttachmentSource(
  source: RuntimeMessageSource,
): source is SystemReminderSource {
  if (!isKnownSystemReminderSource(source)) return false;
  const descriptor = getSystemReminderDescriptor(source);
  return (
    descriptor.isMeta &&
    descriptor.providerVisibility === "provider_visible" &&
    descriptor.channel !== "real_user" &&
    descriptor.channel !== "tool_result"
  );
}

function isProviderWrappedSystemReminderText(text: string): boolean {
  return text.trimStart().startsWith("<system-reminder");
}

function metadataFromUserParts(parts: MessagePart[]): RuntimeMessageMetadata {
  const visibleTextParts = parts.filter(
    (part): part is Extract<MessagePart, { type: "text" }> => part.type === "text" && !part.ignored,
  );
  const hasRealUserText = visibleTextParts.some((part) => !part.synthetic);
  const hasStructuredUserPart = parts.some((part) => part.type === "file" || part.type === "agent");
  if (hasRealUserText || hasStructuredUserPart) {
    return realUserRuntimeMetadata();
  }

  const syntheticTextPart = visibleTextParts.find((part) => part.synthetic);
  if (!syntheticTextPart) {
    return realUserRuntimeMetadata();
  }

  return metadataFromSyntheticTextPart(syntheticTextPart);
}

function metadataFromSyntheticTextPart(
  part: Extract<MessagePart, { type: "text" }>,
): RuntimeMessageMetadata {
  const source = part.metadata?.source;
  if (source === "background_task" || source === "subagent_message") {
    // runtime command carrier 对齐直接 user-like 注入；即使旧持久化里带过
    // system reminder metadata，恢复时也不能把后台完成或 child 回复重新包成 reminder。
    return legacySyntheticRuntimeMetadata();
  }

  const persistedRuntimeMetadata = runtimeMessageMetadataFromPartMetadata(part.metadata);
  if (persistedRuntimeMetadata) {
    return persistedRuntimeMetadata;
  }

  if (source === "subagent") {
    return systemReminderRuntimeMetadata("queued_system_notification");
  }
  if (source === "todo_reminder") {
    return todoReminderRuntimeMetadata();
  }
  if (source === "goal-continuation") {
    return systemReminderRuntimeMetadata("target_continuation");
  }
  if (source === "rewind" || source === "fork") {
    return systemReminderRuntimeMetadata("rewind_notice");
  }
  if (isKnownSystemReminderSource(source)) {
    return systemReminderRuntimeMetadata(source);
  }

  return legacySyntheticRuntimeMetadata();
}

function runtimeMessageMetadataFromPartMetadata(
  metadata: Record<string, unknown> | undefined,
): RuntimeMessageMetadata | undefined {
  const runtimeMessage = metadata?.runtimeMessage;
  if (!isRecord(runtimeMessage)) return undefined;

  const presentation = runtimeInputMetadata(runtimeMessage.inputPresentation);
  if (presentation) return presentation;
  const source = runtimeMessage.source;
  if (source === "real_user") {
    return realUserRuntimeMetadata();
  }
  if (source === "legacy_synthetic") {
    return legacySyntheticRuntimeMetadata();
  }
  if (source === "todo_reminder") {
    return todoReminderRuntimeMetadata();
  }
  if (isKnownSystemReminderSource(source)) {
    return systemReminderRuntimeMetadata(source);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assistantTextFromParts(parts: MessagePart[]): string {
  const chunks: string[] = [];

  for (const part of parts) {
    if (part.type === "text" && !part.ignored) {
      chunks.push(part.text);
    }
  }

  return chunks.join("\n\n");
}

function assistantReasoningFromParts(parts: MessagePart[]): ModelReasoningContentBlock[] {
  const blocks: ModelReasoningContentBlock[] = [];

  for (const part of parts) {
    if (part.type === "reasoning") {
      blocks.push({
        type: "reasoning",
        text: part.text,
        providerOptions: part.metadata ? { ...part.metadata } : undefined,
      });
    }
  }

  return blocks;
}

function isToolPart(part: MessagePart): part is ToolPart {
  return part.type === "tool";
}

function providerToolNameFromPart(part: ToolPart): string {
  const providerToolName = part.metadata?.providerToolName;
  // 空字符串在 cold hydration 中曾只能依赖 non-empty ToolPart.tool；
  // 必须按字段存在性恢复原值，不能用 truthy 判断把空名重新覆盖成占位值。
  return providerToolName !== undefined && typeof providerToolName === "string"
    ? providerToolName
    : part.tool;
}

function splitProviderToolRoundParts(parts: MessagePart[]): {
  rounds: Array<{ parts: MessagePart[]; toolPart: ToolPart }>;
  remainingParts: MessagePart[];
} {
  if (
    !parts.some((part) => isToolPart(part) && isProviderExecutedToolPartMetadata(part.metadata))
  ) {
    return { rounds: [], remainingParts: parts };
  }
  const rounds: Array<{ parts: MessagePart[]; toolPart: ToolPart }> = [];
  const remainingParts: MessagePart[] = [];
  let pending: MessagePart[] = [];
  for (const part of parts) {
    if (isToolPart(part) && isProviderExecutedToolPartMetadata(part.metadata)) {
      rounds.push({ parts: pending, toolPart: part });
      pending = [];
    } else if (part.type === "text" || part.type === "reasoning") {
      pending.push(part);
    } else {
      remainingParts.push(part);
    }
  }
  return { rounds, remainingParts: [...remainingParts, ...pending] };
}
