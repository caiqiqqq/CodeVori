import { PluginPageCapacityError } from "@/lib/pluginPageRetention.js";
import {
  McpAppScopeContext,
  acquireMcpAppPage,
  attachMcpAppPage,
  detachMcpAppPage,
  updateMcpAppPage,
  type McpAppPage,
} from "@/ToolCallBlocks/mcpAppPages.js";
import { useEffect, useMemo, useRef, useState, useLayoutEffect, useContext } from "react";
import { buildMcpAppDocument, readMcpAppFromOutput } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function McpAppFrame({
  output,
  input,
  onOpenBrowserUrl,
  instanceId,
  busy = false,
}: {
  instanceId?: string;
  busy?: boolean;
  output: unknown;
  input: unknown;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  const scope = useContext(McpAppScopeContext);
  const app = useMemo(() => readMcpAppFromOutput(output), [output]);
  // 每份资源对应独立 frame；旧 frame 的 ready 或回复不能进入新 App。
  const source = app ? buildMcpAppDocument(app) : null;
  return app && source ? (
    <AppFrame
      key={`${scope}\u0000${instanceId}\u0000${app.resourceUri}\u0000${source}`}
      instanceKey={
        scope && instanceId ? JSON.stringify([scope, instanceId, app.resourceUri]) : undefined
      }
      backgroundRetention={app.backgroundRetention === true}
      busy={busy}
      document={source}
      output={output}
      input={input}
      onOpenBrowserUrl={onOpenBrowserUrl}
    />
  ) : null;
}

function AppFrame({
  document: sourceDocument,
  instanceKey,
  backgroundRetention,
  busy,
  output,
  input,
  onOpenBrowserUrl,
}: {
  document: string;
  instanceKey?: string;
  backgroundRetention: boolean;
  busy: boolean;
  output: unknown;
  input: unknown;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const frame = useRef<HTMLIFrameElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [capacityError, setCapacityError] = useState(false);
  const [page, setPage] = useState<McpAppPage | null>(null);
  useLayoutEffect(() => {
    if (!slot.current) return;
    let entry: McpAppPage;
    try {
      entry = acquireMcpAppPage(instanceKey, sourceDocument, backgroundRetention);
    } catch (error) {
      if (!(error instanceof PluginPageCapacityError)) throw error;
      setCapacityError(true);
      return;
    }
    setCapacityError(false);
    frame.current = entry.frame;
    entry.frame.title = intl.formatMessage({ id: "chat.mcpApp.title" });
    attachMcpAppPage(entry, slot.current);
    setPage(entry);
    setHeight(entry.height);
    return () => {
      detachMcpAppPage(entry, Boolean(instanceKey));
      frame.current = null;
    };
  }, [instanceKey, sourceDocument, backgroundRetention, intl]);
  useLayoutEffect(() => {
    if (page) updateMcpAppPage(page, busy);
  }, [page, busy]);
  const [height, setHeight] = useState(320);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!page) return;
    const send = (value: unknown) => frame.current?.contentWindow?.postMessage(value, "*");
    const hostContext = () => ({
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      locale,
      displayMode: "inline",
      containerDimensions: { width: frame.current?.clientWidth ?? 0, maxHeight: 900 },
    });
    const notify = () => {
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: input ?? {} },
      });
      const result =
        output && typeof output === "object" ? (output as Record<string, unknown>) : {};
      // 只给 App 自己这次的结果，宿主加载用的 HTML 不再通过结果重复发送。
      const { _meta, ...rest } = result;
      const metadata =
        _meta && typeof _meta === "object" ? { ...(_meta as Record<string, unknown>) } : {};
      delete metadata["zcode/mcpApp"];
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { ...rest, _meta: metadata },
      });
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: hostContext(),
      });
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const value = event.data;
      if (
        !value ||
        typeof value !== "object" ||
        value.jsonrpc !== "2.0" ||
        typeof value.method !== "string"
      )
        return;
      const request =
        typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id));
      const reply = (result: unknown) => {
        if (request) send({ jsonrpc: "2.0", id: value.id, result });
      };
      const reject = (code: number, message: string) => {
        if (request) send({ jsonrpc: "2.0", id: value.id, error: { code, message } });
      };
      if (value.method === "ui/initialize") {
        page.initialized = true;
        reply({
          protocolVersion: "2026-01-26",
          hostInfo: { name: "CodeVori", version: "1.0.0" },
          hostCapabilities: { openLinks: {}, supportedDisplayModes: ["inline"] },
          hostContext: hostContext(),
        });
        return;
      }
      if (!page.initialized) {
        reject(-32000, "App is not initialized");
        return;
      }
      if (value.method === "ui/notifications/initialized") {
        page.ready = true;
        notify();
        return;
      }
      if (value.method === "ui/notifications/size-changed") {
        const next = value.params?.height;
        if (typeof next === "number" && Number.isFinite(next)) {
          page.height = Math.min(900, Math.max(64, Math.ceil(next)));
          page.frame.style.height = `${page.height}px`;
          setHeight(page.height);
        }
        return;
      }
      if (value.method === "ui/open-link") {
        try {
          const url = new URL(value.params?.url);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
            throw new Error("invalid URL");
          setLink(url.href);
          reply({ isError: false });
        } catch {
          reject(-32602, "Only HTTP(S) links are supported");
        }
        return;
      }
      if (value.method === "ui/request-display-mode") {
        reply({ mode: "inline" });
        return;
      }
      if (value.method === "ping") {
        reply({});
        return;
      }
      reject(-32601, "Host capability is not available");
    };
    window.addEventListener("message", receive);
    // 流式结果重新投影会产生新对象，不能把仍然运行的 iframe 重置成未初始化。
    if (page.ready) notify();
    const contextChanged = () => {
      if (page.ready)
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: hostContext(),
        });
    };
    contextChanged();
    const themeObserver = new MutationObserver(contextChanged);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const resizeObserver = new ResizeObserver(contextChanged);
    if (frame.current) resizeObserver.observe(frame.current);
    return () => {
      window.removeEventListener("message", receive);
      themeObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [input, output, locale, page]);
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid="mcp-app"
    >
      {capacityError ? (
        <p role="alert" className="p-3 text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "chat.mcpApp.capacity" })}
        </p>
      ) : null}
      <div ref={slot} style={{ height, width: "100%" }} />
      {link ? (
        <div className="break-all border-t border-border px-3 py-2 text-ui-base">
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
            onClick={
              onOpenBrowserUrl
                ? (event) => {
                    event.preventDefault();
                    onOpenBrowserUrl(link);
                    setLink(null);
                  }
                : undefined
            }
          >
            {intl.formatMessage({ id: "chat.mcpApp.openLink" })}: {link}
          </a>
        </div>
      ) : null}
    </section>
  );
}
