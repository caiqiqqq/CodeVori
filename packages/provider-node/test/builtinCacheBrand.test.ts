import assert from "node:assert/strict";
import test from "node:test";
import { resolveZCodeBuiltinCachePaths } from "../src/zcode-builtin-cache-paths.ts";

test("Provider cache paths use the CodeVori filename", () => {
  const paths = resolveZCodeBuiltinCachePaths({
    environmentConfigRoot: "/data/.codevori/v2",
    platform: "darwin-aarch64",
    appVersion: "1.0.0",
    zcodeEndpointOrigin: "https://example.test",
  });
  assert.match(paths.activeFilePath, /\/codevori-builtin\.json$/);
  assert.match(paths.controlFilePath, /\/codevori-builtin-refresh\.json$/);
});
