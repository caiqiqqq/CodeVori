import { z } from "zod";
import { validRange } from "semver";
import type { AcpAgent, AcpAgentInfo } from "@zcode/shared";

const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_MS = 10 * 60 * 1000;
const ids: Partial<Record<AcpAgent, string>> = {
  claude: "claude-acp",
  codex: "codex-acp",
  gemini: "gemini",
  opencode: "opencode",
  cline: "cline",
  codebuddy: "codebuddy-code",
  "kimi-code": "kimi",
  pi: "pi-acp",
  grok: "grok-build",
  cursor: "cursor",
  qoder: "qoder",
  antigravity: "antigravity-acp",
};
const stableVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/)
  .max(128);
const npmReleaseSchema = z.object({
  name: z.string(),
  version: stableVersion,
  engines: z
    .object({
      node: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .refine((value) => validRange(value) !== null)
        .optional(),
    })
    .optional(),
});
const registrySchema = z.object({
  agents: z.array(z.object({ id: z.string() }).passthrough()).max(1000),
});
const agentSchema = z.object({
  version: stableVersion,
  distribution: z.object({
    npx: z.object({ package: z.string(), args: z.array(z.string()).optional() }).optional(),
    binary: z
      .record(
        z.string(),
        z.object({
          archive: z.string().url(),
          cmd: z.string(),
          args: z.array(z.string()).optional(),
          sha256: z
            .string()
            .regex(/^[a-fA-F0-9]{64}$/)
            .optional(),
        }),
      )
      .optional(),
  }),
});

export type AcpReleaseTarget = {
  version: string;
  platformSupported: boolean;
  nodeVersionRange?: string | null;
  binary?: { url: string; entry: string; sibling?: string; sha256?: string };
};
type BuiltinRelease = AcpReleaseTarget & {
  agent: AcpAgent;
  kind: "npm" | "binary";
  packageName: string;
  args: readonly string[];
};
type UpdateCheck = NonNullable<AcpAgentInfo["updateCheck"]>;

/** Bounded public metadata only. Error messages never expose response bodies or user configuration. */
async function fetchMetadata(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok || !response.body) throw new Error("ACP release metadata unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 5_000_000) throw new Error("ACP release metadata exceeds size limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Per target Host. Only explicit settings checks query the network; launch and menus just read files. */
export function createAcpReleaseRegistry(
  builtins: readonly BuiltinRelease[],
  options: {
    fetchMetadata?: (url: string) => Promise<unknown>;
    fetcher?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const targets = new Map(builtins.map((meta) => [meta.agent, meta as AcpReleaseTarget]));
  const checks = new Map<AcpAgent, UpdateCheck>();
  const request =
    options.fetchMetadata ?? ((url: string) => fetchMetadata(url, options.fetcher ?? fetch));
  const now = options.now ?? Date.now;
  let cachedAt: number | undefined;
  let pending: Promise<void> | undefined;
  const platform = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}`;

  const npmTarget = async (meta: BuiltinRelease, version: string) => {
    const value = npmReleaseSchema.parse(
      await request(
        `https://registry.npmmirror.com/${encodeURIComponent(meta.packageName)}/${version}`,
      ),
    );
    if (value.name !== meta.packageName || (version !== "latest" && value.version !== version))
      throw new Error("Registry package/version mismatch");
    return {
      version: value.version,
      platformSupported: true,
      nodeVersionRange: value.engines?.node ?? null,
    };
  };

  const query = async () => {
    const checkedAt = new Date(now()).toISOString();
    // 修复原因：旧实现只比较内置 pin。远端目标必须在 Host 解析，并同时用于提示和精确安装。
    const remote = await request(ACP_REGISTRY_URL)
      .then((value) => registrySchema.parse(value))
      .catch(() => null);
    await Promise.all(
      builtins.map(async (meta) => {
        let source: UpdateCheck["source"] = "acp-registry";
        try {
          if (!remote) throw new Error("Registry unavailable");
          const raw = remote.agents.find((agent) => agent.id === ids[meta.agent]);
          const release = raw ? agentSchema.parse(raw) : undefined;
          if (meta.kind === "npm") {
            let target: AcpReleaseTarget;
            if (release?.distribution.npx) {
              const version = release.version;
              if (release.distribution.npx.package !== `${meta.packageName}@${version}`)
                throw new Error("Registry package mismatch");
              // 修复原因：ACP 目录只有启动信息，Node 要求必须来自同包同版本的 engines.node。
              target = await npmTarget(meta, version);
            } else {
              source = "npm";
              target = await npmTarget(meta, "latest");
            }
            targets.set(meta.agent, target);
          } else {
            const binary = release?.distribution.binary?.[platform];
            if (!binary || !meta.binary) {
              if (release)
                targets.set(meta.agent, { ...targets.get(meta.agent)!, platformSupported: false });
              checks.set(meta.agent, { status: "unavailable", source, checkedAt });
              return;
            }
            const entry = binary.cmd.replaceAll("\\", "/").replace(/^\.\//, "");
            const url = new URL(binary.archive);
            if (
              entry !== meta.binary.entry ||
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              !/\.(zip|tar\.gz)$/.test(url.pathname)
            )
              throw new Error("Unsupported binary release");
            const args = binary.args ?? [];
            if (
              args.length !== meta.args.length ||
              args.some((arg, index) => arg !== meta.args[index])
            )
              throw new Error("Unsupported ACP arguments");
            targets.set(meta.agent, {
              version: release!.version,
              platformSupported: true,
              binary: { ...meta.binary, url: binary.archive, sha256: binary.sha256 },
            });
          }
          checks.set(meta.agent, { status: "checked", source, checkedAt });
        } catch {
          checks.set(meta.agent, { status: "error", source, checkedAt });
        }
      }),
    );
    cachedAt = [...checks.values()].some((check) => check.status === "error") ? undefined : now();
  };

  return {
    target: (agent: AcpAgent) => targets.get(agent)!,
    async resolveNpmTarget(agent: AcpAgent, target: AcpReleaseTarget): Promise<AcpReleaseTarget> {
      if (target.nodeVersionRange !== undefined) return target;
      try {
        const resolved = await npmTarget(
          builtins.find((meta) => meta.agent === agent)!,
          target.version,
        );
        // 修复原因：安装绑定的旧目标不能覆盖并发检查得到的新发行目标。
        if (targets.get(agent) === target) targets.set(agent, resolved);
        return resolved;
      } catch {
        throw new Error("无法检查目标版本的 Node.js 要求，请检查网络后重试检查更新。");
      }
    },
    check: (agent: AcpAgent): UpdateCheck =>
      checks.get(agent) ?? { status: "unchecked", source: "builtin", checkedAt: null },
    async refresh(force = false) {
      if (pending) return pending;
      if (!force && cachedAt !== undefined && now() - cachedAt < CACHE_MS) return;
      const task = query();
      pending = task;
      try {
        await task;
      } finally {
        if (pending === task) pending = undefined;
      }
    },
  };
}
