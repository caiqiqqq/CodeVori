import assert from "node:assert/strict";
import { test } from "node:test";
import { rasterImagePreview, readForgeImageResponse } from "../src/git/providers/forgeMedia.js";

const signatures = [
  ["image/png", "89504e470d0a1a0a"],
  ["image/jpeg", "ffd8ffe000000000"],
  ["image/gif", "474946383961000000000000"],
  ["image/webp", "524946460000000057454250"],
  ["image/avif", "000000186674797061766966"],
] as const;

test("binary downloads infer only existing allowed raster signatures", async () => {
  for (const [mediaType, hex] of signatures) {
    const bytes = Buffer.from(hex, "hex");
    for (const header of [
      null,
      "",
      "application/octet-stream",
      "APPLICATION/OCTET-STREAM; charset=binary",
    ]) {
      const result = rasterImagePreview(bytes, header);
      assert.equal(result.mediaType, mediaType);
      assert.equal(result.dataBase64, bytes.toString("base64"));
      assert.equal(result.totalBytes, bytes.length);
    }
    assert.equal(rasterImagePreview(bytes, `${mediaType}; charset=binary`).mediaType, mediaType);
  }
});

test("binary compatibility does not accept login pages, SVG, JSON, unknown bytes or MIME mismatches", () => {
  for (const content of [
    "<html>sign in</html>",
    "<svg></svg>",
    '{"error":"missing"}',
    "",
    "%PDF-1.7",
  ]) {
    for (const header of [null, "application/octet-stream", "image/png"]) {
      assert.throws(() => rasterImagePreview(Buffer.from(content), header), /FORGE_RESPONSE/);
    }
  }
  for (const [mediaType, hex] of signatures) {
    for (const declared of [
      "text/html",
      "application/json",
      "image/svg+xml",
      "application/private-value",
      ...signatures.map(([type]) => type),
    ]) {
      if (declared !== mediaType)
        assert.throws(
          () => rasterImagePreview(Buffer.from(hex, "hex"), declared),
          /FORGE_RESPONSE/,
        );
    }
  }
});

test("binary downloads retain the response size limit and do not mask authentication errors", async () => {
  const large = Buffer.alloc(12 * 1024 * 1024 + 1);
  Buffer.from(signatures[0][1], "hex").copy(large);
  await assert.rejects(
    readForgeImageResponse(
      new Response(large, {
        headers: { "content-type": "application/octet-stream" },
      }),
    ),
    /FORGE_RESPONSE/,
  );
  for (const status of [401, 403, 302]) {
    await assert.rejects(
      readForgeImageResponse(new Response(null, { status })),
      /FORGE_MEDIA_AUTHENTICATION/,
    );
  }
});
