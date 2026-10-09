import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompactTokenNumber,
  formatContextTokenNumber,
} from "../src/lib/tokenNumberFormat.ts";

test("context Token counts match Codeg's decimal K/M notation in both locales", () => {
  const cases = [
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [1500, "1.5K"],
    [999999, "1000K"],
    [1000000, "1M"],
    [1250000, "1.3M"],
    [181000, "181K"],
    [260000, "260K"],
    [70997350, "71M"],
    [326330, "326.3K"],
    [67434971, "67.4M"],
    [71323680, "71.3M"],
    [1000000000, "1000M"],
  ] as const;
  for (const locale of ["zh-CN", "en-US"]) {
    for (const [value, expected] of cases) {
      assert.equal(formatContextTokenNumber(value, locale), expected);
    }
  }
});

test("other compact count surfaces retain localized units", () => {
  assert.equal(formatCompactTokenNumber("zh-CN", 181000), "18.1万");
  assert.equal(formatCompactTokenNumber("en-US", 181000), "181K");
});
