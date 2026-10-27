import { createContext } from "react";
import { PluginPageRetention, type RetainedPluginPage } from "@/lib/pluginPageRetention.js";

export interface McpAppPage extends RetainedPluginPage {
  disposed: boolean;
  retainable: boolean;
  frame: HTMLIFrameElement;
  initialized: boolean;
  ready: boolean;
  height: number;
  source: string;
}
export const McpAppScopeContext = createContext<string | null>(null);
const pages = new Map<string, McpAppPage>();
const retention = new PluginPageRetention();
let parking: HTMLDivElement | undefined;
function parkingRoot() {
  if (!parking) {
    parking = document.createElement("div");
    parking.hidden = true;
    parking.dataset.mcpAppParking = "";
    document.body.append(parking);
  }
  return parking;
}

function move(frame: HTMLIFrameElement, target: HTMLElement) {
  // moveBefore 保持 iframe 的 browsing context；普通 append 会触发导航并丢掉查看位置。
  if (target.moveBefore && frame.isConnected && target.isConnected) target.moveBefore(frame, null);
  else target.append(frame);
}

export function acquireMcpAppPage(
  key: string | undefined,
  source: string,
  backgroundRetention: boolean,
): McpAppPage {
  let cached = key ? pages.get(key) : undefined;
  // 同一结果在两个 pane 同时展示时，不能把仍可见的 iframe 从另一 pane 偷走。
  if (cached?.visible) {
    key = undefined;
    cached = undefined;
  }
  if (cached?.source === source) return cached;
  if (cached) retention.remove(cached);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; display-capture 'none'; usb 'none'; serial 'none'; hid 'none'; bluetooth 'none'",
  );
  frame.style.cssText = "height:320px;width:100%;border:0";
  frame.srcdoc = source;
  const page: McpAppPage = {
    disposed: false,
    retainable: Boolean(key),
    frame,
    source,
    initialized: false,
    ready: false,
    height: 320,
    visible: true,
    busy: false,
    backgroundRetention,
    dispose() {
      page.disposed = true;
      frame.remove();
      if (key && pages.get(key) === page) pages.delete(key);
    },
  };
  retention.add(page);
  if (key) pages.set(key, page);
  return page;
}

export function attachMcpAppPage(page: McpAppPage, target: HTMLElement) {
  if (page.disposed) return;
  page.visible = true;
  move(page.frame, target);
  retention.activity(page);
}

export function detachMcpAppPage(page: McpAppPage, retain: boolean) {
  if (page.disposed) return;
  if (!retain || !page.retainable || typeof parkingRoot().moveBefore !== "function") {
    // 不支持保持浏览上下文的移动时直接释放，不能声称重载后的 iframe 保留了状态。
    retention.remove(page);
    return;
  }
  page.visible = false;
  move(page.frame, parkingRoot());
  retention.activity(page);
}

export function updateMcpAppPage(page: McpAppPage, busy: boolean) {
  page.busy = busy;
  retention.changed();
}

export function clearMcpAppPages() {
  retention.clear();
  pages.clear();
  parking?.remove();
  parking = undefined;
}

if (typeof window !== "undefined") {
  retention.setWindowVisible(!document.hidden);
  window.addEventListener("beforeunload", clearMcpAppPages);
  document.addEventListener("visibilitychange", () => retention.setWindowVisible(!document.hidden));
}
