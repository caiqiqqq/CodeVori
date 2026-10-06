import type { CuaPermissionKind, Locale } from "@zcode/shared";

interface CuaPermissionPanelMessages {
  documentTitle: string;
  dragTitle: string;
  hintPrefix: string;
  permissionLabel: string;
  hintSuffix: string;
  completion: string;
  closeTitle: string;
}

const MESSAGES: Record<
  Locale,
  Omit<CuaPermissionPanelMessages, "permissionLabel"> & Record<CuaPermissionKind, string>
> = {
  "zh-CN": {
    documentTitle: "ZCode Computer Use 权限",
    dragTitle: "拖动我到上面的权限列表",
    hintPrefix: "把左边的图标拖进上方的",
    hintSuffix: "列表",
    completion: "请确认开关已开启；暂不授权可关闭此提示",
    closeTitle: "关闭权限引导",
    accessibility: "辅助功能",
    screen_recording: "屏幕录制",
  },
  "en-US": {
    documentTitle: "ZCode Computer Use Permissions",
    dragTitle: "Drag me to the permission list above",
    hintPrefix: "Drag the icon on the left into the ",
    hintSuffix: " list above",
    completion: "Confirm access is enabled, or close this prompt to cancel",
    closeTitle: "Close permission guide",
    accessibility: "Accessibility",
    screen_recording: "Screen Recording",
  },
};

export function resolveCuaPermissionPanelMessages(
  locale: Locale,
  permission: CuaPermissionKind,
): CuaPermissionPanelMessages {
  const messages = MESSAGES[locale];
  return {
    documentTitle: messages.documentTitle,
    dragTitle: messages.dragTitle,
    hintPrefix: messages.hintPrefix,
    permissionLabel: messages[permission],
    hintSuffix: messages.hintSuffix,
    completion: messages.completion,
    closeTitle: messages.closeTitle,
  };
}
