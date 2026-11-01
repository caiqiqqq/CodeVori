import assert from "node:assert/strict";
import test from "node:test";
import { nodeArchive, nodeChecksum } from "../src/acp/acpNodeRuntime.js";

const version = "26.13.0";
const mirror = `https://npmmirror.com/mirrors/node/v${version}/SHASUMS256.txt`;
const official = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
const sha256 = "a".repeat(64);

for (const arch of ["x64", "arm64"]) {
  test(`Windows ${arch} 校验文件 404 时通过同一 fetcher 读取官方同版本清单`, async () => {
    const file = nodeArchive(version, "win32", arch).file;
    const requests: string[] = [];
    const logs: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === mirror) return new Response("missing", { status: 404 });
      assert.equal(url, official);
      // 清单含多个架构时必须按完整文件名选择当前归档。
      return new Response(`${"b".repeat(64)}  other.zip\n${sha256}  ${file}\r\n`);
    };
    assert.equal(await nodeChecksum(version, file, fetcher, (line) => logs.push(line)), sha256);
    assert.deepEqual(requests, [mirror, official]);
    assert.ok(logs.some((line) => line.includes(version) && line.includes("404")));
  });
}

test("镜像清单成功时不请求官方", async () => {
  const file = nodeArchive(version, "win32", "x64").file;
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), mirror);
    return new Response(`${sha256}  ${file}\n`);
  };
  assert.equal(await nodeChecksum(version, file, fetcher, () => {}), sha256);
});

for (const status of [403, 500]) {
  test(`镜像 HTTP ${status} 不切换来源，错误带版本、阶段及地址`, async () => {
    const file = nodeArchive(version, "win32", "x64").file;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response("failed", { status });
    };
    await assert.rejects(
      nodeChecksum(version, file, fetcher, () => {}),
      (error: Error) => {
        assert.ok(error.message.includes(version));
        assert.ok(error.message.includes("校验文件"));
        assert.ok(error.message.includes(mirror));
        assert.ok(error.message.includes(`HTTP ${status}`));
        return true;
      },
    );
    assert.deepEqual(requests, [mirror]);
  });
}

test("网络故障不切换来源，保留 cause 而不把代理凭据显示到错误中", async () => {
  const cause = new Error("proxy http://user:secret@proxy.invalid failed");
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(String(input));
    throw cause;
  };
  await assert.rejects(
    nodeChecksum(version, nodeArchive(version, "win32", "x64").file, fetcher, () => {}),
    (error: Error) => {
      assert.equal(error.cause, cause);
      assert.ok(error.message.includes(version));
      assert.ok(error.message.includes(mirror));
      assert.ok(error.message.includes("网络请求失败"));
      assert.ok(!error.message.includes("secret"));
      return true;
    },
  );
  assert.deepEqual(requests, [mirror]);
});

test("官方校验文件也失败时报告官方地址并停止", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(String(input));
    return new Response("missing", { status: 404 });
  };
  await assert.rejects(
    nodeChecksum(version, nodeArchive(version, "win32", "arm64").file, fetcher, () => {}),
    (error: Error) => {
      assert.ok(error.message.includes(version));
      assert.ok(error.message.includes("校验文件"));
      assert.ok(error.message.includes(official));
      assert.ok(error.message.includes("HTTP 404"));
      return true;
    },
  );
  assert.deepEqual(requests, [mirror, official]);
});

for (const useOfficial of [false, true]) {
  for (const content of [`${sha256}  other.zip\n`, "invalid  node-v26.13.0-win-x64.zip\n"]) {
    test(`${useOfficial ? "官方" : "镜像"}清单缺少对应归档的有效 SHA-256 时拒绝继续`, async () => {
      const requests: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        requests.push(url);
        if (useOfficial && url === mirror) return new Response("missing", { status: 404 });
        return new Response(content);
      };
      await assert.rejects(
        nodeChecksum(version, nodeArchive(version, "win32", "x64").file, fetcher, () => {}),
        (error: Error) => {
          assert.ok(error.message.includes("SHA-256"));
          assert.ok(error.message.includes("node-v26.13.0-win-x64.zip"));
          assert.ok(error.message.includes(useOfficial ? official : mirror));
          return true;
        },
      );
      assert.deepEqual(requests, useOfficial ? [mirror, official] : [mirror]);
    });
  }
}
