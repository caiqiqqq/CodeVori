import assert from "node:assert/strict";
import test from "node:test";
import { resolveDynamicWorkflowClientConfig, ZCODE_DYNAMIC_WORKFLOW_MODE_ENV } from "@zcode/shared";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";

test("workflow availability is local even when the upstream configuration disables it", async () => {
  const previous = process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV];
  delete process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV];
  let requests = 0;
  let credentials = 0;
  try {
    const service = createCodingPlanSubscriptionService({
      apiClient: {
        request: async () => {
          requests++;
          return Response.json({ data: { configs: { dynamicWorkflow: { mode: "disabled" } } } });
        },
      },
      credentialService: {
        load: async () => {
          credentials++;
          return undefined;
        },
      },
    });
    for (const options of [undefined, { forceRefresh: true }]) {
      assert.deepEqual(await service.getDynamicWorkflowClientConfig(options), {
        mode: "alwaysOn",
        enabled: true,
        source: "default",
      });
    }
    process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV] = "disabled";
    assert.deepEqual(await service.getDynamicWorkflowClientConfig(), {
      mode: "disabled",
      enabled: false,
      source: "override",
    });
    assert.equal(requests, 0, "workflow capability must not depend on network access");
    assert.equal(credentials, 0, "workflow capability must not require an account");
  } finally {
    if (previous === undefined) delete process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV];
    else process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV] = previous;
  }
});

test("local workflow policy normalizes explicit overrides and defaults invalid values to enabled", () => {
  for (const mode of [undefined, "invalid", "", "alwaysOn", " onDemand ", "disabled"]) {
    const valid = mode?.trim();
    const override = valid === "alwaysOn" || valid === "onDemand" || valid === "disabled";
    assert.deepEqual(
      resolveDynamicWorkflowClientConfig({
        env: mode === undefined ? {} : { [ZCODE_DYNAMIC_WORKFLOW_MODE_ENV]: mode },
      }),
      {
        mode: override ? valid : "alwaysOn",
        enabled: valid !== "disabled",
        source: override ? "override" : "default",
      },
    );
  }
});
