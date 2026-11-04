/** 串行复用单插件更新；失败继续，目标变化立即停止，不重放已提交的更新。 */
export async function updatePluginsSerially(
  ids: readonly string[],
  update: (id: string) => Promise<boolean>,
  guard: { isCurrent(): boolean; needsUpdate(id: string): boolean },
): Promise<{ succeeded: string[]; failed: string[]; aborted: boolean }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of new Set(ids)) {
    if (!guard.isCurrent()) return { succeeded, failed, aborted: true };
    if (!guard.needsUpdate(id)) continue;
    const ok = await update(id).catch(() => false);
    if (!guard.isCurrent()) return { succeeded, failed, aborted: true };
    (ok ? succeeded : failed).push(id);
  }
  return { succeeded, failed, aborted: false };
}
