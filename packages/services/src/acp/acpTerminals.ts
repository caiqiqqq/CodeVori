import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { CreateTerminalRequest, TerminalExitStatus } from "@agentclientprotocol/sdk";
import type { AcpTerminal } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../process/processTreeTerminator.js";

const logger = createServiceLogger("acp-terminals");
interface LiveTerminal {
  child: ChildProcess;
  fact: AcpTerminal;
  limit: number;
  exited: Promise<TerminalExitStatus>;
  published: Promise<void>;
  pendingFact?: AcpTerminal;
  publishing: boolean;
  closed: boolean;
}

/** One connection owns handles and cleanup; the Host only persists derived facts. */
export class AcpTerminals {
  private readonly terminals = new Map<string, LiveTerminal>();
  private closed = false;
  constructor(
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly onUpdate: (terminal: AcpTerminal) => Promise<void>,
  ) {}

  private get(id: string): LiveTerminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error("Unknown ACP terminal");
    return terminal;
  }

  private publish(terminal: LiveTerminal): Promise<void> {
    // 修复依据：只向 Host 的同一快照写入进程事实，输出不进入诊断日志。
    terminal.pendingFact = { ...terminal.fact };
    if (terminal.publishing) return terminal.published;
    terminal.publishing = true;
    terminal.published = (async () => {
      while (terminal.pendingFact) {
        const fact = terminal.pendingFact;
        terminal.pendingFact = undefined;
        try {
          await this.onUpdate(fact);
        } catch {
          logger.warn("ACP terminal snapshot update failed");
        }
      }
    })().finally(() => {
      terminal.publishing = false;
    });
    return terminal.published;
  }

  async create(request: CreateTerminalRequest) {
    if (this.closed) throw new Error("ACP terminals closed");
    if (this.terminals.size >= 64)
      throw new Error("ACP terminal limit reached; release finished terminals");
    if (!request.command || (request.cwd && !isAbsolute(request.cwd)))
      throw new Error("Invalid ACP terminal command or cwd");
    const limit = request.outputByteLimit ?? 64 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error("Invalid ACP terminal output limit");
    const terminalId = randomUUID();
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd ?? this.cwd,
      env: {
        ...this.env,
        ...Object.fromEntries((request.env ?? []).map((e) => [e.name, e.value])),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: shouldSpawnInDetachedProcessGroup(),
      windowsHide: true,
    });
    const terminal: LiveTerminal = {
      child,
      limit: Math.min(limit, 64 * 1024),
      published: Promise.resolve(),
      publishing: false,
      closed: false,
      fact: {
        terminalId,
        title: [request.command, ...(request.args ?? [])].join(" ").slice(0, 8192),
        status: "running",
        startedAt: Date.now(),
        output: "",
        truncated: false,
      },
      exited: Promise.resolve({}),
    };
    this.terminals.set(terminalId, terminal);
    const append = (chunk: string) => {
      const bytes = Buffer.from(terminal.fact.output + chunk);
      let start = Math.max(0, bytes.length - terminal.limit);
      if (start > 0) {
        terminal.fact.truncated = true;
        // ACP 要求按 UTF-8 字符边界裁掉头部，不能产生半个多字节字符。
        while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
      }
      terminal.fact.output = bytes.subarray(start).toString("utf8");
      void this.publish(terminal);
    };
    child.stdout!.setEncoding("utf8").on("data", append);
    child.stderr!.setEncoding("utf8").on("data", append);
    terminal.exited = new Promise((resolve) => {
      child.once("close", (exitCode, signal) => {
        terminal.closed = true;
        if (terminal.fact.status === "running") terminal.fact.status = "finished";
        terminal.fact.exitCode = exitCode;
        terminal.fact.signal = signal;
        void this.publish(terminal).then(() => resolve({ exitCode, signal }));
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await this.publish(terminal);
      return { terminalId };
    } catch (error) {
      await terminal.exited;
      this.terminals.delete(terminalId);
      throw error;
    }
  }

  output(id: string) {
    const { fact } = this.get(id);
    return {
      output: fact.output,
      truncated: fact.truncated,
      ...(fact.status !== "running"
        ? { exitStatus: { exitCode: fact.exitCode ?? null, signal: fact.signal ?? null } }
        : {}),
    };
  }

  wait(id: string) {
    return this.get(id).exited;
  }

  async kill(id: string) {
    const terminal = this.get(id);
    // close 后只保留输出，禁止再按历史 PID/PGID 查树，避免 PID 复用时误杀别的进程。
    if (terminal.closed) return {};
    // 即使 root 已退出，也回收其 owned process group 中尚存的后代。
    const result = await terminateProcessTreeAndWait(
      terminal.child,
      process.platform !== "win32" && terminal.child.pid
        ? { ownedProcessGroupId: terminal.child.pid }
        : {},
    );
    // 查询进程身份失败可能没有可验证 PID；这不等于受管 ChildProcess 已退出。
    if (
      result.remainingPids.length ||
      (terminal.child.exitCode === null && terminal.child.signalCode === null)
    )
      throw new Error("ACP terminal process cleanup did not complete");
    await terminal.exited;
    return {};
  }

  async release(id: string) {
    const terminal = this.get(id);
    await this.kill(id);
    terminal.fact.status = "released";
    await this.publish(terminal);
    this.terminals.delete(id);
    return {};
  }

  async dispose() {
    this.closed = true;
    const results = await Promise.allSettled(
      [...this.terminals].map(async ([id, terminal]) => {
        if (terminal.fact.status === "running") terminal.fact.status = "interrupted";
        await this.kill(id);
        await this.publish(terminal);
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("ACP terminal process cleanup did not complete");
    this.terminals.clear();
  }
}
