/**
 * Provider 内置工具线协议兼容的公开入口。
 * 只由 anthropic-stream-compat 在 Anthropic fetch 边界调用。
 */
export {
  PROVIDER_BUILTIN_TOOL_SERVER_NAME,
  ProviderBuiltinToolStreamRewriter,
  rewriteProviderBuiltinToolContent,
} from "./compat.js";
export type { SseFrame } from "./compat.js";
