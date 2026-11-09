import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AcpAgent } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
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
import { useWorktreeDraftSelection } from "@/hooks/useWorktreeDraftSelection.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab, type WorkspaceTabState } from "@/store/tabStore.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import {
  persistV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import {
  WorktreeDraftIntentContext,
  type WorktreeAutoSendRequest,
} from "@/v4/composer/worktreeDraftIntent.js";
import type { BoardProject } from "./agentBoardModel.js";
import { boardWorkspaceKey } from "./agentBoardModel.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";

type SessionTarget = { project: BoardProject; tab: WorkspaceTabState };

function ScopedSessionDraft({
  target,
  scope,
  options,
  onAccepted,
  onCreatingChange,
}: {
  target: SessionTarget;
  scope: Pick<WorkspaceTabState, "workspacePath" | "workspaceIdentity" | "remoteSessionId">;
  options?: BoardConversationOptions;
  onAccepted(kind: "native" | "acp", id: string, target: SessionTarget): void;
  onCreatingChange(creating: boolean): void;
}) {
  const { intl } = useZCodeIntl();
  const tabStore = useTabStoreApi();
  const draftFocusVersion = useZCodeSessionStore(
    (state) =>
      state.getWorkspaceState(scope.workspacePath, scope.workspaceIdentity).draftFocusVersion,
  );
  const worktree = useWorktreeDraftSelection({ ...scope, draftFocusVersion, sessionId: null });
  const [createdWorktree, setCreatedWorktree] = useState<{
    target: SessionTarget;
    autoSend: WorktreeAutoSendRequest | null;
  } | null>(null);
  const activeScope = createdWorktree
    ? { workspacePath: createdWorktree.target.tab.workspacePath }
    : scope;
  const git = usePaneGitStatus(activeScope, true);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => onCreatingChange(worktree.creating), [onCreatingChange, worktree.creating]);
  const openCreatedWorktree = useCallback(
    (
      path: string,
      draft: V4ComposerDraft,
      agent: AcpAgent | null,
      trigger: WorktreeAutoSendRequest["trigger"],
    ) => {
      // Git 已成功后取消来源意图；失败重试不能再创建第二棵工作树。
      worktree.select(false);
      if (!persistV4ComposerDraft(path, undefined, V4_DRAFT_SCOPE_ROOT, draft)) {
        throw new Error("worktree-draft-save-failed");
      }
      if (!mounted.current) throw new Error("stale-worktree-selection");
      const tabId = tabStore.getState().ensureWorkspaceTab(path, { workspacePurpose: "project" });
      const tab = tabStore.getState().tabs.find((item) => item.id === tabId);
      if (!tab || !isWorkspaceTab(tab)) throw new Error("worktree-workspace-open-failed");
      setCreatedWorktree({
        target: { project: target.project, tab },
        autoSend: {
          requestId: ++requestId.current,
          workspacePath: path,
          draftFocusVersion: useZCodeSessionStore.getState().getWorkspaceState(path)
            .draftFocusVersion,
          text: draft.text.trim(),
          agent,
          trigger,
        },
      });
    },
    [tabStore, target.project, worktree.select],
  );
  const consumeAutoSend = useCallback((id: number) => {
    setCreatedWorktree((current) =>
      current?.autoSend?.requestId === id ? { ...current, autoSend: null } : current,
    );
  }, []);
  const worktreeIntent = useMemo(
    () => ({
      selected: worktree.selected,
      select: worktree.select,
      createWorktree: worktree.createWorktree,
      autoSend: createdWorktree?.autoSend ?? null,
      openCreatedWorktree,
      consumeAutoSend,
    }),
    [
      worktree.selected,
      worktree.select,
      worktree.createWorktree,
      createdWorktree?.autoSend,
      openCreatedWorktree,
      consumeAutoSend,
    ],
  );
  const canCreateWorktree =
    !scope.workspaceIdentity &&
    !scope.remoteSessionId &&
    !target.tab.remoteTarget &&
    target.tab.workspacePurpose !== "conversation" &&
    git.gitSummary.isGitAvailable &&
    git.gitSummary.isRepository &&
    git.gitSummary.headRefType === "branch" &&
    Boolean(git.gitSummary.branchName);
  const composer = (
    <SessionPane
      {...options}
      paneId="agent-board-create-session"
      {...activeScope}
      sessionId={null}
      draftComposerOnly
      draftComposerDisabled={branchSwitching || worktree.creating}
      interactionNotificationsEnabled={false}
      allowWorktreeCreation={canCreateWorktree}
      openTrigger="sidebar"
      gitSummary={git.gitSummary}
      gitLoading={git.gitLoading}
      onRefreshGit={git.onRefreshGit}
      onSessionCreated={(id) => onAccepted("native", id, createdWorktree?.target ?? target)}
      onAcpFirstInputAccepted={(id) => onAccepted("acp", id, createdWorktree?.target ?? target)}
    />
  );
  return (
    <WorktreeDraftIntentContext.Provider value={worktreeIntent}>
      {!createdWorktree && git.gitSummary.isGitAvailable && git.gitSummary.isRepository ? (
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
            allowWorktreeCreation={canCreateWorktree}
            worktreeSelected={worktree.selected}
            worktreeSourceBranchName={worktree.sourceBranchName}
            worktreeCreating={worktree.creating}
            onWorktreeSelectedChange={canCreateWorktree ? worktree.select : undefined}
            onMutationPendingChange={setBranchSwitching}
          />
          <span>
            {intl.formatMessage({
              id: worktree.selected
                ? "git.branchSwitcher.worktreeSourceHelper"
                : "agentBoard.sessionBranchHint",
            })}
          </span>
        </div>
      ) : null}
      {!createdWorktree && canCreateWorktree ? (
        <label className="flex items-center gap-2 text-ui-base text-foreground">
          <Checkbox
            checked={worktree.selected}
            disabled={branchSwitching || worktree.creating}
            onCheckedChange={(checked) =>
              worktree.select(checked === true, git.gitSummary.branchName ?? undefined)
            }
            data-testid="agent-board-session-worktree"
          />
          {intl.formatMessage({ id: "agentBoard.sessionCreateWorktree" })}
        </label>
      ) : null}
      <div className="min-w-0" data-testid="agent-board-session-composer">
        {createdWorktree ? (
          <V4PaneConversationProvider scope={activeScope} key={activeScope.workspacePath}>
            {composer}
          </V4PaneConversationProvider>
        ) : (
          composer
        )}
      </div>
    </WorktreeDraftIntentContext.Provider>
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
  const [creatingWorktree, setCreatingWorktree] = useState(false);
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
        if (!open && !creatingWorktree) onClose();
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
          <Select
            value={target.project.key}
            onValueChange={setProjectKey}
            disabled={creatingWorktree}
          >
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
            onCreatingChange={setCreatingWorktree}
          />
        </V4PaneConversationProvider>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={creatingWorktree}>
            {t("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
