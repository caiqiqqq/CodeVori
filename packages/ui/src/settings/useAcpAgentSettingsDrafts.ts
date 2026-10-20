import { useState } from "react";
import {
  ACP_AGENT_MODEL_ENV,
  type AcpAgent,
  type AcpAgentInfo,
  type AcpAgentUpdate,
} from "@zcode/shared";
import {
  clearAcpEnvDraftIfUnchanged,
  normalizeAcpAgentEnvText,
} from "@/settings/acpAgentEnvironment.js";
import { formatAcpEnv, parseAcpEnv } from "@/settings/useAcpAgentManagement.js";

/** One Host-scoped draft per agent, shared by connection fields and the model picker. */
export function useAcpAgentSettingsDrafts(
  agent: AcpAgent,
  info: AcpAgentInfo | undefined,
  update: (input: AcpAgentUpdate) => Promise<void>,
) {
  const [drafts, setDrafts] = useState<
    Partial<Record<AcpAgent, { text?: string; model?: string }>>
  >({});
  const draft = drafts[agent];
  const text = draft?.text ?? formatAcpEnv(info?.env ?? {});
  const defaultModel = draft?.model ?? info?.defaultModel ?? "";
  const nativeModel = Boolean(ACP_AGENT_MODEL_ENV[agent]);
  const changed = Boolean(
    info &&
    (text !== formatAcpEnv(info.env) ||
      (!nativeModel && defaultModel !== (info.defaultModel ?? ""))),
  );
  return {
    text,
    defaultModel,
    changed,
    setText: (text: string) =>
      setDrafts((previous) => ({ ...previous, [agent]: { ...previous[agent], text } })),
    setModel: (model: string) =>
      setDrafts((previous) => ({ ...previous, [agent]: { ...previous[agent], model } })),
    save: async (submitted: string) => {
      const submittedModel = draft?.model;
      const env = parseAcpEnv(normalizeAcpAgentEnvText(agent, submitted));
      await update({
        agent,
        env,
        ...(!nativeModel && submittedModel !== undefined ? { defaultModel: submittedModel } : {}),
      });
      // 修复原因：异步保存的旧回执不能清空等待期间新的变量或模型草稿，两个字段独立比较提交版本。
      setDrafts((previous) => ({
        ...previous,
        [agent]: {
          text: clearAcpEnvDraftIfUnchanged(previous[agent]?.text, submitted),
          model: previous[agent]?.model === submittedModel ? undefined : previous[agent]?.model,
        },
      }));
    },
  };
}
