import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveForgeContentUrl, isGitlabUploadImage } from "../src/lib/forgeContent.js";
const repository = {
  key: "synthetic",
  name: "team/sub/project",
  url: "https://forge.example.invalid/git/team/sub/project",
  provider: "gitlab" as const,
  accountId: "synthetic",
  accountUsername: "tester",
};
const itemUrl = `${repository.url}/-/issues/7`;
test("GitLab upload links resolve against the project including nested groups and base paths", () => {
  for (const path of ["/uploads/abc/image.png", "uploads/abc/image.png"]) {
    assert.equal(
      resolveForgeContentUrl(repository, itemUrl, path),
      `${repository.url}/uploads/abc/image.png`,
    );
  }
  assert.equal(resolveForgeContentUrl(repository, itemUrl, "#note_1"), `${itemUrl}#note_1`);
  assert.equal(isGitlabUploadImage(repository, `${repository.url}/uploads/abc/image.png`), true);
  assert.equal(
    isGitlabUploadImage(repository, "https://elsewhere.example.invalid/image.png"),
    false,
  );
  assert.equal(
    isGitlabUploadImage(
      repository,
      "https://forge.example.invalid/git/other/project/uploads/abc/image.png",
    ),
    false,
  );
});
test("forge content never opens files, scripts, artifact URLs or credential-bearing links", () => {
  for (const path of [
    "file:///tmp/image.png",
    "javascript:alert(1)",
    "data:text/html,x",
    "zcode-artifact:secret",
    "https://user:pass@forge.example.invalid/image.png",
    "C:\\private\\image.png",
  ]) {
    assert.equal(resolveForgeContentUrl(repository, itemUrl, path), null);
  }
  assert.equal(
    resolveForgeContentUrl(repository, itemUrl, "https://public.example.invalid/image.png"),
    "https://public.example.invalid/image.png",
  );
});
