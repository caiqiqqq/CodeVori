import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import type { ForgeRepository } from "@zcode/shared";
import { resolveForgeContentUrl } from "../src/lib/forgeContent.js";
import { createWebContentRehypePlugins } from "../src/components/ai-elements/web-content-targets.js";

const repositories = [
  ["github", "https://github.com/team/project"],
  ["github", "https://enterprise.example.invalid/git/team/project"],
  ["gitlab", "https://gitlab.example.invalid/git/team/sub/project"],
  ["gitlab", "https://gitlab.example.invalid/git/team/other"],
  ["gitea", "https://gitea.example.invalid/git/team/project"],
  ["gitea", "https://forgejo.example.invalid:8443/forge/team/project"],
] as const;
let epoch = 1000;

function render(source: string, resolveUrl: (url: string) => string | null) {
  return renderToStaticMarkup(
    createElement(Streamdown, {
      mode: "static",
      rehypePlugins: createWebContentRehypePlugins({ resolveUrl }, epoch++),
      components: {
        img: (props) => createElement("img", { src: props.src }),
        a: (props) => createElement("a", { href: props.href }, props.children),
      },
      children: source,
    }),
  );
}

test("Streamdown processors isolate every forge context, including same-provider projects", () => {
  for (const [provider, url] of [...repositories, ...repositories.toReversed()]) {
    const repository: ForgeRepository = {
      provider,
      url,
      key: url,
      name: "team/project",
      accountId: "synthetic",
      accountUsername: "tester",
    };
    const itemUrl = url + (provider === "gitlab" ? "/-/issues/7" : "/issues/7");
    const resolveUrl = (source: string) => resolveForgeContentUrl(repository, itemUrl, source);
    for (const path of [
      "/uploads/0123456789abcdef0123456789abcdef/image.png",
      "./image.png",
      "/attachments/synthetic",
      "https://external.example.invalid/image.png",
    ]) {
      const markup = render(
        `![Markdown](${path})\n\n<img src="${path}" />\n\n[Markdown](${path})\n\n<a href="${path}">HTML</a>`,
        resolveUrl,
      );
      const actual = [...markup.matchAll(/<(?:img|a)\b[^>]*(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1],
      );
      assert.deepEqual(actual, Array(4).fill(resolveUrl(path)), `${provider}: ${url}: ${path}`);
    }
  }
});

test("equal URLs on different Host/account owners cannot reuse an old resolver", () => {
  const observed: string[] = [];
  const source = "![same](./image.png)";
  for (const owner of ["Host-A/account-A", "Host-B/account-B", "Host-A/account-C"]) {
    render(source, () => {
      observed.push(owner);
      return "https://forge.example.invalid/image.png";
    });
    assert.equal(observed.at(-1), owner);
  }
});

test("raw HTML resolution precedes sanitization, which still rejects executable content", () => {
  const repository = {
    provider: "gitlab",
    url: "https://forge.example.invalid/team/project",
  } as ForgeRepository;
  const markup = render(
    '<img src="/uploads/synthetic/image.png" onerror="alert(1)" /><a href="javascript:alert(1)">blocked</a><img src="file:///tmp/private.png" /><script>alert(1)</script>',
    (url) => resolveForgeContentUrl(repository, null, url),
  );
  assert.match(
    markup,
    /https:\/\/forge\.example\.invalid\/team\/project\/uploads\/synthetic\/image.png/,
  );
  assert.doesNotMatch(markup, /onerror|javascript:|file:\/\/|<script/);
});
