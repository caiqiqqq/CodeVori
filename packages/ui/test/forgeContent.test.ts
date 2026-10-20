import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveForgeContentUrl,
  isGitlabUploadImage,
  isGithubAttachmentImage,
  isGiteaAttachmentImage,
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
    name: "team/project",
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
test("Enterprise attachments preserve the configured server base and never borrow GitHub.com", () => {
  const enterprise = {
    ...repository,
    provider: "github" as const,
    name: "team/project",
    url: "https://enterprise.example.invalid:8443/git/team/project",
  };
  const base = "https://enterprise.example.invalid:8443/git";
  assert.equal(
    isGithubAttachmentImage(
      enterprise,
      `${base}/user-attachments/assets/12345678-1234-1234-1234-123456789abc`,
    ),
    true,
  );
  assert.equal(isGithubAttachmentImage(enterprise, `${base}/files/12/screen%20shot.png`), true);
  for (const source of [
    `${base}/files/12/%2fsecret.png`,
    `${base}/files/12/%5csecret.png`,
    `${base}/files/12/%00.png`,
    `${base}/files/12/a.png?token=x`,
    `${base}/files/12/a.png#x`,
    `${base}/files/12/a/b.png`,
    "https://enterprise.example.invalid:8443/files/12/a.png",
    "https://enterprise.example.invalid/git/files/12/a.png",
    "https://github.com/files/12/a.png",
    `${base}/login`,
  ])
    assert.equal(isGithubAttachmentImage(enterprise, source), false, source);
});
test("Gitea and Forgejo attachments accept only UUID routes on the configured server/current repository", () => {
  const forge = {
    ...repository,
    provider: "gitea" as const,
    name: "team/project",
    url: "http://forge.example.invalid:3000/git/team/project",
  };
  const base = "http://forge.example.invalid:3000/git";
  const uuid = "12345678-1234-1234-1234-123456789abc";
  for (const path of [
    `/attachments/${uuid}`,
    `/team/project/attachments/${uuid}`,
    `/team/project/issues/7/attachments/${uuid}`,
  ]) {
    assert.equal(isGiteaAttachmentImage(forge, base + path), true);
  }
  for (const source of [
    `${base}/other/project/attachments/${uuid}`,
    `${base}/team/project/issues/0/attachments/${uuid}`,
    `${base}/attachments/${uuid}?token=x`,
    `${base}/attachments/${uuid}#x`,
    `${base}/attachments/${uuid}/image.png`,
    `${base}/attachments/not-a-uuid`,
    `http://forge.example.invalid:3000/attachments/${uuid}`,
    `http://forge.example.invalid/git/attachments/${uuid}`,
    `https://forge.example.invalid:3000/git/attachments/${uuid}`,
    `http://user:pass@forge.example.invalid:3000/git/attachments/${uuid}`,
  ])
    assert.equal(isGiteaAttachmentImage(forge, source), false, source);
  assert.equal(isGiteaAttachmentImage(repository, `${base}/attachments/${uuid}`), false);
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
