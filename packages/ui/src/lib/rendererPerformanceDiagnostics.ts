import { OperationDiagnostics, type OperationDiagnostic } from "@zcode/rpc";
import { logger } from "@/logger.js";

const exceptions = new OperationDiagnostics(
  (record) => logger.lifecycle.error("[diagnostics]", record),
  { scope: "renderer-error" },
);

export function reportRendererException(
  source: "global-error" | "unhandled-rejection" | "react-root" | "react-scoped",
  error: unknown,
): void {
  exceptions.event(`renderer.${source}`, {}, error);
}

interface Options {
  now?: () => number;
  visible?: () => boolean;
  schedule?: (tick: () => void) => () => void;
  observe?: (record: (durationMs: number) => void) => () => void;
  listenVisibility?: (reset: () => void) => () => void;
  write?: (record: OperationDiagnostic) => void;
}

/** 单一低频观察器，不订阅消息流、不读取 DOM、不写 React/store 状态。 */
export function startRendererPerformanceDiagnostics(options: Options = {}): { stop(): void } {
  if (typeof window === "undefined" && !options.schedule) return { stop() {} };
  const now = options.now ?? (() => performance.now());
  const visible = options.visible ?? (() => document.visibilityState === "visible");
  const diagnostics = new OperationDiagnostics(
    options.write ?? ((record) => logger.lifecycle.warn("[diagnostics]", record)),
    { scope: "renderer-loop", now, schedule: false },
  );
  const cleanup: Array<() => void> = [];
  let lastTick = now();
  let lastReport = lastTick;
  let longTaskCount = 0,
    longTaskMaxMs = 0,
    longTaskTotalMs = 0,
    loopDelayCount = 0,
    loopDelayMaxMs = 0;
  const reset = () => {
    lastTick = now();
    lastReport = lastTick;
    longTaskCount = 0;
    longTaskMaxMs = 0;
    longTaskTotalMs = 0;
    loopDelayCount = 0;
    loopDelayMaxMs = 0;
  };
  const addLongTask = (durationMs: number) => {
    if (!visible() || !Number.isFinite(durationMs) || durationMs < 200) return;
    longTaskCount++;
    longTaskMaxMs = Math.max(longTaskMaxMs, durationMs);
    longTaskTotalMs += durationMs;
  };
  const tick = () => {
    const current = now();
    if (!visible()) {
      reset();
      return;
    }
    const delay = Math.max(0, current - lastTick - 1000);
    lastTick = current;
    if (delay >= 250) {
      loopDelayCount++;
      loopDelayMaxMs = Math.max(loopDelayMaxMs, delay);
    }
    if (current - lastReport < 10000) return;
    if (longTaskCount || loopDelayCount)
      diagnostics.event("renderer.long-task-window", {
        windowMs: Math.round(current - lastReport),
        longTaskCount,
        longTaskMaxMs: Math.round(longTaskMaxMs),
        longTaskTotalMs: Math.round(longTaskTotalMs),
        loopDelayCount,
        loopDelayMaxMs: Math.round(loopDelayMaxMs),
      });
    reset();
  };
  // 修复依据：不支持 PerformanceObserver 或采集入口失败时仍保留原页面与错误处理。
  for (const install of [
    () => (options.schedule ?? scheduleTicks)(tick),
    () => (options.observe ?? observeLongTasks)(addLongTask),
    () => (options.listenVisibility ?? listenVisibility)(reset),
  ]) {
    try {
      cleanup.push(install());
    } catch {
      /* best effort */
    }
  }
  if (typeof window !== "undefined") {
    const onError = (event: ErrorEvent) => reportRendererException("global-error", event.error);
    const onRejection = (event: PromiseRejectionEvent) =>
      reportRendererException("unhandled-rejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    cleanup.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });
  }
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const close of cleanup) {
        try {
          close();
        } catch {
          /* best effort */
        }
      }
      diagnostics.dispose();
    },
  };
}

function scheduleTicks(tick: () => void): () => void {
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
function observeLongTasks(record: (duration: number) => void): () => void {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  )
    return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries().slice(0, 100)) record(entry.duration);
  });
  observer.observe({ type: "longtask", buffered: false });
  return () => observer.disconnect();
}
function listenVisibility(reset: () => void): () => void {
  document.addEventListener("visibilitychange", reset);
  return () => document.removeEventListener("visibilitychange", reset);
}
