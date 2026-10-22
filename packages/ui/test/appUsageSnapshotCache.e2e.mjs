// Renderer fixture for real hook lifecycle; no user sessions or running Host are changed.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const rendererRoot = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__usage-cache-e2e-${process.pid}`;
const html = join(rendererRoot, `${name}.html`);
const moduleFile = join(rendererRoot, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
    import { useAppUsageStats } from "../../../ui/src/hooks/useUsageStats.ts";
    window.__usageRequests = [];
    const pending = [];
    const services = Object.fromEntries(["A", "B"].map(host => [host, { usageStatsService: {
      getAppUsageSnapshot(request) {
        const serial = window.__usageRequests.length + 1;
        window.__usageRequests.push({host, ...request, serial});
        return new Promise((resolve, reject) => pending.push({host, request, serial, resolve, reject}));
      },
    }}]));
    function settle(host, fail = false) {
      for (const item of pending.splice(0)) {
        if (item.host !== host) { pending.push(item); continue; }
        if (fail) item.reject(new Error("fixture offline"));
        else item.resolve({range: item.request.range, generatedAt: item.serial});
      }
    }
    function Result({label, value}) {
      return <div><output data-testid={label}>{value.snapshot?.range ?? "empty"}:{value.snapshot?.generatedAt ?? "empty"}:{value.loading ? "loading" : "ready"}:{value.error ?? "ok"}</output><button onClick={() => void value.refresh()}>Refresh {label}</button></div>;
    }
    function Probe({range}) {
      const lifetime = useAppUsageStats("all");
      const selected = useAppUsageStats(range);
      return <><Result label="lifetime" value={lifetime}/><Result label="selected" value={selected}/></>;
    }
    function Fixture() {
      const [open, setOpen] = useState(true);
      const [host, setHost] = useState("A");
      const [range, setRange] = useState("7d");
      return <>
        <button onClick={() => setOpen(value => !value)}>{open ? "Close page" : "Open page"}</button>
        <button onClick={() => setHost("A")}>Host A</button><button onClick={() => setHost("B")}>Host B</button>
        <button onClick={() => setRange("all")}>All time</button><button onClick={() => setRange("7d")}>Seven days</button>
        <button onClick={() => settle("A")}>Resolve A</button><button onClick={() => settle("B")}>Resolve B</button>
        <button onClick={() => settle("B", true)}>Fail B</button>
        <ServiceProvider services={services[host]}>{open ? <Probe range={range}/> : null}</ServiceProvider>
      </>;
    }
    createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture/></React.StrictMode>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${process.env.ZCODE_USAGE_E2E_ORIGIN ?? "http://localhost:5174"}/${name}.html`);
  const selected = page.getByTestId("selected");
  const lifetime = page.getByTestId("lifetime");
  const textIs = (locator, text) =>
    page.waitForFunction(
      ({ label, text }) => document.querySelector(`[data-testid="${label}"]`)?.textContent === text,
      { label: locator, text },
    );
  const requestCount = (count) =>
    page.waitForFunction((count) => window.__usageRequests.length === count, count);
  await requestCount(2);
  await page.getByRole("button", { name: "Resolve A", exact: true }).click();
  await textIs("selected", "7d:2:ready:ok");
  await textIs("lifetime", "all:1:ready:ok");
  await page.getByRole("button", { name: "Close page", exact: true }).click();
  await page.getByRole("button", { name: "Open page", exact: true }).click();
  await requestCount(4);
  assert.equal(
    await selected.textContent(),
    "7d:2:loading:ok",
    "reopen displays the cached projection before slow IO completes",
  );
  assert.equal(await lifetime.textContent(), "all:1:loading:ok");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await textIs("selected", "all:1:loading:ok");
  assert.equal(
    await page.evaluate(() => window.__usageRequests.length),
    4,
    "two all-time subscriptions must share the active request",
  );
  await page.getByRole("button", { name: "Host B", exact: true }).click();
  await requestCount(5);
  await textIs("selected", "empty:empty:loading:ok");
  await textIs("lifetime", "empty:empty:loading:ok");
  await page.getByRole("button", { name: "Resolve A", exact: true }).click();
  assert.equal(
    await selected.textContent(),
    "empty:empty:loading:ok",
    "late old Host response must not replace the new Host view",
  );
  await page.getByRole("button", { name: "Resolve B", exact: true }).click();
  await textIs("selected", "all:5:ready:ok");
  await page.getByRole("button", { name: "Refresh selected", exact: true }).click();
  await requestCount(6);
  await page.getByRole("button", { name: "Fail B", exact: true }).click();
  await textIs("selected", "all:5:ready:fixture offline");
  await page.getByRole("button", { name: "Refresh selected", exact: true }).click();
  await requestCount(7);
  await page.getByRole("button", { name: "Resolve B", exact: true }).click();
  await textIs("selected", "all:7:ready:ok");
  // Changing scopes while an earlier request is pending cannot repaint the selected range.
  await page.getByRole("button", { name: "Seven days", exact: true }).click();
  await requestCount(8);
  await textIs("selected", "empty:empty:loading:ok");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await requestCount(9);
  await textIs("selected", "all:7:loading:ok");
  await page.getByRole("button", { name: "Resolve B", exact: true }).click();
  await textIs("selected", "all:9:ready:ok");
  console.log(
    "usage cache E2E passed: StrictMode, reopen, deduplication, Host/range isolation, late responses, refresh failure and retry",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
