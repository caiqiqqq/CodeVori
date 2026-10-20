import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import yauzl from "yauzl";
import { DiagnosticLogWriter } from "../src/main/diagnosticLogWriter.ts";

const root = await mkdtemp(join(tmpdir(), "codevori-export-test-"));
const sourceDir = join(root, "app-data");
const cliDir = join(root, ".zcode/cli");
const now = new Date(2026, 9, 20, 12, 34, 56);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
// 只隔离用户目录、桌面日志 sink 与服务路径；收集、脱敏、ZIP 和回退目录均运行真实实现。
const osUrl = moduleUrl(`export const homedir = () => ${JSON.stringify(root)};`);
const servicesUrl = moduleUrl(`
  export const getAppConfigDir = () => ${JSON.stringify(sourceDir)};
  export const getExportLogDir = () => ${JSON.stringify(join(root, "exports"))};
  export const getExportLogStageDir = () => ${JSON.stringify(join(root, "stage"))};
  export const getFeedbackLogArchiveDir = () => { throw new Error('Unexpected feedback archive'); };
  export const createFeedbackDiagnosticArchive = () => { throw new Error('Unexpected feedback archive'); };
`);
const loggerUrl = moduleUrl("export const logger = { info() {}, warn() {}, error() {} };");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/src/main/exportLogs.ts")) {
      const url = {
        "node:os": osUrl,
        "@zcode/services/node": servicesUrl,
        "./logger.js": loggerUrl,
      }[specifier];
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function readZip(path) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, file) =>
      error ? reject(error) : resolve(file),
    );
  });
  const files = new Map();
  await new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = [];
        stream.on("error", reject);
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          files.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  }).finally(() => zip.close());
  return files;
}

try {
  const { exportLogs } = await import("../src/main/exportLogs.ts");
  for (const directory of ["logs", "acp-stream-diagnostics", "dev", "sessions"]) {
    await mkdir(join(sourceDir, directory), { recursive: true });
  }
  await mkdir(join(cliDir, "log"), { recursive: true });
  await writeFile(join(sourceDir, "logs/2026-10-20.log"), "main lifecycle\n");
  const diagnosticsPath = join(sourceDir, "logs/2026-10-20.diagnostics.log");
  const writer = new DiagnosticLogWriter({ schedule: false });
  writer.enqueue(
    diagnosticsPath,
    '[diagnostics] renderer-loop lagMs=321 {"token":"fixture-secret"}\n',
  );
  writer.enqueue(diagnosticsPath, "[diagnostics] acp-host-stream phase=broadcast revision=12\n");
  writer.enqueue(
    diagnosticsPath,
    "[diagnostics] renderer-acp-stream phase=ui-commit revision=12\n",
  );
  await writer.flush();
  await writeFile(join(cliDir, "log/agent.log"), "agent lifecycle\n");
  await writeFile(join(sourceDir, "logs/old.diagnostics.log"), "old diagnostics\n");
  const old = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
  await utimes(join(sourceDir, "logs/old.diagnostics.log"), old, old);
  for (const path of [
    "credentials.json",
    "acp-stream-diagnostics/legacy.log",
    "dev/stdio.log",
    "sessions/private.json",
  ]) {
    await writeFile(join(sourceDir, path), "excluded fixture\n");
  }
  for (const path of [
    diagnosticsPath,
    join(sourceDir, "logs/2026-10-20.log"),
    join(cliDir, "log/agent.log"),
  ]) {
    await utimes(path, now, now);
  }

  await test("manual ZIP exports use CodeVori and include recent performance/ACP diagnostics with existing privacy rules", async () => {
    const revealed = [];
    const result = await exportLogs({
      now: () => now,
      showItemInFolder: (path) => revealed.push(path),
    });
    assert.equal(result.success, true, result.error);
    const files = await readZip(result.path);
    assert.equal(files.get("logs/2026-10-20.log"), "main lifecycle\n");
    const diagnostics = files.get("logs/2026-10-20.diagnostics.log");
    assert.ok(diagnostics?.includes("renderer-loop lagMs=321"));
    assert.ok(diagnostics.includes("acp-host-stream phase=broadcast revision=12"));
    assert.ok(diagnostics.includes("renderer-acp-stream phase=ui-commit revision=12"));
    assert.ok(!diagnostics.includes("fixture-secret"));
    assert.ok(diagnostics.includes("***REDACTED***"));
    assert.equal(files.get(".zcode/cli/log/agent.log"), "agent lifecycle\n");
    assert.ok(files.has("about.txt"));
    assert.ok(!files.has("logs/old.diagnostics.log"));
    for (const path of [
      "credentials.json",
      "acp-stream-diagnostics/legacy.log",
      "dev/stdio.log",
      "sessions/private.json",
    ]) {
      assert.ok(!files.has(path), path);
    }
    assert.equal(basename(result.path), "CodeVori-logs-20261020-123456.zip");
    assert.match(basename(join(result.path, "..")), /^CodeVori-logs-20261020-123456-/);
    assert.deepEqual(revealed, [result.path]);
    assert.deepEqual(await readdir(join(root, "stage")), []);
  });

  await test("ZIP failure cleans partial archive and exports diagnostics in a CodeVori directory", async () => {
    const revealed = [];
    let partialZip;
    const result = await exportLogs({
      now: () => now,
      writeLogArchiveZip: async (path) => {
        partialZip = path;
        await writeFile(path, "partial ZIP");
        throw new Error("fixture zip failure");
      },
      showItemInFolder: (path) => revealed.push(path),
    });
    assert.equal(result.success, true, result.error);
    assert.equal((await stat(result.path)).isDirectory(), true);
    assert.equal(basename(result.path), "CodeVori-logs-20261020-123456");
    await assert.rejects(stat(partialZip), { code: "ENOENT" });
    const diagnostics = await readFile(
      join(result.path, "logs/2026-10-20.diagnostics.log"),
      "utf8",
    );
    assert.ok(diagnostics.includes("acp-host-stream"));
    assert.ok(!diagnostics.includes("fixture-secret"));
    assert.deepEqual(revealed, [result.path]);
  });
} finally {
  hooks.deregister();
  await rm(root, { recursive: true, force: true });
}
