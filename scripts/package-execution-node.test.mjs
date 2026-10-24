import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { executionNodeZip } from "./package-execution-node.mjs";

test("independent ZIP reader extracts exactly the declared node files with valid CRC and Unix permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "node-archive-"));
  try {
    const file = join(directory, "node.zip");
    await writeFile(
      file,
      executionNodeZip([
        { name: "device-bridge", data: Buffer.from("synthetic-node"), executable: true },
        { name: "USAGE.txt", data: Buffer.from("中文 usage") },
      ]),
    );
    await promisify(execFile)("python3", [
      "-c",
      `
import zipfile,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert z.namelist()==['device-bridge','USAGE.txt']
 assert z.read('device-bridge')==b'synthetic-node'
 assert z.read('USAGE.txt').decode()=='中文 usage'
 assert z.getinfo('device-bridge').external_attr >> 16 == 0o100755
`,
      file,
    ]);
    assert.throws(() => executionNodeZip([{ name: "../secret", data: Buffer.from("bad") }]));
    assert.throws(() =>
      executionNodeZip([
        { name: "same", data: Buffer.alloc(0) },
        { name: "same", data: Buffer.alloc(0) },
      ]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
