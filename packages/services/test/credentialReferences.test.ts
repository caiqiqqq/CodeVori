import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialReferencePromptContext,
  projectCredentialReferences,
} from "../src/credential/credentialReferences.js";

test("credential references expose allowlisted aliases and hide storage keys", () => {
  const keys = [
    "oauth:zai:access_token",
    "oauth:zai:refresh_token",
    "account-provider:openai:account:private-user-id:api-key",
    "remote-workspace:private-workspace-id:password",
    "bot:private-bot-id:webhook-secret",
    "custom:private-integration:secret",
  ];

  const snapshot = projectCredentialReferences(keys);
  const serialized = JSON.stringify(snapshot);
  assert.deepEqual(
    snapshot.references.map(({ alias }) => alias),
    [
      "zai-oauth",
      "account-provider-api-keys",
      "ssh-workspace-credentials",
      "bot-integration-credentials",
    ],
  );
  assert.equal(snapshot.references[0]?.storedCredentialCount, 1);
  assert.equal(snapshot.references[1]?.storedCredentialCount, 1);
  assert.equal(snapshot.references[2]?.storedCredentialCount, 1);
  assert.equal(snapshot.references[3]?.storedCredentialCount, 1);
  assert.equal(snapshot.otherStoredCredentialCount, 1);
  for (const key of keys) assert.equal(serialized.includes(key), false);

  const context = credentialReferencePromptContext(snapshot);
  assert.match(context, /zai-oauth/);
  assert.match(context, /do not request or expose credential values/i);
  for (const key of keys) assert.equal(context.includes(key), false);
});

test("credential references report an empty store without guessing validity", () => {
  assert.deepEqual(projectCredentialReferences([]), {
    references: [],
    otherStoredCredentialCount: 0,
  });
  assert.match(
    credentialReferencePromptContext({ references: [], otherStoredCredentialCount: 0 }),
    /No known Host credential references are currently stored/,
  );
});
