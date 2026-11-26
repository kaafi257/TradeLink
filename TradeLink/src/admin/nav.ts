import {
  Activity as ActivityIcon, Boxes, Box, Building2, ChartNoAxesCombined, ClipboardList, FileText, Globe, HandCoins, Headset, Layers, MessageCircle, Home, Megaphone,
  PackageCheck, Percent, Receipt, RotateCcw, Settings, ShieldCheck, Star, Truck, Users, Wallet,
} from "lucide-react";
import type { Role } from "../lib/supabase";

export type NavGroup = "Overview" | "Marketplace" | "Finance" | "Growth & Engagement" | "Administration";
export const NAV_GROUPS: NavGroup[] = ["Overview", "Marketplace", "Finance", "Growth & Engagement", "Administration"];

/**
 * A page is shown to a role listed in `roles`, or (when `perm` is set) to anyone whose role has been granted that permission in Settings.
 * Pages with only `perm` are the newer finance, trust and engagement tools: the owner always has them and decides who else does.
 */
export type NavItem = { path: string; label: string; icon: typeof Home; group: NavGroup; roles: Role[] | "all"; perm?: string; end?: boolean };

/** Mirrors the database row-level security, so people only see pages their role can actually use. */
export const NAV: NavItem[] = [
  { path: "/admin", label: "Dashboard", icon: Home, group: "Overview", roles: "all", end: true },
  { path: "/admin/reports", label: "Reports & Analytics", icon: ChartNoAxesCombined, group: "Overview", roles: ["owner", "manager"] },
  { path: "/admin/activity", label: "Activity Log", icon: ActivityIcon, group: "Overview", roles: ["owner", "manager"] },

  { path: "/admin/products", label: "Products", icon: Box, group: "Marketplace", roles: ["owner", "manager", "sales", "inventory", "delivery"] },
  { path: "/admin/categories", label: "Categories", icon: Layers, group: "Marketplace", roles: ["owner", "manager", "inventory"] },
  { path: "/admin/suppliers", label: "Suppliers", icon: Building2, group: "Marketplace", roles: ["owner", "manager", "inventory"] },
  { path: "/admin/supplier-ops", label: "Supplier Operations", icon: PackageCheck, group: "Marketplace", roles: ["owner", "manager"] },
  { path: "/admin/verification", label: "Supplier Verification", icon: ShieldCheck, group: "Marketplace", roles: [], perm: "verification.manage" },
  { path: "/admin/quotations", label: "Quotations", icon: FileText, group: "Marketplace", roles: ["owner", "manager", "sales"] },
  { path: "/admin/orders", label: "Orders", icon: ClipboardList, group: "Marketplace", roles: ["owner", "manager", "sales"] },
  { path: "/admin/deliveries", label: "Deliveries", icon: Truck, group: "Marketplace", roles: ["owner", "manager", "sales", "delivery"] },
  { path: "/admin/inventory", label: "Inventory", icon: Boxes, group: "Marketplace", roles: ["owner", "manager", "inventory"] },
  { path: "/admin/returns", label: "Returns & Disputes", icon: RotateCcw, group: "Marketplace", roles: [], perm: "returns.manage" },
  { path: "/admin/reviews", label: "Reviews & Ratings", icon: Star, group: "Marketplace", roles: [], perm: "reviews.moderate" },

  { path: "/admin/sales", label: "Sales", icon: Receipt, group: "Finance", roles: ["owner", "manager", "sales"] },
  { path: "/admin/payments", label: "Payments & Payouts", icon: Wallet, group: "Finance", roles: [], perm: "payments.view" },
  { path: "/admin/commissions", label: "Commissions", icon: Percent, group: "Finance", roles: [], perm: "commissions.manage" },

  { path: "/admin/marketing", label: "Marketing & Promotions", icon: Megaphone, group: "Growth & Engagement", roles: [], perm: "marketing.manage" },
  { path: "/admin/customers", label: "Customers", icon: Users, group: "Growth & Engagement", roles: ["owner", "manager", "sales"] },
  { path: "/admin/communication", label: "Communication", icon: MessageCircle, group: "Growth & Engagement", roles: ["owner", "manager", "sales"] },
  { path: "/admin/support", label: "Customer Support", icon: Headset, group: "Growth & Engagement", roles: [], perm: "support.manage" },

  { path: "/admin/website", label: "Website Management", icon: Globe, group: "Administration", roles: [], perm: "website.manage" },
  { path: "/admin/staff", label: "Staff Management", icon: HandCoins, group: "Administration", roles: ["owner", "manager"] },
  { path: "/admin/settings", label: "Settings", icon: Settings, group: "Administration", roles: ["owner", "manager"] },
];

export const allowed = (item: NavItem, role: Role, can: (permission: string) => boolean = () => false) =>
  item.roles === "all" || item.roles.includes(role) || (!!item.perm && can(item.perm));

/** Longest matching path wins, so "/admin/supplier-ops" is not mistaken for "/admin/suppliers". */
export const currentItem = (pathname: string) =>
  NAV.filter(n => (n.end ? pathname === n.path : pathname === n.path || pathname.startsWith(n.path + "/"))).sort((a, b) => b.path.length - a.path.length)[0];
