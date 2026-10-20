import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type AcpStreamDiagnostic } from "@zcode/shared";
import type { StreamDiagnostic } from "@zcode/rpc";
import { AcpStreamObserver } from "../src/lib/acpStreamObserver.js";

const id = "d12009dd-f88f-47da-b8ef-2237e786a006";
const snapshot = (revision: number) =>
  acpSessionSchema.parse({
    id,
    revision,
    workspacePath: "/private/token=secret",
    agent: "codex",
    acpSessionId: "native",
    title: "private title",
    status: "running",
    entries: [],
    pendingPermission: null,
    error: null,
  });
const trace: AcpStreamDiagnostic = {
  receivedRevision: 1,
  receivedAt: 100,
  snapshotStartedAt: 101,
  broadcastAt: 105,
  kind: "text",
  chunkChars: 1,
  entryIndex: 1,
  entryCount: 2,
};

function fixture() {
  let now = 200,
    visible = true,
    sequence = 0;
  const frames = new Map<number, () => void>();
  const records: StreamDiagnostic[] = [];
  const observer = new AcpStreamObserver({
    write: (r) => records.push(r),
    now: () => now,
    visible: () => visible,
    requestFrame: (cb) => {
      frames.set(++sequence, cb);
      return sequence;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  return {
    observer,
    records,
    frames,
    advance(ms: number) {
      now += ms;
    },
    background() {
      visible = false;
    },
    frame() {
      const batch = [...frames];
      frames.clear();
      batch.forEach(([, cb]) => cb());
    },
  };
}

test("UI receipt, layout commit and frame opportunity correlate without transcript data", () => {
  const f = fixture(),
    session = snapshot(2);
  f.observer.received(session, trace);
  f.advance(10);
  const cleanup = f.observer.commit(session);
  f.advance(16);
  f.frame();
  f.advance(16);
  f.frame();
  assert.deepEqual(
    f.records.map((r) => r.stage),
    ["ui-received", "ui-commit", "frame-opportunity"],
  );
  assert.equal(f.records.at(-1)?.facts.elapsedMs, 42);
  assert.equal(f.records[1]?.facts.receivedRevision, 1);
  assert.equal(
    f.records.every((r) => r.sessionId === id && r.revision === 2),
    true,
  );
  assert.equal(JSON.stringify(f.records).includes("secret"), false);
  cleanup();
  f.observer.commit(structuredClone(session));
  assert.equal(f.records.length, 3, "replay/list is not a live receive");
});

test("stale revisions, invalid metadata, new receipt, hidden pages and cleanup reject stale frames", () => {
  const f = fixture(),
    first = snapshot(2),
    next = snapshot(3);
  f.observer.received(first, trace);
  f.observer.commit(first);
  const lateFrame = [...f.frames.values()][0]!;
  f.observer.received(next, { ...trace, receivedRevision: 3 });
  lateFrame();
  assert.equal(f.frames.size, 0);
  f.observer.received(first, trace);
  f.observer.received(snapshot(4), { ...trace, receivedRevision: 5 });
  f.observer.received(snapshot(5), { ...trace, ...({ text: "secret" } as {}) });
  assert.equal(f.records.filter((r) => r.stage === "ui-received").length, 2);
  const hidden = fixture();
  hidden.observer.received(next, trace);
  const cleanup = hidden.observer.commit(next);
  hidden.background();
  hidden.frame();
  assert.equal(hidden.frames.size, 0);
  assert.equal(
    hidden.records.some((r) => r.stage === "frame-opportunity"),
    false,
  );
  cleanup();
  hidden.observer.commit(null);
  assert.equal(hidden.frames.size, 0);
});

test("throwing log sink or unsupported frames never block receipt/commit", () => {
  const observer = new AcpStreamObserver({
    write() {
      throw new Error("sink");
    },
    visible: () => true,
    requestFrame() {
      throw new Error("unsupported");
    },
  });
  const session = snapshot(2);
  assert.doesNotThrow(() => observer.received(session, trace));
  assert.doesNotThrow(() => observer.commit(session));
});

test("visibility/owner changes invalidate even a queued callback after foreground resumes", () => {
  let visible = true,
    owner = true,
    changed: (() => void) | undefined,
    callback: (() => void) | undefined;
  let listeners = 0;
  const records: StreamDiagnostic[] = [];
  const observer = new AcpStreamObserver({
    write: (r) => records.push(r),
    visible: () => visible,
    requestFrame(cb) {
      callback = cb;
      return 1;
    },
    cancelFrame() {},
    listenVisibility(cb) {
      changed = cb;
      listeners++;
      return () => {
        if (changed) {
          listeners--;
          changed = undefined;
        }
      };
    },
  });
  const session = snapshot(2);
  observer.received(session, trace);
  observer.commit(session, () => owner);
  const delayed = callback!;
  visible = false;
  changed!();
  visible = true;
  assert.equal(listeners, 0);
  delayed();
  assert.equal(
    records.some((r) => r.stage === "frame-opportunity"),
    false,
  );
  const next = snapshot(3);
  observer.received(next, trace);
  observer.commit(next, () => owner);
  owner = false;
  callback!();
  assert.equal(listeners, 0);
  assert.equal(
    records.some((r) => r.stage === "frame-opportunity"),
    false,
  );
});
