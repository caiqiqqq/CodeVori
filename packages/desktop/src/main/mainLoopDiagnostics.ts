import { OperationDiagnostics } from "@zcode/rpc";

interface Logger {
  warn(...args: unknown[]): void;
}
const exceptionTrackers = new WeakMap<Logger, OperationDiagnostics>();

export function reportMainException(
  logger: Logger,
  kind: "uncaught-exception" | "unhandled-rejection",
  error: unknown,
): void {
  let tracker = exceptionTrackers.get(logger);
  if (!tracker) {
    tracker = new OperationDiagnostics((record) => logger.warn("[diagnostics]", record), {
      scope: "main-error",
    });
    exceptionTrackers.set(logger, tracker);
  }
  tracker.event(`main.${kind}`, {}, error);
}

/** 只观察主进程 timer 延迟；不能将这个读数直接解释为 CPU 饱和或根因。 */
export function startMainLoopDiagnostics(logger: Logger): () => void {
  const diagnostics = new OperationDiagnostics((record) => logger.warn("[diagnostics]", record), {
    scope: "main-loop",
  });
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const delayMs = Math.max(0, now - previous - 1000);
    previous = now;
    if (delayMs >= 250)
      diagnostics.event("main.event-loop-delay", { delayMs: Math.round(delayMs) });
  }, 1000);
  timer.unref();
  // Monitor 只观察，不改变 Node 的致命异常默认退出行为。
  const onException = (error: Error) => reportMainException(logger, "uncaught-exception", error);
  process.on("uncaughtExceptionMonitor", onException);
  return () => {
    clearInterval(timer);
    diagnostics.dispose();
    process.removeListener("uncaughtExceptionMonitor", onException);
  };
}
