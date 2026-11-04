import assert from "node:assert/strict";
import test from "node:test";
import {
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
  type OfficialMcpCredentialResolverDeps,
} from "../src/official-mcp/officialMcpCredentials.js";

function fixture(
  options: { active?: string; family?: string; access?: unknown; maas?: string } = {},
) {
  const loads: string[] = [];
  const values: Record<string, string> = {
    "oauth:active_provider": options.active ?? "bigmodel",
    zcodejwttoken: "fixture-login",
    "oauth:bigmodel:access_token": options.maas ?? "fixture-maas",
  };
  const deps = {
    credentialService: {
      load: async (key: string) => {
        loads.push(key);
        return values[key];
      },
    },
    accountRequestAuthService: { resolveAccessCurrent: async () => options.access ?? null },
    modelSelectionService: {
      getView: async () => ({
        revision: 1,
        providers: [
          {
            providerId: "plan",
            config: {
              access: {
                type: "zhipu-account",
                accountType: options.family ?? "bigmodel",
                mode: "individual-coding-plan",
                entitled: true,
              },
            },
          },
        ],
      }),
    },
  } as unknown as OfficialMcpCredentialResolverDeps;
  return { deps, loads };
}

test("plugin commands may use login-only identity but MCP retains the selected-plan gate", async () => {
  const { deps } = fixture();
  const resolver = createOfficialMcpAuthHeadersResolver(deps);
  const request = {
    mcpKey: "sites",
    pluginId: "zcode-site",
    targetOrigin: "https://example.invalid",
    workspace: { workspaceKey: "/w", workspacePath: "/w" },
  };
  const [optional, required] = await Promise.all([
    resolver.resolveHeaders({ ...request, consumer: "plugin-command" }),
    resolver.resolveHeaders(request),
  ]);
  assert.deepEqual(optional, { ok: true, headers: { Authorization: "Bearer fixture-login" } });
  assert.deepEqual(required, { ok: false, reason: "official_auth_plan_required" });
});

test("optional plan does not downgrade a cross-family selection or access", async () => {
  for (const options of [
    { active: "zai", family: "bigmodel" },
    { access: { family: "zai", planKind: "individual-coding-plan" } },
  ]) {
    const { deps } = fixture(options);
    assert.deepEqual(await resolveOfficialMcpCredentials(deps, { planOptional: true }), {
      ok: false,
      reason: "official_auth_unavailable",
    });
  }
});

test("valid plans require their exact MaaS JWT; optional commands never fall back to another family", async () => {
  const access = { family: "bigmodel", planKind: "individual-coding-plan" };
  const { deps, loads } = fixture({ access });
  const result = await resolveOfficialMcpCredentials(deps, { planOptional: true });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.codingPlanAuthorization, "fixture-maas");
  assert.equal(loads.includes("oauth:zai:access_token"), false);
  assert.deepEqual(
    await resolveOfficialMcpCredentials(fixture({ access, maas: "" }).deps, { planOptional: true }),
    { ok: false, reason: "official_auth_unavailable" },
  );
});
