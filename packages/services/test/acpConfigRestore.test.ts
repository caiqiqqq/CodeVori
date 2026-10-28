import assert from "node:assert/strict";
import { readPersistedAcpSession } from "./acpTestStorage.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpConfigOption } from "@zcode/shared";
import { defaultAcpModelSelection, restoreAcpConfigOptions } from "../src/acp/acpConfigRestore.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { createComposerPreferenceService } from "../src/composer-preference/composerPreferenceService.js";

const target = { workspacePath: "/fixture/config-restore", workspaceIdentity: "fixture:restore" };
const select = (id: string, value: string, values: string[], category = id): AcpConfigOption => ({
  id,
  name: id,
  category,
  type: "select",
  currentValue: value,
  options: values.map((value) => ({ value, name: value })),
});
const catalog = (): AcpConfigOption[] => [
  select("mode", "agent", ["agent", "full"]),
  select("collaboration_mode", "default", ["default", "plan"]),
  select("reasoning_effort", "medium", ["medium"], "thought_level"),
  select("model", "5.6-sol", ["5.6-sol", "6-sol"]),
  { id: "fast", name: "Fast", type: "boolean", currentValue: false },
];

test("new-session default must exist in the live ACP catalog and be acknowledged", async () => {
  assert.deepEqual(defaultAcpModelSelection(catalog(), ""), []);
  assert.throws(() => defaultAcpModelSelection(catalog(), "withdrawn"), /默认模型不在/);
  assert.throws(() => defaultAcpModelSelection([], "6-sol"), /默认模型不在/);
  const saved = defaultAcpModelSelection(catalog(), "6-sol");
  const calls: unknown[] = [];
  const good = await restoreAcpConfigOptions(
    saved,
    catalog(),
    undefined,
    async (id, value) => {
      calls.push([id, value]);
      return catalog().map((item) =>
        item.id === id ? ({ ...item, currentValue: value } as AcpConfigOption) : item,
      );
    },
    () => {},
  );
  assert.equal(good.incomplete, false);
  assert.deepEqual(calls, [["model", "6-sol"]]);
  const ignored = await restoreAcpConfigOptions(
    saved,
    catalog(),
    undefined,
    async () => catalog(),
    () => {},
  );
  assert.equal(ignored.incomplete, true);
});

function fixture() {
  const calls: string[] = [];
  const control = {
    loadMatching: false,
    early: false,
    reject: false,
    resetModelOnPermission: false,
    wait: undefined as Promise<void> | undefined,
    onSet: undefined as (() => void) | undefined,
    exit: undefined as ((reason: string) => void) | undefined,
    closed: 0,
  };
  const saved = catalog().map((option): AcpConfigOption => {
    const value = {
      mode: "full",
      collaboration_mode: "plan",
      reasoning_effort: "high",
      model: "6-sol",
      fast: true,
    }[option.id];
    return option.type === "boolean"
      ? { ...option, currentValue: Boolean(value) }
      : {
          ...option,
          currentValue: String(value),
          options: [...option.options, { value: String(value), name: String(value) }],
        };
  });
  const connect: AcpConnectionFactory = async ({ sessionId, onUpdate, onExit }) => {
    control.exit = onExit;
    let options = sessionId && control.loadMatching ? structuredClone(saved) : catalog();
    if (control.early) await onUpdate({ kind: "config", configOptions: options });
    return {
      sessionId: sessionId ?? "native-config",
      configOptions: options,
      modeState: null,
      async setConfigOption(id, value) {
        calls.push(`${id}:${value}`);
        control.onSet?.();
        await control.wait;
        if (control.reject) throw new Error("fixture rejected config");
        options = options.map((option): AcpConfigOption => {
          if (control.resetModelOnPermission && id === "mode" && option.id === "model")
            return select("model", "5.6-sol", ["5.6-sol", "6-sol"]);
          if (id === "model" && option.id === "reasoning_effort")
            return select("reasoning_effort", "medium", ["medium", "high"], "thought_level");
          if ((id === "model" || id === "collaboration_mode") && option.id === "mode")
            return select("mode", "agent", ["agent", "full"]);
          if (option.id !== id) return option;
          return option.type === "boolean"
            ? { ...option, currentValue: Boolean(value) }
            : { ...option, currentValue: String(value) };
        });
        await onUpdate({ kind: "config", configOptions: options });
        return options;
      },
      async setMode() {},
      async prompt() {
        calls.push("prompt");
      },
      async cancel() {},
      close() {
        control.closed++;
      },
    };
  };
  return { calls, control, connect };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-config-restore-"));
  const f = fixture();
  const services: ReturnType<typeof createAcpService>[] = [];
  const open = () => {
    const service = createAcpService({ directory, connect: f.connect });
    services.push(service);
    return service;
  };
  const first = open();
  const session = await first.create({ ...target, agent: "codex" });
  for (const [configId, value] of [
    ["model", "6-sol"],
    ["reasoning_effort", "high"],
    ["collaboration_mode", "plan"],
    ["fast", true],
    ["mode", "full"],
  ] as const)
    await first.setConfigOption({ ...target, id: session.id, configId, value });
  f.calls.length = 0;
  const saved = await first.read({ ...target, id: session.id });
  return {
    ...f,
    first,
    open,
    saved,
    input: { ...target, id: session.id },
    path: join(directory, `${session.id}.json`),
    async close() {
      await Promise.all(services.map((service) => service.disposeAllAndWait()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const values = (options: AcpConfigOption[]) =>
  Object.fromEntries(options.map((option) => [option.id, option.currentValue]));

test("Composer ACP model preference crosses clients and restart without changing history or internal creates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-model-preference-"));
  const f = fixture();
  const preferences = createComposerPreferenceService(join(directory, "preferences"));
  const first = createAcpService({
    directory,
    connect: f.connect,
    composerPreferenceService: preferences,
  });
  let second: ReturnType<typeof createAcpService> | undefined;
  try {
    const historical = await first.create({ ...target, agent: "codex" });
    const selected = await first.create({ ...target, agent: "codex", useModelPreference: true });
    await first.setConfigOption({
      ...target,
      id: selected.id,
      configId: "model",
      value: "6-sol",
      rememberModel: true,
    });
    assert.equal((await preferences.get(target)).acpModels.codex?.value, "6-sol");
    await first.disposeAllAndWait();
    second = createAcpService({
      directory,
      connect: f.connect,
      composerPreferenceService: createComposerPreferenceService(join(directory, "preferences")),
    });
    const inherited = await second.create({ ...target, agent: "codex", useModelPreference: true });
    assert.equal(values(inherited.configOptions).model, "6-sol");
    assert.equal(
      values((await second.create({ ...target, agent: "codex" })).configOptions).model,
      "5.6-sol",
    );
    assert.equal(
      values((await second.refresh({ ...target, id: historical.id })).configOptions).model,
      "5.6-sol",
    );
    f.control.reject = true;
    await assert.rejects(
      second.setConfigOption({
        ...target,
        id: inherited.id,
        configId: "model",
        value: "5.6-sol",
        rememberModel: true,
      }),
    );
    assert.equal((await preferences.get(target)).acpModels.codex?.value, "6-sol");
    f.control.reject = false;
    await preferences.update({
      ...target,
      commandId: crypto.randomUUID(),
      acpModel: { agent: "codex", configId: "model", value: "removed" },
    });
    assert.equal(
      values(
        (await second.create({ ...target, agent: "codex", useModelPreference: true }))
          .configOptions,
      ).model,
      "5.6-sol",
    );
    assert.equal(
      (await preferences.get(target)).acpModels.codex?.value,
      "removed",
      "unavailable new-task hints remain repairable without overwriting the saved intent",
    );
  } finally {
    await first.disposeAllAndWait();
    await second?.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
const restoredCalls = [
  "model:6-sol",
  "collaboration_mode:plan",
  "reasoning_effort:high",
  "fast:true",
  "mode:full",
];

test("Host restart freezes choices before early load updates and restores model, effort, collaboration and permission", async () => {
  const f = await setup();
  try {
    await f.first.disposeAllAndWait();
    f.control.early = true;
    const restarted = f.open();
    const updated = await restarted.refreshSummary(f.input);
    assert.equal(updated.acpSessionId, f.saved.acpSessionId);
    assert.deepEqual(values(updated.configOptions), values(f.saved.configOptions));
    assert.deepEqual(f.calls, restoredCalls);
    assert.deepEqual(
      values((await readPersistedAcpSession(f.path)).configOptions),
      values(f.saved.configOptions),
    );
    await restarted.refreshSummary(f.input);
    assert.deepEqual(f.calls, restoredCalls);
  } finally {
    await f.close();
  }
});

test("interrupted process reconnect and concurrent prompt wait for configuration restoration", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    f.control.exit?.("fixture interrupted");
    f.control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refreshed = f.first.refreshSummary(f.input);
    const prompted = f.first.prompt({ ...f.input, commandId: "resume", text: "continue" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.calls.includes("prompt"), false);
    release();
    await Promise.all([refreshed, prompted]);
    assert.deepEqual(f.calls, [...restoredCalls, "prompt"]);
    assert.deepEqual(
      values((await f.first.read(f.input)).configOptions),
      values(f.saved.configOptions),
    );
  } finally {
    release?.();
    await f.close();
  }
});

test("matching native selections do not send redundant config commands", async () => {
  const f = await setup();
  try {
    await f.first.disposeAllAndWait();
    f.control.loadMatching = true;
    const updated = await f.open().refresh(f.input);
    assert.deepEqual(values(updated.configOptions), values(f.saved.configOptions));
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});

test("permission restoration cannot silently reset the restored model", async () => {
  const f = await setup();
  try {
    await f.first.disposeAllAndWait();
    f.control.resetModelOnPermission = true;
    const restarted = f.open();
    await assert.rejects(restarted.refreshSummary(f.input), /configuration changed/);
    assert.deepEqual(
      values((await restarted.read(f.input)).configOptions),
      values(f.saved.configOptions),
    );
  } finally {
    await f.close();
  }
});

test("failed restoration preserves saved choices, blocks prompt and permits explicit retry", async () => {
  const f = await setup();
  try {
    await f.first.disposeAllAndWait();
    f.control.early = true;
    f.control.reject = true;
    const restarted = f.open();
    await assert.rejects(
      restarted.prompt({ ...f.input, commandId: "fail", text: "fixture" }),
      /saved configuration/,
    );
    assert.equal(f.calls.includes("prompt"), false);
    assert.deepEqual(
      values((await restarted.read(f.input)).configOptions),
      values(f.saved.configOptions),
    );
    assert.deepEqual(
      values((await readPersistedAcpSession(f.path)).configOptions),
      values(f.saved.configOptions),
    );
    f.control.reject = false;
    assert.deepEqual(
      values((await restarted.refresh(f.input)).configOptions),
      values(f.saved.configOptions),
    );
  } finally {
    await f.close();
  }
});

test("a disposed generation cannot apply later config options or publish a ready snapshot", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    await f.first.disposeAllAndWait();
    f.control.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restarted = f.open();
    const started = new Promise<void>((resolve) => {
      f.control.onSet = resolve;
    });
    const refreshed = restarted.refreshSummary(f.input);
    await started;
    restarted.disposeAll();
    release();
    await assert.rejects(refreshed, /changed while restoring/);
    assert.deepEqual(f.calls, ["model:6-sol"]);
    assert.deepEqual(
      values((await readPersistedAcpSession(f.path)).configOptions),
      values(f.saved.configOptions),
    );
  } finally {
    release?.();
    await f.close();
  }
});

test("restore helper rejects incompatible values and trusts full returned catalogs without resurrecting removed options", async () => {
  const saved = catalog();
  const errors: string[] = [];
  const result = await restoreAcpConfigOptions(
    saved,
    [select("model", "6-sol", ["5.6-sol", "6-sol"]), select("fast", "off", ["off"])],
    "mode",
    async () => [],
    (id) => errors.push(id),
  );
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.configOptions, []);
  assert.equal(errors.includes("mode"), false);
  assert.ok(errors.includes("fast"));
  assert.ok(errors.includes("reasoning_effort"));
  const unconfirmed = await restoreAcpConfigOptions(
    [select("model", "6-sol", ["5.6-sol", "6-sol"])],
    [select("model", "5.6-sol", ["5.6-sol", "6-sol"])],
    undefined,
    async () => [select("model", "5.6-sol", ["5.6-sol", "6-sol"])],
    () => {},
  );
  assert.equal(unconfirmed.incomplete, true);
  assert.equal(unconfirmed.configOptions[0]?.currentValue, "5.6-sol");
  const unsupported = await restoreAcpConfigOptions(
    [select("model", "6-sol", ["6-sol"])],
    [select("model", "5.6-sol", ["5.6-sol"])],
    undefined,
    async () => {
      throw new Error("invalid choice must not reach the Agent");
    },
    () => {},
  );
  assert.equal(unsupported.incomplete, true);
  assert.equal(unsupported.configOptions[0]?.currentValue, "5.6-sol");
});
