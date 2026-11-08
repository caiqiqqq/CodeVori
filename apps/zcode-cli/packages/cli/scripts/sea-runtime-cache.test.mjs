import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSeaRuntimeCacheBase } from "../src/sea-runtime-cache.ts";

test("SEA cache uses the CodeVori namespace on every supported platform", () => {
  assert.equal(
    resolveSeaRuntimeCacheBase({ platform: "darwin", home: "/Users/example" }),
    "/Users/example/Library/Caches/codevori/sea-assets",
  );
  assert.equal(
    resolveSeaRuntimeCacheBase({ platform: "linux", home: "/home/example", xdgCacheHome: "/cache" }),
    "/cache/codevori/sea-assets",
  );
  assert.equal(
    resolveSeaRuntimeCacheBase({ platform: "win32", home: "C:\\Users\\example", localAppData: "C:\\Local" }),
    "C:\\Local\\codevori\\Cache\\sea-assets",
  );
});
