/** 手机和桌面共用主机校验；域名后缀不能判断网络范围，不能只允许 .local。 */
export function isDesktopLanAddress(address: string): boolean {
  if (address.length > 253) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const parts = address.split(".");
    const octets = parts.map(Number);
    if (parts.some((part, index) => String(octets[index]) !== part || octets[index]! > 255))
      return false;
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  // 末级标签以字母起始，避免把无效数字 IP 当成域名接受。
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
    address,
  );
}
