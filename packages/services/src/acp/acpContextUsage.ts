import type { AcpSession } from "@zcode/shared";

/** ACP occupancy is session context, never cumulative prompt spend or a model-name estimate. */
export function projectAcpContextUsage(
  usage: { used: number; size: number } | null | undefined,
): AcpSession["contextUsage"] {
  return usage &&
    Number.isFinite(usage.used) &&
    usage.used > 0 &&
    Number.isFinite(usage.size) &&
    usage.size > 0
    ? { used: usage.used, size: usage.size }
    : null;
}
