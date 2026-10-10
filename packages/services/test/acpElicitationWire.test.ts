import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";

test("ACP wire advertises forms, forwards answers and request cancellation, excludes replay/mismatch/unknown schemas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-form-wire-"));
  let port: Awaited<ReturnType<typeof connectAcpAgent>> | undefined;
  const calls: string[] = [];
  try {
    const path = join(directory, "agent.cjs");
    await writeFile(
      path,
      `
      const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');
      const form={mode:'form',sessionId:'native',message:'Confirm',requestedSchema:{type:'object',required:['choice'],properties:{choice:{type:'string',enum:['yes','no']}}}};
      const request=(id,params)=>send({id,method:'elicitation/create',params});
      const cases=[['wrong',{...form,sessionId:'other'}],['unknown',{...form,mode:'future'}],
        ['schema',{...form,requestedSchema:{properties:{x:{type:'object'}}}}],
        ['auth',{...form,sessionId:undefined,requestId:1}],['accept',form],['decline',form],['cancel',form],['abort',form]];
      let promptId,index=0;
      const next=()=>{if(index===cases.length) return send({id:promptId,result:{stopReason:'end_turn'}});const [id,params]=cases[index++];request(id,params);if(id==='abort') setTimeout(()=>send({method:'$/cancel_request',params:{requestId:'abort'}}),20);};
      require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
        const m=JSON.parse(line);
        if(m.method==='initialize') {
          if(!m.params.clientCapabilities.elicitation?.form || m.params.clientCapabilities.elicitation.url) throw Error('wrong capability');
          send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
        } else if(m.method==='session/load') { global.loadId=m.id;request('replay',form); }
        else if(m.method==='session/prompt') { promptId=m.id;next(); }
        else if(m.id==='replay') { if(m.result?.action!=='cancel') throw Error('history was accepted');send({id:global.loadId,result:{}}); }
        else if(cases.some(([id])=>id===m.id)) {
          if(m.error && m.id==='abort') { next();return; }
          const expected=['accept','decline'].includes(m.id)?m.id:'cancel';
          if(m.result?.action!==expected) throw Error('wrong response '+JSON.stringify(m));
          if(m.id==='accept' && m.result?.content?.choice!=='yes') throw Error('answer lost');
          next();
        }
      });
    `,
    );
    port = await connectAcpAgent({
      agent: "codex",
      sessionId: "native",
      workspacePath: directory,
      launch: { command: process.execPath, args: [path], env: process.env },
      onUpdate: async () => {},
      onPermission: async () => null,
      onExit: () => {},
      onElicitation: async (request, signal) => {
        calls.push(request.requestId);
        assert.equal(request.fields[0].key, "choice");
        if (calls.length === 1) return { action: "accept", content: { choice: "yes" } };
        if (calls.length === 2) return { action: "decline" };
        if (calls.length === 3) return { action: "cancel" };
        // Adapter handler observes the protocol request cancellation signal.
        const cancelled = new Promise<void>((resolve) =>
          signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
        // Signal cancellation is sent by the agent after a short fixture-only delay.
        await cancelled;
        return { action: "cancel" };
      },
    });
    await port.prompt("fixture");
    assert.equal(calls.length, 4);
  } finally {
    port?.close();
    await port?.closed;
    await rm(directory, { recursive: true, force: true });
  }
});
