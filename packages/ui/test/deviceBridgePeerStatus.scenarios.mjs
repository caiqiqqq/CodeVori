import assert from "node:assert/strict";

export async function verifyDevicePeerStatus({ page, panel, ready }) {
  const originalLocale = (await panel.getByTestId("device-bridge-refresh").textContent()).includes("刷新")
    ? "zh-CN"
    : "en-US";
  const original = await page.evaluate(() => structuredClone(window.__devices.snapshot));
  const status = panel.getByTestId("device-bridge-peer-status-windows");
  const network = status.getByTestId("device-bridge-peer-network-status");
  const tools = status.getByTestId("device-bridge-peer-tool-status");
  const cases = [
    [{ connected: false }, "Tools not connected", "尚未连接工具"],
    [{ connected: true }, "Awaiting tool check", "工具待检查"],
    [{ connected: true, checkedAt: "2026-10-25T00:00:00Z" }, "Awaiting tool check", "工具待检查"],
    [{ connected: true, toolCount: 7 }, "Awaiting tool check", "工具待检查"],
    [
      { connected: true, checkedAt: "2026-10-25T00:00:00Z", toolCount: 0 },
      "No tools found",
      "未发现工具",
    ],
    [
      { connected: true, checkedAt: "2026-10-25T00:00:00Z", toolCount: 7 },
      "Tool check passed",
      "工具检查通过",
    ],
    [
      { connected: true, online: false, checkedAt: "2026-10-25T00:00:00Z", toolCount: 7 },
      "Tools unavailable",
      "工具不可用",
    ],
    [
      { connected: false, checkedAt: "2026-10-25T00:00:00Z", toolCount: 7 },
      "Tools not connected",
      "尚未连接工具",
    ],
  ];
  for (const [locale, labelIndex] of [
    ["en-US", 1],
    ["zh-CN", 2],
  ]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    for (const entry of cases) {
      await page.evaluate(
        ({ peer, original }) => {
          window.__devices.snapshot = structuredClone(original);
          Object.assign(window.__devices.snapshot.peers[0], peer);
        },
        { peer: entry[0], original },
      );
      await panel.getByTestId("device-bridge-refresh").click();
      await ready();
      assert.equal(await tools.textContent(), entry[labelIndex]);
      assert.equal(
        await network.textContent(),
        entry[0].online === false
          ? locale === "en-US"
            ? "Offline"
            : "网络离线"
          : locale === "en-US"
            ? "Online"
            : "网络在线",
      );
    }
    for (const patch of [{ phase: "stopped" }, { backendState: "NeedsLogin" }]) {
      await page.evaluate(
        ({ patch, original }) => {
          window.__devices.snapshot = structuredClone(original);
          Object.assign(window.__devices.snapshot, patch);
          Object.assign(window.__devices.snapshot.peers[0], {
            connected: true,
            checkedAt: "2026-10-25T00:00:00Z",
            toolCount: 7,
          });
        },
        { patch, original },
      );
      await panel.getByTestId("device-bridge-refresh").click();
      await ready();
      assert.equal(
        await network.textContent(),
        locale === "en-US" ? "Network disconnected" : "网络未连接",
      );
      assert.equal(
        await tools.textContent(),
        locale === "en-US" ? "Tools unavailable" : "工具不可用",
      );
    }
  }
  await page.evaluate((original) => {
    window.__devices.snapshot = original;
  }, original);
  await page.evaluate((locale) => window.__devices.setLocale(locale), originalLocale);
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
}
