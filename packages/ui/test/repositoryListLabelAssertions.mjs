import assert from "node:assert/strict";

export async function assertRepositoryListLabelColors(row) {
  const target = row();
  await target.getByText("优化", { exact: true }).waitFor();
  assert.deepEqual(
    await target
      .locator("span[style]")
      .evaluateAll((nodes) => nodes.map((node) => node.style.backgroundColor)),
    ["rgb(215, 58, 74)", "rgb(238, 230, 0)"],
    "List keeps native label colors, including labels absent from the filter catalog",
  );
}
