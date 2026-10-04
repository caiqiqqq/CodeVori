import { useCallback, useState } from "react";
import { FolderGit2, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useManagedWorktrees } from "@/hooks/useManagedWorktrees.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  requestWorktreeSettingsConversation,
  type WorktreeSettingsConversationTarget,
} from "@/lib/worktreeSettingsNavigation.js";
import { logger } from "@/logger.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import type { CreateTaskRequest } from "@/app-shell/types.js";

export function ManagedWorktreesList({
  root,
  onCreateTask,
}: {
  root: string | null;
  onCreateTask?: (request?: CreateTaskRequest) => void;
}) {
  const { intl } = useZCodeIntl();
  const services = useBaseWorkspaceServices();
  const tabStore = useTabStoreApi();
  const confirm = useConfirmDialog();
  const { projects, conversations, failedPaths, loading, error, refresh } =
    useManagedWorktrees(root);
  const [deleting, setDeleting] = useState<string | null>(null);
  const t = (id: string) => intl.formatMessage({ id });

  const navigate = useCallback(
    (target: WorktreeSettingsConversationTarget) => {
      const workspacePath =
        target.kind === "api" ? target.workspacePath : target.session.workspacePath;
      // addTab 只复用本地 tab；同路径的远程连接不能接管 Git 本机工作树对话。
      tabStore.getState().addTab(workspacePath);
      requestWorktreeSettingsConversation(target);
    },
    [tabStore],
  );

  const remove = useCallback(
    async (projectPath: string, worktreePath: string) => {
      if (!root || deleting) return;
      if (
        !(await confirm({
          title: t("settings.worktrees.deleteTitle"),
          description: intl.formatMessage(
            { id: "settings.worktrees.deleteDescription" },
            { path: worktreePath },
          ),
          confirmLabel: t("settings.worktrees.delete"),
          confirmVariant: "destructive",
        }))
      )
        return;
      setDeleting(worktreePath);
      try {
        const result = await services.gitService.removeManagedWorktree({
          worktreeRootPath: root,
          worktreePath,
          projectPath,
        });
        if (!result.ok) {
          toast(t(`settings.worktrees.remove.${result.issue}`));
          return;
        }
        // Git 已成功注销后才回收对应本地 tab；所有会话历史仍由原 Host 保留。
        for (const tab of tabStore.getState().tabs) {
          if (
            isWorkspaceTab(tab) &&
            tab.workspacePath === worktreePath &&
            !tab.workspaceIdentity &&
            !tab.remoteSessionId &&
            !tab.remoteTarget
          )
            tabStore.getState().closeTab(tab.id);
        }
        refresh();
      } catch (cause) {
        logger.warn("[ManagedWorktreesList] 删除工作树失败", { worktreePath, cause });
        toast(t("settings.worktrees.remove.command-failed"));
      } finally {
        setDeleting(null);
      }
    },
    [confirm, deleting, intl, refresh, root, services.gitService, tabStore],
  );

  return (
    <section className="space-y-3" data-testid="managed-worktrees">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-ui-lg font-semibold text-foreground">
          {t("settings.worktrees.managed")}
        </h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("settings.worktrees.refresh")}
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {!root ? (
        <p className="text-ui-sm text-foreground-subtle">
          {t("settings.worktrees.rootUnavailable")}
        </p>
      ) : null}
      {loading ? <p className="text-ui-sm text-foreground-subtle">{t("common.loading")}</p> : null}
      {error ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {t("settings.worktrees.loadFailed")}
        </p>
      ) : null}
      {!loading && !error && root && projects.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">{t("settings.worktrees.empty")}</p>
      ) : null}
      {projects.map((project) => (
        <div
          key={project.projectPath}
          className="min-w-0 space-y-2"
          data-testid="managed-worktree-project"
        >
          <div
            className="flex min-w-0 items-center gap-2 text-ui-sm font-medium text-foreground"
            title={project.projectPath}
          >
            <FolderGit2 className="size-4 shrink-0" />
            <span className="truncate">{project.projectPath}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {project.worktrees.map((worktree, index) => (
              <div
                key={worktree.worktreePath}
                className={index > 0 ? "border-t border-border" : ""}
                data-testid="managed-worktree"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ui-base font-medium text-foreground">
                      {worktree.branchName || getPathLeaf(worktree.worktreePath)}
                    </div>
                    <div
                      className="break-all font-mono text-ui-xs text-foreground-subtle"
                      title={worktree.worktreePath}
                    >
                      {worktree.worktreePath}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        tabStore.getState().addTab(worktree.worktreePath);
                        onCreateTask?.({
                          targetWorkspace: { workspacePath: worktree.worktreePath },
                        });
                      }}
                    >
                      {t("settings.worktrees.newConversation")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={Boolean(deleting)}
                      onClick={() => void remove(project.projectPath, worktree.worktreePath)}
                      aria-label={t("settings.worktrees.delete")}
                    >
                      <Trash2 className="size-3.5" />
                      {t("settings.worktrees.delete")}
                    </Button>
                  </div>
                </div>
                <div className="border-t border-border/50 px-4 py-2">
                  <div className="mb-1 text-ui-xs text-foreground-subtle">
                    {t("settings.worktrees.conversations")}
                  </div>
                  {failedPaths.has(worktree.worktreePath) ? (
                    <p className="text-ui-xs text-destructive" role="alert">
                      {t("settings.worktrees.conversationsFailed")}
                    </p>
                  ) : null}
                  {conversations[worktree.worktreePath]?.length === 0 ? (
                    <p className="text-ui-sm text-foreground-subtle">
                      {t("settings.worktrees.noConversations")}
                    </p>
                  ) : null}
                  {(conversations[worktree.worktreePath] ?? []).map((conversation) => (
                    <button
                      key={`${conversation.kind}:${conversation.id}`}
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui-sm text-foreground hover:bg-surface-hover"
                      onClick={() =>
                        navigate(
                          conversation.kind === "api"
                            ? {
                                kind: "api",
                                workspacePath: worktree.worktreePath,
                                taskId: conversation.id,
                              }
                            : { kind: "acp", session: conversation.session },
                        )
                      }
                    >
                      <MessageSquare className="size-3.5 shrink-0 text-foreground-subtle" />
                      <span className="min-w-0 truncate">
                        {conversation.title || t("settings.worktrees.untitled")}
                      </span>
                      <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtle">
                        {conversation.kind === "acp"
                          ? conversation.session.agent.toUpperCase()
                          : "API"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
