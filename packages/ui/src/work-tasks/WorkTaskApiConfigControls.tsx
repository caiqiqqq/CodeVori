import type { WorkTaskExecution, ZCodeConfigOption } from "@zcode/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
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
  return (
    <>
      <Select
        value={execution.mode}
        onValueChange={(mode) => onChange({ ...execution, mode: mode as ApiExecution["mode"] })}
        disabled={disabled}
      >
        <SelectTrigger variant="ghost" className="max-w-40" aria-label={t("mode")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
          <SelectTrigger variant="ghost" className="max-w-40" aria-label={t("reasoning")}>
            <SelectValue placeholder={t("reasoning")} />
          </SelectTrigger>
          <SelectContent>
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
