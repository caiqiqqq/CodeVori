import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { app, BrowserWindow, ipcMain, MessageChannelMain, type UtilityProcess } from "electron";
import { MessagePortProtocol, wrapNodeMessagePort } from "@zcode/rpc";
import { createDesktopLanGateway } from "@zcode/server";
import {
  HostMessageTypes,
  PlatformChannels,
  desktopLanAccessConfigurationSchema,
  type DesktopLanAccessConfiguration,
  type DesktopLanAccessState,
} from "@zcode/shared";

/** Main 仅拥有监听器及 attachment 路由。不存在第二份 services/runtime。 */
export function registerDesktopLanAccess(options: {
  hosts: Map<number, UtilityProcess>;
  preference: {
    getEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
    getConfiguration(): Promise<DesktopLanAccessConfiguration | undefined>;
    setConfiguration(configuration: DesktopLanAccessConfiguration): Promise<void>;
  };
  credentials: {
    load(key: string): Promise<string | null>;
    save(key: string, value: string): Promise<void>;
  };
  onError: (error: unknown) => void;
}) {
  type Entry = {
    host: UtilityProcess;
    token: string;
    urls: string[];
    configuration: DesktopLanAccessConfiguration;
    gateway: Awaited<ReturnType<typeof createDesktopLanGateway>>;
    disposeLifecycle(): void;
  };
  const entries = new Map<number, Entry>();
  const flights = new Map<number, Promise<DesktopLanAccessState>>();
  const generations = new Map<number, number>();
  const restorations = new Map<
    number,
    { host: UtilityProcess | undefined; promise: Promise<void> }
  >();
  const lifetime = new AbortController();
  let restoreWindowId: number | undefined;
  let disposed = false;
  let operations: Promise<unknown> = Promise.resolve();
  // 恢复与手动开关共用入口，避免异步读取旧设置后重新打开已关闭的监听器。
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  };
  const disabled = (): DesktopLanAccessState => ({ enabled: false, urls: [] });
  const state = async (id: number): Promise<DesktopLanAccessState> => {
    const entry = entries.get(id);
    const configuration = entry?.configuration ?? (await options.preference.getConfiguration());
    return {
      ...(entry ? { enabled: true, urls: entry.urls, token: entry.token } : disabled()),
      configuration,
    };
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
    if (entries.has(id) && entries.get(id)!.host !== options.hosts.get(win.webContents.id)) {
      await stop(id);
    }
    if (entries.has(id)) return state(id);
    const existing = flights.get(id);
    if (existing) return existing;
    const generation = (generations.get(id) ?? 0) + 1;
    generations.set(id, generation);
    const flight = (async () => {
      const host = options.hosts.get(win.webContents.id);
      if (!host?.pid) throw new Error("Desktop Host is not ready");
      // 固定端口只能属于一个窗口 Host，不能让后打开的窗口抢占原手机连接。
      if ([...entries.keys()].some((entryId) => entryId !== id))
        throw new Error("LAN access is enabled in another window. Disable it there first.");
      const configuration = desktopLanAccessConfigurationSchema.parse(
        await options.preference.getConfiguration(),
      );
      const tokenKey = "desktop-lan-access-token-v1";
      let token = await options.credentials.load(tokenKey);
      if (token === null) {
        token = randomBytes(32).toString("base64url");
        await options.credentials.save(tokenKey, token);
      }
      // 不把凭据损坏当成首次配置；否则更新后悄悄换 Token 会让已配对手机全部失效。
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new Error("Invalid saved LAN access credential");
      const gateway = await createDesktopLanGateway({
        token,
        port: configuration.port,
        allowedHosts: ["127.0.0.1", "localhost", configuration.address],
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
        disposed ||
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
        configuration,
        urls: [`http://${configuration.address}:${configuration.port}`],
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
  const restoreWindow = async (win: BrowserWindow): Promise<void> => {
    if (disposed || win.isDestroyed()) return;
    // 只有首个主窗口自动恢复；窗口 id 只用于本进程路由，不作为持久化身份。
    restoreWindowId ??= win.id;
    if (restoreWindowId !== win.id) return;
    const host = options.hosts.get(win.webContents.id);
    if (!host) return;
    if (!host.pid) {
      // 生命周期回调早于 utilityProcess spawn；监听真实事件，不用超时猜测就绪。
      await new Promise<void>((resolve) => {
        const done = () => {
          host.off("spawn", done);
          host.off("exit", done);
          win.off("closed", done);
          lifetime.signal.removeEventListener("abort", done);
          resolve();
        };
        host.once("spawn", done);
        host.once("exit", done);
        win.once("closed", done);
        lifetime.signal.addEventListener("abort", done, { once: true });
      });
    }
    await enqueue(async () => {
      if (
        disposed ||
        win.isDestroyed() ||
        restoreWindowId !== win.id ||
        host !== options.hosts.get(win.webContents.id) ||
        !host.pid
      )
        return;
      if (
        !(await options.preference.getEnabled()) ||
        disposed ||
        win.isDestroyed() ||
        host !== options.hosts.get(win.webContents.id)
      )
        return;
      // 旧版本只保存开关；先让用户确认一次固定配置，不能用猜测的网卡/随机端口恢复。
      if (!(await options.preference.getConfiguration())) return;
      await start(win);
    });
  };
  const restore = (win: BrowserWindow): Promise<void> => {
    const current = restorations.get(win.id);
    const host = options.hosts.get(win.webContents.id);
    // Host 重建不能复用旧进程尚未完成的恢复，否则新的 spawn 通知会被吞掉。
    if (current && current.host === host) return current.promise;
    const pending = restoreWindow(win).finally(() => {
      if (restorations.get(win.id)?.promise === pending) restorations.delete(win.id);
    });
    restorations.set(win.id, { host, promise: pending });
    return pending;
  };
  ipcMain.handle(PlatformChannels.GetDesktopLanAccess, async (event) => {
    const win = senderWindow(event.sender);
    await restorations.get(win.id)?.promise;
    return enqueue(async () => state(win.id));
  });
  ipcMain.handle(PlatformChannels.SetDesktopLanAccessEnabled, async (event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid enabled value");
    const win = senderWindow(event.sender);
    return enqueue(async () => {
      if (disposed || win.isDestroyed()) throw new Error("Desktop window unavailable");
      if ([...entries.keys()].some((entryId) => entryId !== win.id))
        throw new Error("LAN access is enabled in another window. Disable it there first.");
      if (!enabled) {
        try {
          await options.preference.setEnabled(false);
        } finally {
          await stop(win.id);
        }
        return state(win.id);
      }
      const result = await start(win);
      if (!result.enabled) return result;
      try {
        await options.preference.setEnabled(true);
        restoreWindowId = win.id;
        return state(win.id);
      } catch (error) {
        await stop(win.id);
        throw error;
      }
    });
  });
  ipcMain.handle(
    PlatformChannels.SaveDesktopLanAccessConfiguration,
    async (event, input: unknown) => {
      const configuration = desktopLanAccessConfigurationSchema.parse(input);
      const win = senderWindow(event.sender);
      return enqueue(async () => {
        if (disposed || win.isDestroyed()) throw new Error("Desktop window unavailable");
        if (entries.size) throw new Error("Disable LAN access before changing its address or port");
        await options.preference.setConfiguration(configuration);
        return state(win.id);
      });
    },
  );
  const onQuit = () => {
    void dispose().catch(options.onError);
  };
  const dispose = async () => {
    disposed = true;
    lifetime.abort();
    app.off("will-quit", onQuit);
    ipcMain.removeHandler(PlatformChannels.GetDesktopLanAccess);
    ipcMain.removeHandler(PlatformChannels.SetDesktopLanAccessEnabled);
    ipcMain.removeHandler(PlatformChannels.SaveDesktopLanAccessConfiguration);
    await enqueue(async () => {
      await Promise.all([...new Set([...entries.keys(), ...flights.keys()])].map(stop));
    });
  };
  app.once("will-quit", onQuit);
  return { dispose, restore };
}
