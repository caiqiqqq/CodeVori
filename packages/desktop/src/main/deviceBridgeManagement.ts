/** Main-only management adapter. Credentials never reach the bridge, configuration or diagnostics. */
export async function removeTailscaleDevice(
  apiKey: string,
  nodeId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(nodeId)) throw new Error("device_bridge_invalid_device");
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(apiKey)) throw new Error("device_bridge_management_required");
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(
      `https://api.tailscale.com/api/v2/device/${encodeURIComponent(nodeId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      },
    );
  } catch {
    // DELETE 发出后断网或取消不能证明服务端未执行；禁止自动重试或误报失败未删除。
    throw new Error("device_bridge_removal_unconfirmed");
  }
  // 不读取响应正文，避免把服务端信息或凭据带进 IPC 错误/日志。
  void response.body?.cancel().catch(() => {});
  if (response.status === 200 || response.status === 204) return;
  const code =
    response.status === 401
      ? "management_unauthorized"
      : response.status === 403
        ? "management_forbidden"
        : response.status === 404
          ? "device_missing"
          : response.status === 501
            ? "device_external"
            : response.status >= 500
              ? "removal_unconfirmed"
              : "management_failed";
  throw new Error(`device_bridge_${code}`);
}
