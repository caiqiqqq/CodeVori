import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildAcpPromptBlocks } from "../src/acp/acpPromptBlocks.js";

test("ACP sends actual image bytes and target-Host file references in one prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-prompt-"));
  try {
    const file = join(root, "sample.txt");
    await writeFile(file, "workspace content");
    const canonicalFile = await realpath(file);
    const blocks = await buildAcpPromptBlocks({
      text: "inspect",
      workspacePath: root,
      workspaceFiles: ["sample.txt"],
      attachments: [
        { fileName: "sample.png", mimeType: "image/png", dataBase64: "cG5n" },
        { fileName: "sample.txt", mimeType: "text/plain", path: file },
      ],
      capabilities: { image: true },
    });
    assert.deepEqual(blocks, [
      { type: "text", text: "inspect" },
      { type: "resource_link", uri: pathToFileURL(canonicalFile).href, name: "sample.txt" },
      { type: "image", data: "cG5n", mimeType: "image/png" },
      { type: "resource_link", name: "sample.txt", uri: pathToFileURL(canonicalFile).href },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP validates capabilities and target workspace before admitting a turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-prompt-"));
  const outside = await mkdtemp(join(tmpdir(), "zcode-acp-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
    const basic = { text: "inspect", workspacePath: root, workspaceFiles: [] };
    await assert.rejects(
      buildAcpPromptBlocks({
        ...basic,
        attachments: [{ fileName: "x.png", mimeType: "image/png", dataBase64: "cG5n" }],
      }),
      /does not accept images/,
    );
    await assert.rejects(
      buildAcpPromptBlocks({
        ...basic,
        attachments: [{ fileName: "x.txt", mimeType: "text/plain", dataBase64: "dGV4dA==" }],
      }),
      /does not accept embedded files/,
    );
    await assert.rejects(
      buildAcpPromptBlocks({ ...basic, workspaceFiles: ["escape.txt"], attachments: [] }),
      /outside/,
    );
    const blocks = await buildAcpPromptBlocks({
      ...basic,
      attachments: [{ fileName: "x.txt", mimeType: "text/plain", dataBase64: "dGV4dA==" }],
      capabilities: { embeddedContext: true },
    });
    assert.equal(blocks[1]?.type, "resource");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
