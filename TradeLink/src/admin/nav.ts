import {
  Activity as ActivityIcon, Boxes, Box, Building2, ChartNoAxesCombined, ClipboardList, FileText, Layers, Megaphone, MessageCircle, Home, Settings, Truck, Users, Receipt, PackageCheck,
} from "lucide-react";
import type { Role } from "../lib/supabase";

export type NavItem = { path: string; label: string; icon: typeof Home; roles: Role[] | "all"; end?: boolean };

/** Mirrors the database row-level security, so people only see pages their role can actually use. */
export const NAV: NavItem[] = [
  { path: "/admin", label: "Dashboard", icon: Home, roles: "all", end: true },
  { path: "/admin/products", label: "Products", icon: Box, roles: ["owner", "manager", "sales", "inventory", "delivery"] },
  { path: "/admin/categories", label: "Categories", icon: Layers, roles: ["owner", "manager", "inventory"] },
  { path: "/admin/suppliers", label: "Suppliers", icon: Building2, roles: ["owner", "manager", "inventory"] },
  { path: "/admin/supplier-ops", label: "Supplier Operations", icon: PackageCheck, roles: ["owner", "manager"] },
  { path: "/admin/quotations", label: "Quotations", icon: FileText, roles: ["owner", "manager", "sales"] },
  { path: "/admin/orders", label: "Orders", icon: ClipboardList, roles: ["owner", "manager", "sales"] },
  { path: "/admin/sales", label: "Sales", icon: Receipt, roles: ["owner", "manager", "sales"] },
  { path: "/admin/deliveries", label: "Deliveries", icon: Truck, roles: ["owner", "manager", "sales", "delivery"] },
  { path: "/admin/staff", label: "Staff Management", icon: Users, roles: ["owner", "manager"] },
  { path: "/admin/inventory", label: "Inventory", icon: Boxes, roles: ["owner", "manager", "inventory"] },
  { path: "/admin/reports", label: "Reports & Analytics", icon: ChartNoAxesCombined, roles: ["owner", "manager"] },
  { path: "/admin/marketing", label: "Marketing", icon: Megaphone, roles: ["owner", "manager"] },
  { path: "/admin/communication", label: "Communication", icon: MessageCircle, roles: ["owner", "manager", "sales"] },
  { path: "/admin/customers", label: "Customers", icon: Users, roles: ["owner", "manager", "sales"] },
  { path: "/admin/activity", label: "Activity Log", icon: ActivityIcon, roles: ["owner", "manager"] },
  { path: "/admin/settings", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

export const allowed = (item: NavItem, role: Role) => item.roles === "all" || item.roles.includes(role);
