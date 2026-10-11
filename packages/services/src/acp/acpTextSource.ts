import { acpTextSourceSchema, type AcpSession } from "@zcode/shared";

/** 模型只来自原会话的真实目录；缺失时不能偷偷使用全局 API 或另一个模型。 */
export function acpTextSource(session: AcpSession) {
  if (session.agent !== "codex" && session.agent !== "claude")
    throw new Error("work-task.result-agent-unsupported");
  const model = session.configOptions.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
  if (!model || model.type !== "select" || !model.currentValue.trim())
    throw new Error("work-task.result-model-unavailable");
  const selected = model.options
    .flatMap((option) => ("group" in option ? option.options : [option]))
    .find((option) => option.value === model.currentValue);
  if (!selected) throw new Error("work-task.result-model-unavailable");
  return acpTextSourceSchema.parse({
    agent: session.agent,
    modelId: model.currentValue,
    modelName: selected.name,
  });
}

export function acpTextConfigFingerprint(session: AcpSession) {
  return JSON.stringify([session.agent, session.configOptions, session.modeState]);
}
