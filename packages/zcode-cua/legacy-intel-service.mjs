import { ComputerUseService } from "./vendor/open-zcode-computer-use/src/computer-use-service.mjs";
import { HostClient, runNativeUtility } from "./vendor/open-zcode-computer-use/src/host-client.mjs";
import { toolError } from "./vendor/open-zcode-computer-use/src/results.mjs";

// Intel 官方 addon 尚未取得：平台适配仅在启动时选择，动作失败后绝不跨执行器重试。
export function createLegacyIntelService({
  executable,
  assertActive = () => {},
  createLegacy,
} = {}) {
  const host = new HostClient({ executable, allowGlobalPointer: false, requestTimeoutMs: 40_000 });
  const legacy =
    createLegacy?.(host) ??
    new ComputerUseService({
      host,
      assertActive,
      nativeUtility: (command, args, options) => {
        assertActive();
        return runNativeUtility(command, args, { ...options, executable });
      },
    });
  return {
    host,
    service: {
      get stopped() {
        return legacy.stopped;
      },
      start: () => legacy.start(),
      close: () => legacy.close(),
      async callTool(name, supplied) {
        const args = { ...supplied };
        if (name === "paste")
          return toolError(
            "Native clipboard-preserving paste is unavailable on Intel Mac; use type or set_value.",
            { code: "action_unavailable", action_sent: false, request_delivery_state: "not_sent" },
          );
        if (name === "left_click") {
          const button = args.mouse_button ?? "left",
            count = args.click_count ?? 1;
          name =
            button === "left"
              ? { 1: "left_click", 2: "double_click", 3: "triple_click" }[count]
              : count === 1
                ? { right: "right_click", middle: "middle_click" }[button]
                : undefined;
          if (!name)
            return toolError("This click combination is unavailable on Intel Mac.", {
              code: "action_unavailable",
              action_sent: false,
              request_delivery_state: "not_sent",
            });
          delete args.mouse_button;
          delete args.click_count;
        }
        if (name === "key" && args.hold_seconds !== undefined) {
          name = "hold_key";
          args.duration = args.hold_seconds;
          delete args.hold_seconds;
          delete args.repeat;
        }
        return legacy.callTool(name, args);
      },
    },
  };
}
