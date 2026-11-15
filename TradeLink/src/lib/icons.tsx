import {
  Armchair, Baby, BookOpen, Car, Cpu, Factory, Gem, Hammer, HardHat, Home, Leaf, Package, Pill, Shirt, Smartphone, Sparkles, Sprout, Utensils, Wheat, Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icons an owner can pick for an industry. Add a line here to offer another one. */
export const INDUSTRY_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  package: { label: "General goods", Icon: Package },
  wheat: { label: "Food & grains", Icon: Wheat },
  utensils: { label: "Restaurant & catering", Icon: Utensils },
  sprout: { label: "Agriculture", Icon: Sprout },
  leaf: { label: "Organic & natural", Icon: Leaf },
  shirt: { label: "Fashion & textiles", Icon: Shirt },
  smartphone: { label: "Electronics", Icon: Smartphone },
  cpu: { label: "Computers & tech", Icon: Cpu },
  hammer: { label: "Hardware & tools", Icon: Hammer },
  wrench: { label: "Spare parts", Icon: Wrench },
  hardhat: { label: "Construction", Icon: HardHat },
  factory: { label: "Industrial supplies", Icon: Factory },
  home: { label: "Home & living", Icon: Home },
  armchair: { label: "Furniture", Icon: Armchair },
  pill: { label: "Health & pharmacy", Icon: Pill },
  sparkles: { label: "Beauty & cleaning", Icon: Sparkles },
  baby: { label: "Baby & kids", Icon: Baby },
  book: { label: "Books & stationery", Icon: BookOpen },
  car: { label: "Automotive", Icon: Car },
  gem: { label: "Jewellery & gifts", Icon: Gem },
};
export const IconFor = ({ name, size = 20 }: { name?: string | null; size?: number }) => {
  const Icon = (name && INDUSTRY_ICONS[name]?.Icon) || Package;
  return <Icon size={size} />;
};
