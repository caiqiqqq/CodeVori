import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { resolveBuildAliases } from "./build.mjs";

test("desktop agent resolves the shared product brand subpath", async () => {
  const result = await build({
    stdin: {
      contents:
        'import { PRODUCT_DATA_DIRECTORY_NAME } from "@zcode/shared/product-brand"; console.log(PRODUCT_DATA_DIRECTORY_NAME);',
      resolveDir: import.meta.dirname,
      sourcefile: "product-brand-alias-test.mjs",
    },
    alias: resolveBuildAliases(),
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });

  assert.equal(result.errors.length, 0);
  assert.match(result.outputFiles[0].text, /PRODUCT_DATA_DIRECTORY_NAME|CodeVori/);
});
