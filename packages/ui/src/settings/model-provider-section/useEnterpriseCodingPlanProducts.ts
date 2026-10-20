import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { EnterpriseCodingPlanPricingResponse, ProviderFamilyDomain } from "@zcode/shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { isRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";
import { logger } from "@/logger.js";
import {
  resolveEnterpriseCodingPlanProductList,
  type EnterpriseCodingPlanProductDisplay,
} from "@/settings/model-provider-section/enterpriseCodingPlanProducts.js";
import { normalizeCodingPlanReadError } from "@/settings/model-provider-section/codingPlanReadError.js";

interface EnterpriseCodingPlanProductsSnapshot {
  productList: EnterpriseCodingPlanProductDisplay[];
  raw: EnterpriseCodingPlanPricingResponse;
  authenticated: boolean;
  family: ProviderFamilyDomain;
}

interface EnterpriseCodingPlanProductsState {
  service: ICodingPlanSubscriptionService | undefined;
  requestKey: string | null;
  snapshot: EnterpriseCodingPlanProductsSnapshot | null;
  loading: boolean;
  error: string | null;
}

export function useEnterpriseCodingPlanProducts({
  enabled,
  authenticated,
  family = "bigmodel",
  accountKey,
}: {
  enabled: boolean;
  authenticated: boolean;
  family?: ProviderFamilyDomain;
  accountKey: string;
}) {
  const service = useOptionalServices()?.codingPlanSubscriptionService;
  const requestVersion = useRef(0);
  const requestKey = JSON.stringify([family, authenticated, accountKey]);
  const [state, setState] = useState<EnterpriseCodingPlanProductsState>({
    service: undefined,
    requestKey: null,
    snapshot: null,
    loading: enabled,
    error: null,
  });

  const refresh = useCallback(
    async (_options?: { force?: boolean }) => {
      // 登录态或 family 切换后，旧请求返回不能覆盖当前供应商的权益事实。
      const version = ++requestVersion.current;
      if (!enabled) {
        setState({ service, requestKey, snapshot: null, loading: false, error: null });
        return;
      }
      if (!service) {
        setState({
          service,
          requestKey,
          snapshot: null,
          loading: false,
          error: "service_unavailable",
        });
        return;
      }

      setState((current) => ({
        // 仅同一账号快照的供应商事实可以在刷新期间继续展示。
        service,
        requestKey,
        snapshot:
          current.service === service && current.requestKey === requestKey
            ? current.snapshot
            : null,
        loading: true,
        error: null,
      }));
      try {
        const raw = await service.getEnterprisePricing({ family });
        if (version !== requestVersion.current) return;
        setState({
          service,
          requestKey,
          snapshot: {
            raw,
            productList: resolveEnterpriseCodingPlanProductList(raw.productList).map((product) => ({
              ...product,
              family,
            })),
            authenticated,
            family,
          },
          loading: false,
          error: null,
        });
      } catch (error) {
        if (version !== requestVersion.current) return;
        const message = normalizeCodingPlanReadError(error);
        if (!isRemoteWorkspaceDisconnectedError(error)) {
          logger.warn("[useEnterpriseCodingPlanProducts] 读取团队权益失败", {
            authenticated,
            error: message,
          });
        }
        setState((current) => ({
          service,
          requestKey,
          snapshot:
            current.service === service && current.requestKey === requestKey
              ? current.snapshot
              : null,
          loading: false,
          error: message,
        }));
      }
    },
    [authenticated, enabled, family, requestKey, service],
  );

  useEffect(() => {
    void refresh();
    return () => {
      // 卸载或账号换代后的旧请求不能再提交当前结果。
      requestVersion.current += 1;
    };
  }, [refresh]);

  return useMemo(() => {
    const visible =
      enabled && state.service === service && state.requestKey === requestKey
        ? state
        : { snapshot: null, loading: enabled, error: null };
    return {
      snapshot: visible.snapshot,
      loading: visible.loading,
      error: visible.error,
      refresh,
    };
  }, [enabled, refresh, requestKey, service, state]);
}
