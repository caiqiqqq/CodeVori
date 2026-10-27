import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createTerminalService } from "../src/terminal/terminalService.js";
import type { ISettingService } from "../src/setting/setting.js";

test(
  "explicit terminal dispose terminates the real shell process and remains idempotent",
  { skip: process.platform === "win32", timeout: 10_000 },
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
      let output = "";
      subscription = service.onDynamicData(id)((chunk) => {
        output += chunk;
      });
      await service.write({ id, data: "printf '\\nZCODE_PTY_PID:%s\\n' \"$$\"\r" });
      for (let attempt = 0; attempt < 100 && !/ZCODE_PTY_PID:(\d+)/.test(output); attempt++)
        await delay(20);
      const pid = Number(/ZCODE_PTY_PID:(\d+)/.exec(output)?.[1]);
      assert.ok(Number.isInteger(pid) && pid > 1, output);
      process.kill(pid, 0);
      await service.dispose({ id });
      await service.dispose({ id });
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          throw error;
        }
      };
      for (let attempt = 0; attempt < 100 && alive(); attempt++) await delay(20);
      assert.equal(alive(), false, "PTY shell must exit after explicit close");
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
