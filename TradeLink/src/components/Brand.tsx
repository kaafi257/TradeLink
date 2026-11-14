import { Wheat } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <div className="brand-symbol"><Wheat size={27} /></div>
      <div><b>Trade<span>Link</span></b><small>FOOD WHOLESALE</small></div>
    </div>
  );
}
