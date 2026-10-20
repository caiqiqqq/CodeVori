import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zcodeIssuesMcpResponseSchema } from "@zcode/shared";
import { createAcpWorkflowMcp } from "../src/acp/acpWorkflowMcp.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { forgeIssuesProtocolServer } from "../src/git/forgeIssuesMcp.js";

test("API reverse request validates input and binds the process workspace; proxy speaks stdio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-issues-native-"));
  const bridge = createAcpWorkflowMcp(directory);
  const file = join(directory, "agent.mjs");
  await writeFile(
    file,
    `import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
let readId;
createInterface({input:process.stdin}).on('line',async line=>{
  const m=JSON.parse(line);
  if(m.method==='session/events'){
    readId=m.id;
    send({id:'invalid',method:'interaction/requestIssuesMcp',params:{sessionId:'parent',workspacePath:'/forged'}});
  } else if(m.id==='invalid'){
    if(m.error?.code!==-32602) throw Error('accepted forged scope');
    send({id:'issues',method:'interaction/requestIssuesMcp',params:{sessionId:'parent'}});
  } else if(m.id==='issues'){
    const s=m.result[0];
    const child=spawn(s.command,s.args,{env:{...process.env,...Object.fromEntries(s.env.map(x=>[x.name,x.value]))},stdio:['pipe','pipe','inherit']});
    createInterface({input:child.stdout}).on('line',line=>{
      const result=JSON.parse(line);
      if(result.result?.tools[0]?.name!=='GetRepository') throw Error('missing tools');
      child.stdin.end();
      send({id:readId,result:{events:[]}});
    });
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\\n');
  }
});`,
  );
  const calls: unknown[] = [];
  const agent = createZCodeAgentService({
    requestTimeoutMs: 5000,
    commandResolver: () => ({ command: process.execPath, args: [file] }),
    resolveIssuesMcp: async (workspace, sessionId) => {
      calls.push({ workspacePath: workspace.workspacePath, sessionId });
      const r = await bridge.register("zcode-issues", {
        names: ["GetRepository"],
        call: async () => ({}),
      });
      return [forgeIssuesProtocolServer(r.record)];
    },
  });
  try {
    assert.deepEqual(
      await agent.readSessionEvents({ workspacePath: directory, sessionId: "parent" }),
      [],
    );
    assert.deepEqual(calls, [{ workspacePath: directory, sessionId: "parent" }]);
    assert.equal(
      zcodeIssuesMcpResponseSchema.safeParse([
        { name: "other", command: "node", args: [], env: [], isolation: "session" },
      ]).success,
      false,
    );
  } finally {
    await agent.disposeAllAndWait();
    bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP injects issues with other MCPs, revokes on exit/detach/failure, never persists bearer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-issues-acp-"));
  let revocations = 0;
  let fail = false;
  const received: Parameters<AcpConnectionFactory>[0][] = [];
  const service = createAcpService({
    directory,
    resolveDynamicWorkflowClientConfig: async () => ({ enabled: false, mode: "disabled" }) as never,
    issuesMcp: {
      register: async () => ({
        record: {
          name: "zcode-issues",
          source: "zcodeagentmcp",
          scope: "workspace",
          config: {
            command: process.execPath,
            env: { ZCODE_WORKFLOW_TOKEN: "fixture-transient-bearer" },
          },
        },
        revoke() {
          revocations++;
        },
      }),
    },
    connect: async (input) => {
      received.push(input);
      if (fail) throw new Error("fixture connection failed");
      return {
        sessionId: "native",
        configOptions: [],
        modeState: null,
        setConfigOption: async () => [],
        setMode: async () => {},
        prompt: async () => {},
        cancel: async () => {},
        close() {},
      };
    },
  });
  try {
    const session = await service.create({ workspacePath: directory, agent: "codex" });
    assert.equal(
      received[0]!.workflowServers!.some((s) => s.name === "zcode-issues"),
      true,
    );
    assert.doesNotMatch(
      await readFile(join(directory, `${session.id}.json`), "utf8"),
      /fixture-transient-bearer|ZCODE_WORKFLOW_TOKEN/,
    );
    received[0]!.onExit?.("fixture exit");
    assert.equal(revocations, 1);
    await service.refresh({ workspacePath: directory, id: session.id });
    assert.equal(received.length, 2);
    await service.disposeAllAndWait();
    assert.equal(revocations, 2);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
  const failedDirectory = await mkdtemp(join(tmpdir(), "zcode-issues-acp-fail-"));
  fail = true;
  const failedService = createAcpService({
    directory: failedDirectory,
    resolveDynamicWorkflowClientConfig: async () => ({ enabled: false, mode: "disabled" }) as never,
    issuesMcp: {
      register: async () => ({
        record: {
          name: "zcode-issues",
          source: "zcodeagentmcp",
          scope: "workspace",
          config: { command: process.execPath },
        },
        revoke() {
          revocations++;
        },
      }),
    },
    connect: async () => {
      throw new Error("fixture connection failed");
    },
  });
  try {
    await assert.rejects(failedService.create({ workspacePath: failedDirectory, agent: "codex" }));
    assert.equal(revocations, 3);
  } finally {
    await failedService.disposeAllAndWait();
    await rm(failedDirectory, { recursive: true, force: true });
  }
});

test("ACP disposal during capability registration revokes the late result without connecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-issues-acp-stale-"));
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  let revocations = 0;
  let connections = 0;
  const service = createAcpService({
    directory,
    resolveDynamicWorkflowClientConfig: async () => ({ enabled: false, mode: "disabled" }) as never,
    issuesMcp: {
      register: async () => {
        started();
        await gate;
        return {
          record: {
            name: "zcode-issues",
            source: "zcodeagentmcp",
            scope: "workspace",
            config: { command: process.execPath },
          },
          revoke() {
            revocations++;
          },
        };
      },
    },
    connect: async () => {
      connections++;
      throw new Error("must not connect stale session");
    },
  });
  const creation = service.create({ workspacePath: directory, agent: "codex" });
  const rejected = assert.rejects(creation, /closed while registering/);
  try {
    await start;
    service.disposeAll();
    release();
    await rejected;
    assert.equal(connections, 0);
    assert.equal(revocations, 1);
  } finally {
    release();
    await rejected;
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
