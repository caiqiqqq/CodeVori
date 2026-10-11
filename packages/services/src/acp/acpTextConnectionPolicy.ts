import type { AcpAgent } from "@zcode/shared";

/** Claude 的能力限制必须在 session/new 生效；提示词不能代替工具和设置边界。 */
export function acpTextConnectionPolicy(input: {
  agent: AcpAgent;
  sessionId?: string;
  textOnly?: boolean;
}) {
  if (!input.textOnly) return { terminal: true, sessionMeta: {} };
  if (input.agent !== "claude" || input.sessionId)
    throw new Error("work-task.result-agent-unsupported");
  return {
    terminal: false,
    sessionMeta: {
      _meta: {
        claudeCode: {
          options: {
            tools: [],
            mcpServers: {},
            settingSources: [],
            permissionMode: "default",
            settings: { hooks: {}, disableAllHooks: true },
          },
        },
      },
    },
  };
}
