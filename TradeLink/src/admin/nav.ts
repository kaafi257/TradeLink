import {
  Activity as ActivityIcon, Boxes, Box, ChartNoAxesCombined, FileText, Home, Settings, Truck, Users,
} from "lucide-react";
import type { Role } from "../lib/supabase";

export type NavItem = { path: string; label: string; icon: typeof Home; roles: Role[] | "all"; end?: boolean };

/** Mirrors the database row-level security, so people only see pages their role can actually use. */
export const NAV: NavItem[] = [
  { path: "/admin", label: "Dashboard", icon: Home, roles: "all", end: true },
  { path: "/admin/products", label: "Products", icon: Box, roles: ["owner", "manager", "sales", "inventory", "delivery"] },
  { path: "/admin/quotations", label: "Orders & Quotations", icon: FileText, roles: ["owner", "manager", "sales"] },
  { path: "/admin/sales", label: "Sales & Deliveries", icon: Truck, roles: ["owner", "manager", "sales"] },
  { path: "/admin/staff", label: "Staff Management", icon: Users, roles: ["owner", "manager"] },
  { path: "/admin/inventory", label: "Inventory", icon: Boxes, roles: ["owner", "manager", "inventory"] },
  { path: "/admin/reports", label: "Reports & Analytics", icon: ChartNoAxesCombined, roles: ["owner", "manager"] },
  { path: "/admin/customers", label: "Customers", icon: Users, roles: ["owner", "manager", "sales"] },
  { path: "/admin/activity", label: "Activity Log", icon: ActivityIcon, roles: ["owner", "manager"] },
  { path: "/admin/settings", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

export const allowed = (item: NavItem, role: Role) => item.roles === "all" || item.roles.includes(role);
export const canEditProducts = (role: Role) => ["owner", "manager", "inventory"].includes(role);
export const canAdjustStock = canEditProducts;
