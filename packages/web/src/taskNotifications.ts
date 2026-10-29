import type { IPlatformService } from "@zcode/shared";

/** 浏览器权限和焦点策略沿用平台规则；点击通过同一接口回到原通知的观察者。 */
export function createWebTaskNotifications(options: {
  onlyWhenUnfocused(): boolean;
  playSound(): void;
}): Pick<IPlatformService, "showTaskNotification" | "onTaskNotificationClick"> {
  const listeners = new Set<(taskId: string) => void>();
  return {
    showTaskNotification(payload) {
      if (options.onlyWhenUnfocused() && document.hasFocus()) return;
      if (
        typeof window.Notification === "undefined" ||
        window.Notification.permission !== "granted"
      )
        return;
      try {
        const notification = new window.Notification(payload.title, {
          body: payload.body,
          silent: true,
        });
        // 原平台只有空的 click 订阅，新增议题提醒必须将稳定身份交回 UI 才能打开原链接。
        notification.onclick = () => {
          window.focus();
          for (const listener of listeners) listener(payload.taskId);
        };
        options.playSound();
      } catch {
        // 浏览器通知不可用时静默忽略，避免打断主流程。
      }
    },
    onTaskNotificationClick(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}
