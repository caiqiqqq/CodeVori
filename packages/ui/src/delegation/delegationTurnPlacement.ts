/** 只定位展示位置；任务状态与轮次生命周期分别由服务和 CLI 持有。 */
export function partitionDelegationTasksByTurn<
  TTurn extends { turnId: string; startedAt?: number; header?: { endedAt?: number } },
  TTask extends { createdAt: number },
>(turns: readonly TTurn[], tasks: readonly TTask[]) {
  const byTurn = new Map<string, TTask[]>();
  const unmatched: TTask[] = [];
  const starts = turns
    .filter(
      (turn): turn is TTurn & { startedAt: number } =>
        typeof turn.startedAt === "number" && Number.isFinite(turn.startedAt) && turn.startedAt > 0,
    )
    .sort((left, right) => left.startedAt - right.startedAt);

  for (const task of tasks) {
    if (!Number.isFinite(task.createdAt)) {
      unmatched.push(task);
      continue;
    }
    // 修复原因：会话级 footer 会把旧委派拖到最新轮之后；按创建时已开始的轮次
    // 定位，下一轮到来后原位置不变。同毫秒出现多轮时无法证明归属，留在会话级列表。
    let candidate: (typeof starts)[number] | undefined;
    for (const turn of starts) {
      if (turn.startedAt > task.createdAt) break;
      candidate = turn;
    }
    if (
      !candidate ||
      (candidate.header?.endedAt !== undefined && task.createdAt >= candidate.header.endedAt) ||
      starts.filter((turn) => turn.startedAt === candidate.startedAt).length > 1
    ) {
      unmatched.push(task);
      continue;
    }
    const group = byTurn.get(candidate.turnId) ?? [];
    group.push(task);
    byTurn.set(candidate.turnId, group);
  }
  return { byTurn, unmatched };
}
