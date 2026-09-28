import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acpGeminiProvidersSchema,
  acpGeminiProvidersUpdateSchema,
  type AcpGeminiProviders,
  type AcpGeminiProvidersUpdate,
} from "@zcode/shared";

/** A single target Host owns provider mutations; launch reads the current file rather than a cache. */
export function createGeminiProviderStore(directory: string) {
  const path = join(directory, "gemini-providers.json");
  const lock = `${path}.lock`;
  let writing: Promise<AcpGeminiProviders> | undefined;
  const read = async (): Promise<AcpGeminiProviders> => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: "missing", providers: [] };
      throw new Error("Gemini 模型供应商目录无法读取");
    }
    try {
      const providers: unknown = JSON.parse(raw);
      const result = acpGeminiProvidersSchema.parse({
        version: createHash("sha256").update(raw).digest("hex"),
        providers,
      });
      if (new Set(result.providers.map((provider) => provider.id)).size !== result.providers.length)
        throw new Error();
      return result;
    } catch {
      throw new Error("Gemini 模型供应商目录损坏，请先修复文件");
    }
  };
  const list = async () => {
    if (writing) await writing.catch(() => {});
    return read();
  };
  const resolve = async (settings: Record<string, string>) => {
    const provider = (await list()).providers.find(
      (item) => item.id === settings.ZCODE_GEMINI_PROVIDER_ID,
    );
    if (!provider)
      throw new Error("Gemini 模型供应商不可用，请在设置 → 智能体 → Gemini 中重新选择供应商并保存");
    return provider;
  };
  const update = async (input: AcpGeminiProvidersUpdate) => {
    const parsed = acpGeminiProvidersUpdateSchema.safeParse(input);
    if (!parsed.success) throw new Error("Gemini 模型供应商配置无效，请检查名称、URL 和 Key");
    const command = parsed.data;
    const previous = writing;
    const task = (async () => {
      if (previous) await previous.catch(() => {});
      await mkdir(directory, { recursive: true });
      // 修复原因：每个窗口有独立 Host；跨进程同时读同一版本时需要原子锁保护整段检验与替换。
      try {
        await mkdir(lock);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error("Gemini 模型供应商正在由另一个窗口修改，请稍后刷新重试");
        throw error;
      }
      try {
        const current = await read();
        if (current.version !== command.expectedVersion)
          throw new Error("Gemini 模型供应商版本已变化，请刷新后重试");
        const providers =
          command.action === "delete"
            ? current.providers.filter((item) => item.id !== command.id)
            : current.providers.some((item) => item.id === command.provider.id)
              ? current.providers.map((item) =>
                  item.id === command.provider.id ? command.provider : item,
                )
              : [...current.providers, command.provider];
        if (providers.length > 64) throw new Error("Gemini 模型供应商数量超过上限");
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(providers), { mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        return read();
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    })();
    writing = task;
    try {
      return await task;
    } finally {
      if (writing === task) writing = undefined;
    }
  };
  return { list, resolve, update };
}
