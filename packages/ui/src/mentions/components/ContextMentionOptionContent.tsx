import { MessagesSquare } from "lucide-react";
import { FileDisplayInline } from "@/lib/fileDisplay.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";

export function ContextMentionOptionContent({
  item,
  workspacePath,
  workspaceIdentity,
}: {
  item: MentionItem;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  return item.category === "files" ? (
    <FileDisplayInline
      path={item.data?.path ?? item.data?.relativePath ?? item.value}
      options={{
        basePath: workspacePath,
        // 这里只给 file/directory 传 kind，让 fileDisplay 继续按文件和文件夹图标渲染；
        // whiteboard 等非文件类候选不应该伪装成文件路径。
        kind:
          item.data?.kind === "file" || item.data?.kind === "directory"
            ? item.data.kind
            : undefined,
        showFilePath: true,
      }}
    />
  ) : (
    <span className="min-w-0 flex flex-1 items-center gap-2">
      {item.data?.acpAgent ? (
        <AcpAgentIcon agent={item.data.acpAgent} />
      ) : item.category === "subagents" && item.data?.providerId ? (
        <TaskAgentIcon
          providerId={item.data.providerId}
          task={{ workspacePath, workspaceIdentity }}
        />
      ) : (
        <MessagesSquare className="size-3.5 shrink-0 text-foreground" />
      )}
      <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
        {item.label}
      </span>
      <span className="min-w-0 truncate text-ui-xs text-foreground-subtlest">
        {item.description}
      </span>
    </span>
  );
}
