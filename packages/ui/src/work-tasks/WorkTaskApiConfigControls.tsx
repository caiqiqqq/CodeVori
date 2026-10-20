import type { WorkTaskExecution, ZCodeConfigOption } from "@zcode/shared";
import { BrainIcon } from "lucide-react";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

type ApiExecution = Extract<WorkTaskExecution, { kind: "api" }>;

export function WorkTaskApiConfigControls({
  execution,
  thought,
  disabled,
  onChange,
}: {
  execution: ApiExecution;
  thought: ZCodeConfigOption | null;
  disabled: boolean;
  onChange(next: ApiExecution): void;
}) {
  const t = useWorkTaskMessages();
  const reasoningLevel = execution.modelSelection.options?.reasoningLevel;
  const reasoningName = thought?.options?.find((item) => item.value === reasoningLevel)?.name;
  // 修复原因：任务表单曾自行实现一套 Select；复用消息工具栏的展示、定位及键盘交互。
  return (
    <>
      <ConfigSelect
        option={{
          id: "mode",
          name: t("mode"),
          category: "mode",
          type: "select",
          currentValue: execution.mode,
          options: ["build", "edit", "plan", "yolo"].map((mode) => ({
            value: mode,
            name: t(`mode.${mode}`),
          })),
        }}
        onValueChange={(mode) => onChange({ ...execution, mode: mode as ApiExecution["mode"] })}
        disabled={disabled}
        tooltipTitle={`${t("mode")}: ${t(`mode.${execution.mode}`)}`}
        triggerSize="default"
        triggerClassName="size-7 justify-center gap-0 p-0"
        indicatorClassName="hidden"
        labelVisibilityClassName="hidden"
        restoreFocusSelector={null}
      />
      {thought?.options?.length ? (
        <ConfigSelect
          option={{ ...thought, currentValue: reasoningLevel ?? "" }}
          onValueChange={(reasoningLevel) =>
            onChange({
              ...execution,
              modelSelection: { ...execution.modelSelection, options: { reasoningLevel } },
            })
          }
          disabled={disabled}
          tooltipTitle={`${t("reasoning")}: ${reasoningName ?? reasoningLevel ?? t("agentDefault")}`}
          leadingIcon={BrainIcon}
          triggerSize="default"
          triggerClassName="size-7 justify-center gap-0 p-0"
          indicatorClassName="hidden"
          labelVisibilityClassName="hidden"
          restoreFocusSelector={null}
        />
      ) : null}
    </>
  );
}
