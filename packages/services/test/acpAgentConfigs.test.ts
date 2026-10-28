import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACP_AGENT_CATALOG,
  acpSessionSchema,
  type AcpConfigOption,
  type AcpSession,
} from "@zcode/shared";
import {
  createAcpService,
  type AcpConnectionFactory,
  type AcpUpdate,
} from "../src/acp/acpServiceImpl.js";
import { AcpSessionStore } from "../src/acp/acpSessionStore.js";

const target = { workspacePath: "/fixture/new-project", workspaceIdentity: "fixture:new" };
const model = (value: string): AcpConfigOption => ({
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: value,
  options: [{ value, name: value }],
});

function snapshot(input: Partial<AcpSession>): AcpSession {
  return acpSessionSchema.parse({
    ...target,
    id: randomUUID(),
    agent: "codex",
    acpSessionId: "native-fixture",
    status: "idle",
    revision: 1,
    title: "Private fixture title",
    entries: [{ id: "private", kind: "user", text: "Private fixture content" }],
    pendingPermission: null,
    error: null,
    ...input,
  });
}

async function persist(directory: string, session: AcpSession, at: number) {
  const path = join(directory, `${session.id}.json`);
  await writeFile(path, JSON.stringify(session));
  await utimes(path, at, at);
  return path;
}

test("cold model catalogs read journal metadata without repairing a writer's unfinished tail or connecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-journal-models-"));
  const saved = snapshot({ configOptions: [model("old")] });
  const path = await persist(directory, saved, 1);
  const store = new AcpSessionStore(() => path);
  const current = await store.read(saved.id);
  current.revision++;
  current.configOptions = [model("new")];
  await store.commit(store.capture(current));
  await appendFile(`${path}.journal`, '{"inflight":');
  const before = await readFile(`${path}.journal`);
  const service = createAcpService({
    directory,
    connect: async () => {
      throw new Error("must not connect");
    },
  });
  try {
    assert.deepEqual(await service.listAgentModels({ agent: "codex" }), [
      { slug: "new", name: "new" },
    ]);
    assert.deepEqual(await readFile(`${path}.journal`), before);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("model catalogs remain isolated for all 15 built-in ACP agents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-all-model-catalogs-"));
  const service = createAcpService({
    directory,
    connect: async () => {
      throw new Error("Must not connect");
    },
  });
  try {
    for (const { id: agent } of ACP_AGENT_CATALOG)
      await persist(directory, snapshot({ agent, configOptions: [model(`${agent}-model`)] }), 1);
    for (const { id: agent } of ACP_AGENT_CATALOG)
      assert.deepEqual(await service.listAgentModels({ agent }), [
        { slug: `${agent}-model`, name: `${agent}-model` },
      ]);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Claude settings model list projects latest Host metadata without connecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-claude-models-"));
  const service = createAcpService({
    directory,
    connect: async () => {
      throw new Error("Must not connect");
    },
  });
  try {
    assert.deepEqual(await service.listAgentModels({ agent: "claude" }), []);
    await persist(directory, snapshot({ agent: "claude", configOptions: [model("old")] }), 1);
    const option: AcpConfigOption = {
      ...model("sonnet"),
      type: "select",
      options: [
        { value: "sonnet", name: "Custom Sonnet" },
        {
          group: "more",
          name: "More",
          options: [
            { value: "opus", name: "Custom Opus" },
            { value: "sonnet", name: "Duplicate" },
          ],
        },
      ],
    };
    await persist(
      directory,
      snapshot({ agent: "claude", workspacePath: "/fixture/other", configOptions: [option] }),
      2,
    );
    await persist(
      directory,
      snapshot({ agent: "codex", configOptions: [model("wrong-agent")] }),
      3,
    );
    assert.deepEqual(await service.listAgentModels({ agent: "claude" }), [
      { slug: "sonnet", name: "Custom Sonnet" },
      { slug: "opus", name: "Custom Opus" },
    ]);
    assert.deepEqual(await service.listAgentModels({ agent: "codex" }), [
      { slug: "wrong-agent", name: "wrong-agent" },
    ]);
    await assert.rejects(service.listAgentModels({ agent: "invalid" } as never));
    await assert.rejects(service.listAgentModels({ agent: "claude", extra: true } as never));
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP agent catalogs reuse target-Host worktree metadata without connecting or changing history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-agent-catalog-"));
  let connections = 0;
  const connect: AcpConnectionFactory = async () => {
    connections++;
    throw new Error("Catalog reads must not connect");
  };
  const service = createAcpService({ directory, connect });
  try {
    const older = snapshot({
      workspacePath: "/fixture/old-project",
      configOptions: [model("old")],
    });
    const newer = snapshot({
      workspacePath: "/fixture/trees/abcd/project",
      configOptions: [model("worktree-model")],
    });
    const claude = snapshot({
      agent: "claude",
      workspacePath: "/fixture/claude-project",
      configOptions: [],
      modeState: {
        currentModeId: "manual",
        availableModes: [
          { id: "manual", name: "Manual" },
          { id: "plan", name: "Plan" },
        ],
      },
    });
    const paths = await Promise.all([
      persist(directory, older, 1),
      persist(directory, newer, 2),
      persist(directory, claude, 3),
    ]);
    const originals = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    await writeFile(join(directory, `${randomUUID()}.json`), "invalid fixture JSON");
    const files = await readdir(directory);
    const catalog = await service.listAgentConfigs(target);
    assert.equal(connections, 0);
    assert.equal(catalog.length, 2);
    assert.deepEqual(
      catalog.find((item) => item.agent === "codex"),
      {
        agent: "codex",
        source: "host",
        configOptions: [model("worktree-model")],
        modeState: null,
      },
    );
    assert.deepEqual(catalog.find((item) => item.agent === "claude")?.modeState, claude.modeState);
    assert.equal(JSON.stringify(catalog).includes("Private fixture"), false);
    assert.equal(JSON.stringify(catalog).includes("/fixture/"), false);
    assert.deepEqual(await readdir(directory), files);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8"))), originals);

    const local = snapshot({ configOptions: [model("project-model")] });
    await persist(directory, local, 0.5);
    assert.equal(
      (await service.listAgentConfigs(target)).find((item) => item.agent === "codex")?.source,
      "workspace",
    );
    assert.deepEqual(
      (await service.listAgentConfigs(target)).find((item) => item.agent === "codex")
        ?.configOptions,
      [model("project-model")],
    );
    assert.equal(
      (await service.listAgentConfigs({ ...target, workspaceIdentity: "fixture:another" })).find(
        (item) => item.agent === "codex",
      )?.source,
      "host",
      "a path match alone is not a same-workspace configuration",
    );
    await assert.rejects(service.listAgentConfigs({ workspacePath: "" }));
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP agent catalogs include existing provisional sessions and notify only configuration changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-agent-catalog-live-"));
  let update!: (update: AcpUpdate) => Promise<void>;
  let connections = 0;
  const connect: AcpConnectionFactory = async ({ onUpdate }) => {
    connections++;
    update = onUpdate;
    return {
      sessionId: "native-provisional",
      configOptions: [model("live-model")],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        await onUpdate({ kind: "text", text: "Synthetic reply" });
      },
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({ directory, connect });
  let changes = 0;
  const subscription = service.onDynamicAgentConfigsChanged()(() => {
    changes++;
  });
  try {
    assert.deepEqual(await service.listAgentConfigs(target), []);
    const draft = await service.create({ ...target, agent: "codex", deferPersistence: true });
    assert.equal(changes, 1);
    assert.deepEqual((await service.listAgentConfigs(target))[0].configOptions, [
      model("live-model"),
    ]);
    assert.equal(connections, 1, "catalog reads must reuse metadata, not attach another session");
    assert.equal(
      (await readdir(directory)).some((file) => file === `${draft.id}.json`),
      false,
    );
    await service.prompt({
      ...target,
      id: draft.id,
      text: "Synthetic prompt",
      commandId: "synthetic",
    });
    assert.equal(changes, 1, "ordinary messages and status updates must not reload catalogs");
    await update({ kind: "config", configOptions: [model("updated-model")] });
    assert.equal(changes, 2);
    await update({ kind: "config", configOptions: [model("updated-model")] });
    assert.equal(changes, 2, "identical catalogs must not publish duplicate notifications");
    await service.remove({ ...target, id: draft.id });
    assert.equal(changes, 3);
    assert.deepEqual(await service.listAgentConfigs(target), []);
  } finally {
    subscription.dispose();
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
