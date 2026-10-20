import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAcpInstallProcess } from "../src/acp/acpInstallProcess.js";

test("安装日志跨 chunk 脱敏、去控制字符、限制超长行且刷新尾行", async () => {
  const log: string[] = [];
  await runAcpInstallProcess({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write('API_TOKEN=private-');setTimeout(()=>{process.stdout.write('value\\nhttps://user:password@example.test/a?token=secret\\n');process.stderr.write('Authorization: Bearer hidden-header\\n');process.stdout.write('x'.repeat(20000)+'\\n');process.stdout.write('\\x1b[31mtail');},30);`,
    ],
    env: { API_TOKEN: "private-value" },
    signal: new AbortController().signal,
    onLog: (message) => log.push(message),
  });
  const text = log.join("\n");
  assert.doesNotMatch(text, /password|private-value|token=secret|hidden-header/);
  assert.equal(text.includes(String.fromCharCode(27)), false);
  assert.match(text, /tail/);
  assert.ok(log.every((line) => line.length <= 2048));
});

for (const mode of ["cancel", "timeout"] as const) {
  test(`安装 ${mode} 等待孙进程退出后返回`, async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "zcode-install-process-"));
    const pidFile = join(root, "pid");
    const controller = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const task = runAcpInstallProcess({
      command: process.execPath,
      args: [
        "-e",
        `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));console.log('ready');setInterval(()=>{},1000);`,
      ],
      env: {},
      signal: controller.signal,
      timeoutMs: mode === "timeout" ? 700 : 5000,
      onLog: () => ready(),
    });
    const rejected = assert.rejects(task, mode === "cancel" ? /取消/ : /超时/);
    try {
      await started;
      const pid = Number(await readFile(pidFile, "utf8"));
      if (mode === "cancel") controller.abort();
      await rejected;
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
    } finally {
      controller.abort();
      await rejected;
      await rm(root, { recursive: true, force: true });
    }
  });
}
