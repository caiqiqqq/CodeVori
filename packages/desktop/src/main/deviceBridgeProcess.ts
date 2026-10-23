import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import {
  deviceBridgeWorkerResponseSchema,
  type DeviceBridgeWorkerResponse,
  type DeviceBridgeErrorCode,
} from "@zcode/shared";

export interface DeviceBridgeSession {
  request(method: string, fields?: Record<string, unknown>): Promise<DeviceBridgeWorkerResponse>;
  stop(): Promise<void>;
}

function launchError(error: unknown): DeviceBridgeErrorCode {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return "device_bridge_component_missing";
  if (code === "EACCES" || code === "EPERM") return "device_bridge_component_not_executable";
  return "device_bridge_start_failed";
}

export async function startDeviceBridgeProcess(options: {
  binaryPath: string;
  stateDir: string;
  hostname: string;
  onExit(reason: DeviceBridgeErrorCode): void;
}): Promise<DeviceBridgeSession> {
  // 仅绝对路径不代表组件已安装；先验证文件与执行权限，避免把漏包误报为网络授权失败。
  try {
    if (!(await stat(options.binaryPath)).isFile())
      throw Object.assign(new Error(), { code: "ENOENT" });
    await access(
      options.binaryPath,
      process.platform === "win32" ? constants.R_OK : constants.X_OK,
    );
  } catch (error) {
    throw new Error(launchError(error));
  }
  // GUI 登录不继承终端中可能残留的 auth key 或其他协调服务器配置。
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(TS_|TSNET_)/.test(key)) delete env[key];
  }
  let child;
  try {
    child = spawn(
      options.binaryPath,
      ["manage", "--state-dir", options.stateDir, "--hostname", options.hostname],
      {
        env,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new Error(launchError(error));
  }
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<
    string,
    {
      resolve(value: DeviceBridgeWorkerResponse): void;
      reject(reason: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let sequence = 0;
  let closed = false;
  let stopping = false;
  let responded = false;
  let failure: DeviceBridgeErrorCode = "device_bridge_process_closed";
  const fail = (reason: DeviceBridgeErrorCode = "device_bridge_process_closed") => {
    if (closed) return;
    failure = reason;
    closed = true;
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error(reason));
    }
    pending.clear();
    lines.close();
    child.kill();
    options.onExit(reason);
  };
  const processFailure = () =>
    fail(responded || stopping ? "device_bridge_process_closed" : "device_bridge_start_failed");
  // 预检与 spawn 之间仍可能删除文件或改变权限，不能丢失该系统错误的分类。
  child.once("error", (error) => fail(launchError(error)));
  child.once("exit", processFailure);
  child.stdin.on("error", processFailure);
  lines.on("line", (line) => {
    if (line.length > 1_048_576) {
      fail();
      child.kill();
      return;
    }
    let response: DeviceBridgeWorkerResponse;
    try {
      response = deviceBridgeWorkerResponseSchema.parse(JSON.parse(line));
    } catch {
      fail();
      child.kill();
      return;
    }
    const operation = pending.get(response.id);
    if (!operation) return;
    responded = true;
    pending.delete(response.id);
    clearTimeout(operation.timer);
    if (response.error) operation.reject(new Error("device_bridge_operation_failed"));
    else operation.resolve(response);
  });
  return {
    request(method, fields = {}) {
      if (closed || stopping) return Promise.reject(new Error(failure));
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // 超时后结束这一代进程，避免迟到的 connect/expose 副作用继续有效。
          processFailure();
          child.kill();
        }, 20_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, method, ...fields })}\n`, (error) => {
          if (error) processFailure();
        });
      });
    },
    async stop() {
      if (closed) return;
      stopping = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
      fail();
    },
  };
}
