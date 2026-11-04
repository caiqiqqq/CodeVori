import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, normalizePrefix } from "../scripts/zcode-site.mjs";

const ENV = {
  ZCODE_OFFICIAL_ENDPOINT: "/tmp/zcode-official-test.sock",
  ZCODE_OFFICIAL_ENDPOINT_TOKEN: "session-token",
};

export class FakeSites {
  constructor() {
    this.sites = [];
    this.deployments = [];
    this.nextId = 1000;
    // 发布结果：上传完成之后第几次轮询进入终态、终态是什么
    this.publishPolls = 1;
    this.publishOutcome = { status: "success" };
    this.uploads = 0;
    // 第一次上传：truncate 时服务端只收到一部分（3604）；dropResponse 时服务端收完了但响应丢了（网络错误）
    this.firstUpload = undefined;
    this.unauthenticated = false;
    this.planExpired = false;
    this.endpointNetworkError = false;
    this.badgeRemovable = false;
    // 服务端机审：rejectNames 里的名称返回 3611，rejectPrefixes 里的（规范化后的）前缀换成 site。
    this.rejectNames = new Set();
    this.rejectPrefixes = new Set();
  }

  site({ prefix = "app", ...overrides } = {}) {
    const id = String(this.nextId++);
    const s = {
      id,
      name: overrides.name ?? "app",
      domainLabel: `${prefix}-${id}`,
      url: `https://${prefix}-${id}.zcode-cn.site`,
      status: "pending",
      region: "cn",
      badgeHidden: false,
      badgeVisible: true,
      currentDeployment: null,
      latestDeployment: null,
      ...overrides,
    };
    this.sites.push(s);
    return s;
  }

  deployment(siteId, overrides = {}) {
    const d = {
      id: String(this.nextId++),
      siteId,
      status: "preparing",
      artifactSize: 0,
      failure: null,
      logs: [],
      polls: 0,
      ...overrides,
    };
    this.deployments.push(d);
    return d;
  }

  view(d) {
    const { logs: _logs, polls: _polls, ...rest } = d;
    return rest;
  }

  fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (this.unauthenticated) return new Response(null, { status: 401 });
    if (this.planExpired)
      return Response.json(
        { code: 3101, msg: "coding plan is required", logid: "l" },
        { status: 403 },
      );
    if (this.endpointNetworkError) {
      return Response.json(
        { code: 2007, msg: "x", data: null, logid: "" },
        { status: 502, headers: { "X-ZCode-Official-Endpoint-Error": "network" } },
      );
    }
    assert.equal(init.headers.Authorization, "Bearer session-token");
    assert.equal(init.headers["X-ZCode-App-Version"], undefined);
    assert.equal(init.headers["X-Bigmodel-Authorization"], undefined);
    const { pathname } = new URL(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const ok = (data) => Response.json({ code: 0, msg: "success", data, logid: "l" });
    const err = (status, code, data) =>
      Response.json({ code, msg: "x", data, logid: "l" }, { status });
    const parts = pathname.split("/").slice(4); // /api/v1/sites/...

    if (pathname === "/api/v1/sites/usage") return ok({ plan: "free", canDeploy: true });
    if (parts.length === 0 && method === "GET")
      return ok({ items: [...this.sites].reverse(), nextCursor: null });
    if (parts.length === 0 && method === "POST") {
      this.createBodies = [...(this.createBodies ?? []), body];
      if (this.rejectNames.has(body.name)) return err(400, 3611);
      const prefix = normalizePrefix(body.domainPrefix ?? body.name);
      return ok(
        this.site({ name: body.name, prefix: this.rejectPrefixes.has(prefix) ? "site" : prefix }),
      );
    }
    const site = this.sites.find((s) => s.id === parts[0]);
    if (!site) return err(404, 3601);
    if (parts.length === 1 && method === "GET") return ok(site);
    if (parts.length === 1 && method === "PATCH") {
      if (body.badgeHidden && !this.badgeRemovable) return err(403, 3608);
      if (this.rejectNames.has(body.name)) return err(400, 3611);
      // 服务端规则：当前线上版本被人审驳回时不能改回上线。
      if (body.status === "online" && site.offlineReason === "review_rejected")
        return err(403, 3612);
      if ("badgeHidden" in body) site.badgeVisible = !body.badgeHidden;
      Object.assign(site, body);
      // 服务端规则：没有线上版本的站点上线后还是 pending。
      if (site.status === "online" && !site.currentDeployment) site.status = "pending";
      return ok(site);
    }
    if (parts.length === 2 && method === "POST") {
      const busy = this.deployments.find((d) =>
        ["preparing", "uploading", "publishing", "verifying"].includes(d.status),
      );
      if (busy)
        return err(409, 3610, {
          inProgress: { siteId: busy.siteId, deploymentId: busy.id, status: busy.status },
        });
      const d = this.deployment(site.id, {
        artifactSize: body.artifactSize,
        logs: [{ stage: "preparing", level: "info", message: "created" }],
      });
      site.latestDeployment = this.view(d);
      return ok(this.view(d));
    }
    const d = this.deployments.find((x) => x.id === parts[2] && x.siteId === site.id);
    if (!d) return err(404, 3602);
    const action = parts[3];
    if (!action && method === "GET") {
      if (d.status === "publishing" && ++d.polls >= this.publishPolls) {
        Object.assign(d, this.publishOutcome);
        d.logs.push({
          stage: "verifying",
          level: d.status === "success" ? "info" : "error",
          message: d.status,
        });
        if (d.status === "success") {
          site.currentDeployment = this.view(d);
          site.status = "online";
          delete site.offlineReason;
        }
      }
      return ok(this.view(d));
    }
    if (action === "package" && method === "PUT") {
      this.uploads++;
      assert.equal(init.headers["Content-Type"], "application/gzip");
      if (!["preparing", "uploading"].includes(d.status)) return err(409, 3603);
      d.status = "uploading";
      const first = this.uploads === 1 ? this.firstUpload : undefined;
      if (first === "truncate" || body.length !== d.artifactSize) return err(409, 3604);
      d.status = "publishing";
      d.logs.push({ stage: "publishing", level: "info", message: "publishing" });
      if (first === "dropResponse") throw new TypeError("fetch failed");
      return ok(this.view(d));
    }
    if (action === "logs") {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const entries = d.logs.slice(offset).map((e, i) => ({ ...e, offset: offset + i, ts: "t" }));
      return ok({
        entries,
        nextOffset: d.logs.length,
        done: !["preparing", "uploading", "publishing", "verifying"].includes(d.status),
      });
    }
    return err(404, 3601);
  };
}

export async function project() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-site-cli-"));
  await mkdir(join(dir, "stage"));
  await writeFile(join(dir, "stage", "start.sh"), "exec node static-server.mjs .\n");
  await writeFile(join(dir, "stage", "index.html"), "<h1>hi</h1>");
  return dir;
}

export async function run(fake, cwd, ...argv) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    env: ENV,
    cwd,
    fetchImpl: fake.fetch,
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    sleep: async () => {},
    now: () => 0,
  });
  const lines = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return {
    code,
    lines,
    result: lines.at(-1),
    error: stderr ? JSON.parse(stderr).error : undefined,
  };
}
