const processGuardInstalled = new WeakSet<object>();
const OUTPUT_CLOSED_ERROR_CODES = new Set([
  "EPIPE",
  "EIO",
  "ENXIO",
  "EBADF",
  "ERR_STREAM_DESTROYED",
]);
const SHUTDOWN_DEADLINE_MS = 1500;

/** Entrypoint-owned shutdown; the deadline applies only once shutdown has been requested. */
export function createNodeReplShutdown(input: {
  close: () => Promise<void>;
  exit: () => void;
}): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    let exited = false;
    const finish = () => {
      if (exited) return;
      exited = true;
      clearTimeout(deadline);
      input.exit();
    };
    // 修复原因：SDK close 可能一直等待已断开的传输，EOF/signal 虽已触发却留有
    // 孤儿 REPL。先启动有 ref 的截止定时器；重复请求不能延长退出时间。
    const deadline = setTimeout(finish, SHUTDOWN_DEADLINE_MS);
    try {
      void input.close().then(finish, finish);
    } catch {
      finish();
    }
  };
}

/**
 * REPL cell 的同步错误由 NodeReplSession 兜底，但 fire-and-forget 的异步错误
 * （如未 await 的 tab.* 调用在 turn 中断时被 reject）会按 Node 默认策略击穿整个 server
 * 进程。子进程一死，会话内 Browser Use 从此不可用。这里把异步错误降级为 stderr 日志：
 * runtime 状态保留、协议 stdout 不受影响。
 *
 * 父进程退出后 stderr 会报 EPIPE。旧 handler 又把 EPIPE 堆栈写回同一条
 * stderr，形成 EPIPE -> uncaughtException -> stderr.write -> EPIPE 的无限循环。
 * 输出管道关闭表示 MCP client 已不可达，必须直接进入 shutdown，不能继续写诊断。
 */
export function installNodeReplProcessGuards(input: {
  onOutputClosed: (error: Error) => void;
  process: Pick<NodeJS.Process, "on">;
  writeStderr: (text: string) => void;
}): void {
  if (processGuardInstalled.has(input.process)) return;
  processGuardInstalled.add(input.process);

  let outputClosed = false;
  const describe = (reason: unknown): string =>
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  const report = (kind: "uncaughtException" | "unhandledRejection", reason: unknown): void => {
    if (outputClosed) return;
    if (isOutputClosedError(reason)) {
      outputClosed = true;
      input.onOutputClosed(reason);
      return;
    }

    try {
      input.writeStderr(`node_repl ${kind} (process kept alive): ${describe(reason)}\n`);
    } catch (error) {
      if (!isOutputClosedError(error)) throw error;
      outputClosed = true;
      input.onOutputClosed(error);
    }
  };
  input.process.on("unhandledRejection", (reason) => {
    report("unhandledRejection", reason);
  });
  input.process.on("uncaughtException", (error) => {
    report("uncaughtException", error);
  });
}

function isOutputClosedError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && OUTPUT_CLOSED_ERROR_CODES.has(code);
}

export function installNodeReplShutdownTriggers(input: {
  process: Pick<NodeJS.Process, "once">;
  shutdown: () => void;
  stdin: Pick<NodeJS.ReadStream, "once">;
}): void {
  let shutdownStarted = false;
  const shutdownOnce = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    input.shutdown();
  };

  // MCP SDK 的 stdio transport 不监听 stdin end/close。父进程异常退出时 runtime
  // 因此收不到生命周期终点并沦为孤儿进程。
  input.stdin.once("end", shutdownOnce);
  input.stdin.once("close", shutdownOnce);
  input.process.once("SIGINT", shutdownOnce);
  input.process.once("SIGTERM", shutdownOnce);
}

export async function isDirectMcpEntrypoint(
  importMetaUrl: string,
  argvPath: string | undefined,
): Promise<boolean> {
  if (!argvPath) return false;
  try {
    // macOS 的 /tmp、/var 等路径会解析到 /private/...；直接比较 file URL 会让
    // stdio 子进程误判成“被 import”，main 未启动且无错误退出。异步 realpath 同时兼容
    // symlink 安装目录，并避免在模块求值路径引入同步文件 IO。
    const [modulePath, executablePath] = await Promise.all([
      realpath(fileURLToPath(importMetaUrl)),
      realpath(argvPath),
    ]);
    return modulePath === executablePath;
  } catch {
    return false;
  }
}
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
