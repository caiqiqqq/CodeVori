import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

const COMPAT_VERSION = "2.5.0";
const GENERATOR_CALLS = [
  "sessionState.titleGen?.onTurnCompleted(promptText);",
  "sessionState.promptSuggestions?.onTurnCompleted(promptText, eventHandler.getLastAgentMessageText());",
] as const;

/** Only called for Host-managed packages; never rewrites the upstream entrypoint. */
export async function prepareManagedCodexAcpEntrypoint(
  script: string,
  version: string,
): Promise<string> {
  if (version !== COMPAT_VERSION) return script;
  const original = await readFile(script, "utf8");
  let source = original;
  for (const call of GENERATOR_CALLS) {
    if (source.split(call).length !== 2)
      throw new Error(`Codex ACP ${COMPAT_VERSION} background generation signature mismatch`);
    // 修复原因：2.5.0 的内部标题/建议会新建继承业务 MCP 的临时线程，unsubscribe
    // 也不能保证回收。Host 未消费这些结果，只在受校验的启动副本移除两个调用点。
    source = source.replace(call, "/* ZCode: unused background generator disabled. */");
  }
  const digest = createHash("sha256").update(source).digest("hex");
  // 与原入口同目录，保留 import.meta.url 的依赖及资源解析语义和上游许可声明。
  const prepared = join(dirname(script), `codevori-no-background-v1-${digest}${extname(script)}`);
  try {
    if ((await readFile(prepared, "utf8")) === source) return prepared;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${prepared}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    await rename(temporary, prepared);
  } finally {
    await rm(temporary, { force: true });
  }
  return prepared;
}
