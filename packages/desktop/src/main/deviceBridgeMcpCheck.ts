/** Read-only MCP handshake. A bound bridge socket alone is not executor health. */
export async function checkDeviceBridgeMcp(endpoint: {
  url: string;
  token: string;
}): Promise<number> {
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
    if (!response.ok) throw new Error("device_bridge_mcp_unavailable");
    session = response.headers.get("mcp-session-id") ?? session;
    if (message.id === undefined) {
      await response.body?.cancel();
      return undefined;
    }
    let result: unknown;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("device_bridge_mcp_unavailable");
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          // TCP 可以把 CRLF 拆成两片；先拼接再归一化，避免漏掉事件分隔符。
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
          if (buffer.length > 2_000_000) throw new Error("device_bridge_mcp_unavailable");
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
      result = await response.json();
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
    const listed = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    if (
      !listed ||
      typeof listed !== "object" ||
      !("tools" in listed) ||
      !Array.isArray(listed.tools)
    )
      throw new Error("device_bridge_mcp_unavailable");
    return listed.tools.length;
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
