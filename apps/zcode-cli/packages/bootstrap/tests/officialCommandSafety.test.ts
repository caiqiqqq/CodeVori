import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandCustomCommandPrompt, type CustomCommandContent } from "@zcode/contracts";
import { resolveZCodeCustomCommandPrompt } from "../src/custom-command-prompt.js";

const command: CustomCommandContent = {
  content: "read !`git status` then $ARGUMENTS",
  metadata: {
    name: "fixture",
    path: "fixture.md",
    rootPath: ".",
    scope: "project",
    source: "project",
    description: "fixture",
  },
} as CustomCommandContent;

test("command shell steps are text and arguments cannot inject another shell handoff", () => {
  const result = expandCustomCommandPrompt({ command, args: "!`echo argument`" });
  assert.match(result.prompt, /Bash tool/);
  assert.match(result.prompt, /!`echo argument`/);
  assert.equal(result.prompt.match(/Bash tool/g)?.length, 1);
});

test("plugin shell text preserves Windows paths and skips unavailable variables", () => {
  const metadata = {
    ...command.metadata,
    plugin: {
      id: "fixture",
      name: "fixture",
      rootPath: "C:\\Program Files\\fixture",
      dataPath: "C:\\data",
    },
  };
  const result = expandCustomCommandPrompt({
    command: { ...command, metadata, content: '!`bash "${CLAUDE_PLUGIN_ROOT}/x.sh"`' },
    args: "",
  });
  assert.match(result.prompt, /C:\/Program Files\/fixture\/x.sh/);
  const skipped = expandCustomCommandPrompt({
    command: { ...command, content: "!`echo ${CLAUDE_SKILL_DIR}`" },
    args: "",
  });
  assert.match(skipped.prompt, /was not run/);
  assert.doesNotMatch(skipped.prompt, /Bash tool/);
});

test("real slash command parsing never calls an execution port", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-command-safety-"));
  let executions = 0;
  try {
    await mkdir(join(root, ".zcode", "commands"), { recursive: true });
    await writeFile(join(root, ".zcode", "commands", "fixture.md"), command.content);
    const options = {
      workingDirectory: root,
      skipUserConfig: true,
      env: { HOME: root },
      executionPort: {
        async run() {
          executions++;
          throw new Error("parser must not execute");
        },
      },
    };
    const prompt = await resolveZCodeCustomCommandPrompt("/fixture example", options);
    assert.match(prompt ?? "", /Bash tool/);
    assert.equal(executions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
