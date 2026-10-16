import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_RECEIPTS = 4_096;

/** 收据只存哈希；发送前认领，避免多窗口/重连对同一边沿重复通知。 */
export class BotNotificationReceipts {
  constructor(private readonly path: string) {}

  async claim(key: string): Promise<boolean> {
    return withFileLock(this.path, async () => {
      let records: Record<string, number> = {};
      try {
        const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw Error("Invalid notification receipts");
        if (
          !Object.values(raw).every((value) => typeof value === "number" && Number.isFinite(value))
        )
          throw Error("Invalid notification receipts");
        records = raw as Record<string, number>;
      } catch (error) {
        // 损坏的收据不能当作空文件重发；只有首次不存在才创建。
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const now = Date.now();
      const digest = createHash("sha256").update(key).digest("hex");
      if (records[digest] !== undefined && now - records[digest]! < RETENTION_MS) return false;
      const recent = Object.entries(records)
        .filter(([, at]) => now - at < RETENTION_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_RECEIPTS - 1);
      await atomicWritePrivateTextFile(
        this.path,
        JSON.stringify({ ...Object.fromEntries(recent), [digest]: now }),
      );
      return true;
    });
  }
}
