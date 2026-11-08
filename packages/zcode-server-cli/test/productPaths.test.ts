import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveServerLayout } from "../src/runtime/paths.ts";
import { createDaemonServiceDescriptor } from "../src/platform/serviceManager.ts";
import { createReleaseAgentWiring } from "../src/runtime/agentWiring.ts";
import {
  ensureServerInstallOwnership,
  validateServerInstallOwnership,
} from "../src/runtime/installationOwnership.ts";
import { createRuntimeManifest, serverRuntimeManifestSchema } from "../src/runtime/manifest.ts";
import { writeStableLauncher } from "../src/runtime/stableLauncher.ts";

test("CodeVori server layout and service identity stay separate from ZCode", () => {
  const layout = resolveServerLayout("/tmp/example/.codevori/server");
  assert.equal(layout.dataBaseDir, "/tmp/example");
  const descriptor = createDaemonServiceDescriptor({ platform: "darwin", layout });
  assert.match(descriptor.name, /^dev\.codevori\.server\./u);
  assert.doesNotMatch(descriptor.name, /zcode/u);
  assert.match(descriptor.content, /bin\/codevori/u);
  if (process.platform === "win32") {
    assert.match(layout.controlEndpoint, /codevori-server-/u);
  }
});

test("new server release paths use CodeVori and old manifests remain readable", async () => {
  const manifest = createRuntimeManifest("linux-x64", "1.0.0");
  assert.equal(manifest.product, "codevori-server");
  assert.equal(manifest.entrypoints.agent, "runtime/codevori.cjs");
  assert.equal(
    serverRuntimeManifestSchema.parse({ ...manifest, product: "zcode-server" }).product,
    "zcode-server",
  );

  const root = await mkdtemp(join(tmpdir(), "codevori-server-path-test-"));
  try {
    const layout = resolveServerLayout(join(root, "server"));
    const launcherPath = await writeStableLauncher(layout, "linux");
    assert.equal(launcherPath, join(layout.stableBinDir, "codevori"));
    assert.match(await readFile(launcherPath, "utf8"), /runtime\/server-cli\.js/u);
    const wiring = createReleaseAgentWiring(join(root, "runtime"), join(root, "node"), {});
    assert.deepEqual(
      JSON.parse(wiring!.ZCODE_AGENT_SERVER_ARGS_JSON)[0],
      join(root, "runtime", "codevori.cjs"),
    );
    const ownership = await ensureServerInstallOwnership(layout);
    assert.equal(ownership.product, "codevori-server");
    // 旧版标记仍可读取，避免升级后把已有安装误判为其他产品。
    await writeFile(layout.installFile, JSON.stringify({ ...ownership, product: "zcode-server" }));
    assert.equal((await validateServerInstallOwnership(layout)).product, "zcode-server");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
