import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeImagePreview, ForgeImageRequest, ForgeRepository } from "@zcode/shared";
import { createForgeImageReads, ForgeImageCache } from "../src/git/forgeImageReads.js";
import type { ForgeProviderAdapter } from "../src/git/providers/forgeProvider.js";
import { createForgeService } from "../src/git/forgeService.js";
import type { PrivateGitAccount } from "../src/git/repo/versionControlRepo.js";

const preview: ForgeImagePreview = {
  mediaType: "image/png",
  dataBase64: "iVBORw0KGgo=",
  totalBytes: 8,
};
const request: ForgeImageRequest = {
  workspacePath: "/synthetic/project",
  repositoryKey: "repo",
  remoteName: "origin",
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  url: "https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc",
};
function fixture() {
  const state = {
    reads: [] as ForgeImageRequest[],
    validations: 0,
    secret: "synthetic-secret",
    username: "synthetic-user",
    missing: false,
    changed: false,
    failure: false,
    pause: null as Promise<void> | null,
  };
  const adapter = {
    async readImage(input: ForgeImageRequest) {
      state.reads.push(input);
      if (state.pause) await state.pause;
      if (state.failure) throw new Error("FORGE_NETWORK");
      return { ...preview };
    },
    async authenticateImage() {},
  } as ForgeProviderAdapter;
  const service = createForgeImageReads(async () => {
    state.validations++;
    if (state.missing) throw new Error("FORGE_MISSING_ACCOUNT");
    if (state.changed) throw new Error("FORGE_TARGET_CHANGED");
    return {
      adapter,
      repository: { url: "https://github.com/team/project" } as ForgeRepository,
      account: {
        id: request.accountId,
        username: state.username,
        secret: state.secret,
        serverUrl: "https://github.com",
      },
    };
  });
  return { service, state };
}

test("sequential image reads reuse raster bytes and revalidate every call; a new URL alone downloads", async () => {
  const { service, state } = fixture();
  const first = await service.readForgeImage(request);
  first.dataBase64 = "AA==";
  assert.deepEqual(
    await service.readForgeImage(request),
    preview,
    "callers cannot mutate cached content",
  );
  assert.equal(state.reads.length, 1);
  assert.ok(state.validations >= 4);
  await service.readForgeImage({ ...request, url: request.url.replace(/abc$/, "abd") });
  await service.readForgeImage(request);
  assert.equal(state.reads.length, 2);
});

test("concurrent image reads share one in-flight read", async () => {
  const { service, state } = fixture();
  let release!: () => void;
  state.pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads = [service.readForgeImage(request), service.readForgeImage(request)];
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(state.reads.length, 1);
  release();
  assert.deepEqual(await Promise.all(reads), [preview, preview]);
});

test("failed image reads are retryable and never cached", async () => {
  const { service, state } = fixture();
  state.failure = true;
  await assert.rejects(service.readForgeImage(request), /FORGE_NETWORK/);
  state.failure = false;
  assert.deepEqual(await service.readForgeImage(request), preview);
  await service.readForgeImage(request);
  assert.equal(state.reads.length, 2);
});

test("workspace identity, path, account, repository and remote isolate cached content", async () => {
  const { service, state } = fixture();
  const inputs = [
    request,
    { ...request, workspaceIdentity: "remote:A" },
    { ...request, workspaceIdentity: "remote:B" },
    { ...request, workspacePath: "/other" },
    { ...request, remoteName: "private" },
    { ...request, repositoryKey: "other-repo" },
    { ...request, accountId: "4c88bcca-98b9-4aaa-9c0c-2f869f0c1b01" },
  ];
  for (const input of inputs) await service.readForgeImage(input);
  for (const input of inputs) await service.readForgeImage(input);
  assert.equal(state.reads.length, inputs.length);
  await service.readForgeImage({ ...request, workspaceIdentity: " remote:A " });
  assert.equal(state.reads.length, inputs.length);
});

test("rotated credentials never reuse old bytes; removed accounts and changed repositories fail before lookup", async () => {
  const { service, state } = fixture();
  await service.readForgeImage(request);
  state.secret = "synthetic-rotated";
  await service.readForgeImage(request);
  state.username = "synthetic-other-user";
  await service.readForgeImage(request);
  assert.equal(state.reads.length, 3);
  state.missing = true;
  await assert.rejects(service.readForgeImage(request), /FORGE_MISSING_ACCOUNT/);
  state.missing = false;
  state.changed = true;
  await assert.rejects(service.readForgeImage(request), /FORGE_TARGET_CHANGED/);
  assert.equal(state.reads.length, 3);
});

test("credentials changed during a pending read reject and do not populate the cache", async () => {
  const { service, state } = fixture();
  let release!: () => void;
  state.pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = service.readForgeImage(request);
  const rejected = assert.rejects(reading, /FORGE_TARGET_CHANGED/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  state.secret = "synthetic-new-secret";
  release();
  await rejected;
  state.pause = null;
  state.secret = "synthetic-secret";
  await service.readForgeImage(request);
  assert.equal(state.reads.length, 2);
});

test("explicit successful image authentication invalidates its cached content", async () => {
  const { service, state } = fixture();
  await service.readForgeImage(request);
  await service.authenticateForgeImage(request);
  await service.readForgeImage(request);
  assert.equal(state.reads.length, 2);
});

test("raster cache evicts least recently used entries and enforces encoded byte budget", async () => {
  const cache = new ForgeImageCache(2, 2 * preview.dataBase64.length);
  const loaded: string[] = [];
  const read = (key: string) =>
    cache.read(key, async () => {
      loaded.push(key);
      return preview;
    });
  await read("a");
  await read("b");
  await read("a");
  await read("c");
  await read("b");
  assert.deepEqual(loaded, ["a", "b", "c", "b"]);
  const small = new ForgeImageCache(32, preview.dataBase64.length);
  let count = 0;
  const load = async () => {
    count++;
    return preview;
  };
  await small.read("a", load);
  await small.read("b", load);
  await small.read("a", load);
  assert.equal(count, 3, "byte budget evicts even below entry budget");
  const oversized = new ForgeImageCache(2, preview.dataBase64.length - 1);
  await oversized.read("a", load);
  await oversized.read("a", load);
  assert.equal(count, 5, "oversized results are returned but never retained");
});

test("invalidating a pending cache read never retains its late result", async () => {
  const cache = new ForgeImageCache();
  let release!: (image: ForgeImagePreview) => void;
  const old = cache.read(
    "image",
    () =>
      new Promise<ForgeImagePreview>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  cache.forget("image");
  const newImage = { ...preview, dataBase64: "AA==", totalBytes: 1 };
  await cache.read("image", async () => newImage);
  release(preview);
  await old;
  assert.deepEqual(
    await cache.read("image", async () => {
      throw new Error("must be cached");
    }),
    newImage,
  );
});

test("Host GitService shares the same download cache across repeated task/detail calls", async () => {
  const account: PrivateGitAccount = {
    id: request.accountId,
    provider: "github",
    serverUrl: "https://github.com",
    username: "synthetic-user",
    secret: "synthetic-token",
    scopes: [],
    avatarUrl: null,
    isDefault: true,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const state = {
    remote: "https://github.com/team/project.git",
    accounts: [account],
    downloads: [] as string[],
  };
  const service = createForgeService({
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
      async run(input) {
        return {
          exitCode: 0,
          stdout: input.args.length === 1 ? "origin\n" : state.remote,
          stderr: "",
          timedOut: false,
          durationMs: 0,
          binaryPath: "/synthetic/git",
          cwd: input.cwd,
          args: input.args,
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
    fetcher: (async (url) => {
      state.downloads.push(String(url));
      return new Response(Buffer.from(preview.dataBase64, "base64"), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch,
  });
  const info = await service.getForgeRepository({ workspacePath: request.workspacePath });
  assert.ok(info.repository);
  const input = { ...request, repositoryKey: info.repository.key };
  await service.readForgeImage(input);
  await service.readForgeImage(input);
  const newInput = { ...input, url: input.url.replace(/abc$/, "abd") };
  await Promise.all([service.readForgeImage(newInput), service.readForgeImage(newInput)]);
  await service.readForgeImage(input);
  assert.deepEqual(state.downloads, [input.url, newInput.url]);
  account.secret = "synthetic-rotated-token";
  await service.readForgeImage(input);
  assert.equal(state.downloads.length, 3);
  state.accounts = [];
  await assert.rejects(service.readForgeImage(input), /FORGE_MISSING_ACCOUNT/);
  assert.equal(state.downloads.length, 3);
});
