import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSourceServerId } from "../src/sourceServerIdentity.js";

test("parallel server starts use one persisted source identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-source-id-"));
  try {
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensureSourceServerId(directory)));
    assert.match(ids[0]!, /^[0-9a-f-]{36}$/i);
    assert.equal(new Set(ids).size, 1);
    assert.equal(await ensureSourceServerId(directory), ids[0]);
    assert.equal((await readFile(join(directory, "source-server-id"), "utf8")).trim(), ids[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a damaged source identity is not silently replaced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-source-id-"));
  try {
    await writeFile(join(directory, "source-server-id"), "invalid-id\n");
    await assert.rejects(ensureSourceServerId(directory), /Invalid Source Server identity/);
    assert.equal(await readFile(join(directory, "source-server-id"), "utf8"), "invalid-id\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
