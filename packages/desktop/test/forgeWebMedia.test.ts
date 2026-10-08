import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ForgeWebMediaContext } from "@zcode/shared";
import {
  createForgeNativeMediaTransport,
  type ForgeNativeSession,
  validateForgeWebMediaContext,
} from "../src/main/forgeWebMedia.js";

const context: ForgeWebMediaContext = {
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  username: "synthetic-user",
  serverUrl: "https://api.example.invalid/git",
  repository: "team/sub/project",
  repositoryUrl: "https://api.example.invalid/git/team/sub/project",
  url: "https://api.example.invalid/git/team/sub/project/uploads/0123456789abcdef0123456789abcdef/image.png",
  loginUrl: "https://web.example.invalid/git/users/sign_in",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
  "base64",
);
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class LoginWindow extends EventEmitter {
  webContents = new EventEmitter();
  destroyed = false;
  loaded: string | null = null;
  fail = false;
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.emit("close");
    this.destroyed = true;
    this.emit("closed");
  }
  async loadURL(url: string) {
    this.loaded = url;
    if (this.fail) throw new Error("synthetic navigation failure");
  }
}
function fixture(timeout = 1000, failWindow = false) {
  const events = new EventEmitter();
  const opened = deferred<LoginWindow>();
  const state = {
    cookie: "",
    username: "synthetic-user",
    user: null as Response | null,
    image: null as Response | null,
    calls: [] as Array<{ url: string; init: RequestInit }>,
    windows: [] as LoginWindow[],
    fetch: null as ((url: string) => Promise<Response>) | null,
  };
  const session: ForgeNativeSession = {
    cookies: {
      async get(filter) {
        assert.deepEqual(filter, { url: context.loginUrl, name: "_gitlab_session" });
        return state.cookie ? [{ value: state.cookie }] : [];
      },
      on: (event, listener) => events.on(event, listener),
      removeListener: (event, listener) => events.removeListener(event, listener),
    },
    async fetch(url, init) {
      state.calls.push({ url, init });
      if (state.fetch) return state.fetch(url);
      return url.endsWith("/user")
        ? (state.user ?? Response.json({ username: state.username }))
        : (state.image ?? new Response(png, { headers: { "content-type": "image/png" } }));
    },
  };
  const transport = createForgeNativeMediaTransport({
    session: () => session,
    openWindow() {
      const window = new LoginWindow();
      window.fail = failWindow;
      state.windows.push(window);
      opened.resolve(window);
      return window;
    },
    authorizationTimeoutMs: timeout,
  });
  const invoke = (action: "read" | "authenticate", signal = new AbortController().signal) =>
    transport(action, context, signal);
  const clean = (window: LoginWindow) => {
    assert.equal(window.isDestroyed(), true);
    assert.equal(window.listenerCount("closed"), 0);
    assert.equal(window.listenerCount("close"), 0);
    assert.equal(window.webContents.listenerCount("did-navigate"), 0);
    assert.equal(events.listenerCount("changed"), 0);
  };
  return { state, events, opened, invoke, clean };
}

test("native image verifies the selected user and returns raster bytes only", async () => {
  const f = fixture();
  f.state.cookie = "synthetic-session";
  const preview = await f.invoke("read");
  assert.deepEqual(preview, {
    mediaType: "image/png",
    dataBase64: png.toString("base64"),
    totalBytes: png.length,
  });
  assert.equal(f.state.windows.length, 0);
  assert.deepEqual(
    f.state.calls.map((c) => c.url),
    [context.serverUrl + "/api/v4/user", context.url],
  );
  for (const call of f.state.calls) {
    assert.equal(new Headers(call.init.headers).get("Cookie"), "_gitlab_session=synthetic-session");
    assert.equal(new Headers(call.init.headers).get("PRIVATE-TOKEN"), null);
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "manual");
  }
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-session/);
  await f.invoke("authenticate");
  assert.equal(f.state.windows.length, 0, "An existing session does not open another login window");
});

test("image reads never open login; explicit login verifies cookies and cleans its window", async () => {
  const f = fixture();
  await assert.rejects(f.invoke("read"), /FORGE_MEDIA_AUTHENTICATION$/);
  assert.equal(f.state.windows.length, 0);
  const pending = f.invoke("authenticate");
  const window = await f.opened.promise;
  assert.equal(window.loaded, context.loginUrl);
  f.state.cookie = "synthetic-session";
  f.events.emit("changed");
  await pending;
  f.clean(window);
  assert.ok(await f.invoke("read"));
});

test("another logged-in username cannot authorize the bound account", async () => {
  const f = fixture();
  f.state.cookie = "synthetic-session";
  f.state.username = "another-user";
  await assert.rejects(f.invoke("read"), /FORGE_MEDIA_IDENTITY_CHANGED/);
  const pending = f.invoke("authenticate");
  const window = await f.opened.promise;
  f.state.username = context.username;
  f.events.emit("changed");
  await pending;
  f.clean(window);
});

test("cancel, owner abort, timeout and failed navigation settle and remove listeners", async () => {
  for (const mode of ["close", "abort", "timeout", "navigation"] as const) {
    const f = fixture(mode === "timeout" ? 10 : 1000, mode === "navigation");
    const controller = new AbortController();
    const result = assert.rejects(
      f.invoke("authenticate", controller.signal),
      mode === "navigation" ? /FORGE_NETWORK/ : /FORGE_MEDIA_AUTHENTICATION_CANCELLED/,
    );
    const window = await f.opened.promise;
    if (mode === "close") window.close();
    if (mode === "abort") controller.abort();
    await result;
    f.clean(window);
  }
});

test("cookie changes during identity verification are checked again before authorization", async () => {
  const f = fixture();
  const oldUser = deferred<Response>();
  const started = deferred();
  let first = true;
  f.state.fetch = async () => {
    if (first) {
      first = false;
      started.resolve();
      return oldUser.promise;
    }
    return Response.json({ username: context.username });
  };
  const pending = f.invoke("authenticate");
  const window = await f.opened.promise;
  f.state.cookie = "old-session";
  f.events.emit("changed");
  await started.promise;
  f.state.cookie = "new-session";
  f.events.emit("changed");
  oldUser.resolve(Response.json({ username: "old-user" }));
  await pending;
  assert.equal(f.state.calls.length, 2);
  assert.equal(
    new Headers(f.state.calls[1]!.init.headers).get("Cookie"),
    "_gitlab_session=new-session",
  );
  f.clean(window);
});

test("malformed identity, expired sessions, redirects and non-raster bodies fail closed", async () => {
  for (const user of [null, "wrong", [], {}, { username: 1 }]) {
    const f = fixture();
    f.state.cookie = "synthetic-session";
    f.state.user = Response.json(user);
    await assert.rejects(f.invoke("read"), /FORGE_RESPONSE/);
    assert.equal(f.state.calls.length, 1);
  }
  for (const status of [302, 401, 403]) {
    const f = fixture();
    f.state.cookie = "synthetic-session";
    f.state.user = new Response(null, { status });
    await assert.rejects(f.invoke("read"), /FORGE_MEDIA_AUTHENTICATION$/);
    assert.equal(f.state.calls.length, 1);
  }
  for (const image of [
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    new Response(null, {
      status: 302,
      headers: { Location: "https://other.example.invalid/image" },
    }),
  ]) {
    const f = fixture();
    f.state.cookie = "synthetic-session";
    f.state.image = image;
    await assert.rejects(f.invoke("read"), /FORGE_(RESPONSE|MEDIA_AUTHENTICATION)$/);
    assert.equal(f.state.calls.length, 2, "A redirect is never followed");
  }
});

test("a late successful transport response after abort cannot return an image or authorize", async () => {
  for (const action of ["read", "authenticate"] as const) {
    const f = fixture();
    f.state.cookie = "synthetic-session";
    const response = deferred<Response>();
    const started = deferred();
    f.state.fetch = async () => {
      started.resolve();
      return response.promise;
    };
    const controller = new AbortController();
    const rejected = assert.rejects(
      f.invoke(action, controller.signal),
      /FORGE_MEDIA_AUTHENTICATION_CANCELLED/,
    );
    await started.promise;
    controller.abort();
    response.resolve(Response.json({ username: context.username }));
    await rejected;
    assert.equal(f.state.windows.length, 0);
  }
});

test("native context refuses foreign uploads, credential URLs and unbound project paths", () => {
  for (const update of [
    { url: context.url.replace("api.example", "other.example") },
    { repositoryUrl: context.repositoryUrl.replace("/project", "/other") },
    { serverUrl: "https://token@api.example.invalid/git" },
    { loginUrl: "https://web.example.invalid/git/users/sign_in?token=secret" },
    { loginUrl: "file:///users/sign_in" },
  ])
    assert.throws(() => validateForgeWebMediaContext({ ...context, ...update }));
});
