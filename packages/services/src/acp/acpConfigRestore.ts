import type { AcpConfigOption } from "@zcode/shared";
import { acpConfigValues } from "./acpConfigOptions.js";
import { isAcpPermissionOption } from "./acpPermissionPreferences.js";

export interface AcpConfigRestoreResult {
  configOptions: AcpConfigOption[];
  incomplete: boolean;
}

/** 新会话默认值只从实时 ACP 目录投影；历史会话继续恢复自己的选择。 */
export function defaultAcpModelSelection(
  catalog: AcpConfigOption[],
  model: string,
): AcpConfigOption[] {
  if (!model) return [];
  const option = catalog.find(
    (item) => item.type === "select" && (item.category === "model" || item.id === "model"),
  );
  if (option?.type !== "select" || !acpConfigValues(option).includes(model))
    throw new Error("默认模型不在当前 ACP 模型列表中，请在智能体设置中重新选择或清空默认模型。");
  return [{ ...option, currentValue: model }];
}

export function acpConfigOptionsRestored(
  saved: AcpConfigOption[],
  catalog: AcpConfigOption[],
  permissionConfigId: string | undefined,
): boolean {
  return saved.every((previous) => {
    if (previous.id === permissionConfigId || isAcpPermissionOption(previous)) return true;
    const current = catalog.find((option) => option.id === previous.id);
    return current?.type === previous.type && current.currentValue === previous.currentValue;
  });
}

/** 修复原因：session/load 会返回默认值；恢复 Host 已保存的选择，权限仍由专用路径处理。 */
export async function restoreAcpConfigOptions(
  saved: AcpConfigOption[],
  catalog: AcpConfigOption[],
  permissionConfigId: string | undefined,
  setConfigOption: (configId: string, value: string | boolean) => Promise<AcpConfigOption[]>,
  onFailure: (configId: string, error: unknown) => void,
): Promise<AcpConfigRestoreResult> {
  let configOptions = catalog;
  let incomplete = false;
  // 模型切换可能改变推理目录；先恢复模型，再按最新完整目录验证其余选项。
  const isModel = (option: AcpConfigOption) => option.category === "model" || option.id === "model";
  const ordered = [...saved.filter(isModel), ...saved.filter((option) => !isModel(option))];
  for (const previous of ordered) {
    if (previous.id === permissionConfigId || isAcpPermissionOption(previous)) continue;
    const available = configOptions.find((option) => option.id === previous.id);
    if (!available || available.type !== previous.type) {
      incomplete = true;
      onFailure(previous.id, new Error("ACP saved option is not available"));
      continue;
    }
    if (available.type === "boolean") {
      if (typeof previous.currentValue !== "boolean") {
        incomplete = true;
        onFailure(previous.id, new Error("ACP saved option value is not available"));
        continue;
      }
    } else if (
      typeof previous.currentValue !== "string" ||
      !acpConfigValues(available).includes(previous.currentValue)
    ) {
      incomplete = true;
      onFailure(previous.id, new Error("ACP saved option value is not available"));
      continue;
    }
    if (available.currentValue === previous.currentValue) continue;
    try {
      configOptions = await setConfigOption(previous.id, previous.currentValue);
      const applied = configOptions.find((option) => option.id === previous.id);
      if (applied?.currentValue !== previous.currentValue) {
        incomplete = true;
        onFailure(previous.id, new Error("ACP Agent did not apply the saved option"));
      }
    } catch (error) {
      incomplete = true;
      onFailure(previous.id, error);
    }
  }
  // 后续 setter 也可能重置前面的选择；以最后的 Agent 完整目录确认，而非伪造成功。
  if (!acpConfigOptionsRestored(saved, configOptions, permissionConfigId)) incomplete = true;
  return { configOptions, incomplete };
}
