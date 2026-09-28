import { CODING_PLAN_SYSTEM_BUSY } from "@zcode/shared";

export function normalizeCodingPlanReadError(error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : String(error);
  const normalized = message.trim().toLowerCase();
  if (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  ) {
    return CODING_PLAN_SYSTEM_BUSY;
  }
  if (
    normalized === "bigmodel_oauth_required" ||
    normalized === "zai_oauth_required" ||
    normalized.includes("oauth_required") ||
    /\b401\b|\b403\b/.test(normalized) ||
    [
      "unauthorized",
      "forbidden",
      "token expired",
      "expired or incorrect",
      "invalid token",
      "access token",
    ].some((token) => normalized.includes(token))
  ) {
    return "coding_plan_oauth_required";
  }
  return message;
}
