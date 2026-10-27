import assert from "node:assert/strict";
import test from "node:test";
import { fileUrlToLocalPath } from "../src/main/desktopFileUrl.ts";

test("file URLs are decoded as local paths", () => {
  assert.equal(fileUrlToLocalPath("file:///tmp/report%20one.txt"), "/tmp/report one.txt");
  assert.equal(fileUrlToLocalPath("file:///tmp/%E6%B5%8B%E8%AF%95.txt"), "/tmp/测试.txt");
  assert.equal(fileUrlToLocalPath("https://example.com/"), null);
});
