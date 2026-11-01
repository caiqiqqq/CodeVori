export function shouldRetryElectronBuilderFailure(output) {
  const normalized = output.toLowerCase();
  // 原因：DMG 临时卷被索引器短暂占用时会卸载失败；CI 原样重跑已验证可恢复。
  // 仅重试 hdiutil 明确的卸载占用，不能把签名、编译或资源缺失错误当作瞬态故障。
  if (
    normalized.includes("unable to detach device cleanly") &&
    normalized.includes("hdiutil:") &&
    normalized.includes("resource busy")
  )
    return true;
  return [
    "github.com/electron-userland/electron-builder-binaries/releases/download",
    "electron-builder-binaries/",
    "nsis-resources-",
    'get "https://',
    " eof",
    "read: connection reset by peer",
    "connection reset by peer",
    "connectex",
    "timed out",
    "timeout",
    "socket hang up",
    "unexpected end of file",
    "err_electron_builder_cannot_execute",
  ].some((signal) => normalized.includes(signal));
}
