import { acpSessionFailureSchema, type AcpSessionFailure, type AcpSession } from "@zcode/shared";

/** Only native-session restore failures may trigger empty-session replacement in the Host. */
export class AcpSessionLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "AcpSessionLoadError";
  }
}

const MAX_TEXT = 32_000;
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Codex AIR extension is explicitly versioned; other arbitrary metadata is not an error. */
export function projectAcpSessionFailure(meta: unknown): AcpSessionFailure | undefined {
  const air = object(object(object(meta)?.jetbrains)?.air);
  if (typeof air?.version !== "number" || !Number.isInteger(air.version) || air.version < 1)
    return undefined;
  const raw = object(air.sessionFailure);
  if (!raw) return undefined;
  const parsed = acpSessionFailureSchema.safeParse({
    ...raw,
    title: typeof raw.title === "string" ? raw.title.slice(0, MAX_TEXT) : raw.title,
    ...(typeof raw.details === "string" ? { details: raw.details.slice(0, MAX_TEXT) } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

export function failureFromAcpError(error: unknown, commandId: string): AcpSessionFailure {
  const record = object(error);
  const data = object(record?.data);
  const typed = projectAcpSessionFailure(data?._meta) ?? projectAcpSessionFailure(data);
  if (typed?.severity === "error") return typed;
  // 修复原因：JSON-RPC 的可读根因可位于 data.details，不能只显示通用 Internal error。
  const message = [
    data?.message,
    data?.details,
    object(data?.error)?.message,
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
  ].find((value) => typeof value === "string" && value.trim());
  return {
    id: `rpc:${commandId.slice(0, 508)}`,
    revision: 1,
    severity: "error",
    category: "unknown",
    title: typeof message === "string" ? message.slice(0, MAX_TEXT) : "ACP request failed",
    actions: [],
  };
}

export function recordAcpSessionFailure(
  session: AcpSession,
  commandId: string,
  failure: AcpSessionFailure,
): boolean {
  const user = session.entries.find(
    (entry) => entry.kind === "user" && entry.id === `user:${commandId}`,
  );
  if (user?.kind !== "user") return false;
  const failures = user.failures ?? [];
  const index = failures.findIndex((item) => item.id === failure.id);
  const previous = failures[index];
  // 修复原因：通知和 prompt 结果携带同一错误；按 Agent revision 幂等，不将终态降为警告。
  if (
    previous &&
    (previous.revision >= failure.revision ||
      (previous.severity === "error" && failure.severity !== "error"))
  )
    return false;
  if (index >= 0) failures[index] = structuredClone(failure);
  else {
    if (failures.length >= 64) {
      const warning = failures.findIndex((item) => item.severity === "warning");
      if (warning < 0 && failure.severity === "warning") return false;
      failures.splice(warning >= 0 ? warning : 0, 1);
    }
    failures.push(structuredClone(failure));
  }
  user.failures = failures;
  if (failure.severity === "error") {
    user.traceError = failure.title;
    session.error = failure.title;
    session.errorCommandId = commandId;
  }
  return true;
}
