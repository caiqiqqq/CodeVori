import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeApiClient } from "../src/git/providers/forgeApiClient.js";
import { createGitlabForgeProvider } from "../src/git/providers/gitlabForgeProvider.js";

const request = {
  workspacePath: "/synthetic/project",
  repositoryKey: "synthetic",
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  kind: "issue" as const,
  number: 7,
  page: 1,
  pageSize: 30,
};
const user = { id: 1, username: "tester", name: "Tester", avatar_url: null };
const time = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
const note = (id: number, seconds: number, system = true) => ({
  id,
  body: system ? "assigned to tester" : "A comment",
  system,
  author: user,
  created_at: time(seconds),
});
const event = (id: number, seconds: number, action = "add", actor = user) => ({
  id,
  action,
  user: actor,
  created_at: time(seconds),
  label: { id, name: id === 1 ? "bug" : "优化", color: id === 1 ? "#d73a4a" : "#16874b" },
});

function fixture(notes: unknown[], events: unknown[], withTotal = true) {
  const calls: Array<{ path: string; query: Record<string, string | number | undefined> }> = [];
  const api: ForgeApiClient = async (path, query = {}) => {
    calls.push({ path, query });
    assert.match(path, /^projects\/team%2Fproject\/(issues|merge_requests)\/7\//);
    const source = path.endsWith("/notes") ? notes : events;
    assert.ok(path.endsWith("/notes") || path.endsWith("/resource_label_events"));
    const page = Number(query.page);
    const size = Number(query.per_page);
    assert.ok(size > 0 && size <= 100);
    const end = page * size;
    return {
      data: source.slice(end - size, end),
      headers: new Headers({
        ...(withTotal ? { "x-total": String(source.length) } : {}),
        "x-next-page": end < source.length ? String(page + 1) : "",
      }),
    };
  };
  return { api, calls, adapter: createGitlabForgeProvider(api, "team/project") };
}

test("GitLab activity includes the missing label batch before its three notes", async () => {
  const { adapter, calls } = fixture(
    [note(1, 2), note(2, 3), note(3, 4)],
    [event(1, 1), event(2, 1)],
  );
  const result = await adapter.listComments(request);
  assert.equal(result.items.length, 4);
  assert.equal(result.total, 4);
  assert.equal(result.hasMore, false);
  const labels = result.items[0];
  assert.equal(labels.id, "label-event:1");
  assert.equal(labels.system, true);
  assert.equal(labels.author.username, "tester");
  assert.equal(labels.createdAt, time(1));
  assert.deepEqual(labels.labelActivity, {
    action: "add",
    labels: [
      { key: "1", name: "bug", color: "#d73a4a" },
      { key: "2", name: "优化", color: "#16874b" },
    ],
  });
  assert.deepEqual(
    result.items.slice(1).map((row) => row.id),
    ["1", "2", "3"],
  );
  assert.ok(calls.some((call) => call.path.endsWith("/resource_label_events")));
  assert.ok(
    calls.some((call) => call.query.sort === "asc" && call.query.order_by === "created_at"),
  );
});

test("combined activity pages stay chronological, complete and disjoint", async () => {
  const { adapter } = fixture(
    [note(1, 2), note(2, 4, false), note(3, 6), note(4, 8, false)],
    [event(1, 1), event(2, 1), event(3, 3, "remove"), event(4, 5)],
  );
  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) => adapter.listComments({ ...request, page, pageSize: 2 })),
  );
  const rows = pages.flatMap((page) => page.items);
  assert.deepEqual(
    rows.map((row) => row.createdAt),
    [1, 2, 3, 4, 5, 6, 8].map(time),
  );
  assert.equal(new Set(rows.map((row) => row.id)).size, 7, "note/event numeric IDs cannot collide");
  assert.deepEqual(
    pages.map((page) => page.hasMore),
    [true, true, true, false],
  );
  assert.deepEqual(
    pages.map((page) => page.total),
    [7, 7, 7, 7],
  );
  assert.equal(rows[2].labelActivity?.action, "remove");
});

test("batch grouping preserves different actors, actions and timestamps", async () => {
  const { adapter } = fixture(
    [],
    [
      event(1, 1),
      event(2, 1),
      event(3, 1, "remove"),
      event(4, 1, "add", { ...user, id: 2, username: "another" }),
      event(5, 2),
    ],
  );
  const result = await adapter.listComments(request);
  assert.equal(result.items.length, 4);
  assert.deepEqual(
    result.items.map((row) => row.labelActivity?.labels.length),
    [2, 1, 1, 1],
  );
});

test("label batches spanning source pages are grouped and duplicate events are not counted twice", async () => {
  const events = Array.from({ length: 100 }, (_, i) => event(i + 1, i + 1));
  events.push(event(101, 100), events[99]);
  const { adapter, calls } = fixture([], events);
  const result = await adapter.listComments({ ...request, pageSize: 100 });
  assert.equal(result.total, 100);
  assert.equal(result.items.length, 100);
  assert.equal(result.items[99].labelActivity?.labels.length, 2);
  assert.equal(result.hasMore, false);
  assert.deepEqual(
    calls
      .filter((call) => call.path.endsWith("/resource_label_events"))
      .map((call) => call.query.page),
    [1, 2],
  );
});

test("deleted labels retain their activity and label names are literal untrusted text", async () => {
  const literal = "<img src=x onerror=alert(1)> [file](file:///private)";
  const { adapter } = fixture(
    [],
    [
      { ...event(1, 1), label: null },
      { ...event(2, 1), label: { id: 2, name: literal, color: "url(https://invalid)" } },
    ],
  );
  const result = await adapter.listComments(request);
  assert.deepEqual(result.items[0].labelActivity?.labels, [
    null,
    { key: "2", name: literal, color: null },
  ]);
  assert.equal(result.items[0].body, "");
});

test("notes reads use only the prefix needed for the combined page", async () => {
  const { adapter, calls } = fixture(
    Array.from({ length: 500 }, (_, i) => note(i + 1, i + 1)),
    [],
  );
  const result = await adapter.listComments(request);
  assert.equal(result.items.length, 30);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 500);
  assert.equal(calls.filter((call) => call.path.endsWith("/notes")).length, 1);
  assert.equal(calls.find((call) => call.path.endsWith("/notes"))?.query.per_page, 31);
});

test("notes sharing the page cutoff timestamp keep stable ordering across combined pages", async () => {
  const { adapter } = fixture(
    Array.from({ length: 9 }, (_, i) => note(9 - i, 1)),
    [],
  );
  const pages = await Promise.all(
    [1, 2, 3, 4, 5].map((page) => adapter.listComments({ ...request, page, pageSize: 2 })),
  );
  assert.deepEqual(
    pages.flatMap((page) => page.items.map((row) => row.id)),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  );
});

test("unknown totals remain unknown until all notes are exhausted", async () => {
  const { adapter } = fixture([note(1, 1), note(2, 2), note(3, 3), note(4, 4)], [], false);
  const first = await adapter.listComments({ ...request, pageSize: 2 });
  assert.equal(first.total, null);
  assert.equal(first.hasMore, true);
  const last = await adapter.listComments({ ...request, page: 2, pageSize: 2 });
  assert.equal(last.total, 4);
  assert.equal(last.hasMore, false);
});

test("MR activity uses the MR resource label endpoint", async () => {
  const { adapter, calls } = fixture([note(1, 2)], [event(1, 1)]);
  const result = await adapter.listComments({ ...request, kind: "pull-request" });
  assert.equal(result.items.length, 2);
  assert.ok(calls.every((call) => call.path.includes("/merge_requests/7/")));
});

test("label source failures do not silently change activity pagination or block base item reads", async () => {
  const api: ForgeApiClient = async (path) => {
    if (path.endsWith("/resource_label_events")) throw new Error("FORGE_FORBIDDEN");
    return {
      data: path.endsWith("/notes")
        ? [note(1, 1)]
        : { iid: 7, title: "Issue", state: "opened", author: user },
      headers: new Headers({ "x-next-page": "" }),
    };
  };
  const adapter = createGitlabForgeProvider(api, "team/project");
  assert.equal((await adapter.getItem(request)).title, "Issue");
  await assert.rejects(adapter.listComments(request), /FORGE_FORBIDDEN/);
});

test("malformed label events and non-progressing source pagination fail explicitly", async () => {
  for (const data of [
    { invalid: true },
    [{ ...event(1, 1), action: "invalid" }],
    [{ ...event(1, 1), created_at: "invalid" }],
  ]) {
    const api: ForgeApiClient = async (path) => ({
      data: path.endsWith("/notes") ? [] : data,
      headers: new Headers({ "x-next-page": "" }),
    });
    await assert.rejects(
      createGitlabForgeProvider(api, "team/project").listComments(request),
      /FORGE_RESPONSE/,
    );
  }
  let labelCalls = 0;
  const api: ForgeApiClient = async (path) => {
    if (path.endsWith("/resource_label_events")) labelCalls++;
    return {
      data: path.endsWith("/notes") ? [] : [event(1, 1)],
      headers: new Headers({ "x-next-page": path.endsWith("/notes") ? "" : "2" }),
    };
  };
  await assert.rejects(
    createGitlabForgeProvider(api, "team/project").listComments(request),
    /FORGE_RESPONSE/,
  );
  assert.ok(labelCalls <= 2);
});

test("over-limit label history reports an error rather than an incomplete timeline", async () => {
  let labelCalls = 0;
  const api: ForgeApiClient = async (path, query = {}) => {
    if (path.endsWith("/notes")) return { data: [], headers: new Headers({ "x-next-page": "" }) };
    labelCalls++;
    return {
      data: Array.from({ length: 100 }, (_, i) =>
        event((Number(query.page) - 1) * 100 + i + 1, i + 1),
      ),
      headers: new Headers({ "x-next-page": String(Number(query.page) + 1) }),
    };
  };
  await assert.rejects(
    createGitlabForgeProvider(api, "team/project").listComments(request),
    /FORGE_RESPONSE/,
  );
  assert.equal(labelCalls, 100);
});
