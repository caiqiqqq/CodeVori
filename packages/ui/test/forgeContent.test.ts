import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveForgeContentUrl,
  isGitlabUploadImage,
  isGithubAttachmentImage,
} from "../src/lib/forgeContent.js";
const repository = {
  key: "synthetic",
  name: "team/sub/project",
  url: "https://forge.example.invalid/git/team/sub/project",
  provider: "gitlab" as const,
  accountId: "synthetic",
  accountUsername: "tester",
};
const itemUrl = `${repository.url}/-/issues/7`;
test("GitHub.com attachments use Host reads only for the exact attachment origin and path", () => {
  const github = {
    ...repository,
    provider: "github" as const,
    url: "https://github.com/team/project",
  };
  const source = "https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc";
  assert.equal(isGithubAttachmentImage(github, source), true);
  for (const url of [
    source.replace("https:", "http:"),
    `${source}?x=1`,
    `${source}#x`,
    source.replace("github.com", "github.com.example.invalid"),
    "https://github.com/login",
    "https://public.example.invalid/image.png",
  ]) {
    assert.equal(isGithubAttachmentImage(github, url), false);
  }
  assert.equal(isGithubAttachmentImage(repository, source), false);
  assert.equal(
    isGithubAttachmentImage(
      { ...github, url: "https://enterprise.example.invalid/team/project" },
      source,
    ),
    false,
  );
});
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
