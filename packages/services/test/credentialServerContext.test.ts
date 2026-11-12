import assert from "node:assert/strict";
import test from "node:test";
import { credentialPromptContext } from "../src/credential/credentialContext.js";

test("ACP credential context includes custom credential types but no secret values", () => {
  const context = credentialPromptContext([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "测试服务器",
      kind: "测试服务器",
      environment: "staging",
      host: "server.example.invalid",
      port: 2222,
      username: "deploy",
    },
  ]);

  assert.match(context, /"name":"测试服务器"/);
  assert.match(context, /"kind":"测试服务器"/);
  assert.match(context, /"host":"server\.example\.invalid"/);
  assert.match(context, /ReadCredentialSecret/);
  assert.match(context, /secret values are not included/i);
  assert.doesNotMatch(
    context,
    /zai-oauth|bigmodel-oauth|codevori-account|account-provider-api-keys|bot-integration-credentials|password|private-key-passphrase/i,
  );
});
