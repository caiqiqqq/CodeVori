import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ISettingService } from "../src/setting/setting.js";
import { createTerminalService } from "../src/terminal/terminalService.js";

test(
  "real PTY retains initial output until a delayed data subscription",
  {
    skip: process.platform === "win32" ? "isolated /bin/sh fixture requires POSIX" : false,
    timeout: 10_000,
  },
  async () => {
    const previousShell = process.env.SHELL;
    const previousEnv = process.env.ENV;
    process.env.SHELL = "/bin/sh";
    process.env.ENV = "/dev/null";
    const service = createTerminalService({
      settingService: {
        get: async () => ({ terminalInheritSystemProfile: false }),
      } as ISettingService,
    });
    let id: string | undefined;
    let subscription: { dispose(): void } | undefined;
    try {
      ({ id } = await service.create({ cols: 80, rows: 24, cwd: "/tmp" }));
      await service.write({ id, data: "printf '\\nZCODE_STARTUP_MARKER\\n'\r" });
      await delay(250);
      let received = "";
      subscription = service.onDynamicData(id)((chunk) => {
        received += chunk;
      });
      await service.write({ id, data: "printf '\\nZCODE_LIVE_MARKER\\n'\r" });
      for (let attempt = 0; attempt < 100 && !received.includes("ZCODE_LIVE_MARKER"); attempt++) {
        await delay(20);
      }
      assert.ok(
        received.includes("ZCODE_STARTUP_MARKER"),
        "subscription must receive startup backlog",
      );
      assert.ok(received.includes("ZCODE_LIVE_MARKER"), "live data must continue after replay");
    } finally {
      subscription?.dispose();
      if (id) await service.dispose({ id });
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      if (previousEnv === undefined) delete process.env.ENV;
      else process.env.ENV = previousEnv;
    }
  },
);
