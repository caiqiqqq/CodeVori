import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnterpriseCodingPlanProductList } from "../src/settings/model-provider-section/enterpriseCodingPlanProducts.js";

test("team navigation uses only subscribed provider products, including an existing project", () => {
  const products = resolveEnterpriseCodingPlanProductList([
    {
      productId: "unsold",
      tier: "LITE",
      subscribeMode: "CONTINUOUS",
      subscribePeriod: "MONTHLY",
      subscribed: false,
    },
    {
      productId: "existing",
      tier: "PRO",
      subscribeMode: "ONE_TIME",
      subscribePeriod: "YEARLY",
      subscribed: true,
      organizationId: "org",
      projectId: "project",
    },
  ]);

  assert.deepEqual(
    products.map((product) => product.productId),
    ["existing"],
  );
  assert.equal(products[0]?.projectId, "project");
  assert.equal(products[0]?.productName, "Pro");
});

test("an empty or unavailable entitlement list does not produce a sales card", () => {
  assert.deepEqual(resolveEnterpriseCodingPlanProductList([]), []);
});
