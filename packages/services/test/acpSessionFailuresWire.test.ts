import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

const error = "stream disconnected before completion: idle timeout waiting for SSE";
const fakeAgent = `
const send=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\\n');
const failure=(severity,revision=1)=>({id:'incident',revision,category:'connection',severity,title:'stream disconnected before completion: idle timeout waiting for SSE',details:'provider detail',actions:severity==='error'?['retry']:[]});
const meta=f=>({jetbrains:{air:{version:1,sessionFailure:f}}});
const notify=(f,sessionId='failure-native')=>send({method:'session/update',params:{sessionId,update:{sessionUpdate:'session_info_update',_meta:meta(f)}}});
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(m.method==='initialize'){
    const air=m.params.clientCapabilities?._meta?.jetbrains?.air;
    if(air?.version!==1 || !air.capabilities.includes('sessionFailure')) throw new Error('missing failure capability');
    send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  } else if(m.method==='session/new' || m.method==='session/load') {
    notify(failure('error'));
    send({id:m.id,result:m.method==='session/new'?{sessionId:'failure-native'}:{}});
  } else if(m.method==='session/prompt') {
    notify(failure('error'),'other-native');
    notify({...failure('error'),severity:'invalid'});
    if(process.env.FAILURE_MODE==='rpc') {
      send({id:m.id,error:{code:-32603,message:'Internal error',data:{details:'readable RPC detail'}}});
    } else {
      notify(failure('warning'));
      if(process.env.FAILURE_MODE==='duplicate') notify(failure('error',2));
      send({id:m.id,result:{stopReason:'end_turn',...(process.env.FAILURE_MODE==='warning'?{}:{_meta:meta(failure('error',2))})}});
    }
  }
});
`;

test("real stdio negotiates structured failures and Host handles response-only, duplicate, warning and RPC errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-failure-wire-"));
  const agent = join(directory, "agent.cjs");
  let service: ReturnType<typeof createAcpService> | undefined;
  try {
    await writeFile(agent, fakeAgent);
    for (const mode of ["response", "duplicate", "warning", "rpc"]) {
      const connect = (input) =>
        connectAcpAgent({
          ...input,
          launch: {
            command: process.execPath,
            args: [agent],
            env: { ...process.env, FAILURE_MODE: mode },
          },
        });
      service = createAcpService({ directory: join(directory, mode), connect });
      const workspace = { workspacePath: directory, workspaceIdentity: `fixture:${mode}` };
      const created = await service.create({ ...workspace, agent: "codex" });
      const target = { ...workspace, id: created.id };
      assert.deepEqual(created.entries, [], "new-session replay must be ignored");
      const turn = service.prompt({ ...target, commandId: "turn", text: "fixture" });
      if (mode === "rpc") await assert.rejects(turn, /Internal error/);
      else await turn;
      const snapshot = await service.read(target);
      assert.equal(snapshot.status, mode === "warning" ? "idle" : "interrupted");
      assert.equal(
        snapshot.error,
        mode === "warning" ? null : mode === "rpc" ? "readable RPC detail" : error,
      );
      const user = snapshot.entries.find((e) => e.kind === "user")!;
      assert.equal(user.failures?.length, 1, "notification and response upsert same incident");
      assert.equal(user.failures?.[0]?.severity, mode === "warning" ? "warning" : "error");
      assert.equal(
        snapshot.entries.some((e) => e.kind === "assistant"),
        false,
        "errors are never synthetic replies",
      );
      await service.disposeAllAndWait();
      service = createAcpService({ directory: join(directory, mode), connect });
      await service.refresh(target);
      assert.deepEqual(
        (await service.read(target)).entries,
        snapshot.entries,
        "load replay must not duplicate notices",
      );
      await service.disposeAllAndWait();
      service = undefined;
    }
  } finally {
    await service?.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
