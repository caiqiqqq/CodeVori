import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NativeMcpServerRecord } from "@zcode/shared";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { savedWorkflowTools } from "./acpSavedWorkflows.js";

interface McpEndpointTools {
  names: readonly string[];
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

// 图片恢复必须返回 MCP image，不能被通用 JSON 包装退化成大段 base64 文本。
export type WorkflowMcpEndpoint = McpEndpointTools &
  (
    | { call(name: string, args: Record<string, unknown>): Promise<unknown>; callTool?: never }
    | {
        call?: never;
        callTool(name: string, args: Record<string, unknown>): Promise<{ content: ContentBlock[] }>;
      }
  );

const proxySource = `import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
const pending = new Set();
for await (const line of input) {
  const task = (async () => {
    let request;
    try {
      request = JSON.parse(line);
      if (request.id === undefined) return;
      const response = await fetch(process.env.ZCODE_WORKFLOW_URL, {
        method: "POST",
        headers: { authorization: "Bearer " + process.env.ZCODE_WORKFLOW_TOKEN, "content-type": "application/json" },
        body: line,
      });
      if (!response.ok) throw new Error("Workflow Host: " + response.status);
      process.stdout.write((await response.text()) + "\\n");
    } catch (error) {
      if (request?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
        error: { code: -32000, message: String(error) } }) + "\\n");
    }
  })();
  pending.add(task);
  task.finally(() => pending.delete(task));
}
await Promise.allSettled(pending);
`;

function toolInputSchema(name: string): Record<string, unknown> {
  const saved = savedWorkflowTools.find((tool) => tool.name === name);
  if (saved) return saved.inputSchema;
  if (name === "submit_result")
    return {
      type: "object",
      properties: { result: { description: "Typed JSON result matching the current ask schema" } },
      required: ["result"],
      additionalProperties: false,
    };
  if (name === "CreateWorkflow")
    return {
      type: "object",
      properties: {
        script: { type: "string", description: "Complete TypeScript workflow script" },
        name: { type: "string", description: "Workflow display name" },
      },
      required: ["script"],
      additionalProperties: false,
    };
  if (name === "GetWorkflowRun" || name === "CancelWorkflowRun" || name === "ResumeWorkflowRun")
    return {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false,
    };
  return { type: "object", properties: {}, additionalProperties: false };
}

/** Host-local, capability-bound MCP server. No bearer is ever saved in a session snapshot. */
export function createAcpWorkflowMcp(directory: string) {
  const endpoints = new Map<string, { name: string; endpoint: WorkflowMcpEndpoint }>();
  let server: Server | undefined;
  let port = 0;
  let starting: Promise<void> | undefined;
  const proxyPath = join(directory, "workflows", "mcp-proxy.mjs");

  async function start(): Promise<void> {
    if (server) return;
    if (starting) return starting;
    starting = (async () => {
      await mkdir(join(directory, "workflows"), { recursive: true });
      await writeFile(proxyPath, proxySource, { mode: 0o600 });
      const instance = createServer((req, res) => {
        void (async () => {
          const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
          const registered = token ? endpoints.get(token) : undefined;
          if (!registered || req.method !== "POST" || req.url !== "/mcp") {
            res.writeHead(403).end();
            return;
          }
          const { endpoint } = registered;
          let body = "";
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 1024 * 1024) {
              res.writeHead(413).end();
              return;
            }
          }
          const rpc = JSON.parse(body) as {
            id?: string | number;
            method: string;
            params?: { name?: string; arguments?: Record<string, unknown> };
          };
          let result: unknown;
          switch (rpc.method) {
            case "initialize":
              result = {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: registered.name, version: "1.0.0" },
              };
              break;
            case "ping":
              result = {};
              break;
            case "tools/list":
              result = {
                tools:
                  endpoint.tools ??
                  endpoint.names.map((name) => ({
                    name,
                    description:
                      savedWorkflowTools.find((tool) => tool.name === name)?.description ??
                      `ZCode workflow: ${name}`,
                    inputSchema: toolInputSchema(name),
                  })),
              };
              break;
            case "tools/call": {
              const name = rpc.params?.name;
              if (!name || !endpoint.names.includes(name)) throw new Error("Unknown workflow tool");
              try {
                if (endpoint.callTool) {
                  result = await endpoint.callTool(name, rpc.params?.arguments ?? {});
                } else {
                  const value = await endpoint.call(name, rpc.params?.arguments ?? {});
                  result = { content: [{ type: "text", text: JSON.stringify(value) }] };
                }
              } catch (error) {
                result = {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        error: error instanceof Error ? error.message : String(error),
                      }),
                    },
                  ],
                  isError: true,
                };
              }
              break;
            }
            default:
              throw new Error("Unsupported MCP method");
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result }));
        })().catch((error: unknown) => {
          if (res.writableEnded) return;
          res.writeHead(400, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32600,
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          );
        });
      });
      instance.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        instance.once("listening", resolve);
        instance.once("error", reject);
      });
      server = instance;
      // 修复原因：普通 ACP 会话也会预注册工作流工具；遗留调用方即使未显式 dispose，
      // 空闲监听器也不能阻止 Host 测试进程或 CLI 正常退出。
      instance.unref();
      const address = instance.address();
      if (!address || typeof address === "string")
        throw new Error("Workflow MCP listener unavailable");
      port = address.port;
    })();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  }

  return {
    async register(
      name: string,
      endpoint: WorkflowMcpEndpoint,
    ): Promise<{ record: NativeMcpServerRecord; revoke(): void }> {
      await start();
      const token = randomBytes(32).toString("hex");
      endpoints.set(token, { name, endpoint });
      return {
        record: {
          source: "zcodeagentmcp",
          scope: "workspace",
          name,
          enabled: true,
          config: {
            command: process.execPath,
            args: [proxyPath],
            env: {
              ELECTRON_RUN_AS_NODE: "1",
              ZCODE_WORKFLOW_TOKEN: token,
              ZCODE_WORKFLOW_URL: `http://127.0.0.1:${port}/mcp`,
            },
          },
        },
        revoke() {
          endpoints.delete(token);
        },
      };
    },
    dispose() {
      endpoints.clear();
      server?.close();
      server = undefined;
    },
  };
}

export type AcpWorkflowMcp = ReturnType<typeof createAcpWorkflowMcp>;
