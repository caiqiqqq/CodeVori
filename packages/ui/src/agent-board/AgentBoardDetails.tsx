import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { lazy, Suspense } from "react";
import { Archive, ArrowUpRight, X } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import {
  boardAgentLabel,
  boardStatusIndicator,
  type BoardItem,
  type BoardProject,
} from "./agentBoardModel.js";
import type { BoardAction } from "@/hooks/useAgentBoardData.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";
const WorkTaskDetails = lazy(() =>
  import("./AgentBoardWorkTaskDetails.js").then((m) => ({ default: m.AgentBoardWorkTaskDetails })),
);
const Conversation = lazy(() =>
  import("./AgentBoardConversation.js").then((m) => ({ default: m.AgentBoardConversation })),
);
export function AgentBoardDetails({
  selected,
  workTasks,
  projects,
  busy,
  run,
  options,
  onClose,
  onOpenSession,
}: {
  selected: BoardItem | undefined;
  workTasks: ReturnType<typeof useWorkTasks>;
  projects: BoardProject[];
  busy: boolean;
  run(item: BoardItem, action: BoardAction): Promise<void>;
  options?: BoardConversationOptions;
  onClose(): void;
  onOpenSession(item: BoardItem): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  if (selected?.kind === "work-task")
    return (
      <Suspense fallback={null}>
        <WorkTaskDetails
          key={selected.key}
          item={selected}
          workTasks={workTasks}
          options={options}
          onClose={onClose}
          onOpenSession={onOpenSession}
        />
      </Suspense>
    );
  return (
    <Dialog
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="inset-y-0 right-0 left-auto flex h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-3xl"
      >
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-2 border-b border-border p-4">
              <div className="min-w-0">
                <DialogTitle className="truncate">{selected.title}</DialogTitle>
                <DialogDescription className="truncate">
                  {projects.find((p) => p.key === selected.projectKey)?.label} ·{" "}
                  {boardAgentLabel(selected)} · {t(`status.${boardStatusIndicator(selected)}`)}
                  {!selected.online ? ` · ${t("offline")}` : ""}
                </DialogDescription>
                {selected.workspacePurpose !== "conversation" ? (
                  <p
                    className="truncate text-ui-caption text-foreground-subtlest"
                    title={selected.workspaceIdentity ?? selected.workspacePath}
                  >
                    {selected.workspaceIdentity ?? selected.workspacePath}
                  </p>
                ) : null}
              </div>
              <Button variant="ghost" size="icon" aria-label={t("close")} onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
              <Button
                variant="ghost"
                disabled={
                  busy ||
                  !selected.online ||
                  (!selected.archived &&
                    (selected.status === "running" || selected.status === "waiting"))
                }
                onClick={() => void run(selected, "archive")}
              >
                <Archive className="size-4" />
                {selected.archived ? t("restore") : t("archive")}
              </Button>
              <Button
                variant="ghost"
                disabled={!selected.online}
                onClick={() => onOpenSession(selected)}
              >
                <ArrowUpRight className="size-4" />
                {t("openSession")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<p className="p-4">{t("loading")}</p>}>
                <Conversation
                  key={selected.key}
                  item={selected}
                  options={options}
                  onClose={onClose}
                />
              </Suspense>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
