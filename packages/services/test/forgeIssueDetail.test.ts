import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeApiClient } from "../src/git/providers/forgeApiClient.js";
import { createGitlabForgeProvider } from "../src/git/providers/gitlabForgeProvider.js";
import { createGithubForgeProvider } from "../src/git/providers/githubForgeProvider.js";
import { createGiteaForgeProvider } from "../src/git/providers/giteaForgeProvider.js";

const request = {
  workspacePath: "/synthetic/project",
  repositoryKey: "synthetic",
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  kind: "issue" as const,
  number: 7,
};
const user = { username: "tester", login: "tester", name: "Tester", avatar_url: null };
const raw = {
  iid: 7,
  number: 7,
  title: "Synthetic issue",
  state: "opened",
  description: "Description",
  body: "Description",
  author: user,
  user,
  assignees: [user],
  labels: ["bug"],
  milestone: {
    title: "Next release",
    web_url: "https://forge.example.invalid/milestone/1",
    html_url: "https://forge.example.invalid/milestone/1",
  },
  due_date: "2026-10-20",
  confidential: false,
  time_stats: { time_estimate: 3600, total_time_spent: 1800 },
  task_completion_status: { count: 3, completed_count: 1 },
};
function apiFixture(failedSection?: "participants" | "links" | "labels") {
  const calls: string[] = [];
  const api: ForgeApiClient = async (path) => {
    calls.push(path);
    if (path.endsWith(`/${failedSection}`)) throw new Error("FORGE_FORBIDDEN");
    const data = path.endsWith("/participants")
      ? [user]
      : path.endsWith("/links")
        ? [
            {
              iid: 8,
              title: "Related",
              state: "closed",
              web_url: "https://forge.example.invalid/team/project/-/issues/8",
            },
          ]
        : path.endsWith("/labels")
          ? [{ name: "bug", color: "#d73a4a" }]
          : raw;
    return { data, headers: new Headers() };
  };
  return { api, calls };
}
test("GitLab issue detail includes web attributes, task totals, colored labels and linked items", async () => {
  const { api } = apiFixture();
  const adapter = createGitlabForgeProvider(api, "team/project");
  const detail = await adapter.getItem(request);
  const extras = await adapter.getItemExtras!(request);
  assert.equal(detail.metadata?.assignees[0]?.username, "tester");
  assert.equal(detail.metadata?.milestone?.title, "Next release");
  assert.equal(detail.metadata?.dueDate, "2026-10-20");
  assert.deepEqual(detail.metadata?.timeStats, { estimateSeconds: 3600, spentSeconds: 1800 });
  assert.equal(detail.metadata?.confidential, false);
  assert.deepEqual(detail.metadata?.taskStatus, { total: 3, completed: 1 });
  assert.equal(extras.participants?.[0]?.username, "tester");
  assert.equal(extras.linkedItems?.[0]?.number, 8);
  assert.equal(extras.labels?.[0]?.color, "#d73a4a");
});
test("optional GitLab section failures preserve the issue and report only that section", async () => {
  for (const section of ["participants", "links", "labels"] as const) {
    const { api } = apiFixture(section);
    const adapter = createGitlabForgeProvider(api, "team/project");
    const detail = await adapter.getItem(request);
    const extras = await adapter.getItemExtras!(request);
    assert.equal(detail.body, "Description");
    assert.equal(extras.errors?.[section], "FORGE_FORBIDDEN");
    assert.equal(Object.keys(extras.errors ?? {}).length, 1);
  }
});
test("base issue reads do not wait for supplemental attributes", async () => {
  const { api, calls } = apiFixture();
  await createGitlabForgeProvider(api, "team/project").getItem(request);
  assert.deepEqual(calls, ["projects/team%2Fproject/issues/7"]);
});
test("malformed optional GitLab responses cannot discard the issue or other sections", async () => {
  for (const section of ["participants", "links", "labels"] as const) {
    const { api } = apiFixture();
    const malformed: ForgeApiClient = (path, ...args) =>
      path.endsWith(`/${section}`)
        ? Promise.resolve({ data: { invalid: true }, headers: new Headers() })
        : api(path, ...args);
    const adapter = createGitlabForgeProvider(malformed, "team/project");
    assert.equal((await adapter.getItem(request)).body, "Description");
    const extras = await adapter.getItemExtras!(request);
    assert.deepEqual(extras.errors, { [section]: "FORGE_RESPONSE" });
    if (section !== "participants") assert.equal(extras.participants?.length, 1);
    if (section !== "links") assert.equal(extras.linkedItems?.length, 1);
  }
});
test("GitLab activity retains system notes and combined pagination", async () => {
  const api: ForgeApiClient = async (path) => ({
    data: path.endsWith("/resource_label_events")
      ? []
      : [
          { id: 1, system: true, body: "assigned to tester", author: user },
          { id: 2, system: false, body: "A comment", author: user },
          { id: 3, system: false, body: "Another comment", author: user },
        ],
    headers: new Headers(
      path.endsWith("/resource_label_events")
        ? { "x-next-page": "" }
        : { "x-total": "3", "x-next-page": "" },
    ),
  });
  const result = await createGitlabForgeProvider(api, "team/project").listComments({
    ...request,
    page: 1,
    pageSize: 2,
  });
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((note) => note.system),
    [true, false],
  );
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 3);
});
test("GitHub and Gitea expose shared attributes without inventing GitLab fields", async () => {
  for (const factory of [createGithubForgeProvider, createGiteaForgeProvider]) {
    const { api } = apiFixture();
    const detail = await factory(api, "team/project").getItem(request);
    assert.equal(detail.metadata?.assignees[0]?.username, "tester");
    assert.equal(detail.metadata?.milestone?.title, "Next release");
    assert.equal(detail.metadata?.timeStats, undefined);
    assert.equal(detail.metadata?.confidential, undefined);
  }
});

test("GitLab issue and MR lists request native label colors in their existing paginated response", async () => {
  for (const kind of ["issue", "pull-request"] as const) {
    const calls: string[] = [];
    const api: ForgeApiClient = async (path, query = {}) => {
      calls.push(path);
      assert.equal(
        path,
        `projects/team%2Fproject/${kind === "issue" ? "issues" : "merge_requests"}`,
      );
      assert.equal(String(query.with_labels_details), "true");
      assert.equal(query.page, 3);
      assert.equal(query.per_page, 20);
      assert.equal(query.search, "find");
      assert.equal(query.labels, "bug");
      return {
        data: [
          {
            ...raw,
            labels: [
              { name: "bug", color: "#dc143c" },
              { name: "优化", color: "#eee600" },
              { name: "untrusted", color: "url(javascript:alert(1))" },
            ],
          },
        ],
        headers: new Headers({ "x-total": "201", "x-next-page": "4" }),
      };
    };
    const result = await createGitlabForgeProvider(api, "team/project").listItems({
      ...request,
      kind,
      state: "open",
      search: "find",
      sort: "newest",
      labels: ["bug"],
      page: 3,
      pageSize: 20,
    });
    assert.deepEqual(result.items[0].labels, [
      { key: "bug", name: "bug", color: "#dc143c" },
      { key: "优化", name: "优化", color: "#eee600" },
      { key: "untrusted", name: "untrusted", color: null },
    ]);
    assert.equal(calls.length, 1, "No extra item or label-catalog request");
    assert.equal(result.page, 3);
    assert.equal(result.hasMore, true);
    assert.equal(result.total, 201);
  }
});

test("GitLab name-only label responses retain their neutral fallback", async () => {
  const { api } = apiFixture();
  const listApi: ForgeApiClient = async (path, ...args) => {
    const response = await api(path, ...args);
    return { ...response, data: [response.data] };
  };
  const result = await createGitlabForgeProvider(listApi, "team/project").listItems({
    ...request,
    state: "open",
    search: "",
    sort: "newest",
    labels: [],
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(result.items[0].labels, [{ key: "bug", name: "bug", color: null }]);
});
