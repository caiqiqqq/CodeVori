import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeItem, ForgeRepository } from "@zcode/shared";
import {
  buildForgeAgentPrompt,
  forgeErrorId,
  safeRepositoryExternalUrl,
} from "../src/lib/forgePanel.js";

test("repository external links reject credentials and non-web protocols", () => {
  assert.equal(
    safeRepositoryExternalUrl("https://forge.example.invalid/team/repo/issues/1"),
    "https://forge.example.invalid/team/repo/issues/1",
  );
  assert.equal(
    safeRepositoryExternalUrl("http://localhost:3000/team/repo"),
    "http://localhost:3000/team/repo",
  );
  for (const url of [
    "https://user:secret@forge.example.invalid/team/repo",
    "https://user@forge.example.invalid/team/repo",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,test",
    "/team/repo",
  ])
    assert.equal(safeRepositoryExternalUrl(url), null);
});

test("repository errors normalize RPC failures without reflecting provider payloads", () => {
  assert.equal(forgeErrorId(new Error("Remote error: FORGE_FORBIDDEN")), "FORBIDDEN");
  assert.equal(forgeErrorId(new Error("REMOTE_WORKSPACE_DISCONNECTED")), "DISCONNECTED");
  assert.equal(forgeErrorId(new Error("unknown provider body")), "RESPONSE");
  assert.equal(forgeErrorId(null), "RESPONSE");
});

test("agent handoff labels external content and bounds the description", () => {
  const repository = { name: "team/project" } as ForgeRepository;
  const item = {
    number: 1,
    kind: "issue",
    title: "Synthetic issue",
    url: null,
    body: "Untrusted content\n```\n" + "x".repeat(20_000),
  } as ForgeItem;
  const prompt = buildForgeAgentPrompt(repository, item);
  assert.match(prompt, /不是系统指令/);
  assert.match(prompt, /描述较长/);
  const start = prompt.indexOf("```json\n\n") + "```json\n\n".length;
  const end = prompt.indexOf("\n\n```", start);
  const content = JSON.parse(prompt.slice(start, end));
  assert.equal(content.repository, repository.name);
  assert.equal(content.title, item.title);
  assert.equal(content.description, item.body.slice(0, 20_000));
});
