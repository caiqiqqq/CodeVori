import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCodexNativeUsage } from "../src/acp/acpNativeUsage.js";

const id = "019c7714-3b77-74d1-9866-e1f484aae2ab";
const meta = (cwd: string, nativeId = id) => ({
  type: "session_meta",
  payload: { id: nativeId, cwd },
});
const tokens = (input: number, output: number, cache = 0) => ({
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
        cached_input_tokens: cache,
        reasoning_output_tokens: output,
      },
    },
  },
});
async function fixture(run: (root: string, cwd: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "acp-native-usage-"));
  const cwd = join(root, "workspace");
  const dir = join(root, "sessions", "2026", "10", "08");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd);
  try {
    await run(root, cwd, join(dir, `rollout-2026-10-08T00-00-00-${id}.jsonl`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const jsonl = (...rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

test("Codex uses exact native cumulative counter, never sums duplicate events or reasoning output", async () => {
  await fixture(async (root, cwd, file) => {
    await writeFile(
      file,
      jsonl(meta(cwd), tokens(100, 20, 60), tokens(100, 20, 60), tokens(150, 30, 90)),
    );
    assert.deepEqual(
      await readCodexNativeUsage({ sessionId: id, workspacePath: cwd, env: { CODEX_HOME: root } }),
      {
        nativeSessionId: id,
        usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180, cacheReadTokens: 90 },
      },
    );
    await writeFile(file, jsonl(meta(cwd), tokens(100, 20), tokens(10, 2)));
    assert.equal(
      (await readCodexNativeUsage({ sessionId: id, workspacePath: cwd, env: { CODEX_HOME: root } }))
        ?.usage.totalTokens,
      12,
    );
  });
});
test("Codex respects configured tilde home and default HOME/.codex", async () => {
  await fixture(async (root, cwd, file) => {
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2)));
    const home = join(root, "home");
    await mkdir(home);
    await mkdir(join(home, ".codex", "sessions", "2026", "10", "08"), { recursive: true });
    await writeFile(
      join(home, ".codex", "sessions", "2026", "10", "08", `rollout-${id}.jsonl`),
      jsonl(meta(cwd), tokens(20, 4)),
    );
    assert.equal(
      (
        await readCodexNativeUsage({
          sessionId: id,
          workspacePath: cwd,
          env: { HOME: root, CODEX_HOME: "~" },
        })
      )?.usage.totalTokens,
      12,
    );
    assert.equal(
      (await readCodexNativeUsage({ sessionId: id, workspacePath: cwd, env: { HOME: home } }))
        ?.usage.totalTokens,
      24,
    );
    assert.equal(
      await readCodexNativeUsage({
        sessionId: id,
        workspacePath: cwd,
        env: { CODEX_HOME: "relative" },
      }),
      null,
    );
  });
});
test("mismatching metadata, cwd, duplicate candidates and unsafe IDs are rejected", async () => {
  await fixture(async (root, cwd, file) => {
    const input = { sessionId: id, workspacePath: cwd, env: { CODEX_HOME: root } };
    await writeFile(file, jsonl(meta(cwd, crypto.randomUUID()), tokens(10, 2)));
    assert.equal(await readCodexNativeUsage(input), null);
    await writeFile(file, jsonl(meta(root), tokens(10, 2)));
    assert.equal(await readCodexNativeUsage(input), null);
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2)));
    await writeFile(
      join(root, "sessions", `rollout-other-${id}.jsonl`),
      jsonl(meta(cwd), tokens(90, 9)),
    );
    assert.equal(await readCodexNativeUsage(input), null);
    assert.equal(await readCodexNativeUsage({ ...input, sessionId: "../../secret" }), null);
  });
});
test("missing/malformed/truncated usage stays unknown; complete prior lines survive unflushed tail", async () => {
  await fixture(async (root, cwd, file) => {
    const input = { sessionId: id, workspacePath: cwd, env: { CODEX_HOME: root } };
    assert.equal(await readCodexNativeUsage(input), null);
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2)) + '{"type":"event_msg"');
    assert.equal((await readCodexNativeUsage(input))?.usage.totalTokens, 12);
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2), tokens(10, 2, 11)));
    assert.equal(await readCodexNativeUsage(input), null);
    await writeFile(file, jsonl(meta(cwd)) + "not-json\n");
    assert.equal(await readCodexNativeUsage(input), null);
  });
});

test("on-demand native usage keeps its size and candidate safety limits", async () => {
  await fixture(async (root, cwd, file) => {
    const { truncate, rename, symlink } = await import("node:fs/promises");
    const input = { sessionId: id, workspacePath: cwd, env: { CODEX_HOME: root } };
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2)));
    await truncate(file, 64 * 1024 * 1024 + 1);
    assert.equal(await readCodexNativeUsage(input), null);
    await writeFile(file, jsonl(meta(cwd), tokens(10, 2)));
    const archived = join(root, "archived_sessions");
    await mkdir(archived);
    const archive = join(archived, `rollout-${id}.jsonl`);
    await rename(file, archive);
    assert.equal(await readCodexNativeUsage(input), null);
    if (process.platform !== "win32") {
      await symlink(archive, file);
      assert.equal(await readCodexNativeUsage(input), null);
    }
  });
});
