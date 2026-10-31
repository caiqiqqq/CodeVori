import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { lazy, Suspense, useMemo } from "react";
import { Archive, ArrowUpRight, X } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import {
  boardAgentLabel,
  boardStatusIndicator,
  type BoardItem,
  type BoardProject,
} from "./agentBoardModel.js";
import type { BoardAction } from "@/hooks/useAgentBoardData.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";
import { WorkspaceHeaderActionSection } from "@/WorkspaceHeaderSections/WorkspaceHeaderActionSection.js";
import { AgentBoardTools, type AgentBoardWorkspaceTools } from "./AgentBoardTools.js";
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
  workspaceTools,
  container,
  onClose,
  onOpenSession,
}: {
  selected: BoardItem | undefined;
  workTasks: ReturnType<typeof useWorkTasks>;
  projects: BoardProject[];
  busy: boolean;
  run(item: BoardItem, action: BoardAction): Promise<void>;
  options?: BoardConversationOptions;
  workspaceTools?: AgentBoardWorkspaceTools;
  container: HTMLElement | null;
  onClose(): void;
  onOpenSession(item: BoardItem): void;
}) {
  const { intl } = useZCodeIntl();
  const scope = useMemo(
    () => ({
      workspacePath: selected?.workspacePath ?? "",
      workspaceIdentity: selected?.workspaceIdentity,
      remoteSessionId: selected?.remoteSessionId,
    }),
    [selected?.workspacePath, selected?.workspaceIdentity, selected?.remoteSessionId],
  );
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  if (selected?.kind === "work-task")
    return (
      <Suspense fallback={null}>
        <WorkTaskDetails
          key={selected.key}
          item={selected}
          workTasks={workTasks}
          options={options}
          workspaceTools={workspaceTools}
          container={container}
          onClose={onClose}
          onOpenSession={onOpenSession}
        />
      </Suspense>
    );
  return (
    <Dialog
      modal={false}
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {selected ? (
        <AgentBoardTools
          key={selected.key}
          target={{
            ...scope,
            taskId: selected.key,
            nativeSessionId: selected.kind === "native" ? selected.task.taskId : null,
            sidePaneOwnerId:
              selected.kind === "native" ? selected.task.taskId : selected.session.id,
          }}
          tools={workspaceTools}
          container={container}
        >
          {(git) => (
            <>
              <div className="flex items-start gap-2 border-b border-border p-4">
                <div className="min-w-0 flex-1">
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
                <div
                  className="ml-auto flex shrink-0 items-center gap-1"
                  data-testid="agent-board-header-actions"
                >
                  <Button variant="ghost" size="icon" aria-label={t("close")} onClick={onClose}>
                    <X className="size-4" />
                  </Button>
                  {workspaceTools ? (
                    <div data-testid="agent-board-tools-toggle">
                      <WorkspaceHeaderActionSection
                        {...workspaceTools.header}
                        workspaceAbsPath={scope.workspacePath}
                        workspaceIdentity={scope.workspaceIdentity}
                      />
                    </div>
                  ) : null}
                </div>
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
                    git={git}
                    onClose={onClose}
                  />
                </Suspense>
              </div>
            </>
          )}
        </AgentBoardTools>
      ) : null}
    </Dialog>
  );
}
