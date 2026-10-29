import { useEffect, useMemo, useRef, useState } from "react";
import { forgeImagePreviewSchema, type ForgeTargetRequest } from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import { forgeErrorId } from "@/lib/forgePanel.js";
import { useForgeMutation } from "./useForgeMutation.js";

export function useRepositoryImage(
  target: ForgeTargetRequest,
  gitService: IGitService,
  source: string | null,
  active: boolean,
) {
  const owner = useMemo(() => ({}), [gitService, target, source]);
  const [attempt, setAttempt] = useState({ owner, revision: 0 });
  const revision = attempt.owner === owner ? attempt.revision : 0;
  const issued = useRef<{ owner: object; revision: number } | null>(null);
  const authentication = useForgeMutation(owner);
  const [state, setState] = useState<{
    owner: object;
    revision: number;
    url: string | null;
    error: string | null;
  }>({
    owner,
    revision,
    url: null,
    error: null,
  });
  useEffect(() => {
    if (!source || !active) return;
    let alive = true;
    let objectUrl: string | null = null;
    const refresh =
      revision > 0 && (issued.current?.owner !== owner || issued.current.revision !== revision);
    issued.current = { owner, revision };
    setState({ owner, revision, url: null, error: null });
    void gitService
      .readForgeImage({ ...target, url: source, ...(refresh ? { refresh: true } : {}) })
      .then((value) => {
        if (!alive) return;
        const preview = forgeImagePreviewSchema.parse(value);
        const bytes = Uint8Array.from(atob(preview.dataBase64), (char) => char.charCodeAt(0));
        if (bytes.length !== preview.totalBytes) throw new Error("FORGE_RESPONSE");
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mediaType }));
        setState({ owner, revision, url: objectUrl, error: null });
      })
      .catch((error) => {
        if (alive) setState({ owner, revision, url: null, error: forgeErrorId(error) });
      });
    return () => {
      // 切换项目/账号后旧图片仍可能返回；丢弃响应并撤销临时 URL，避免串图和泄漏内存。
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [active, gitService, owner, revision, source, target]);
  const retry = () =>
    setAttempt((previous) => ({
      owner,
      revision: previous.owner === owner ? previous.revision + 1 : 1,
    }));
  const current = state.owner === owner && state.revision === revision;
  return {
    ...(current ? state : { owner, url: null, error: null }),
    loading: Boolean(source && active && (!current || (!state.url && !state.error))),
    retry,
    authentication,
    authenticate: async () => {
      if (!source || !active) return;
      const result = await authentication.run(() =>
        gitService.authenticateForgeImage({ ...target, url: source }),
      );
      if (result) retry();
    },
  };
}
