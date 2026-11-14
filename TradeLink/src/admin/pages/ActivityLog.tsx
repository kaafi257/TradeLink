import { useEffect, useState } from "react";
import { ActivityList, PageHeading } from "../../components/ui";
import { supabase, type Activity } from "../../lib/supabase";

export default function ActivityLog() {
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => {
    supabase?.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => setItems((data ?? []) as Activity[]));
  }, []);
  return (
    <>
      <PageHeading title="Activity Log" sub="Audit trail of changes and actions performed in TradeLink (latest 100)." />
      <div className="activity-page"><ActivityList items={items} limit={100} /></div>
    </>
  );
}
