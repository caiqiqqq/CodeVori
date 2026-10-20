import type { EnterpriseCodingPlanPricingProduct, ProviderFamilyDomain } from "@zcode/shared";

export type EnterpriseCodingPlanProductDisplay = EnterpriseCodingPlanPricingProduct & {
  productName: string;
  productBigTitle: string;
  family?: ProviderFamilyDomain;
};

/** 旧商品缺少 family 时只在这一规范化边界解释为 BigModel。 */
export function resolveEnterpriseCodingPlanProductFamily(
  product: Pick<EnterpriseCodingPlanProductDisplay, "family">,
): ProviderFamilyDomain {
  return product.family ?? "bigmodel";
}

/** 仅把供应商确认已订阅的团队套餐投影成连接入口。 */
export function resolveEnterpriseCodingPlanProductList(
  products: EnterpriseCodingPlanPricingProduct[],
): EnterpriseCodingPlanProductDisplay[] {
  return products
    .filter((product) => product.subscribed === true)
    .map((product) => {
      const tier = product.tier.trim();
      const name = tier ? tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase() : tier;
      return { ...product, productName: name, productBigTitle: name };
    });
}
