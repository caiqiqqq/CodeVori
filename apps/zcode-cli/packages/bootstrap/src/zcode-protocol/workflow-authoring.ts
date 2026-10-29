import { prepareWorkflowSave, saveWorkflowDefinition } from "@zcode/core";
import {
  zcodeWorkflowsPrepareSaveParamsSchema,
  zcodeWorkflowsPrepareSaveResultSchema,
  zcodeWorkflowsSaveParamsSchema,
  zcodeWorkflowsSaveResultSchema,
  type ZCodeWorkflowsPrepareSaveResult,
  type ZCodeWorkflowsSaveResult,
} from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

/** 只解析草稿并检查脚本；冻结正文交给 Host 展示和审批，不写文件或启动 run。 */
export async function prepareWorkflowSaveOp(
  _context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<ZCodeWorkflowsPrepareSaveResult> {
  const { workspace, input } = parseParams(zcodeWorkflowsPrepareSaveParamsSchema, rawParams);
  return zcodeWorkflowsPrepareSaveResultSchema.parse(
    await prepareWorkflowSave(input, workspace.workspacePath),
  );
}

/** 与 updateMeta 同为可信 Host 写接口；ACP 必须先对冻结正文完成一次性权限审批。 */
export async function saveWorkflowOp(
  _context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<ZCodeWorkflowsSaveResult> {
  const { workspace, input } = parseParams(zcodeWorkflowsSaveParamsSchema, rawParams);
  return zcodeWorkflowsSaveResultSchema.parse(
    await saveWorkflowDefinition(input, workspace.workspacePath),
  );
}
