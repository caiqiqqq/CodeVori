import assert from "node:assert/strict";
import test from "node:test";
import { shouldSuppressChatErrorBanner } from "../src/ChatErrorBanner.js";

test("missing-model codes do not display the chat upgrade/configure banner", () => {
  for (const code of ["model_config_missing", "MODEL_CONFIG_MISSING", "ModelConfigMissing"]) {
    assert.equal(shouldSuppressChatErrorBanner({ code, message: "No model configured" }), true);
  }
});

test("other current errors remain visible even if their message mentions a model", () => {
  assert.equal(
    shouldSuppressChatErrorBanner({ code: "SEND_FAILED", message: "No model configured" }),
    false,
  );
  assert.equal(
    shouldSuppressChatErrorBanner({ code: "ZCODE_RUNTIME_MODEL_UNAVAILABLE", message: "Oops" }),
    false,
  );
});

test("historical unavailable-model recovery messages stay suppressed", () => {
  assert.equal(
    shouldSuppressChatErrorBanner({
      code: "ZCODE_RUNTIME_MODEL_UNAVAILABLE",
      message: "历史任务使用的模型已不可用",
    }),
    true,
  );
});
