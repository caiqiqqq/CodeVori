import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "smol-toml";
import { acpSessionSchema } from "@zcode/shared";
import { generateCodexText } from "../src/acp/acpCodexText.js";

test("native summary inherits only auth/provider settings and freezes model under a read-only ephemeral run", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-native-text-test-"));
  const home = join(root, "original");
  const directory = join(root, "auxiliary");
  await Promise.all([mkdir(home), mkdir(directory)]);
  const script = join(root, "adapter.cjs");
  await writeFile(
    script,
    `
    const fs = require('node:fs'); const path = require('node:path');
    const args = process.argv.slice(2); let prompt = '';
    process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      fs.writeFileSync(path.join(process.cwd(), 'capture.json'), JSON.stringify({args, prompt, home:process.env.CODEX_HOME, model:process.env.OPENAI_MODEL}));
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Native result');
    });
  `,
  );
  await writeFile(
    join(home, "config.toml"),
    `model="old-model"\nmodel_provider="example"\nsandbox_mode="danger-full-access"\nnotify=["dangerous"]\n[model_providers.example]\nname="Example"\nbase_url="https://provider.invalid"\nwire_api="responses"\n[mcp_servers.sideeffect]\ncommand="dangerous"\n[hooks]\ncommand="dangerous"\n`,
  );
  await writeFile(join(home, "auth.json"), '{"OPENAI_API_KEY":"synthetic-credential"}');
  const session = acpSessionSchema.parse({
    id: "source",
    workspacePath: "/synthetic/project",
    agent: "codex",
    acpSessionId: "native",
    title: "Source",
    status: "idle",
    pendingPermission: null,
    error: null,
    revision: 1,
    entries: [],
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        category: "model",
        currentValue: "dialog-model",
        options: [{ value: "dialog-model", name: "Dialog Model" }],
      },
      {
        id: "reasoning_effort",
        name: "Reasoning",
        type: "select",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ],
  });
  const original = await readFile(join(home, "config.toml"), "utf8");
  try {
    const text = await generateCodexText({
      session,
      directory,
      codexHome: home,
      launch: {
        command: process.execPath,
        args: [script],
        env: { ...process.env, OPENAI_MODEL: "wrong-model" },
      },
      prompt: "Summarize only; $(must-not-execute)",
      signal: new AbortController().signal,
    });
    assert.equal(text, "Native result");
    const capture = JSON.parse(await readFile(join(directory, "capture.json"), "utf8"));
    assert.deepEqual(capture.args.slice(0, 5), [
      "cli",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
    ]);
    assert.equal(capture.home, directory);
    assert.equal(capture.model, undefined);
    assert.equal(capture.prompt, "Summarize only; $(must-not-execute)");
    const config = parse(await readFile(join(directory, "config.toml"), "utf8"));
    assert.equal(config.model, "dialog-model");
    assert.equal(config.model_reasoning_effort, "high");
    assert.equal(config.sandbox_mode, "read-only");
    assert.equal(config.approval_policy, "never");
    assert.equal(config.model_provider, "example");
    assert.equal(config.mcp_servers, undefined);
    assert.equal(config.hooks, undefined);
    assert.equal(config.notify, undefined);
    assert.equal(
      await readFile(join(directory, "auth.json"), "utf8"),
      '{"OPENAI_API_KEY":"synthetic-credential"}',
    );
    if (process.platform !== "win32")
      assert.equal((await stat(join(directory, "auth.json"))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancel terminates an active native summary process instead of waiting for model output", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-native-cancel-test-"));
  const home = join(root, "original");
  const directory = join(root, "auxiliary");
  await Promise.all([mkdir(home), mkdir(directory)]);
  const script = join(root, "adapter.cjs");
  await writeFile(
    script,
    `const fs=require('node:fs');fs.writeFileSync('ready',String(process.pid));setInterval(()=>{},1000);process.stdin.resume();`,
  );
  const session = acpSessionSchema.parse({
    id: "source",
    workspacePath: "/synthetic/project",
    agent: "codex",
    acpSessionId: "native",
    title: "Source",
    status: "idle",
    pendingPermission: null,
    error: null,
    revision: 1,
    entries: [],
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        category: "model",
        currentValue: "dialog-model",
        options: [{ value: "dialog-model", name: "Dialog Model" }],
      },
    ],
  });
  const abort = new AbortController();
  const result = generateCodexText({
    session,
    directory,
    codexHome: home,
    launch: { command: process.execPath, args: [script], env: process.env },
    prompt: "Summary",
    signal: abort.signal,
  });
  const rejected = assert.rejects(result, /result-canceled/);
  try {
    const deadline = Date.now() + 3000;
    while (true) {
      try {
        await stat(join(directory, "ready"));
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("synthetic native process did not start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const pid = Number(await readFile(join(directory, "ready"), "utf8"));
    abort.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    abort.abort();
    await rejected;
    await rm(root, { recursive: true, force: true });
  }
});
