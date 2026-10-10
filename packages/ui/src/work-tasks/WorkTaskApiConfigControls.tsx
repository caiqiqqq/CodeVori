import type { WorkTaskExecution, ZCodeConfigOption } from "@zcode/shared";
import { BrainIcon } from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { resolveModeOptionIcon } from "@/chat-input-toolbar/display.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select.js";
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
  const ModeIcon = resolveModeOptionIcon(execution.mode);
  const modeTitle = `${t("mode")}: ${t(`mode.${execution.mode}`)}`;
  const reasoningLevel = execution.modelSelection.options?.reasoningLevel;
  const reasoningName = thought?.options?.find((item) => item.value === reasoningLevel)?.name;
  const reasoningTitle = `${t("reasoning")}: ${reasoningName ?? reasoningLevel ?? t("agentDefault")}`;
  return (
    <>
      <Select
        value={execution.mode}
        onValueChange={(mode) => onChange({ ...execution, mode: mode as ApiExecution["mode"] })}
        disabled={disabled}
      >
        <ControlHintTooltip title={modeTitle}>
          <SelectTrigger
            variant="ghost"
            className="h-7 w-7 justify-center rounded-lg p-0"
            indicator={<span />}
            aria-label={modeTitle}
          >
            <ModeIcon className="size-4" aria-hidden="true" />
          </SelectTrigger>
        </ControlHintTooltip>
        {/* 图标触发器没有 SelectValue 文字锚点，item-aligned 会把菜单定位到视口外。 */}
        <SelectContent position="popper" side="top" align="start" sideOffset={4}>
          {["build", "edit", "plan", "yolo"].map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`mode.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {thought?.options?.length ? (
        <Select
          value={execution.modelSelection.options?.reasoningLevel ?? ""}
          onValueChange={(reasoningLevel) =>
            onChange({
              ...execution,
              modelSelection: { ...execution.modelSelection, options: { reasoningLevel } },
            })
          }
          disabled={disabled}
        >
          <ControlHintTooltip title={reasoningTitle}>
            <SelectTrigger
              variant="ghost"
              className="h-7 w-7 justify-center rounded-lg p-0"
              indicator={<span />}
              aria-label={reasoningTitle}
            >
              <BrainIcon className="size-4" aria-hidden="true" />
            </SelectTrigger>
          </ControlHintTooltip>
          <SelectContent position="popper" side="top" align="start" sideOffset={4}>
            {thought.options.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </>
  );
}
