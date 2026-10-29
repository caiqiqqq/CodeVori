import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";

test(
  "stdio cancel drains entered updates, rejects late permission and reuses the same session",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "acp-stop-wire-"));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const updates: string[] = [];
    let permissions = 0;
    let port: Awaited<ReturnType<typeof connectAcpAgent>> | undefined;
    try {
      const script = join(directory, "agent.cjs");
      await writeFile(
        script,
        `
      const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...value})+'\\n');
      const notify = text => send({method:'session/update',params:{sessionId:'same-native',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
      let promptId, count=0;
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const message=JSON.parse(line);
        if(message.method==='initialize') send({id:message.id,result:{protocolVersion:1}});
        else if(message.method==='session/new') send({id:message.id,result:{sessionId:'same-native'}});
        else if(message.method==='session/prompt') {
          if(message.params.sessionId!=='same-native') throw Error('session changed');
          if(++count===1) {
            promptId=message.id;
            send({id:'old-permission',method:'session/request_permission',params:{sessionId:'same-native',toolCall:{toolCallId:'old-tool',title:'old permission',status:'pending'},options:[{optionId:'allow',name:'allow',kind:'allow_once'}]}});
          } else {
            notify('fresh answer');
            send({id:message.id,result:{stopReason:'end_turn'}});
          }
        } else if(message.method==='session/cancel') {
          notify('cancel observed');
          send({id:promptId,result:{stopReason:'cancelled'}});
          notify('late after terminal');
        } else if(message.method==='session/set_config_option') send({id:message.id,result:{configOptions:[]}});
      });
    `,
      );
      port = await connectAcpAgent({
        agent: "codex",
        workspacePath: directory,
        launch: { command: process.execPath, args: [script], env: process.env },
        onUpdate: async (update) => {
          if (update.kind === "tool") {
            entered.resolve();
            await release.promise;
          }
          if (update.kind === "text") {
            updates.push(update.text);
          }
        },
        onPermission: async () => {
          permissions++;
          return "allow";
        },
        onExit: () => {},
      });
      let finished = false;
      const first = port.prompt("first").then(() => {
        finished = true;
      });
      await entered.promise;
      // A later RPC response proves the reader crossed the prompt terminal while
      // its earlier tool callback is still deliberately blocked.
      await port.cancel();
      await port.setConfigOption("barrier", "unused");
      assert.equal(finished, false);
      release.resolve();
      await first;
      assert.equal(port.lastStopReason, "cancelled");
      assert.equal(permissions, 0);
      assert.deepEqual(updates, []);
      await port.prompt("second");
      assert.equal(port.lastStopReason, "end_turn");
      assert.deepEqual(updates, ["fresh answer"]);
    } finally {
      release.resolve();
      port?.close();
      await port?.closed;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
