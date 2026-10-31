import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zcodeWorkflowSaveInputSchema, type AcpSession } from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { AcpPermission } from "./acpServiceImpl.js";

export type AcpSavedWorkflowService = Pick<
  IZCodeAgentService,
  "prepareWorkflowSave" | "saveWorkflow" | "listSavedWorkflows"
>;

export const savedWorkflowTools = [
  {
    name: "SaveWorkflow",
    description:
      "Save a reusable workflow definition only when the user explicitly asks or agrees. Requires scope (project/global), metadata and exactly one of script/script_path. Checks before one-time approval; saves without running. CreateWorkflow only starts a run and does not save it.",
    inputSchema: z.toJSONSchema(zcodeWorkflowSaveInputSchema),
  },
  {
    name: "ListSavedWorkflows",
    description:
      "List reusable workflow definitions in this project and the global archive (project names take precedence). These are saved definitions, not workflow runs.",
    inputSchema: z.toJSONSchema(z.object({}).strict()),
  },
];

/** ACP 只负责会话绑定和审批；校验、编解码、目录规则与写入都归目标 Agent。 */
export async function callSavedWorkflowTool(
  name: string,
  args: Record<string, unknown>,
  session: AcpSession,
  service: AcpSavedWorkflowService,
  permission: (session: AcpSession, request: AcpPermission) => Promise<string | null>,
) {
  const target = {
    workspacePath: session.workspacePath,
    ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
    ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
  };
  if (name === "ListSavedWorkflows") {
    z.object({}).strict().parse(args);
    return service.listSavedWorkflows({ ...target, includeGlobal: true });
  }
  const input = zcodeWorkflowSaveInputSchema.parse(args);
  const prepared = await service.prepareWorkflowSave({ ...target, input });
  if (!prepared.ok)
    return { ...prepared, response: "The workflow script has errors. Nothing was saved." };
  // 修复原因：CreateWorkflow 的会话 journal 不属于中枢定义目录；只有明确批准后才调用共用保存接口。
  // 确认和落盘使用同一份已解析正文，批准之后不再读取 script_path。
  const decision = await permission(session, {
    requestId: randomUUID(),
    title: `保存工作流「${prepared.input.name}」？\n${JSON.stringify(prepared.input, null, 2)}`,
    options: [
      { optionId: "allow", name: "允许", kind: "allow_once" },
      { optionId: "reject", name: "拒绝", kind: "reject" },
    ],
  });
  if (decision !== "allow")
    return { ok: false, status: "rejected", response: "用户拒绝保存工作流，未写入文件" };
  const saved = await service.saveWorkflow({ ...target, input: prepared.input });
  return saved.ok
    ? {
        ...saved,
        response: `Saved workflow '${saved.name}' to ${saved.path}. Available in Automations → Workflows. Saving did not start a run.`,
      }
    : saved;
}
