// ============================================================
// Dynamic Workflow：Host 本地策略与客户端快照
// ============================================================
// 默认开启，合法环境变量覆盖；上游 client/configs 不参与工作流能力裁决。

// 这里只放三端（Host services、Desktop main、UI）共用的取值域、归一化与快照形状；
// 环境读取与下发由 Host 负责，shared 只做纯解析。

export const DYNAMIC_WORKFLOW_MODES = ["disabled", "onDemand", "alwaysOn"] as const;
export type DynamicWorkflowMode = (typeof DYNAMIC_WORKFLOW_MODES)[number];

/** 所有 Host 的本地策略覆盖；Desktop 各构建档位保留合法值，调整后重启 Host。 */
export const ZCODE_DYNAMIC_WORKFLOW_MODE_ENV = "ZCODE_DYNAMIC_WORKFLOW_MODE";

/** 修复原因：本地工作流不依赖上游灰度，离线或未登录也应显示管理入口。 */
export const DEFAULT_DYNAMIC_WORKFLOW_MODE: DynamicWorkflowMode = "alwaysOn";

export function normalizeDynamicWorkflowMode(value: unknown): DynamicWorkflowMode | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return (DYNAMIC_WORKFLOW_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as DynamicWorkflowMode)
    : undefined;
}

/**
 * 保留现有契约的三态，消费侧统一转换为布尔开关。
 * 将来 onDemand 有独立行为时，只需调整消费侧。
 */
export function isDynamicWorkflowModeEnabled(mode: DynamicWorkflowMode): boolean {
  return mode !== "disabled";
}

/** 快照来源；remote 仅兼容历史快照，新策略只产生 override/default。 */
export type DynamicWorkflowClientConfigSource = "remote" | "override" | "default";

export interface DynamicWorkflowClientConfig {
  readonly mode: DynamicWorkflowMode;
  /** 等于 isDynamicWorkflowModeEnabled(mode)；单独落字段免得每个消费者各写一遍折叠规则。 */
  readonly enabled: boolean;
  readonly source: DynamicWorkflowClientConfigSource;
}

export function createDynamicWorkflowClientConfig(
  mode: DynamicWorkflowMode,
  source: DynamicWorkflowClientConfigSource,
): DynamicWorkflowClientConfig {
  return { mode, enabled: isDynamicWorkflowModeEnabled(mode), source };
}

/** 本地覆盖 > 默认开启；不读取远端 feature key，也不依赖账号或网络。 */
export function resolveDynamicWorkflowClientConfig(input: {
  env?: Record<string, string | undefined>;
}): DynamicWorkflowClientConfig {
  const override = normalizeDynamicWorkflowMode(input.env?.[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV]);
  return override
    ? createDynamicWorkflowClientConfig(override, "override")
    : createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
}
