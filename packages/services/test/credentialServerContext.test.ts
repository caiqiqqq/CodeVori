import assert from "node:assert/strict";
import test from "node:test";
import { credentialServerPromptContext } from "../src/credential/credentialServerContext.js";

test("ACP server context contains only saved SSH connection details", () => {
  const context = credentialServerPromptContext([
    {
      name: "Staging host",
      environment: "staging",
      host: "server.example.invalid",
      port: 2222,
      username: "deploy",
    },
  ]);

  assert.match(context, /Staging host \(staging\); deploy@server\.example\.invalid:2222/);
  assert.match(context, /credentials are not included/i);
  assert.doesNotMatch(
    context,
    /zai-oauth|bigmodel-oauth|codevori-account|account-provider-api-keys|bot-integration-credentials|password|private-key-passphrase/i,
  );
});
