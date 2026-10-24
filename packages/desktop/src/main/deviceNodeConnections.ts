import { createHash } from "node:crypto";
import type {
  DeviceNodeCommand,
  DeviceNodePlatform,
  DeviceNodeView,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";
import { deviceNodeIdSchema, deviceNodePlatformSchema } from "@zcode/shared";

type RecordEntry = {
  id: string;
  token: string;
  platform: DeviceNodePlatform;
  enabled: boolean;
  expiresAt: string;
  invitation?: string;
};
type Endpoint = { url: string; token: string };
type RequestPort = (
  url: string,
  method: string,
  token?: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
const unavailable = () => new Error("device_bridge_pairing_unavailable");
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw unavailable();
  return v as Record<string, unknown>;
};
export function validateDeviceNodeServiceUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw unavailable();
  return url.toString().replace(/\/$/, "");
}
/** Main owns bindings and publication. The UI projection contains no controller/node bearer. */
export function createDeviceNodeConnections(ports: {
  serviceUrl: string;
  name: string;
  readRecords(): Promise<unknown[]>;
  writeRecords(records: RecordEntry[]): Promise<void>;
  request: RequestPort;
  checkMcp(endpoint: Endpoint): Promise<number>;
  saveMcp(request: SaveCliMcpToUserDirectoryRequest): Promise<void>;
}) {
  const base = validateDeviceNodeServiceUrl(ports.serviceUrl);
  let records: RecordEntry[] = [],
    loaded = false,
    disposed = false,
    epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let poll: AbortController | undefined;
  const views = new Map<string, DeviceNodeView>();
  const checked = new Map<string, string>();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  // MCP 工具名包含服务名前缀，限制长度以满足模型工具名上限。
  const mcpName = (id: string) =>
    `device-node-${createHash("sha256").update(id).digest("hex").slice(0, 20)}`;
  const removeMcp = (id: string) =>
    ports.saveMcp({ action: "delete", source: "zcodeagentmcp", name: mcpName(id) });
  const persist = () => ports.writeRecords(records);
  const load = async () => {
    if (loaded) return;
    records = (await ports.readRecords()).map((raw) => {
      const p = object(raw);
      if (
        !deviceNodeIdSchema.safeParse(p.id).success ||
        !deviceNodeIdSchema.safeParse(p.token).success ||
        !deviceNodePlatformSchema.safeParse(p.platform).success ||
        typeof p.enabled !== "boolean" ||
        typeof p.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(p.expiresAt)) ||
        (p.invitation !== undefined && !deviceNodeIdSchema.safeParse(p.invitation).success)
      )
        throw unavailable();
      return p as RecordEntry;
    });
    loaded = true;
    // 重启后清除旧发布，必须重新确认该连接在线且握手成功。
    for (const r of records) await removeMcp(r.id);
  };
  const view = (r: RecordEntry, status: DeviceNodeView["status"]): DeviceNodeView => ({
    id: r.id,
    platform: r.platform,
    enabled: r.enabled,
    expiresAt: r.expiresAt,
    status,
    ...(status === "waiting" && r.invitation && Date.parse(r.expiresAt) > Date.now()
      ? { installationUrl: `${base}/v1/install/${r.invitation}/${r.platform}` }
      : {}),
  });
  const refresh = async () => {
    if (disposed) return;
    await load();
    const current = epoch;
    poll = new AbortController();
    for (const r of records) {
      if (disposed || epoch !== current) return;
      try {
        const state = object(
          await ports.request(`${base}/v1/pairs/${r.id}`, "GET", r.token, undefined, poll.signal),
        );
        if (disposed || current !== epoch) return;
        const status = !r.enabled ? "disabled" : state.status;
        if (status !== "online") {
          checked.delete(r.id);
          await removeMcp(r.id);
          views.set(
            r.id,
            view(
              r,
              status === "waiting" || status === "expired" || status === "disabled"
                ? status
                : "offline",
            ),
          );
          continue;
        }
        if (typeof state.connectionId !== "string" || !state.connectionId) throw unavailable();
        if (checked.get(r.id) === state.connectionId) continue;
        views.set(r.id, view(r, "checking"));
        const endpoint = { url: `${base}/v1/pairs/${r.id}/mcp`, token: r.token };
        const count = await ports.checkMcp(endpoint);
        if (disposed || current !== epoch) return;
        await ports.saveMcp({
          action: "upsert",
          source: "zcodeagentmcp",
          name: mcpName(r.id),
          config: {
            type: "http",
            url: endpoint.url,
            headers: { Authorization: `Bearer ${endpoint.token}` },
          },
        });
        if (disposed || current !== epoch) {
          await removeMcp(r.id);
          return;
        }
        checked.set(r.id, state.connectionId);
        views.set(r.id, { ...view(r, "ready"), toolCount: count });
        if (r.invitation) {
          delete r.invitation;
          await persist();
        }
      } catch {
        if (disposed || current !== epoch) return;
        checked.delete(r.id);
        await removeMcp(r.id);
        views.set(r.id, view(r, "error"));
      }
    }
  };
  return {
    start() {
      if (timer || disposed) return;
      void enqueue(refresh).catch(() => {});
      let pending = false;
      timer = setInterval(() => {
        if (pending || disposed) return;
        pending = true;
        void enqueue(refresh)
          .catch(() => {})
          .finally(() => {
            pending = false;
          });
      }, 3000);
      timer.unref();
    },
    refresh: () => enqueue(refresh),
    read: () =>
      enqueue(async () => {
        await load();
        return records.map((r) => views.get(r.id) ?? view(r, r.enabled ? "waiting" : "disabled"));
      }),
    execute(command: DeviceNodeCommand) {
      if (command.action !== "node-create") {
        epoch++;
        poll?.abort();
      }
      return enqueue(async () => {
        if (disposed) throw unavailable();
        await load();
        if (command.action === "node-create") {
          const p = object(
            await ports.request(`${base}/v1/pairs`, "POST", undefined, {
              platform: command.platform,
              name: ports.name,
            }),
          );
          const parsedId = deviceNodeIdSchema.safeParse(p.id),
            parsedToken = deviceNodeIdSchema.safeParse(p.controllerToken),
            parsedInvite = deviceNodeIdSchema.safeParse(p.invitation);
          if (!parsedId.success || !parsedToken.success || !parsedInvite.success)
            throw unavailable();
          const id = parsedId.data,
            token = parsedToken.data,
            invitation = parsedInvite.data;
          if (typeof p.expiresAt !== "string" || !Number.isFinite(Date.parse(p.expiresAt)))
            throw unavailable();
          const entry: RecordEntry = {
            id,
            token,
            invitation,
            platform: command.platform,
            enabled: true,
            expiresAt: p.expiresAt,
          };
          records.push(entry);
          try {
            await persist();
          } catch {
            records = records.filter((r) => r.id !== id);
            await ports.request(`${base}/v1/pairs/${id}`, "DELETE", token).catch(() => {});
            throw unavailable();
          }
          views.set(id, view(entry, "waiting"));
          return;
        }
        const r = records.find((r) => r.id === command.id);
        if (!r) throw unavailable();
        if (command.action === "node-enable") {
          await ports.request(`${base}/v1/pairs/${r.id}`, "PATCH", r.token, {
            enabled: command.enabled,
          });
          const old = r.enabled;
          r.enabled = command.enabled;
          try {
            await persist();
          } catch {
            r.enabled = old;
            throw unavailable();
          }
          checked.delete(r.id);
          await removeMcp(r.id);
          views.set(r.id, view(r, r.enabled ? "offline" : "disabled"));
          return;
        }
        await ports.request(`${base}/v1/pairs/${r.id}`, "DELETE", r.token);
        await removeMcp(r.id);
        checked.delete(r.id);
        views.delete(r.id);
        records = records.filter((p) => p.id !== r.id);
        await persist();
      });
    },
    async dispose() {
      disposed = true;
      epoch++;
      poll?.abort();
      if (timer) clearInterval(timer);
      await enqueue(async () => {
        if (loaded) for (const r of records) await removeMcp(r.id);
      });
    },
  };
}

/** Fixed destination from trusted Main configuration; no redirect or server diagnostics escape. */
export const requestDeviceNodeService: RequestPort = async (url, method, token, body, signal) => {
  try {
    const response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw unavailable();
    }
    if (method === "DELETE" || method === "PATCH") {
      await response.body?.cancel();
      return {};
    }
    const text = await response.text();
    if (text.length > 16_384) throw unavailable();
    return JSON.parse(text);
  } catch {
    throw unavailable();
  }
};
