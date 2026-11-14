import type { ReactNode } from "react";
import { Package, ShoppingCart, Truck, Users, Plus } from "lucide-react";
import { shortDate } from "../lib/format";
import type { Activity } from "../lib/supabase";

export function Stat({ icon, color, value, label, note }: { icon: ReactNode; color: string; value: string; label: string; note: string }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-copy"><b>{value}</b><small>{label}</small></div>
      <span className="stat-trend">{note}</span>
      <div className="sparkline" />
    </div>
  );
}

export function PanelHead({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="panel-head"><div>{icon}<b>{title}</b></div>{children}</div>;
}

export function PageHeading({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{sub}</p></div>{action}</div>;
}

export function Empty({ message }: { message: string }) {
  return <div className="empty-state"><Package /><p>{message}</p></div>;
}

export function DataTable({ headers, children, empty, isEmpty }: { headers: string[]; children: ReactNode; empty: string; isEmpty: boolean }) {
  return (
    <div className="table-panel"><div className="table-scroll">
      <table>
        <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{isEmpty ? <tr><td colSpan={headers.length}><Empty message={empty} /></td></tr> : children}</tbody>
      </table>
    </div></div>
  );
}

const dotIcons = [<ShoppingCart key="a" />, <Users key="b" />, <Truck key="c" />, <Plus key="d" />];
export function ActivityList({ items, limit = 7 }: { items: Activity[]; limit?: number }) {
  if (!items.length) return <Empty message="No activity recorded yet." />;
  return (
    <div className="activity-list">
      {items.slice(0, limit).map((a, i) => (
        <div className="activity-row" key={a.id}>
          <span className={`activity-dot dot-${i % 4}`}>{dotIcons[i % 4]}</span>
          <div><b>{a.description}</b><small>{a.actor_name || "System"} · {shortDate(a.created_at)}</small></div>
        </div>
      ))}
    </div>
  );
}
