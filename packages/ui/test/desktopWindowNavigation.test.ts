import assert from "node:assert/strict";
import test from "node:test";
import type { IServiceAccessor } from "@zcode/services";
import type { DesktopWindowSessionSnapshot } from "@zcode/shared";
import {
  readDesktopWindowNavigation,
  persistDesktopWindowNavigation,
  validateDesktopWindowNavigation,
  type DesktopWindowNavigation,
} from "../src/lib/desktopWindowNavigation.js";

const workspace = {
  workspacePath: "/same",
  workspaceIdentity: "remote-A",
  remoteSessionId: "new-attachment",
};
const snapshot: DesktopWindowSessionSnapshot = {
  epoch: "host",
  revision: 1,
  workspaces: [workspace],
  sidebar: { organizeBy: "project", sortBy: "updated" },
};
const bookmark: DesktopWindowNavigation = {
  version: 1,
  workspacePath: "/same",
  workspaceIdentity: "remote-A",
  target: { kind: "api", id: "saved" },
};

test("bookmark schema preserves explicit draft and rejects malformed or unavailable storage", () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
  const draft: DesktopWindowNavigation = { ...bookmark, target: { kind: "draft" } };
  persistDesktopWindowNavigation(draft, storage);
  assert.deepEqual(readDesktopWindowNavigation(storage), draft);
  value = JSON.stringify({ ...bookmark, version: 99 });
  assert.equal(readDesktopWindowNavigation(storage), null);
  value = "broken";
  assert.equal(readDesktopWindowNavigation(storage), null);
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  assert.equal(readDesktopWindowNavigation(blocked), null);
  assert.doesNotThrow(() => persistDesktopWindowNavigation(draft, blocked));
});

test("API validation uses exact current identity and attachment without loading runtime", async () => {
  const calls: unknown[] = [];
  let entries: unknown[] = [
    { sessionId: "saved", workspace: { ...workspace, workspaceKey: "remote-A" } },
  ];
  const services = {
    zcodeSessionService: {
      listSessions: async (input: unknown) => {
        calls.push(input);
        return entries;
      },
    },
  } as unknown as IServiceAccessor;
  const result = await validateDesktopWindowNavigation(bookmark, snapshot, () => services);
  assert.deepEqual(result?.workspace, workspace);
  assert.deepEqual(calls, [{ ...workspace, sessionIds: ["saved"], includeArchived: false }]);
  entries = [
    {
      sessionId: "saved",
      workspace: { ...workspace, workspaceIdentity: "remote-B", workspaceKey: "remote-B" },
    },
  ];
  assert.equal(await validateDesktopWindowNavigation(bookmark, snapshot, () => services), null);
  entries = [
    { sessionId: "saved", workspace: { ...workspace, workspaceKey: "remote-A" }, archivedAt: 123 },
  ];
  assert.equal(await validateDesktopWindowNavigation(bookmark, snapshot, () => services), null);
  entries = [];
  assert.equal(await validateDesktopWindowNavigation(bookmark, snapshot, () => services), null);
});

test("closed/unavailable workspaces never query a local fallback; drafts require membership", async () => {
  let calls = 0;
  const resolve = () => {
    calls++;
    throw Error("must not query");
  };
  assert.equal(
    await validateDesktopWindowNavigation(
      bookmark,
      { ...snapshot, workspaces: [{ ...workspace, workspaceIdentity: "remote-B" }] },
      resolve,
    ),
    null,
  );
  assert.equal(
    await validateDesktopWindowNavigation(
      bookmark,
      { ...snapshot, workspaces: [{ ...workspace, availability: "unavailable-local-directory" }] },
      resolve,
    ),
    null,
  );
  const draft: DesktopWindowNavigation = { ...bookmark, target: { kind: "draft" } };
  assert.equal(
    (await validateDesktopWindowNavigation(draft, snapshot, resolve))?.target.kind,
    "draft",
  );
  assert.equal(calls, 0);
  assert.equal(
    await validateDesktopWindowNavigation(draft, { ...snapshot, workspaces: [] }, resolve),
    null,
  );
});

test("ACP validates live summaries and never routes ACP ids through native lookup", async () => {
  let session = {
    id: "saved",
    agent: "codex",
    title: "Saved ACP",
    ...workspace,
    status: "idle",
    entries: [{ kind: "user", createdAt: 10 }],
    history: { createdAt: 10, updatedAt: 20 },
  };
  const services = {
    acpService: { listSummaries: async () => [session] },
  } as unknown as IServiceAccessor;
  const acp: DesktopWindowNavigation = {
    ...bookmark,
    target: { kind: "acp", id: "saved", agent: "codex" },
  };
  const result = await validateDesktopWindowNavigation(acp, snapshot, () => services);
  assert.equal(result?.acpSession?.id, "saved");
  assert.equal(result?.acpSession?.remoteSessionId, "new-attachment");
  session = { ...session, agent: "claude" };
  assert.equal(await validateDesktopWindowNavigation(acp, snapshot, () => services), null);
  session = { ...session, agent: "codex", archived: true } as typeof session;
  assert.equal(await validateDesktopWindowNavigation(acp, snapshot, () => services), null);
});

test("RPC failure propagates so a temporary disconnection does not erase a valid bookmark", async () => {
  const services = {
    zcodeSessionService: {
      listSessions: async () => {
        throw Error("offline");
      },
    },
  } as unknown as IServiceAccessor;
  await assert.rejects(
    validateDesktopWindowNavigation(bookmark, snapshot, () => services),
    /offline/,
  );
});
