import { lazy, Suspense, useMemo, useState } from "react";
import { ChartNoAxesCombined, Package, Users } from "lucide-react";
import { PageHeading, PanelHead } from "../../components/ui";
import { RANGES, buildSeries, money, type Range } from "../../lib/format";
import { useAdmin } from "../AdminData";

const SalesChart = lazy(() => import("../SalesChart"));

export default function Reports() {
  const { sales } = useAdmin();
  const [range, setRange] = useState<Range>("This Year");
  const series = useMemo(() => buildSeries(sales, range), [sales, range]);
  const total = series.reduce((n, p) => n + p.sales, 0);
  return (
    <>
      <PageHeading title="Reports & Analytics" sub="Business performance and operational reporting." />
      <div className="report-cards">
        <div><ChartNoAxesCombined /><b>Sales reports</b><p>{total ? `${money(total)} · ${range.toLowerCase()}` : "No recorded sales for this period."}</p></div>
        <div><Package /><b>Product reports</b><p>Product movement and demand (coming soon).</p></div>
        <div><Users /><b>Staff reports</b><p>Staff activity and workload (coming soon).</p></div>
      </div>
      <div className="panel report-chart">
        <PanelHead icon={<ChartNoAxesCombined />} title="Sales trend">
          <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
        </PanelHead>
        <div className="chart-wrap">
          {total ? <Suspense fallback={<p className="inline-note">Loading chart…</p>}><SalesChart data={series} /></Suspense>
                 : <div className="empty-state"><ChartNoAxesCombined /><p>No sales recorded for this period.</p></div>}
        </div>
      </div>
    </>
  );
}
