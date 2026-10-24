/** Shared bounded MCP session for native health and fixed read-only inspection tools. */
export async function withDeviceBridgeMcp<T>(
  endpoint: {
    url: string;
    token: string;
  },
  operation: (call: (message: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
  maxBytes = 2_000_000,
): Promise<T> {
  const url = new URL(endpoint.url);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("device_bridge_invalid_endpoint");
  let session: string | null = null;
  const abort = AbortSignal.timeout(12_000);
  const headers = () => ({
    Authorization: `Bearer ${endpoint.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
    ...(session ? { "Mcp-Session-Id": session } : {}),
  });
  const call = async (message: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(message),
      signal: abort,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("device_bridge_mcp_unavailable");
    }
    session = response.headers.get("mcp-session-id") ?? session;
    if (message.id === undefined) {
      await response.body?.cancel();
      return undefined;
    }
    let result: unknown;
    let received = 0;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("device_bridge_mcp_unavailable");
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > maxBytes) throw new Error("device_bridge_mcp_unavailable");
          // TCP 可以把 CRLF 拆成两片；先拼接再归一化，避免漏掉事件分隔符。
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
          if (buffer.length > maxBytes) throw new Error("device_bridge_mcp_unavailable");
          let split: number;
          while ((split = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = event
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const candidate = JSON.parse(data);
            if (candidate.id === message.id) {
              result = candidate;
              break;
            }
          }
          if (result) break;
        }
      } finally {
        await reader.cancel();
      }
    } else {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("device_bridge_mcp_unavailable");
      const parts: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > maxBytes) throw new Error("device_bridge_mcp_unavailable");
          parts.push(chunk.value);
        }
        result = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } finally {
        await reader.cancel();
      }
    }
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      result.id !== message.id ||
      "error" in result ||
      !("result" in result)
    )
      throw new Error("device_bridge_mcp_unavailable");
    return result.result;
  };
  try {
    const initialized = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "zcode-device-check", version: "1" },
      },
    });
    if (
      !initialized ||
      typeof initialized !== "object" ||
      !("protocolVersion" in initialized) ||
      initialized.protocolVersion !== "2025-03-26"
    )
      throw new Error("device_bridge_mcp_unavailable");
    await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    return await operation(call);
  } catch {
    throw new Error("device_bridge_mcp_unavailable");
  } finally {
    if (session)
      await fetch(url, {
        method: "DELETE",
        headers: headers(),
        signal: AbortSignal.timeout(2_000),
        redirect: "error",
      })
        .then((r) => r.body?.cancel())
        .catch(() => {});
  }
}

/** A bound socket alone is not executor health: handshake and list tools before publication. */
export async function checkDeviceBridgeMcp(endpoint: {
  url: string;
  token: string;
}): Promise<number> {
  return withDeviceBridgeMcp(endpoint, async (call) => {
    const listed = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    if (
      !listed ||
      typeof listed !== "object" ||
      !("tools" in listed) ||
      !Array.isArray(listed.tools)
    )
      throw new Error("device_bridge_mcp_unavailable");
    return listed.tools.length;
  });
}
