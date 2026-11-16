import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { Package, ShoppingCart, Truck, Users, Plus } from "lucide-react";
import { shortDate } from "../lib/format";
import type { Activity } from "../lib/supabase";

export function Stat({ icon, color, value, label, note }: { icon: ReactNode; color: string; value: string; label: string; note: string }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-top"><span className="stat-icon">{icon}</span>{label}</div>
      <b>{value}</b>
      <span className="stat-trend">{note}</span>
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

const ACTION_HEADER = /^(actions?|contact)$/i;
/** Column count decides when the table turns into a card list (see the rt-* rules in admin.css). */
export const tableTier = (columns: number) => (columns >= 8 ? "rt-l" : columns >= 6 ? "rt-m" : "rt-s");
const hasContent = (node: ReactNode) => Children.toArray(node).some(c => typeof c !== "string" || c.trim() !== "");

/** Tags every cell with its column title, so the same rows can be shown as labelled cards on small screens. */
function labelCells(headers: string[], rows: ReactNode): ReactNode[] {
  return Children.toArray(rows).map(row => {
    if (!isValidElement<Record<string, unknown>>(row) || row.type !== "tr") return row;
    const cells = Children.toArray(row.props.children as ReactNode).map((cell, i) => {
      if (!isValidElement<Record<string, unknown>>(cell) || cell.type !== "td" || cell.props.colSpan) return cell;
      const header = headers[i] ?? "";
      const isAction = ACTION_HEADER.test(header);
      return cloneElement(cell, {
        "data-label": header,
        ...(isAction ? { "data-actions": "" } : {}),
        ...(isAction && !hasContent(cell.props.children as ReactNode) ? { "data-empty": "" } : {}),
      });
    });
    return cloneElement(row, undefined, cells);
  });
}

export function DataTable({ headers, children, empty, isEmpty }: { headers: string[]; children: ReactNode; empty: string; isEmpty: boolean }) {
  return (
    <div className="table-panel"><div className="table-scroll">
      <table className={`rt ${tableTier(headers.length)}`}>
        <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{isEmpty ? <tr><td colSpan={headers.length}><Empty message={empty} /></td></tr> : labelCells(headers, children)}</tbody>
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
