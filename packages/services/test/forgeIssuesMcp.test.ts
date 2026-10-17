import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
  type NativeMcpServerRecord,
} from "@zcode/shared";
import { createForgeIssuesMcp } from "../src/git/forgeIssuesMcp.js";

const requestId = "6ee05787-d384-4656-a725-0454c57d12ea";
const input = {
  remoteName: "private",
  repositoryKey: "fixture-key",
  requestId,
  title: "Fixture issue",
  body: "Reproduction",
};

async function rpc(record: NativeMcpServerRecord, method: string, params?: unknown) {
  const env = record.config.env!;
  const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: response.status, data: response.ok ? await response.json() : undefined };
}
async function call(record: NativeMcpServerRecord, name: string, args: unknown = {}) {
  const { data } = await rpc(record, "tools/call", { name, arguments: args });
  const value = JSON.parse(data.result.content[0].text);
  if (data.result.isError) throw new Error(value.error);
  return value;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-issues-mcp-"));
  const scope = { workspacePath: directory, kind: "api" as const, sessionId: "parent" };
  const state = {
    enabled: true,
    calls: [] as unknown[],
    fail: false,
    repositoryKey: "fixture-key",
    body: "external content",
    beforeCreate: undefined as (() => Promise<void>) | undefined,
  };
  const git = {
    getForgeRepository: async () => ({
      status: "ready" as const,
      remoteNames: ["origin", "private"],
      remoteName: "private",
      host: "forge.example.invalid",
      provider: "github" as const,
      repository: {
        key: state.repositoryKey,
        name: "team/project",
        url: "https://forge.example.invalid/team/project",
        provider: "github" as const,
        accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
        accountUsername: "fixture",
      },
    }),
    listForgeItems: async (args: unknown) => {
      state.calls.push(args);
      return {
        items: [],
        page: 1,
        pageSize: 20,
        hasMore: false,
        total: 0,
        reachableTotal: 0,
        incomplete: false,
      };
    },
    getForgeItem: async (args: unknown) => {
      state.calls.push(args);
      return { number: 1, body: state.body } as never;
    },
    getForgeIssueOptions: async (args: unknown) => {
      state.calls.push(args);
      return { labels: [], assignees: [], milestones: [] } as never;
    },
    createForgeIssue: async (args: unknown) => {
      state.calls.push(args);
      await state.beforeCreate?.();
      if (state.fail) throw new Error("FORGE_NETWORK");
      return {
        number: 7,
        title: "Fixture issue",
        url: "https://forge.example.invalid/team/project/issues/7",
      } as never;
    },
  };
  const make = () => createForgeIssuesMcp(directory, { git, isEnabled: async () => state.enabled });
  const bridge = make();
  const registration = (await bridge.register(scope))!;
  return {
    directory,
    scope,
    state,
    bridge,
    make,
    record: registration.record,
    async cleanup() {
      bridge.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("built-in issue setting defaults on and accepts only boolean patches", () => {
  assert.equal(appSettingsSchema.parse({}).forgeIssuesMcpEnabled, true);
  assert.equal(
    appSettingsPatchSchema.parse({ forgeIssuesMcpEnabled: false }).forgeIssuesMcpEnabled,
    false,
  );
  assert.equal(appSettingsPatchSchema.safeParse({ forgeIssuesMcpEnabled: "false" }).success, false);
});

test("strict MCP directory, explicit target, bounded reads and Host-owned workspace", async () => {
  const f = await fixture();
  try {
    const { data } = await rpc(f.record, "tools/list");
    assert.deepEqual(
      data.result.tools.map((t: { name: string }) => t.name),
      ["GetRepository", "ListIssues", "GetIssue", "GetIssueOptions", "CreateIssue"],
    );
    for (const tool of data.result.tools)
      assert.equal(tool.inputSchema.additionalProperties, false);
    await assert.rejects(call(f.record, "CreateIssue", { ...input, workspacePath: "/elsewhere" }));
    await assert.rejects(call(f.record, "CreateIssue", { ...input, remoteName: undefined }));
    await assert.rejects(call(f.record, "CreateIssue", { ...input, accountId: "forged" }));
    await call(f.record, "ListIssues", {
      remoteName: "private",
      repositoryKey: "fixture-key",
      search: "bug",
    });
    assert.deepEqual(f.state.calls[0], {
      workspacePath: f.directory,
      remoteName: "private",
      repositoryKey: "fixture-key",
      accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
      kind: "issue",
      state: "open",
      search: "bug",
      sort: "newest",
      labels: [],
      page: 1,
      pageSize: 20,
    });
    f.state.repositoryKey = "changed";
    await assert.rejects(call(f.record, "CreateIssue", input), /FORGE_TARGET_CHANGED/);
    assert.equal(f.state.calls.length, 1);
    assert.equal(
      await f.bridge.register({ ...f.scope, workspaceIdentity: "remote:fixture" }),
      undefined,
    );
  } finally {
    await f.cleanup();
  }
});

test("concurrent create and reconnect replay once; changed payload conflicts", async () => {
  const f = await fixture();
  const second = f.make();
  try {
    const [a, b] = await Promise.all([
      call(f.record, "CreateIssue", input),
      call(f.record, "CreateIssue", input),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a.number, 7);
    assert.equal(f.state.calls.length, 1);
    const next = (await second.register(f.scope))!;
    assert.deepEqual(await call(next.record, "CreateIssue", input), a);
    assert.equal(f.state.calls.length, 1);
    await assert.rejects(
      call(next.record, "CreateIssue", { ...input, title: "changed" }),
      /FORGE_CONFLICT/,
    );
  } finally {
    second.dispose();
    await f.cleanup();
  }
});

test("uncertain network result is durable and never auto-retried", async () => {
  const f = await fixture();
  const next = f.make();
  try {
    f.state.fail = true;
    await assert.rejects(call(f.record, "CreateIssue", input), /FORGE_CREATE_UNCERTAIN/);
    f.state.fail = false;
    const r = (await next.register(f.scope))!;
    await assert.rejects(call(r.record, "CreateIssue", input), /FORGE_CREATE_UNCERTAIN/);
    assert.equal(f.state.calls.length, 1);
  } finally {
    next.dispose();
    await f.cleanup();
  }
});

test("read tools require remote selection and bound issue details", async () => {
  const f = await fixture();
  try {
    const ambiguous = await call(f.record, "GetRepository");
    assert.equal(ambiguous.requiresRemoteSelection, true);
    assert.equal(ambiguous.repository, null);
    assert.equal(ambiguous.remoteName, null);
    const selected = await call(f.record, "GetRepository", { remoteName: "private" });
    assert.equal(selected.requiresRemoteSelection, false);
    assert.equal(selected.repository.key, "fixture-key");
    f.state.body = "x".repeat(65_001);
    const target = { remoteName: "private", repositoryKey: "fixture-key" };
    const issue = await call(f.record, "GetIssue", { ...target, number: 1 });
    assert.equal(issue.body.length, 65_000);
    assert.equal(issue.truncated, true);
    assert.deepEqual(f.state.calls[0], {
      ...target,
      workspacePath: f.directory,
      accountId: selected.repository.accountId,
      number: 1,
      kind: "issue",
    });
    assert.deepEqual(await call(f.record, "GetIssueOptions", target), {
      labels: [],
      assignees: [],
      milestones: [],
    });
    assert.equal(f.state.calls.length, 2);
    await assert.rejects(call(f.record, "ListIssues", { ...target, pageSize: 51 }));
  } finally {
    await f.cleanup();
  }
});

test("another Host cannot repeat a pending POST; different sessions have independent receipts", async () => {
  const f = await fixture();
  const other = f.make();
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.state.beforeCreate = async () => {
    started();
    await gate;
  };
  let pending: Promise<unknown> | undefined;
  try {
    pending = call(f.record, "CreateIssue", input);
    await start;
    const same = (await other.register(f.scope))!;
    await assert.rejects(call(same.record, "CreateIssue", input), /FORGE_CREATE_UNCERTAIN/);
    assert.equal(f.state.calls.length, 1);
    release();
    const result = await pending;
    assert.deepEqual(await call(same.record, "CreateIssue", input), result);
    f.state.beforeCreate = undefined;
    const distinct = (await other.register({ ...f.scope, sessionId: "different" }))!;
    await call(distinct.record, "CreateIssue", input);
    assert.equal(f.state.calls.length, 2);
  } finally {
    release();
    await pending;
    other.dispose();
    await f.cleanup();
  }
});

test("disable rejects old capabilities; workspace revocation expires endpoint", async () => {
  const f = await fixture();
  try {
    f.state.enabled = false;
    assert.equal(await f.bridge.register({ ...f.scope, sessionId: "new" }), undefined);
    await assert.rejects(call(f.record, "CreateIssue", input), /FORGE_MCP_DISABLED/);
    assert.equal(f.state.calls.length, 0);
    f.state.enabled = true;
    f.bridge.revokeWorkspace(f.directory);
    assert.equal((await rpc(f.record, "tools/list")).status, 403);
  } finally {
    await f.cleanup();
  }
});

test("runtime revocation or disposal cannot be undone by a late registration", async () => {
  for (const dispose of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), "zcode-issues-register-"));
    let release!: (enabled: boolean) => void;
    const enabled = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const bridge = createForgeIssuesMcp(directory, { git: {} as never, isEnabled: () => enabled });
    try {
      const scope = { workspacePath: directory, kind: "api" as const, sessionId: "parent" };
      const pending = bridge.register(scope);
      if (dispose) bridge.dispose();
      else bridge.revokeWorkspace(directory);
      release(true);
      assert.equal(await pending, undefined);
      const reconnect = await bridge.register(scope);
      assert.equal(Boolean(reconnect), !dispose);
    } finally {
      bridge.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
