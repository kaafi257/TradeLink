/** Industries that have their own designed storefront page. Each new design is added here. */
export const isFoodIndustry = (name: string) => /food|grocer|grain|beverage|drink|rice|sugar|flour|snack|dairy|bakery/i.test(name);

/** Where an industry's own storefront lives, or null when it only has the shared shop. */
export const isHouseholdIndustry = (name: string) => /household|cleaning|clean|detergent|soap|hygiene|laundry|home care|homecare/i.test(name);
export const isBuildIndustry = (name: string) => /construct|building|cement|steel|iron|hardware|tile|paint|plumb|electrical material|material/i.test(name);
export type StoreVariant = "food" | "fresh" | "build";
export const variantFor = (name: string): StoreVariant | null => (isFoodIndustry(name) ? "food" : isHouseholdIndustry(name) ? "fresh" : isBuildIndustry(name) ? "build" : null);
export function storefrontPath(i: { id: string; name: string; storefront?: string }): string | null {
  if (i.storefront === "fashion") return "/clothing";
  if (variantFor(i.name)) return `/industry/${i.id}`;
  return null;
}
