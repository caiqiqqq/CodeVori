import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ForgeComment,
  ForgeChangedFile,
  ForgeItemDetail,
  ForgeItemExtras,
  ForgeItemRequest,
  ForgeUpdateIssueRequest,
  ForgeMergeMethod,
  ForgePage,
} from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import { useForgeMutation } from "./useForgeMutation.js";
import { forgeErrorId } from "@/lib/forgePanel.js";

interface DetailState {
  owner: object;
  item: ForgeItemDetail | null;
  loading: boolean;
  error: string | null;
  comments: ForgePage<ForgeComment> | null;
  commentsError: string | null;
  files: ForgePage<ForgeChangedFile> | null;
  filesError: string | null;
  extras: ForgeItemExtras | null;
  extrasError: string | null;
}
const initial = (owner: object): DetailState => ({
  owner,
  item: null,
  loading: true,
  error: null,
  comments: null,
  commentsError: null,
  files: null,
  filesError: null,
  extras: null,
  extrasError: null,
});

export function useRepositoryItem(
  request: ForgeItemRequest,
  gitService: IGitService,
  withExtras = false,
  externalRevision = "",
) {
  const owner = useMemo(() => ({}), [gitService, request]);
  const [state, setState] = useState<DetailState>(() => initial(owner));
  const [revision, setRevision] = useState(0);
  const mutation = useForgeMutation(owner);
  useEffect(() => {
    let alive = true;
    setState(initial(owner));
    const update = (patch: Partial<DetailState>) => {
      if (alive)
        setState((current) => (current.owner === owner ? { ...current, ...patch } : current));
    };
    void gitService.getForgeItem(request).then(
      (item) => update({ item, loading: false }),
      (error: unknown) => update({ loading: false, error: forgeErrorId(error) }),
    );
    void gitService.listForgeComments({ ...request, page: 1, pageSize: 30 }).then(
      (comments) => update({ comments }),
      (error: unknown) => update({ commentsError: forgeErrorId(error) }),
    );
    if (withExtras)
      void gitService.getForgeItemExtras(request).then(
        (extras) => update({ extras }),
        (error: unknown) => update({ extrasError: forgeErrorId(error) }),
      );
    if (request.kind === "pull-request")
      void gitService.listForgeFiles({ ...request, page: 1, pageSize: 30 }).then(
        (files) => update({ files }),
        (error: unknown) => update({ filesError: forgeErrorId(error) }),
      );
    return () => {
      alive = false;
    };
  }, [gitService, owner, request, revision, withExtras, externalRevision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const loadMore = async (section: "comments" | "files") => {
    const snapshot = state[section];
    if (state.owner !== owner || !snapshot?.hasMore) return;
    if (section === "comments") {
      const result = await mutation.run(() =>
        gitService.listForgeComments({ ...request, page: snapshot.page + 1, pageSize: 30 }),
      );
      if (!result) return;
      setState((current) => {
        if (current.owner !== owner || current.comments?.page !== snapshot.page) return current;
        return {
          ...current,
          comments: { ...result.value, items: [...current.comments.items, ...result.value.items] },
        };
      });
    } else {
      const result = await mutation.run(() =>
        gitService.listForgeFiles({ ...request, page: snapshot.page + 1, pageSize: 30 }),
      );
      if (!result) return;
      setState((current) => {
        if (current.owner !== owner || current.files?.page !== snapshot.page) return current;
        return {
          ...current,
          files: { ...result.value, items: [...current.files.items, ...result.value.items] },
        };
      });
    }
  };
  const createComment = async (body: string) => {
    const result = await mutation.run(() => gitService.createForgeComment({ ...request, body }));
    if (result) refresh();
    return Boolean(result);
  };
  const setItemState = async (nextState: "open" | "closed") => {
    const result = await mutation.run(() =>
      gitService.setForgeItemState({ ...request, state: nextState }),
    );
    if (result) refresh();
    return Boolean(result);
  };
  const updateIssue = async (
    draft: Omit<ForgeUpdateIssueRequest, keyof ForgeItemRequest | "kind" | "number">,
  ) => {
    if (request.kind !== "issue") return false;
    const result = await mutation.run(() =>
      gitService.updateForgeIssue({ ...request, kind: "issue", ...draft }),
    );
    if (result) refresh();
    return Boolean(result);
  };
  const merge = async (headSha: string, method: ForgeMergeMethod) => {
    if (request.kind !== "pull-request") return false;
    const result = await mutation.run(() =>
      gitService.mergeForgePullRequest({ ...request, kind: "pull-request", headSha, method }),
    );
    if (result) refresh();
    return Boolean(result);
  };
  const current = state.owner === owner ? state : initial(owner);
  const item = useMemo(() => {
    if (!current.item || !current.extras) return current.item;
    const { labels, ...metadata } = current.extras;
    const colors = new Map(labels?.map((label) => [label.name, label]) ?? []);
    return {
      ...current.item,
      labels: current.item.labels.map((label) => colors.get(label.name) ?? label),
      metadata: current.item.metadata ? { ...current.item.metadata, ...metadata } : undefined,
    };
  }, [current.item, current.extras]);
  return {
    ...current,
    item,
    extrasLoading: withExtras && !current.extras && !current.extrasError,
    mutation,
    refresh,
    loadMore,
    createComment,
    setItemState,
    updateIssue,
    merge,
  };
}
