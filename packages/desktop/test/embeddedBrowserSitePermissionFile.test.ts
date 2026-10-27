import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmbeddedBrowserSitePermissionFile } from "../src/main/embeddedBrowserSitePermissionFile.ts";

test("site permission file tolerates malformed data and restores an atomic write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "site-permission-file-"));
  try {
    const path = join(directory, "permissions.json");
    const file = createEmbeddedBrowserSitePermissionFile(path);
    assert.deepEqual(await file.load(), {});
    await writeFile(path, "invalid json", "utf8");
    assert.deepEqual(await file.load(), {});
    const record = { "https://example.com": { notifications: "deny" as const } };
    await file.save(record);
    assert.deepEqual(await createEmbeddedBrowserSitePermissionFile(path).load(), record);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
