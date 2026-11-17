import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { AcpAgent, AcpConfigOption, NativeMcpServerRecord } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { createCredentialServiceWithReferenceReader } from "../src/credential/credentialService.js";
import { CredentialVaultRepository } from "../src/credential/credentialVaultRepository.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";

const secret = "fixture-password-never-include-in-context";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(
  t: TestContext,
  options: { agent?: AcpAgent; legacy?: boolean; mode?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "codevori-acp-credential-secret-"));
  const previousDataBaseDir = getDataBaseDir();
  setDataBaseDir(directory);
  const repository = new CredentialVaultRepository(
    join(directory, ".codevori", "v2", "credential-vault.sqlite"),
  );
  let decryptCalls = 0;
  const credentials = createCredentialServiceWithReferenceReader({
    vaultRepository: repository,
    cipherProvider: {
      encrypt(value) {
        return Buffer.from(value).toString("base64");
      },
      decrypt(value) {
        decryptCalls += 1;
        return Buffer.from(value, "base64").toString("utf8");
      },
    },
  });
  const workspace = {
    workspacePath: join(directory, "workspace"),
    workspaceIdentity: "workspace:one",
    remoteSessionId: "attachment:one",
  };
  let server: NativeMcpServerRecord | undefined;
  let action: () => Promise<void> = async () => {};
  let publishMode!: (value: string) => Promise<void>;
  let promptText = "";
  const agent = options.agent ?? "codex";
  const modes =
    agent === "claude"
      ? ["default", "acceptEdits", "plan", "auto", "bypassPermissions"]
      : ["read-only", "workspace-write", "agent", "agent-full-access"];
  let mode = options.mode ?? modes[0];
  const configOptions = (): AcpConfigOption[] =>
    options.legacy
      ? []
      : [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: mode,
            options: modes.map((value) => ({ value, name: value })),
          },
        ];
  const connect: AcpConnectionFactory = async ({ workflowServers, onUpdate }) => {
    server = workflowServers?.find((item) => item.name === "zcode-credentials");
    publishMode = async (value) => {
      mode = value;
      await onUpdate(
        options.legacy
          ? { kind: "mode", modeId: value }
          : { kind: "config", configOptions: configOptions() },
      );
    };
    return {
      sessionId: "fixture-native-session",
      configOptions: configOptions(),
      modeState: {
        currentModeId: mode,
        availableModes: modes.map((id) => ({ id, name: id })),
      },
      async setConfigOption(_id, value) {
        mode = String(value);
        return configOptions();
      },
      async setMode(value) {
        mode = value;
      },
      async prompt(_text, blocks) {
        promptText = (blocks ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        await action();
      },
      async cancel() {},
      close() {},
    };
  };
  const reader = credentials.credentialVaultReferenceReader;
  const service = createAcpService({ directory, connect, credentialVaultReferenceReader: reader });
  t.after(async () => {
    service.disposeAll();
    repository.close();
    setDataBaseDir(previousDataBaseDir);
    await rm(directory, { recursive: true, force: true });
  });
  const save = credentials.service.saveVaultEntry!;
  const input = {
    name: "Custom test server",
    kind: "测试服务器",
    environment: "test" as const,
    host: "server.example.invalid",
    port: 22,
    username: "root",
    workspaceIdentity: null,
    secret,
  };
  const entry = await save(input);
  const session = await service.create({ ...workspace, agent });
  const target = { ...workspace, id: session.id };
  const call = async (args: Record<string, unknown>, name = "ReadCredentialSecret") => {
    const env = server?.config.env;
    assert.ok(env?.ZCODE_WORKFLOW_URL && env.ZCODE_WORKFLOW_TOKEN);
    const response = await fetch(env.ZCODE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const rpc = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ type: string; text: string }> };
    };
    return { isError: rpc.result.isError === true, value: JSON.parse(rpc.result.content[0]!.text) };
  };
  const read = () => service.read(target);
  const permission = async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const snapshot = await read();
      if (snapshot.pendingPermission) return snapshot.pendingPermission;
      await setTimeout(10);
    }
    throw new Error("Credential permission was not presented");
  };
  const send = (run: () => Promise<void>) => {
    action = run;
    return service.prompt({
      ...target,
      commandId: crypto.randomUUID(),
      text: "Connect to the saved test server",
    });
  };
  const allow = async () => {
    const pending = await permission();
    await service.decide({ ...target, requestId: pending.requestId, optionId: "allow" });
  };
  return {
    service,
    reader,
    target,
    entry,
    input,
    save,
    call,
    read,
    permission,
    send,
    allow,
    chooseMode: (value: string) => service.setConfigOption({ ...target, configId: "mode", value }),
    publishMode: (value: string) => publishMode(value),
    get decryptCalls() {
      return decryptCalls;
    },
    get promptText() {
      return promptText;
    },
  };
}

// 产品依据：凭证读取复用 Host 已确认的会话权限；完全访问免确认，其他模式保持逐次授权。
for (const agent of ["codex", "claude"] as const) {
  for (const legacy of [false, true]) {
    test(
      `${agent} ${legacy ? "legacy mode" : "config option"} full access reads credentials without a permission card`,
      { timeout: 5_000 },
      async (t) => {
        const f = await fixture(t, { agent, legacy });
        await f.chooseMode(agent === "codex" ? "agent-full-access" : "bypassPermissions");
        let result: Awaited<ReturnType<typeof f.call>> | undefined;
        await f.send(async () => {
          result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
        });
        assert.equal(result?.isError, false);
        assert.equal(result?.value.secret, secret);
        assert.equal(f.decryptCalls, 1);
        assert.equal((await f.read()).pendingPermission, null);
        assert.doesNotMatch(f.promptText, /fixture-password/);
        assert.doesNotMatch(JSON.stringify(await f.read()), /fixture-password/);
        const idle = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
        assert.equal(idle.isError, true);
        assert.equal(f.decryptCalls, 1);
      },
    );
  }
}

for (const [agent, modes] of [
  ["codex", ["read-only", "workspace-write", "agent"]],
  ["claude", ["default", "acceptEdits", "plan", "auto"]],
] as const) {
  for (const mode of modes) {
    test(`${agent} ${mode} requires credential approval before decryption`, async (t) => {
      const f = await fixture(t, { agent, mode });
      let result: Awaited<ReturnType<typeof f.call>> | undefined;
      const turn = f.send(async () => {
        result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
      });
      const pending = await f.permission();
      assert.equal(f.decryptCalls, 0);
      await f.service.decide({ ...f.target, requestId: pending.requestId, optionId: "reject" });
      await turn;
      assert.equal(result?.isError, true);
      assert.equal(f.decryptCalls, 0);
    });
  }
}

test("switching out of full access immediately restores credential approval despite a stale legacy mode", async (t) => {
  const f = await fixture(t, { mode: "agent-full-access" });
  await f.send(async () => {
    const result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
    assert.equal(result.isError, false);
  });
  await f.chooseMode("agent");
  assert.equal((await f.read()).modeState?.currentModeId, "agent-full-access");
  let result: Awaited<ReturnType<typeof f.call>> | undefined;
  const turn = f.send(async () => {
    result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
  });
  const pending = await f.permission();
  assert.equal(f.decryptCalls, 1);
  await f.service.decide({ ...f.target, requestId: pending.requestId, optionId: "reject" });
  await turn;
  assert.equal(result?.isError, true);
  assert.equal(f.decryptCalls, 1);
});

for (const phase of ["before", "after"] as const) {
  test(`revoking full access ${phase} decryption suppresses the credential result`, async (t) => {
    const f = await fixture(t, { mode: "agent-full-access" });
    const reached = deferred();
    const release = deferred();
    const original = f.reader.readSecret.bind(f.reader);
    f.reader.readSecret = async (...args) => {
      if (phase === "before") {
        reached.resolve();
        await release.promise;
      }
      const value = await original(...args);
      if (phase === "after") {
        reached.resolve();
        await release.promise;
      }
      return value;
    };
    let result: Awaited<ReturnType<typeof f.call>> | undefined;
    const turn = f.send(async () => {
      result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
    });
    await reached.promise;
    await f.publishMode("agent");
    release.resolve();
    await turn;
    assert.equal(result?.isError, true);
    assert.equal(f.decryptCalls, phase === "before" ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
  });
}

test("credential MCP decrypts one custom-type credential only after Host permission", async (t) => {
  const f = await fixture(t);
  const listed = await f.call({}, "ListCredentialReferences");
  assert.equal(listed.value[0].id, f.entry.id);
  assert.doesNotMatch(JSON.stringify(listed), /fixture-password/);
  assert.equal(f.decryptCalls, 0);
  let result: Awaited<ReturnType<typeof f.call>> | undefined;
  const turn = f.send(async () => {
    result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
  });
  const pending = await f.permission();
  assert.match(pending.title, /Custom test server/);
  assert.equal(f.decryptCalls, 0);
  assert.doesNotMatch(JSON.stringify(await f.read()), /fixture-password/);
  await f.service.decide({ ...f.target, requestId: pending.requestId, optionId: "allow" });
  await turn;
  assert.equal(result?.isError, false);
  assert.equal(result?.value.secret, secret);
  assert.equal(result?.value.kind, "测试服务器");
  assert.equal(f.decryptCalls, 1);
  assert.doesNotMatch(f.promptText, /fixture-password/);
  assert.doesNotMatch(JSON.stringify(await f.read()), /fixture-password/);
  // 每次读取独立授权；前次允许不赋予空闲连接读取密码的权限。
  const idle = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
  assert.equal(idle.isError, true);
  assert.equal(f.decryptCalls, 1);
});

for (const decision of ["reject", "stop"] as const) {
  test(`${decision} of credential permission never decrypts or returns a secret`, async (t) => {
    const f = await fixture(t);
    let result: unknown;
    const turn = f.send(async () => {
      result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
    });
    const pending = await f.permission();
    if (decision === "stop") await f.service.stop(f.target);
    else await f.service.decide({ ...f.target, requestId: pending.requestId, optionId: "reject" });
    await turn;
    assert.equal((result as { isError: boolean }).isError, true);
    assert.equal(f.decryptCalls, 0);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
    await assert.rejects(
      f.service.decide({ ...f.target, requestId: pending.requestId, optionId: "allow" }),
    );
  });
}

for (const fullAccess of [false, true]) {
  for (const phase of ["before", "after"] as const) {
    test(`stopping ${phase} Host decryption suppresses the delayed credential result (${fullAccess ? "full access" : "manual approval"})`, async (t) => {
      const f = await fixture(t);
      if (fullAccess) await f.chooseMode("agent-full-access");
      const reached = deferred();
      const release = deferred();
      const original = f.reader.readSecret.bind(f.reader);
      f.reader.readSecret = async (...args) => {
        if (phase === "before") {
          reached.resolve();
          await release.promise;
        }
        const value = await original(...args);
        if (phase === "after") {
          reached.resolve();
          await release.promise;
        }
        return value;
      };
      let result: unknown;
      const turn = f.send(async () => {
        result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
      });
      if (!fullAccess) await f.allow();
      await reached.promise;
      await f.service.stop(f.target);
      release.resolve();
      await turn;
      assert.equal((result as { isError: boolean }).isError, true);
      assert.equal(f.decryptCalls, phase === "before" ? 0 : 1);
      assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
    });
  }
}

test("a changed credential target during approval is not decrypted", async (t) => {
  const f = await fixture(t);
  let result: unknown;
  const turn = f.send(async () => {
    result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
  });
  await f.permission();
  await f.save({
    ...f.input,
    id: f.entry.id,
    secret: undefined,
    host: "replacement.example.invalid",
  });
  await f.allow();
  await turn;
  assert.equal((result as { isError: boolean }).isError, true);
  assert.equal(f.decryptCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
});

for (const fullAccess of [false, true]) {
  test(`another workspace's credential cannot be read, even with a known id (${fullAccess ? "full access" : "manual approval"})`, async (t) => {
    const f = await fixture(t);
    if (fullAccess) await f.chooseMode("agent-full-access");
    const other = await f.save({
      ...f.input,
      name: "Other workspace",
      workspaceIdentity: "workspace:two",
    });
    let result: unknown;
    await f.send(async () => {
      result = await f.call({ credentialId: other.id, purpose: "SSH login" });
    });
    assert.equal((result as { isError: boolean }).isError, true);
    assert.equal((await f.read()).pendingPermission, null);
    assert.equal(f.decryptCalls, 0);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password|Other workspace/);
  });
}

test("credential MCP hides private decryption errors", async (t) => {
  const f = await fixture(t);
  f.reader.readSecret = async () => {
    throw new Error(secret);
  };
  let result: unknown;
  const turn = f.send(async () => {
    result = await f.call({ credentialId: f.entry.id, purpose: "SSH login" });
  });
  await f.allow();
  await turn;
  assert.equal((result as { isError: boolean }).isError, true);
  assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
});
