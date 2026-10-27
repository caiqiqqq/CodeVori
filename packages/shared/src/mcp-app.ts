import { z } from "zod";

export const MCP_APP_META_KEY = "zcode/mcpApp";
export const MCP_APP_MAX_HTML = 512 * 1024;
export const mcpAppResourceSchema = z.object({
  resourceUri: z.string().startsWith("ui://").max(2048),
  backgroundRetention: z.boolean().optional(),
  html: z
    .string()
    .max(MCP_APP_MAX_HTML)
    .refine((value) => new TextEncoder().encode(value).byteLength <= MCP_APP_MAX_HTML),
  connectDomains: z.array(z.string()).max(50),
  resourceDomains: z.array(z.string()).max(50),
});
export type McpAppResource = z.infer<typeof mcpAppResourceSchema>;
const appResultSchema = z
  .object({
    content: z.array(z.unknown()),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .refine((value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MCP_APP_MAX_HTML;
    } catch {
      return false;
    }
  });
export const mcpAppToolDisplaySchema = z.object({
  resource: mcpAppResourceSchema,
  result: appResultSchema,
});
export type McpAppToolDisplay = z.infer<typeof mcpAppToolDisplaySchema>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function readMcpAppResourceUri(meta: unknown): string | undefined {
  const root = record(meta);
  const candidate =
    record(root.ui).resourceUri ?? root["ui/resourceUri"] ?? root["openai/outputTemplate"];
  return typeof candidate === "string" && candidate.startsWith("ui://") && candidate.length <= 2048
    ? candidate
    : undefined;
}

function origins(value: unknown): string[] {
  return (Array.isArray(value) ? value.slice(0, 50) : []).flatMap((item) => {
    if (typeof item !== "string") return [];
    try {
      const url = new URL(item);
      return ["https:", "http:"].includes(url.protocol) &&
        url.origin === item &&
        !url.username &&
        !url.password
        ? [url.origin]
        : [];
    } catch {
      return [];
    }
  });
}

export function readMcpAppResource(uri: string, response: unknown): McpAppResource | null {
  const contents = record(response).contents;
  if (!uri.startsWith("ui://") || !Array.isArray(contents)) return null;
  for (const raw of contents) {
    const item = record(raw);
    if (
      item.uri !== uri ||
      typeof item.text !== "string" ||
      new TextEncoder().encode(item.text).byteLength > MCP_APP_MAX_HTML ||
      typeof item.mimeType !== "string" ||
      !/^text\/html(?:\s*;\s*profile=(?:mcp-app|"mcp-app"))?$/iu.test(item.mimeType)
    )
      continue;
    const csp = record(record(record(item._meta).ui).csp);
    return {
      resourceUri: uri,
      ...(typeof record(record(item._meta).ui).backgroundRetention === "boolean"
        ? { backgroundRetention: record(record(item._meta).ui).backgroundRetention as boolean }
        : {}),
      html: item.text,
      connectDomains: origins(csp.connectDomains),
      resourceDomains: origins(csp.resourceDomains),
    };
  }
  return null;
}

export function readMcpAppFromOutput(output: unknown): McpAppResource | null {
  const parsed = mcpAppResourceSchema.safeParse(record(record(output)._meta)[MCP_APP_META_KEY]);
  return parsed.success
    ? {
        ...parsed.data,
        connectDomains: origins(parsed.data.connectDomains),
        resourceDomains: origins(parsed.data.resourceDomains),
      }
    : null;
}

export function readMcpAppToolDisplay(output: unknown): McpAppToolDisplay | null {
  const resource = readMcpAppFromOutput(output);
  if (!resource) return null;
  // 展示通道只保留这次工具的公开结果，不把任意 metadata 或模型预算复制成第二套状态。
  const parsed = mcpAppToolDisplaySchema.safeParse({ resource, result: record(output) });
  return parsed.success ? parsed.data : null;
}

export function buildMcpAppDocument(app: McpAppResource): string {
  const resources = origins(app.resourceDomains).join(" ");
  const connects = origins(app.connectDomains).join(" ");
  const policy = `default-src 'none'; script-src 'unsafe-inline' ${resources}; style-src 'unsafe-inline' ${resources}; img-src data: blob: ${resources}; font-src data: ${resources}; connect-src ${connects || "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // CSP 必须放在插件 HTML 之前；origin 经严格规范化，不能通过引号注入额外指令。
  // opaque iframe 不继承宿主主题媒体查询；用同一 host-context 消息更新默认样式，避免重载丢失 App 状态。
  const themeBridge = `<script>(()=>{const defaults=document.currentScript.previousElementSibling;addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0'||event.data?.method!=='ui/notifications/host-context-changed')return;const theme=event.data.params?.theme;if(theme==='light'||theme==='dark')defaults.textContent=':root{color-scheme:'+theme+'}body{color:CanvasText;background:Canvas}';});})();</script>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>:root{color-scheme:light}body{color:CanvasText;background:Canvas}</style>${themeBridge}${app.html}`;
}
