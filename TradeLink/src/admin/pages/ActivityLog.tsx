import { useEffect, useState } from "react";
import { Activity as ActivityIcon } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { shortDate } from "../../lib/format";
import { supabase, type Activity } from "../../lib/supabase";
import { RecordList, activityIcon, ago } from "../Records";

export default function ActivityLog() {
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => {
    supabase?.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => setItems((data ?? []) as Activity[]));
  }, []);
  return (
    <>
      <PageHeading title="Activity Log" sub="Audit trail of changes and actions performed in TradeLink (latest 100)." />
      <RecordList isEmpty={!items.length} empty="No activity yet" icon={<ActivityIcon />}>
        <div className="act-list glass-list">
          {items.map((a, i) => (
            <div className="act-row" key={a.id} style={{ "--i": Math.min(i, 14) } as React.CSSProperties} title={`${a.actor_name || "System"} · ${shortDate(a.created_at)}`}>
              <span className="act-ico">{activityIcon(a.description)}</span>
              <b>{a.description}</b>
              <time>{ago(a.created_at)}</time>
            </div>
          ))}
        </div>
      </RecordList>
    </>
  );
}
