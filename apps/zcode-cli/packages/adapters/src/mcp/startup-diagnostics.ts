import { stripVTControlCharacters } from "node:util";

const MCP_STDIO_STDERR_STATUS_MAX_CHARS = 4_000;
const MCP_STDIO_ERROR_MESSAGE_MAX_CHARS = 512;

/** 子进程启动证据只在 stdio 状态里展示，HTTP 错误不混入上一进程的 stderr。 */
export function buildMcpFailureStatusMessage(
  message: string,
  recentStderr: string | undefined,
  transportType: string,
): string {
  if (transportType !== "stdio") return message;
  return [
    sanitizeMcpStdioStderr(message).slice(0, MCP_STDIO_ERROR_MESSAGE_MAX_CHARS),
    recentStderr
      ? sanitizeMcpStdioStderr(recentStderr).slice(-MCP_STDIO_STDERR_STATUS_MAX_CHARS)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** stderr 可能带环境变量、URL 用户信息和终端控制字符；展示前统一清理。 */
export function sanitizeMcpStdioStderr(text: string): string {
  text = stripVTControlCharacters(text);
  const sensitiveKey = String.raw`(?:[a-z0-9_.-]*[_-])?(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|private[_-]?key|token|password|passwd|pass|mysql_pass|mysql_password)`;
  let result = text.replace(/(bearer\s+)[^\s"']+/gi, "$1[Redacted]");
  result = result.replace(
    /(\bauthorization\b\s*[:=]\s*)(bearer\s+)?[^\r\n]+/gi,
    (_match, prefix: string, bearer: string | undefined) =>
      `${prefix}${bearer ? "Bearer " : ""}[Redacted]`,
  );
  result = result.replace(new RegExp(`([?&]${sensitiveKey}=)[^&\\s]+`, "gi"), "$1[Redacted]");
  const quotedValue = String.raw`(["'])(?:\\.|(?!\2)[^\\\r\n])*\2`;
  result = result.replace(
    new RegExp(String.raw`(["']${sensitiveKey}["']\s*:\s*)${quotedValue}`, "gi"),
    "$1$2[Redacted]$2",
  );
  result = result.replace(
    new RegExp(String.raw`(\b${sensitiveKey}\b\s*[:=]\s*)${quotedValue}`, "gi"),
    "$1$2[Redacted]$2",
  );
  result = result.replace(
    new RegExp(`(\\b${sensitiveKey}\\b\\s*[:=]\\s*)(["']?)[^\\s"',;)}]+`, "gi"),
    "$1$2[Redacted]",
  );
  return result.replace(/([a-z][a-z0-9+.-]*:\/\/)[^:\s/@]+:[^@\s/]+@/gi, "$1[Redacted]@");
}
