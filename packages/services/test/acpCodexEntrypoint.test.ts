import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { prepareManagedCodexAcpEntrypoint } from "../src/acp/acpCodexEntrypoint.js";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";

// Synthetic adapter with the reviewed 2.5.0 call sites; no upstream bundle is vendored.
const fixture = `
import { value } from './sibling.mjs';
const sessionState = {
  titleGen: { onTurnCompleted() { throw new Error('title opened MCP'); } },
  promptSuggestions: { onTurnCompleted() { throw new Error('suggestion opened MCP'); } }
};
const eventHandler = { getLastAgentMessageText() { return 'answer'; } };
const promptText = 'main prompt';
sessionState.titleGen?.onTurnCompleted(promptText);
sessionState.promptSuggestions?.onTurnCompleted(promptText, eventHandler.getLastAgentMessageText());
process.stdout.write(value + ':' + process.env.CODEX_HOME);
`;

test("managed 2.5.0 suppresses background generators while preserving main execution and original bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-codex-entry-"));
  const script = join(root, "index.mjs");
  try {
    await writeFile(script, fixture);
    await writeFile(join(root, "sibling.mjs"), "export const value = 'main';");
    const paths = await Promise.all(
      Array.from({ length: 4 }, () => prepareManagedCodexAcpEntrypoint(script, "2.5.0")),
    );
    assert.equal(new Set(paths).size, 1);
    assert.notEqual(paths[0], script);
    assert.equal(await readFile(script, "utf8"), fixture);
    const { stdout } = await promisify(execFile)(process.execPath, [paths[0]!], {
      env: { ...process.env, CODEX_HOME: "synthetic-native-home" },
    });
    assert.equal(stdout, "main:synthetic-native-home");
    await writeFile(paths[0]!, "throw new Error('corrupt cache');");
    const repaired = await prepareManagedCodexAcpEntrypoint(script, "2.5.0");
    assert.equal(repaired, paths[0]);
    assert.match(await readFile(repaired, "utf8"), /ZCode/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compatibility rule is version bounded and refuses missing or ambiguous call sites", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-codex-signature-"));
  const script = join(root, "index.mjs");
  try {
    await writeFile(script, fixture);
    assert.equal(await prepareManagedCodexAcpEntrypoint(script, "1.10.0"), script);
    assert.equal(await prepareManagedCodexAcpEntrypoint(script, "2.6.0"), script);
    for (const source of [fixture.replace("titleGen?.", "different?."), fixture + fixture]) {
      await writeFile(script, source);
      await assert.rejects(prepareManagedCodexAcpEntrypoint(script, "2.5.0"), /signature/);
      assert.equal(await readFile(script, "utf8"), source);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent manager selects the prepared managed entrypoint and forces the upstream suggestion switch", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-codex-launch-"));
  const packageDir = join(
    root,
    "codex",
    "npm",
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
  );
  const script = join(packageDir, "dist", "index.mjs");
  const nativeHome = join(root, "native-home");
  const manager = createAcpAgentManager({
    directory: root,
    env: { ...process.env, PATH: dirname(process.execPath), CODEX_HOME: nativeHome },
  });
  try {
    await mkdir(dirname(script), { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@agentclientprotocol/codex-acp",
        version: "2.5.0",
        bin: { "codex-acp": "dist/index.mjs" },
      }),
    );
    await writeFile(script, fixture);
    await manager.updateAgent({ agent: "codex", env: { CODEX_ACP_PROMPT_SUGGESTIONS: "true" } });
    const launch = await manager.resolveLaunch("codex");
    assert.notEqual(launch.args[0], script);
    assert.equal(launch.args[0], await prepareManagedCodexAcpEntrypoint(script, "2.5.0"));
    assert.equal(launch.env.CODEX_ACP_PROMPT_SUGGESTIONS, "false");
    assert.equal(launch.env.CODEX_HOME, nativeHome);
    assert.equal(await readFile(script, "utf8"), fixture);
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
