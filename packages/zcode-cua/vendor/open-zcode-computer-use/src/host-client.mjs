import { randomUUID } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class HostTransportError extends Error {
  constructor(message, { delivery = "not_sent", cause } = {}) {
    super(message, { cause });
    this.name = "HostTransportError";
    this.delivery = delivery;
  }
}

export function defaultNativeBinary() {
  if (process.env.OPEN_ZCODE_CUA_NATIVE) {
    return path.resolve(process.env.OPEN_ZCODE_CUA_NATIVE);
  }
  return path.join(ROOT, "native", ".build", "release", "OpenZCodeNative");
}

export class HostClient {
  constructor({
    executable = defaultNativeBinary(),
    requestTimeoutMs = 25_000,
    spawnProcess = spawn,
    allowGlobalPointer = process.env.OPEN_ZCODE_CUA_ALLOW_GLOBAL_POINTER === "1",
  } = {}) {
    this.executable = executable;
    this.requestTimeoutMs = requestTimeoutMs;
    this.spawnProcess = spawnProcess;
    this.allowGlobalPointer = allowGlobalPointer;
    this.child = null;
    this.lines = null;
    this.pending = new Map();
    this.nextId = 1;
    this.session = `session-${randomUUID()}`;
    this.imageDir = path.join(os.tmpdir(), `open-zcode-cua-${process.pid}-${randomUUID()}`);
    this.started = false;
    this.closed = false;
    this.accepting = true;
  }

  async start() {
    if (this.started) return;
    await mkdir(this.imageDir, { recursive: true, mode: 0o700 });
    await access(this.executable);
    if (!this.accepting || this.closed) throw new HostTransportError("Native executor is closing");
    this.child = this.spawnProcess(this.executable, ["host"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rejectPending = (error) => {
      this.fence();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
    this.child.once("error", (error) => rejectPending(new HostTransportError(
      "Could not start native executor", { cause: error },
    )));
    this.child.stdin.on("error", (error) => rejectPending(new HostTransportError(
      "Native executor input failed", { delivery: "possibly_sent", cause: error },
    )));
    this.child.stderr.on("data", (chunk) => {
      process.stderr.write(`[open-zcode-native] ${chunk}`);
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    this.child.once("exit", (code, signal) => {
      this.fence();
      const error = new HostTransportError(
        `Native executor exited (${signal ?? code ?? "unknown"})`,
        { delivery: "possibly_sent" },
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });

    await this.call("host.hello", {
      protocol: "maka.cu/2",
      host: { name: "open-zcode-computer-use", version: "0.1.0" },
      hostPid: process.pid,
      imageDir: this.imageDir,
      allowGlobalPointer: this.allowGlobalPointer,
    });
    await this.call("session.begin", {
      session: this.session,
      captureScope: "window",
    });
    this.started = true;
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write("[open-zcode-native] invalid protocol JSON\n");
      return;
    }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new HostTransportError(
        `${message.error.message}${message.error.data ? `: ${JSON.stringify(message.error.data)}` : ""}`,
        { delivery: pending.sent ? "possibly_sent" : "not_sent" },
      );
      error.code = message.error.code;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  async call(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.child || this.closed || (!this.accepting && method !== "session.end") || this.child.exitCode !== null || this.child.signalCode !== null) {
      throw new HostTransportError("Native executor is not running");
    }
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const pending = {
        sent: false,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(String(id));
          this.fence();
          const error = new HostTransportError(`Native request timed out: ${method}`, {
            delivery: pending.sent ? "possibly_sent" : "not_sent",
          });
          // 超时不能放行下一个桌面客户端，必须先确认旧执行器已经退出。
          this.child.once("exit", () => reject(error));
          if (!this.child.kill("SIGTERM")) reject(error);
        }, timeoutMs),
      };
      this.pending.set(String(id), pending);
      this.child.stdin.write(payload, (error) => {
        if (error) {
          clearTimeout(pending.timer);
          this.pending.delete(String(id));
          reject(
            new HostTransportError(`Could not write native request: ${method}`, {
              delivery: "not_sent",
              cause: error,
            }),
          );
          return;
        }
        pending.sent = true;
      });
    });
  }

  terminate() {
    this.child?.kill("SIGTERM");
  }

  fence() {
    this.accepting = false;
  }

  async close() {
    if (this.closed) return;
    this.fence();
    // spawn 被 EACCES/ENOENT 拒绝时没有 PID，也不会触发 exit，不能在此永久等候。
    if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await this.call("session.end", { session: this.session }, { timeoutMs: 3_000 });
      } catch {
        // Teardown is best effort; the child also releases its session at EOF.
      }
      this.child.stdin.end();
      await new Promise((resolve) => {
        if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
        const timer = setTimeout(() => {
          this.child?.kill("SIGTERM");
        }, 2_000);
        this.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.closed = true;
    await rm(this.imageDir, { recursive: true, force: true });
  }
}

export class MockHostClient {
  constructor({ responses = {} } = {}) {
    this.responses = responses;
    this.calls = [];
    this.session = "session-mock";
    this.started = false;
    this.closed = false;
  }

  async start() {
    this.started = true;
  }

  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    const responder = this.responses[method];
    if (typeof responder === "function") {
      return structuredClone(await responder(params, this.calls));
    }
    if (responder !== undefined) return structuredClone(responder);
    throw new Error(`No mock response configured for ${method}`);
  }

  async close() {
    this.closed = true;
  }
}

export async function runNativeUtility(command, args = [], {
  executable = defaultNativeBinary(),
  timeoutMs = 10_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [command, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Native utility timed out: ${command}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Native utility failed: ${command}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Native utility returned invalid JSON: ${command}`, { cause: error }));
      }
    });
  });
}
