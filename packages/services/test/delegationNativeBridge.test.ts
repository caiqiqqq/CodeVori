import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, type DelegationApiAgent } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp, delegationProtocolServer } from "../src/delegation/delegationMcp.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";

test("native stdio reverse requests receive scoped capability and stop reaches the delegation owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-native-"));
  const parent = { workspacePath: directory, kind: "api" as const, sessionId: "parent" };
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "codex", ready: true, enabled: true }],
    execute: async () => {
      throw new Error("not scheduled");
    },
    deliver: async () => false,
  });
  const bridge = createDelegationMcp(directory, service);
  const file = join(directory, "agent.mjs");
  await writeFile(
    file,
    `import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
let readId;
createInterface({input:process.stdin}).on('line', async line => {
  const message=JSON.parse(line);
  if(message.method==='session/events') { readId=message.id; send({id:'invalid',method:'interaction/requestDelegationMcp',params:{sessionId:'parent',workspacePath:'/untrusted'}}); }
  else if(message.id==='invalid') {
    if(message.error?.code!==-32602) throw new Error('reverse schema accepted untrusted path');
    send({id:'mcp',method:'interaction/requestDelegationMcp',params:{sessionId:'parent'}});
  } else if(message.id==='mcp') {
    const server=message.result[0];
    const env=Object.fromEntries(server.env.map(item=>[item.name,item.value]));
    const response=await fetch(env.ZCODE_WORKFLOW_URL,{method:'POST',headers:{authorization:'Bearer '+env.ZCODE_WORKFLOW_TOKEN,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'DelegateTask',arguments:{title:'Native委派',task:'检查',execution:{kind:'acp',agent:'codex',config:[]},intent:'analysis'}}})});
    const rpc=await response.json(); if(rpc.result.isError) throw new Error(rpc.result.content[0].text);
    send({id:'stop',method:'interaction/pauseDelegations',params:{sessionId:'parent'}});
  } else if(message.id==='stop') {
    if(message.error) throw new Error('stop owner rejected');
    send({id:readId,result:{events:[]}});
  }
});`,
  );
  const resolved: Array<{ workspacePath: string; sessionId: string }> = [];
  const agent = createZCodeAgentService({
    requestTimeoutMs: 5000,
    commandResolver: () => ({ command: process.execPath, args: [file] }),
    resolveDelegationMcp: async (workspace, sessionId) => {
      resolved.push({ workspacePath: workspace.workspacePath, sessionId });
      const registration = (await bridge.register({ ...workspace, kind: "api", sessionId }))!;
      return [delegationProtocolServer(registration.record)];
    },
    pauseDelegations: (workspace, sessionId) =>
      service.pauseParent({ ...workspace, kind: "api", sessionId }),
  });
  try {
    assert.deepEqual(
      await agent.readSessionEvents({ workspacePath: directory, sessionId: parent.sessionId }),
      [],
    );
    assert.deepEqual(resolved, [{ workspacePath: directory, sessionId: parent.sessionId }]);
    assert.equal((await service.list(parent))[0]!.status, "canceled");
    assert.deepEqual(await service.list({ ...parent, sessionId: "another" }), []);
  } finally {
    await agent.disposeAllAndWait();
    bridge.dispose();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("API child reverse request uses durable creation identity before the session binding ACK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-api-child-"));
  const target: DelegationApiAgent = {
    kind: "api",
    providerName: "Fixture",
    execution: {
      kind: "api",
      mode: "build",
      modelSelection: {
        providerId: "fixture",
        modelId: "model",
        options: { reasoningLevel: "high" },
      },
    },
    reasoningLevels: ["high"],
  };
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [],
    apiTargets: async () => [target],
    execute: async () => {
      throw new Error("not scheduled");
    },
    deliver: async () => false,
  });
  const parent = { workspacePath: directory, kind: "acp" as const, sessionId: "parent" };
  const task = await service.delegate({
    ...parent,
    requestId: uuidv7(),
    title: "Child",
    task: "检查",
    background: "",
    constraints: "",
    expectedResult: "",
    execution: target.execution,
    intent: "analysis",
    dependsOn: [],
  });
  assert.equal(task.session, undefined);
  const bridge = createDelegationMcp(directory, service);
  const file = join(directory, "agent.mjs");
  await writeFile(
    file,
    `import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
let readId;
createInterface({input:process.stdin}).on('line', async line => {
  const message=JSON.parse(line);
  if(message.method==='session/events') { readId=message.id; send({id:'mcp',method:'interaction/requestDelegationMcp',params:{sessionId:'api-child',createRequestId:${JSON.stringify(task.sessionRequestId)}}}); }
  else if(message.id==='mcp') {
    if(message.error) throw new Error(JSON.stringify(message.error));
    const env=Object.fromEntries(message.result[0].env.map(item=>[item.name,item.value]));
    const response=await fetch(env.ZCODE_WORKFLOW_URL,{method:'POST',headers:{authorization:'Bearer '+env.ZCODE_WORKFLOW_TOKEN,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
    const rpc=await response.json();
    if(JSON.stringify(rpc.result.tools.map(tool=>tool.name))!==JSON.stringify(['SubmitDelegationResult'])) throw new Error('API child received parent tools');
    send({id:readId,result:{events:[]}});
  }
});`,
  );
  const identities: string[] = [];
  const agent = createZCodeAgentService({
    requestTimeoutMs: 5000,
    commandResolver: () => ({ command: process.execPath, args: [file] }),
    resolveDelegationMcp: async (workspace, sessionId, createRequestId) => {
      identities.push(createRequestId!);
      const registration = (await bridge.register(
        { ...workspace, kind: "api", sessionId },
        createRequestId,
      ))!;
      return [delegationProtocolServer(registration.record)];
    },
  });
  try {
    assert.deepEqual(
      await agent.readSessionEvents({ workspacePath: directory, sessionId: "api-child" }),
      [],
    );
    assert.deepEqual(identities, [task.sessionRequestId]);
    assert.equal(
      await service.binding(
        { ...parent, kind: "acp", sessionId: "wrong-kind" },
        task.sessionRequestId,
      ),
      undefined,
    );
    assert.equal(
      await service.binding(
        { ...parent, workspacePath: "/different", kind: "api", sessionId: "api-child" },
        task.sessionRequestId,
      ),
      undefined,
    );
    await service.updateSettings({
      workspacePath: directory,
      concurrency: 2,
      maxDepth: 2,
      allowNested: true,
    });
    const nested = (await bridge.register(
      { ...parent, kind: "api", sessionId: "api-child" },
      task.sessionRequestId,
    ))!;
    assert.equal(nested.canDelegate, true);
  } finally {
    await agent.disposeAllAndWait();
    bridge.dispose();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
