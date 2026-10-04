import {
  Archive,
  ArchiveRestore,
  Info,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  type LucideIcon,
} from "lucide-react";
import { WORK_TASK_ACTIVE_STATUSES, type WorkTask } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { WorkTaskIconButton, useWorkTaskMessages } from "./WorkTaskParts.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";

export function WorkTaskActions({
  task,
  panel,
  onOpenConversation,
  onEdit,
  onDetails,
  showConversation = true,
  menu = false,
}: {
  task: WorkTask;
  panel: ReturnType<typeof useWorkTasks>;
  onOpenConversation(task: WorkTask): void;
  onEdit(task: WorkTask): void;
  onDetails?(task: WorkTask): void;
  showConversation?: boolean;
  menu?: boolean;
}) {
  const t = useWorkTaskMessages();
  const active = WORK_TASK_ACTIVE_STATUSES.includes(task.status) || task.status === "queued";
  const startable = ["todo", "failed", "canceled"].includes(task.status) && !task.archived;
  const disabled = panel.busy || task.stopPending;
  const actions: { label: string; Icon: LucideIcon; disabled?: boolean; run(): void }[] = [];
  if (onDetails) actions.push({ label: t("details"), Icon: Info, run: () => onDetails(task) });
  if (showConversation && task.session)
    actions.push({
      label: t("openConversation"),
      Icon: MessageSquare,
      run: () => onOpenConversation(task),
    });
  if (startable)
    actions.push({
      label: t(task.status === "todo" ? "start" : "retry"),
      Icon: Play,
      disabled: disabled || !panel.executable,
      run: () => {
        void panel.start(task.id);
      },
    });
  if (["todo", "failed"].includes(task.status))
    actions.push({ label: t("edit"), Icon: Pencil, disabled, run: () => onEdit(task) });
  actions.push(
    active
      ? {
          label: t("cancel"),
          Icon: Square,
          disabled,
          run: () => {
            void panel.cancel(task.id);
          },
        }
      : {
          label: t(task.archived ? "unarchive" : "archive"),
          Icon: task.archived ? ArchiveRestore : Archive,
          disabled,
          run: () => {
            void panel.archive(task.id, !task.archived);
          },
        },
  );
  if (menu)
    return (
      // 菜单内会打开独立弹窗，双重模态锁可能在关闭后残留 body pointer-events:none。
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("taskActions")}
            title={t("taskActions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map(({ label, Icon, disabled, run }) => (
            <DropdownMenuItem key={label} disabled={disabled} onSelect={run}>
              <Icon className="size-4" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {actions.map(({ label, Icon, disabled, run }) => (
        <WorkTaskIconButton key={label} label={label} disabled={disabled} onClick={run}>
          <Icon className="size-4" />
        </WorkTaskIconButton>
      ))}
    </div>
  );
}
