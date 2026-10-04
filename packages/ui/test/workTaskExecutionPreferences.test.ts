import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelSelectionView } from "@zcode/services";
import type { AcpAgentAvailability, WorkTaskExecution } from "@zcode/shared";
import {
  createWorkTaskExecutionPreferenceStore,
  resolveWorkTaskExecutionPreference,
} from "../src/store/workTaskExecutionPreferenceStore.js";

const scope = { workspacePath: "/project" };
const codex: WorkTaskExecution = {
  kind: "acp",
  agent: "codex",
  config: [
    { configId: "model", value: "codex-model" },
    { configId: "reasoning", value: "low" },
    { configId: "fast", value: false },
  ],
};
const api: WorkTaskExecution = {
  kind: "api",
  mode: "plan",
  modelSelection: { providerId: "api", modelId: "model", options: { reasoningLevel: "low" } },
};
const view = {
  revision: 1,
  preferredSelection: { providerId: "api", modelId: "model", options: { reasoningLevel: "high" } },
  providers: [{ providerId: "api", providerName: "API", models: [{ modelId: "model" }] }],
} as ModelSelectionView;
const agents = [{ agent: "codex", enabled: true, ready: true }] as AcpAgentAvailability[];
const fallback = { kind: "api", mode: "build", modelSelection: view.preferredSelection };
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("API and ACP explicit choices survive store recreation without task data", () => {
  const storage = memoryStorage();
  const store = createWorkTaskExecutionPreferenceStore(storage);
  assert.equal(store.getState().read(scope), null);
  const executions: WorkTaskExecution[] = [
    codex,
    api,
    { kind: "acp", agent: "claude", config: [] },
  ];
  for (const execution of executions) {
    store.getState().remember(scope, execution);
    assert.deepEqual(
      createWorkTaskExecutionPreferenceStore(storage).getState().read(scope),
      execution,
    );
  }
  assert.equal(storage.data.size, 1);
  const [key, value] = [...storage.data][0]!;
  assert.match(key, /:v1:/);
  assert.deepEqual(JSON.parse(value), { kind: "acp", agent: "claude", config: [] });
});

test("project identity and Host isolate defaults with the local path fallback", () => {
  const store = createWorkTaskExecutionPreferenceStore(memoryStorage());
  store.getState().remember(scope, codex);
  assert.deepEqual(store.getState().read({ ...scope, workspaceIdentity: " " }), codex);
  assert.equal(store.getState().read({ workspacePath: "/other" }), null);
  const remote = { ...scope, workspaceIdentity: " remote-project ", remoteSessionId: " host-a " };
  store.getState().remember(remote, api);
  assert.deepEqual(
    store.getState().read({
      ...remote,
      workspacePath: "/alias",
      workspaceIdentity: "remote-project",
      remoteSessionId: "host-a",
    }),
    api,
  );
  assert.equal(store.getState().read({ ...remote, remoteSessionId: "host-b" }), null);
  assert.equal(store.getState().read({ ...scope, remoteSessionId: "host-a" }), null);
  assert.equal(store.getState().read({ ...remote, workspaceIdentity: "other-project" }), null);
});

test("a reopened editor reads the latest preference written by another store", () => {
  const storage = memoryStorage();
  const first = createWorkTaskExecutionPreferenceStore(storage);
  const second = createWorkTaskExecutionPreferenceStore(storage);
  first.getState().remember(scope, codex);
  assert.deepEqual(second.getState().read(scope), codex);
  second.getState().remember(scope, api);
  assert.deepEqual(first.getState().read(scope), api);
});

test("corrupt or incompatible preferences are ignored rather than used as execution data", () => {
  const storage = memoryStorage();
  createWorkTaskExecutionPreferenceStore(storage).getState().remember(scope, codex);
  const key = [...storage.data.keys()][0]!;
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ ...codex, config: [{ configId: "fast", value: 1 }] }),
    JSON.stringify({ ...codex, title: "Not a preference" }),
    JSON.stringify({ ...codex, agent: "unknown" }),
  ]) {
    storage.data.set(key, raw);
    assert.equal(createWorkTaskExecutionPreferenceStore(storage).getState().read(scope), null);
  }
});

test("unavailable storage keeps the latest choice in memory without throwing", () => {
  for (const storage of [
    null,
    {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
    },
  ]) {
    const store = createWorkTaskExecutionPreferenceStore(storage);
    assert.equal(store.getState().read(scope), null);
    store.getState().remember(scope, codex);
    assert.deepEqual(store.getState().read(scope), codex);
    store.getState().remember(scope, { kind: "acp", agent: "codex", config: [] });
    assert.deepEqual(store.getState().read(scope), { kind: "acp", agent: "codex", config: [] });
  }
});

test("only available choices restore and fallback never changes the stored preference", () => {
  assert.deepEqual(resolveWorkTaskExecutionPreference(codex, view, agents), codex);
  assert.deepEqual(resolveWorkTaskExecutionPreference(codex, null, agents), codex);
  for (const unavailable of [
    [],
    [{ ...agents[0]!, enabled: false }],
    [{ ...agents[0]!, ready: false }],
  ])
    assert.deepEqual(resolveWorkTaskExecutionPreference(codex, view, unavailable), fallback);
  assert.deepEqual(resolveWorkTaskExecutionPreference(api, view, agents), api);
  assert.deepEqual(
    resolveWorkTaskExecutionPreference(
      { ...api, modelSelection: { providerId: "removed", modelId: "model" } },
      view,
      agents,
    ),
    fallback,
  );
  assert.deepEqual(
    resolveWorkTaskExecutionPreference(
      { ...api, modelSelection: { providerId: "api", modelId: "removed" } },
      view,
      agents,
    ),
    fallback,
  );
  assert.equal(resolveWorkTaskExecutionPreference(api, null, []), null);
  assert.deepEqual(resolveWorkTaskExecutionPreference(null, view, []), fallback);
  assert.deepEqual(codex.config.at(-1), { configId: "fast", value: false });
});
