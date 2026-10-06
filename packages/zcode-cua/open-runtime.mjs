import { ComputerUseService } from "./vendor/open-zcode-computer-use/src/computer-use-service.mjs";
import { HostClient, runNativeUtility } from "./vendor/open-zcode-computer-use/src/host-client.mjs";
import { TOOLS, TOOL_BY_NAME } from "./vendor/open-zcode-computer-use/src/tool-definitions.mjs";
import { validateSchema } from "./vendor/open-zcode-computer-use/src/mcp-server.mjs";
import { toolError } from "./vendor/open-zcode-computer-use/src/results.mjs";
import { withDesktopControlLease } from "./open-control-lease.mjs";
import {
  isOpenComputerUseSupported,
  readOpenComputerUseRefreshMarker,
  resolveOpenComputerUseNative,
} from "./open-native.mjs";

export {
  OPEN_CUA_NATIVE_ENV,
  OPEN_CUA_PERMISSION_APP_ENV,
  OPEN_CUA_MINIMUM_MACOS_VERSION,
  isOpenComputerUseSupported,
  readOpenComputerUsePermissions,
  refreshOpenComputerUsePermissions,
  resolveOpenComputerUseNative,
} from "./open-native.mjs";
export const OPEN_COMPUTER_USE_TOOLS = TOOLS;
const PHYSICAL_POINTER_TOOLS = new Set(["mouse_move", "left_mouse_down", "left_mouse_up"]);

function failure(message, code, delivery = "not_sent") {
  return toolError(new Error(message), {
    code,
    action_sent: delivery === "possibly_sent",
    request_delivery_state: delivery,
  });
}

export function createOpenComputerUseService(options = {}) {
  const withLease = options.withLease ?? withDesktopControlLease;
  const readRefreshMarker = options.readRefreshMarker ?? readOpenComputerUseRefreshMarker;
  const executable = options.executable ?? resolveOpenComputerUseNative(options);
  let activeSignal;
  const assertActive = () => {
    activeSignal?.throwIfAborted();
    if (closed) throw new Error("电脑控制连接已关闭。");
  };
  const createService =
    options.createService ??
    (() => {
      const host = new HostClient({ executable, allowGlobalPointer: false });
      const service = new ComputerUseService({
        host,
        nativeUtility: (command, args, utilityOptions) => {
          assertActive();
          return runNativeUtility(command, args, { ...utilityOptions, executable });
        },
        assertActive,
      });
      return { host, service };
    });
  let current;
  let starting;
  let generation;
  let closed = false;
  let pending = Promise.resolve();

  const serialize = (run) => {
    const operation = pending.then(run);
    pending = operation.catch(() => {});
    return operation;
  };

  async function ensureNative() {
    const marker = await readRefreshMarker();
    if (current && generation !== marker) {
      await current.service.close();
      current = undefined;
    }
    if (current) return current;
    const candidate = createService();
    starting = candidate;
    try {
      assertActive();
      await candidate.service.start();
      assertActive();
      current = candidate;
      generation = marker;
      return candidate;
    } catch (error) {
      await candidate.service.close();
      throw error;
    } finally {
      starting = undefined;
    }
  }

  return {
    // MCP 的启动只建立传输；native 在有效工具请求时才启动。
    async start() {},
    callTool(name, args = {}, { signal, runtimeScope } = {}) {
      return serialize(async () => {
        if (closed) return failure("电脑控制连接已关闭，请重新打开会话。", "connection_closed");
        if (signal?.aborted) return failure("电脑操作已取消。", "cancelled");
        if (runtimeScope === "subagent") {
          return failure("子智能体不能操作电脑。", "SUBAGENT_COMPUTER_USE_UNAVAILABLE");
        }
        if (!isOpenComputerUseSupported(options)) {
          return failure("开源电脑控制仅支持 macOS 14 或更新版本。", "unsupported_platform");
        }
        const tool = TOOL_BY_NAME.get(name);
        if (!tool) return failure("未知的电脑控制工具。", "unknown_tool");
        if (PHYSICAL_POINTER_TOOLS.has(name)) {
          return failure(
            "此构建未启用物理鼠标接管，请使用界面元素或 PID 定向操作。",
            "global_pointer_disabled",
          );
        }
        const errors = validateSchema(tool.inputSchema, args);
        if (errors.length)
          return failure(`电脑操作参数无效：${errors.join("; ")}`, "invalid_arguments");
        // 停控是上游 service 的锁存事实；权限刷新不能替换它并意外恢复操作。
        if (
          current?.service.stopped &&
          name !== "request_access" &&
          name !== "stop_computer_control"
        ) {
          return failure("此会话已停止电脑控制，请重新打开会话。", "computer_control_stopped");
        }
        let dispatched = false;
        const controller = new AbortController();
        const cancel = () => {
          closed = true;
          controller.abort(new Error("电脑操作已取消。"));
          // 已发送的输入可能仍在执行；先封住后续输入，等待原生抬键/动作完成后再释放桌面锁。
          (current ?? starting)?.host.fence?.();
        };
        activeSignal = controller.signal;
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          return await withLease(
            async () => {
              if (signal?.aborted || closed) return failure("电脑操作已取消。", "cancelled");
              try {
                const active = current?.service.stopped ? current : await ensureNative();
                assertActive();
                if (closed) return failure("电脑操作已取消。", "cancelled");
                dispatched = true;
                const result = await active.service.callTool(name, args);
                return closed
                  ? failure(
                      "电脑操作已取消，已发送的操作不会自动重试。",
                      "cancelled",
                      "possibly_sent",
                    )
                  : result;
              } finally {
                if (current?.host.accepting === false) closed = true;
                if (closed && current) {
                  await current.service.close();
                  current = undefined;
                }
              }
            },
            { onCompromised: cancel },
          );
        } catch (error) {
          return failure(
            signal?.aborted ? "电脑操作已取消。" : error.message,
            signal?.aborted ? "cancelled" : (error.code ?? "native_unavailable"),
            dispatched ? "possibly_sent" : "not_sent",
          );
        } finally {
          signal?.removeEventListener("abort", cancel);
          activeSignal = undefined;
        }
      });
    },
    async close() {
      closed = true;
      (current ?? starting)?.host.fence?.();
      await serialize(async () => {
        await current?.service.close();
        current = undefined;
      });
    },
  };
}
