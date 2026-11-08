import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPluginSyncArchive,
  extractPluginSyncArchive,
  PLUGIN_SYNC_METADATA_ARCHIVE_PATH,
} from "../src/plugin-sync/pluginSyncArchive.ts";

test("new plugin sync archives write CodeVori metadata path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codevori-plugin-sync-test-"));
  try {
    const archive = await createPluginSyncArchive({ entries: [], metadata: { plugins: [] } });
    await extractPluginSyncArchive(archive, directory);
    assert.equal(PLUGIN_SYNC_METADATA_ARCHIVE_PATH, ".codevori-plugin-sync.json");
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, PLUGIN_SYNC_METADATA_ARCHIVE_PATH), "utf8")),
      {
        plugins: [],
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
