import { acpAgentDefinition, formatModelPickerValue, type AcpAgent } from "@zcode/shared";

interface TabConfig {
  provider: string;
  model: string;
}

interface ConversationTabPresentationParams {
  sessionId: string | null;
  snapshot?: { sessionId: string; meta: { title?: string | null }; config: TabConfig } | null;
  draftConfig?: Partial<TabConfig> | null;
  acpAgent?: AcpAgent | null;
  acpSessionId?: string;
  acpSession?: { id: string; agent: AcpAgent; title: string } | null;
  labels: { newTask: string; untitled: string };
}

export function resolveWorkbenchConversationTabPresentation({
  sessionId,
  snapshot,
  draftConfig,
  acpAgent,
  acpSessionId,
  acpSession,
  labels,
}: ConversationTabPresentationParams): { title: string; agent?: AcpAgent; model?: string } {
  if (acpAgent) {
    const matches =
      acpSession?.agent === acpAgent && (!acpSessionId || acpSession.id === acpSessionId);
    return {
      title: (matches && acpSession.title.trim()) || acpAgentDefinition(acpAgent).name,
      agent: acpAgent,
    };
  }

  // 同一 pane 可被侧栏重新绑定；新 snapshot 到达前不能把上一条对话的标题和图标放进新标签。
  const currentSnapshot = sessionId && snapshot?.sessionId === sessionId ? snapshot : null;
  const config = sessionId ? currentSnapshot?.config : draftConfig;
  return {
    title: sessionId ? currentSnapshot?.meta.title?.trim() || labels.untitled : labels.newTask,
    ...(config?.provider && config.model
      ? { model: formatModelPickerValue({ providerId: config.provider, modelId: config.model }) }
      : {}),
  };
}
