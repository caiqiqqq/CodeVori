import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

test("the app does not mount a Coding Plan checkout or offer one in model settings", () => {
  assert.doesNotMatch(source("Root.tsx"), /CodingPlanUpgradeDialogProvider/);
  assert.doesNotMatch(
    source("settings/model-provider-section/Detail.tsx"),
    /CodingPlanPurchaseChoiceBanners|openCodingPlanUpgrade/,
  );
  assert.doesNotMatch(
    source("settings/model-provider-section/StatusCards.tsx"),
    /CodingPlanUpgradeAction|CodingPlanEntryButton|onOpenPurchase/,
  );
  assert.match(source("settings/model-provider-section/Detail.tsx"), /InlineEditableProviderCard/);
  assert.match(source("settings/model-provider-section/StatusCards.tsx"), /CodingPlanStatusMeta/);
});

test("quota and off-peak notices retain status without a purchase command", () => {
  assert.doesNotMatch(source("v4/SessionPane.tsx"), /openCodingPlanUpgrade|handleOpenQuotaUpgrade/);
  assert.doesNotMatch(source("v4/composer/V4ComposerToolbar.tsx"), /handleOpenStartPlanUpgrade/);
  assert.doesNotMatch(source("settings/AutomationsSection.tsx"), /handleOpenCodingPlanUpgrade/);
  assert.match(source("settings/AutomationsSection.tsx"), /showCodingPlanRequiredToast/);
});
