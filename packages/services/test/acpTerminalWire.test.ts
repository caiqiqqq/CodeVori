import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import type { AcpUpdate } from "../src/acp/acpServiceImpl.js";

test("stdio ACP terminal methods reject wrong sessions and keep real processes after prompt completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-terminal-wire-"));
  const agent = join(directory, "agent.cjs");
  const updates: AcpUpdate[] = [];
  let port: Awaited<ReturnType<typeof connectAcpAgent>> | undefined;
  try {
    await writeFile(
      agent,
      `
      const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
      const pending=new Map(); let next=100; let turn=0;
      const request=(method,params)=>new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});send({id,method,params})});
      require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{
        const m=JSON.parse(line);
        if(!m.method){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);return}
        try {
          if(m.method==='initialize') {if(!m.params.clientCapabilities.terminal)throw Error('terminal missing');send({id:m.id,result:{protocolVersion:1}})}
          else if(m.method==='session/new')send({id:m.id,result:{sessionId:'native'}});
          else if(m.method==='session/prompt'){
            turn++;
            let denied=false;try{await request('terminal/create',{sessionId:'other',command:process.execPath})}catch{denied=true}
            if(!denied)throw Error('wrong session accepted');
            const short=await request('terminal/create',{sessionId:'native',command:process.execPath,args:['-e','process.stdout.write("界界界")'],outputByteLimit:8});
            const exited=await request('terminal/wait_for_exit',{sessionId:'native',terminalId:short.terminalId});
            const output=await request('terminal/output',{sessionId:'native',terminalId:short.terminalId});
            if(exited.exitCode!==0||output.output!=='界界'||!output.truncated)throw Error('output invalid');
            denied=false;try{await request('terminal/output',{sessionId:'other',terminalId:short.terminalId})}catch{denied=true}
            if(!denied)throw Error('cross-session output');
            await request('terminal/release',{sessionId:'native',terminalId:short.terminalId});
            const kill=await request('terminal/create',{sessionId:'native',command:process.execPath,args:['-e','setInterval(()=>{},1000)']});
            await request('terminal/kill',{sessionId:'native',terminalId:kill.terminalId});
            await request('terminal/release',{sessionId:'native',terminalId:kill.terminalId});
            await request('terminal/create',{sessionId:'native',command:process.execPath,args:['-e','setInterval(()=>{},1000)']});
            send({id:m.id,result:{stopReason:'end_turn'}});
          }
        } catch(error){send({id:m.id,error:{code:-32603,message:error.message}})}
      });
    `,
    );
    port = await connectAcpAgent({
      agent: "codex",
      workspacePath: directory,
      launch: { command: process.execPath, args: [agent], env: process.env },
      onUpdate: async (update) => {
        updates.push(update);
      },
      onPermission: async () => null,
      onExit: () => {},
    });
    await port.prompt("start");
    const terminalUpdates = () =>
      updates.filter((u): u is Extract<AcpUpdate, { kind: "terminal" }> => u.kind === "terminal");
    const live = terminalUpdates().at(-1)!.terminal;
    assert.equal(live.status, "running");
    await port.stopTerminal!(live.terminalId);
    assert.equal(terminalUpdates().at(-1)!.terminal.status, "finished");
    await port.prompt("start for cancel");
    assert.equal(terminalUpdates().at(-1)!.terminal.status, "running");
    await port.cancel();
    assert.equal(terminalUpdates().at(-1)!.terminal.status, "interrupted");
    await port.prompt("start for disconnect");
    assert.equal(terminalUpdates().at(-1)!.terminal.status, "running");
    port.close();
    await port.closed;
    assert.equal(terminalUpdates().at(-1)!.terminal.status, "interrupted");
  } finally {
    port?.close();
    await port?.closed;
    await rm(directory, { recursive: true, force: true });
  }
});
