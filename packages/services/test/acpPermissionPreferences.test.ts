import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpConfigOption, AcpSession } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { AcpPermissionPreferences } from "../src/acp/acpPermissionPreferences.js";

const target = { workspacePath: "/fixture/permission", workspaceIdentity: "remote:fixture" };
const full = "agent-full-access";
const mode = (value = "agent", values = ["agent", full]): AcpConfigOption => ({
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: value,
  options: values.map((value) => ({ value, name: value })),
});

function fixture() {
  const calls: string[] = [];
  const control = {
    values: ["agent", full],
    fail: false,
    legacy: false,
    wait: undefined as Promise<void> | undefined,
  };
  const connect: AcpConnectionFactory = async ({ sessionId }) => ({
    sessionId: sessionId ?? randomUUID(),
    configOptions: control.legacy
      ? []
      : [
          mode("agent", control.values),
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "one",
            options: [
              { value: "one", name: "One" },
              { value: "two", name: "Two" },
            ],
          },
        ],
    modeState: control.legacy
      ? {
          currentModeId: "agent",
          availableModes: control.values.map((id) => ({ id, name: id })),
        }
      : null,
    async setConfigOption(id, value) {
      calls.push(`config:${id}:${value}`);
      await control.wait;
      if (control.fail) throw new Error("fixture config rejected");
      return id === "mode"
        ? [mode(String(value), control.values)]
        : [
            mode(),
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: String(value),
              options: [
                { value: "one", name: "One" },
                { value: "two", name: "Two" },
              ],
            },
          ];
    },
    async setMode(value) {
      calls.push(`legacy:${value}`);
    },
    async prompt() {
      calls.push("prompt");
    },
    async cancel() {},
    close() {},
  });
  return { connect, control, calls };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-permission-preferences-"));
  const f = fixture();
  const services: ReturnType<typeof createAcpService>[] = [];
  const open = (hostDirectory = directory) => {
    const service = createAcpService({ directory: hostDirectory, connect: f.connect });
    services.push(service);
    return service;
  };
  return {
    ...f,
    directory,
    open,
    async close() {
      await Promise.all(services.map((service) => service.disposeAllAndWait()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function choose(
  service: ReturnType<typeof createAcpService>,
  session: AcpSession,
  value: string,
  rememberPermission = true,
) {
  return service.setConfigOption({
    ...target,
    id: session.id,
    configId: "mode",
    value,
    rememberPermission,
  });
}

test("empty composer permission survives removal, Host restart and a changed attachment before prompt", async () => {
  const f = await setup();
  try {
    const first = f.open();
    const draft = await first.create({
      ...target,
      agent: "codex",
      deferPersistence: true,
      usePermissionPreference: true,
    });
    await choose(first, draft, full);
    assert.equal((await readdir(f.directory)).filter((name) => name.endsWith(".json")).length, 0);
    await first.remove({ ...target, id: draft.id, provisionalOnly: true });
    await first.disposeAllAndWait();
    const restarted = f.open();
    const next = await restarted.create({
      ...target,
      agent: "codex",
      remoteSessionId: "new-attachment",
      usePermissionPreference: true,
    });
    assert.equal(next.configOptions[0].currentValue, full);
    assert.deepEqual(next.permissionSelection, { configId: "mode", value: full });
    await restarted.prompt({
      ...target,
      id: next.id,
      commandId: "fixture-prompt",
      text: "fixture",
    });
    assert.deepEqual(f.calls, [`config:mode:${full}`, `config:mode:${full}`, "prompt"]);
  } finally {
    await f.close();
  }
});

test("permission memory isolates workspace identities, Agents and Hosts and supports local path fallback", async () => {
  const f = await setup();
  try {
    const service = f.open();
    const source = await service.create({ ...target, agent: "codex" });
    await choose(service, source, full);
    for (const scope of [
      { ...target, workspaceIdentity: "remote:other", agent: "codex" as const },
      { ...target, agent: "claude" as const },
      { workspacePath: target.workspacePath, agent: "codex" as const },
    ]) {
      assert.equal(
        (await service.create({ ...scope, usePermissionPreference: true })).configOptions[0]
          .currentValue,
        "agent",
      );
    }
    assert.equal(
      (
        await f
          .open(join(f.directory, "other-host"))
          .create({ ...target, agent: "codex", usePermissionPreference: true })
      ).configOptions[0].currentValue,
      "agent",
    );
    const moved = await service.create({
      ...target,
      workspacePath: "/fixture/moved",
      workspaceIdentity: ` ${target.workspaceIdentity} `,
      agent: "codex",
      usePermissionPreference: true,
    });
    assert.equal(moved.configOptions[0].currentValue, full);
    const local = { workspacePath: "/fixture/local" };
    const draft = await service.create({ ...local, agent: "codex" });
    await service.setConfigOption({
      ...local,
      id: draft.id,
      configId: "mode",
      value: full,
      rememberPermission: true,
    });
    assert.equal(
      (await service.create({ ...local, agent: "codex", usePermissionPreference: true }))
        .configOptions[0].currentValue,
      full,
    );
  } finally {
    await f.close();
  }
});

test("internal execution and non-permission config do not inherit or overwrite composer memory; same-value reset persists", async () => {
  const f = await setup();
  try {
    const service = f.open();
    const source = await service.create({ ...target, agent: "codex" });
    await choose(service, source, full);
    const internal = await service.create({ ...target, agent: "codex" });
    assert.equal(internal.configOptions[0].currentValue, "agent");
    await choose(service, internal, "agent", false);
    await service.setConfigOption({
      ...target,
      id: internal.id,
      configId: "model",
      value: "two",
      rememberPermission: true,
    });
    assert.equal(
      (await service.create({ ...target, agent: "codex", usePermissionPreference: true }))
        .configOptions[0].currentValue,
      full,
    );
    await choose(service, internal, "agent");
    assert.equal(
      (await service.create({ ...target, agent: "codex", usePermissionPreference: true }))
        .configOptions[0].currentValue,
      "agent",
    );
  } finally {
    await f.close();
  }
});

test("history restores its own mode, including legacy snapshots, rather than a newer composer preference", async () => {
  const f = await setup();
  try {
    const first = f.open();
    const history = await first.create({ ...target, agent: "codex" });
    await choose(first, history, full);
    const explicitHistory = await first.create({ ...target, agent: "codex" });
    await choose(first, explicitHistory, full);
    const later = await first.create({ ...target, agent: "codex" });
    await choose(first, later, "agent");
    const path = join(f.directory, `${history.id}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    delete saved.permissionSelection;
    await writeFile(path, JSON.stringify(saved));
    await first.disposeAllAndWait();
    const restarted = f.open();
    assert.equal(
      (await restarted.refresh({ ...target, id: history.id })).configOptions[0].currentValue,
      full,
    );
    assert.equal(
      (await restarted.refresh({ ...target, id: explicitHistory.id })).configOptions[0]
        .currentValue,
      full,
    );
    assert.equal(
      (await restarted.refresh({ ...target, id: later.id })).configOptions[0].currentValue,
      "agent",
    );
    assert.equal(
      (await restarted.create({ ...target, agent: "codex", usePermissionPreference: true }))
        .configOptions[0].currentValue,
      "agent",
    );
  } finally {
    await f.close();
  }
});

test("unsupported or rejected restoration fails before prompt and can retry when the Agent supports it", async () => {
  const f = await setup();
  try {
    const first = f.open();
    const history = await first.create({ ...target, agent: "codex" });
    await choose(first, history, full);
    await first.disposeAllAndWait();
    const restarted = f.open();
    f.control.values = ["agent"];
    await assert.rejects(
      restarted.create({ ...target, agent: "codex", usePermissionPreference: true }),
      /saved permission value is not available/,
    );
    await assert.rejects(
      restarted.prompt({ ...target, id: history.id, commandId: "blocked", text: "fixture" }),
      /saved permission value is not available/,
    );
    assert.equal(f.calls.includes("prompt"), false);
    f.control.values = ["agent", full];
    f.control.fail = true;
    await assert.rejects(
      restarted.refresh({ ...target, id: history.id }),
      /fixture config rejected/,
    );
    f.control.fail = false;
    assert.equal(
      (await restarted.refresh({ ...target, id: history.id })).configOptions[0].currentValue,
      full,
    );
  } finally {
    await f.close();
  }
});

test("concurrent refresh and prompt await the same permission restoration", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const first = f.open();
    const history = await first.create({ ...target, agent: "codex" });
    await choose(first, history, full);
    await first.disposeAllAndWait();
    f.control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restarted = f.open();
    const refreshed = restarted.refresh({ ...target, id: history.id });
    const prompted = restarted.prompt({
      ...target,
      id: history.id,
      commandId: "concurrent",
      text: "fixture",
    });
    // 等待实际恢复调用，不能用超时充当 ready；此时 prompt 必须仍未进入 Agent。
    while (f.calls.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.calls.includes("prompt"), false);
    release();
    await Promise.all([refreshed, prompted]);
    assert.equal(f.calls.filter((call) => call === `config:mode:${full}`).length, 2);
    assert.equal(f.calls.at(-1), "prompt");
  } finally {
    release?.();
    await f.close();
  }
});

test("a failed or removed session selection never replaces the last confirmed preference", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const service = f.open();
    const session = await service.create({ ...target, agent: "codex" });
    await choose(service, session, "agent");
    f.control.fail = true;
    await assert.rejects(choose(service, session, full), /fixture config rejected/);
    f.control.fail = false;
    f.control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = choose(service, session, full);
    const rejected = assert.rejects(late, /changed while configuring/);
    while (f.calls.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
    await service.remove({ ...target, id: session.id });
    release();
    await rejected;
    f.control.wait = undefined;
    assert.equal(
      (await service.create({ ...target, agent: "codex", usePermissionPreference: true }))
        .configOptions[0].currentValue,
      "agent",
    );
  } finally {
    release?.();
    await f.close();
  }
});

test("legacy ACP modes are remembered and restored through set_mode", async () => {
  const f = await setup();
  try {
    f.control.legacy = true;
    const first = f.open();
    const session = await first.create({ ...target, agent: "claude", deferPersistence: true });
    await choose(first, session, full);
    await first.disposeAllAndWait();
    const next = await f
      .open()
      .create({ ...target, agent: "claude", usePermissionPreference: true });
    assert.equal(next.modeState?.currentModeId, full);
    assert.deepEqual(f.calls, [`legacy:${full}`, `legacy:${full}`]);
  } finally {
    await f.close();
  }
});

test("preference writes serialize and corrupted preference data is rejected", async () => {
  const f = await setup();
  try {
    const store = new AcpPermissionPreferences(join(f.directory, "preferences"));
    await Promise.all([
      store.remember(target, "codex", { configId: "mode", value: full }),
      store.remember(target, "codex", { configId: "mode", value: "agent" }),
    ]);
    assert.deepEqual(await store.read(target, "codex"), { configId: "mode", value: "agent" });
    const [file] = await readdir(join(f.directory, "preferences"));
    await writeFile(join(f.directory, "preferences", file), "invalid json");
    await assert.rejects(store.read(target, "codex"), /could not be read/);
  } finally {
    await f.close();
  }
});

test("a preference write failure reports the applied mode and retry persists the unchanged selection", async () => {
  const f = await setup();
  try {
    const service = f.open();
    const session = await service.create({ ...target, agent: "codex", deferPersistence: true });
    const blocked = join(f.directory, "permission-preferences");
    await writeFile(blocked, "fixture blocks the preference directory");
    await assert.rejects(choose(service, session, full), /could not be saved/);
    assert.equal(
      (await service.read({ ...target, id: session.id })).configOptions[0].currentValue,
      full,
    );
    await rm(blocked);
    await choose(service, session, full);
    assert.equal(
      f.calls.length,
      1,
      "retry saves without reapplying an already effective permission",
    );
    await service.disposeAllAndWait();
    const restored = await f
      .open()
      .create({ ...target, agent: "codex", usePermissionPreference: true });
    assert.equal(restored.configOptions[0].currentValue, full);
  } finally {
    await f.close();
  }
});
