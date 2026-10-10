import { Emitter, type Event } from "@zcode/rpc";
import { resolveWorkspaceKey, type WorkTaskScope } from "@zcode/shared";

/** 服务持有的派生通知游标；持久事实仍只在 WorkTaskRepo。 */
export class WorkTaskEvents {
  private readonly events = new Map<string, Emitter<void>>();
  private revisions = new Map<string, number>();
  subscribe(scope: WorkTaskScope): Event<void> {
    const key = resolveWorkspaceKey(scope);
    let emitter = this.events.get(key);
    if (!emitter) {
      emitter = new Emitter<void>();
      this.events.set(key, emitter);
    }
    return emitter.event;
  }
  publish(next: Map<string, number>): boolean {
    let changed = false;
    for (const [key, revision] of next) {
      if (this.revisions.get(key) !== revision) {
        changed = true;
        this.events.get(key)?.fire();
      }
    }
    this.revisions = next;
    return changed;
  }
  dispose() {
    for (const event of this.events.values()) event.dispose();
    this.events.clear();
  }
}
