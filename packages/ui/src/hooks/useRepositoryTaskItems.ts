import { useEffect, useMemo, useState } from "react";
import type { IGitService } from "@zcode/services";
import type { ForgeItem, ForgeItemList, ForgeTargetRequest } from "@zcode/shared";

/** Reconcile lagging forge search rows against direct, authoritative item reads. */
export function useRepositoryTaskItems(
  data: ForgeItemList | null,
  target: ForgeTargetRequest | null,
  git: IGitService,
  closedItemsKey: string,
  state: "open" | "closed" | "all",
): ForgeItemList | null {
  const owner = useMemo(() => ({}), [data, target, git, closedItemsKey]);
  const [snapshot, setSnapshot] = useState<{ owner: object; items: Map<string, ForgeItem> }>({
    owner,
    items: new Map(),
  });
  useEffect(() => {
    if (!data || !target) return;
    const closed = new Set<string>(JSON.parse(closedItemsKey));
    const wanted = data.items.filter((item) => closed.has(`${item.kind}:${item.number}`));
    if (!wanted.length) return;
    let alive = true;
    void Promise.allSettled(
      wanted.map((item) => git.getForgeItem({ ...target, kind: item.kind, number: item.number })),
    ).then((results) => {
      if (!alive) return;
      const items = new Map<string, ForgeItem>();
      for (const result of results)
        if (result.status === "fulfilled")
          items.set(`${result.value.kind}:${result.value.number}`, result.value);
      setSnapshot({ owner, items });
    });
    return () => {
      alive = false;
    };
  }, [data, target, git, closedItemsKey, owner]);
  if (!data || snapshot.owner !== owner) return data;
  // 修复依据：搜索索引可能仍返回 open，必须按直接读取的远端事实过滤，不能由任务 done 猜测关闭。
  return {
    ...data,
    items: data.items
      .map((item) => snapshot.items.get(`${item.kind}:${item.number}`) ?? item)
      .filter(
        (item) =>
          state === "all" || (state === "closed" ? item.state !== "open" : item.state === "open"),
      ),
  };
}
