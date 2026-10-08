import { useEffect, useMemo, useState } from "react";
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
  const [revision, setRevision] = useState(0);
  const authentication = useForgeMutation(owner);
  const [state, setState] = useState<{ owner: object; url: string | null; error: string | null }>({
    owner,
    url: null,
    error: null,
  });
  useEffect(() => {
    if (!source || !active) return;
    let alive = true;
    let objectUrl: string | null = null;
    setState({ owner, url: null, error: null });
    void gitService
      .readForgeImage({ ...target, url: source })
      .then((value) => {
        if (!alive) return;
        const preview = forgeImagePreviewSchema.parse(value);
        const bytes = Uint8Array.from(atob(preview.dataBase64), (char) => char.charCodeAt(0));
        if (bytes.length !== preview.totalBytes) throw new Error("FORGE_RESPONSE");
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mediaType }));
        setState({ owner, url: objectUrl, error: null });
      })
      .catch((error) => {
        if (alive) setState({ owner, url: null, error: forgeErrorId(error) });
      });
    return () => {
      // 切换项目/账号后旧图片仍可能返回；丢弃响应并撤销临时 URL，避免串图和泄漏内存。
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [active, gitService, owner, revision, source, target]);
  return {
    ...(state.owner === owner ? state : { owner, url: null, error: null }),
    retry: () => setRevision((value) => value + 1),
    authentication,
    authenticate: async () => {
      if (!source || !active) return;
      const result = await authentication.run(() =>
        gitService.authenticateForgeImage({ ...target, url: source }),
      );
      if (result) setRevision((value) => value + 1);
    },
  };
}
