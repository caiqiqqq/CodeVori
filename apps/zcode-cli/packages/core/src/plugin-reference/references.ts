// 原生 ZCode 与 ACP Host 共用严格的 plugin:// 引用解析规则。
export {
  extractPluginReferences,
  isValidPluginStableId,
  MAX_PLUGIN_REFERENCES_PER_TURN,
  type ExtractPluginReferencesResult,
} from "@zcode/shared";
