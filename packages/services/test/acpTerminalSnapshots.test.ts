import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import { buildAcpConversationRows } from "@zcode/shared";

test("ACP Host terminal output survives idle turns and replay; restart interrupts stale handles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-terminal-snapshots-"));
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  let connections = 0;
  const stops: string[] = [];
  const workspace = {
    workspacePath: directory,
    workspaceIdentity: "fixture:terminal",
    remoteSessionId: "fixture-remote",
  };
  const connect: AcpConnectionFactory = async (input) => {
    connections++;
    update = input.onUpdate;
    return {
      sessionId: "native",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt() {
        await update({
          kind: "terminal",
          terminal: {
            terminalId: "exact",
            title: "node server",
            status: "running",
            startedAt: 10,
            output: "ready",
            truncated: false,
          },
        });
      },
      async stopTerminal(id) {
        stops.push(id);
        await update({
          kind: "terminal",
          terminal: {
            terminalId: id,
            title: "node server",
            status: "finished",
            startedAt: 10,
            output: "ready\nstopped",
            truncated: false,
            exitCode: null,
            signal: "SIGTERM",
          },
        });
      },
    };
  };
  let service = createAcpService({ directory, connect });
  try {
    const draft = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: draft.id };
    await service.prompt({
      ...target,
      commandId: "11111111-1111-4111-8111-111111111111",
      text: "start",
    });
    const idle = await service.read(target);
    assert.equal(idle.status, "idle");
    assert.equal(idle.terminals[0]?.status, "running");
    await update({
      kind: "terminal",
      terminal: { ...idle.terminals[0]!, output: "ready\nnew output" },
    });
    assert.equal((await service.read(target)).terminals[0]?.output, "ready\nnew output");
    await assert.rejects(
      service.stopTerminal({ ...target, workspaceIdentity: "fixture:other", terminalId: "exact" }),
    );
    await assert.rejects(service.stopTerminal({ ...target, terminalId: "wrong" }));
    await service.stopTerminal({ ...target, terminalId: "exact" });
    await service.stopTerminal({ ...target, terminalId: "exact" });
    assert.deepEqual(stops, ["exact"]);
    await update({
      kind: "terminal",
      terminal: { ...idle.terminals[0]!, terminalId: "restart", output: "still running" },
    });
    const crashed = await service.read(target);
    await service.disposeAllAndWait();
    // 模拟 Host 来不及写入退出状态的崩溃磁盘快照；新 Host 不能复活运行句柄。
    await writeFile(join(directory, `${draft.id}.json`), JSON.stringify(crashed));
    service = createAcpService({ directory, connect });
    const replay = await service.read(target);
    assert.equal(replay.terminals[0]?.status, "finished");
    assert.equal(replay.terminals[1]?.status, "interrupted");
    assert.equal(replay.terminals[1]?.output, "still running");
    assert.equal(connections, 1, "read and terminal controls never reconnect");
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stdio terminal output is committed by the Host and projected after replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-terminal-host-history-"));
  const agent = join(directory, "agent.cjs");
  await writeFile(
    agent,
    `
    const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
    const pending=new Map(); let next=100;
    const request=(method,params)=>new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});send({id,method,params})});
    require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{
      const m=JSON.parse(line);
      if(!m.method){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);return}
      try {
        if(m.method==='initialize') {
          if(!m.params.clientCapabilities.terminal)throw Error('terminal capability missing');
          send({id:m.id,result:{protocolVersion:1}});
        } else if(m.method==='session/new') {
          send({id:m.id,result:{sessionId:'native'}});
        } else if(m.method==='session/prompt') {
          const terminal=await request('terminal/create',{sessionId:'native',command:process.execPath,args:['-e','process.stdout.write("persisted terminal output")']});
          await request('terminal/wait_for_exit',{sessionId:'native',terminalId:terminal.terminalId});
          send({method:'session/update',params:{sessionId:'native',update:{sessionUpdate:'tool_call',toolCallId:'tool-terminal',title:'print output',status:'completed',kind:'execute',content:[{type:'terminal',terminalId:terminal.terminalId}]}}});
          send({id:m.id,result:{stopReason:'end_turn'}});
        }
      } catch(error) { send({id:m.id,error:{code:-32603,message:error.message}}); }
    });
  `,
  );
  const connect: AcpConnectionFactory = (input) =>
    connectAcpAgent({
      ...input,
      launch: { command: process.execPath, args: [agent], env: process.env },
    });
  const workspace = {
    workspacePath: directory,
    workspaceIdentity: "fixture:terminal-host-history",
    remoteSessionId: "fixture-remote",
  };
  let service = createAcpService({ directory, connect });
  try {
    const draft = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: draft.id };
    await service.prompt({
      ...target,
      commandId: "22222222-2222-4222-8222-222222222222",
      text: "run command",
    });
    const live = await service.read(target);
    assert.equal(live.terminals[0]?.output, "persisted terminal output");
    assert.equal(live.terminals[0]?.status, "finished");

    await service.disposeAllAndWait();
    service = createAcpService({ directory, connect });
    const replay = await service.read(target);
    const row = buildAcpConversationRows(replay).find((item) => item.kind === "toolCall");
    assert.ok(row?.kind === "toolCall");
    assert.equal(
      (row.input as { terminalOutput?: string }).terminalOutput,
      "persisted terminal output",
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
