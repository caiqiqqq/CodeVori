import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import {
  acpGeminiProvidersSchema,
  type AcpGeminiProviders,
  type AcpGeminiProvidersUpdate,
} from "@zcode/shared";

/** Target-Host projection only. Provider credentials and accepted mutations belong to the Host. */
export function useAcpGeminiProviders(service: IAcpService | null) {
  const [view, setView] = useState<AcpGeminiProviders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(service));
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const alive = useRef(false);
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const reload = useCallback(async () => {
    if (!service) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = acpGeminiProvidersSchema.parse(await service.listGeminiProviders());
      if (alive.current && generation.current === current && serviceRef.current === service) {
        setView(next);
        setError(null);
      }
    } catch {
      if (alive.current && generation.current === current && serviceRef.current === service) {
        setView(null);
        setError("loadFailed");
      }
    } finally {
      if (alive.current && generation.current === current && serviceRef.current === service)
        setLoading(false);
    }
  }, [service]);
  useEffect(() => {
    alive.current = true;
    setView(null);
    setError(null);
    setSaving(false);
    if (service) void reload();
    else setLoading(false);
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [service, reload]);
  const update = useCallback(
    async (input: AcpGeminiProvidersUpdate): Promise<boolean> => {
      if (!service) return false;
      const current = ++generation.current;
      setSaving(true);
      setError(null);
      try {
        const next = acpGeminiProvidersSchema.parse(await service.updateGeminiProviders(input));
        if (!alive.current || generation.current !== current || serviceRef.current !== service)
          return false;
        setView(next);
        return true;
      } catch {
        // 修复原因：冲突后重读目录但保留未提交表单；卸载或换 Host 的旧回执不得进入新页面。
        if (alive.current && generation.current === current && serviceRef.current === service) {
          try {
            const next = acpGeminiProvidersSchema.parse(await service.listGeminiProviders());
            if (alive.current && generation.current === current && serviceRef.current === service)
              setView(next);
          } catch {
            if (alive.current && generation.current === current && serviceRef.current === service)
              setView(null);
          }
          if (alive.current && generation.current === current && serviceRef.current === service)
            setError("saveFailed");
        }
        return false;
      } finally {
        if (alive.current && generation.current === current && serviceRef.current === service)
          setSaving(false);
      }
    },
    [service],
  );
  return { view, loading, saving, error, reload, update };
}
