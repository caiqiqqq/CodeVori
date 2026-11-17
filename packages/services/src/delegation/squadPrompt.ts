import type { DelegationTask } from "@zcode/shared";

export function squadPrompt(task: DelegationTask): string {
  const squad = task.squad;
  if (!squad) return "";
  if (squad.role === "member")
    return `\n你是小队「${squad.squadName}」的成员 ${squad.name}。\n${squad.instructions}\n只处理明确分配的子任务，不再委派其他智能体。`;
  return `\n你是小队「${squad.definition.name}」的队长 ${squad.definition.leader.name}。\n${squad.definition.leader.instructions ?? ""}\n队长职责：${squad.definition.leader.role}\n小队指令：${squad.definition.instructions}\n可用成员：${JSON.stringify(squad.definition.members)}\n你只负责分工和汇总，不亲自修改项目。先调用 ListDelegationAgents 获取本次小队成员目录，再调用 DelegateTask，以 squadMemberId 和目录中的完整 execution 选择成员；仅传必要背景、职责、文件和明确目标，不复制整个历史。成员任务范围为 ${squad.memberIntent}，不得升级。无需调用所有成员；同一模型的不同角色通过 squadMemberId 区分。修改任务使用各自独立工作树，不自动合并；需要审查成员产物时显式传递它的工作树路径与结果。\n用 WaitDelegationTask / GetDelegationTask 等待所有已派成员结束后，汇总结论、changedFiles、tests、risks、blockers。成员回传后只汇总，不追加返工、提交、合并或推送。存在失败/阻塞时如实说明，不声称整体目标已完成。所有成员结束前不要退出队长运行或提交最终结果。`;
}
