import {
  Activity as ActivityIcon, BadgeCheck, Banknote, Boxes, Box, Building2, ChartNoAxesCombined, ClipboardList, FileText, Layers, MessageCircle, Home, Settings, Truck, Users, Receipt, PackageCheck, Wallet, Percent, RotateCcw, Megaphone, Star, Globe, Headset,
} from "lucide-react";
import type { Role } from "../lib/supabase";

export type NavGroup = "Overview" | "Marketplace" | "Finance" | "Growth & Engagement" | "Administration";
export type NavItem = { path: string; label: string; icon: typeof Home; roles: Role[] | "all"; group: NavGroup; permission?: string; end?: boolean };

/** Role visibility is mirrored by route guards; database policies enforce the same permissions. */
export const NAV: NavItem[] = [
  { path: "/admin", label: "Dashboard", icon: Home, roles: "all", group: "Overview", end: true },
  { path: "/admin/products", label: "Products", icon: Box, roles: ["owner","manager","sales","inventory","delivery"], group: "Marketplace" },
  { path: "/admin/categories", label: "Categories", icon: Layers, roles: ["owner","manager","inventory"], group: "Marketplace" },
  { path: "/admin/suppliers", label: "Suppliers", icon: Building2, roles: ["owner","manager","inventory"], group: "Marketplace" },
  { path: "/admin/supplier-ops", label: "Supplier Operations", icon: PackageCheck, roles: ["owner","manager"], group: "Marketplace" },
  { path: "/admin/supplier-verification", label: "Supplier Verification", icon: BadgeCheck, roles: ["owner","manager"], group: "Marketplace", permission: "suppliers.verify" },
  { path: "/admin/quotations", label: "Quotations", icon: FileText, roles: ["owner","manager","sales"], group: "Marketplace" },
  { path: "/admin/orders", label: "Orders", icon: ClipboardList, roles: ["owner","manager","sales"], group: "Marketplace" },
  { path: "/admin/deliveries", label: "Deliveries", icon: Truck, roles: ["owner","manager","sales","delivery"], group: "Marketplace" },
  { path: "/admin/payments", label: "Payments & Payouts", icon: Wallet, roles: ["owner","manager"], group: "Finance", permission: "marketplace.payments" },
  { path: "/admin/commissions", label: "Commissions", icon: Percent, roles: ["owner","manager"], group: "Finance", permission: "marketplace.commissions" },
  { path: "/admin/returns-disputes", label: "Returns & Disputes", icon: RotateCcw, roles: ["owner","manager"], group: "Finance", permission: "marketplace.cases" },
  { path: "/admin/sales", label: "Sales", icon: Receipt, roles: ["owner","manager","sales"], group: "Finance" },
  { path: "/admin/inventory", label: "Inventory", icon: Boxes, roles: ["owner","manager","inventory"], group: "Finance" },
  { path: "/admin/reports", label: "Reports & Analytics", icon: ChartNoAxesCombined, roles: ["owner","manager"], group: "Finance" },
  { path: "/admin/marketing", label: "Marketing & Promotions", icon: Megaphone, roles: ["owner","manager"], group: "Growth & Engagement", permission: "marketplace.marketing" },
  { path: "/admin/reviews", label: "Reviews & Ratings", icon: Star, roles: ["owner","manager"], group: "Growth & Engagement", permission: "marketplace.reviews" },
  { path: "/admin/website", label: "Website Management", icon: Globe, roles: ["owner","manager"], group: "Growth & Engagement", permission: "marketplace.website" },
  { path: "/admin/communication", label: "Communication", icon: MessageCircle, roles: ["owner","manager","sales"], group: "Growth & Engagement" },
  { path: "/admin/customers", label: "Customers", icon: Users, roles: ["owner","manager","sales"], group: "Growth & Engagement" },
  { path: "/admin/support", label: "Customer Support", icon: Headset, roles: ["owner","manager"], group: "Growth & Engagement", permission: "support.manage" },
  { path: "/admin/staff", label: "Staff Management", icon: Users, roles: ["owner","manager"], group: "Administration" },
  { path: "/admin/activity", label: "Activity Log", icon: ActivityIcon, roles: ["owner","manager"], group: "Administration" },
  { path: "/admin/settings", label: "Settings", icon: Settings, roles: ["owner","manager"], group: "Administration" },
];

export const NAV_GROUPS: NavGroup[] = ["Overview","Marketplace","Finance","Growth & Engagement","Administration"];
export const allowed = (item: NavItem, role: Role) => item.roles === "all" || item.roles.includes(role);
