import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpTerminals } from "../src/acp/acpTerminals.js";
import type { AcpTerminal } from "@zcode/shared";

test("ACP terminal argv/cwd/env, bounded UTF-8 output and exit remain readable until release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-terminals-"));
  const updates: AcpTerminal[] = [];
  const terminals = new AcpTerminals(directory, process.env, async (terminal) => {
    updates.push(terminal);
  });
  try {
    const { terminalId } = await terminals.create({
      sessionId: "native",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(process.cwd()+'|'+process.env.ACP_TEST+'|'+process.argv[1]+'|界界界')",
        "$(literal)",
      ],
      env: [{ name: "ACP_TEST", value: "test" }],
      outputByteLimit: 8,
    });
    assert.deepEqual(await terminals.wait(terminalId), { exitCode: 0, signal: null });
    const output = terminals.output(terminalId);
    assert.equal(output.output, "界界");
    assert.equal(output.truncated, true);
    assert.equal(Buffer.byteLength(output.output) <= 8, true);
    assert.equal(output.output.includes("�"), false);
    assert.equal(updates.at(-1)?.status, "finished");
    await terminals.release(terminalId);
    assert.throws(() => terminals.output(terminalId), /terminal/i);
    assert.equal(updates.at(-1)?.status, "released");
    const second = await terminals.create({
      sessionId: "native",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(process.cwd()+'|'+process.env.ACP_TEST+'|'+process.argv[1])",
        "$(literal)",
      ],
      env: [{ name: "ACP_TEST", value: "test" }],
    });
    await terminals.wait(second.terminalId);
    assert.equal(
      terminals.output(second.terminalId).output,
      (await realpath(directory)) + "|test|$(literal)",
    );
  } finally {
    await terminals.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "ACP terminal kill is idempotent and disposal kills owned process trees",
  { timeout: 30000 },
  async () => {
    const updates: AcpTerminal[] = [];
    const terminals = new AcpTerminals(tmpdir(), process.env, async (terminal) => {
      updates.push(terminal);
    });
    try {
      const { terminalId } = await terminals.create({
        sessionId: "native",
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      });
      await terminals.kill(terminalId);
      await terminals.kill(terminalId);
      assert.equal(terminals.output(terminalId).exitStatus?.signal != null, true);
      assert.equal(updates.at(-1)?.status, "finished");
      const running = await terminals.create({
        sessionId: "native",
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      });
      const exited = terminals.wait(running.terminalId);
      await terminals.dispose();
      await exited;
      assert.equal(updates.at(-1)?.status, "interrupted");
      await assert.rejects(
        terminals.create({ sessionId: "native", command: process.execPath }),
        /closed/i,
      );
    } finally {
      await terminals.dispose();
    }
  },
);

test(
  "ACP terminal stop reaps a SIGTERM-resistant command and its inherited-output child",
  { timeout: 30000 },
  async () => {
    let ready!: (pid: number) => void;
    const childReady = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const terminals = new AcpTerminals(tmpdir(), process.env, async (terminal) => {
      const match = terminal.output.match(/CHILD:(\d+)/);
      if (match) ready(Number(match[1]));
    });
    try {
      const script =
        "process.on('SIGTERM',()=>{});process.stdout.write('CHILD:'+process.pid);setInterval(()=>{},1000)";
      const { terminalId } = await terminals.create({
        sessionId: "native",
        command: process.execPath,
        args: [
          "-e",
          "process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e'," +
            JSON.stringify(script) +
            "],{stdio:'inherit'});setInterval(()=>{},1000)",
        ],
      });
      const pid = await childReady;
      await terminals.kill(terminalId);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.equal(terminals.output(terminalId).exitStatus?.signal, "SIGKILL");
    } finally {
      await terminals.dispose();
    }
  },
);
