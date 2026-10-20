import assert from "node:assert/strict";

export async function assertYellowWaitingIndicator(indicator, theme) {
  const presentation = await indicator.evaluate((el, theme) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-yellow-${theme === "dark" ? "300" : "600"})`;
    el.parentElement.append(probe);
    const style = getComputedStyle(el);
    const backplate = getComputedStyle(el.parentElement);
    const title = el
      .closest("li")
      .querySelector('[data-task-title-copy="original"], p[title], span[title]');
    const result = {
      color: style.color,
      yellow: getComputedStyle(probe).color,
      size: [style.width, style.height],
      strokeWidth: el.getAttribute("stroke-width"),
      animation: style.animationName,
      backplateSize: [backplate.width, backplate.height],
      shadow: backplate.boxShadow,
      right: el.parentElement.getBoundingClientRect().right + 2,
      titleLeft: title?.getBoundingClientRect().left,
    };
    probe.remove();
    return result;
  }, theme);
  assert.equal(presentation.color, presentation.yellow, "Waiting response spinner must be yellow");
  assert.deepEqual(presentation.size, ["10px", "10px"], "Waiting circle must stay compact");
  assert.equal(presentation.strokeWidth, "3", "Waiting circle needs a stronger stroke");
  assert.equal(presentation.animation, "spin", "Waiting circle must keep rotating");
  assert.deepEqual(presentation.backplateSize, ["10px", "10px"]);
  assert.notEqual(presentation.shadow, "none", "Backplate must separate the circle from the brand");
  assert.ok(
    presentation.right <= presentation.titleLeft,
    "Waiting circle and its backplate must not cover the title",
  );
}
