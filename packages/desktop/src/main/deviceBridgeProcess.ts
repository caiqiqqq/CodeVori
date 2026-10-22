import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { deviceBridgeWorkerResponseSchema, type DeviceBridgeWorkerResponse } from "@zcode/shared";

export interface DeviceBridgeSession {
  request(method: string, fields?: Record<string, unknown>): Promise<DeviceBridgeWorkerResponse>;
  stop(): Promise<void>;
}

export function startDeviceBridgeProcess(options: {
  binaryPath: string;
  stateDir: string;
  hostname: string;
  onExit(): void;
}): DeviceBridgeSession {
  // GUI 登录不继承终端中可能残留的 auth key 或其他协调服务器配置。
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(TS_|TSNET_)/.test(key)) delete env[key];
  }
  const child = spawn(
    options.binaryPath,
    ["manage", "--state-dir", options.stateDir, "--hostname", options.hostname],
    {
      env,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    },
  );
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
  const fail = () => {
    if (closed) return;
    closed = true;
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error("device_bridge_process_closed"));
    }
    pending.clear();
    lines.close();
    child.kill();
    options.onExit();
  };
  child.once("error", fail);
  child.once("exit", fail);
  child.stdin.on("error", fail);
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
    pending.delete(response.id);
    clearTimeout(operation.timer);
    if (response.error) operation.reject(new Error("device_bridge_operation_failed"));
    else operation.resolve(response);
  });
  return {
    request(method, fields = {}) {
      if (closed || stopping) return Promise.reject(new Error("device_bridge_process_closed"));
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // 超时后结束这一代进程，避免迟到的 connect/expose 副作用继续有效。
          fail();
          child.kill();
        }, 20_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, method, ...fields })}\n`, (error) => {
          if (error) fail();
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
