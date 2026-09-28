import assert from "node:assert/strict";
import test from "node:test";
import { BigModelCodingPlanSubscriptionProvider } from "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js";

test("an in-flight team entitlement read uses one account for pricing and project keys", async () => {
  let accessToken = "account-a-token";
  let releasePricing: (() => void) | undefined;
  const pricingCanFinish = new Promise<void>((resolve) => {
    releasePricing = resolve;
  });
  let pricingStarted: (() => void) | undefined;
  const pricingDidStart = new Promise<void>((resolve) => {
    pricingStarted = resolve;
  });
  const authorizations: string[] = [];
  const provider = new BigModelCodingPlanSubscriptionProvider({
    credentialService: {
      load: async (key) => (key === "oauth:bigmodel:access_token" ? accessToken : undefined),
    },
    apiClient: {
      request: async (input, init) => {
        const url = String(input);
        authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
        if (url.endsWith("/subscription/enterprise/v2/pricing")) {
          pricingStarted?.();
          await pricingCanFinish;
          return Response.json({
            code: 200,
            data: {
              productList: [
                {
                  productId: "team-plan",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                  organizationId: "org-a",
                  projectId: "project-a",
                },
              ],
            },
          });
        }
        assert.match(url, /\/organization\/org-a\/projects\/project-a\/api_keys$/);
        return Response.json({
          code: 0,
          data: [{ apiKey: "test-key", keyType: 2, name: "zcode-team-api-key" }],
        });
      },
    },
  });

  const reading = provider.getEnterprisePricing();
  await pricingDidStart;
  accessToken = "account-b-token";
  releasePricing?.();
  const result = await reading;

  assert.equal(result.productList[0]?.organizationId, "org-a");
  assert.deepEqual(authorizations, ["account-a-token", "account-a-token"]);
});

test("team project discovery also keeps the account used for pricing", async () => {
  let accessToken = "account-a-token";
  let releasePricing: (() => void) | undefined;
  const pricingCanFinish = new Promise<void>((resolve) => {
    releasePricing = resolve;
  });
  let pricingStarted: (() => void) | undefined;
  const pricingDidStart = new Promise<void>((resolve) => {
    pricingStarted = resolve;
  });
  const authorizations: string[] = [];
  const provider = new BigModelCodingPlanSubscriptionProvider({
    credentialService: {
      load: async (key) => (key === "oauth:bigmodel:access_token" ? accessToken : undefined),
    },
    apiClient: {
      request: async (input, init) => {
        const url = String(input);
        authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
        if (url.endsWith("/subscription/enterprise/v2/pricing")) {
          pricingStarted?.();
          await pricingCanFinish;
          return Response.json({
            code: 200,
            data: {
              productList: [
                {
                  productId: "team-plan",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/customer/getCustomerInfo")) {
          return Response.json({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-a",
                  projects: [{ projectId: "project-a", projectType: 2 }],
                },
              ],
            },
          });
        }
        assert.match(url, /\/organization\/org-a\/projects\/project-a\/api_keys$/);
        return Response.json({
          code: 0,
          data: [{ apiKey: "test-key", keyType: 2, name: "zcode-team-api-key" }],
        });
      },
    },
  });

  const reading = provider.getEnterprisePricing();
  await pricingDidStart;
  accessToken = "account-b-token";
  releasePricing?.();
  const result = await reading;

  assert.equal(result.productList[0]?.projectId, "project-a");
  assert.deepEqual(authorizations, ["account-a-token", "account-a-token", "account-a-token"]);
});
