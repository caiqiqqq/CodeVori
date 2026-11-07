// zcode-site CLI 测试：用内存里的 Sites API 替身（按 api/openapi.yaml 的状态机）代替 zcode-server 和后面的控制面。
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createServer } from "node:http";

import { createEndpointFetch, main, normalizePrefix } from "../scripts/zcode-site.mjs";
import { packStage } from "../scripts/stage.mjs";
import { readBinding } from "../scripts/site-project.mjs";

// CLI 只认 agent 注入的官方命令端点（技术方案 5.8）；身份头和版本头由端点补，CLI 不带。
import { FakeSites, project, run } from "./sites-fixture.mjs";

test("old site binding copies once and subsequent CodeVori edits stay independent", async () => {
  const cwd = await project();
  const old = join(cwd, ".zcode-site.json");
  const current = join(cwd, ".codevori-site.json");
  await writeFile(old, '{"siteId":"old"}\n');
  assert.deepEqual(await readBinding(cwd), { siteId: "old" });
  await writeFile(current, '{"siteId":"current"}\n');
  await writeFile(old, '{"siteId":"old-again"}\n');
  assert.deepEqual(await readBinding(cwd), { siteId: "current" });
  assert.equal(await readFile(old, "utf8"), '{"siteId":"old-again"}\n');
});

test("first deploy creates and binds a site, then later deploys reuse it", async () => {
  const fake = new FakeSites();
  const cwd = await project();
  const r = await run(fake, cwd, "deploy", "stage", "--name", "My App");

  assert.equal(r.code, 0, JSON.stringify(r.error));
  assert.equal(fake.sites.length, 1);
  assert.equal(fake.sites[0].name, "My App");
  assert.deepEqual(r.result, {
    siteId: fake.sites[0].id,
    deploymentId: fake.deployments[0].id,
    status: "success",
    url: fake.sites[0].url,
    failure: null,
  });
  assert.ok(r.lines.some((l) => l.event === "site_created"));
  assert.deepEqual(r.lines[0], {
    event: "packed",
    packageBytes: fake.deployments[0].artifactSize,
    unpackedBytes: 41,
    files: 2,
    linuxBinaries: 0,
  });
  assert.ok(r.lines.some((l) => l.event === "log" && l.message === "publishing"));
  const binding = JSON.parse(await readFile(join(cwd, ".codevori-site.json"), "utf8"));
  assert.deepEqual(binding, { siteId: fake.sites[0].id, domainLabel: fake.sites[0].domainLabel });

  const again = await run(fake, cwd, "deploy", "stage", "--quiet");
  assert.equal(again.code, 0);
  assert.equal(again.lines.length, 1, "--quiet prints only the result");
  assert.equal(fake.sites.length, 1);
  assert.equal(fake.deployments.length, 2);

  // skill 让首次部署统一带 --new；已绑定的项目误带时只提醒，仍部署到已绑定的站点。
  const withNew = await run(fake, cwd, "deploy", "stage", "--new");
  assert.equal(withNew.code, 0);
  assert.equal(fake.sites.length, 1);
  assert.ok(withNew.lines.some((l) => l.event === "warning" && /--new is ignored/.test(l.message)));
});

test("an unbound project does not guess among existing sites", async () => {
  const fake = new FakeSites();
  fake.site({ name: "a" });
  fake.site({ name: "b" });
  const r = await run(fake, await project(), "deploy", "stage");

  assert.equal(r.code, 1);
  assert.equal(r.error.code, "SITE_NOT_SELECTED");
  assert.deepEqual(
    r.error.data.candidates.map((c) => c.name),
    ["b", "a"],
  );
  assert.equal(fake.deployments.length, 0);

  const created = await run(fake, await project(), "deploy", "stage", "--new");
  assert.equal(created.code, 0);
  assert.equal(fake.sites.length, 3);
});

test("a 3610 for the same site that has not started publishing is resumed", async () => {
  const fake = new FakeSites();
  const site = fake.site();
  const cwd = await project();
  // 续传按包大小认同一次部署；同一个 stage 每次打出的包字节一致（tar 头用文件 mtime，gzip 头不写时间）。
  const { body } = await packStage(join(cwd, "stage"));
  const stuck = fake.deployment(site.id, { status: "uploading", artifactSize: body.length });
  const r = await run(fake, cwd, "deploy", "stage", "--site", site.id);

  assert.equal(r.code, 0, JSON.stringify(r.error));
  assert.equal(r.result.deploymentId, stuck.id);
  assert.ok(r.lines.some((l) => l.event === "deployment_started" && l.resumed === true));
});

test("a deployment in progress elsewhere is reported with exit code 3", async () => {
  const fake = new FakeSites();
  const other = fake.site();
  const mine = fake.site();
  fake.deployment(other.id, { status: "publishing" });
  const r = await run(fake, await project(), "deploy", "stage", "--site", mine.id);

  assert.equal(r.code, 3);
  assert.equal(r.error.code, 3610);
  assert.match(r.error.hint, new RegExp(other.id));
});

test("an upload the server rejects as incomplete is uploaded again", async () => {
  const fake = new FakeSites();
  fake.firstUpload = "truncate";
  const r = await run(fake, await project(), "deploy", "stage");

  assert.equal(r.code, 0, JSON.stringify(r.error));
  assert.equal(fake.uploads, 2);
  assert.equal(r.lines.filter((l) => l.event === "uploading").length, 2);
});

test("a lost upload response continues with the deployment the server already accepted", async () => {
  const fake = new FakeSites();
  fake.firstUpload = "dropResponse";
  const r = await run(fake, await project(), "deploy", "stage");

  assert.equal(r.code, 0, JSON.stringify(r.error));
  assert.equal(fake.uploads, 2); // 第二次收到 3603，CLI 查到部署已在发布，直接轮询
  assert.equal(r.result.status, "success");
});

test("a failed deployment exits 4 with the failure", async () => {
  const fake = new FakeSites();
  fake.publishPolls = 2;
  fake.publishOutcome = {
    status: "failed",
    failure: { stage: "verifying", code: "WARMUP_FAILED", message: "no 200 within 90s" },
  };
  const r = await run(fake, await project(), "deploy", "stage");

  assert.equal(r.code, 4);
  assert.equal(r.error.code, "WARMUP_FAILED");
  assert.match(r.error.hint, /start\.sh/);
  assert.equal(r.error.data.status, "failed");
});

test("a stage that fails the package contract creates nothing", async () => {
  const fake = new FakeSites();
  const cwd = await project();
  await writeFile(join(cwd, "stage", "start.sh"), "exec node server.js\r\n");
  await writeFile(join(cwd, "stage", ".env"), "SECRET=1");
  const r = await run(fake, cwd, "deploy", "stage", "--new");

  assert.equal(r.code, 1);
  assert.equal(r.error.code, "PACKAGE_CHECK_FAILED");
  assert.equal(r.error.data.problems.length, 2);
  assert.equal(fake.sites.length, 0);
  assert.equal(fake.deployments.length, 0);
});

test("local and auth errors", async () => {
  const fake = new FakeSites();
  const cwd = await project();
  assert.equal((await run(fake, cwd, "deploy", "missing")).error.code, "STAGE_NOT_FOUND");
  assert.equal((await run(fake, cwd, "deploy", "stage", "--site", "1", "--new")).code, 1);
  assert.equal((await run(fake, cwd, "nope")).error.code, "UNKNOWN_COMMAND");
  fake.unauthenticated = true;
  const r = await run(fake, cwd, "usage");
  assert.equal(r.code, 2);
  assert.equal(r.error.code, "UNAUTHENTICATED");

  fake.unauthenticated = false;
  fake.planExpired = true;
  const expired = await run(fake, cwd, "usage");
  assert.equal(expired.code, 2);
  assert.equal(expired.error.code, 3101);
  assert.match(expired.error.hint, /sign in to ZCode again/);

  const noEnv = await main(["usage"], {
    env: {},
    cwd,
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(noEnv, 2);

  fake.planExpired = false;
  fake.endpointNetworkError = true;
  const offline = await run(fake, cwd, "usage");
  assert.equal(offline.code, 4);
  assert.equal(offline.error.code, "NETWORK_ERROR");
});

test("createEndpointFetch talks HTTP over the endpoint socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-site-ep-"));
  const socketPath = join(dir, "endpoint.sock");
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      if (req.url === "/empty") return res.writeHead(204).end();
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ code: 0, data: { ok: true } }));
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    const fetchImpl = createEndpointFetch(socketPath);
    const res = await fetchImpl(
      "http://zcode-official-endpoint/api/v1/sites/1/deployments/2/package?x=1",
      {
        method: "PUT",
        headers: { Authorization: "Bearer t", "Content-Type": "application/gzip" },
        body: Buffer.from("tarball"),
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { code: 0, data: { ok: true } });
    assert.equal(seen[0].url, "/api/v1/sites/1/deployments/2/package?x=1");
    assert.equal(seen[0].headers["content-length"], "7");
    assert.equal(seen[0].headers["transfer-encoding"], undefined);
    assert.equal(seen[0].body.toString(), "tarball");
    assert.equal((await fetchImpl("http://zcode-official-endpoint/empty")).status, 204);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("status, rename, offline and online use the bound site", async () => {
  const fake = new FakeSites();
  const site = fake.site();
  const cwd = await project();
  await writeFile(
    join(cwd, ".codevori-site.json"),
    JSON.stringify({ siteId: site.id, domainLabel: site.domainLabel }),
  );

  assert.equal((await run(fake, cwd, "status")).result.id, site.id);
  assert.equal((await run(fake, cwd, "rename", "New", "Name")).result.name, "New Name");
  assert.equal((await run(fake, cwd, "offline")).result.status, "offline");
  assert.equal((await run(fake, cwd, "online")).result.status, "pending");
  fake.sites[0].currentDeployment = { id: "1", status: "success" };
  assert.equal((await run(fake, cwd, "online")).result.status, "online");
  assert.equal((await run(fake, cwd, "list")).result.sites.length, 1);
  assert.equal((await run(fake, cwd, "status", "--site", "999")).code, 1);
});

test("badge hide needs a plan that can remove the badge", async () => {
  const fake = new FakeSites();
  const site = fake.site();
  const cwd = await project();
  await writeFile(
    join(cwd, ".codevori-site.json"),
    JSON.stringify({ siteId: site.id, domainLabel: site.domainLabel }),
  );

  const denied = await run(fake, cwd, "badge", "hide");
  assert.equal(denied.code, 3);
  assert.equal(denied.error.code, 3608);
  assert.match(denied.error.hint, /paid/);

  fake.badgeRemovable = true;
  const hidden = (await run(fake, cwd, "badge", "hide")).result;
  assert.equal(hidden.badgeHidden, true);
  assert.equal(hidden.badgeVisible, false);
  assert.equal((await run(fake, cwd, "badge", "show")).result.badgeVisible, true);
  assert.equal((await run(fake, cwd, "badge")).code, 1);
});

test("--prefix is sent as domainPrefix only when the site is created", async () => {
  const fake = new FakeSites();
  const cwd = await project();
  const r = await run(
    fake,
    cwd,
    "deploy",
    "stage",
    "--name",
    "生日网站",
    "--prefix",
    "happy-birthday",
  );
  assert.equal(r.code, 0, JSON.stringify(r.error));
  assert.deepEqual(fake.createBodies, [{ name: "生日网站", domainPrefix: "happy-birthday" }]);
  assert.ok(!r.lines.some((l) => l.event === "warning"));

  // 已绑定站点：--prefix 不生效，也不再创建，只提示一次。
  const again = await run(fake, cwd, "deploy", "stage", "--prefix", "other-name");
  assert.equal(again.code, 0);
  assert.equal(fake.createBodies.length, 1);
  assert.match(again.lines.find((l) => l.event === "warning").message, /ignored/);
});

test("without --prefix the server derives the prefix from the name", async () => {
  const fake = new FakeSites();
  const r = await run(fake, await project(), "deploy", "stage", "--name", "My App");
  assert.equal(r.code, 0);
  assert.deepEqual(fake.createBodies, [{ name: "My App" }]);
});

test("a non-conforming --prefix is still sent, with a warning about the normalized result", async () => {
  const fake = new FakeSites();
  const r = await run(fake, await project(), "deploy", "stage", "--prefix", "Happy Birthday!");
  assert.equal(r.code, 0);
  assert.equal(fake.createBodies[0].domainPrefix, "Happy Birthday!");
  assert.match(r.lines.find((l) => l.event === "warning").message, /"happy-birthday"/);

  const short = await run(fake, await project(), "deploy", "stage", "--new", "--prefix", "ab");
  assert.equal(short.code, 0);
  assert.match(short.lines.find((l) => l.event === "warning").message, /"site"/);
});

test("a name that fails content review gets 3611 and nothing is linked", async () => {
  const fake = new FakeSites();
  fake.rejectNames.add("bad name");
  const cwd = await project();
  const r = await run(
    fake,
    cwd,
    "deploy",
    "stage",
    "--name",
    "bad name",
    "--prefix",
    "fine-prefix",
  );
  assert.equal(r.code, 1);
  assert.equal(r.error.code, 3611);
  assert.match(r.error.hint, /--name/);
  assert.equal(fake.deployments.length, 0);
  await assert.rejects(readFile(join(cwd, ".codevori-site.json")));

  // 改名不通过时名称不变。
  assert.equal((await run(fake, cwd, "deploy", "stage", "--name", "good")).code, 0);
  const renamed = await run(fake, cwd, "rename", "bad", "name");
  assert.equal(renamed.code, 1);
  assert.equal(renamed.error.code, 3611);
  assert.equal(fake.sites[0].name, "good");
});

test("a site whose live version was rejected by content review gets 3612 until redeployed", async () => {
  const fake = new FakeSites();
  const cwd = await project();
  assert.equal((await run(fake, cwd, "deploy", "stage")).code, 0);
  const site = fake.sites[0];
  assert.equal((await run(fake, cwd, "status")).result.offlineReason, undefined);

  // 人审驳回：服务端把站点下线并带上 offlineReason。
  Object.assign(site, { status: "offline", offlineReason: "review_rejected" });
  const status = (await run(fake, cwd, "status")).result;
  assert.equal(status.status, "offline");
  assert.equal(status.offlineReason, "review_rejected");
  const denied = await run(fake, cwd, "online");
  assert.equal(denied.code, 3);
  assert.equal(denied.error.code, 3612);
  assert.match(denied.error.hint, /deploy again/);
  assert.equal(site.status, "offline");

  // 重新部署成功后站点恢复上线。
  assert.equal((await run(fake, cwd, "deploy", "stage")).code, 0);
  const redeployed = (await run(fake, cwd, "status")).result;
  assert.equal(redeployed.status, "online");
  assert.equal(redeployed.offlineReason, undefined);
});

test("a prefix replaced by site after content review gets a warning", async () => {
  const fake = new FakeSites();
  fake.rejectPrefixes.add("bad-prefix").add("bad-name");
  const r = await run(fake, await project(), "deploy", "stage", "--prefix", "Bad Prefix");
  assert.equal(r.code, 0);
  const warnings = r.lines.filter((l) => l.event === "warning").map((l) => l.message);
  assert.ok(
    warnings.some(
      (m) => /"bad-prefix" did not pass content review/.test(m) && m.includes(r.result.url),
    ),
    warnings,
  );
  assert.match(r.result.url, /^https:\/\/site-/);

  // 没有 --prefix 时前缀来自名称，同样提示。
  const byName = await run(fake, await project(), "deploy", "stage", "--new", "--name", "Bad Name");
  assert.ok(byName.lines.some((l) => l.event === "warning" && /"bad-name"/.test(l.message)));

  // 规范化后本来就是 site 的不算机审替换，只有规范化提示。
  const short = await run(fake, await project(), "deploy", "stage", "--new", "--prefix", "ab");
  assert.equal(short.code, 0);
  assert.ok(!short.lines.some((l) => /content review/.test(l.message ?? "")));
});

test("normalizePrefix matches the server rule", () => {
  const cases = [
    ["happy-birthday", "happy-birthday"],
    ["Happy Birthday!", "happy-birthday"],
    ["-a..b--cd-", "a-b-cd"],
    ["生日快乐", "site"],
    ["ab", "site"],
    ["abcd", "abcd"],
    ["", "site"],
    ["a".repeat(40), "a".repeat(30)],
    ["a".repeat(29) + "-b", "a".repeat(29)],
  ];
  for (const [input, want] of cases) assert.equal(normalizePrefix(input), want, input);
});

test("help documents every command and option, and needs no endpoint", async () => {
  let stdout = "";
  const code = await main(["help"], {
    env: {},
    cwd: tmpdir(),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write() {} },
  });
  assert.equal(code, 0);
  const commands = [
    "check",
    "deploy",
    "status",
    "logs",
    "offline",
    "online",
    "rename",
    "badge",
    "list",
    "usage",
    "help",
  ];
  const options = [
    "--new",
    "--site",
    "--name",
    "--prefix",
    "--offset",
    "--quiet",
    "--port",
    "--allow-foreign-binaries",
  ];
  for (const word of commands) assert.match(stdout, new RegExp(`^  ${word}\\b`, "m"), word);
  for (const word of options) assert.ok(stdout.includes(word), word);
  for (const exit of ["0", "1", "2", "3", "4"])
    assert.match(stdout, new RegExp(`^  ${exit}  `, "m"));
});
