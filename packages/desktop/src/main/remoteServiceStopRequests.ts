import { randomUUID } from "node:crypto";
import { HostMessageTypes, type HostRemoteWorkspaceServiceStopResultResponse } from "@zcode/shared";

interface Host {
  postMessage(message: unknown): void;
}

/** Main 仅拥有请求关联，停止与连接状态仍由 Host registry 拥有。 */
export function createRemoteServiceStopRequests(timeoutMs = 30_000) {
  const pending = new Map<
    string,
    {
      host: Host;
      sessionId: string;
      finish(error?: Error): void;
    }
  >();
  return {
    send(host: Host, sessionId: string): Promise<void> {
      const requestId = randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("Remote service stop timed out")),
          timeoutMs,
        );
        function finish(error?: Error) {
          if (!pending.delete(requestId)) return;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        }
        pending.set(requestId, { host, sessionId, finish });
        try {
          host.postMessage({
            type: HostMessageTypes.DisposeRemoteWorkspaceSession,
            requestId,
            remoteSessionId: sessionId,
            stopService: true,
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    receive(host: Host, result: HostRemoteWorkspaceServiceStopResultResponse): boolean {
      const request = pending.get(result.requestId);
      // 旧 Host 或错误 session 的响应不能确认当前窗口的新请求。
      if (!request || request.host !== host || request.sessionId !== result.remoteSessionId)
        return false;
      request.finish(result.result.ok ? undefined : new Error(result.result.error));
      return true;
    },
    rejectHost(host: Host, error = new Error("Window Host unavailable")) {
      for (const request of pending.values()) if (request.host === host) request.finish(error);
    },
  };
}
