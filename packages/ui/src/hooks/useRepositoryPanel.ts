import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ForgeItemKind,
  ForgeItemList,
  ForgeLabel,
  ForgeRepositoryInfo,
  ForgeSort,
  ForgeTargetRequest,
  ForgeIssueDraft,
} from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { forgeErrorId } from "@/lib/forgePanel.js";
import { useForgeMutation } from "./useForgeMutation.js";

export function useRepositoryPanel(
  scope: { workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string },
  filters: {
    remoteName?: string;
    kind: ForgeItemKind;
    state: "open" | "closed" | "all";
    search: string;
    sort: ForgeSort;
    labels: string[];
    page: number;
  },
  active = true,
) {
  const { services, rpcReady, isRemoteTarget } = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.remoteSessionId,
    scope.workspaceIdentity,
  );
  const { gitService } = services;
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  const owner = useMemo(() => ({}), [gitService, workspaceKey, filters.remoteName, rpcReady]);
  const [revision, setRevision] = useState(0);
  const [repository, setRepository] = useState<{
    owner: object;
    info: ForgeRepositoryInfo | null;
    loading: boolean;
    error: string | null;
  }>({ owner, info: null, loading: true, error: null });
  const discoveryGeneration = useRef(0);
  useEffect(() => {
    const generation = ++discoveryGeneration.current;
    // 设置是覆盖层，不会卸载仓库面板；返回时重读同一 Host 的账号，并丢弃覆盖前的旧结果。
    if (!active) return;
    // 同一仓库刷新时保留目标，防止评论提交后的列表刷新卸载正在查看的详情。
    setRepository((previous) => ({
      owner,
      info: previous.owner === owner ? previous.info : null,
      loading: true,
      error: null,
    }));
    if (!rpcReady) {
      setRepository({ owner, info: null, loading: false, error: "DISCONNECTED" });
      return;
    }
    void gitService
      .getForgeRepository({
        workspacePath: scope.workspacePath,
        workspaceIdentity: scope.workspaceIdentity,
        remoteName: filters.remoteName,
      })
      .then(
        (info) => {
          if (discoveryGeneration.current === generation)
            setRepository({ owner, info, loading: false, error: null });
        },
        (error: unknown) => {
          if (discoveryGeneration.current === generation)
            setRepository({ owner, info: null, loading: false, error: forgeErrorId(error) });
        },
      );
    return () => {
      discoveryGeneration.current += 1;
    };
  }, [
    active,
    gitService,
    owner,
    revision,
    rpcReady,
    scope.workspacePath,
    scope.workspaceIdentity,
    filters.remoteName,
  ]);
  const current =
    repository.owner === owner ? repository : { owner, info: null, loading: true, error: null };
  const repo = current.info?.repository;
  const target = useMemo<ForgeTargetRequest | null>(
    () =>
      repo
        ? {
            workspacePath: scope.workspacePath,
            workspaceIdentity: scope.workspaceIdentity,
            remoteName: current.info?.remoteName ?? undefined,
            repositoryKey: repo.key,
            accountId: repo.accountId,
          }
        : null,
    [
      repo?.key,
      repo?.accountId,
      current.info?.remoteName,
      scope.workspacePath,
      scope.workspaceIdentity,
    ],
  );
  const labelsKey = JSON.stringify(filters.labels);
  const listOwner = useMemo(
    () => ({}),
    [
      owner,
      target,
      filters.kind,
      filters.state,
      filters.search,
      filters.sort,
      labelsKey,
      filters.page,
      revision,
    ],
  );
  const [list, setList] = useState<{
    owner: object;
    data: ForgeItemList | null;
    loading: boolean;
    error: string | null;
  }>({ owner: listOwner, data: null, loading: false, error: null });
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setList({ owner: listOwner, data: null, loading: true, error: null });
    void gitService
      .listForgeItems({
        ...target,
        kind: filters.kind,
        state: filters.state,
        search: filters.search,
        sort: filters.sort,
        labels: JSON.parse(labelsKey) as string[],
        page: filters.page,
        pageSize: 20,
      })
      .then(
        (data) => {
          if (alive) setList({ owner: listOwner, data, loading: false, error: null });
        },
        (error: unknown) => {
          if (alive)
            setList({ owner: listOwner, data: null, loading: false, error: forgeErrorId(error) });
        },
      );
    return () => {
      alive = false;
    };
  }, [
    gitService,
    listOwner,
    target,
    filters.kind,
    filters.state,
    filters.search,
    filters.sort,
    labelsKey,
    filters.page,
  ]);
  const [labelSnapshot, setLabelSnapshot] = useState<{
    target: ForgeTargetRequest;
    items: ForgeLabel[];
  }>({ target: {} as ForgeTargetRequest, items: [] });
  useEffect(() => {
    if (!target) return;
    let alive = true;
    void gitService.listForgeLabels(target).then(
      (items) => {
        if (alive) setLabelSnapshot({ target, items });
      },
      () => {
        if (alive) setLabelSnapshot({ target, items: [] });
      },
    );
    return () => {
      alive = false;
    };
  }, [gitService, target, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const mutation = useForgeMutation(target);
  const createIssue = async (draft: ForgeIssueDraft) => {
    if (!target) return null;
    const result = await mutation.run(() => gitService.createForgeIssue({ ...draft, ...target }));
    if (!result) return null;
    refresh();
    return result.value;
  };
  return {
    gitService,
    target,
    repository: current.info,
    discoveryLoading: current.loading,
    error: current.error,
    refresh,
    isRemoteTarget,
    mutation,
    createIssue,
    labels: labelSnapshot.target === target ? labelSnapshot.items : [],
    list:
      target && list.owner === listOwner
        ? list
        : { data: null, loading: Boolean(target), error: null },
  };
}
