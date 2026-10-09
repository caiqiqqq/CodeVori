import assert from "node:assert/strict";

export async function assertYellowWaitingIndicator(indicator, theme) {
  const colors = await indicator.evaluate((el, theme) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-yellow-${theme === "dark" ? "300" : "600"})`;
    el.parentElement.append(probe);
    const result = [getComputedStyle(el).color, getComputedStyle(probe).color];
    probe.remove();
    return result;
  }, theme);
  assert.equal(colors[0], colors[1], "Waiting response spinner must be yellow");
}
