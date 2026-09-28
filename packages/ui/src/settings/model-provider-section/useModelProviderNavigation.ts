/* eslint-disable max-lines -- Model Provider 导航需要集中计算分组、选中项与 Coding Plan 权益态，后续拆分时再收敛。 */
import { useEffect, useMemo } from "react";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import type {
  ProviderFamilyConnectionSelection,
  ProviderFamilyConnectionSelectionSettings,
  ProviderFamilyDomain,
} from "@zcode/shared";
import {
  isStartPlanModelProviderId,
  resolveModelProviderFamilySpecByProviderId,
  resolveProviderFamilyDomainFromOAuthProvider,
  type OAuthProviderId,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  CODING_PLAN_PROVIDER_SPECS,
  type CodingPlanEntitlementState,
  type ModelProviderNavGroup,
} from "@/settings/model-provider-section/constants.js";
import { pickCodingPlanEntitlementProvider } from "@/lib/codingPlanProvider.js";
import {
  createCodingPlanProviderNodeKey,
  createCustomProviderNodeKey,
} from "@/settings/model-provider-section/utils.js";
import { resolveVisibleModelProviderNodeKey } from "@/settings/model-provider-section/modelProviderSidebarSelection.js";
import {
  sortModelProvidersForDisplay,
  type ProviderOrderView,
} from "@/lib/modelProviderOrdering.js";
import type { EnterpriseCodingPlanProductDisplay } from "@/settings/model-provider-section/enterpriseCodingPlanProducts.js";
import {
  buildVisibleFamilyConnectionItems,
  resolveCodingPlanEntitlementState,
} from "@/settings/model-provider-section/providerFamilyConnectionVisibility.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  /**
   * 当前账号明确有权益的 Provider。缺省等价于尚无账号权益；生产设置页始终显式传入。
   */
  entitledAccountProviderIds?: ReadonlySet<string>;
  modelProvidersLoading?: boolean;
  displayOrder?: ProviderOrderView;
  codingPlanEntitlements?: Partial<Record<string, CodingPlanEntitlementState>>;
  providerFamilyDomain?: ProviderFamilyDomain | null;
  connectionSelections?: ProviderFamilyConnectionSelectionSettings;
  pendingConnectionSelections?: ProviderFamilyConnectionSelectionSettings;
  familyConnectionSettingsLoading?: boolean;
  familyConnectionSettingsFailed?: boolean;
  subscribedTeamProducts?: EnterpriseCodingPlanProductDisplay[];
  showPurchasedTeamPlanFallback?: boolean;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

export function useModelProviderNavigation({
  modelProviders,
  entitledAccountProviderIds = new Set(),
  modelProvidersLoading = false,
  displayOrder,
  codingPlanEntitlements = {},
  providerFamilyDomain = null,
  connectionSelections = {},
  pendingConnectionSelections = {},
  familyConnectionSettingsLoading = false,
  familyConnectionSettingsFailed = false,
  subscribedTeamProducts = [],
  showPurchasedTeamPlanFallback = false,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const customProviders = useMemo(() => {
    const allCustomProviders = modelProviders.filter(
      (provider) => provider.config.group === "standard-personal",
    );
    // 这里复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    return sortModelProvidersForDisplay(allCustomProviders, displayOrder);
  }, [displayOrder, modelProviders]);

  const codingPlanItems = useMemo(
    () =>
      CODING_PLAN_PROVIDER_SPECS.filter((spec) =>
        shouldShowCodingPlanForProviderFamilyDomain(spec.oauthProviderId, providerFamilyDomain),
      ).map((spec) => {
        const provider = modelProviders.find((item) => item.providerId === spec.id) ?? null;
        const accountEntitled = entitledAccountProviderIds.has(spec.id);
        const entitlementProvider = pickCodingPlanEntitlementProvider(provider);
        const entitlement = codingPlanEntitlements[spec.id];
        const state = resolveCodingPlanEntitlementState({
          providerId: spec.id,
          accountEntitled,
          accountAvailability: provider?.accountState?.availability,
          accountUnavailableReason: provider?.accountState?.unavailableReason,
          entitlement,
          modelProvidersLoading,
        });

        return {
          key: createCodingPlanProviderNodeKey(spec.id),
          type: "codingPlan" as const,
          presetId: spec.id,
          oauthProviderId: spec.oauthProviderId,
          label: isStartPlanModelProviderId(spec.id)
            ? "Start Plan"
            : `${spec.providerName} - ${intl.formatMessage({
                id: "settings.modelProvider.connectionMode.codingPlan",
              })}`,
          providerName: spec.providerName,
          provider: entitlementProvider,
          accountEntitled,
          status: state.status,
          statusLabelId: state.statusLabelId,
          ...(isStartPlanModelProviderId(spec.id) &&
          entitlement?.snapshot?.unavailableReason === "not_authenticated"
            ? {
                accountLoginRequired: true,
                statusLabelId: "settings.modelProvider.startPlan.status.loginExpired",
              }
            : {}),
          planLevel: state.planLevel,
          currentProductId: state.currentProductId,
          subscriptionBillingCycle: state.subscriptionBillingCycle,
          subscriptionRenewTime: state.subscriptionRenewTime,
          subscriptionExpireTime: state.subscriptionExpireTime,
          subscriptionDetails: state.subscriptionDetails,
          quotaLimits: state.quotaLimits,
          mcpQuotaLimit: state.mcpQuotaLimit ?? null,
          statusActive: entitlementProvider?.executable === true,
        };
      }),
    [
      entitledAccountProviderIds,
      codingPlanEntitlements,
      intl,
      modelProviders,
      modelProvidersLoading,
      providerFamilyDomain,
    ],
  );
  const connectionModeCodingPlanItems = useMemo(
    () =>
      buildVisibleFamilyConnectionItems({
        items: codingPlanItems.filter((item) => !isStartPlanModelProviderId(item.presetId)),
        codingPlanEntitlements,
        subscribedTeamProducts,
        showPurchasedTeamPlanFallback,
        connectionSelections: {
          ...connectionSelections,
          ...pendingConnectionSelections,
        },
        teamPlanSelections: Object.fromEntries(
          Object.entries({ ...connectionSelections, ...pendingConnectionSelections }).filter(
            ([, selection]) => selection?.kind === "team-coding-plan",
          ),
        ),
      }),
    [
      codingPlanEntitlements,
      showPurchasedTeamPlanFallback,
      codingPlanItems,
      connectionSelections,
      pendingConnectionSelections,
      subscribedTeamProducts,
    ],
  );

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(() => {
    return [
      {
        id: "custom",
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "custom" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ];
  }, [customProviders, intl]);

  const navigationItems = useMemo(() => {
    const visibleItems = navigationGroups.flatMap((group) => group.items);
    const visibleKeys = new Set(visibleItems.map((item) => item.key));
    return [
      ...visibleItems,
      ...connectionModeCodingPlanItems.filter((item) => !visibleKeys.has(item.key)),
    ];
  }, [connectionModeCodingPlanItems, navigationGroups]);

  const selectableNavigationItems = useMemo(
    () => navigationItems.filter((item) => item.type !== "codingPlanLoading"),
    [navigationItems],
  );
  const selectableSideNavigationItems = useMemo(
    () =>
      navigationGroups
        .flatMap((group) => group.items)
        .filter((item) => item.type !== "codingPlanLoading"),
    [navigationGroups],
  );

  const navigationItemByKey = useMemo(
    () => new Map(selectableNavigationItems.map((item) => [item.key, item])),
    [selectableNavigationItems],
  );
  const sideNavigationItemByKey = useMemo(
    () => new Map(selectableSideNavigationItems.map((item) => [item.key, item])),
    [selectableSideNavigationItems],
  );

  const visibleSelectedNodeKey = resolveVisibleModelProviderNodeKey(
    selectedNodeKey,
    selectableSideNavigationItems.map((item) => item.key),
  );
  const selectedNavItem = visibleSelectedNodeKey
    ? resolveSelectedProviderFamilyConnectionItem({
        selectedNodeKey: visibleSelectedNodeKey,
        navigationItemByKey,
        selectableNavigationItems,
        connectionSelections,
        pendingConnectionSelections,
        familyConnectionSettingsLoading,
        familyConnectionSettingsFailed,
        modelProvidersLoading,
      })
    : null;

  const requestedItem = visibleSelectedNodeKey
    ? sideNavigationItemByKey.get(visibleSelectedNodeKey)
    : undefined;
  const requestedFamily =
    requestedItem?.type === "preset"
      ? resolveModelProviderFamilySpecByProviderId(requestedItem.presetId)
      : null;
  const requestedSelection = requestedFamily ? connectionSelections[requestedFamily.id] : undefined;
  const navigationUnavailable =
    Boolean(requestedFamily) &&
    !modelProvidersLoading &&
    !familyConnectionSettingsLoading &&
    (familyConnectionSettingsFailed ||
      Boolean(
        requestedFamily &&
        requestedSelection &&
        requestedSelection.kind !== "start-plan" &&
        !selectableNavigationItems.some((item) =>
          connectionSelectionMatchesNavigationItem(requestedFamily.id, requestedSelection, item),
        ),
      ));

  useEffect(() => {
    if (selectedNodeKey !== visibleSelectedNodeKey) {
      setSelectedNodeKey(visibleSelectedNodeKey);
    }
  }, [selectedNodeKey, setSelectedNodeKey, visibleSelectedNodeKey]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
    visibleSelectedNodeKey,
    navigationUnavailable,
  };
}

function shouldShowCodingPlanForProviderFamilyDomain(
  oauthProviderId: OAuthProviderId,
  providerFamilyDomain: ProviderFamilyDomain | null,
): boolean {
  if (!providerFamilyDomain) {
    return true;
  }
  return resolveProviderFamilyDomainFromOAuthProvider(oauthProviderId) === providerFamilyDomain;
}

function resolveSelectedProviderFamilyConnectionItem({
  selectedNodeKey,
  navigationItemByKey,
  selectableNavigationItems,
  connectionSelections,
  pendingConnectionSelections,
  familyConnectionSettingsLoading,
  familyConnectionSettingsFailed,
  modelProvidersLoading,
}: {
  selectedNodeKey: string;
  navigationItemByKey: Map<
    string,
    Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>
  >;
  selectableNavigationItems: Array<
    Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>
  >;
  connectionSelections: ProviderFamilyConnectionSelectionSettings;
  pendingConnectionSelections: ProviderFamilyConnectionSelectionSettings;
  familyConnectionSettingsLoading?: boolean;
  familyConnectionSettingsFailed?: boolean;
  modelProvidersLoading?: boolean;
}): Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }> | null {
  const selectedItem = navigationItemByKey.get(selectedNodeKey) ?? null;
  if (!selectedItem) {
    return null;
  }
  if (selectedItem.type !== "preset") {
    return selectedItem;
  }
  const familySpec = resolveModelProviderFamilySpecByProviderId(selectedItem.presetId);
  if (!familySpec) {
    return selectedItem;
  }
  if (familyConnectionSettingsLoading) {
    // 从外部入口打开 Model Settings 时，settings 首次 hydrate 前不能按默认 oauth
    // 连接方式推导 Start Plan，否则右侧连接方式会先闪成 Start 再按已保存设置纠偏。
    return null;
  }
  const mergedSelections = { ...connectionSelections, ...pendingConnectionSelections };
  const resolvedItem =
    !familyConnectionSettingsFailed &&
    pickFamilyModeNavigationItem(selectableNavigationItems, familySpec.id, mergedSelections);
  if (resolvedItem) {
    return resolvedItem;
  }
  if (modelProvidersLoading) return null;
  // 非法/过期连接只影响当前设置页的落点，不能让 null 被详情页当作永久 loading。
  // 不写回 Family 偏好，不改会话 Selection；用户可在这个同 Family 页面重新选择。
  return pickInitialConnectionNavigationItem(
    selectableNavigationItems.filter(
      (item) =>
        "presetId" in item &&
        resolveModelProviderFamilySpecByProviderId(item.presetId)?.id === familySpec.id,
    ),
  );
}

function pickInitialConnectionNavigationItem(
  selectableNavigationItems: Array<
    Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>
  >,
): Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }> | null {
  const planItems = selectableNavigationItems.filter(isPlanConnectionNavigationItem);
  const personalCodingPlanItem = planItems.find(
    (item) =>
      item.type === "codingPlan" &&
      !isStartPlanModelProviderId(item.presetId) &&
      item.status === "purchased",
  );
  if (personalCodingPlanItem) {
    return personalCodingPlanItem;
  }
  const teamPlanItem = planItems.find((item) => item.type === "teamPlan");
  if (teamPlanItem) {
    return teamPlanItem;
  }
  const personalCodingPlanFallback = planItems.find(
    (item) => item.type === "codingPlan" && !isStartPlanModelProviderId(item.presetId),
  );
  if (personalCodingPlanFallback) {
    return personalCodingPlanFallback;
  }
  if (planItems[0]) {
    return planItems[0];
  }
  return selectableNavigationItems.find((item) => item.type === "preset") ?? null;
}

function pickFamilyModeNavigationItem(
  selectableNavigationItems: Array<
    Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>
  >,
  familyId: "zai" | "bigmodel",
  connectionSelections: ProviderFamilyConnectionSelectionSettings,
): Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }> | null {
  const selection = connectionSelections[familyId];
  if (!selection) return null;
  return (
    selectableNavigationItems.find((item) =>
      connectionSelectionMatchesNavigationItem(familyId, selection, item),
    ) ?? null
  );
}

export function connectionSelectionMatchesNavigationItem(
  family: ProviderFamilyDomain,
  selection: ProviderFamilyConnectionSelection,
  item: Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>,
): boolean {
  if (item.type === "custom") return false;
  const familySpec = resolveModelProviderFamilySpecByProviderId(item.presetId ?? "");
  if (familySpec?.id !== family) return false;
  if (selection.kind === "start-plan") {
    return false;
  }
  if (selection.kind === "individual-coding-plan") {
    return (
      item.type === "codingPlan" && item.presetId === familySpec.individualCodingPlanProviderId
    );
  }
  return (
    item.type === "teamPlan" &&
    item.presetId === familySpec.teamCodingPlanProviderId &&
    // 团队连接按平台、组织和项目定位；订阅商品会在权益快照和 pricing 校正间变化。
    // 不能把同项目的商品更新误判为连接丢失，否则初始化会出现空选项和错误提示。
    item.organizationId === selection.organizationId &&
    item.projectId === selection.projectId
  );
}

function isPlanConnectionNavigationItem(
  item: Exclude<ModelProviderNavGroup["items"][number], { type: "codingPlanLoading" }>,
): item is Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" | "teamPlan" }> {
  return (
    (item.type === "codingPlan" && !isStartPlanModelProviderId(item.presetId)) ||
    item.type === "teamPlan"
  );
}
