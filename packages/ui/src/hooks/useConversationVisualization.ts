import { useEffect, useState } from "react";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { readConversationVisualization } from "@/hooks/conversationVisualizationReader.js";
import { logger } from "@/logger.js";

export interface ConversationVisualizationScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  sessionId?: string;
}

export function useConversationVisualization(scope: ConversationVisualizationScope, path: string) {
  const { services, rpcReady, remoteSessionId } = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.workspaceRemoteSessionId,
    scope.workspaceIdentity,
    undefined,
    true,
  );
  const files = services.fileService;
  const [generation, setGeneration] = useState(0);
  const key = JSON.stringify([
    scope.workspaceIdentity?.trim() || scope.workspacePath,
    scope.workspacePath,
    remoteSessionId,
    scope.sessionId,
    path,
    generation,
  ]);
  const [result, setResult] = useState<{
    key: string;
    files: typeof files;
    content: string | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!rpcReady) return;
    const controller = new AbortController();
    void readConversationVisualization(files, scope.workspacePath, path, controller.signal).then(
      (content) => {
        if (!controller.signal.aborted) setResult({ key, files, content, failed: false });
      },
      () => {
        if (controller.signal.aborted) return;
        logger.warn("[ConversationVisualization] 无法读取当前工作区的可视化文件");
        setResult({ key, files, content: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [files, key, path, rpcReady, scope.workspacePath]);
  // 修复原因：effect 清理发生在提交后；渲染时就按 scope/service 隔离，避免旧 Host 内容闪现。
  const current = rpcReady && result?.key === key && result.files === files ? result : null;
  return {
    content: current?.content ?? null,
    failed: current?.failed ?? !rpcReady,
    retry: () => setGeneration((value) => value + 1),
  };
}
