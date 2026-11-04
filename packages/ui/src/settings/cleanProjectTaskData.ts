import type { IServiceAccessor } from "@zcode/services";

type Target = { workspacePath: string; workspaceIdentity?: string };
/** 清理只复用 Host 的 purge admission；UI 不碰源码和代理私有目录。 */
export async function cleanProjectTaskData(
  services: Pick<IServiceAccessor, "zcodeTaskService" | "zcodeAgentService">,
  target: Target,
) {
  const service = services.zcodeTaskService;
  const [tasks, pinned, archived] = await Promise.all([
    service.listTasks(target),
    service.listPinnedTasks(target),
    service.listArchivedTasks(target),
  ]);
  const active = [...new Map([...tasks, ...pinned].map((task) => [task.taskId, task])).values()];
  const taskIds = [...new Set([...active, ...archived].map((task) => task.taskId))];
  // 索引不持有实时运行状态；先向 session owner 查询，不能把运行中的会话先归档再发现 busy。
  for (let offset = 0; offset < taskIds.length; offset += 100) {
    const sessions = await services.zcodeAgentService.listSessions({
      ...target,
      includeArchived: true,
      sessionIds: taskIds.slice(offset, offset + 100),
      limit: 100,
    });
    if (sessions.some((session) => session.status === "running" || session.status === "waiting"))
      throw new Error("Project contains running sessions; stop them before cleaning data");
  }
  const newlyArchived: string[] = [];
  try {
    for (const task of active) {
      await service.archiveTask({ ...target, taskId: task.taskId });
      newlyArchived.push(task.taskId);
    }
    const result = await service.deleteArchivedTasks({ ...target, taskIds });
    const deleted = new Set(result.deletedTaskIds);
    // 已成功 purge 的任务不能参与失败回滚，否则恢复索引会产生没有会话的数据。
    for (let index = newlyArchived.length - 1; index >= 0; index -= 1) {
      if (deleted.has(newlyArchived[index]!)) newlyArchived.splice(index, 1);
    }
    // 预检和 purge 间仍可能启动任务，最终 busy guard 为准；保留失败项原 membership。
    for (const id of newlyArchived) await service.unarchiveTask({ ...target, taskId: id });
    newlyArchived.length = 0;
    if (result.failedTaskIds.length || result.skippedTaskIds.length)
      throw new Error(
        `${result.failedTaskIds.length + result.skippedTaskIds.length} sessions could not be cleaned`,
      );
  } catch (error) {
    await Promise.allSettled(
      newlyArchived.map((taskId) => service.unarchiveTask({ ...target, taskId })),
    );
    throw error;
  }
}
