import assert from "node:assert/strict";
import test from "node:test";
import zhCN from "../src/i18n/locales/zh-CN.ts";
import { acpErrorMessageId } from "../src/v4/acpErrorMessage.ts";

const missingQoderCredentials = "Authentication required: Authentication is required.";

test("Qoder missing-credentials error uses the requested Chinese copy", () => {
  const key = acpErrorMessageId("qoder", missingQoderCredentials);
  assert.equal(key, "acp.qoderCredentialsMissing");
  assert.equal(
    zhCN[key!],
    "Qoder 无法建立会话：没有可用的登录凭据。请在 设置 → 智能体 → Qoder 中重新登录，然后重新打开该会话。",
  );
});

test("other Qoder errors retain their original message", () => {
  assert.equal(acpErrorMessageId("qoder", "Authentication required: Token expired."), null);
  assert.equal(acpErrorMessageId("qoder", "Network connection failed"), null);
});

test("other ACP agents retain their authentication error", () => {
  assert.equal(acpErrorMessageId("claude", missingQoderCredentials), null);
  assert.equal(acpErrorMessageId("codex", missingQoderCredentials), null);
});
