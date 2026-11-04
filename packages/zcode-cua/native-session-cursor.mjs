// 会话身份由运行时传入；原生 request scope 只包同步入队，异步 worker 自己拷贝 sid。
const SCOPED_METHODS = new Set([
  "clickAtPoint",
  "clickAtPointAsync",
  "clickElementAtPoint",
  "moveTo",
  "moveToPid",
  "scrollAt",
  "scrollToPid",
  "drag",
  "dragAsync",
  "dragToPid",
  "performAction",
  "setValue",
  "typeTextGlobal",
  "typeTextGlobalAsync",
  "pressKeyGlobal",
  "holdKeyGlobalAsync",
  "typeTextToPid",
  "pressKeyToPid",
  "elementPatternCallAsync",
  "hitTestInvokeAtPointAsync",
  "postMessageClickAsync",
  "postMessageDragAsync",
  "postMessageScrollAsync",
]);

export function createSessionCursor(native, fallbackId) {
  let sessionId,
    title,
    closed = false,
    enabled = false;
  const available = typeof native.ghostSetRequestSession === "function";
  return {
    bind(context = {}) {
      const requested = context.cursorSessionId?.trim() || fallbackId;
      if (closed || (sessionId && sessionId !== requested))
        throw new Error("Computer control cursor session changed or closed.");
      sessionId = requested;
      title =
        typeof context.actionTitle === "string"
          ? context.actionTitle.trim().slice(0, 160)
          : undefined;
    },
    native: new Proxy(native, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (!available || !SCOPED_METHODS.has(property) || typeof value !== "function")
          return value;
        return (...args) => {
          if (closed) throw new Error("Computer control cursor session closed.");
          if (!enabled) {
            native.ghostSetMultiCursorEnabled?.(true);
            native.ghostSetEnabled?.(true);
            enabled = true;
          }
          native.ghostSetRequestSession(sessionId ?? fallbackId);
          try {
            if (title) native.ghostBeginActionWithTitle?.(0, sessionId ?? fallbackId, title);
            return value.apply(target, args);
          } finally {
            native.ghostSetRequestSession(null);
          }
        };
      },
    }),
    close() {
      if (closed) return;
      closed = true;
      // 只清理自己的组；A 结束不能调用全局 ghostHide 把 B 一起隐藏。
      native.ghostRemoveSession?.(sessionId ?? fallbackId);
    },
  };
}
