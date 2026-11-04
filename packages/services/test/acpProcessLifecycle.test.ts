import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import { AcpTerminals } from "../src/acp/acpTerminals.js";

const fixture = `
const fs = require('node:fs');
const send = message => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...message })+'\\n');
const child = require('node:child_process').spawn(process.execPath, ['-e',
  "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('ready');"
], { stdio:['ignore','ignore','ignore','ipc'] });
const ready = new Promise(resolve => child.once('message', resolve));
require('node:readline').createInterface({input:process.stdin}).on('line', async line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    await ready;
    fs.writeFileSync(process.env.ACP_CHILD_PID, String(child.pid));
    send({id:message.id, result:{protocolVersion:1,agentCapabilities:{}}});
  } else if (message.method === 'session/new') {
    if (process.env.ACP_FAIL_INIT === '1') send({id:message.id,error:{code:-32603,message:'fixture init failed'}});
    else send({id:message.id,result:{sessionId:'fixture'}});
  } else if (message.method === 'session/prompt') process.exit(7);
});
`;

for (const mode of [
  "close",
  "unexpected-exit",
  "initialization-failure",
  "terminal-failure",
] as const) {
  test(
    `ACP ${mode} waits for TERM-resistant descendants after root exit`,
    {
      skip: process.platform === "win32",
      timeout: 15_000,
    },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "acp-tree-lifecycle-"));
      const script = join(root, "agent.cjs");
      const pidFile = join(root, "child.pid");
      let port: Awaited<ReturnType<typeof connectAcpAgent>> | undefined;
      let childPid: number | undefined;
      let exits = 0;
      if (mode === "terminal-failure")
        t.mock.method(AcpTerminals.prototype, "dispose", async () => {
          throw new Error("fixture terminal cleanup failed");
        });
      try {
        await writeFile(script, fixture);
        const connection = connectAcpAgent({
          agent: "codex",
          workspacePath: root,
          launch: {
            command: process.execPath,
            args: [script],
            env: {
              ...process.env,
              ACP_CHILD_PID: pidFile,
              ACP_FAIL_INIT: mode === "initialization-failure" ? "1" : "0",
            },
          },
          onUpdate: async () => {},
          onPermission: async () => null,
          onExit: () => {
            exits += 1;
          },
        });
        if (mode === "initialization-failure") {
          await assert.rejects(connection, /fixture init failed/);
        } else {
          port = await connection;
          const completion = port.closed;
          if (mode === "close" || mode === "terminal-failure") {
            port.close();
            port.close();
            assert.equal(port.closed, completion);
          } else {
            await assert.rejects(port.prompt("exit root"), /exited|退出|closed/i);
          }
          if (mode === "terminal-failure")
            await assert.rejects(
              completion,
              (error) =>
                error instanceof AggregateError &&
                error.errors.some((cause) => cause.message === "fixture terminal cleanup failed"),
            );
          else await completion;
          assert.equal(exits, mode === "unexpected-exit" ? 1 : 0);
        }
        childPid = Number(await readFile(pidFile, "utf8"));
        assert.throws(() => process.kill(childPid!, 0), { code: "ESRCH" });
      } finally {
        port?.close();
        await port?.closed?.catch(() => {});
        childPid ??= Number(await readFile(pidFile, "utf8").catch(() => "0"));
        if (childPid) {
          try {
            process.kill(childPid, "SIGKILL");
          } catch {
            /* Fixture already reaped. */
          }
        }
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
