import { request as httpRequest } from "node:http";
const EXIT_BY_CODE = {
  3001: 1,
  3002: 3,
  3101: 2,
  3601: 1,
  3602: 1,
  3603: 4,
  3604: 4,
  3605: 3,
  3607: 3,
  3608: 3,
  3609: 1,
  3610: 3,
  3611: 1,
  3612: 3,
  2001: 4,
  2005: 4,
  2007: 4,
};

// 错误体不带提示文案（技术方案 5.8），面向 Agent 的 message / hint 在这里按 code 生成。
const MESSAGES = {
  3001: ["Invalid request", "Check the command arguments."],
  3002: [
    "Too many deployments in the last hour",
    "Wait and retry later; the limit is 10 deployments per hour.",
  ],
  // MaaS JWT 过期时 zcode-server 不按 free 放行，以免付费用户被降级（契约 0.13.0）。
  3101: [
    "The ZCode coding plan sign-in has expired",
    "Ask the user to sign in to ZCode again, then retry.",
  ],
  3601: ["Site not found", "Run `zcode-site list` to see your sites, then pass --site <id>."],
  3602: [
    "Deployment not found",
    "Run `zcode-site status` to see the latest deployment of this site.",
  ],
  3603: [
    "The deployment cannot do this in its current state",
    "Start a new deployment with `zcode-site deploy`.",
  ],
  3604: [
    "The package upload is incomplete",
    "Run `zcode-site deploy` again to re-upload the package.",
  ],
  3605: [
    "Account quota exceeded",
    "New deployments are paused until the next period. Tell the user that upgrading their ZCode plan raises the limits; the Sites panel in ZCode desktop shows the usage.",
  ],
  3607: [
    "The package is larger than 200MB",
    "Exclude build caches, source maps and dev dependencies from the stage, then deploy again.",
  ],
  3608: [
    "The current plan cannot hide the ZCode badge",
    "Free plans always show the badge; tell the user to upgrade to a paid ZCode plan, then run `zcode-site badge hide` again.",
  ],
  3609: ["This ZCode version is too old for Sites", "Ask the user to update ZCode."],
  3610: [
    "Another deployment is in progress",
    "Wait for it to finish (`zcode-site status --site <siteId>`), then retry.",
  ],
  // 名称和域名前缀在服务端过内容安全机审（契约 0.15.0）；只有名称不通过才报错，前缀不通过时服务端换成 site。
  3611: [
    "The site name did not pass content review",
    "Pick a different display name (--name for a new site, `zcode-site rename` for an existing one) and retry; nothing was created or renamed.",
  ],
  // 部署上线后过内容审核（契约 0.16.0）：人审驳回当前线上版本时站点被下线（offlineReason=review_rejected），用户不能自己改回上线。
  3612: [
    "The live version of this site was rejected by content review",
    "The site was taken offline and can't be brought back online with this version. Change the content and deploy again; a successful deploy puts the site back online.",
  ],
  2001: ["Sites service error", "Retry later."],
  2005: ["Sites storage error", "Retry later."],
  2007: ["Sites upstream error", "Retry later."],
};

export class CliError extends Error {
  constructor(code, message, hint, exitCode, data) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.exitCode = exitCode;
    this.data = data;
  }
}

function apiError(status, body) {
  if (status === 401) {
    return new CliError(
      "UNAUTHENTICATED",
      "Not signed in to ZCode",
      "Ask the user to sign in to ZCode, then retry.",
      2,
    );
  }
  const code = body?.code;
  const [message, hint] = MESSAGES[code] ?? [`Sites API error (HTTP ${status})`, "Retry later."];
  return new CliError(code ?? `HTTP_${status}`, message, hint, EXIT_BY_CODE[code] ?? 4, body?.data);
}

export function localError(code, message, hint) {
  return new CliError(code, message, hint, 1);
}

// ---------- 鉴权与 API ----------

const ENDPOINT_ORIGIN = "http://zcode-official-endpoint";
// 端点自己产生的错误经这个响应头说明类型；network 表示端点连不上 zcode-server。
const ENDPOINT_ERROR_HEADER = "x-zcode-official-endpoint-error";

export function loadEndpoint(env) {
  const address = env.ZCODE_OFFICIAL_ENDPOINT?.trim();
  const token = env.ZCODE_OFFICIAL_ENDPOINT_TOKEN?.trim();
  if (!address || !token) {
    throw new CliError(
      "UNAUTHENTICATED",
      "ZCode credentials are not available",
      "Run zcode-site from a ZCode session (the Sites plugin must be enabled), then retry.",
      2,
    );
  }
  return { address, token };
}

// 经 UDS / 命名管道发 HTTP 请求，返回标准 Response，和 fetch 同形状（测试注入 fetchImpl 替换它）。
export function createEndpointFetch(address) {
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      const { pathname, search } = new URL(url);
      const headers = { ...init.headers };
      if (init.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(init.body));
      const req = httpRequest(
        { socketPath: address, path: pathname + search, method: init.method ?? "GET", headers },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("error", reject);
          res.on("aborted", () =>
            reject(new Error("the connection was closed before the response ended")),
          );
          res.on("end", () => {
            if (!res.complete)
              return reject(new Error("the connection was closed before the response ended"));
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined)
                responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
            }
            const status = res.statusCode ?? 502;
            const nullBody = status === 204 || status === 205 || status === 304;
            resolve(
              new Response(nullBody ? null : Buffer.concat(chunks), {
                status,
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      req.end(init.body);
    });
}

export function createClient(endpoint, fetchImpl) {
  // body 是 JSON 对象；Buffer 原样作为请求体发送（产物包），按长度带上 Content-Length。
  async function call(method, path, body) {
    const headers = { Authorization: `Bearer ${endpoint.token}` };
    const raw = Buffer.isBuffer(body);
    if (body !== undefined) headers["Content-Type"] = raw ? "application/gzip" : "application/json";
    let res;
    try {
      res = await fetchImpl(ENDPOINT_ORIGIN + path, {
        method,
        headers,
        body: body === undefined || raw ? body : JSON.stringify(body),
      });
    } catch (err) {
      throw new CliError(
        "NETWORK_ERROR",
        `Cannot reach the Sites API: ${err.message}`,
        "Check the network connection to ZCode and retry.",
        4,
      );
    }
    if (res.headers.get(ENDPOINT_ERROR_HEADER) === "network") {
      throw new CliError(
        "NETWORK_ERROR",
        "ZCode cannot reach the Sites API",
        "Check the network connection and retry.",
        4,
      );
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok || parsed?.code !== 0) throw apiError(res.status, parsed);
    return parsed.data;
  }
  return {
    listSites: (cursor) =>
      call(
        "GET",
        `/api/v1/sites?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    // domainPrefix 不传时服务端按 name 规范化（openapi createSite）。
    createSite: (name, domainPrefix) =>
      call("POST", "/api/v1/sites", domainPrefix === undefined ? { name } : { name, domainPrefix }),
    getSite: (id) => call("GET", `/api/v1/sites/${id}`),
    updateSite: (id, patch) => call("PATCH", `/api/v1/sites/${id}`, patch),
    createDeployment: (siteId, artifactSize) =>
      call("POST", `/api/v1/sites/${siteId}/deployments`, { artifactSize }),
    getDeployment: (siteId, id) => call("GET", `/api/v1/sites/${siteId}/deployments/${id}`),
    uploadPackage: (siteId, id, body) =>
      call("PUT", `/api/v1/sites/${siteId}/deployments/${id}/package`, body),
    logs: (siteId, id, offset) =>
      call("GET", `/api/v1/sites/${siteId}/deployments/${id}/logs?offset=${offset}`),
    usage: () => call("GET", "/api/v1/sites/usage"),
  };
}

// ---------- 站点绑定（技术方案 4.3） ----------
