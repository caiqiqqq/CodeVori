import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserControlPort, Logger, McpServerConfig, TraceContext } from "@zcode/contracts";
import {
  NODE_REPL_BROWSER_BROKER_SOCKET_ENV,
  NODE_REPL_BROWSER_BROKER_TOKEN_ENV,
  nodeReplBrowserBrokerRequestSchema,
  type NodeReplBrowserBrokerRequest,
  type NodeReplBrowserBrokerResponse,
} from "@zcode/shared";

const NODE_REPL_MCP_SERVER_NAME = "node_repl";
const MAX_REQUEST_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SOCKET_DIRECTORY_PREFIX = ".znr-";
const SOCKET_FILENAME = "b.sock";
const MAX_UNIX_SOCKET_PATH_BYTES = 103;
const RECOVERABLE_SOCKET_ROOT_ERRORS = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "ENAMETOOLONG",
]);

interface BrokerEndpoint {
  socketPath: string;
  directory?: string;
}

export interface NodeReplBrowserBroker {
  close(): Promise<void>;
  ready: Promise<void>;
  socketPath: string;
  token: string;
}

export function createNodeReplBrowserBroker(input: {
  browserControlPort: BrowserControlPort;
  logger: Logger;
  platform?: NodeJS.Platform | string;
  socketRootDirectories?: readonly string[];
}): NodeReplBrowserBroker {
  let endpoint: BrokerEndpoint | undefined;
  let closing: Promise<void> | undefined;
  const token = randomBytes(32).toString("hex");
  const server = createServer((socket) => {
    handleSocket(socket, { ...input, token }).catch((error) => {
      input.logger.warn("Node REPL browser broker request failed", {
        event: "node_repl.browser_broker.request.failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  server.on("error", (error) => {
    if (!endpoint) return;
    input.logger.error("Node REPL browser broker failed", error, {
      event: "node_repl.browser_broker.failed",
    });
  });
  const ready = initializeEndpoint(server, input).then(
    (result) => {
      endpoint = result;
    },
    (error: Error) => {
      input.logger.error("Node REPL browser broker startup failed", error, {
        event: "node_repl.browser_broker.startup.failed",
      });
      throw error;
    },
  );

  return {
    ready,
    get socketPath() {
      if (!endpoint) throw new Error("Node REPL browser broker is not ready");
      return endpoint.socketPath;
    },
    token,
    close: () =>
      (closing ??= (async () => {
        // 启动中的关闭必须等目录分配和 listen 收口；重复关闭不能并发清理同一端点。
        await ready.catch(() => undefined);
        await closeServer(server);
        if (endpoint?.directory) await removeEndpoint(endpoint);
      })()),
  };
}

export function injectNodeReplBrowserBroker(
  servers: Record<string, McpServerConfig>,
  broker: NodeReplBrowserBroker | undefined,
): Record<string, McpServerConfig> {
  if (!broker) return servers;
  const nodeRepl = servers[NODE_REPL_MCP_SERVER_NAME];
  if (!nodeRepl || nodeRepl.type !== "stdio") return servers;
  return {
    ...servers,
    [NODE_REPL_MCP_SERVER_NAME]: {
      ...nodeRepl,
      env: {
        ...nodeRepl.env,
        [NODE_REPL_BROWSER_BROKER_SOCKET_ENV]: broker.socketPath,
        [NODE_REPL_BROWSER_BROKER_TOKEN_ENV]: broker.token,
      },
    },
  };
}

async function initializeEndpoint(
  server: Server,
  input: {
    platform?: NodeJS.Platform | string;
    socketRootDirectories?: readonly string[];
    logger: Logger;
  },
): Promise<BrokerEndpoint> {
  if ((input.platform ?? process.platform) === "win32") {
    const socketPath = `\\\\.\\pipe\\zcode-node-repl-${randomUUID()}`;
    await listen(server, socketPath);
    return { socketPath };
  }
  // 外部启动器的 TMPDIR 可能早已被回收；不复活外部目录，只在可用根下分配自己的私有目录。
  const roots = new Set(input.socketRootDirectories ?? [tmpdir(), homedir()]);
  const errors: unknown[] = [];
  for (const root of roots) {
    let endpoint: BrokerEndpoint | undefined;
    try {
      const prefix = join(root, SOCKET_DIRECTORY_PREFIX);
      const longestPath = join(`${prefix}XXXXXX`, SOCKET_FILENAME);
      if (Buffer.byteLength(longestPath) > MAX_UNIX_SOCKET_PATH_BYTES) {
        throw Object.assign(new Error("Node REPL browser broker socket path is too long"), {
          code: "ENAMETOOLONG",
        });
      }
      const directory = await mkdtemp(prefix);
      endpoint = { directory, socketPath: join(directory, SOCKET_FILENAME) };
      await listen(server, endpoint.socketPath);
      return endpoint;
    } catch (error) {
      if (endpoint) await removeEndpoint(endpoint);
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RECOVERABLE_SOCKET_ROOT_ERRORS.has(code)) throw error;
      errors.push(error);
      input.logger.warn("Node REPL browser broker socket root unavailable", {
        event: "node_repl.browser_broker.socket_root.unavailable",
        errorCode: code,
      });
    }
  }
  throw new AggregateError(errors, "No usable Node REPL browser broker socket directory", {
    cause: errors.at(-1),
  });
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    try {
      server.listen(socketPath);
      server.unref();
    } catch (error) {
      onError(error as Error);
    }
  });
}

async function removeEndpoint(endpoint: BrokerEndpoint): Promise<void> {
  await rm(endpoint.socketPath, { force: true });
  if (!endpoint.directory) return;
  // 只删自己的 socket 和空目录，不能递归删除根目录或夹带的其他文件。
  await rmdir(endpoint.directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function handleSocket(
  socket: Socket,
  input: {
    browserControlPort: BrowserControlPort;
    logger: Logger;
    token: string;
  },
): Promise<void> {
  const abortController = new AbortController();
  let completed = false;
  let requestId = randomUUID();
  // steer 会让 node_repl 客户端 abort 后立即 socket.destroy()，而 broker 此刻通常正在
  // 回写截图 base64。socket 只在 readLine 期间挂 error 监听（resolve 时就被 cleanup 摘掉）是不够的，
  // 写响应阶段完全没有监听者，对端断开产生的 EPIPE 就成了无人接收的 'error' 事件，直接击穿整个
  // Agent 进程（Unhandled error event -> exit 1）。这里让监听覆盖 socket 全生命周期，并把对端
  // 断开收敛为「取消当前请求」，不再冒泡成进程级错误。
  socket.on("error", (error) => {
    if (!completed) abortController.abort();
    input.logger.debug("Node REPL browser broker connection dropped", {
      event: "node_repl.browser_broker.connection.dropped",
      error: error.message,
    });
  });
  socket.once("close", () => {
    if (!completed) abortController.abort();
  });
  try {
    const raw = await readLine(socket, abortController.signal);
    const payload = JSON.parse(raw) as unknown;
    // 严格 schema 会在 timeout 等未知字段处直接抛错；过去只有完整 parse 成功后才覆盖
    // 随机占位 id，导致真实参数错误被 client 的 response id mismatch 二次错误吞掉。
    requestId = requestIdFromPayload(payload) ?? requestId;
    const request = nodeReplBrowserBrokerRequestSchema.parse(payload);
    requestId = request.id as ReturnType<typeof randomUUID>;
    authorizeRequest(request, input);
    const response = await executeRequest(
      request,
      input.browserControlPort,
      abortController.signal,
    );
    completed = true;
    respond(socket, response);
  } catch (error) {
    completed = true;
    respond(socket, {
      id: requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function requestIdFromPayload(payload: unknown): ReturnType<typeof randomUUID> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && UUID_PATTERN.test(id)
    ? (id as ReturnType<typeof randomUUID>)
    : undefined;
}

function respond(socket: Socket, response: NodeReplBrowserBrokerResponse): void {
  // 对端可能已在 steer 取消后销毁 socket；此时没有回写的意义，写了也只会换来一个 EPIPE。
  if (!socket.writable) return;
  socket.end(`${JSON.stringify(response)}\n`);
}

function authorizeRequest(request: NodeReplBrowserBrokerRequest, input: { token: string }): void {
  const actual = Buffer.from(request.token);
  const expected = Buffer.from(input.token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Node REPL browser broker request is not authorized");
  }
  // 共享 MCP 子进程不能再绑定某一个 session，但 top-level MCP metadata 也不能
  // 直接取得 Browser 权限。私有 socket token 先证明请求来自宿主启动的 node_repl；sessionId
  // 随后由 BrowserControlPort 的 requireSession 做权威校验，subagent 在到达端口前直接拒绝。
  if (request.runtimeScope === "subagent") {
    throw new Error("Browser is not available in subagent");
  }
}

async function executeRequest(
  request: NodeReplBrowserBrokerRequest,
  port: BrowserControlPort,
  signal: AbortSignal,
): Promise<NodeReplBrowserBrokerResponse> {
  const traceContext = request.trace as TraceContext | undefined;
  if (request.op === "list") {
    const browsers = await port.list({
      sessionId: request.sessionId,
      turnId: request.turnId,
      traceContext,
      signal,
    });
    return { id: request.id, ok: true, browsers };
  }
  const result = await port.execute({
    browserId: request.browserId,
    browserGeneration: request.browserGeneration,
    sessionId: request.sessionId,
    turnId: request.turnId,
    command: request.command,
    traceContext,
    signal,
  });
  return { id: request.id, ok: true, result };
}

async function readLine(socket: Socket, signal: AbortSignal): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
        cleanup();
        reject(new Error("Node REPL browser broker request exceeded 1 MiB"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      resolve(buffer.slice(0, newline));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
