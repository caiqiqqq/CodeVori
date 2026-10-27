export interface RetainedPluginPage {
  visible: boolean;
  busy: boolean;
  backgroundRetention: boolean;
  dispose(): void;
}

export class PluginPageCapacityError extends Error {
  constructor() {
    super("Plugin page capacity reached");
  }
}

/** 页面生命周期的唯一 owner；不持有 session 运行事实或 MCP 连接。 */
export class PluginPageRetention {
  private pages = new Map<RetainedPluginPage, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private windowVisible = true;
  constructor(
    private now = Date.now,
    private schedule = setTimeout,
    private cancel = clearTimeout,
  ) {}

  add(page: RetainedPluginPage): void {
    if (this.pages.has(page)) return;
    this.sweep();
    if (this.pages.size >= 64) {
      const oldest = this.background().find(([entry]) => !entry.busy);
      if (!oldest) throw new PluginPageCapacityError();
      this.remove(oldest[0]);
    }
    this.pages.set(page, this.now());
    this.changed();
  }

  activity(page: RetainedPluginPage): void {
    if (this.pages.has(page)) this.pages.set(page, this.now());
    this.changed();
  }

  setWindowVisible(visible: boolean): void {
    if (visible === this.windowVisible) return;
    for (const page of this.pages.keys()) if (page.visible) this.pages.set(page, this.now());
    this.windowVisible = visible;
    this.changed();
  }

  changed(): void {
    if (this.timer) this.cancel(this.timer);
    this.timer = undefined;
    this.sweep();
    const background = this.background();
    const retainedCount = background.filter(([page]) => page.backgroundRetention).length;
    const waits = background.flatMap(([page, since]) => {
      if (page.busy || (page.backgroundRetention && retainedCount <= 4)) return [];
      return [Math.max(1, since + (page.backgroundRetention ? 30 : 5) * 60_000 - this.now())];
    });
    if (waits.length) this.timer = this.schedule(() => this.changed(), Math.min(...waits));
  }

  sweep(): void {
    let retainedCount = this.background().filter(([page]) => page.backgroundRetention).length;
    for (const [page, since] of this.background()) {
      // 官方 3.16.3 对保留型页面用 4 页/30 分钟约束；工具仍忙时不能回收它的交互上下文。
      if (page.busy || this.now() - since < (page.backgroundRetention ? 30 : 5) * 60_000) continue;
      if (page.backgroundRetention && retainedCount <= 4) continue;
      if (page.backgroundRetention) retainedCount--;
      this.remove(page);
    }
  }

  remove(page: RetainedPluginPage): void {
    if (!this.pages.delete(page)) return;
    page.dispose();
  }

  clear(): void {
    if (this.timer) this.cancel(this.timer);
    this.timer = undefined;
    for (const page of this.pages.keys()) this.remove(page);
  }

  get size() {
    return this.pages.size;
  }

  private background() {
    return [...this.pages]
      .filter(([page]) => !(this.windowVisible && page.visible))
      .sort((a, b) => a[1] - b[1]);
  }
}
