import assert from "node:assert/strict";
import test from "node:test";
import { PluginPageRetention, type RetainedPluginPage } from "../src/lib/pluginPageRetention.ts";

function fixture() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const manager = new PluginPageRetention(
    () => now,
    ((fn: () => void, delay: number) => {
      timers.set(++id, { at: now + delay, fn });
      return id;
    }) as never,
    ((timer: number) => timers.delete(timer)) as never,
  );
  const page = (props: Partial<RetainedPluginPage> = {}) => {
    const entry = {
      visible: false,
      busy: false,
      backgroundRetention: false,
      disposed: false,
      dispose() {
        this.disposed = true;
      },
      ...props,
    };
    manager.add(entry);
    return entry;
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      timers.delete(first[0]);
      now = first[1].at;
      first[1].fn();
    }
    now = end;
  };
  return { manager, page, advance, timers };
}

test("ordinary hidden pages expire at five minutes; foreground and running pages remain", () => {
  const f = fixture();
  const idle = f.page(),
    foreground = f.page({ visible: true }),
    busy = f.page({ busy: true });
  f.advance(299_999);
  assert.equal(idle.disposed, false);
  f.advance(1);
  assert.equal(idle.disposed, true);
  assert.equal(foreground.disposed, false);
  assert.equal(busy.disposed, false);
  busy.busy = false;
  f.manager.changed();
  assert.equal(busy.disposed, true);
  f.manager.clear();
  assert.equal(f.timers.size, 0);
});

test("retention pages exceed four only until the thirty minute boundary, evicting oldest first", () => {
  const f = fixture();
  const oldest = f.page({ backgroundRetention: true });
  f.advance(1000);
  const rest = Array.from({ length: 4 }, () => f.page({ backgroundRetention: true }));
  f.advance(30 * 60_000 - 1001);
  assert.equal(oldest.disposed, false);
  f.advance(1);
  assert.equal(oldest.disposed, true);
  assert.equal(f.manager.size, 4);
  f.advance(60 * 60_000);
  assert.ok(rest.every((p) => !p.disposed));
  f.manager.clear();
});

test("background time starts on visibility transition and busy retention pages are protected", () => {
  const f = fixture();
  const p = f.page({ visible: true });
  f.advance(600_000);
  f.manager.setWindowVisible(false);
  f.advance(299_999);
  assert.equal(p.disposed, false);
  f.manager.setWindowVisible(true);
  f.advance(1);
  assert.equal(p.disposed, false);
  p.visible = false;
  f.manager.activity(p);
  f.advance(300_000);
  assert.equal(p.disposed, true);
  const retained = Array.from({ length: 5 }, () =>
    f.page({ backgroundRetention: true, busy: true }),
  );
  f.advance(1_800_000);
  assert.equal(f.manager.size, 5);
  retained[2]!.busy = false;
  f.manager.changed();
  assert.equal(retained[2]!.disposed, true);
  f.manager.clear();
});

test("capacity releases oldest eligible page and rejects admission when every page is protected", () => {
  const f = fixture();
  const oldest = f.page();
  for (let i = 1; i < 64; i++) f.page({ visible: true });
  f.page({ busy: true });
  assert.equal(oldest.disposed, true);
  assert.equal(f.manager.size, 64);
  assert.throws(() => f.page(), /capacity/);
  f.manager.clear();
  assert.equal(f.manager.size, 0);
  assert.equal(f.timers.size, 0);
});
