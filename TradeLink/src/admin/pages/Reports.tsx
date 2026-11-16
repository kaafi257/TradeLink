import { lazy, Suspense, useMemo, useState } from "react";
import { ChartNoAxesCombined, Package, Users } from "lucide-react";
import { PageHeading, PanelHead } from "../../components/ui";
import { RANGES, buildSeries, money, type Range } from "../../lib/format";
import { useAdmin } from "../AdminData";

const SalesChart = lazy(() => import("../SalesChart"));

export default function Reports() {
  const { salesDaily } = useAdmin();
  const [range, setRange] = useState<Range>("This Year");
  const series = useMemo(() => buildSeries(salesDaily, range), [salesDaily, range]);
  const total = series.reduce((n, p) => n + p.sales, 0);
  return (
    <>
      <PageHeading title="Reports & Analytics" sub="Business performance and operational reporting." />
      <div className="report-cards">
        <div><ChartNoAxesCombined /><b>Sales</b><p>{total ? money(total) : "—"}</p></div>
        <div className="soon"><Package /><b>Products</b><span className="soon-tag">Soon</span></div>
        <div className="soon"><Users /><b>Staff</b><span className="soon-tag">Soon</span></div>
      </div>
      <div className="panel report-chart">
        <PanelHead icon={<ChartNoAxesCombined />} title="Sales">
          <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
        </PanelHead>
        <div className="chart-wrap">
          {total ? <Suspense fallback={null}><SalesChart data={series} /></Suspense>
                 : <div className="empty-state"><ChartNoAxesCombined /></div>}
        </div>
      </div>
    </>
  );
}
