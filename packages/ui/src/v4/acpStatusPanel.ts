import type { AcpSession } from "@zcode/shared";
import type { PlanState } from "@zcode/shared/zcode-protocol-v4";

/** Host facts only; native GoalState/commands cannot be inferred from ACP objective text. */
export function projectAcpStatusPanel(session: AcpSession | null) {
  const entries = session?.entries ?? [];
  const lastUser = entries.findLastIndex((entry) => entry.kind === "user");
  const latestPlan = entries
    .slice(Math.max(0, lastUser))
    .findLast((entry) => entry.kind === "plan");
  const plan: PlanState | null =
    latestPlan?.kind === "plan" && latestPlan.entries.length
      ? {
          updatedAt: latestPlan.createdAt ?? 0,
          items: latestPlan.entries.map((step, index) => ({
            id: `${latestPlan.id}:${index}`,
            content: step.content,
            status: step.status === "in_progress" ? "inProgress" : step.status,
          })),
        }
      : null;
  // 修复原因：ACP 原生目标只是一段已保存文本，不能伪造 API 验证/迭代与暂停状态。
  return {
    reportedGoal: session?.goal?.trim() || null,
    plan,
    workflowRuns: session?.workflowRuns?.runs,
  };
}
