import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOOLS } from "../src/tool-definitions.mjs";

const official = JSON.parse(
  await readFile(new URL("../fixtures/official/tools-0.5.12.json", import.meta.url)),
).tools;

function contract(value) {
  if (Array.isArray(value)) return value.map(contract);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !["$schema", "description"].includes(key))
      .sort()
      .map((key) => [key, contract(value[key])]),
  );
}

test("the open server exposes every official 0.5.12 tool", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), official.map((tool) => tool.name));
});

test("complete input-schema contracts match 0.5.12", () => {
  assert.deepEqual(
    TOOLS.map((tool) => contract(tool.inputSchema)),
    official.map((tool) => contract(tool.inputSchema)),
  );
});

test("closed strategy and return-state enums match the official contract", () => {
  for (const tool of TOOLS) {
    const officialTool = official.find((candidate) => candidate.name === tool.name);
    for (const property of ["strategy", "return_state"]) {
      const expected = officialTool.inputSchema?.properties?.[property]?.enum;
      if (!expected) continue;
      assert.deepEqual(tool.inputSchema.properties[property].enum, expected, `${tool.name}.${property}`);
    }
  }
});
