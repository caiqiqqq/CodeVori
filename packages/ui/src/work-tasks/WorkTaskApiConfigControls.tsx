import type { WorkTaskExecution, ZCodeConfigOption } from "@zcode/shared";
import { BrainIcon } from "lucide-react";
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-ui-sm text-foreground-subtle">{t("mode")}</span>
        <Select
          value={execution.mode}
          onValueChange={(mode) => onChange({ ...execution, mode: mode as ApiExecution["mode"] })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={modeTitle}>
            <ModeIcon className="size-4" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">{t(`mode.${execution.mode}`)}</span>
          </SelectTrigger>
          {/* 此触发器手动显示模式文字，仍保留 popper 定位，避免缺少 SelectValue 锚点造成菜单偏移。 */}
          <SelectContent position="popper" side="top" align="start" sideOffset={4}>
            {["build", "edit", "plan", "yolo"].map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`mode.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {thought?.options?.length ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-ui-sm text-foreground-subtle">{t("reasoning")}</span>
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
            <SelectTrigger className="w-full min-w-0" aria-label={reasoningTitle}>
              <BrainIcon className="size-4" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">
                {reasoningName ?? reasoningLevel ?? t("agentDefault")}
              </span>
            </SelectTrigger>
            <SelectContent position="popper" side="top" align="start" sideOffset={4}>
              {thought.options.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </>
  );
}
