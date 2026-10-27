import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "@zcode/shared";
import {
  AccountRequestCredentialUnavailableError,
  createAccountProviderRequestAuthService,
} from "../src/model-provider/accountProviderRequestAuthService.ts";
import { createAccountProviderCredentialService } from "../src/model-provider/accountProviderCredentialService.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(planKind: ZCodeAccountAccess["planKind"] = "individual-coding-plan") {
  const state = {
    access: {
      type: "zhipu-account",
      family: "zai",
      planKind,
      ...(planKind === "team-coding-plan"
        ? { organizationId: "org", projectId: "project", productId: "product" }
        : {}),
    } as ZCodeAccountAccess | null,
    login: { accessToken: "synthetic-login-A", zcodeJwtToken: "synthetic-jwt-A" },
  };
  const key = deferred<string | null>();
  const started = deferred<void>();
  const loadKey = () => {
    started.resolve();
    return key.promise;
  };
  const service = createAccountProviderRequestAuthService({
    resolveCurrentAccountAccess: async () => structuredClone(state.access),
    loadOAuthTokenSet: async () => ({ ...state.login }),
    loadIndividualPlanApiKey: loadKey,
    resolveTeamPlanApiKey: loadKey,
  });
  const access: ZCodeProviderAccountAccess = {
    type: "zhipu-account",
    accountType: "zai",
    mode: planKind,
    entitled: true,
  };
  const input = { providerId: "fixture", accountAccess: access, reason: "model-request" as const };
  return { state, key, started, service, input };
}

for (const planKind of ["start-plan", "individual-coding-plan", "team-coding-plan"] as const) {
  test(`${planKind}: stable static and resolved access return usable material`, async () => {
    const f = fixture(planKind);
    f.key.resolve("synthetic-key");
    const expected = planKind === "start-plan" ? "synthetic-jwt-A" : "synthetic-key";
    assert.equal((await f.service.resolveCurrent(f.input)).apiKey, expected);
    assert.equal(
      (
        await f.service.resolveCurrent({
          ...f.input,
          accountAccess: structuredClone(f.state.access!),
          reason: "usage",
        })
      ).apiKey,
      expected,
    );
    await f.service.assertCurrent({ ...f.input, accountAccess: f.state.access! });
  });
}

for (const planKind of ["individual-coding-plan", "team-coding-plan"] as const) {
  test(`${planKind}: logout during key IO rejects late material`, async () => {
    const f = fixture(planKind);
    const pending = f.service.resolveCurrent(f.input);
    const rejected = assert.rejects(pending, AccountRequestCredentialUnavailableError);
    await f.started.promise;
    f.state.access = null;
    f.key.resolve("synthetic-key");
    await rejected;
  });
}

test("account credential change during IO rejects old request while new requests succeed", async () => {
  const f = fixture();
  const pending = f.service.resolveCurrent(f.input);
  const rejected = assert.rejects(pending, AccountRequestCredentialUnavailableError);
  await f.started.promise;
  f.state.login = { accessToken: "synthetic-login-B", zcodeJwtToken: "synthetic-jwt-B" };
  f.key.resolve("synthetic-key");
  await rejected;
  assert.equal((await f.service.resolveCurrent(f.input)).apiKey, "synthetic-key");
});

test("switching Team project during IO rejects material from previous project", async () => {
  const f = fixture("team-coding-plan");
  const pending = f.service.resolveCurrent(f.input);
  const rejected = assert.rejects(pending, AccountRequestCredentialUnavailableError);
  await f.started.promise;
  assert.equal(f.state.access?.planKind, "team-coding-plan");
  f.state.access = { ...f.state.access!, projectId: "other-project" } as ZCodeAccountAccess;
  f.key.resolve("synthetic-team-key");
  await rejected;
});

test("resolved access snapshot cannot bypass current connection validation", async () => {
  const f = fixture("team-coding-plan");
  const accountAccess = structuredClone(f.state.access!);
  f.state.access = null;
  await assert.rejects(
    f.service.assertCurrent({ ...f.input, accountAccess }),
    AccountRequestCredentialUnavailableError,
  );
  await assert.rejects(
    f.service.resolveCurrent({ ...f.input, accountAccess }),
    AccountRequestCredentialUnavailableError,
  );
});

test("resolved Team snapshot cannot retarget another current project", async () => {
  const f = fixture("team-coding-plan");
  const accountAccess = structuredClone(f.state.access!);
  f.state.access = { ...f.state.access!, projectId: "other-project" } as ZCodeAccountAccess;
  await assert.rejects(
    f.service.assertCurrent({ ...f.input, accountAccess }),
    AccountRequestCredentialUnavailableError,
  );
});

test("off-peak credential resolution rejects a changed selected plan", async () => {
  const f = fixture();
  f.input.accountAccess.mode = "off-peak";
  const pending = f.service.resolveCurrent({ ...f.input, reason: "off-peak" });
  const rejected = assert.rejects(pending, AccountRequestCredentialUnavailableError);
  await f.started.promise;
  f.state.access = { type: "zhipu-account", family: "zai", planKind: "start-plan" };
  f.key.resolve("synthetic-key");
  await rejected;
});

test("Start Plan rejects JWT read that finishes after logout", async () => {
  const f = fixture("start-plan");
  const tokenRead = deferred<{ zcodeJwtToken: string }>();
  const started = deferred<void>();
  let reads = 0;
  const service = createAccountProviderRequestAuthService({
    resolveCurrentAccountAccess: async () => f.state.access,
    loadOAuthTokenSet: async () => {
      if (++reads === 1) {
        started.resolve();
        return tokenRead.promise;
      }
      return null;
    },
    loadIndividualPlanApiKey: async () => null,
    resolveTeamPlanApiKey: async () => null,
  });
  const pending = service.resolveCurrent(f.input);
  const rejected = assert.rejects(pending, AccountRequestCredentialUnavailableError);
  await started.promise;
  f.state.access = null;
  tokenRead.resolve({ zcodeJwtToken: "synthetic-jwt" });
  await rejected;
});

test("cold-cache parallel and consecutive personal requests share credential IO", async () => {
  const f = fixture();
  const cache = new Map<string, string>();
  let remoteCalls = 0;
  const credential = createAccountProviderCredentialService({
    credentialStore: {
      loadApiKey: async (key) => cache.get(key) ?? null,
      saveApiKey: async (key, value) => {
        cache.set(key, value);
      },
      deleteApiKey: async (key) => {
        cache.delete(key);
      },
    },
    loadOAuthAccessToken: async () => f.state.login.accessToken,
    resolveProviderApiKey: async () => {
      remoteCalls++;
      f.started.resolve();
      return f.key.promise;
    },
  });
  const service = createAccountProviderRequestAuthService({
    resolveCurrentAccountAccess: async () => structuredClone(f.state.access),
    loadOAuthTokenSet: async () => ({ ...f.state.login }),
    loadIndividualPlanApiKey: (providerId, family) =>
      credential.loadCodingPlanApiKey({
        providerId,
        family,
        accountIdentity: "synthetic-account",
      }),
    resolveTeamPlanApiKey: async () => null,
  });
  const requests = Array.from({ length: 16 }, () => service.resolveCurrent(f.input));
  await f.started.promise;
  f.key.resolve("synthetic-shared-key");
  assert.deepEqual(
    await Promise.all(requests),
    Array.from({ length: 16 }, () => ({ apiKey: "synthetic-shared-key" })),
  );
  for (let i = 0; i < 8; i++)
    assert.equal((await service.resolveCurrent(f.input)).apiKey, "synthetic-shared-key");
  assert.equal(remoteCalls, 1);
});

test("one failed request does not poison concurrent or subsequent calls", async () => {
  const f = fixture();
  let calls = 0;
  const service = createAccountProviderRequestAuthService({
    resolveCurrentAccountAccess: async () => structuredClone(f.state.access),
    loadOAuthTokenSet: async () => ({ ...f.state.login }),
    loadIndividualPlanApiKey: async () => {
      if (++calls === 1) throw new Error("synthetic key lookup failure");
      return "synthetic-key";
    },
    resolveTeamPlanApiKey: async () => null,
  });
  const outcomes = await Promise.allSettled([
    service.resolveCurrent(f.input),
    service.resolveCurrent(f.input),
  ]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal((await service.resolveCurrent(f.input)).apiKey, "synthetic-key");
});
