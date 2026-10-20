import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { forgeIssueCreateResultSchema, type ForgeIssueCreateResult } from "@zcode/shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";

const receiptSchema = z
  .object({
    fingerprint: z.string(),
    result: forgeIssueCreateResultSchema.optional(),
  })
  .strict();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** 只有此 adapter 写创建回执；pending 永不自动重发，避免超时后远端重复建单。 */
export function createForgeIssueReceipts(directory: string) {
  const live = new Map<string, { fingerprint: string; result: Promise<ForgeIssueCreateResult> }>();
  async function execute(
    key: string,
    fingerprint: string,
    create: () => Promise<ForgeIssueCreateResult>,
  ) {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${hash(key)}.json`);
    let file;
    try {
      file = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path, "utf8"));
      } catch {
        throw new Error("FORGE_CREATE_UNCERTAIN");
      }
      const receipt = receiptSchema.safeParse(raw);
      if (!receipt.success) throw new Error("FORGE_CREATE_UNCERTAIN");
      if (receipt.data.fingerprint !== fingerprint) throw new Error("FORGE_CONFLICT");
      if (!receipt.data.result) throw new Error("FORGE_CREATE_UNCERTAIN");
      return receipt.data.result;
    }
    try {
      await file.writeFile(JSON.stringify({ fingerprint }));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      const result = forgeIssueCreateResultSchema.parse(await create());
      await atomicWriteText(path, JSON.stringify({ fingerprint, result }));
      return result;
    } catch (cause) {
      // POST 可能已经成功，甚至成功后本地写回失败；保留 pending，禁止换 ID 自动重发。
      throw new Error("FORGE_CREATE_UNCERTAIN", { cause });
    }
  }
  return {
    async create(
      scopeKey: string,
      requestId: string,
      payload: unknown,
      create: () => Promise<ForgeIssueCreateResult>,
    ) {
      const key = JSON.stringify([scopeKey, requestId]);
      const fingerprint = hash(JSON.stringify(payload));
      const current = live.get(key);
      if (current) {
        if (current.fingerprint !== fingerprint) throw new Error("FORGE_CONFLICT");
        return current.result;
      }
      const result = execute(key, fingerprint, create);
      live.set(key, { fingerprint, result });
      try {
        return await result;
      } finally {
        live.delete(key);
      }
    },
  };
}
