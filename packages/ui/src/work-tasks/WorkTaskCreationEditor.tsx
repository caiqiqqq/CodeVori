import { useState } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { workTaskNavigationKey } from "@/store/workTaskNavigationStore.js";
import { WorkTaskEditor } from "./WorkTaskEditor.js";

export function WorkTaskCreationEditor({
  scope,
  projects,
  panel,
  onClose,
}: {
  scope: WorkTaskScope;
  projects?: readonly WorkspaceTabState[];
  panel: ReturnType<typeof useWorkTasks>;
  onClose(): void;
}) {
  const [projectKey, setProjectKey] = useState(() => workTaskNavigationKey(scope));
  const project = projects?.find((tab) => workTaskNavigationKey(tab) === projectKey) ?? scope;
  const target = panel.forScope(project);
  return (
    <WorkTaskEditor
      // 项目切换必须重建分支、配置与附件草稿，不能将旧项目输入提交给新 scope。
      key={workTaskNavigationKey(project)}
      scope={target.scope}
      task={null}
      projectOptions={projects}
      onProjectChange={setProjectKey}
      busy={target.busy}
      error={target.error}
      onClose={onClose}
      onSave={target.create}
    />
  );
}
