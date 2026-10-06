import type { ComponentProps } from "react";
import type { GitLocalBranch } from "@zcode/shared";
import { GitBranch } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskBranchSelect({
  label,
  value,
  branches,
  disabled,
  size = "default",
  allowHead = false,
  onChange,
  onOpen,
  testId,
}: {
  label: string;
  value?: string;
  branches: readonly GitLocalBranch[];
  disabled?: boolean;
  size?: ComponentProps<typeof SelectTrigger>["size"];
  allowHead?: boolean;
  onChange(value: string | undefined): void;
  onOpen?(): void;
  testId: string;
}) {
  const t = useWorkTaskMessages();
  return (
    <Select
      value={value ? `branch:${value}` : allowHead ? "head" : ""}
      disabled={disabled}
      onValueChange={(next) => {
        // 异步分支注册时 native select 会短暂回写空值，不能把默认分支草稿清空。
        if (next === "head") onChange(undefined);
        else if (next.startsWith("branch:") && next.length > 7) onChange(next.slice(7));
      }}
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <SelectTrigger
        size={size}
        id={testId}
        aria-label={label}
        data-testid={testId}
        className="w-full min-w-0 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1"
      >
        <GitBranch className="size-3.5 shrink-0" />
        <SelectValue placeholder={t("selectBranch")}>
          <span className="min-w-0 truncate font-mono">
            {value ?? (allowHead ? t("currentHead") : t("selectBranch"))}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-h-64 w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]"
      >
        {allowHead ? <SelectItem value="head">{t("currentHead")}</SelectItem> : null}
        {branches.map((branch) => (
          <SelectItem
            key={branch.name}
            value={`branch:${branch.name}`}
            className="min-w-0 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
          >
            <span className="block truncate font-mono" title={branch.name}>
              {branch.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
