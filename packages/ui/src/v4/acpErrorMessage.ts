import type { AcpAgent } from "@zcode/shared";

/** UI-only copy for the confirmed Qoder missing-credentials response. */
export function acpErrorMessageId(
  agent: AcpAgent,
  message: string,
): "acp.qoderCredentialsMissing" | null {
  // 修复原因：Qoder 的这一条凭据缺失错误原样显示为英文；只匹配已确认的原文，避免把其他认证失败误报为缺少凭据。
  return agent === "qoder" && message === "Authentication required: Authentication is required."
    ? "acp.qoderCredentialsMissing"
    : null;
}
