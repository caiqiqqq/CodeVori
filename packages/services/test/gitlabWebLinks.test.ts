import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeApiClient } from "../src/git/providers/forgeApiClient.js";
import { createGitlabForgeProvider } from "../src/git/providers/gitlabForgeProvider.js";

const request = {
  workspacePath: "/synthetic/project",
  repositoryKey: "synthetic",
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  kind: "issue" as const,
  number: 42,
};
const query = {
  ...request,
  state: "open" as const,
  search: "",
  sort: "newest" as const,
  labels: [],
  page: 1,
  pageSize: 20,
};
const project = "https://gitlab.example.invalid/git/team/sub/project";
const internal = "http://internal.example.invalid:1080";
const row = {
  iid: 42,
  title: "Synthetic issue",
  state: "opened",
  web_url: `${internal}/team/sub/project/-/work_items/42?view=full#note_7`,
};

test("GitLab list, detail, create and update share the configured project access URL", async () => {
  const api: ForgeApiClient = async (path, _query, write) => ({
    data: path.endsWith("/issues") && !write ? [row] : row,
    headers: new Headers(),
  });
  const adapter = createGitlabForgeProvider(api, "team/sub/project", project);
  const results = [
    (await adapter.listItems(query)).items[0],
    await adapter.getItem(request),
    await adapter.createIssue({ ...request, title: row.title, body: "", labels: [] }),
    await adapter.updateIssue({
      ...request,
      title: row.title,
      body: "",
      labels: [],
      assignees: [],
      milestone: null,
    }),
  ];
  for (const result of results) {
    assert.equal(result?.url, `${project}/-/work_items/42?view=full#note_7`);
  }
});

test("GitLab normalizes current-project MR, pipeline, milestone and related issue links", async () => {
  const api: ForgeApiClient = async (path) => ({
    data: path.endsWith("/pipelines")
      ? [{ id: 5, web_url: `${internal}/team/sub/project/-/pipelines/5` }]
      : path.endsWith("/links")
        ? [row, { ...row, web_url: "https://other.example.invalid/team/other/-/issues/42" }]
        : path.endsWith("/participants") || path.endsWith("/labels")
          ? []
          : {
              ...row,
              web_url: `${internal}/team/sub/project/-/merge_requests/42`,
              milestone: {
                title: "Release",
                web_url: `${internal}/team/sub/project/-/milestones/3`,
              },
            },
    headers: new Headers(),
  });
  const adapter = createGitlabForgeProvider(api, "team/sub/project", project);
  const detail = await adapter.getItem({ ...request, kind: "pull-request" });
  assert.equal(detail.url, `${project}/-/merge_requests/42`);
  assert.equal(detail.change?.checks[0]?.url, `${project}/-/pipelines/5`);
  assert.equal(detail.metadata?.milestone?.url, `${project}/-/milestones/3`);
  const extras = await adapter.getItemExtras!(request);
  assert.deepEqual(
    extras.linkedItems?.map((link) => link.url),
    [
      `${project}/-/work_items/42?view=full#note_7`,
      "https://other.example.invalid/team/other/-/issues/42",
    ],
  );
});

test("GitLab access links respect project boundaries, configured subpaths and URL safety", async () => {
  const cases: Array<[unknown, string | undefined, string | null]> = [
    [`${internal}/team/sub/project/-/issues/42`, project, `${project}/-/issues/42`],
    [
      `${internal}/git/team/sub/project/-/work_items/42`,
      `${project}/`,
      `${project}/-/work_items/42`,
    ],
    [
      `${internal}/team/sub/project/-/issues/42`,
      "http://public.example.invalid:8080/team/sub/project",
      "http://public.example.invalid:8080/team/sub/project/-/issues/42",
    ],
    [row.web_url, undefined, row.web_url],
    [row.web_url, "invalid", row.web_url],
    [row.web_url, "javascript:alert(1)", row.web_url],
    [row.web_url, "https://user:password@public.example.invalid/team/sub/project", row.web_url],
    [
      `${internal}/team/sub/project-other/-/issues/42`,
      project,
      `${internal}/team/sub/project-other/-/issues/42`,
    ],
    [
      `${internal}/other/team/sub/project/-/issues/42`,
      project,
      `${internal}/other/team/sub/project/-/issues/42`,
    ],
    [`${internal}/team/sub/other/-/issues/42`, project, `${internal}/team/sub/other/-/issues/42`],
    [
      "https://tracker.example.invalid/ticket/42",
      project,
      "https://tracker.example.invalid/ticket/42",
    ],
    ["javascript:alert(1)", project, null],
    ["https://user:password@internal.example.invalid/team/sub/project/-/issues/42", project, null],
    ["invalid", project, null],
    [null, project, null],
  ];
  for (const [source, configured, expected] of cases) {
    const api: ForgeApiClient = async () => ({
      data: { ...row, web_url: source },
      headers: new Headers(),
    });
    const result = await createGitlabForgeProvider(api, "team/sub/project", configured).getItem(
      request,
    );
    assert.equal(result.url, expected, `source=${source}, configured=${configured}`);
  }
});

test("GitLab project links retain encoded namespace segments", async () => {
  const api: ForgeApiClient = async () => ({
    data: { ...row, web_url: `${internal}/team/%E9%A1%B9%E7%9B%AE/-/work_items/42` },
    headers: new Headers(),
  });
  const result = await createGitlabForgeProvider(
    api,
    "team/项目",
    "https://gitlab.example.invalid/git/team/%E9%A1%B9%E7%9B%AE",
  ).getItem(request);
  assert.equal(
    result.url,
    "https://gitlab.example.invalid/git/team/%E9%A1%B9%E7%9B%AE/-/work_items/42",
  );
});
