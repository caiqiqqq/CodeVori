import type { AcpDiagnosticEvent, AcpEntry, AcpSession, AcpUsageTurn } from "@zcode/shared";

export interface AcpTraceTool {
  entry: Extract<AcpEntry, { kind: "tool" }>;
  entryIndex: number;
  events: AcpDiagnosticEvent[];
  durationMs: number | null;
}
export interface AcpTraceTurn {
  index: number;
  entryIndex: number;
  user: Extract<AcpEntry, { kind: "user" }>;
  entries: AcpEntry[];
  events: AcpDiagnosticEvent[];
  tools: AcpTraceTool[];
  state: "running" | "completed" | "failed" | "stopped" | "unknown";
  durationMs: number | null;
  usage?: AcpUsageTurn;
  error?: string;
}

export function mergeAcpTraceEvents(
  current: readonly AcpDiagnosticEvent[],
  incoming: readonly AcpDiagnosticEvent[],
): AcpDiagnosticEvent[] {
  const events = new Map<string, AcpDiagnosticEvent>();
  for (const batch of [current, incoming]) {
    const legacyCounts = new Map<string, number>();
    for (const event of batch) {
      let key = event.eventId;
      if (!key) {
        // 旧日志在同一毫秒可能有相同状态的不同调用；按批次出现次数合并，不能误删事实。
        const value = JSON.stringify(event);
        const count = (legacyCounts.get(value) ?? 0) + 1;
        legacyCounts.set(value, count);
        key = `${value}:${count}`;
      }
      events.set(key, event);
    }
  }
  return [...events.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-500);
}

export function buildAcpExecutionTrace(
  session: AcpSession | null,
  events: readonly AcpDiagnosticEvent[],
) {
  const turns: AcpTraceTurn[] = [];
  const uncorrelatedEvents: AcpDiagnosticEvent[] = [];
  if (!session) return { turns, uncorrelatedEvents: [...events] };
  const byTurn = new Map<number, AcpDiagnosticEvent[]>();
  for (const event of events) {
    // 旧事件无 row 索引，不能按相近时间猜轮次；其它 actor 的事实同样独立呈现。
    if (event.turnIndex === undefined || session.entries[event.turnIndex]?.kind !== "user") {
      uncorrelatedEvents.push(event);
      continue;
    }
    const list = byTurn.get(event.turnIndex) ?? [];
    list.push(event);
    byTurn.set(event.turnIndex, list);
  }
  const lastUserIndex = session.entries.findLastIndex((entry) => entry.kind === "user");
  for (let entryIndex = 0; entryIndex < session.entries.length; entryIndex++) {
    const user = session.entries[entryIndex];
    if (user?.kind !== "user") continue;
    const end = session.entries.findIndex(
      (entry, index) => index > entryIndex && entry.kind === "user",
    );
    const entries = session.entries.slice(entryIndex + 1, end < 0 ? undefined : end);
    const turnEvents = byTurn.get(entryIndex) ?? [];
    const accepted = turnEvents.find((event) => event.kind === "prompt-accepted");
    const terminal = turnEvents.findLast((event) =>
      ["turn-completed", "turn-interrupted", "turn-stopped", "adapter-exited"].includes(event.kind),
    );
    const tools: AcpTraceTool[] = [];
    for (const [offset, entry] of entries.entries()) {
      if (entry.kind !== "tool") continue;
      const index = entryIndex + offset + 1;
      const toolEvents = turnEvents.filter((event) => event.entryIndex === index);
      const start = toolEvents.find(
        (event) =>
          event.kind === "tool-update" && ["pending", "in_progress"].includes(event.status ?? ""),
      );
      const finish = toolEvents.findLast(
        (event) =>
          event.kind === "tool-update" && ["completed", "failed"].includes(event.status ?? ""),
      );
      tools.push({
        entry,
        entryIndex: index,
        events: toolEvents,
        durationMs: start && finish ? Math.max(0, finish.timestamp - start.timestamp) : null,
      });
    }
    const error =
      user.traceError ??
      (entryIndex === lastUserIndex && session.status === "interrupted"
        ? (session.error ?? undefined)
        : undefined);
    const state =
      terminal?.kind === "turn-stopped" || terminal?.stopReason === "cancelled"
        ? "stopped"
        : error ||
            terminal?.kind === "turn-interrupted" ||
            terminal?.kind === "adapter-exited" ||
            terminal?.stopReason === "refusal"
          ? "failed"
          : terminal?.kind === "turn-completed"
            ? "completed"
            : entryIndex === lastUserIndex && session.status === "running"
              ? "running"
              : "unknown";
    turns.push({
      index: turns.length + 1,
      entryIndex,
      user,
      entries,
      events: turnEvents,
      tools,
      state,
      durationMs:
        accepted && terminal ? Math.max(0, terminal.timestamp - accepted.timestamp) : null,
      usage: session.usageTurns.find((usage) => user.id === `user:${usage.commandId}`),
      error,
    });
  }
  return { turns, uncorrelatedEvents };
}

export function filterAcpTraceTurns(
  turns: readonly AcpTraceTurn[],
  query: string,
  failedOnly: boolean,
) {
  const needle = query.trim().toLocaleLowerCase();
  return turns.filter((turn) => {
    if (
      failedOnly &&
      turn.state !== "failed" &&
      !turn.tools.some(({ entry }) => entry.status === "failed")
    )
      return false;
    if (!needle) return true;
    const text = [
      turn.user.text,
      turn.error,
      ...turn.entries.flatMap((entry) =>
        entry.kind === "assistant"
          ? [entry.text]
          : entry.kind === "tool"
            ? [entry.title, entry.toolName, entry.input, entry.output, entry.content]
            : [],
      ),
    ]
      .filter(Boolean)
      .join("\n");
    return text.toLocaleLowerCase().includes(needle);
  });
}
