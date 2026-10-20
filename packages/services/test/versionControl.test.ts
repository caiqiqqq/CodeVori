import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { createCredentialService } from "../src/credential/credentialService.js";
import { createVersionControlRepo } from "../src/git/repo/versionControlRepo.js";
import { createVersionControlService } from "../src/git/versionControlService.js";
import { createGitCommandProvider } from "../src/git/providers/gitCommandProvider.js";
import { validateForgeCredential } from "../src/git/providers/forgeCredentialProvider.js";
import { setDataBaseDir, getDataBaseDir } from "../src/paths.js";
import {
  createGitCredentialEnv,
  matchingGitAccounts,
} from "../src/git/providers/gitCredentialProvider.js";

async function fixture(
  t: test.TestContext,
  fetcher: typeof fetch = async () => new Response(JSON.stringify({ login: "tester" })),
) {
  const root = await mkdtemp(join(tmpdir(), "zcode-version-control-"));
  let stored: string | null = null;
  let failSave = false;
  const credentials = {
    async load() {
      return stored;
    },
    async save(_key: string, value: string) {
      if (failSave) throw new Error("storage failed");
      stored = value;
    },
    async delete() {
      stored = null;
    },
  };
  const repo = createVersionControlRepo({
    credentialService: credentials,
    lockPath: join(root, "lock"),
  });
  const service = createVersionControlService({ repo, fetcher });
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    repo,
    service,
    failSave: () => {
      failSave = true;
    },
  };
}

test("forge validators use explicit providers, normalized servers, exact endpoints and safe headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/self")) return new Response(JSON.stringify({ scopes: ["api"] }));
    return new Response(JSON.stringify({ login: "tester", username: "tester", avatar_url: null }), {
      headers: { "x-oauth-scopes": "repo, read:org" },
    });
  };
  const publicUser = await validateForgeCredential(
    "github",
    "https://github.com",
    "synthetic-token",
    fetcher,
  );
  assert.deepEqual(publicUser.scopes, ["repo", "read:org"]);
  await validateForgeCredential(
    "github",
    "https://enterprise.example.invalid",
    "synthetic-token",
    fetcher,
  );
  const gitlabUser = await validateForgeCredential(
    "gitlab",
    "https://forge.example.invalid/base",
    "synthetic-token",
    fetcher,
  );
  assert.deepEqual(gitlabUser.scopes, ["api"]);
  await validateForgeCredential(
    "gitea",
    "https://forge.example.invalid",
    "synthetic-token",
    fetcher,
  );
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.github.com/user",
      "https://enterprise.example.invalid/api/v3/user",
      "https://forge.example.invalid/base/api/v4/user",
      "https://forge.example.invalid/base/api/v4/personal_access_tokens/self",
      "https://forge.example.invalid/api/v1/user",
    ],
  );
  assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), "Bearer synthetic-token");
  assert.equal(new Headers(calls[2].init?.headers).get("PRIVATE-TOKEN"), "synthetic-token");
  assert.equal(new Headers(calls[4].init?.headers).get("Authorization"), "token synthetic-token");
  assert.ok(calls.every((call) => call.init?.redirect === "error" && call.init.signal));
});

test("accounts return no secrets, serialize concurrent writes and preserve identity during rotation", async (t) => {
  const { service, repo } = await fixture(t);
  await Promise.all([
    service.addGitAccount({
      provider: "github",
      serverUrl: "github.com",
      secret: "first-synthetic-token",
    }),
    service.addGitAccount({
      provider: "git",
      serverUrl: "https://git.example.invalid",
      username: "other",
      secret: "second-synthetic-token",
    }),
  ]);
  let settings = await service.getVersionControlSettings();
  assert.equal(settings.accounts.length, 2);
  assert.equal(settings.accounts.filter((a) => a.isDefault).length, 1);
  assert.equal(JSON.stringify(settings).includes("synthetic-token"), false);
  const github = settings.accounts.find((a) => a.provider === "github")!;
  settings = await service.rotateGitAccount({
    accountId: github.id,
    secret: "rotated-synthetic-token",
  });
  assert.deepEqual(
    settings.accounts.find((a) => a.id === github.id),
    github,
  );
  assert.equal(
    (await repo.read()).accounts.find((a) => a.id === github.id)?.secret,
    "rotated-synthetic-token",
  );
  const generic = settings.accounts.find((a) => a.provider === "git")!;
  assert.deepEqual(await service.testGitAccount({ accountId: generic.id }), {
    success: true,
    kind: "stored",
  });
  settings = await service.setDefaultGitAccount({ accountId: github.id });
  assert.equal(settings.accounts.find((a) => a.id === github.id)?.isDefault, true);
  settings = await service.removeGitAccount({ accountId: github.id });
  assert.equal(settings.accounts.length, 1);
  assert.equal(settings.accounts[0].isDefault, true);
});

test("invalid credentials, unsafe URLs and storage failures never replace accepted state", async (t) => {
  const { service, failSave } = await fixture(t);
  await service.addGitAccount({
    provider: "github",
    serverUrl: "https://github.com",
    secret: "synthetic-token",
  });
  const before = await service.getVersionControlSettings();
  for (const serverUrl of [
    "file:///tmp",
    "https://user:password@example.invalid",
    "https://example.invalid?token=secret",
    "https://example.invalid#fragment",
  ]) {
    await assert.rejects(
      service.addGitAccount({
        provider: "git",
        serverUrl,
        username: "test",
        secret: "synthetic-token",
      }),
    );
  }
  await assert.rejects(
    service.addGitAccount({
      provider: "git",
      serverUrl: "https://git.example.invalid",
      username: "",
      secret: "synthetic-token",
    }),
  );
  failSave();
  await assert.rejects(
    service.rotateGitAccount({ accountId: before.accounts[0].id, secret: "new-synthetic-token" }),
  );
  assert.deepEqual(await service.getVersionControlSettings(), before);
  const bad = await validateForgeCredential(
    "github",
    "https://github.com",
    "synthetic-token",
    async () => new Response("do not expose this", { status: 401 }),
  );
  assert.equal(bad.success, false);
  assert.equal(bad.error, "authentication");
  assert.equal(JSON.stringify(bad).includes("expose"), false);
});

test("rotation rejects another forge identity and stale responses after deletion", async (t) => {
  let response: () => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ login: "tester" }));
  const { service } = await fixture(t, async () => response());
  const {
    accounts: [account],
  } = await service.addGitAccount({
    provider: "github",
    serverUrl: "https://github.com",
    secret: "synthetic-token",
  });
  response = () => new Response(JSON.stringify({ login: "different" }));
  await assert.rejects(
    service.rotateGitAccount({ accountId: account.id, secret: "different-synthetic-token" }),
  );
  let finish!: (value: Response) => void;
  response = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const rotation = service.rotateGitAccount({
    accountId: account.id,
    secret: "new-synthetic-token",
  });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await service.removeGitAccount({ accountId: account.id });
  finish(new Response(JSON.stringify({ login: "tester" })));
  await assert.rejects(rotation);
  assert.equal((await service.getVersionControlSettings()).accounts.length, 0);
});

test("custom path is checked before save and running providers read path changes", async (t) => {
  const { service, repo } = await fixture(t);
  const provider = createGitCommandProvider({
    getConfiguredGitPath: async () => (await repo.read()).customPath,
  });
  const original = await provider.resolveGitBinary();
  assert.ok(original);
  assert.ok(isAbsolute(original), "discovery must return the actual installation path");
  assert.equal((await service.detectGit()).path, original);
  await assert.rejects(service.updateGitPath({ path: "relative/git" }));
  await assert.rejects(service.updateGitPath({ path: process.execPath }));
  const systemPath = (
    await promisify(execFile)(process.platform === "win32" ? "where" : "which", ["git"])
  ).stdout
    .trim()
    .split(/\r?\n/)[0]!;
  const detection = await service.updateGitPath({ path: systemPath });
  assert.equal(detection.installed, true);
  assert.equal(detection.path, systemPath);
  assert.equal(await provider.resolveGitBinary(), systemPath);
  const result = await provider.run({ cwd: process.cwd(), args: ["--version"] });
  assert.equal(result.binaryPath, systemPath);
  assert.equal((await service.updateGitPath({ path: "" })).path, original);
  assert.equal(await provider.resolveGitBinary(), original);
});

test("configuration is persisted through the existing encrypted private store", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-vc-encrypted-"));
  const original = getDataBaseDir();
  setDataBaseDir(root);
  t.after(async () => {
    setDataBaseDir(original);
    await rm(root, { recursive: true, force: true });
  });
  const repo = createVersionControlRepo({
    credentialService: createCredentialService(),
    lockPath: join(root, "vc-lock"),
  });
  const service = createVersionControlService({ repo });
  await service.addGitAccount({
    provider: "git",
    serverUrl: "https://git.example.invalid",
    username: "tester",
    secret: "encrypted-synthetic-secret",
  });
  const raw = await readFile(join(root, ".zcode/v2/credentials.json"), "utf8");
  assert.equal(raw.includes("encrypted-synthetic-secret"), false);
  assert.ok(raw.includes("enc:v1:"));
  assert.equal((await repo.read()).accounts[0].secret, "encrypted-synthetic-secret");
});

test("credential helper matches host, protocol, port, path and username and preserves SSH", async (t) => {
  const { service, repo } = await fixture(t);
  await service.addGitAccount({
    provider: "git",
    serverUrl: "https://git.example.invalid/team",
    username: "tester",
    secret: "helper-synthetic-secret",
  });
  const { accounts } = await repo.read();
  for (const remote of [
    "https://git.example.invalid.attacker.invalid/team/repo",
    "http://git.example.invalid/team/repo",
    "https://git.example.invalid:8443/team/repo",
    "https://git.example.invalid/team-other/repo",
    "https://other@git.example.invalid/team/repo",
    "git@git.example.invalid:team/repo",
    "https://%FF@git.example.invalid/team/repo",
  ]) {
    assert.deepEqual(matchingGitAccounts(accounts, remote), []);
    assert.deepEqual(createGitCredentialEnv(accounts, [remote], {}), {});
  }
  const remote = "https://git.example.invalid/team/repo";
  assert.equal(matchingGitAccounts(accounts, remote).length, 1);
  const environment = createGitCredentialEnv(accounts, [remote], { GIT_CONFIG_COUNT: "1" });
  assert.equal(environment.GIT_CONFIG_KEY_1, `credential.${remote}.helper`);
  assert.equal(environment.GIT_CONFIG_COUNT, "5");
  assert.equal(
    JSON.stringify(
      Object.entries(environment).filter(([key]) => key !== "ZCODE_GIT_CREDENTIALS"),
    ).includes("helper-synthetic-secret"),
    false,
  );
  const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn("git", ["credential", "fill"], {
      env: {
        ...process.env,
        ...createGitCredentialEnv(accounts, [remote], {}),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end("protocol=https\nhost=git.example.invalid\npath=team/repo\n\n");
  });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes("username=tester\npassword=helper-synthetic-secret"));
});

test("actual Git push uses the stored credential for pushDefault without sending it to upstream", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-vc-push-"));
  const previous = getDataBaseDir();
  setDataBaseDir(root);
  const headers: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    headers.push(request.headers.authorization);
    if (!request.headers.authorization) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="ZCode test"' });
      response.end();
    } else {
      // Authentication round trip only; there is no remote repository to mutate.
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    setDataBaseDir(previous);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const remote = `http://127.0.0.1:${address.port}/team/repo.git`;
  const git = promisify(execFile);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  };
  await git("git", ["init", "-q", root], { env });
  await git(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=ZCode Test",
      "-c",
      "user.email=zcode@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "test",
    ],
    { env },
  );
  await git(
    "git",
    ["-C", root, "remote", "add", "origin", "https://upstream.example.invalid/repo"],
    { env },
  );
  await git("git", ["-C", root, "remote", "add", "target", remote], { env });
  await git("git", ["-C", root, "config", "remote.pushDefault", "target"], { env });
  await createVersionControlService().addGitAccount({
    provider: "git",
    serverUrl: `http://127.0.0.1:${address.port}/team`,
    username: "tester",
    secret: "push-synthetic-token",
  });
  const result = await createGitCommandProvider().run({
    cwd: root,
    args: ["push"],
    credentialRemote: "origin",
    env: {
      ...env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "push.default",
      GIT_CONFIG_VALUE_0: "current",
    },
    timeoutMs: 5_000,
  });
  assert.notEqual(result.exitCode, 0, "Synthetic remote intentionally has no repository");
  assert.ok(
    headers.includes(`Basic ${Buffer.from("tester:push-synthetic-token").toString("base64")}`),
  );
  assert.equal(
    result.stdout.includes("push-synthetic-token") ||
      result.stderr.includes("push-synthetic-token") ||
      JSON.stringify(result.args).includes("push-synthetic-token"),
    false,
  );
});
