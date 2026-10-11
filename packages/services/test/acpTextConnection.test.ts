import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import type { AcpConnectionPort } from "../src/acp/acpServiceImpl.js";

test("isolated Claude wire disables tools/settings/MCP and refuses Host terminal creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-text-wire-"));
  const script = join(directory, "adapter.cjs");
  let port: AcpConnectionPort | undefined;
  await writeFile(
    script,
    `
    const fs = require('node:fs'); const path = require('node:path');
    const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
    let promptId;
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message = JSON.parse(line);
      if(message.method === 'initialize') {
        fs.writeFileSync(path.join(process.cwd(),'initialize.json'),JSON.stringify(message.params));
        send({id:message.id,result:{protocolVersion:1,agentCapabilities:{}}});
      } else if(message.method === 'session/new') {
        fs.writeFileSync(path.join(process.cwd(),'new.json'),JSON.stringify(message.params));
        send({id:message.id,result:{sessionId:'aux'}});
      } else if(message.method === 'session/prompt') {
        promptId = message.id;
        send({id:'terminal',method:'terminal/create',params:{sessionId:'aux',command:process.execPath,args:['-e','process.exit(0)']}});
      } else if(message.id === 'terminal') {
        if(!message.error) throw new Error('terminal unexpectedly allowed');
        send({method:'session/update',params:{sessionId:'aux',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Summary'}}}});
        send({id:promptId,result:{stopReason:'end_turn'}});
      }
    });
  `,
  );
  let text = "";
  try {
    port = await connectAcpAgent({
      agent: "claude",
      workspacePath: directory,
      textOnly: true,
      launch: { command: process.execPath, args: [script], env: process.env },
      onUpdate: async (update) => {
        if (update.kind === "text") text += update.text;
      },
      onPermission: async () => {
        throw new Error("text run must not request user permission");
      },
      onExit: () => {},
    });
    await port.prompt("Summarize only");
    assert.equal(text, "Summary");
    const initialize = JSON.parse(await readFile(join(directory, "initialize.json"), "utf8"));
    assert.equal(initialize.clientCapabilities.terminal, false);
    const created = JSON.parse(await readFile(join(directory, "new.json"), "utf8"));
    assert.deepEqual(created.mcpServers, []);
    assert.deepEqual(created._meta.claudeCode.options.tools, []);
    assert.deepEqual(created._meta.claudeCode.options.mcpServers, {});
    assert.deepEqual(created._meta.claudeCode.options.settingSources, []);
    assert.equal(created._meta.claudeCode.options.settings.disableAllHooks, true);
    assert.equal(created._meta.claudeCode.options.permissionMode, "default");
  } finally {
    port?.close();
    await port?.closed;
    await rm(directory, { recursive: true, force: true });
  }
});
