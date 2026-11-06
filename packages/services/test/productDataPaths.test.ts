import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatZCodeMainProcessName } from "@zcode/shared";
import { ensureAppCaCert } from "../src/runtime-tools/appCaCert.ts";
import { resolveStorageRoots } from "../src/storage/adapters/rootsResolver.ts";
import {
  getAppConfigDir,
  getConversationWorkspaceDir,
  getZCodeDataRootDir,
  setDataBaseDir,
} from "../src/paths.ts";

test("CodeVori application data uses its own product directory", () => {
  const baseDir = join("/tmp", "codevori-path-test");
  setDataBaseDir(baseDir);
  try {
    assert.equal(getZCodeDataRootDir(), join(baseDir, ".codevori"));
    assert.equal(getAppConfigDir(), join(baseDir, ".codevori", "v2"));
    assert.equal(getConversationWorkspaceDir(), join(baseDir, ".codevori", "workspace", "default"));
  } finally {
    setDataBaseDir(null);
  }
});

test("storage inventory lists CodeVori roots for home and custom data", () => {
  assert.deepEqual(resolveStorageRoots({ homeDir: "/home/user", dataBaseDir: "/data" }), [
    { id: "home", path: "/home/user/.codevori", hasCustomDataBaseDir: true },
    { id: "dataBaseDir", path: "/data/.codevori", hasCustomDataBaseDir: true },
  ]);
});

test("CodeVori generates its own CA identity and process label", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "codevori-ca-"));
  setDataBaseDir(baseDir);
  try {
    const certificate = ensureAppCaCert();
    assert.equal(certificate, join(baseDir, ".codevori", "v2", "certs", "codevori-network-ca.pem"));
    assert.match(await readFile(certificate, "utf8"), /BEGIN CERTIFICATE/u);
    assert.equal(formatZCodeMainProcessName(), "codevori-main");
  } finally {
    setDataBaseDir(null);
    await rm(baseDir, { recursive: true, force: true });
  }
});
