import { useEffect, useRef, useState } from "react";

export class DesktopReconnectError extends Error {
  constructor(
    message: string,
    readonly terminal = false,
  ) {
    super(message);
  }
}

export function DesktopReconnectScreen({
  reconnect,
}: {
  reconnect: (signal: AbortSignal) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef(() => {});
  const chinese = /^zh\b/i.test(navigator.language);
  useEffect(() => {
    let live = true;
    let attempts = 0;
    let pending = false;
    let terminal = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const available = () => document.visibilityState !== "hidden" && navigator.onLine;
    const schedule = () => {
      clearTimeout(timer);
      if (live && !terminal && !pending && attempts < 3 && available())
        timer = setTimeout(() => void attempt(), 1000 * 2 ** attempts);
    };
    const attempt = async () => {
      clearTimeout(timer);
      if (!live || pending || !available()) return;
      pending = true;
      attempts++;
      setBusy(true);
      try {
        await reconnect(controller.signal);
      } catch (error) {
        if (!live) return;
        terminal = error instanceof DesktopReconnectError && error.terminal;
        setMessage(
          terminal
            ? chinese
              ? "连接授权已失效，请在连接设置中重新连接电脑。"
              : "Access expired. Pair with your computer again in connection settings."
            : chinese
              ? "暂时无法连接，请确认电脑正在运行且处于同一网络。"
              : "Unable to connect. Check your computer and network.",
        );
      } finally {
        pending = false;
        if (live) {
          setBusy(false);
          schedule();
        }
      }
    };
    const resume = () => {
      // 只在断线页恢复；健康 Root 不刷新，连续前台/online 事件复用同一次重连。
      if (!available() || pending || terminal) return;
      attempts = 0;
      void attempt();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else resume();
    };
    retry.current = () => {
      terminal = false;
      resume();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", resume);
    window.addEventListener("zcode:resume", resume);
    schedule();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", resume);
      window.removeEventListener("zcode:resume", resume);
    };
  }, [reconnect, chinese]);

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-lg rounded-xl border border-card-border bg-card p-5">
        <h1 className="text-ui-base font-medium">
          {chinese ? "与电脑的连接已断开" : "Desktop disconnected"}
        </h1>
        <p role="status" className="mt-2 text-ui-xs text-foreground-subtle">
          {busy
            ? chinese
              ? "正在重新连接…"
              : "Reconnecting…"
            : message || (chinese ? "正在等待恢复连接…" : "Waiting to reconnect…")}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => retry.current()}
          className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs disabled:opacity-50"
        >
          {chinese ? "重试连接" : "Retry connection"}
        </button>
      </section>
    </div>
  );
}
