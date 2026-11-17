/** Industries that have their own designed storefront page. Each new design is added here. */
export const isFoodIndustry = (name: string) => /food|grocer|grain|beverage|drink|rice|sugar|flour|snack|dairy|bakery/i.test(name);

/** Where an industry's own storefront lives, or null when it only has the shared shop. */
export function storefrontPath(i: { id: string; name: string; storefront?: string }): string | null {
  if (i.storefront === "fashion") return "/clothing";
  if (isFoodIndustry(i.name)) return `/industry/${i.id}`;
  return null;
}
