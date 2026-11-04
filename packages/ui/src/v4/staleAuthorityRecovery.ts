const STALE_AUTHORITY_REASON_CODES = new Set([
  "proto.staleLogEpoch",
  "proto.staleRevision",
  "proto.staleTarget",
]);

function faultReasonCode(value: unknown): string | undefined {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { status?: unknown; reasonCode?: unknown };
  if (candidate.status !== undefined && candidate.status !== "stale") return undefined;
  return typeof candidate.reasonCode === "string" ? candidate.reasonCode : undefined;
}

/** row command/query 的权威 projection 已跨 revision/epoch/entity 时，统一走 same-sub recovery。 */
export function shouldResyncForStaleAuthority(value: unknown): boolean {
  return STALE_AUTHORITY_REASON_CODES.has(faultReasonCode(value) ?? "");
}

/**
 * 修复：旧 revision 的详情查询被拒后，只有同一 store 的新权威投影才能触发重查。
 * 监听先于 recovery 建立；用 store 的权威帧序号区分真实恢复与历史分页的本地对象替换。
 */
export function waitForRecoveredAuthority<T extends object>(store: {
  getState(): { status: string; snapshot: T | null; authorityVersion: number };
  subscribe(listener: () => void): () => void;
  recoverFromStaleAuthority(): void;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const previousAuthorityVersion = store.getState().authorityVersion;
    let unsubscribe = () => {};
    let settled = false;
    const check = () => {
      if (settled) return;
      const state = store.getState();
      if (state.status === "error" || state.status === "closed") {
        settled = true;
        unsubscribe();
        reject(new Error(`Conversation authority recovery ${state.status}`));
      } else if (state.snapshot && state.authorityVersion !== previousAuthorityVersion) {
        settled = true;
        unsubscribe();
        resolve(state.snapshot);
      }
    };
    unsubscribe = store.subscribe(check);
    try {
      store.recoverFromStaleAuthority();
      check();
    } catch (error) {
      if (!settled) {
        settled = true;
        unsubscribe();
        reject(error);
      }
    }
  });
}
