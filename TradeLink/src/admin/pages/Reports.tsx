import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Banknote, Boxes, Building2, ClipboardList, FileQuestion, LayoutDashboard, Package, ShieldCheck, ShoppingCart, Store, Truck, UserPlus, Users, Wallet, Receipt, Percent, Undo2, Hourglass } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtN, iso, num, rangeFor, TZ, useRpc, type Preset, type Range } from "../reports/api";
import { Donut, HBars, LineChart, PALETTE } from "../reports/charts";
import { Badge, Box, Cards, DataTable, DateBar, Err, Note, Select, Spin, type Card } from "../reports/parts";
import { requireSupabase } from "../../lib/supabase";
import { Audit, Market, Products, Suppliers } from "../reports/more";

type Tab = { key: string; label: string; icon: ReactNode; soon?: boolean };
const TABS: Tab[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard /> },
  { key: "customers", label: "Customers", icon: <Users /> },
  { key: "suppliers", label: "Suppliers", icon: <Building2 /> },
  { key: "products", label: "Products", icon: <Package /> },
  { key: "orders", label: "Orders", icon: <ShoppingCart /> },
  { key: "inquiries", label: "Inquiries & RFQ", icon: <FileQuestion /> },
  { key: "inventory", label: "Inventory", icon: <Boxes /> },
  { key: "financial", label: "Financial", icon: <Banknote /> },
  { key: "audit", label: "User Activity", icon: <ShieldCheck /> },
  { key: "market", label: "Marketplace", icon: <Store /> },
];

type Ctx = { r: Range; args: { p_from: string; p_to: string }; go: (t: string) => void };
type Obj = Record<string, number>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
const slices = (o: Obj | undefined, order?: string[]) => Object.entries(o || {}).sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : b[1] - a[1])).map(([k, v], i) => ({ label: cap(k), value: Number(v), color: PALETTE[i % PALETTE.length] }));

function useSeries(metric: string, c: Ctx) {
  const { data, error, loading } = useRpc<{ bucket: string; value: number }[]>("report_series", { p_metric: metric, ...c.args, p_bucket: c.r.bucket, p_tz: TZ });
  const pts = useMemo(() => (data || []).map(d => ({ label: c.r.bucket === "month" ? new Date(d.bucket + "T00:00").toLocaleString([], { month: "short" }) : new Date(d.bucket + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }), value: num(d.value) })), [data, c.r.bucket]);
  return { pts, error, loading };
}
function SeriesBox({ title, metric, c, money, bars, icon }: { title: string; metric: string; c: Ctx; money?: boolean; bars?: boolean; icon?: ReactNode }) {
  const { pts, error, loading } = useSeries(metric, c);
  return <Box title={title} icon={icon}><Err msg={error} />{loading && !pts.length ? <Spin /> : <LineChart data={pts} bars={bars} fmt={money ? fmtMoney : fmtN} />}</Box>;
}

function Overview({ c }: { c: Ctx }) {
  const nav = useNavigate();
  const { data: o, error, loading } = useRpc<Record<string, number>>("report_overview", c.args);
  if (loading && !o) return <Spin />;
  if (!o) return <Err msg={error} />;
  const cards: Card[] = [
    { key: "cu", icon: <Users />, label: "Customers", value: fmtN(o.customers_total), note: `${fmtN(o.customers_active)} active · ${fmtN(o.customers_new)} new`, cur: o.customers_new, prev: o.customers_new_prev, onClick: () => c.go("customers") },
    { key: "su", icon: <Building2 />, label: "Suppliers", value: fmtN(o.suppliers_total), note: `${fmtN(o.suppliers_verified)} verified · ${fmtN(o.suppliers_pending)} pending`, onClick: () => nav("/admin/suppliers") },
    { key: "pr", icon: <Package />, label: "Products", value: fmtN(o.products_total), note: `${fmtN(o.products_active)} active · ${fmtN(o.products_out)} out of stock`, onClick: () => c.go("inventory") },
    { key: "or", icon: <ShoppingCart />, label: "Orders", value: fmtN(o.orders_total), note: `${fmtN(o.orders_all)} all-time`, cur: o.orders_total, prev: o.orders_prev, onClick: () => c.go("orders") },
    { key: "rv", icon: <Banknote />, label: "Revenue", value: fmtMoney(o.revenue), cur: num(o.revenue), prev: num(o.revenue_prev), onClick: () => c.go("financial") },
    { key: "qt", icon: <FileQuestion />, label: "Inquiries", value: fmtN(o.quotes_total), cur: o.quotes_total, prev: o.quotes_prev, onClick: () => c.go("inquiries") },
    { key: "st", icon: <ShieldCheck />, label: "Staff", value: fmtN(o.staff_total), note: `${fmtN(o.staff_active)} active in period`, onClick: () => nav("/admin/staff") },
    { key: "ac", icon: <Activity />, label: "Activity", value: fmtN(o.activity), cur: o.activity, prev: o.activity_prev, onClick: () => nav("/admin/activity") },
  ];
  return (
    <>
      <Cards cards={cards} />
      <div className="rp-grid2">
        <SeriesBox title="Revenue" metric="revenue" c={c} money icon={<Banknote />} />
        <SeriesBox title="Orders" metric="orders" c={c} bars icon={<ShoppingCart />} />
        <SeriesBox title="Inquiries" metric="quotes" c={c} bars icon={<FileQuestion />} />
        <SeriesBox title="New customers" metric="new_customers" c={c} bars icon={<UserPlus />} />
      </div>
    </>
  );
}

function useDrill<T extends Record<string, string>>(init: T) {
  const [f, setF] = useState<T>(init);
  const ref = useRef<HTMLDivElement>(null);
  const drill = (patch: Partial<T>) => { setF({ ...init, ...patch }); setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  return { f, set: (k: keyof T, v: string) => setF(p => ({ ...p, [k]: v })), drill, ref };
}
const sub = (c: Ctx) => c.r.label;

function Customers({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ type: "" });
  const { data: s, error } = useRpc<Record<string, number>>("report_customer_summary", c.args);
  const cards: Card[] = s ? [
    { key: "a", icon: <Users />, label: "All customers", value: fmtN(s.total), onClick: () => drill({}) },
    { key: "b", icon: <Activity />, label: "Active", value: fmtN(s.active), note: "Last 30 days" },
    { key: "c", icon: <UserPlus />, label: "New", value: fmtN(s.new), note: "First seen in period" },
    { key: "d", icon: <Store />, label: "Wholesale", value: fmtN(s.business), onClick: () => drill({ type: "business" }) },
    { key: "e", icon: <Users />, label: "Retail", value: fmtN(s.retail), onClick: () => drill({ type: "individual" }) },
    { key: "f", icon: <ShoppingCart />, label: "Ordered", value: fmtN(s.ordering), note: `${fmtN(s.repeat)} repeat` },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2"><SeriesBox title="New customers" metric="new_customers" c={c} bars icon={<UserPlus />} />
        <Box title="Customer mix" icon={<Users />}>{s && <Donut data={[{ label: "Wholesale", value: num(s.business), color: PALETTE[1] }, { label: "Retail", value: num(s.retail), color: PALETTE[0] }]} />}</Box></div>
      <Note>Customers are identified from their real inquiries and orders. Phone numbers are masked unless you hold the sensitive-data permission.</Note>
      <DataTable anchor={ref} title="Customers" fn="report_customers" subtitle={sub(c)} searchHint="Name, phone or email" args={{ ...c.args, p_type: f.type || null }}
        filters={<Select label="Type" value={f.type} onChange={v => set("type", v)} options={[["", "All types"], ["business", "Wholesale"], ["individual", "Retail"]]} />}
        cols={[{ key: "name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "type", label: "Type", get: r => (r.type === "business" ? "Wholesale" : "Retail") }, { key: "quotes", label: "Inquiries" }, { key: "orders", label: "Orders" }, { key: "spent", label: "Spent (ETB)", get: r => num(r.spent) }, { key: "first_seen", label: "First seen", get: r => fmtDate(r.first_seen) }, { key: "last_seen", label: "Last activity", get: r => fmtDate(r.last_seen) }]}
        render={{ type: r => <Badge v={r.type === "business" ? "wholesale" : "retail"} />, spent: r => fmtMoney(r.spent), first_seen: r => fmtDate(r.first_seen), last_seen: r => fmtDate(r.last_seen), email: r => String(r.email || "—") }} />
    </>
  );
}

function Orders({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ stage: "", type: "" });
  const { data: s, error } = useRpc<Record<string, any>>("report_order_summary", c.args);
  const cards: Card[] = s ? [
    { key: "t", icon: <ShoppingCart />, label: "Orders", value: fmtN(s.total), onClick: () => drill({}) },
    { key: "v", icon: <Banknote />, label: "Order value", value: fmtMoney(s.value), note: `${fmtMoney(s.paid)} paid` },
    { key: "p", icon: <Hourglass />, label: "Pending", value: fmtN(s.pending), onClick: () => drill({ stage: "pending" }) },
    { key: "r", icon: <Truck />, label: "Processing", value: fmtN(s.processing), onClick: () => drill({ stage: "processing" }) },
    { key: "c", icon: <ClipboardList />, label: "Completed", value: fmtN(s.completed), onClick: () => drill({ stage: "completed" }) },
    { key: "x", icon: <Undo2 />, label: "Cancelled", value: fmtN(s.cancelled), onClick: () => drill({ stage: "cancelled" }) },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2"><SeriesBox title="Orders over time" metric="orders" c={c} bars icon={<ShoppingCart />} />
        <Box title="Status" icon={<ClipboardList />}>{s && <Donut data={slices(s.by_status)} />}</Box>
        <Box title="Retail vs wholesale" icon={<Store />}>{s && <HBars data={[{ label: "Wholesale", value: num(s.wholesale) }, { label: "Retail", value: num(s.retail) }]} />}</Box>
        <Box title="Delivery" icon={<Truck />}>{s && <HBars data={slices(s.delivery)} />}</Box></div>
      <DataTable anchor={ref} title="Orders" fn="report_orders" subtitle={sub(c)} searchHint="Order no. or customer" args={{ ...c.args, p_stage: f.stage || null, p_type: f.type || null }}
        filters={<><Select label="Status" value={f.stage} onChange={v => set("stage", v)} options={[["", "All status"], ["pending", "Pending"], ["processing", "Processing"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} />
          <Select label="Type" value={f.type} onChange={v => set("type", v)} options={[["", "All types"], ["wholesale", "Wholesale"], ["retail", "Retail"]]} /></>}
        cols={[{ key: "order_number", label: "Order" }, { key: "customer_name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "location", label: "Location" }, { key: "status", label: "Status" }, { key: "order_type", label: "Type" }, { key: "total", label: "Total (ETB)", get: r => num(r.total) }, { key: "paid", label: "Paid (ETB)", get: r => num(r.paid) }, { key: "delivery_status", label: "Delivery", get: r => String(r.delivery_status || "—") }, { key: "created_at", label: "Date", get: r => fmtDateTime(r.created_at) }]}
        render={{ status: r => <Badge v={String(r.status)} />, order_type: r => <Badge v={String(r.order_type)} />, total: r => fmtMoney(r.total), paid: r => fmtMoney(r.paid), delivery_status: r => (r.delivery_status ? <Badge v={String(r.delivery_status)} /> : "—"), created_at: r => fmtDateTime(r.created_at) }} />
    </>
  );
}

function Inquiries({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ status: "", type: "" });
  const { data: s, error } = useRpc<Record<string, any>>("report_inquiry_summary", c.args);
  const cards: Card[] = s ? [
    { key: "t", icon: <FileQuestion />, label: "Inquiries", value: fmtN(s.total), onClick: () => drill({}) },
    { key: "p", icon: <Hourglass />, label: "Awaiting reply", value: fmtN(s.pending), onClick: () => drill({ status: "pending" }) },
    { key: "a", icon: <Receipt />, label: "Answered", value: fmtN(s.answered), onClick: () => drill({ status: "answered" }) },
    { key: "c", icon: <ShoppingCart />, label: "Converted", value: fmtN(s.converted), note: s.total ? `${Math.round((num(s.converted) / num(s.total)) * 100)}% conversion` : undefined, onClick: () => drill({ status: "converted" }) },
    { key: "r", icon: <Undo2 />, label: "Rejected", value: fmtN(s.rejected), onClick: () => drill({ status: "rejected" }) },
    { key: "h", icon: <Activity />, label: "Avg. response", value: s.avg_response_hours == null ? "—" : `${s.avg_response_hours} h` },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2"><SeriesBox title="Inquiries over time" metric="quotes" c={c} bars icon={<FileQuestion />} />
        <Box title="Status" icon={<FileQuestion />}>{s && <Donut data={slices(s.by_status)} />}</Box>
        <Box title="Retail vs wholesale" icon={<Store />}>{s && <HBars data={[{ label: "Wholesale", value: num(s.wholesale) }, { label: "Retail", value: num(s.retail) }]} />}</Box>
        <Box title="Quoted value" icon={<Banknote />}>{s && <div className="rp-big">{fmtMoney(s.value)}</div>}</Box></div>
      <DataTable anchor={ref} title="Inquiries" fn="report_inquiries" subtitle={sub(c)} searchHint="Number, customer or location" args={{ ...c.args, p_status: f.status || null, p_type: f.type || null }}
        filters={<><Select label="Status" value={f.status} onChange={v => set("status", v)} options={[["", "All status"], ["pending", "Awaiting reply"], ["answered", "Answered"], ["new", "New"], ["reviewing", "Reviewing"], ["quoted", "Quoted"], ["accepted", "Accepted"], ["converted", "Converted"], ["rejected", "Rejected"]]} />
          <Select label="Type" value={f.type} onChange={v => set("type", v)} options={[["", "All types"], ["business", "Wholesale"], ["individual", "Retail"]]} /></>}
        cols={[{ key: "quote_number", label: "Inquiry" }, { key: "customer_name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "location", label: "Location" }, { key: "status", label: "Status" }, { key: "customer_type", label: "Type", get: r => (r.customer_type === "business" ? "Wholesale" : "Retail") }, { key: "items", label: "Items" }, { key: "estimated_total", label: "Estimate (ETB)", get: r => num(r.estimated_total) }, { key: "created_at", label: "Received", get: r => fmtDateTime(r.created_at) }]}
        render={{ status: r => <Badge v={String(r.status)} />, customer_type: r => <Badge v={r.customer_type === "business" ? "wholesale" : "retail"} />, estimated_total: r => fmtMoney(r.estimated_total), created_at: r => fmtDateTime(r.created_at) }} />
    </>
  );
}

function Inventory({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ status: "", category: "" });
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => { requireSupabase().from("categories").select("name").order("name").then(({ data }) => setCats((data || []).map(x => String(x.name)))); }, []);
  const { data: s, error } = useRpc<Record<string, any>>("report_inventory_summary", c.args);
  const cards: Card[] = s ? [
    { key: "p", icon: <Package />, label: "Active products", value: fmtN(s.products), onClick: () => drill({}) },
    { key: "v", icon: <Banknote />, label: "Stock value", value: fmtMoney(s.stock_value) },
    { key: "l", icon: <Hourglass />, label: "Low stock", value: fmtN(s.low), onClick: () => drill({ status: "low" }) },
    { key: "o", icon: <Undo2 />, label: "Out of stock", value: fmtN(s.out), onClick: () => drill({ status: "out" }) },
    { key: "i", icon: <Boxes />, label: "Units in", value: fmtN(s.units_in), note: "This period" },
    { key: "u", icon: <Truck />, label: "Units out", value: fmtN(s.units_out), note: "This period" },
  ] : [];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2"><SeriesBox title="Stock movements" metric="stock_movements" c={c} bars icon={<Boxes />} />
        <Box title="Stock health" icon={<Package />}>{s && <Donut data={[{ label: "Healthy", value: num(s.ok), color: "#14a37f" }, { label: "Low", value: num(s.low), color: "#e0a030" }, { label: "Out", value: num(s.out), color: "#d9534f" }]} />}</Box>
        <Box title="Movement types" icon={<Boxes />} wide>{s && <HBars data={slices(s.by_type)} />}</Box></div>
      <DataTable anchor={ref} title="Stock levels" fn="report_stock" subtitle="Current stock" searchHint="Product or SKU" args={{ p_status: f.status || null, p_category: f.category || null }}
        filters={<><Select label="Status" value={f.status} onChange={v => set("status", v)} options={[["", "All stock"], ["ok", "Healthy"], ["low", "Low"], ["out", "Out"]]} />
          <Select label="Category" value={f.category} onChange={v => set("category", v)} options={[["", "All categories"], ...cats.map(x => [x, x] as [string, string])]} /></>}
        cols={[{ key: "name", label: "Product" }, { key: "sku", label: "SKU", get: r => String(r.sku || "") }, { key: "category", label: "Category", get: r => String(r.category || "") }, { key: "stock", label: "In stock", get: r => num(r.stock) }, { key: "unit", label: "Unit" }, { key: "reorder_level", label: "Reorder at", get: r => num(r.reorder_level) }, { key: "status", label: "Status" }, { key: "value", label: "Value (ETB)", get: r => num(r.value) }]}
        render={{ status: r => <Badge v={String(r.status)} />, value: r => fmtMoney(r.value), stock: r => fmtN(r.stock), reorder_level: r => fmtN(r.reorder_level) }} />
      <MovementsTable c={c} />
    </>
  );
}
function MovementsTable({ c }: { c: Ctx }) {
  const [type, setType] = useState("");
  return (
    <DataTable title="Stock movements" fn="report_movements" subtitle={sub(c)} searchHint="Product, reference or user" args={{ ...c.args, p_type: type || null }}
      filters={<Select label="Movement" value={type} onChange={setType} options={[["", "All movements"], ["purchase", "Purchase"], ["sale", "Sale"], ["adjustment_in", "Adjustment in"], ["adjustment_out", "Adjustment out"], ["damage", "Damage"], ["return", "Return"]]} />}
      cols={[{ key: "created_at", label: "Date", get: r => fmtDateTime(r.created_at) }, { key: "product", label: "Product" }, { key: "movement_type", label: "Type", get: r => cap(String(r.movement_type)) }, { key: "quantity", label: "Qty", get: r => num(r.quantity) }, { key: "reference", label: "Reference", get: r => String(r.reference || "") }, { key: "by_name", label: "By", get: r => String(r.by_name || "") }, { key: "notes", label: "Notes", get: r => String(r.notes || "") }]}
      render={{ created_at: r => fmtDateTime(r.created_at), movement_type: r => <Badge v={String(r.movement_type)} />, quantity: r => fmtN(r.quantity), reference: r => String(r.reference || "—"), by_name: r => String(r.by_name || "—"), notes: r => String(r.notes || "—") }} />
  );
}

function Financial({ c }: { c: Ctx }) {
  const { f, set, drill, ref } = useDrill({ method: "" });
  const { data: s, error } = useRpc<Record<string, any>>("report_financial_summary", c.args);
  const { data: per } = useRpc<{ bucket: string; revenue: number; collected: number }[]>("report_financial_periods", { ...c.args, p_bucket: c.r.bucket, p_tz: TZ });
  const lbl = (b: string) => (c.r.bucket === "month" ? new Date(b + "T00:00").toLocaleString([], { month: "short" }) : new Date(b + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }));
  const cards: Card[] = s ? [
    { key: "r", icon: <Banknote />, label: "Revenue", value: fmtMoney(s.revenue), cur: num(s.revenue), prev: num(s.revenue_prev), onClick: () => drill({}) },
    { key: "c", icon: <Wallet />, label: "Collected", value: fmtMoney(s.collected) },
    { key: "o", icon: <Hourglass />, label: "Outstanding", value: fmtMoney(s.outstanding) },
    { key: "n", icon: <Receipt />, label: "Sales", value: fmtN(s.sales), note: `${fmtMoney(s.average)} average` },
    { key: "m", icon: <Percent />, label: "Commissions", value: "—", note: "Starts with supplier orders", muted: true },
    { key: "e", icon: <Store />, label: "Supplier earnings", value: "—", note: "Starts with supplier orders", muted: true },
    { key: "f", icon: <Undo2 />, label: "Refunds", value: "—", note: "Starts with supplier orders", muted: true },
  ] : [];
  const methods = (s?.by_method || []) as { method: string; count: number; amount: number }[];
  return (
    <>
      <Err msg={error} /><Cards cards={cards} />
      <div className="rp-grid2">
        <Box title="Revenue" icon={<Banknote />}><LineChart data={(per || []).map(p => ({ label: lbl(p.bucket), value: num(p.revenue) }))} fmt={fmtMoney} /></Box>
        <Box title="Collected" icon={<Wallet />}><LineChart bars data={(per || []).map(p => ({ label: lbl(p.bucket), value: num(p.collected) }))} fmt={fmtMoney} /></Box>
        <Box title="Payment methods" icon={<Banknote />} wide>{methods.length ? <HBars data={methods.map((m, i) => ({ label: cap(m.method), value: num(m.amount), color: PALETTE[i % PALETTE.length] }))} fmt={fmtMoney} /> : <p className="rp-empty">No sales in this period.</p>}</Box>
      </div>
      <Note>Commission, supplier earnings and refunds are not estimated. They start filling in once supplier orders go live.</Note>
      <DataTable anchor={ref} title="Sales & payments" fn="report_sales" subtitle={sub(c)} searchHint="Receipt or customer" args={{ ...c.args, p_method: f.method || null }}
        filters={<Select label="Payment" value={f.method} onChange={v => set("method", v)} options={[["", "All payments"], ...methods.map(m => [m.method, cap(m.method)] as [string, string])]} />}
        cols={[{ key: "receipt_number", label: "Receipt" }, { key: "customer_name", label: "Customer" }, { key: "payment_method", label: "Payment", get: r => cap(String(r.payment_method || "other")) }, { key: "total", label: "Total (ETB)", get: r => num(r.total) }, { key: "paid", label: "Paid (ETB)", get: r => num(r.paid) }, { key: "outstanding", label: "Balance (ETB)", get: r => Math.max(0, num(r.total) - num(r.paid)) }, { key: "sold_at", label: "Date", get: r => fmtDateTime(r.sold_at) }]}
        render={{ payment_method: r => <Badge v={String(r.payment_method || "other")} />, total: r => fmtMoney(r.total), paid: r => fmtMoney(r.paid), outstanding: r => fmtMoney(Math.max(0, num(r.total) - num(r.paid))), sold_at: r => fmtDateTime(r.sold_at) }} />
    </>
  );
}

function Soon({ t }: { t: Tab }) {
  return <div className="panel rp-soon">{t.icon}<b>{t.label}</b><p>Arrives in the next reports update.</p></div>;
}

export default function Reports() {
  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [cf, setCf] = useState(""), [ct, setCt] = useState("");
  const r = useMemo(() => rangeFor(preset, cf, ct), [preset, cf, ct]);
  const args = useMemo(() => ({ p_from: iso(r.from), p_to: iso(r.to) }), [r]);
  const c: Ctx = { r, args, go: setTab };
  const cur = TABS.find(t => t.key === tab)!;
  const body = cur.soon ? <Soon t={cur} /> : tab === "overview" ? <Overview c={c} /> : tab === "customers" ? <Customers c={c} /> : tab === "suppliers" ? <Suppliers c={c} /> : tab === "products" ? <Products c={c} /> : tab === "audit" ? <Audit c={c} /> : tab === "market" ? <Market c={c} /> : tab === "orders" ? <Orders c={c} /> : tab === "inquiries" ? <Inquiries c={c} /> : tab === "inventory" ? <Inventory c={c} /> : <Financial c={c} />;
  return (
    <>
      <PageHeading title="Reports & Analytics" sub="Business reports from your real TradeLink records." />
      <div className="rp-tabs" role="tablist">{TABS.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.icon}<span>{t.label}</span></button>)}</div>
      {!cur.soon && <DateBar preset={preset} setPreset={setPreset} cf={cf} ct={ct} setCf={setCf} setCt={setCt} label={r.label} />}
      <div key={tab} className="rp-body">{body}</div>
    </>
  );
}
