import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_DATA_DIRECTORY_NAME } from "@zcode/shared";
import { saveCliMcpToUserDirectory } from "../src/main/mcpUserDirectory/index.js";

for (const action of ["upsert", "delete", "set-enabled"] as const) {
  test(`desktop MCP ${action} preserves corrupt user config`, async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-mcp-config-"));
    const previous = process.env.HOME;
    process.env.HOME = home;
    const path = join(home, PRODUCT_DATA_DIRECTORY_NAME, "cli", "config.json");
    try {
      await mkdir(join(home, PRODUCT_DATA_DIRECTORY_NAME, "cli"), { recursive: true });
      const raw = '{"providers":';
      await writeFile(path, raw);
      await assert.rejects(
        saveCliMcpToUserDirectory({
          action,
          name: "fixture",
          ...(action === "upsert" ? { config: { command: "node" } } : {}),
          ...(action === "set-enabled" ? { enabled: false } : {}),
        }),
      );
      assert.equal(await readFile(path, "utf8"), raw);
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
}
