const SECRET_LABEL =
  /\b(?:password|passwd|secret|token|api[ _-]?key|private[ _-]?key)\b|密码|密钥|令牌/i;
const LABEL_VALUE =
  /((?:password|passwd|secret|token|api[ _-]?key|private[ _-]?key|密码|密钥|令牌)\s*(?:[:=：]|\s)\s*)[^\s,;，；]+/gi;

function looksLikeCredential(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value) &&
    /[!@#$%^&*]/.test(value) &&
    !value.includes("/")
  );
}

export function containsProjectMemorySecret(text: string): boolean {
  return SECRET_LABEL.test(text) || text.split(/\s+/).some(looksLikeCredential);
}

/** Keep non-secret environment facts while preventing a second model call from seeing likely credentials. */
export function redactProjectMemorySecrets(text: string): string {
  return (
    text
      .replace(LABEL_VALUE, "$1[REDACTED]")
      .split(/(\s+)/)
      // 修复原因：SSH 密码可能没有标签，既可能独占一行，也可能夹在连接说明中。
      .map((part) => (looksLikeCredential(part) ? "[REDACTED]" : part))
      .join("")
  );
}
