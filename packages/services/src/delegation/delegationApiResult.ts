import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";

export async function readDelegationApiAnswer(
  agent: Pick<IZCodeAgentService, "conversationRowsRangeV4">,
  workspacePath: string,
  sessionId: string,
  commandId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  let beforeRowId: number | undefined;
  let version: { revision: number; epoch: string } | undefined;
  const answers = new Map<string, string>();
  while (true) {
    signal.throwIfAborted();
    const page = await agent.conversationRowsRangeV4({
      workspacePath,
      sessionId,
      beforeRowId,
      limit: 200,
    });
    signal.throwIfAborted();
    if (version && (version.revision !== page.atRevision || version.epoch !== page.atLogEpoch))
      throw new Error("delegation.result-changed");
    version ??= { revision: page.atRevision, epoch: page.atLogEpoch };
    // 终态通知不等于流式尾窗已包含回答；读取权威行，并按 commandId/turnId 排除旧轮次。
    for (const row of page.rows.toReversed()) {
      if (
        row.kind === "assistantText" &&
        row.state === "complete" &&
        row.text.trim() &&
        !answers.has(row.turnId)
      )
        answers.set(row.turnId, row.text);
      if (
        (row.kind === "turnHeader" || row.kind === "userInput") &&
        row.sourceCommandId === commandId
      )
        return answers.get(row.turnId);
    }
    if (!page.hasMore) return undefined;
    const next = page.rows[0]?.rowId;
    if (next === undefined || (beforeRowId !== undefined && next >= beforeRowId))
      throw new Error("delegation.result-pagination-invalid");
    beforeRowId = next;
  }
}
