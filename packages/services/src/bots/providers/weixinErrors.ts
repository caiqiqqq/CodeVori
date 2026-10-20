export type WeixinOperation = "/getupdates" | "/sendmessage" | "/getconfig" | "/sendtyping";
type WeixinFailureKind =
  | "credentials"
  | "timeout"
  | "network"
  | "http"
  | "api"
  | "response"
  | "unknown";

const SAFE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "EACCES",
  "EPERM",
  "ENOSPC",
  "ENOENT",
  "EIO",
  "EROFS",
  "EMFILE",
]);

export function readWeixinErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && SAFE_ERROR_CODES.has(code)) return code;
  const cause = error.cause;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  return typeof causeCode === "string" && SAFE_ERROR_CODES.has(causeCode) ? causeCode : undefined;
}

/** 仅保留受控字段；第三方 errmsg/异常 cause 可能回显凭据或用户消息，不能进入日志和状态。 */
export class WeixinProviderError extends Error {
  constructor(
    readonly operation: WeixinOperation,
    readonly kind: WeixinFailureKind,
    readonly httpStatus?: number,
    readonly ret?: number,
    readonly errcode?: number,
    readonly code?: string,
  ) {
    super(
      `Weixin ${operation} failed: kind=${kind}${httpStatus === undefined ? "" : ` http=${httpStatus}`}${ret === undefined ? "" : ` ret=${ret}`}${errcode === undefined ? "" : ` errcode=${errcode}`}${code === undefined ? "" : ` code=${code}`}`,
    );
    this.name = "WeixinProviderError";
  }

  get requiresLogin(): boolean {
    // 微信官方接入包将 -14 定义为 session timeout；重连旧凭据不能恢复登录。
    return (
      this.kind === "credentials" ||
      this.httpStatus === 401 ||
      this.httpStatus === 403 ||
      this.ret === -14 ||
      this.errcode === -14
    );
  }
}

export function formatWeixinDiagnostic(error: unknown): string {
  if (error instanceof WeixinProviderError) return error.message;
  const code = readWeixinErrorCode(error);
  return code ? `kind=io code=${code}` : "kind=unknown";
}

export function weixinDeliveryMessageId(error: unknown): string {
  if (!(error instanceof WeixinProviderError)) return "bots.runtime.weixinDeliveryUnknown";
  if (error.requiresLogin) return "bots.runtime.weixinLoginRequired";
  if (error.kind === "network" || error.kind === "timeout" || (error.httpStatus ?? 0) >= 500)
    return "bots.runtime.weixinDeliveryNetwork";
  return error.kind === "http" || error.kind === "api"
    ? "bots.runtime.weixinDeliveryRejected"
    : "bots.runtime.weixinDeliveryUnknown";
}
