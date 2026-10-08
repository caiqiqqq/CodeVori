import { delegationResultSchema, type DelegationTask, type WorkTask } from "@zcode/shared";
import type { IAcpService } from "../acp/acpService.js";
import type { WorkTaskExecutionContext } from "../session/contract.js";
import { executeWorkTaskConversation } from "../work-task/workTaskExecution.js";
import { prepareWorkTaskWorktree } from "../work-task/workTaskWorktree.js";
import { readDelegationApiAnswer } from "./delegationApiResult.js";

type Dependencies = Parameters<typeof executeWorkTaskConversation>[0];
export function createDelegationExecution(deps: Dependencies) {
  return async (task: DelegationTask, context: WorkTaskExecutionContext) => {
    const attempt = task.attempts.at(-1)!;
    // API sendText 没有 ACP 的 workspaceFiles 参数，显式路径必须进入委派提示才能被子模型读取。
    const files = task.workspaceFiles?.length
      ? `\n项目文件：${JSON.stringify(task.workspaceFiles)}`
      : "";
    const prompt = `你正在执行 ZCode 委派任务，不代表收到提交、合并或推送授权。\n任务：${task.task}\n背景：${task.background}${files}\n约束：${task.constraints}\n预期结果：${task.expectedResult}\n${task.intent === "analysis" ? "本任务为分析，请勿修改项目文件。" : "在分配给你的独立工作树内修改。"}\n仅处理当前任务；完成后调用 zcode-delegation 的 SubmitDelegationResult，携带 commandId=${attempt.commandId}，返回 conclusion、changedFiles、tests、risks、blockers。没有该工具时在最终回答中逐项报告。`;
    const work: WorkTask = {
      ...task.parent,
      id: task.id,
      title: task.title,
      prompt,
      runText: prompt,
      execution: task.execution,
      attachments: task.attachments,
      workspaceFiles: task.workspaceFiles,
      status: "preparing",
      archived: false,
      runSeq: attempt.sequence,
      commandId: attempt.commandId,
      sessionRequestId: task.sessionRequestId,
      session: task.session,
      worktree: task.worktree,
      stopPending: false,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    const port: WorkTaskExecutionContext = {
      signal: context.signal,
      async update(patch) {
        const accepted = await context.update(patch);
        if (accepted) Object.assign(work, patch);
        return accepted;
      },
    };
    const path =
      task.intent === "edit"
        ? (await prepareWorkTaskWorktree(deps, work, port)).path
        : task.parent.workspacePath;
    await executeWorkTaskConversation(deps, work, port, path);
    context.signal.throwIfAborted();
    if (!work.session) throw new Error("delegation.session-missing");
    const answer =
      work.session.kind === "api"
        ? await readDelegationApiAnswer(
            deps.agent,
            path,
            work.session.id,
            attempt.commandId,
            context.signal,
          )
        : (await deps.acp.read({ workspacePath: path, id: work.session.id })).entries.findLast(
            (e) => e.kind === "assistant",
          )?.text;
    return delegationResultSchema.parse({
      conclusion: answer ?? "智能体已结束，但未返回最终文本。请打开子会话核对工具结果。",
      structured: false,
    });
  };
}

export function createDelegationDelivery(deps: { acp: IAcpService; agent: Dependencies["agent"] }) {
  return async (task: DelegationTask, commandId: string, text: string) => {
    if (task.parent.kind === "acp")
      return deps.acp.notifyResult({ ...task.parent, id: task.parent.sessionId, commandId, text });
    const { createZCodeAgentConnectionScope } =
      await import("../zcode-agent/zcodeAgentConnectionScope.js");
    const connection = createZCodeAgentConnectionScope(deps.agent, {
      connectionId: `delegation-result:${task.id}`,
      clientMode: "desktop-continuous",
    });
    try {
      const agent = connection.service;
      const hello = await agent.helloConversationV4();
      const clientId = `delegation-result:${task.id}`;
      await agent.initializeConversationV4({
        kind: "clientHello",
        protocolVersion: hello.protocolVersion,
        clientId,
        clientKind: "desktop",
        appVersion: "delegation",
      });
      const ack = await agent.sendConversationCommandV4({
        ...task.parent,
        envelope: {
          type: "sendText",
          sessionId: task.parent.sessionId,
          commandId,
          clientId,
          issuedAt: Date.now(),
          payload: { text, requestedDelivery: "queue" },
        },
      });
      if (!["accepted", "duplicate"].includes(ack.status))
        throw new Error(ack.reasonCode ?? "delegation.delivery-rejected");
      return true;
    } finally {
      await connection.dispose();
    }
  };
}
