import {
  deviceInspectionResultSchema,
  deviceSystemStatusSchema,
  type DeviceInspectionRequest,
  type DeviceInspectionResult,
} from "@zcode/shared";
import { withDeviceBridgeMcp } from "./deviceBridgeMcpCheck.js";

/** Fixed native reads: never accept a shell command, tool name or destination from Renderer. */
export async function inspectDeviceBridgeMcp(
  endpoint: { url: string; token: string },
  request: DeviceInspectionRequest,
): Promise<DeviceInspectionResult> {
  try {
    return await withDeviceBridgeMcp(
      endpoint,
      async (call) => {
        const result = await call({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: request.kind === "system" ? "node_status" : "desktop_screenshot",
            arguments: {},
          },
        });
        if (
          !result ||
          typeof result !== "object" ||
          ("isError" in result && result.isError) ||
          !("content" in result) ||
          !Array.isArray(result.content)
        )
          throw Error("invalid_observation");
        if (request.kind === "system") {
          const text = result.content.find(
            (c: unknown) =>
              c &&
              typeof c === "object" &&
              "type" in c &&
              c.type === "text" &&
              "text" in c &&
              typeof c.text === "string",
          );
          if (!text) throw Error("missing_status");
          return deviceInspectionResultSchema.parse({
            kind: "system",
            nodeId: request.nodeId,
            status: deviceSystemStatusSchema.parse(JSON.parse(text.text)),
          });
        }
        const image = result.content.find(
          (c: unknown) => c && typeof c === "object" && "type" in c && c.type === "image",
        );
        const parsed = deviceInspectionResultSchema.parse({
          kind: "screen",
          nodeId: request.nodeId,
          sampledAt: new Date().toISOString(),
          data: image?.data,
          mimeType: image?.mimeType,
        });
        if (parsed.kind !== "screen") throw Error("invalid_screen");
        const bytes = Buffer.from(parsed.data, "base64");
        // 远端只允许有界 PNG；不能把任意内容或外部 URL 交给浏览器渲染。
        if (
          bytes.length > 16 * 1024 * 1024 ||
          bytes.length < 24 ||
          bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
          bytes.toString("base64") !== parsed.data
        )
          throw Error("invalid_png");
        const width = bytes.readUInt32BE(16),
          height = bytes.readUInt32BE(20);
        if (!width || !height || width > 16384 || height > 16384 || width * height > 100_000_000)
          throw Error("invalid_dimensions");
        return parsed;
      },
      request.kind === "screen" ? 24_000_000 : 2_000_000,
    );
  } catch {
    throw Error("device_bridge_inspection_unavailable");
  }
}

type InspectionEndpoint = { url: string; token: string };
export type DeviceBridgeInspectionReader<T extends InspectionEndpoint> = (
  endpoint: T,
  input: DeviceInspectionRequest,
) => Promise<DeviceInspectionResult>;
/** Pending reads are local to an endpoint; network identity and lifecycle stay with the controller. */
export function createDeviceBridgeInspector<T extends InspectionEndpoint>(ports: {
  connection(nodeId: string): { endpoint: T; generation: number } | undefined;
  read?: DeviceBridgeInspectionReader<T>;
}) {
  const pending = new WeakMap<T, Set<string>>();
  return async (input: DeviceInspectionRequest): Promise<DeviceInspectionResult> => {
    const before = ports.connection(input.nodeId);
    if (!before || !ports.read) throw Error("device_bridge_inspection_unavailable");
    const kinds = pending.get(before.endpoint) ?? new Set<string>();
    if (kinds.has(input.kind)) throw Error("device_bridge_inspection_unavailable");
    kinds.add(input.kind);
    pending.set(before.endpoint, kinds);
    try {
      const result = await ports.read(before.endpoint, input);
      const after = ports.connection(input.nodeId);
      // 重连可以复用节点 ID；迟到结果必须匹配原 endpoint 及其进程代次。
      if (after?.endpoint !== before.endpoint || after.generation !== before.generation)
        throw Error("device_bridge_inspection_unavailable");
      return result;
    } finally {
      kinds.delete(input.kind);
    }
  };
}
