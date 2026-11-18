import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, Building2, Eye, FileQuestion, Layers, Package, PackageX, Search, SearchX, ShieldCheck, ShoppingCart, Store, TriangleAlert, Users, UserCheck, Clock } from "lucide-react";
import { fmtDate, fmtDateTime, fmtMoney, fmtN, num, TZ, useRpc, type Range } from "./api";
import { Donut, HBars, LineChart, PALETTE } from "./charts";
import { Badge, Box, Cards, DataTable, Err, Note, Select, Spin, type Card } from "./parts";
import { requireSupabase } from "../../lib/supabase";

export type Ctx = { r: Range; args: { p_from: string; p_to: string }; go: (t: string) => void };
type Row = { label: string; value: number };
type Sum = Record<string, any>;
const bars = (rows?: Row[]) => (rows || []).map(x => ({ label: String(x.label).replace(/_/g, " "), value: num(x.value) }));
const pies = (rows?: Row[]) => bars(rows).map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));

function useDrill<T extends Record<string, string>>(init: T) {
  const [f, setF] = useState<T>(init);
  const ref = useRef<HTMLDivElement>(null);
  const drill = (patch: Partial<T>) => { setF({ ...init, ...patch }); setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  return { f, set: (k: keyof T, v: string) => setF(p => ({ ...p, [k]: v })), drill, ref };
}

function SiteSeries({ title, metric, c, icon }: { title: string; metric: string; c: Ctx; icon?: ReactNode }) {
  const { data, error, loading } = useRpc<{ bucket: string; value: number }[]>("report_site_series", { p_metric: metric, ...c.args, p_bucket: c.r.bucket, p_tz: TZ });
  const pts = useMemo(() => (data || []).map(d => ({ label: c.r.bucket === "month" ? new Date(d.bucket + "T00:00").toLocaleString([], { month: "short" }) : new Date(d.bucket + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }), value: num(d.value) })), [data, c.r.bucket]);
  return <Box title={title} icon={icon}><Err msg={error} />{loading && !pts.length ? <Spin /> : <LineChart data={pts} bars fmt={fmtN} />}</Box>;
}
const Empty = ({ children }: { children: ReactNode }) => <p className="rp-note">{children}</p>;
const Bars = ({ rows }: { rows?: Row[] }) => (rows && rows.length ? <HBars data={bars(rows)} /> : <Empty>Nothing recorded for this period yet.</Empty>);

export function Suppliers({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ status: "", industry: "" });
  const { data: s, error } = useRpc<Sum>("report_supplier_summary", c.args);
  const cards: Card[] = s ? [
    { key: "t", icon: <Building2 />, label: "All suppliers", value: fmtN(s.total), onClick: () => drill({}) },
    { key: "a", icon: <UserCheck />, label: "Active", value: fmtN(s.active), onClick: () => drill({ status: "approved" }) },
    { key: "p", icon: <Clock />, label: "Pending approval", value: fmtN(s.pending), onClick: () => drill({ status: "pending" }) },
    { key: "n", icon: <Building2 />, label: "Joined in period", value: fmtN(s.new) },
    { key: "s", icon: <TriangleAlert />, label: "Suspended", value: fmtN(s.suspended), onClick: () => drill({ status: "suspended" }) },
    { key: "r", icon: <PackageX />, label: "Rejected", value: fmtN(s.rejected), onClick: () => drill({ status: "rejected" }) },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      {s && <div className="rp-grid2">
        <Box title="By industry" icon={<Layers />}><Bars rows={s.by_industry} /></Box>
        <Box title="By status" icon={<Building2 />}>{s.by_status?.length ? <Donut data={pies(s.by_status)} /> : <Empty>No suppliers yet.</Empty>}</Box>
        <Box title="By business type" icon={<Store />}><Bars rows={s.by_type} /></Box>
      </div>}
      <Note>Supplier contact details are masked unless you hold the sensitive-data permission. TradeLink does not yet link products or orders to a supplier, so per-supplier sales are not measured.</Note>
      <DataTable anchor={ref} title="Suppliers" fn="report_suppliers" subtitle={c.r.label} searchHint="Name, location or owner" args={{ ...c.args, p_status: f.status || null, p_industry: f.industry || null }}
        filters={<>
          <Select label="Status" value={f.status} onChange={v => set("status", v)} options={[["", "All status"], ["approved", "Approved"], ["pending", "Pending"], ["suspended", "Suspended"], ["rejected", "Rejected"]]} />
          <IndustrySelect value={f.industry} onChange={v => set("industry", v)} /></>}
        cols={[{ key: "name", label: "Supplier" }, { key: "industry", label: "Industry" }, { key: "location", label: "Location" }, { key: "status", label: "Status" }, { key: "business_type", label: "Type" }, { key: "owner_name", label: "Owner" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "categories", label: "Categories" }, { key: "joined", label: "Joined", get: r => fmtDate(r.joined) }]}
        render={{ status: r => <Badge v={String(r.status)} />, business_type: r => String(r.business_type || "—"), location: r => String(r.location || "—"), owner_name: r => String(r.owner_name || "—"), phone: r => String(r.phone || "—"), email: r => String(r.email || "—"), joined: r => fmtDate(r.joined) }} />
    </>
  );
}

function IndustrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => { requireSupabase().from("industries").select("name").order("sort_order").then(({ data }) => setNames((data || []).map(x => String(x.name)))); }, []);
  return <Select label="Industry" value={value} onChange={onChange} options={[["", "All industries"], ...names.map(n => [n, n] as [string, string])]} />;
}

export function Products({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ status: "", category: "" });
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => { requireSupabase().from("categories").select("name").order("name").then(({ data }) => setCats(Array.from(new Set((data || []).map(x => String(x.name)))))); }, []);
  const { data: s, error } = useRpc<Sum>("report_product_summary", c.args);
  const cards: Card[] = s ? [
    { key: "t", icon: <Package />, label: "All products", value: fmtN(s.total), onClick: () => drill({}) },
    { key: "a", icon: <UserCheck />, label: "Active", value: fmtN(s.active), onClick: () => drill({ status: "active" }) },
    { key: "i", icon: <PackageX />, label: "Inactive", value: fmtN(s.inactive), note: "Hidden from the website", onClick: () => drill({ status: "inactive" }) },
    { key: "o", icon: <PackageX />, label: "Out of stock", value: fmtN(s.out), onClick: () => drill({ status: "out" }) },
    { key: "l", icon: <TriangleAlert />, label: "Low stock", value: fmtN(s.low), onClick: () => drill({ status: "low" }) },
    { key: "n", icon: <Package />, label: "Added in period", value: fmtN(s.new) },
    { key: "v", icon: <Eye />, label: "Product views", value: fmtN(s.views), note: "On the website" },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      {s && <div className="rp-grid2">
        <Box title="Most ordered (quantity)" icon={<ShoppingCart />}><Bars rows={s.top_ordered} /></Box>
        <Box title="Most viewed" icon={<Eye />}><Bars rows={s.top_viewed} /></Box>
        <Box title="Active products by category" icon={<Layers />}><Bars rows={s.by_category} /></Box>
      </div>}
      <Note>Views come from anonymous website visits recorded since tracking started. Products have no approval step or supplier link yet, so those are not reported.</Note>
      <DataTable anchor={ref} title="Products" fn="report_products" subtitle={c.r.label} searchHint="Name or SKU" args={{ ...c.args, p_status: f.status || null, p_category: f.category || null }}
        filters={<>
          <Select label="Stock" value={f.status} onChange={v => set("status", v)} options={[["", "All products"], ["active", "Active"], ["in_stock", "In stock"], ["low", "Low stock"], ["out", "Out of stock"], ["inactive", "Inactive"]]} />
          <Select label="Category" value={f.category} onChange={v => set("category", v)} options={[["", "All categories"], ...cats.map(n => [n, n] as [string, string])]} /></>}
        cols={[{ key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "sku", label: "SKU" }, { key: "price", label: "Price (ETB)", get: r => num(r.price) }, { key: "stock", label: "Stock", get: r => `${num(r.stock)} ${r.unit}` }, { key: "state", label: "State" }, { key: "views", label: "Views" }, { key: "ordered", label: "Ordered", get: r => num(r.ordered) }, { key: "added", label: "Added", get: r => fmtDate(r.added) }]}
        render={{ price: r => fmtMoney(r.price), stock: r => `${fmtN(r.stock)} ${r.unit}`, state: r => <Badge v={String(r.state)} />, ordered: r => fmtN(r.ordered), sku: r => String(r.sku || "—"), added: r => fmtDate(r.added) }} />
    </>
  );
}

export function Audit({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ action: "", entity: "" });
  const { data: s, error } = useRpc<Sum>("report_audit_summary", c.args);
  const cards: Card[] = s ? [
    { key: "e", icon: <Activity />, label: "Events", value: fmtN(s.events), onClick: () => drill({}) },
    { key: "l", icon: <Users />, label: "Sign-ins", value: fmtN(s.logins), onClick: () => drill({ action: "login" }) },
    { key: "a", icon: <UserCheck />, label: "Active staff", value: fmtN(s.actors) },
    { key: "c", icon: <ShieldCheck />, label: "Changes made", value: fmtN(s.changes) },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      {s && <div className="rp-grid2">
        <Box title="Most active staff" icon={<Users />}><Bars rows={s.by_user} /></Box>
        <Box title="What was done" icon={<Activity />}><Bars rows={s.by_action} /></Box>
        <Box title="Where" icon={<Layers />}><Bars rows={s.by_entity} /></Box>
      </div>}
      <Note>This is the staff audit trail. Sign-ins are recorded from the moment this update is live; customers do not have accounts, so their activity appears under Marketplace.</Note>
      <DataTable anchor={ref} title="Audit trail" fn="report_audit" subtitle={c.r.label} searchHint="Person or description" args={{ ...c.args, p_action: f.action || null, p_entity: f.entity || null }}
        filters={<>
          <Select label="Action" value={f.action} onChange={v => set("action", v)} options={[["", "All actions"], ["login", "Sign-ins"], ...(s?.by_action || []).filter((x: Row) => x.label !== "login").map((x: Row) => [x.label, String(x.label).replace(/_/g, " ")] as [string, string])]} />
          <Select label="Area" value={f.entity} onChange={v => set("entity", v)} options={[["", "All areas"], ...(s?.by_entity || []).map((x: Row) => [x.label, String(x.label).replace(/_/g, " ")] as [string, string])]} /></>}
        cols={[{ key: "at", label: "When", get: r => fmtDateTime(r.at) }, { key: "actor", label: "Who" }, { key: "action", label: "Action", get: r => String(r.action).replace(/_/g, " ") }, { key: "entity", label: "Area" }, { key: "description", label: "Details" }]}
        render={{ at: r => fmtDateTime(r.at), action: r => <Badge v={String(r.action)} /> }} />
    </>
  );
}

export function Market({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ status: "" });
  const { data: s, error } = useRpc<Sum>("report_market_summary", c.args);
  const cards: Card[] = s ? [
    { key: "v", icon: <Users />, label: "Visitors", value: fmtN(s.visitors), note: "Browsers that opened the site" },
    { key: "p", icon: <Eye />, label: "Product views", value: fmtN(s.product_views) },
    { key: "s", icon: <Search />, label: "Searches", value: fmtN(s.searches), onClick: () => drill({}) },
    { key: "n", icon: <SearchX />, label: "No-result searches", value: fmtN(s.no_result), note: "Demand you may not stock", onClick: () => drill({ status: "no_result" }) },
    { key: "q", icon: <FileQuestion />, label: "Inquiries", value: fmtN(s.inquiries), note: s.conversion != null ? `${s.conversion} per 100 visitors` : "No visitors recorded yet" },
    { key: "w", icon: <Store />, label: "Wholesale / retail", value: `${fmtN(s.wholesale_sessions)} / ${fmtN(s.retail_sessions)}`, note: "Visitors by shopping mode" },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2">
        <SiteSeries title="Visitors" metric="visits" c={c} icon={<Users />} />
        <SiteSeries title="Product views" metric="product_views" c={c} icon={<Eye />} />
        {s && <><Box title="Top search words" icon={<Search />}><Bars rows={s.top_terms} /></Box>
          <Box title="Most visited categories" icon={<Layers />}><Bars rows={s.top_categories} /></Box>
          <Box title="Most visited industries" icon={<Store />}><Bars rows={s.top_industries} /></Box></>}
      </div>
      <Note>Website behaviour is counted anonymously (a random id per browser, no names or IPs) and only from when tracking went live. Customer accounts, carts and refunds do not exist yet, so they are not reported.</Note>
      <DataTable anchor={ref} title="Searches" fn="report_searches" subtitle={c.r.label} searchHint="Search word" args={{ ...c.args, p_status: f.status || null }}
        filters={<Select label="Results" value={f.status} onChange={v => set("status", v)} options={[["", "All searches"], ["no_result", "Had no results"]]} />}
        cols={[{ key: "term", label: "Search word" }, { key: "searches", label: "Searches" }, { key: "visitors", label: "Visitors" }, { key: "avg_results", label: "Avg results", get: r => num(r.avg_results) }, { key: "no_result", label: "No result" }, { key: "last_at", label: "Last searched", get: r => fmtDateTime(r.last_at) }]}
        render={{ last_at: r => fmtDateTime(r.last_at), avg_results: r => String(num(r.avg_results)) }} />
    </>
  );
}
