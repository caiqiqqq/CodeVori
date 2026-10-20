import type { IntlInstance } from "@/i18n/IntlProvider.js";

export function delegationErrorMessage(error: unknown, intl: IntlInstance) {
  const message = error instanceof Error ? error.message : String(error);
  // 委派复用待办执行器，其稳定错误码必须沿用既有翻译，不能直接当提示文案。
  const key = message.includes("delegation.nesting-capacity")
    ? "delegation.nesting-capacity"
    : message.startsWith("work-task.")
      ? `workTasks.error.${message}`
      : message;
  const translated =
    key.startsWith("delegation.") || key.startsWith("workTasks.error.")
      ? intl.formatMessage({ id: key })
      : key;
  return translated === key ? message : translated;
}
