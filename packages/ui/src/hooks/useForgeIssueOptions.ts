import { useEffect, useState } from "react";
import type { IGitService } from "@zcode/services";
import type { ForgeIssueOptions, ForgeTargetRequest } from "@zcode/shared";
import { forgeErrorId } from "@/lib/forgePanel.js";

export function useForgeIssueOptions(
  gitService: IGitService,
  target: ForgeTargetRequest,
  active: boolean,
) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    target: ForgeTargetRequest;
    data: ForgeIssueOptions | null;
    loading: boolean;
    error: string | null;
  }>({ target, data: null, loading: true, error: null });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setSnapshot({ target, data: null, loading: true, error: null });
    void Promise.resolve()
      .then(() => gitService.getForgeIssueOptions(target))
      .then(
        (data) => {
          if (alive) setSnapshot({ target, data, loading: false, error: null });
        },
        (error: unknown) => {
          if (alive)
            setSnapshot({ target, data: null, loading: false, error: forgeErrorId(error) });
        },
      );
    // 切换账号、Host 或被设置页覆盖后，旧目录回复不能填入新仓库表单。
    return () => {
      alive = false;
    };
  }, [gitService, target, active, revision]);
  return {
    ...(snapshot.target === target ? snapshot : { data: null, loading: true, error: null }),
    retry: () => setRevision((value) => value + 1),
  };
}
