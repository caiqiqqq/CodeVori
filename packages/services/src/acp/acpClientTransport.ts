import { randomUUID } from "node:crypto";
import { client as createAcpClient, type Client, type Stream } from "@agentclientprotocol/sdk";
import {
  parseAcpElicitationForm,
  type AcpAgent,
  type AcpElicitation,
  type AcpElicitationField,
  type AcpElicitationResponse,
} from "@zcode/shared";

const ELICITATION_DECLINE_OPTION_ID = "__decline";

type ApprovalOption = { optionId: string; name: string; kind: string };

function approvalOptions(fields: AcpElicitationField[]) {
  const persist = fields.find(
    (field) => field.key === "persist" && field.type === "string" && field.choices.length > 0,
  );
  const options = (persist?.choices ?? [])
    .filter((choice) => choice.value.trim() && choice.value !== ELICITATION_DECLINE_OPTION_ID)
    .map((choice) => ({
      optionId: choice.value,
      name: choice.label || choice.value,
      kind: choice.value === "once" ? "allow_once" : "allow_always",
    }));
  const hasPersistChoice = options.length > 0;
  if (!hasPersistChoice) options.push({ optionId: "accept", name: "Allow", kind: "allow_once" });
  options.push({ optionId: ELICITATION_DECLINE_OPTION_ID, name: "Decline", kind: "reject_once" });
  return { options, hasPersistChoice };
}

/** SDK adapter only: Host owns request admission and answers; this layer preserves wire cancellation. */
export function connectAcpClientTransport(input: {
  agent: AcpAgent;
  client: Client;
  stream: Stream;
  isActiveSession: (sessionId: string) => boolean;
  onElicitation?: (
    request: AcpElicitation,
    signal?: AbortSignal,
  ) => Promise<AcpElicitationResponse>;
  onElicitationApproval?: (
    request: {
      requestId: string;
      toolCallId: string;
      title: string;
      options: ApprovalOption[];
    },
    signal?: AbortSignal,
  ) => Promise<string | null>;
}) {
  const { client } = input;
  // 修复原因：旧 Client 回调丢失 request signal，表单自动结束后会留下不可回答的等待态。
  // typed handler 将协议取消传给同一 Host owner，不额外创建超时或状态所有者。
  return createAcpClient()
    .onNotification("session/update", ({ params }) => client.sessionUpdate(params))
    .onRequest("session/request_permission", ({ params }) => client.requestPermission(params))
    .onRequest("terminal/create", ({ params }) => client.createTerminal!(params))
    .onRequest("terminal/output", ({ params }) => client.terminalOutput!(params))
    .onRequest("terminal/wait_for_exit", ({ params }) => client.waitForTerminalExit!(params))
    .onRequest("terminal/kill", async ({ params }) => (await client.killTerminal!(params)) ?? {})
    .onRequest(
      "terminal/release",
      async ({ params }) => (await client.releaseTerminal!(params)) ?? {},
    )
    .onRequest("elicitation/create", async ({ params, signal }) => {
      if (
        signal.aborted ||
        params.mode !== "form" ||
        !("sessionId" in params) ||
        typeof params.sessionId !== "string" ||
        !input.isActiveSession(params.sessionId) ||
        (!input.onElicitation && !input.onElicitationApproval)
      )
        return { action: "cancel" };
      let fields;
      try {
        fields = parseAcpElicitationForm(params.requestedSchema);
      } catch {
        return { action: "cancel" };
      }
      // 修复原因：Codex 通过 elicitation/create 发送 MCP 工具审批，需按协议标记回到授权卡。
      const codexApproval =
        (input.agent === "codex" && params._meta?.codex_approval_kind === "mcp_tool_call") ||
        fields.length === 0;
      if (codexApproval) {
        if (!input.onElicitationApproval) return { action: "cancel" };
        const requestId = randomUUID();
        const toolCallId =
          "toolCallId" in params && typeof params.toolCallId === "string"
            ? params.toolCallId
            : `elicitation-${requestId}`;
        const { options, hasPersistChoice } = approvalOptions(fields);
        const optionId = await input.onElicitationApproval(
          {
            requestId,
            toolCallId,
            title: params.message.slice(0, 8192),
            options,
          },
          signal,
        );
        if (signal.aborted || optionId === null) return { action: "cancel" };
        if (optionId === ELICITATION_DECLINE_OPTION_ID) return { action: "decline" };
        if (!options.some((option) => option.optionId === optionId)) return { action: "cancel" };
        return {
          action: "accept",
          content: hasPersistChoice ? { persist: optionId } : {},
        };
      }
      if (!input.onElicitation) return { action: "cancel" };
      return input.onElicitation(
        { requestId: randomUUID(), message: params.message, fields },
        signal,
      );
    })
    .connect(input.stream);
}
