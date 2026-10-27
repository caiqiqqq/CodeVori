import assert from "node:assert/strict";
import test from "node:test";
import {
  groupItemsByCategory,
  sortPersonalMarketplaceItems,
  type StorePluginItem,
} from "../src/settings/pluginStoreListing.ts";

function item(name: string, installed: boolean, marketplace = "personal"): StorePluginItem {
  return {
    id: `${name}@${marketplace}`,
    name,
    marketplace,
    installed,
    restorable: false,
    orphaned: false,
  };
}

test("category groups put installed items first without changing group order", () => {
  const grouped = groupItemsByCategory(
    [item("Alpha", false), item("Zulu", true), item("Bravo", false)],
    "en-US",
  );
  assert.deepEqual(
    grouped.map((group) => group.category),
    ["other"],
  );
  assert.deepEqual(
    grouped[0]?.items.map((entry) => entry.name),
    ["Zulu", "Alpha", "Bravo"],
  );
});

test("personal marketplace list puts installed items before name sort", () => {
  assert.deepEqual(
    sortPersonalMarketplaceItems([item("Alpha", false), item("Zulu", true)], "en-US").map(
      (entry) => entry.name,
    ),
    ["Zulu", "Alpha"],
  );
});
