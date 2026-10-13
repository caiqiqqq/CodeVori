import { useEffect, useRef, useState } from "react";
import { isAbsoluteFilePath, type LinkedRepository } from "@zcode/shared";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/index.js";
import {
  LinkedRepositoryError,
  prepareLinkedRepositories,
  repositoryIdentity,
} from "@/lib/linkedRepositoryPreparation.js";
import { resolveWorktreeRootPath } from "@/lib/worktree.js";
import {
  persistV4ComposerDraft,
  readV4ComposerDraft,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

export function useLinkedRepositories(options: {
  workspacePath: string;
  workspaceIdentity?: string;
  scopeId: string;
  draft: V4ComposerDraft;
  onChange: (draft: V4ComposerDraft) => void;
}) {
  const { intl } = useZCodeIntl();
  const services = useWorkspaceServices(
    options.workspacePath,
    undefined,
    options.workspaceIdentity,
    undefined,
    true,
  );
  const platform = useOptionalPlatform();
  const tabs = useTabStore((state) => state.tabs);
  const scopeKey = JSON.stringify([
    options.workspaceIdentity?.trim() || options.workspacePath,
    options.scopeId,
  ]);
  const latest = useRef(options);
  latest.current = options;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isActive = () => mounted.current && currentScope.current === scopeKey;
  const flight = useRef<string | null>(null);
  const [status, setStatus] = useState<{ scope: string; busy: boolean; error: string | null }>({
    scope: scopeKey,
    busy: false,
    error: null,
  });
  const [branchLists, setBranchLists] = useState<Record<string, string[]>>({});
  const [currentBranches, setCurrentBranches] = useState<Record<string, string>>({});
  const rows = options.draft.linkedRepositories ?? [];
  const errorMessage = (error: unknown) =>
    error instanceof LinkedRepositoryError
      ? intl.formatMessage(
          { id: `chat.linkedProjects.error.${error.code}` },
          { name: error.repositoryName },
        )
      : intl.formatMessage({ id: "chat.linkedProjects.error.requestFailed" });
  const save = (repositories: LinkedRepository[]) => {
    // 分配结果归原会话。新 scope 只能读自己的配置，不能被旧 Git 完成回调覆盖。
    const draft = isActive()
      ? latest.current.draft
      : (readV4ComposerDraft(options.workspacePath, options.workspaceIdentity, options.scopeId) ??
        options.draft);
    const next = { ...draft, linkedRepositories: repositories, updatedAt: Date.now() };
    if (isActive()) {
      // 活跃 Composer 的唯一写入口仍是 draft owner；直接持久化只用于已离开的原 scope。
      options.onChange(next);
      const saved = readV4ComposerDraft(
        options.workspacePath,
        options.workspaceIdentity,
        options.scopeId,
      );
      if (JSON.stringify(saved?.linkedRepositories) !== JSON.stringify(repositories)) {
        throw new Error("Linked repository configuration could not be saved");
      }
    } else if (
      !persistV4ComposerDraft(
        options.workspacePath,
        options.workspaceIdentity,
        options.scopeId,
        next,
      )
    ) {
      throw new Error("Linked repository configuration could not be saved");
    }
  };
  const add = async (sourcePath: string) => {
    if (flight.current === scopeKey) return false;
    if (!isAbsoluteFilePath(sourcePath.trim())) {
      setStatus({
        scope: scopeKey,
        busy: false,
        error: intl.formatMessage({ id: "chat.linkedProjects.error.invalidPath" }),
      });
      return false;
    }
    flight.current = scopeKey;
    setStatus({ scope: scopeKey, busy: true, error: null });
    try {
      const [main, candidate, branches] = await Promise.all([
        services.gitService.getWorkspaceRepositoryInfo({ workspacePath: options.workspacePath }),
        services.gitService.getWorkspaceRepositoryInfo({ workspacePath: sourcePath.trim() }),
        services.gitService.getLocalBranches({ workspacePath: sourcePath.trim() }),
      ]);
      if (!isActive()) return false;
      if (!candidate.repoRoot || !branches.currentBranchName)
        throw new LinkedRepositoryError("notRepository", sourcePath);
      const identity = repositoryIdentity(candidate);
      const existing = await Promise.all(
        rows.map((row) =>
          services.gitService.getWorkspaceRepositoryInfo({ workspacePath: row.sourcePath }),
        ),
      );
      if (!isActive()) return false;
      if (
        identity === repositoryIdentity(main) ||
        existing.some((info) => repositoryIdentity(info) === identity)
      ) {
        setStatus({
          scope: scopeKey,
          busy: false,
          error: intl.formatMessage({ id: "chat.linkedProjects.error.duplicate" }),
        });
        return false;
      }
      if (rows.length >= 8) throw new Error("Linked repository limit reached");
      const path = candidate.repoRoot;
      setCurrentBranches((current) => ({ ...current, [path]: branches.currentBranchName! }));
      setBranchLists((current) => ({
        ...current,
        [path]: branches.branches.map((branch) => branch.name),
      }));
      save([
        ...rows,
        {
          name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
          sourcePath: path,
          baseBranch: branches.currentBranchName,
          useWorktree: candidate.kind !== "linked-worktree",
        },
      ]);
    } catch (error) {
      if (isActive()) setStatus({ scope: scopeKey, busy: false, error: errorMessage(error) });
      return false;
    } finally {
      if (flight.current === scopeKey) flight.current = null;
    }
    if (isActive()) setStatus({ scope: scopeKey, busy: false, error: null });
    return true;
  };
  const prepare = async (
    isSubmissionCurrent: () => boolean,
    text: string,
  ): Promise<LinkedRepository[]> => {
    if (text.trimStart().startsWith("/")) return rows;
    if (!rows.length) return [];
    if (options.workspaceIdentity?.trim()) throw new LinkedRepositoryError("stale", "");
    setStatus({ scope: scopeKey, busy: true, error: null });
    try {
      const [settings, system] = await Promise.all([
        services.settingService.get(),
        services.systemService.info(),
      ]);
      const root = resolveWorktreeRootPath({
        configuredRoot: settings.worktreeRootDirectory,
        homeDirectory: system.homedir,
        workspacePath: options.workspacePath,
      });
      if (!root) throw new Error("Invalid worktree root");
      return await prepareLinkedRepositories({
        repositories: rows,
        gitService: services.gitService,
        worktreeRootPath: root,
        onPrepared: save,
        isCurrent: () => isActive() && isSubmissionCurrent(),
      });
    } catch (error) {
      if (isActive()) setStatus({ scope: scopeKey, busy: false, error: errorMessage(error) });
      throw error;
    } finally {
      if (isActive()) setStatus((current) => ({ ...current, busy: false }));
    }
  };
  return {
    repositories: rows,
    busy: status.scope === scopeKey && status.busy,
    error: status.scope === scopeKey ? status.error : null,
    branches: branchLists,
    currentBranches,
    availableProjects: tabs
      .filter(isWorkspaceTab)
      .filter(
        (tab) =>
          !tab.workspaceIdentity?.trim() &&
          !tab.remoteSessionId &&
          (tab.workspacePurpose ?? "project") === "project" &&
          tab.workspacePath !== options.workspacePath,
      )
      .map((tab) => ({ path: tab.workspacePath, name: tab.label ?? tab.workspacePath })),
    add,
    browse: platform
      ? async () => {
          try {
            const path = await platform.selectDirectory();
            if (path && isActive()) await add(path);
          } catch (error) {
            if (isActive()) setStatus({ scope: scopeKey, busy: false, error: errorMessage(error) });
          }
        }
      : undefined,
    change: (repositories: LinkedRepository[]) => {
      if (!isActive() || (status.busy && status.scope === scopeKey)) return;
      try {
        save(repositories);
        setStatus({ scope: scopeKey, busy: false, error: null });
      } catch (error) {
        if (isActive()) setStatus({ scope: scopeKey, busy: false, error: errorMessage(error) });
      }
    },
    loadBranches: async (path: string) => {
      try {
        const result = await services.gitService.getLocalBranches({ workspacePath: path });
        if (isActive()) {
          if (result.currentBranchName)
            setCurrentBranches((current) => ({ ...current, [path]: result.currentBranchName! }));
          setBranchLists((current) => ({
            ...current,
            [path]: result.branches.map((branch) => branch.name),
          }));
        }
      } catch (error) {
        if (currentScope.current === scopeKey)
          setStatus({ scope: scopeKey, busy: false, error: errorMessage(error) });
      }
    },
    prepare,
  };
}
