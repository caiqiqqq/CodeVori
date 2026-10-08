import assert from "node:assert/strict";
import { test } from "node:test";
import { createForgeService } from "../src/git/forgeService.js";
import type { PrivateGitAccount } from "../src/git/repo/versionControlRepo.js";
import type { ForgeWebMediaContext, ForgeWebMediaPort } from "@zcode/shared";

const accountId = "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01";
const account = (
  provider: PrivateGitAccount["provider"],
  serverUrl: string,
): PrivateGitAccount => ({
  id: accountId,
  provider,
  serverUrl,
  username: "synthetic-user",
  secret: "synthetic-forge-token",
  scopes: [],
  avatarUrl: null,
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function fixture(
  remote: string,
  accounts: PrivateGitAccount[],
  replies: unknown[] = [],
  webMedia?: ForgeWebMediaPort,
) {
  const state = { remote, accounts, calls: [] as Array<{ url: URL; init: RequestInit }> };
  const service = createForgeService({
    webMedia,
    gitRepo: {
      async resolveRepository(workspacePath) {
        return {
          workspacePath,
          repoRoot: workspacePath,
          workspaceInRepoPath: "",
          autoRefreshWatchPaths: [],
          isGitAvailable: true,
          isRepository: true,
        };
      },
    },
    commandProvider: {
      async resolveGitBinary() {
        return "/synthetic/git";
      },
      async run(request) {
        return {
          exitCode: 0,
          stdout: request.args.length === 1 ? "origin\n" : state.remote,
          stderr: "",
          timedOut: false,
          durationMs: 0,
          binaryPath: "/synthetic/git",
          cwd: request.cwd,
          args: request.args,
          signal: null,
          outputTruncated: false,
        };
      },
    },
    credentials: {
      async read() {
        return { customPath: null, accounts: state.accounts };
      },
      async update(mutation) {
        return mutation(await this.read());
      },
    },
    fetcher: (async (url, init) => {
      state.calls.push({ url: new URL(String(url)), init: init ?? {} });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (reply instanceof Response) return reply;
      return Response.json(reply ?? []);
    }) as typeof fetch,
  });
  const repository = () => service.getForgeRepository({ workspacePath: "/synthetic/project" });
  const target = async () => {
    const info = await repository();
    assert.equal(info.status, "ready");
    assert.ok(info.repository);
    return {
      workspacePath: "/synthetic/project",
      remoteName: "origin",
      repositoryKey: info.repository.key,
      accountId: info.repository.accountId,
    };
  };
  return { service, state, repository, target };
}

test("repository discovery resolves public and self-hosted remotes without networking or secrets", async () => {
  for (const [remote, provider, server, name] of [
    ["git@github.com:team/project.git", "github", "https://github.com", "team/project"],
    ["https://gitlab.com/team/sub/project.git", "gitlab", "https://gitlab.com", "team/sub/project"],
    [
      "ssh://git@forge.example.invalid:2222/git/team/project.git",
      "gitea",
      "https://forge.example.invalid/git",
      "team/project",
    ],
  ] as const) {
    const f = fixture(remote, [account(provider, server)]);
    const info = await f.repository();
    assert.equal(info.status, "ready");
    assert.equal(info.repository?.name, name);
    assert.equal(info.repository?.provider, provider);
    assert.equal(f.state.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(info), /synthetic-forge-token|git@|2222/);
  }
});

const uploadId = "0123456789abcdef0123456789abcdef";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
  "base64",
);
test("GitLab private upload images use the bound account API without exposing credentials", async () => {
  const f = fixture(
    "https://forge.example.invalid/git/team/sub/project.git",
    [account("gitlab", "https://forge.example.invalid/git")],
    [new Response(png, { headers: { "content-type": "image/png" } })],
  );
  const preview = await f.service.readForgeImage({
    ...(await f.target()),
    url: `https://forge.example.invalid/git/team/sub/project/uploads/${uploadId}/image.png`,
  });
  assert.equal(preview.mediaType, "image/png");
  assert.equal(preview.dataBase64, png.toString("base64"));
  assert.equal(
    f.state.calls[0]?.url.pathname,
    `/git/api/v4/projects/team%2Fsub%2Fproject/uploads/${uploadId}/image.png`,
  );
  assert.equal(
    new Headers(f.state.calls[0]?.init.headers).get("PRIVATE-TOKEN"),
    "synthetic-forge-token",
  );
  assert.equal(f.state.calls[0]?.init.redirect, "error");
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-forge-token/);
});

const legacyUrl = `https://forge.example.invalid/git/team/sub/project/uploads/${uploadId}/image.png`;
const legacyProject = {
  path_with_namespace: "team/sub/project",
  web_url: "https://web.example.invalid/git/team/sub/project",
};
const legacyFixture = (replies: unknown[], webMedia?: ForgeWebMediaPort) =>
  fixture(
    "https://forge.example.invalid/git/team/sub/project.git",
    [account("gitlab", "https://forge.example.invalid/git")],
    replies,
    webMedia,
  );
const missingUpload = () => new Response(null, { status: 404 });
const privateUpload = () =>
  new Response(null, {
    status: 302,
    headers: { Location: "https://web.example.invalid/git/users/sign_in" },
  });
test("old GitLab public uploads fall back after API 404 without web credentials", async () => {
  const f = legacyFixture([
    missingUpload(),
    new Response(png, { headers: { "content-type": "image/png" } }),
  ]);
  assert.equal(
    (await f.service.readForgeImage({ ...(await f.target()), url: legacyUrl })).dataBase64,
    png.toString("base64"),
  );
  assert.equal(f.state.calls.length, 2);
  const call = f.state.calls[1]!;
  assert.equal(call.url.href, legacyUrl);
  assert.equal(call.init.redirect, "manual");
  assert.equal(call.init.credentials, "omit");
  assert.equal(new Headers(call.init.headers).get("PRIVATE-TOKEN"), null);
  assert.equal(new Headers(call.init.headers).get("Authorization"), null);
  assert.equal(new Headers(call.init.headers).get("Cookie"), null);
});

test("legacy private reads use an attested native session without automatically authenticating", async () => {
  const contexts: ForgeWebMediaContext[] = [];
  let signIns = 0;
  const f = legacyFixture([missingUpload(), privateUpload(), legacyProject], {
    async read(context) {
      contexts.push(context);
      throw new Error("FORGE_MEDIA_AUTHENTICATION");
    },
    async authenticate() {
      signIns += 1;
    },
  });
  const request = { ...(await f.target()), url: legacyUrl };
  await assert.rejects(f.service.readForgeImage(request), /FORGE_MEDIA_AUTHENTICATION$/);
  assert.equal(signIns, 0);
  assert.equal(contexts[0]!.loginUrl, "https://web.example.invalid/git/users/sign_in");
  assert.equal(contexts[0]!.serverUrl, "https://forge.example.invalid/git");
  assert.equal(contexts[0]!.accountId, accountId);
  assert.doesNotMatch(JSON.stringify(contexts), /synthetic-forge-token|Cookie|secret/);
  assert.equal(
    new Headers(f.state.calls[2]!.init.headers).get("PRIVATE-TOKEN"),
    "synthetic-forge-token",
  );
});

test("authenticated native previews and explicit login stay on the selected Host", async () => {
  const actions: string[] = [];
  const f = legacyFixture([missingUpload(), privateUpload(), legacyProject, legacyProject], {
    async read() {
      actions.push("read");
      return { mediaType: "image/png", dataBase64: png.toString("base64"), totalBytes: png.length };
    },
    async authenticate() {
      actions.push("authenticate");
    },
  });
  const request = { ...(await f.target()), url: legacyUrl };
  const image = await f.service.readForgeImage(request);
  assert.equal(image.totalBytes, png.length);
  await f.service.authenticateForgeImage(request);
  assert.deepEqual(actions, ["read", "authenticate"]);
  assert.doesNotMatch(JSON.stringify(image), /synthetic-forge-token/);
});

test("old GitLab without native authentication reports capability unavailable", async () => {
  const f = legacyFixture([missingUpload(), privateUpload()]);
  const request = { ...(await f.target()), url: legacyUrl };
  await assert.rejects(f.service.readForgeImage(request), /FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE/);
  await assert.rejects(
    f.service.authenticateForgeImage(request),
    /FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE/,
  );
  assert.equal(
    f.state.calls.length,
    2,
    "An unavailable Host cannot route to another Host or open a browser",
  );
});

test("only API 404 allows compatibility; unauthorized, malformed, redirect and network failures never fall back", async () => {
  for (const reply of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 302 }),
    new Error("synthetic-network-error"),
    new Response("<html>bad</html>", { headers: { "content-type": "image/png" } }),
  ]) {
    const f = legacyFixture([reply]);
    await assert.rejects(f.service.readForgeImage({ ...(await f.target()), url: legacyUrl }));
    assert.equal(f.state.calls.length, 1);
  }
});

test("canonical login origins must be attested to the exact project", async () => {
  for (const project of [
    { ...legacyProject, path_with_namespace: "other/project" },
    { ...legacyProject, web_url: "https://web.example.invalid/git/other/project" },
    { ...legacyProject, web_url: "https://token@web.example.invalid/git/team/sub/project" },
    { ...legacyProject, web_url: "not a URL" },
    { ...legacyProject, web_url: "https://web.example.invalid/git/team/sub/project?token=secret" },
  ]) {
    let invoked = false;
    const f = legacyFixture([project], {
      async read() {
        throw new Error("unexpected");
      },
      async authenticate() {
        invoked = true;
      },
    });
    await assert.rejects(
      f.service.authenticateForgeImage({ ...(await f.target()), url: legacyUrl }),
    );
    assert.equal(invoked, false);
  }
});

test("removed, rotated and changed targets cannot accept late login completion", async () => {
  for (const change of ["removed", "rotated", "username", "remote"] as const) {
    let started!: () => void;
    let finish!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const f = legacyFixture([legacyProject], {
      async read() {
        throw new Error("unexpected");
      },
      async authenticate() {
        started();
        await completed;
      },
    });
    const rejected = assert.rejects(
      f.service.authenticateForgeImage({ ...(await f.target()), url: legacyUrl }),
      /FORGE_(MISSING_ACCOUNT|TARGET_CHANGED)/,
    );
    await began;
    if (change === "removed") f.state.accounts = [];
    if (change === "rotated")
      f.state.accounts = [{ ...f.state.accounts[0]!, secret: "synthetic-rotated-token" }];
    if (change === "username")
      f.state.accounts = [{ ...f.state.accounts[0]!, username: "synthetic-other-user" }];
    if (change === "remote") f.state.remote = "https://forge.example.invalid/git/team/other.git";
    finish();
    await rejected;
  }
});
test("private media rejects foreign origins, projects, credentials and traversal before HTTP", async () => {
  const f = fixture("https://forge.example.invalid/team/project.git", [
    account("gitlab", "https://forge.example.invalid"),
  ]);
  const target = await f.target();
  for (const url of [
    `https://other.example.invalid/team/project/uploads/${uploadId}/image.png`,
    `https://forge.example.invalid/other/project/uploads/${uploadId}/image.png`,
    `https://forge.example.invalid/team/project/uploads/${uploadId}/%2e%2e%2fsecret.png`,
    `https://user:pass@forge.example.invalid/team/project/uploads/${uploadId}/image.png`,
    "file:///private/image.png",
    "https://forge.example.invalid/admin/users",
  ])
    await assert.rejects(f.service.readForgeImage({ ...target, url }));
  assert.equal(f.state.calls.length, 0);
  f.state.remote = "https://forge.example.invalid/other/project.git";
  await assert.rejects(
    f.service.readForgeImage({
      ...target,
      url: `https://forge.example.invalid/team/project/uploads/${uploadId}/image.png`,
    }),
    /FORGE_TARGET_CHANGED/,
  );
  assert.equal(f.state.calls.length, 0);
});
test("media payloads reject HTML, SVG, oversized content and redirects", async () => {
  for (const response of [
    new Response("<html>private</html>", { headers: { "content-type": "image/png" } }),
    new Response("<svg></svg>", { headers: { "content-type": "image/svg+xml" } }),
    new Response(png, {
      status: 302,
      headers: { location: "https://other.example.invalid/image.png" },
    }),
    new Response(new Uint8Array(12 * 1024 * 1024 + 1), {
      headers: { "content-type": "image/png" },
    }),
  ]) {
    const f = fixture(
      "https://forge.example.invalid/team/project.git",
      [account("gitlab", "https://forge.example.invalid")],
      [response],
    );
    await assert.rejects(
      f.service.readForgeImage({
        ...(await f.target()),
        url: `https://forge.example.invalid/team/project/uploads/${uploadId}/image.png`,
      }),
    );
    assert.equal(f.state.calls.length, 1);
  }
});

test("unknown hosts and absent/generic/mismatched credentials do not receive forge requests", async () => {
  for (const [remote, accounts, status] of [
    ["https://github.com/team/project.git", [], "missing-account"],
    ["https://unknown.example.invalid/team/project.git", [], "unsupported"],
    [
      "https://github.com/team/project.git",
      [account("git", "https://github.com")],
      "account-mismatch",
    ],
    [
      "https://github.com/team/project.git",
      [account("github", "http://github.com")],
      "account-mismatch",
    ],
    [
      "https://forge.example.invalid:8443/team/project.git",
      [account("gitea", "https://forge.example.invalid")],
      "account-mismatch",
    ],
  ] as const) {
    const f = fixture(remote, [...accounts]);
    assert.equal((await f.repository()).status, status);
    assert.equal(f.state.calls.length, 0);
  }
});

test("saved unrelated accounts explain a mismatch and a matching account restores discovery", async () => {
  const github = account("github", "https://github.com");
  const gitlab = {
    ...account("gitlab", "https://forge.example.invalid"),
    id: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b02",
    isDefault: false,
  };
  const f = fixture("https://forge.example.invalid/team/sub/project.git", [github]);
  const before = await f.repository();
  assert.equal(before.status, "account-mismatch");
  assert.equal(before.host, "forge.example.invalid");
  assert.equal(before.provider, null);
  assert.equal(before.repository, null);
  assert.doesNotMatch(JSON.stringify(before), /synthetic-forge-token|synthetic-user|github\.com/);
  assert.equal(f.state.calls.length, 0);

  f.state.accounts.push(gitlab);
  const after = await f.repository();
  assert.equal(after.status, "ready");
  assert.equal(after.repository?.provider, "gitlab");
  assert.equal(after.repository?.accountId, gitlab.id);
  assert.equal(after.repository?.name, "team/sub/project");
  assert.equal(github.isDefault, true);
  assert.equal(f.state.accounts.length, 2);
  assert.equal(f.state.calls.length, 0);
});

test("generic, protocol, port and base-path mismatches never authorize forge discovery", async () => {
  for (const configured of [
    account("git", "https://forge.example.invalid:8443/git"),
    account("gitlab", "http://forge.example.invalid:8443/git"),
    account("gitlab", "https://forge.example.invalid/git"),
    account("gitlab", "https://forge.example.invalid:8443/other"),
  ]) {
    const f = fixture("https://forge.example.invalid:8443/git/team/project.git", [configured]);
    assert.equal((await f.repository()).status, "account-mismatch");
    assert.equal(f.state.calls.length, 0);
  }
});

test("a removed target account is rejected even when unrelated accounts remain", async () => {
  const f = fixture("https://forge.example.invalid/team/project.git", [
    account("gitlab", "https://forge.example.invalid"),
  ]);
  const target = await f.target();
  f.state.accounts = [account("github", "https://github.com")];
  assert.equal((await f.repository()).status, "account-mismatch");
  await assert.rejects(
    f.service.getForgeItem({ ...target, kind: "issue", number: 1 }),
    /FORGE_MISSING_ACCOUNT/,
  );
  await assert.rejects(
    f.service.getForgeItemExtras({ ...target, kind: "issue", number: 1 }),
    /FORGE_MISSING_ACCOUNT/,
  );
  await assert.rejects(
    f.service.createForgeComment({ ...target, kind: "issue", number: 1, body: "synthetic" }),
    /FORGE_MISSING_ACCOUNT/,
  );
  assert.equal(f.state.calls.length, 0);
});

test("provider requests preserve nested/base paths and use provider-specific authentication", async () => {
  for (const [remote, provider, server, pathname, header] of [
    [
      "git@github.com:team/project.git",
      "github",
      "https://github.com",
      "/search/issues",
      "authorization",
    ],
    [
      "https://gitlab.com/team/sub/project.git",
      "gitlab",
      "https://gitlab.com",
      "/api/v4/projects/team%2Fsub%2Fproject/issues",
      "private-token",
    ],
    [
      "https://forge.example.invalid/git/team/project.git",
      "gitea",
      "https://forge.example.invalid/git",
      "/git/api/v1/repos/team/project/issues",
      "authorization",
    ],
  ] as const) {
    const f = fixture(
      remote,
      [account(provider, server)],
      provider === "github" ? [{ items: [], total_count: 0 }] : [[]],
    );
    await f.service.listForgeItems({
      ...(await f.target()),
      kind: "issue",
      state: "open",
      page: 2,
      pageSize: 20,
    });
    const call = f.state.calls[0]!;
    assert.equal(call.url.pathname, pathname);
    assert.equal(call.url.searchParams.get("page"), "2");
    assert.match(new Headers(call.init.headers).get(header)!, /synthetic-forge-token/);
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal);
    assert.doesNotMatch(call.url.href, /synthetic-forge-token/);
  }
});

test("a changed remote/account is rejected before a numbered read or write", async () => {
  const f = fixture("https://github.com/team/first.git", [account("github", "https://github.com")]);
  const target = await f.target();
  f.state.remote = "https://github.com/team/second.git";
  await assert.rejects(
    f.service.createForgeComment({
      ...target,
      kind: "issue",
      number: 1,
      body: "synthetic comment",
    }),
    /FORGE_TARGET_CHANGED/,
  );
  assert.equal(f.state.calls.length, 0);
  f.state.remote = "https://github.com/team/first.git";
  f.state.accounts = [];
  await assert.rejects(
    f.service.getForgeItem({ ...target, kind: "issue", number: 1 }),
    /FORGE_MISSING_ACCOUNT/,
  );
  assert.equal(f.state.calls.length, 0);
});

test("failed API responses expose normalized errors, never response bodies or credentials", async () => {
  for (const [status, error] of [
    [401, "AUTHENTICATION"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMIT"],
  ] as const) {
    const f = fixture(
      "https://github.com/team/project.git",
      [account("github", "https://github.com")],
      [new Response("synthetic-forge-token", { status })],
    );
    await assert.rejects(
      f.service.listForgeItems({
        ...(await f.target()),
        kind: "issue",
        state: "open",
        page: 1,
        pageSize: 20,
      }),
      (failure: unknown) => {
        assert.ok(failure instanceof Error);
        assert.match(failure.message, new RegExp(`FORGE_${error}`));
        assert.doesNotMatch(failure.message, /synthetic-forge-token/);
        return true;
      },
    );
  }
});

test("GitHub search cannot override the selected repository with injected qualifiers", async () => {
  const f = fixture(
    "https://github.com/team/project.git",
    [account("github", "https://github.com")],
    [{ items: [], total_count: 0 }],
  );
  await f.service.listForgeItems({
    ...(await f.target()),
    kind: "issue",
    state: "open",
    search: 'repo:other/private "oops"',
    page: 1,
    pageSize: 20,
  });
  const query = f.state.calls[0]!.url.searchParams.get("q")!;
  assert.ok(query.startsWith("repo:team/project is:issue is:open "));
  assert.ok(query.includes('"repo:other/private \\"oops\\""'));
});

test("validation refuses malformed input before executing a remote API request", async () => {
  const f = fixture("https://github.com/team/project.git", [
    account("github", "https://github.com"),
  ]);
  const target = await f.target();
  await assert.rejects(f.service.createForgeIssue({ ...target, title: " ", body: "" }));
  await assert.rejects(f.service.getForgeItem({ ...target, kind: "issue", number: -1 }));
  await assert.rejects(
    f.service.listForgeItems({ ...target, kind: "issue", state: "open", page: 0, pageSize: 200 }),
  );
  assert.equal(f.state.calls.length, 0);
});

test("GitLab uses opened and keeps merged MRs in closed pages without a misleading total", async () => {
  const f = fixture(
    "https://gitlab.com/team/sub/project.git",
    [account("gitlab", "https://gitlab.com")],
    [
      Response.json(
        [
          { iid: 1, title: "Merged", state: "merged" },
          { iid: 2, title: "Open", state: "opened" },
          { iid: 3, title: "Locked", state: "locked" },
          { iid: 4, title: "Closed", state: "closed" },
        ],
        { headers: { "x-total": "20", "x-next-page": "2" } },
      ),
      [],
    ],
  );
  const target = await f.target();
  const result = await f.service.listForgeItems({
    ...target,
    kind: "pull-request",
    state: "closed",
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(
    result.items.map((row) => row.state),
    ["merged", "closed"],
  );
  assert.equal(result.total, null);
  assert.equal(result.hasMore, true);
  assert.equal(f.state.calls[0]!.url.searchParams.get("state"), "all");
  await f.service.listForgeItems({
    ...target,
    kind: "issue",
    state: "open",
    page: 1,
    pageSize: 20,
  });
  assert.equal(f.state.calls[1]!.url.searchParams.get("state"), "opened");
});

test("GitHub search normalizes merged results and honors the 1000-result cap", async () => {
  const f = fixture(
    "https://github.com/team/project.git",
    [account("github", "https://github.com")],
    [
      {
        items: [
          {
            number: 7,
            title: "Merged",
            state: "closed",
            pull_request: { merged_at: "2026-01-01" },
          },
        ],
        total_count: 2000,
        incomplete_results: true,
      },
    ],
  );
  const result = await f.service.listForgeItems({
    ...(await f.target()),
    kind: "pull-request",
    state: "closed",
    page: 50,
    pageSize: 20,
  });
  assert.equal(result.items[0]?.state, "merged");
  assert.equal(result.reachableTotal, 1000);
  assert.equal(result.hasMore, false);
  assert.equal(result.incomplete, true);
});

const sha = "a".repeat(40);
const githubPr = (headSha = sha) => ({
  number: 7,
  title: "Synthetic PR",
  state: "open",
  head: { sha: headSha, ref: "feature" },
  base: { ref: "main" },
  mergeable: true,
});

test("GitHub refuses changed heads and disabled merge methods before any write", async () => {
  for (const [headSha, method, code] of [
    ["b".repeat(40), "squash", "HEAD_CHANGED"],
    [sha, "merge", "MERGE_UNSUPPORTED"],
  ] as const) {
    const f = fixture(
      "https://github.com/team/project.git",
      [account("github", "https://github.com")],
      [
        githubPr(headSha),
        { check_runs: [] },
        { statuses: [] },
        { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false },
      ],
    );
    await assert.rejects(
      f.service.mergeForgePullRequest({
        ...(await f.target()),
        kind: "pull-request",
        number: 7,
        headSha: sha,
        method,
      }),
      new RegExp(`FORGE_${code}`),
    );
    assert.ok(f.state.calls.every((call) => !call.init.method));
  }
});

test("GitHub merge submits the reviewed SHA and never requests branch deletion", async () => {
  const f = fixture(
    "https://github.com/team/project.git",
    [account("github", "https://github.com")],
    [
      githubPr(),
      { check_runs: [] },
      { statuses: [] },
      { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false },
      { merged: true },
    ],
  );
  await f.service.mergeForgePullRequest({
    ...(await f.target()),
    kind: "pull-request",
    number: 7,
    headSha: sha,
    method: "squash",
  });
  const call = f.state.calls.at(-1)!;
  assert.equal(call.init.method, "PUT");
  assert.deepEqual(JSON.parse(String(call.init.body)), { sha, merge_method: "squash" });
});

test("Gitea gets patch data from raw diff and changes PR state using the pulls collection", async () => {
  const f = fixture(
    "https://forge.example.invalid/team/project.git",
    [account("gitea", "https://forge.example.invalid")],
    [
      [{ filename: "hello.ts", status: "modified", additions: 1, deletions: 1 }],
      new Response(
        "diff --git a/hello.ts b/hello.ts\n--- a/hello.ts\n+++ b/hello.ts\n@@ -1 +1 @@\n-old\n+new\n",
      ),
      {
        number: 7,
        title: "PR",
        state: "open",
        head: { sha, ref: "feat" },
        base: { ref: "main" },
        mergeable: true,
      },
      [],
      { allow_merge_commits: true, allow_rebase: false, allow_squash_merge: false },
      null,
    ],
  );
  const target = await f.target();
  const files = await f.service.listForgeFiles({
    ...target,
    kind: "pull-request",
    number: 7,
    page: 1,
    pageSize: 20,
  });
  assert.match(files.items[0]!.patch!, /\+new/);
  await f.service.setForgeItemState({
    ...target,
    kind: "pull-request",
    number: 7,
    state: "closed",
  });
  assert.equal(f.state.calls.at(-1)!.url.pathname, "/api/v1/repos/team/project/pulls/7");
  assert.deepEqual(JSON.parse(String(f.state.calls.at(-1)!.init.body)), { state: "closed" });
});

test("partial check permissions still return the PR and a useful section error", async () => {
  const f = fixture(
    "https://github.com/team/project.git",
    [account("github", "https://github.com")],
    [
      githubPr(),
      new Response("sensitive body", { status: 403 }),
      { statuses: [{ id: 1, context: "tests", state: "success" }] },
      { allow_squash_merge: true },
    ],
  );
  const detail = await f.service.getForgeItem({
    ...(await f.target()),
    kind: "pull-request",
    number: 7,
  });
  assert.equal(detail.title, "Synthetic PR");
  assert.equal(detail.change?.checks[0]?.state, "success");
  assert.equal(detail.change?.checksError, "FORGE_FORBIDDEN");
});

test("the most specific server path wins, then the default account, and credentials never enter repository URLs", async () => {
  const general = {
    ...account("gitea", "https://forge.example.invalid"),
    id: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b02",
    isDefault: true,
  };
  const specific = { ...account("gitea", "https://forge.example.invalid/git"), isDefault: false };
  const f = fixture(
    "https://embedded-user:embedded-secret@forge.example.invalid/git/team/project.git",
    [general, specific],
  );
  const result = await f.repository();
  assert.equal(result.repository?.accountId, accountId);
  assert.equal(result.repository?.url, "https://forge.example.invalid/git/team/project");
  assert.doesNotMatch(
    JSON.stringify(result),
    /embedded-user|embedded-secret|synthetic-forge-token/,
  );
});

test("Gitea normalizes nested merged state and uses SHA-protected lowercase merge payloads", async () => {
  const f = fixture(
    "https://forge.example.invalid/team/project.git",
    [account("gitea", "https://forge.example.invalid")],
    [
      [{ number: 7, title: "Merged PR", state: "closed", pull_request: { merged: true } }],
      {
        number: 8,
        title: "Ready PR",
        state: "open",
        head: { sha, ref: "feature" },
        base: { ref: "main" },
        mergeable: true,
      },
      [],
      { allow_merge_commits: false, allow_squash_merge: true, allow_rebase: false },
      new Response(null, { status: 204 }),
    ],
  );
  const target = await f.target();
  const result = await f.service.listForgeItems({
    ...target,
    kind: "pull-request",
    state: "closed",
    page: 1,
    pageSize: 20,
  });
  assert.equal(result.items[0]?.state, "merged");
  await f.service.mergeForgePullRequest({
    ...target,
    kind: "pull-request",
    number: 8,
    headSha: sha,
    method: "squash",
  });
  assert.deepEqual(JSON.parse(String(f.state.calls.at(-1)!.init.body)), {
    do: "squash",
    head_commit_id: sha,
    delete_branch_after_merge: false,
  });
});

test("GitLab merge honors mandatory squash without deleting the source branch", async () => {
  const f = fixture(
    "https://gitlab.com/team/project.git",
    [account("gitlab", "https://gitlab.com")],
    [
      {
        iid: 7,
        title: "Ready MR",
        state: "opened",
        sha,
        source_branch: "feature",
        target_branch: "main",
        detailed_merge_status: "mergeable",
      },
      [],
      { merge_method: "ff", squash_option: "always" },
      { state: "merged" },
    ],
  );
  await f.service.mergeForgePullRequest({
    ...(await f.target()),
    kind: "pull-request",
    number: 7,
    headSha: sha,
    method: "squash",
  });
  assert.equal(
    f.state.calls.at(-1)!.url.pathname,
    "/api/v4/projects/team%2Fproject/merge_requests/7/merge",
  );
  assert.deepEqual(JSON.parse(String(f.state.calls.at(-1)!.init.body)), {
    sha,
    squash: true,
    should_remove_source_branch: false,
  });
});

test("failure to read merge settings disables methods without discarding the PR", async () => {
  const f = fixture(
    "https://github.com/team/project.git",
    [account("github", "https://github.com")],
    [
      githubPr(),
      { check_runs: [] },
      { statuses: [] },
      new Response("secret response", { status: 403 }),
    ],
  );
  const result = await f.service.getForgeItem({
    ...(await f.target()),
    kind: "pull-request",
    number: 7,
  });
  assert.equal(result.title, "Synthetic PR");
  assert.deepEqual(result.change?.mergeMethods, []);
  assert.equal(result.change?.mergeOptionsError, "FORGE_FORBIDDEN");
});

test("redirects, network failures and oversized responses fail closed without returning payloads", async () => {
  for (const reply of [
    new Response("private payload", {
      status: 302,
      headers: { location: "https://other.example.invalid" },
    }),
    new Error("sensitive network details"),
    new Response("x".repeat(8 * 1024 * 1024 + 1)),
  ]) {
    const f = fixture(
      "https://github.com/team/project.git",
      [account("github", "https://github.com")],
      [reply],
    );
    await assert.rejects(
      f.service.listForgeItems({
        ...(await f.target()),
        kind: "issue",
        state: "open",
        page: 1,
        pageSize: 20,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^FORGE_(NETWORK|RESPONSE)$/);
        return true;
      },
    );
    assert.equal(f.state.calls.length, 1);
  }
});
