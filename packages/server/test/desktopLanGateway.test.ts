import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { WebSocket } from "ws";
import {
  Emitter,
  VSBuffer,
  SocketProtocol,
  ChannelClient,
  ChannelServer,
  ProxyChannel,
  createQueuePair,
  HEADER_SIZE,
  type ISocket,
} from "@zcode/rpc";
import { createDesktopLanGateway } from "../src/desktopLanGateway.js";
import { createWindowWorkspaceProjection } from "../../desktop/src/host/windowWorkspaceProjection.js";
import { createWebSocketServiceConnection } from "@zcode/client";

test(
  "LAN auth, same Host RPC, readonly projection, scoped attachment and disposal",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-lan-test-"));
    const root = join(directory, "web");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root);
    await writeFile(join(root, "index.html"), "synthetic web");
    await writeFile(join(directory, "private.txt"), "must not escape");
    await symlink(join(directory, "private.txt"), join(root, "escape.txt"));
    const projection = createWindowWorkspaceProjection("same-existing-host");
    const desktop = projection.attach(true);
    let opened = 0;
    let disposed = 0;
    let commands = 0;
    const token = "synthetic-test-token-32-characters-minimum";
    const gateway = await createDesktopLanGateway({
      host: "127.0.0.1",
      token,
      staticRoot: root,
      allowedHosts: ["127.0.0.1"],
      openAttachment(scope) {
        if (
          scope.kind === "remote" &&
          (scope.remoteSessionId !== "existing-remote" ||
            scope.workspaceIdentity !== "remote-A" ||
            scope.workspacePath !== "/same")
        )
          throw new Error("stale scope");
        opened++;
        const [clientProtocol, hostProtocol] = createQueuePair();
        const server = new ChannelServer(hostProtocol, "host", 1000, true);
        const channel = ProxyChannel.fromService({
          ...projection.attach(false),
          async submit() {
            return ++commands;
          },
          async total() {
            return commands;
          },
          listTaskList: () => new Promise(() => {}),
        });
        server.registerChannel("window", channel);
        server.registerChannel("window-controller", channel);
        setImmediate(() => server.ready());
        return {
          protocol: clientProtocol,
          dispose() {
            disposed++;
            server.dispose();
          },
        };
      },
    });
    const origin = `http://127.0.0.1:${gateway.port}`;
    const wsOrigin = origin.replace("http:", "ws:");
    const clients: Array<{ ws: WebSocket; client: ChannelClient; protocol: SocketProtocol }> = [];
    let cookie = "";
    const connect = async (
      path = "/ws",
      headers: Record<string, string> = { Cookie: cookie, Origin: origin },
    ) => {
      const ws = new WebSocket(wsOrigin + path, { headers });
      await once(ws, "open");
      const data = new Emitter<VSBuffer>();
      const close = new Emitter<void>();
      const socket: ISocket = {
        onData: data.event,
        onClose: close.event,
        onEnd: close.event,
        write: (buffer) => ws.send(buffer.buffer),
        end: () => ws.close(),
        drain: () => Promise.resolve(),
        dispose: () => ws.close(),
      };
      ws.on("message", (bytes) => data.fire(VSBuffer.wrap(Buffer.from(bytes as Buffer))));
      ws.once("close", () => close.fire());
      const protocol = new SocketProtocol(socket);
      const client = new ChannelClient(protocol);
      clients.push({ ws, client, protocol });
      return {
        ws,
        service: ProxyChannel.toService<
          ReturnType<typeof projection.attach> & {
            submit(): Promise<number>;
            total(): Promise<number>;
          }
        >(client.getChannel("window")),
      };
    };
    const rejected = async (path: string, headers: Record<string, string>, status: number) => {
      const ws = new WebSocket(wsOrigin + path, { headers });
      const code = await new Promise<number>((done, reject) => {
        ws.once("unexpected-response", (_req, response) => {
          response.resume();
          ws.terminate();
          done(response.statusCode!);
        });
        ws.on("error", () => {});
        ws.once("open", () => {
          ws.terminate();
          reject(new Error("Unauthorized socket opened"));
        });
      });
      assert.equal(code, status);
    };
    try {
      assert.equal((await fetch(origin + "/api/desktop-window")).status, 401);
      assert.equal((await fetch(origin + "/?token=wrong", { redirect: "manual" })).status, 401);
      await rejected("/ws", { Origin: origin }, 403);
      assert.equal(opened, 0);
      const paired = await fetch(origin + `/?token=${token}`, { redirect: "manual" });
      assert.equal(paired.status, 303);
      assert.equal(paired.headers.get("location"), "/pair");
      assert.match(paired.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
      assert.doesNotMatch(paired.headers.get("set-cookie")!, /Max-Age|Expires/i);
      cookie = paired.headers.get("set-cookie")!.split(";")[0]!;
      assert.equal(
        await (await fetch(origin, { headers: { Cookie: cookie } })).text(),
        "synthetic web",
      );
      assert.deepEqual(
        await (await fetch(origin + "/api/desktop-window", { headers: { Cookie: cookie } })).json(),
        { kind: "desktop-window" },
      );
      assert.equal(
        (await fetch(origin + "/escape.txt", { headers: { Cookie: cookie } })).status,
        403,
      );
      await rejected("/ws", { Cookie: cookie, Origin: "http://other-device:9999" }, 403);
      await rejected("/ws?scope=invalid", { Cookie: cookie, Origin: origin }, 400);
      await rejected(
        "/ws?scope=" +
          encodeURIComponent(
            JSON.stringify({ kind: "remote", remoteSessionId: "a", workspacePath: "/same" }),
          ),
        { Cookie: cookie, Origin: origin },
        400,
      );
      const one = await connect();
      const two = await connect();
      const input = {
        workspaces: [{ workspacePath: "/project-B" }, { workspacePath: "/project-A" }],
        sidebar: { organizeBy: "project" as const, sortBy: "updated" as const },
      };
      await desktop.publishWorkspaceSession(input);
      assert.deepEqual((await one.service.getWorkspaceSession()).workspaces, input.workspaces);
      assert.deepEqual(
        await two.service.getWorkspaceSession(),
        await one.service.getWorkspaceSession(),
      );
      await assert.rejects(one.service.publishWorkspaceSession(input), /read-only/);
      assert.equal(await one.service.submit(), 1);
      assert.equal(await two.service.total(), 1, "Both sockets address the existing owner");
      const event = one.service.onDynamicWorkspaceSessionChanged();
      const next = new Promise<unknown>((done) => {
        const subscription = event((value) => {
          subscription.dispose();
          done(value);
        });
      });
      // Round-trip after listen makes the subscription ready without a timing-based sleep.
      await one.service.getWorkspaceSession();
      await desktop.publishWorkspaceSession({
        ...input,
        workspaces: [{ workspacePath: "/project-A" }],
      });
      assert.equal(((await next) as { revision: number }).revision, 2);
      const valid = await connect(
        "/ws?scope=" +
          encodeURIComponent(
            JSON.stringify({
              kind: "remote",
              remoteSessionId: "existing-remote",
              workspacePath: "/same",
              workspaceIdentity: "remote-A",
            }),
          ),
      );
      assert.equal((await valid.service.getWorkspaceSession()).epoch, "same-existing-host");
      const malformed = await connect();
      const malformedClosed = once(malformed.ws, "close");
      const header = Buffer.alloc(HEADER_SIZE);
      header[0] = 1;
      header.writeUInt32BE(0xffffffff, 9);
      malformed.ws.send(header);
      assert.equal(
        (await malformedClosed)[0],
        1002,
        "Incomplete RPC frames cannot accumulate across WebSocket messages",
      );
      const stale = await connect(
        "/ws?scope=" +
          encodeURIComponent(
            JSON.stringify({
              kind: "remote",
              remoteSessionId: "stale",
              workspacePath: "/same",
              workspaceIdentity: "remote-A",
            }),
          ),
      );
      await once(stale.ws, "close");
      assert.equal(opened, 4, "Stale remote scope never opens a local attachment");
      const originalWebSocket = globalThis.WebSocket;
      try {
        globalThis.WebSocket = class extends WebSocket {
          constructor(url: string | URL) {
            super(url, { headers: { Cookie: cookie, Origin: origin } });
          }
        } as unknown as typeof globalThis.WebSocket;
        let closed = 0;
        const intentional = await createWebSocketServiceConnection(wsOrigin + "/ws", {
          onClose: () => closed++,
        });
        await intentional.services.windowControllerService!.getWorkspaceSession!();
        intentional.dispose();
        await new Promise((done) => setImmediate(done));
        assert.equal(
          closed,
          0,
          "Intentional remote scope retirement must not close the whole window",
        );
        const connection = await createWebSocketServiceConnection(wsOrigin + "/ws", {
          onClose: () => closed++,
        });
        const pending = connection.services.windowControllerService!.listTaskList({
          kind: "all",
        } as never);
        const rejectedOnClose = assert.rejects(pending, /disconnected/);
        await connection.services.windowControllerService!.getWorkspaceSession!();
        await gateway.close();
        await rejectedOnClose;
        assert.equal(closed, 1);
        assert.equal(
          disposed,
          6,
          "Closing the gateway retires every Host attachment before settling",
        );
      } finally {
        globalThis.WebSocket = originalWebSocket;
      }
    } finally {
      for (const item of clients) {
        item.client.dispose();
        item.protocol.dispose();
        item.ws.terminate();
      }
      await gateway.close().catch(() => {});
      projection.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
