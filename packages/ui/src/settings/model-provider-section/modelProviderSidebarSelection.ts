/** 侧栏只接受实际可见的自定义供应商；旧的预置入口选中态回落到首个可见项。 */
export function resolveVisibleModelProviderNodeKey(
  selectedNodeKey: string | null,
  visibleCustomNodeKeys: readonly string[],
): string | null {
  if (selectedNodeKey && visibleCustomNodeKeys.includes(selectedNodeKey)) return selectedNodeKey;
  return visibleCustomNodeKeys[0] ?? null;
}
