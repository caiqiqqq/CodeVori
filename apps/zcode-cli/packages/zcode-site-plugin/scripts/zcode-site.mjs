#!/usr/bin/env node
// zcode-site：CodeVori Sites 的命令行客户端（技术方案 4.2、4.3、5.3）。
// deploy 的输入是 Agent 准备好的 stage 目录，打包与契约检查、以及本地命令 check 在 stage.mjs；其余只和云端交互，不探测项目。
// 命令、参数、输出和错误码的完整说明只写在 HELP 里（`zcode-site help`），site-deploy skill 引用它，不再重复。
//
// 输出契约：成功时 stdout 输出 JSON，退出码 0；deploy 过程中每个阶段和每条日志各输出一行 JSON（--quiet 只输出终态）。
// 失败时 stderr 输出一行 {"error":{code,message,hint}}，退出码 1=参数或本地文件错误、2=未登录、3=超出额度或限额、4=部署失败或服务端错误。
//
// 鉴权（技术方案 5.8）：CLI 不持有任何登录凭证。请求发给 ZCode agent 侧的官方命令端点，端点按
// session token 认出会话，补上 ZCode 身份头和 X-ZCode-App-Version 后转发给 zcode-server。
// 端点地址和 token 由 ZCode 注入当前会话的 Bash，在普通终端里运行会按未登录退出：
//   ZCODE_OFFICIAL_ENDPOINT        端点地址（macOS / Linux 是 UDS 路径，Windows 是命名管道）
//   ZCODE_OFFICIAL_ENDPOINT_TOKEN  本会话的 token

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { checkStage, packStage } from "./stage.mjs";

// 拆分模块后，默认端点请求与 list 仍需本地绑定；仅 re-export 不会创建可调用变量。
import {
  CliError,
  localError,
  loadEndpoint,
  createClient,
  createEndpointFetch,
} from "./site-client.mjs";
import { writeBinding, allSites, candidates, resolveSite, prefixNotice } from "./site-project.mjs";
import { HELP } from "./site-help.mjs";
export { createEndpointFetch } from "./site-client.mjs";
export { normalizePrefix } from "./site-project.mjs";

const BINDING_FILE = ".codevori-site.json";
const POLL_INTERVAL_MS = 2000;
// 服务端兜底清理会把 publishing / verifying 超 10 分钟的部署置为 failed，这里多等一点再放弃。
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const UPLOAD_ATTEMPTS = 3;
const IN_FLIGHT = new Set(["preparing", "uploading", "publishing", "verifying"]);
const RESUMABLE = new Set(["preparing", "uploading"]);

// 与 api/openapi.yaml 的 x-cli-exit-code 一致。
async function deploy(ctx, stageDir) {
  const { client, out, opts } = ctx;
  if (!stageDir)
    throw localError(
      "MISSING_STAGE",
      "Missing stage directory",
      "Usage: zcode-site deploy <stage-dir> [--new | --site <id>]",
    );
  if (opts.site && opts.new)
    throw localError(
      "INVALID_ARGS",
      "--site and --new cannot be used together",
      "Pass only one of them.",
    );
  // 先打包再选站点：契约检查不过时不建站、不建部署。
  const packed = await packStage(stageDir, {
    cwd: ctx.cwd,
    allowForeignBinaries: opts["allow-foreign-binaries"],
  });
  if (packed.error)
    throw localError(packed.error, packed.message, "Pass the stage directory that holds start.sh.");
  if (packed.problems)
    throw new CliError(
      "PACKAGE_CHECK_FAILED",
      `The stage does not meet the package contract:\n${packed.problems.map((p) => `  - ${p}`).join("\n")}`,
      "Fix every listed problem in the stage (see the site-deploy skill references), then deploy again.",
      1,
      { problems: packed.problems },
    );
  out.event({ event: "packed", ...packed.result });
  for (const message of packed.warnings) out.event({ event: "warning", message });

  const { site, bound, created } = await resolveSite(ctx, { allowCreate: true });
  if (!bound) await writeBinding(ctx.cwd, site);
  if (created) out.event({ event: "site_created", siteId: site.id, url: site.url });
  // 已绑定时 --new 不生效：首次部署统一带 --new，后续部署即使误带也只会更新已绑定的站点，不会重复建站。
  if (bound && opts.new)
    out.event({
      event: "warning",
      message: `--new is ignored: this project is linked to site ${site.id} (${BINDING_FILE}).`,
    });
  const notice = prefixNotice(opts, created, site);
  if (notice) out.event({ event: "warning", message: notice });

  const deployment = await startDeployment(client, site.id, packed.body.length);
  out.event({
    event: "deployment_started",
    siteId: site.id,
    deploymentId: deployment.id,
    resumed: deployment.resumed,
  });

  await uploadPackage(ctx, site.id, deployment.id, packed.body);

  const final = await watch(ctx, site.id, deployment.id);
  const result = {
    siteId: site.id,
    deploymentId: final.id,
    status: final.status,
    url: site.url,
    failure: final.failure,
  };
  if (final.status !== "success") {
    throw new CliError(
      final.failure?.code ?? "DEPLOYMENT_FAILED",
      `Deployment failed at ${final.failure?.stage ?? "unknown"}: ${final.failure?.message ?? final.status}`,
      deployHint(final.failure?.code),
      4,
      result,
    );
  }
  return result;
}

// 同一用户同时只能有一个进行中的部署。3610 指向本站点、且还没开始发布时，多半是上一次请求成功了但响应丢了，直接续传（技术方案 5.3）。
async function startDeployment(client, siteId, size) {
  try {
    return { ...(await client.createDeployment(siteId, size)), resumed: false };
  } catch (err) {
    const p = err.data?.inProgress;
    if (err.code === 3610 && p && p.siteId === siteId && RESUMABLE.has(p.status)) {
      const d = await client.getDeployment(siteId, p.deploymentId);
      if (d.artifactSize === size) return { ...d, resumed: true };
    }
    if (err.code === 3610 && p)
      err.hint = `Deployment ${p.deploymentId} of site ${p.siteId} is ${p.status}. Wait for it to finish, then retry.`;
    throw err;
  }
}

// 包经 zcode-server 转发给控制面，由控制面写 OSS 并进入 publishing（openapi uploadPackage），CLI 不直接访问 OSS。
// 断网或 3604（传输中断、长度不符）时用同一个请求整包重传；3603 说明上一次其实已经传完、只是响应丢了，直接进入轮询。
async function uploadPackage(ctx, siteId, deploymentId, body) {
  const { client, out } = ctx;
  for (let attempt = 1; ; attempt++) {
    out.event({ event: "uploading", attempt, bytes: body.length });
    try {
      return await client.uploadPackage(siteId, deploymentId, body);
    } catch (err) {
      if (err.code === 3603) {
        const d = await client.getDeployment(siteId, deploymentId);
        if (!RESUMABLE.has(d.status)) return d;
        throw err;
      }
      const retryable = err.code === 3604 || err.code === "NETWORK_ERROR";
      if (!retryable || attempt >= UPLOAD_ATTEMPTS) throw err;
    }
  }
}

async function watch(ctx, siteId, deploymentId) {
  const { client, out, sleep, now } = ctx;
  const deadline = now() + POLL_TIMEOUT_MS;
  let offset = 0;
  let lastStatus;
  const drainLogs = async () => {
    const logs = await client.logs(siteId, deploymentId, offset);
    for (const e of logs.entries)
      out.event({ event: "log", stage: e.stage, level: e.level, message: e.message, ts: e.ts });
    offset = logs.nextOffset;
  };
  for (;;) {
    const d = await client.getDeployment(siteId, deploymentId);
    // 先读状态再读日志：状态已到终态时，这一轮读到的日志一定是全部。
    await drainLogs();
    if (d.status !== lastStatus) {
      out.event({ event: "status", status: d.status });
      lastStatus = d.status;
    }
    if (!IN_FLIGHT.has(d.status)) return d;
    if (now() > deadline) {
      throw new CliError(
        "WATCH_TIMEOUT",
        "Timed out waiting for the deployment to finish",
        `It is still ${d.status}; check later with \`zcode-site status --site ${siteId}\`.`,
        4,
        { siteId, deploymentId },
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function deployHint(code) {
  switch (code) {
    case "PACKAGE_INVALID":
      return "Fix the stage as described in the message (see the site-deploy skill's packaging reference) and deploy again.";
    case "WARMUP_FAILED":
      return "start.sh did not answer GET / on 0.0.0.0:3000 with a status below 500 in time. Read `zcode-site logs <deploymentId>`, run `zcode-site check <stage-dir>`, fix it and deploy again.";
    case "UPLOAD_TIMEOUT":
      return "The upload did not finish in time. Run `zcode-site deploy` again.";
    default:
      return "Run `zcode-site logs <deploymentId>` for details, then retry. The previous live version keeps serving.";
  }
}

// ---------- 其他命令 ----------

function summarize(site) {
  return {
    id: site.id,
    name: site.name,
    url: site.url,
    status: site.status,
    ...(site.offlineReason && { offlineReason: site.offlineReason }),
    region: site.region,
    badgeHidden: site.badgeHidden,
    badgeVisible: site.badgeVisible,
    currentDeployment: site.currentDeployment && pickDeployment(site.currentDeployment),
    latestDeployment: site.latestDeployment && pickDeployment(site.latestDeployment),
  };
}

function pickDeployment(d) {
  return {
    id: d.id,
    status: d.status,
    createdAt: d.createdAt,
    finishedAt: d.finishedAt,
    failure: d.failure,
  };
}

async function logsCommand(ctx, deploymentId) {
  if (!deploymentId)
    throw localError(
      "MISSING_DEPLOYMENT",
      "Missing deployment id",
      "Usage: zcode-site logs <deploymentId> [--site <id>] [--offset <n>]",
    );
  const { site } = await resolveSite(ctx, { allowCreate: false });
  const offset = ctx.opts.offset === undefined ? 0 : Number(ctx.opts.offset);
  if (!Number.isInteger(offset) || offset < 0)
    throw localError(
      "INVALID_ARGS",
      "--offset must be a non-negative integer",
      "Pass the nextOffset from the previous call.",
    );
  return ctx.client.logs(site.id, deploymentId, offset);
}

async function setStatus(ctx, status) {
  const { site } = await resolveSite(ctx, { allowCreate: false });
  return summarize(await ctx.client.updateSite(site.id, { status }));
}

async function setBadge(ctx, action) {
  if (action !== "hide" && action !== "show")
    throw localError(
      "INVALID_ARGS",
      "Expected hide or show",
      "Usage: zcode-site badge hide|show [--site <id>]",
    );
  const { site } = await resolveSite(ctx, { allowCreate: false });
  return summarize(await ctx.client.updateSite(site.id, { badgeHidden: action === "hide" }));
}

async function rename(ctx, name) {
  if (!name?.trim())
    throw localError(
      "MISSING_NAME",
      "Missing site name",
      "Usage: zcode-site rename [--site <id>] <name>",
    );
  const { site } = await resolveSite(ctx, { allowCreate: false });
  return summarize(await ctx.client.updateSite(site.id, { name: name.trim() }));
}

export async function main(
  argv,
  {
    env = process.env,
    cwd = process.cwd(),
    fetchImpl,
    stdout = process.stdout,
    stderr = process.stderr,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
  } = {},
) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        site: { type: "string" },
        new: { type: "boolean" },
        name: { type: "string" },
        prefix: { type: "string" },
        offset: { type: "string" },
        port: { type: "string" },
        "allow-foreign-binaries": { type: "boolean" },
        quiet: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    return fail(stderr, localError("INVALID_ARGS", err.message, "Run `zcode-site help`."));
  }
  const [command, ...args] = parsed.positionals;
  if (!command || command === "help" || parsed.values.help) {
    stdout.write(`${HELP}\n`);
    return command || parsed.values.help ? 0 : 1;
  }
  if (command === "check") {
    try {
      const result = await check(cwd, args, parsed.values);
      stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (err) {
      return fail(stderr, err instanceof CliError ? err : internalError(err));
    }
  }
  const quiet = parsed.values.quiet;
  const out = { event: (e) => quiet || stdout.write(`${JSON.stringify(e)}\n`) };
  try {
    const endpoint = loadEndpoint(env);
    const client = createClient(endpoint, fetchImpl ?? createEndpointFetch(endpoint.address));
    const ctx = { client, cwd, opts: parsed.values, out, sleep, now };
    let result;
    switch (command) {
      case "deploy":
        result = await deploy(ctx, args[0]);
        break;
      case "status":
        result = summarize((await resolveSite(ctx, { allowCreate: false })).site);
        break;
      case "logs":
        result = await logsCommand(ctx, args[0]);
        break;
      case "offline":
        result = await setStatus(ctx, "offline");
        break;
      case "online":
        result = await setStatus(ctx, "online");
        break;
      case "usage":
        result = await client.usage();
        break;
      case "list":
        result = { sites: candidates(await allSites(client)) };
        break;
      case "rename":
        result = await rename(ctx, args.join(" "));
        break;
      case "badge":
        result = await setBadge(ctx, args[0]);
        break;
      default:
        throw localError(
          "UNKNOWN_COMMAND",
          `Unknown command: ${command}`,
          "Run `zcode-site help`.",
        );
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (err) {
    return fail(stderr, err instanceof CliError ? err : internalError(err));
  }
}

function internalError(err) {
  return new CliError(
    "INTERNAL",
    err.message,
    "This is a bug in zcode-site; report it with the command you ran.",
    4,
  );
}

async function check(cwd, [stageDir], opts) {
  if (!stageDir)
    throw localError(
      "INVALID_ARGS",
      "Missing stage directory",
      "Usage: zcode-site check <stage-dir> [--port <n>]",
    );
  const port = opts.port === undefined ? undefined : Number(opts.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw localError("INVALID_ARGS", "--port must be a port number", "Pass e.g. --port 13000.");
  const checked = await checkStage(stageDir, { cwd, ...(port ? { port } : {}) });
  if (checked.error)
    throw localError(
      checked.error,
      checked.message,
      "Pass the stage directory that holds start.sh.",
    );
  if (checked.failed)
    throw new CliError(
      "START_FAILED",
      checked.failed.reason,
      "Read data.log and the site-deploy skill's troubleshooting reference, fix the stage, then check again.",
      1,
      checked.failed,
    );
  return checked.result;
}

function fail(stderr, err) {
  const error = { code: err.code, message: err.message, hint: err.hint };
  if (err.data !== undefined) error.data = err.data;
  stderr.write(`${JSON.stringify({ error })}\n`);
  return err.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
