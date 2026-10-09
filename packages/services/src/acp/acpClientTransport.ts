import { randomUUID } from "node:crypto";
import { client as createAcpClient, type Client, type Stream } from "@agentclientprotocol/sdk";
import {
  parseAcpElicitationForm,
  type AcpElicitation,
  type AcpElicitationResponse,
} from "@zcode/shared";

/** SDK adapter only: Host owns request admission and answers; this layer preserves wire cancellation. */
export function connectAcpClientTransport(input: {
  client: Client;
  stream: Stream;
  isActiveSession: (sessionId: string) => boolean;
  onElicitation?: (
    request: AcpElicitation,
    signal?: AbortSignal,
  ) => Promise<AcpElicitationResponse>;
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
        !input.onElicitation
      )
        return { action: "cancel" };
      let fields;
      try {
        fields = parseAcpElicitationForm(params.requestedSchema);
      } catch {
        return { action: "cancel" };
      }
      return input.onElicitation(
        { requestId: randomUUID(), message: params.message, fields },
        signal,
      );
    })
    .connect(input.stream);
}
