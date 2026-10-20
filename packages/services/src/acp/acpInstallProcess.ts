import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../process/processTreeTerminator.js";

/** 清理未确认时调用方必须保留 staging 和 admission，不能让两个 npm 同时写目录。 */
export class AcpInstallCleanupError extends Error {}

export function sanitizeAcpInstallLog(message: string, env: NodeJS.ProcessEnv = {}): string {
  let text = stripVTControlCharacters(message);
  for (const [key, value] of Object.entries(env)) {
    if (value && /token|secret|password|credential|api.?key|proxy/i.test(key)) {
      text = text.split(value).join("[redacted]");
      try {
        const url = new URL(value);
        for (const secret of [url.username, url.password]) {
          if (secret) text = text.split(decodeURIComponent(secret)).join("[redacted]");
        }
      } catch {
        /* Not a URL. */
      }
    }
  }
  return (
    text
      .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
        try {
          const url = new URL(raw);
          url.username = "";
          url.password = "";
          url.search = "";
          url.hash = "";
          return url.href;
        } catch {
          return "[redacted URL]";
        }
      })
      .replace(/(authorization["']*\s*[:=]\s*)[^\r\n]+/gi, "$1[redacted]")
      .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(
        /(\b[\w-]*(?:token|secret|password|api[_-]?key)["']*\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        "$1[redacted]",
      )
      // oxlint-disable-next-line no-control-regex -- 第三方终端输出的控制字符必须移除，不能原样进入日志。
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
      .slice(0, 2048)
  );
}

/** npm 与 postinstall 共用有界输出及真实进程树退出屏障，不只结束 npm 父进程。 */
export async function runAcpInstallProcess(options: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell?: boolean;
  signal: AbortSignal;
  timeoutMs?: number;
  onLog(message: string): void;
}): Promise<void> {
  options.signal.throwIfAborted();
  const startedAt = Date.now();
  const child = spawn(options.command, options.args, {
    env: options.env,
    shell: options.shell,
    windowsHide: true,
    detached: shouldSpawnInDetachedProcessGroup(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exitedAt: number | undefined;
  child.once("exit", () => {
    exitedAt = Date.now();
  });
  let batch: string[] = [];
  const flush = () => {
    if (!batch.length) return;
    options.onLog(batch.join("\n").slice(0, 2048));
    batch = [];
  };
  // 高频下载输出最多每 100ms 一个消息；超长行整行丢弃，避免在截断边界泄漏凭据。
  const flushTimer = setInterval(flush, 100);
  const tails: (() => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let oversized = false;
    const consume = (text: string) => {
      for (const part of text.split(/(?<=[\r\n])/)) {
        if (!oversized) pending += part;
        if (pending.length > 16_384) {
          pending = "";
          oversized = true;
        }
        if (/[\r\n]$/.test(part)) {
          const line = oversized
            ? "[installation output line omitted: too long]"
            : sanitizeAcpInstallLog(pending.trim(), options.env);
          if (line) batch = [...batch.slice(-19), line];
          pending = "";
          oversized = false;
        }
      }
    };
    stream.on("data", (chunk: Buffer) => consume(decoder.write(chunk)));
    tails.push(() => {
      consume(decoder.end());
      if (pending && !oversized)
        batch = [...batch.slice(-19), sanitizeAcpInstallLog(pending, options.env)];
    });
  }
  let stop: ((message: string) => void) | undefined;
  const abort = () => stop?.("安装已取消");
  const timeout = setTimeout(
    () => stop?.("安装超时（npm 执行上限 20 分钟），请检查网络设置后重试"),
    options.timeoutMs ?? 20 * 60_000,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      let stopping = false;
      stop = (message) => {
        if (stopping) return;
        stopping = true;
        options.onLog(`${message}；正在等待安装进程树退出…`);
        void terminateProcessTreeAndWait(child, {
          ownedProcessGroupId: process.platform === "win32" ? undefined : child.pid,
          ownedProcessStartedAtMs: startedAt,
          resolveOwnedProcessExitedAtMs: () => exitedAt,
          forceAfterMs: 1500,
          waitAfterForceMs: 3000,
        }).then(
          (result) => {
            if (result.remainingPids.length) {
              reject(
                new AcpInstallCleanupError(
                  "安装进程清理未完成；已保留安装锁和临时目录，请重启 Host 后检查残留进程。",
                ),
              );
            } else reject(new Error(message));
          },
          () =>
            reject(
              new AcpInstallCleanupError("无法确认安装进程退出；请重启 Host 后检查残留进程。"),
            ),
        );
      };
      child.once("error", () => {
        if (!stopping) reject(new Error("无法启动 npm 安装进程"));
      });
      child.once("close", (code) => {
        if (!stopping) {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `npm exited with code ${code}；已使用国内 npm 镜像，第三方安装脚本仍可能需要访问 GitHub 或额外的本机工具。`,
              ),
            );
        }
      });
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    });
  } finally {
    clearTimeout(timeout);
    clearInterval(flushTimer);
    options.signal.removeEventListener("abort", abort);
    for (const tail of tails) tail();
    flush();
  }
}
