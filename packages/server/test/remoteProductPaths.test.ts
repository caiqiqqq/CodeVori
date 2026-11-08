import assert from "node:assert/strict";
import test from "node:test";
import { REMOTE_BASE } from "../src/remote/deployShared.ts";
import { buildRemoteAgentBundleWrapper } from "../src/remote/zcodeAgentBundleWrapper.ts";
import { getZCodeAgentRuntime } from "@zcode/shared";

test("remote CodeVori deploy and agent wrapper use an isolated root", () => {
  assert.equal(REMOTE_BASE, "~/.codevori/server");
  const wrapper = buildRemoteAgentBundleWrapper("glm");
  assert.match(wrapper, /\$HOME\/\.codevori\/server/u);
  assert.match(wrapper, /\$runtime_root\/agents\/glm\/codevori\.cjs/u);
  assert.doesNotMatch(wrapper, /\.zcode\/server/u);
  assert.equal(getZCodeAgentRuntime().nodeBundleEntryFile, "codevori.cjs");
  assert.deepEqual(getZCodeAgentRuntime().resolveEntrySegments("linux"), ["codevori-agent"]);
});
