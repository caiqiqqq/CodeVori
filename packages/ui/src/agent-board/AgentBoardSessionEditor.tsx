import { useMemo, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { GitBranchSwitcher } from "@/GitBranchSwitcher.js";
import { usePaneGitStatus } from "@/hooks/usePaneGitStatus.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { BoardProject } from "./agentBoardModel.js";
import { boardWorkspaceKey } from "./agentBoardModel.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";

type SessionTarget = { project: BoardProject; tab: WorkspaceTabState };

function ScopedSessionDraft({
  target,
  scope,
  options,
  onAccepted,
}: {
  target: SessionTarget;
  scope: Pick<WorkspaceTabState, "workspacePath" | "workspaceIdentity" | "remoteSessionId">;
  options?: BoardConversationOptions;
  onAccepted(kind: "native" | "acp", id: string, target: SessionTarget): void;
}) {
  const { intl } = useZCodeIntl();
  const git = usePaneGitStatus(scope, true);
  const [branchSwitching, setBranchSwitching] = useState(false);
  return (
    <>
      {git.gitSummary.isGitAvailable && git.gitSummary.isRepository ? (
        <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
          <span>{intl.formatMessage({ id: "agentBoard.sessionBranch" })}</span>
          <GitBranchSwitcher
            workspacePath={scope.workspacePath}
            gitSummary={git.gitSummary}
            dirtyFileCount={git.gitDirtyFileCount}
            onRefreshGit={git.onRefreshGit}
            className="p-0"
            triggerClassName="w-full justify-start rounded-lg border border-border bg-input [&>span]:max-w-none [&>span]:flex-1"
            popoverSide="bottom"
            showFooterActions={false}
            onMutationPendingChange={setBranchSwitching}
          />
          <span>{intl.formatMessage({ id: "agentBoard.sessionBranchHint" })}</span>
        </div>
      ) : null}
      <div className="min-w-0" data-testid="agent-board-session-composer">
        <SessionPane
          {...options}
          paneId="agent-board-create-session"
          {...scope}
          sessionId={null}
          draftComposerOnly
          draftComposerDisabled={branchSwitching}
          interactionNotificationsEnabled={false}
          allowWorktreeCreation={false}
          openTrigger="sidebar"
          gitSummary={git.gitSummary}
          gitLoading={git.gitLoading}
          onRefreshGit={git.onRefreshGit}
          onSessionCreated={(id) => onAccepted("native", id, target)}
          onAcpFirstInputAccepted={(id) => onAccepted("acp", id, target)}
        />
      </div>
    </>
  );
}

export function AgentBoardSessionEditor({
  projects,
  initialProjectKey,
  canCreateSession,
  options,
  onClose,
  onAccepted,
}: {
  projects: BoardProject[];
  initialProjectKey: string | null;
  canCreateSession(tab: WorkspaceTabState): boolean;
  options?: BoardConversationOptions;
  onClose(): void;
  onAccepted(kind: "native" | "acp", id: string, target: SessionTarget): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const targets = useMemo(
    () =>
      projects
        .flatMap((project) => {
          const tab = project.tabs.find(canCreateSession);
          return tab ? [{ project, tab }] : [];
        })
        .sort(
          (left, right) =>
            Number(Boolean(left.tab.workspaceIdentity)) -
            Number(Boolean(right.tab.workspaceIdentity)),
        ),
    [projects, canCreateSession],
  );
  const [projectKey, setProjectKey] = useState(
    () =>
      targets.find((target) => target.project.key === initialProjectKey)?.project.key ??
      targets[0]?.project.key,
  );
  const target = targets.find((candidate) => candidate.project.key === projectKey) ?? targets[0];
  if (!target) return null;
  const scope = {
    workspacePath: target.tab.workspacePath,
    workspaceIdentity: target.tab.workspaceIdentity,
    remoteSessionId: target.tab.remoteSessionId,
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85dvh] max-w-xl overflow-y-auto"
        data-testid="agent-board-session-editor"
      >
        <DialogHeader>
          <DialogTitle>{t("newSession")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
          <span>{t("sessionProject")}</span>
          <Select value={target.project.key} onValueChange={setProjectKey}>
            <SelectTrigger
              aria-label={t("sessionProject")}
              className="w-full min-w-0"
              data-testid="agent-board-session-project"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map(({ project, tab }) => (
                <SelectItem key={project.key} value={project.key}>
                  <span title={tab.workspaceIdentity ?? tab.workspacePath}>{project.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target.tab.workspacePurpose !== "conversation" ? (
            <span className="break-all font-mono">{target.tab.workspacePath}</span>
          ) : null}
        </div>
        <V4PaneConversationProvider key={boardWorkspaceKey(target.tab)} scope={scope}>
          <ScopedSessionDraft
            target={target}
            scope={scope}
            options={options}
            onAccepted={onAccepted}
          />
        </V4PaneConversationProvider>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
