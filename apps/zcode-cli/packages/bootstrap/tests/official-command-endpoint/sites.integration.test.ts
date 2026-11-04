import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createOfficialCommandEndpoint } from "../../src/official-command-endpoint/index.js";

it("the real Sites CLI deploys a local stage through session endpoint auth and streams its package", async () => {
  const root = await mkdtemp(join(tmpdir(), "sites-local-integration-"));
  const seen: { method: string; path: string; auth?: string }[] = [];
  let packageBytes = 0;
  const deployment = {
    id: "deployment-1",
    siteId: "site-1",
    status: "preparing",
    artifactSize: 0,
    failure: null,
  };
  const site = {
    id: "site-1",
    name: "fixture",
    domainLabel: "fixture-1",
    url: "https://fixture.example.invalid",
    status: "pending",
    region: "cn",
    currentDeployment: null as unknown,
    latestDeployment: null as unknown,
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const path = req.url!.split("?")[0];
    seen.push({ method: req.method!, path, auth: req.headers.authorization });
    let data: unknown;
    if (path === "/api/v1/sites/usage") data = { plan: "free", canDeploy: true };
    else if (path === "/api/v1/sites" && req.method === "GET")
      data = { items: [], nextCursor: null };
    else if (path === "/api/v1/sites" && req.method === "POST") data = site;
    else if (path === "/api/v1/sites/site-1/deployments" && req.method === "POST") {
      deployment.artifactSize = JSON.parse(body.toString()).artifactSize;
      site.latestDeployment = deployment;
      data = deployment;
    } else if (path?.endsWith("/package") && req.method === "PUT") {
      packageBytes = body.length;
      expect(req.headers["content-type"]).toBe("application/gzip");
      deployment.status = "success";
      site.status = "online";
      site.currentDeployment = deployment;
      data = deployment;
    } else if (path?.endsWith("/logs")) data = { entries: [], nextOffset: 0, done: true };
    else if (path === "/api/v1/sites/site-1") data = site;
    else data = deployment;
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ code: 0, msg: "success", data, logid: "fixture" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = createOfficialCommandEndpoint({
    appVersion: "fixture",
    fetch: globalThis.fetch,
    resolveZCodeApiOrigin: () => `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    resolveHeaders: async () => ({
      ok: true,
      headers: { Authorization: "Bearer host-only-fixture" },
    }),
  });
  try {
    await mkdir(join(root, "stage"));
    await writeFile(join(root, "stage/start.sh"), "exec node static-server.mjs .\n");
    await writeFile(join(root, "stage/index.html"), "<h1>Local test only</h1>");
    const env = await endpoint.envForSession("session-fixture", {
      workspacePath: root,
      workspaceIdentity: "remote:fixture",
    });
    const cli = fileURLToPath(
      new URL("../../../zcode-site-plugin/scripts/zcode-site.mjs", import.meta.url),
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [cli, "deploy", "stage", "--name", "fixture", "--new", "--quiet"],
      { cwd: root, env: { ...process.env, ...env }, timeout: 15_000 },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      siteId: "site-1",
      deploymentId: "deployment-1",
      status: "success",
    });
    expect(packageBytes).toBeGreaterThan(0);
    expect(packageBytes).toBe(deployment.artifactSize);
    expect(seen.every((entry) => entry.auth === "Bearer host-only-fixture")).toBe(true);
    expect(stdout).not.toContain("host-only-fixture");
    expect(JSON.parse(await readFile(join(root, ".zcode-site.json"), "utf8"))).toMatchObject({
      siteId: "site-1",
    });
  } finally {
    await endpoint.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
