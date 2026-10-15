import { randomBytes, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { app, BrowserWindow, ipcMain, MessageChannelMain, type UtilityProcess } from "electron";
import { MessagePortProtocol, wrapNodeMessagePort } from "@zcode/rpc";
import { createDesktopLanGateway } from "@zcode/server";
import { HostMessageTypes, PlatformChannels, type DesktopLanAccessState } from "@zcode/shared";

/** Main 仅拥有监听器及 attachment 路由。不存在第二份 services/runtime。 */
export function registerDesktopLanAccess(options: {
  hosts: Map<number, UtilityProcess>;
  onError: (error: unknown) => void;
}) {
  type Entry = {
    host: UtilityProcess;
    token: string;
    urls: string[];
    gateway: Awaited<ReturnType<typeof createDesktopLanGateway>>;
    disposeLifecycle(): void;
  };
  const entries = new Map<number, Entry>();
  const flights = new Map<number, Promise<DesktopLanAccessState>>();
  const generations = new Map<number, number>();
  const disabled = (): DesktopLanAccessState => ({ enabled: false, urls: [] });
  const state = (id: number): DesktopLanAccessState => {
    const entry = entries.get(id);
    return entry ? { enabled: true, urls: entry.urls, token: entry.token } : disabled();
  };
  const stop = async (id: number) => {
    generations.set(id, (generations.get(id) ?? 0) + 1);
    flights.delete(id);
    const entry = entries.get(id);
    entries.delete(id);
    if (entry) {
      entry.disposeLifecycle();
      await entry.gateway.close();
    }
  };
  async function start(win: BrowserWindow): Promise<DesktopLanAccessState> {
    const id = win.id;
    if (entries.has(id)) return state(id);
    const existing = flights.get(id);
    if (existing) return existing;
    const generation = (generations.get(id) ?? 0) + 1;
    generations.set(id, generation);
    const flight = (async () => {
      const host = options.hosts.get(win.webContents.id);
      if (!host?.pid) throw new Error("Desktop Host is not ready");
      const addresses = Object.values(networkInterfaces()).flatMap((items) =>
        (items ?? [])
          .filter((item) => item.family === "IPv4" && !item.internal)
          .map((item) => item.address),
      );
      const token = randomBytes(32).toString("base64url");
      const gateway = await createDesktopLanGateway({
        token,
        allowedHosts: ["127.0.0.1", "localhost", ...addresses],
        staticRoot: resolve(app.getAppPath(), app.isPackaged ? "out/web" : "../web/dist"),
        openAttachment(scope, onClose) {
          if (host !== options.hosts.get(win.webContents.id) || !host.pid)
            throw new Error("Desktop Host changed");
          const { port1, port2 } = new MessageChannelMain();
          const protocol = new MessagePortProtocol(wrapNodeMessagePort(port1));
          const attachmentId = randomUUID();
          let disposed = false;
          port1.once("close", onClose);
          try {
            host.postMessage(
              {
                type: HostMessageTypes.AttachServicePort,
                requestId: randomUUID(),
                attachmentId,
                clientMode: "web-remote-replayable",
                scope,
              },
              [port2],
            );
          } catch (error) {
            protocol.disconnect();
            port2.close();
            throw error;
          }
          return {
            protocol,
            dispose() {
              if (disposed) return;
              disposed = true;
              port1.off("close", onClose);
              protocol.disconnect();
              try {
                host.postMessage({ type: HostMessageTypes.DetachServicePort, attachmentId });
              } catch {
                /* Host 已退出；端口仍幂等关闭。 */
              }
            },
          };
        },
      });
      if (
        win.isDestroyed() ||
        host !== options.hosts.get(win.webContents.id) ||
        generation !== generations.get(id)
      ) {
        await gateway.close();
        return disabled();
      }
      const onStopped = () => {
        void stop(id).catch(options.onError);
      };
      // 每次关闭入口都移除本代监听，避免重复开关积累旧 Host/window 回调。
      entries.set(id, {
        host,
        token,
        gateway,
        urls: (addresses.length ? addresses : ["127.0.0.1"]).map(
          (address) => `http://${address}:${gateway.port}`,
        ),
        disposeLifecycle() {
          host.off("exit", onStopped);
          win.off("closed", onStopped);
        },
      });
      host.once("exit", onStopped);
      win.once("closed", onStopped);
      return state(id);
    })();
    flights.set(id, flight);
    try {
      return await flight;
    } finally {
      if (flights.get(id) === flight) flights.delete(id);
    }
  }
  const senderWindow = (sender: Electron.WebContents) => {
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) throw new Error("Desktop window unavailable");
    return win;
  };
  ipcMain.handle(PlatformChannels.GetDesktopLanAccess, (event) =>
    state(senderWindow(event.sender).id),
  );
  ipcMain.handle(PlatformChannels.SetDesktopLanAccessEnabled, async (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid enabled value");
    const win = senderWindow(event.sender);
    if (!enabled) {
      await stop(win.id);
      return disabled();
    }
    return start(win);
  });
  const dispose = async () => {
    ipcMain.removeHandler(PlatformChannels.GetDesktopLanAccess);
    ipcMain.removeHandler(PlatformChannels.SetDesktopLanAccessEnabled);
    await Promise.allSettled([...entries.keys(), ...flights.keys()].map(stop));
  };
  app.once("will-quit", () => {
    void dispose().catch(options.onError);
  });
  return { dispose };
}
