import { createHash } from "node:crypto";

/** Retire only bindings formerly owned by the relay installer. Never contact the relay. */
export async function retireDeviceNodeRelay(ports: {
  read(): Promise<unknown>;
  removeMcp(name: string): Promise<void>;
  removeBindings(): Promise<void>;
}): Promise<void> {
  const raw = await ports.read();
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || !("records" in raw) || !Array.isArray(raw.records))
    throw new Error("device_bridge_operation_failed");
  const names = new Set<string>();
  for (const record of raw.records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(record.id)
    )
      throw new Error("device_bridge_operation_failed");
    names.add(`device-node-${createHash("sha256").update(record.id).digest("hex").slice(0, 20)}`);
  }
  // 旧中继发布必须先删除成功，再移除绑定；失败可在下次启动幂等重试。
  for (const name of names) await ports.removeMcp(name);
  await ports.removeBindings();
}
