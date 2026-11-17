/** Industries that have their own designed storefront page. Each new design is added here. */
export const isFoodIndustry = (name: string) => /food|grocer|grain|beverage|drink|rice|sugar|flour|snack|dairy|bakery/i.test(name);

/** Where an industry's own storefront lives, or null when it only has the shared shop. */
export const isHouseholdIndustry = (name: string) => /household|cleaning|clean|detergent|soap|hygiene|laundry|home care|homecare/i.test(name);
export const isBuildIndustry = (name: string) => /construct|building|cement|steel|iron|hardware|tile|paint|plumb|electrical material|material/i.test(name);
export const isTechIndustry = (name: string) => /electronic|phone|mobile|computer|laptop|tech|appliance|gadget|device|solar|camera/i.test(name);
export const isFarmIndustry = (name: string) => /agri|farm|seed|fertili|crop|livestock|tractor|irrigation|pesticid|animal feed|poultry/i.test(name);
export const isFurnitureIndustry = (name: string) => /furnitur|sofa|chair|table|bed|mattress|decor|interior|cabinet|wood/i.test(name);
export type StoreVariant = "food" | "fresh" | "build" | "tech" | "farm" | "decor";
export const variantFor = (name: string): StoreVariant | null => (isFoodIndustry(name) ? "food" : isHouseholdIndustry(name) ? "fresh" : isBuildIndustry(name) ? "build" : isTechIndustry(name) ? "tech" : isFarmIndustry(name) ? "farm" : isFurnitureIndustry(name) ? "decor" : null);
export function storefrontPath(i: { id: string; name: string; storefront?: string }): string | null {
  if (i.storefront === "fashion") return "/clothing";
  // Every other industry opens inside the main marketplace so the whole store is one market.
  // (Per-industry designs live at /industry/:id but are no longer linked.)
  return null;
}
